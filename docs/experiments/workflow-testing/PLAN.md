# Plan: Workflow and Workpool End-to-End Testing

**Created**: 2026-01-20
**Status**: Draft
**Related Beads**: cvx-pznt, cvx-6c37, cvx-w816

## Objective

Create a self-contained test harness to investigate and verify workflow/workpool behavior,
specifically targeting the potential bugs and performance characteristics identified in
the arena project analysis.

## Investigation Targets

### 1. Scheduler Wake-up Failure (cvx-pznt, P1)

**Hypothesis**: After complex/long-running tool executions, the DB subscription wake-up
sometimes fails, causing the scheduler to fall back to 5-second polling.

**Test Approach**:
- Create workflow with steps of varying execution times (100ms, 1s, 5s, 15s)
- Measure inter-iteration gaps precisely
- Look for correlation between step duration and gap length
- Identify threshold where gaps exceed ~2s (indicating missed subscription)

**Expected Outcome**: Understand when/why the ~6s gaps occur and whether this is
a workpool issue, scheduler issue, or expected behavior under load.

### 2. Large Payload Overhead (cvx-6c37, cvx-w816, P2)

**Hypothesis**: `step.runQuery()` returning large payloads incurs variable overhead
proportional to payload size due to serialization through the workpool.

**Test Approach**:
- Create workflow steps returning payloads of varying sizes (1KB, 10KB, 100KB, 500KB, 1MB)
- Measure step execution time vs payload size
- Isolate workpool overhead from actual query time
- Compare query-only time vs full step round-trip time

**Expected Outcome**: Quantify the relationship between payload size and step overhead.

### 3. Journal Load Scaling (Bonus)

**Hypothesis**: Journal load time grows O(N) with step count, contributing to
accumulated overhead in long-running workflows.

**Test Approach**:
- Create workflow that runs N iterations (N = 10, 25, 50, 100)
- Measure journal load time at each iteration
- Plot journal load time vs iteration number

**Expected Outcome**: Confirm O(N) scaling and quantify the per-step overhead.

## Architecture

```
docs/experiments/workflow-testing/
├── package.json              # pnpm package config
├── pnpm-lock.yaml
├── tsconfig.json
├── convex.json               # Convex project config
├── PLAN.md                   # This file
├── README.md                 # Setup and usage instructions
├── scripts/
│   ├── setup.sh              # Start local Convex, deploy
│   ├── teardown.sh           # Stop local Convex, cleanup
│   └── run-tests.sh          # Execute test suite
├── convex/
│   ├── _generated/           # Convex generated files
│   ├── convex.config.ts      # Component configuration
│   ├── schema.ts             # Database schema
│   ├── testWorkflows.ts      # Workflow definitions for testing
│   ├── testActions.ts        # Test actions (variable duration, payload sizes)
│   ├── testQueries.ts        # Test queries
│   └── measurements.ts       # Timing capture mutations
└── tests/
    ├── scheduler-wakeup.test.ts     # Test for cvx-pznt
    ├── payload-overhead.test.ts     # Test for cvx-6c37, cvx-w816
    ├── journal-scaling.test.ts      # Bonus: journal load scaling
    └── utils/
        ├── timing.ts                # Precision timing utilities
        ├── stats.ts                 # Statistical analysis
        └── convex-client.ts         # Convex client wrapper
```

## Test Workflows

### 1. Variable Duration Workflow

```typescript
// Tests scheduler wake-up behavior
export const variableDurationWorkflow = workflow.define({
  args: { durations: v.array(v.number()) },
  handler: async (step, args) => {
    const gaps = [];
    let prevEnd = Date.now();

    for (const durationMs of args.durations) {
      const iterStart = Date.now();
      gaps.push(iterStart - prevEnd);

      await step.runAction(internal.testActions.sleepAction, { durationMs });

      prevEnd = Date.now();
    }

    return { gaps, durations: args.durations };
  },
});
```

### 2. Variable Payload Workflow

```typescript
// Tests payload size impact on overhead
export const variablePayloadWorkflow = workflow.define({
  args: { payloadSizes: v.array(v.number()) },
  handler: async (step, args) => {
    const measurements = [];

    for (const sizeBytes of args.payloadSizes) {
      const start = Date.now();

      // This step returns a payload of the specified size
      const result = await step.runQuery(internal.testQueries.generatePayload, { sizeBytes });

      const elapsed = Date.now() - start;
      measurements.push({ sizeBytes, elapsedMs: elapsed, resultLength: result.length });
    }

    return { measurements };
  },
});
```

