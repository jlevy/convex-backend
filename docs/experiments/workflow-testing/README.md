# Workflow and Workpool End-to-End Testing

This package provides a self-contained test harness for investigating Convex workflow
and workpool behavior, specifically targeting potential bugs and performance issues.

## Prerequisites

- Node.js 18+
- pnpm 8+
- Convex CLI (`npm install -g convex`)

## Source Code References

**IMPORTANT**: Before making changes or investigating issues, ensure you have the
workflow and workpool source code available for cross-reference.

### Checking Out Component Sources

Clone the component repositories into the `attic/` directory (gitignored):

```bash
# From repository root
mkdir -p attic/workflow attic/workpool

# Clone workflow component
git clone https://github.com/get-convex/workflow.git attic/workflow/workflow

# Clone workpool component
git clone https://github.com/get-convex/workpool.git attic/workpool/workpool
```

### Key Source Files

**Workflow Component** (`attic/workflow/workflow/src/`):
| File | Purpose |
|------|---------|
| `client/workflowMutation.ts` | Workflow handler execution model |
| `client/step.ts` | Step executor, journal management |
| `component/pool.ts` | Workpool integration, onComplete handlers |
| `component/journal.ts` | Journal persistence and loading |
| `shared.ts` | Constants including MAX_JOURNAL_SIZE |

**Workpool Component** (`attic/workpool/workpool/src/`):
| File | Purpose |
|------|---------|
| `component/loop.ts` | Main workpool loop |
| `component/shared.ts` | Constants (SEGMENT_MS = 100ms) |
| `component/kick.ts` | Loop wake-up mechanism |
| `component/worker.ts` | Work execution wrappers |

### Cross-Reference Checklist

When investigating issues:
- [ ] Check `journal.load()` for query patterns
- [ ] Check `pool.ts` for step enqueue/completion flow
- [ ] Check `loop.ts` for scheduling logic
- [ ] Check `shared.ts` for timing constants
- [ ] Compare observed behavior with source code expectations

## Quick Start

```bash
# Install dependencies
pnpm install

# Start local Convex development server
pnpm dev

# In another terminal, run tests
pnpm test
```

## Test Suites

### Scheduler Wake-up Tests (`test:scheduler`)

Investigates whether DB subscription wake-up fails after long-running steps,
causing fallback to 5-second polling.

**Related Bead**: cvx-fcqi

```bash
pnpm test:scheduler
```

### Payload Overhead Tests (`test:payload`)

Measures the relationship between step result payload size and step overhead.

**Related Beads**: cvx-g6ac, cvx-vjh4

```bash
pnpm test:payload
```

### Journal Scaling Tests (`test:journal`)

Verifies O(N) scaling of journal load time with iteration count.

```bash
pnpm test:journal
```

## Configuration

### Environment Variables

Create `.env.local` with:

```bash
# Use local Convex server (default)
CONVEX_DEPLOYMENT=local

# Or use a Convex Cloud project
# CONVEX_DEPLOYMENT=https://your-project.convex.cloud
```

### Test Configuration

Edit `vitest.config.ts` to adjust:
- Number of samples per test
- Timeout values
- Statistical thresholds

## Results

After running tests, generate a report:

```bash
pnpm report
```

This creates `RESULTS.md` with:
- Statistical summaries
- Graphs (if enabled)
- Recommendations for documentation updates

## Testing Approaches

### Integration Testing (This Harness)

This test harness uses **live integration testing** with `ConvexHttpClient`:

```typescript
const client = new ConvexHttpClient(CONVEX_URL);
const workflowId = await client.mutation(api.testWorkflows.startWorkflow, args);
// Poll for completion
const status = await client.query(api.testWorkflows.getWorkflowStatus, { workflowId });
```

**Advantages:**
- Tests real workflow/workpool behavior in actual Convex environment
- Measures real timing characteristics (overhead, gaps, latency)
- Catches production-like issues

**Disadvantages:**
- Slower (real time delays)
- Requires running Convex dev server
- Non-deterministic timing

### Unit Testing (Official Example Pattern)

The official `attic/workflow/workflow/example/` uses `initConvexTest()` with **fake timers**:

```typescript
import { initConvexTest } from "./setup.test";
import { vi } from "vitest";

beforeEach(async () => {
  vi.useFakeTimers();
  t = await setupTest();
});

afterEach(async () => {
  await t.finishAllScheduledFunctions(vi.runAllTimers);
  vi.useRealTimers();
});
```

**Advantages:**
- Fast (no real delays)
- Deterministic
- Good for logic testing

**Disadvantages:**
- Doesn't measure real timing
- May miss production-specific issues
- Requires careful timer management

### Which to Use?

| Use Case | Recommended Approach |
|----------|---------------------|
| Performance measurement | Integration (this harness) |
| Logic correctness | Unit tests with fake timers |
| Regression testing | Unit tests |
| Issue reproduction | Integration tests |

## Related Documentation

- [Workflow Architecture Research](../../project/research/current/research-convex-durable-workflows-architecture.md)
- [Limits Implementation Research](../../project/research/current/research-convex-backend-limits-implementation.md)
- [Plan Document](./PLAN.md)

## Troubleshooting

### "Convex dev server not running"

Start the development server:
```bash
pnpm dev
```

### "Module not found: @convex-dev/workflow"

Ensure dependencies are installed:
```bash
pnpm install
```

### Tests timing out

Increase timeout in `vitest.config.ts`:
```typescript
export default defineConfig({
  test: {
    testTimeout: 60000, // 60 seconds
  },
});
```

## Research Findings

### Fully-Instrumented Workflow Analysis (cvx-88z7)

The fully-instrumented workflow test captures timing at every point to achieve near-100%
accountability of workflow execution time:

```
============================================================
FULL TIME ACCOUNTABILITY REPORT
============================================================
Configuration: 15 steps x 100ms, 10KB payload
Total Duration: 69040ms
Total Invocations: 1
Accountability: 91.9%
------------------------------------------------------------
COMPONENT BREAKDOWN:
------------------------------------------------------------
Action Execution           1900ms    2.8%  Time actions actually ran
Step Call Overhead        24842ms   36.0%  Workpool enqueue → action start
Step Return Overhead      13986ms   20.3%  Action end → step return
Inter-Step Overhead       21770ms   31.5%  Between steps in handler
Handler Setup               967ms    1.4%  Journal replay + context
Inter-Invocation              0ms    0.0%  Scheduler wake-up delay
------------------------------------------------------------
TOTAL MEASURED            63465ms   91.9%
UNACCOUNTED                5575ms    8.1%
============================================================
```

### Key Findings

1. **91.9% Accountability** - Successfully accounted for almost all time (vs 48.4% in earlier tests without deep instrumentation)

2. **Major Overhead Sources (ranked by impact):**
   | Source | Percentage | Description |
   |--------|------------|-------------|
   | Step Call Overhead | 36.0% | Workpool enqueue + scheduling (pre_step → action_start) |
   | Inter-Step Overhead | 31.5% | Time between steps within handler |
   | Step Return Overhead | 20.3% | Workpool completion handling (action_end → post_step) |
   | Unaccounted | 8.1% | Measurement gaps, JS event loop, etc. |
   | Action Execution | 2.8% | Actual work performed |
   | Handler Setup | 1.4% | Journal replay + context setup |

3. **Overhead Asymmetry:**
   - Per-step call overhead: ~1654ms
   - Per-step return overhead: ~936ms
   - **Ratio: 1.77x** - Step CALL is more expensive than step RETURN
   - This suggests workpool enqueue/scheduling is more expensive than completion handling

4. **Overhead Per Step: ~2,588ms** for a 100ms action (25x overhead!)

5. **Journal Replay is NOT the main issue** - Only 1.4% of time is handler setup

### Implications

1. **Workpool optimization is critical** - 56.3% of time is workpool-related (call + return overhead)

2. **Short actions suffer the most** - With 2,588ms overhead per step, actions under ~200ms are dominated by overhead

3. **Batching steps would help** - Reducing the number of steps reduces overhead proportionally

4. **Inter-step overhead is significant** - 31.5% suggests opportunity for optimization in handler execution flow

### Related Beads

- cvx-88z7: Create fully-instrumented workflow (P0) - COMPLETED
- cvx-d3nl: Investigate journal load time scaling
- cvx-ox3h: Investigate workpool coordination overhead
- cvx-w9ev: Investigate step completion handling overhead
