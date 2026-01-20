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

**Related Bead**: cvx-pznt

```bash
pnpm test:scheduler
```

### Payload Overhead Tests (`test:payload`)

Measures the relationship between step result payload size and step overhead.

**Related Beads**: cvx-6c37, cvx-w816

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