### 3. Journal Scaling Workflow

```typescript
// Tests journal load scaling
export const journalScalingWorkflow = workflow.define({
  args: { iterations: v.number() },
  handler: async (step, args) => {
    const loadTimes = [];

    for (let i = 0; i < args.iterations; i++) {
      const loadStart = Date.now();

      // Each step adds to the journal
      await step.runMutation(internal.testActions.incrementCounter, { step: i });

      const loadEnd = Date.now();
      loadTimes.push({ iteration: i, loadTimeMs: loadEnd - loadStart });
    }

    return { loadTimes, totalIterations: args.iterations };
  },
});
```

## Measurement Strategy

### Precision Timing

Use `performance.now()` where available, fall back to `Date.now()`:

```typescript
const getTimestamp = () => {
  if (typeof performance !== 'undefined') {
    return performance.now();
  }
  return Date.now();
};
```

### Statistical Analysis

For each test, collect:
- **N samples** (minimum 10 per configuration)
- **Mean, median, P95, P99** for each metric
- **Standard deviation** to assess variability
- **Outlier detection** (values > 2 standard deviations)

### Data Persistence

Store all measurements in Convex tables for post-hoc analysis:

```typescript
// convex/schema.ts
export default defineSchema({
  testRuns: defineTable({
    testName: v.string(),
    startTime: v.number(),
    endTime: v.optional(v.number()),
    config: v.any(),
    status: v.string(),
  }),

  measurements: defineTable({
    testRunId: v.id("testRuns"),
    metricName: v.string(),
    value: v.number(),
    metadata: v.optional(v.any()),
    timestamp: v.number(),
  }).index("by_test_run", ["testRunId"]),
});
```

## Setup Requirements

### Prerequisites

- Node.js 18+
- pnpm 8+
- Convex CLI (`npx convex`)
- Local Convex server capability (or Convex Cloud project)

### Environment Variables

```bash
# .env.local
CONVEX_DEPLOYMENT=local  # or your Convex project URL
```

### Installation

```bash
cd docs/experiments/workflow-testing
pnpm install
pnpm convex dev  # Start local Convex
```

## Test Execution

### Quick Run (All Tests)

```bash
pnpm test
```

### Individual Test Suites

```bash
pnpm test:scheduler    # Scheduler wake-up tests
pnpm test:payload      # Payload overhead tests
pnpm test:journal      # Journal scaling tests
```

### Generate Report

```bash
pnpm report           # Generates docs/experiments/workflow-testing/RESULTS.md
```

## Success Criteria

### For cvx-pznt (Scheduler Wake-up)

- **CONFIRMED** if: >10% of inter-iteration gaps exceed 5s after long steps
- **DISPROVEN** if: gaps are consistently <2s regardless of step duration
- **PARTIAL** if: gaps correlate with step duration but stay <5s

### For cvx-6c37, cvx-w816 (Payload Overhead)

- **CONFIRMED** if: linear relationship between payload size and step overhead (R² > 0.8)
- **DISPROVEN** if: no significant correlation (R² < 0.3)
- **PARTIAL** if: correlation exists but is sublinear or has threshold effects

### For Journal Scaling

- **CONFIRMED** if: journal load time grows linearly with iteration count
- **DISPROVEN** if: journal load time is constant or sublinear
- **PARTIAL** if: growth is superlinear (worse than O(N))

## Timeline

| Phase | Tasks | Duration |
|-------|-------|----------|
| 1. Setup | Create package, install deps, configure Convex | 1 session |
| 2. Implement | Write workflows, actions, queries, tests | 1-2 sessions |
| 3. Execute | Run tests, collect data | 1 session |
| 4. Analyze | Generate reports, update documentation | 1 session |

## Deliverables

1. **Test Package**: Self-contained, runnable test suite
2. **Results Document**: `RESULTS.md` with findings
3. **Documentation Updates**: Revisions to workflow architecture doc
4. **Bead Closures**: Close cvx-pznt, cvx-6c37, cvx-w816 with findings

## Related Documentation

- [research-convex-durable-workflows-architecture.md](../../project/research/current/research-convex-durable-workflows-architecture.md)
- [research-convex-backend-limits-implementation.md](../../project/research/current/research-convex-backend-limits-implementation.md)
- [Workflow Component Source](https://github.com/get-convex/workflow)
- [Workpool Component Source](https://github.com/get-convex/workpool)
