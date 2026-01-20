# Research Brief: Convex Durable Workflows and Workpool Architecture

**Last Updated**: 2026-01-20

**Status**: Complete

**Related**:

- [research-convex-db-limits-best-practices.md](../../../general/research/current/research-convex-db-limits-best-practices.md) —
  Database limits and best practices
- [research-convex-backend-limits-implementation.md](./research-convex-backend-limits-implementation.md) —
  Source code implementation of limits and configurability
- [@convex-dev/workflow](https://github.com/get-convex/workflow) — Workflow component source
- [@convex-dev/workpool](https://github.com/get-convex/workpool) — Workpool component source

* * *

## Executive Summary

This document provides a deep technical analysis of Convex's durable workflow and workpool
components. Understanding these architectures is critical for building efficient long-running
processes that extend beyond the 10-minute action timeout limit.

**Key Finding**: Workflows introduce significant per-step overhead (estimated 100-500ms per step)
compared to direct action execution. This overhead comes from multiple database operations per
step, journal replay on each continuation, and workpool coordination. For short steps (< 1 second),
this can result in 4-5x slower total execution time compared to inline action calls.

**Research Questions**:

1. What is the architectural model of Convex workflows and workpools?
2. Where does the execution overhead come from?
3. What configuration options exist to minimize overhead?
4. What are the limitations and what improvements are needed?

* * *

## Research Methodology

### Approach

- Source code analysis of `@convex-dev/workflow` and `@convex-dev/workpool`
- Review of official documentation and README files
- Analysis of execution flow and database operations

### Sources

- Workflow source: `attic/workflow/workflow/` (cloned from GitHub)
- Workpool source: `attic/workpool/workpool/` (cloned from GitHub)
- Official Convex documentation

* * *

## Architecture Overview

### Core Components

```
┌──────────────────────────────────────────────────────────────────────┐
│                         User Application                              │
├──────────────────────────────────────────────────────────────────────┤
│   WorkflowManager                                                     │
│   ├── workflow.start() → creates workflow, enqueues handler          │
│   ├── workflow.status() → query workflow state                       │
│   └── workflow.cancel() → cancel running workflow                    │
├──────────────────────────────────────────────────────────────────────┤
│   Workflow Component (component table namespace)                      │
│   ├── workflows table → workflow state, args, runResult              │
│   ├── steps table → journal entries for each step                    │
│   └── events table → external events for awaitEvent                  │
├──────────────────────────────────────────────────────────────────────┤
│   Workpool Component (component table namespace)                      │
│   ├── work table → enqueued work items                               │
│   ├── pendingStart table → work scheduled to start                   │
│   ├── pendingCompletion table → completed work awaiting processing   │
│   ├── pendingCancelation table → work scheduled for cancellation     │
│   ├── internalState table → loop state, cursors, running list        │
│   └── runStatus table → loop status (idle/running/scheduled)         │
└──────────────────────────────────────────────────────────────────────┘
```

### Workflow Execution Model

**Key Insight**: Workflow handlers are **mutations** that replay from a journal until they block.

```
┌─────────────────────────────────────────────────────────────────────────┐
│ Workflow Handler Execution (runs as mutation)                           │
│                                                                         │
│ 1. Load journal entries (query)                                         │
│ 2. Check for in-progress steps → if any, return immediately            │
│ 3. Replay handler, serving completed step results from journal         │
│ 4. When handler awaits new step:                                       │
│    a. Enqueue step to workpool (via startSteps mutation)               │
│    b. Return (handler will be re-invoked when step completes)          │
│ 5. When handler completes → mark workflow complete                     │
└─────────────────────────────────────────────────────────────────────────┘
```

### Workpool Main Loop

The workpool uses an **event-driven loop** (not a poll loop) with segment-based scheduling:

```
Segment = 100ms time slice

Main Loop (mutation):
├── handleCompletions() → process completed work, handle retries
├── handleCancelation() → process cancellation requests
├── handleRecovery() → check for stuck jobs (every 1 minute)
├── handleStart() → start pending work (up to maxParallelism)
└── Schedule updateRunStatus mutation

updateRunStatus (mutation):
├── Check for outstanding cancelations → reschedule main immediately
├── Check if next segment is actionable → schedule main for that segment
├── Find next actionable segment → schedule main for that time
└── If nothing to do → go idle
```

**Key Timing Constants**:

| Constant | Value | Purpose |
| --- | --- | --- |
| `SEGMENT_MS` | 100ms | Time granularity for scheduling |
| `CURSOR_BUFFER_SEGMENTS` | 30s | Buffer for out-of-order processing |
| `RECOVERY_PERIOD_SEGMENTS` | 1 minute | How often to check for stuck jobs |
| `RECOVERY_THRESHOLD_MS` | 5 minutes | Age threshold for job recovery |
| Cron recovery | 30 minutes | Safety net cron to recover stuck work |

* * *

## Overhead Analysis

### Per-Step Database Operations

Each workflow step involves multiple database operations:

```
Step Execution Flow:
┌─────────────────────────────────────────────────────────────────────────┐
│ 1. Workflow handler runs (MUTATION)                                     │
│    └── Journal query (READ) ~10-30ms                                   │
│                                                                         │
│ 2. Step enqueued to workpool via journal.startSteps (MUTATION)         │
│    ├── Insert step to "steps" table                                    │
│    ├── Insert to workpool "work" table                                 │
│    ├── Insert to "pendingStart" table                                  │
│    └── Kick main loop if needed                                        │
│    └── ~20-50ms                                                        │
│                                                                         │
│ 3. Workpool main loop starts work (MUTATION)                           │
│    ├── Read pendingStart                                               │
│    ├── Schedule actual function via ctx.scheduler                      │
│    ├── Update internalState                                            │
│    └── ~20-50ms                                                        │
│                                                                         │
│ 4. Actual step executes (ACTION/MUTATION/QUERY)                        │
│    └── Variable time (your code)                                       │
│                                                                         │
│ 5. Step completion via worker.ts (MUTATION)                            │
│    ├── Insert to pendingCompletion                                     │
│    ├── Kick main loop                                                  │
│    └── ~20-50ms                                                        │
│                                                                         │
│ 6. Workpool processes completion (MUTATION)                            │
│    ├── Read pendingCompletion                                          │
│    ├── Call onComplete handler                                         │
│    ├── Update internalState                                            │
│    └── ~20-50ms                                                        │
│                                                                         │
│ 7. onComplete calls pool.onComplete (MUTATION)                         │
│    ├── Update step in journal                                          │
│    ├── Re-enqueue workflow handler to workpool                         │
│    └── ~20-50ms                                                        │
│                                                                         │
│ 8. Workflow handler re-runs (back to step 1)                           │
└─────────────────────────────────────────────────────────────────────────┘

TOTAL OVERHEAD PER STEP: ~100-300ms (not counting actual step execution)
```

### Overhead Comparison

| Execution Pattern | Overhead per "step" | Use Case |
| --- | --- | --- |
| **Direct action call** | ~0ms | Simple one-shot operations |
| **ctx.scheduler.runAfter** | ~20-50ms | Fire-and-forget async |
| **Workpool enqueue** | ~100-200ms | Rate-limited async with retry |
| **Workflow step** | ~100-300ms | Durable, resumable operations |

### Why 4-5x Slower for Short Steps

For a step that takes 1 second to execute:

- **Direct call**: 1s
- **Workflow step**: 1s + ~200ms overhead + journal replay = ~1.3-1.5s

For a workflow with 5 steps, each taking 200ms:

- **Direct inline**: 5 × 200ms = 1s
- **Workflow**: 5 × (200ms + 200ms overhead) = 2s + journal replays = ~3-4s

**The overhead is relatively fixed per step**, so:
- For short steps (< 1s): overhead dominates → 2-5x slower
- For long steps (> 10s): overhead negligible → ~1.1x slower

* * *

## Configuration Options

### Workpool Options

```typescript
const workflow = new WorkflowManager(components.workflow, {
  workpoolOptions: {
    // Maximum concurrent steps (default: 25)
    // Pro: max 100, Free: max 20
    maxParallelism: 25,

    // Log level for debugging
    logLevel: "INFO", // "DEBUG" | "INFO" | "WARN" | "ERROR"

    // Default retry behavior
    defaultRetryBehavior: {
      maxAttempts: 5,
      initialBackoffMs: 500,
      base: 2,
    },

    // Whether to retry actions by default
    retryActionsByDefault: false,
  },
});
```

### Per-Step Options

```typescript
await step.runAction(internal.myAction, args, {
  // Custom name for logging
  name: "MyAction",

  // Retry configuration
  retry: true, // use default
  // or
  retry: { maxAttempts: 3, initialBackoffMs: 100, base: 2 },
  // or
  retry: false, // no retries

  // Scheduling delay
  runAfter: 5000, // delay 5 seconds
  // or
  runAt: Date.now() + 60000, // specific time
});
```

* * *

## Limitations

### Hard Limitations

1. **Journal Size Limit**: 1 MiB total for step arguments + return values within a single workflow
   - Workaround: Store large data in DB, pass IDs

2. **Journal Limit Enforcement**: 8 MiB imposed on journal to stay within mutation bounds

3. **Mutation Limits Apply**: Workflow handler is a mutation
   - 8 MiB read / 16K documents scanned (documented; source code allows 16 MiB / 32K)
   - 8 MiB write / 8K documents written (documented; source code allows 16 MiB / 16K)
   - 1 second JS execution time
   - See [limits implementation doc](./research-convex-backend-limits-implementation.md) for details

4. **No Field Projection**: Convex reads entire documents, so journal replay reads all step data

5. **Determinism Required**: Workflow handlers must be deterministic
   - No `fetch`, `crypto.randomUUID`, etc. in handler body
   - Use steps for non-deterministic operations

6. **Implementation Stability**: Changing workflow handler code while workflows are running
   causes determinism violations

### Soft Limitations (Can Be Improved)

1. **Per-Step Overhead**: ~100-300ms per step from coordination mutations
   - Could be reduced with batching or optimized paths

2. **Journal Replay**: Full journal loaded on each continuation
   - Could use cursor-based incremental replay

3. **No Priority Queues**: All work in same pool has equal priority
   - Multiple workpools can separate work classes

* * *

## Best Practices for Efficient Workflows

### 1. Minimize Step Count

```typescript
// BAD: Many small steps
for (const item of items) {
  await step.runAction(internal.processOne, { item });
}

// GOOD: Batch into fewer steps
await step.runAction(internal.processBatch, { items });
```

### 2. Use Workflows Only When Needed

| Scenario | Recommendation |
| --- | --- |
| Simple async task, no recovery needed | `ctx.scheduler.runAfter` |
| Need rate limiting or retries | Workpool directly |
| Need durability + long-running | Workflow |
| Sub-second operations | Direct function calls |

### 3. Design Steps for Durability, Not Granularity

```typescript
// BAD: Each API call is a step
const user = await step.runQuery(internal.getUser, { userId });
const order = await step.runQuery(internal.getOrder, { orderId });
const result = await step.runAction(internal.processOrder, { user, order });

// GOOD: Combine related operations
const result = await step.runAction(internal.processOrderComplete, {
  userId,
  orderId
});
// processOrderComplete internally does: getUser, getOrder, process
```

### 4. Use Parallel Steps When Possible

```typescript
// Sequential: 3 × (step time + overhead)
const a = await step.runAction(internal.taskA, {});
const b = await step.runAction(internal.taskB, {});
const c = await step.runAction(internal.taskC, {});

// Parallel: max(step times) + overhead
const [a, b, c] = await Promise.all([
  step.runAction(internal.taskA, {}),
  step.runAction(internal.taskB, {}),
  step.runAction(internal.taskC, {}),
]);
```

### 5. Store Large Data in DB, Not Journal

```typescript
// BAD: Large return value in journal
await step.runAction(internal.fetchLargeData, {}); // returns 500KB

// GOOD: Store in DB, return ID
await step.runAction(internal.fetchAndStoreLargeData, {}); // returns { dataId }
```

### 6. Consider Workflow Alternatives for High-Frequency Operations

For high-frequency, short-duration operations where durability isn't critical:

1. **Direct scheduling**: `ctx.scheduler.runAfter(0, ...)`
2. **Workpool without workflow**: Just use workpool for rate limiting
3. **Inline action calls**: For operations that can complete in < 10 minutes

* * *

## Open Research Questions

1. **Batch Step Submission**: Could multiple steps be submitted in a single mutation
   to reduce coordination overhead?

2. **Incremental Journal Replay**: Could the journal be replayed incrementally with
   cursors instead of loading all entries?

3. **Step Result Caching**: Could completed step results be cached in memory during
   workflow handler execution?

4. **Optimized Paths for Queries/Mutations**: Since queries and mutations are fast,
   could they bypass some workpool coordination?

5. **Priority Queues**: Could workpool support priority-based scheduling to reduce
   latency for critical steps?

* * *

## Recommendations

### For Applications Migrating to Workflows

1. **Expect 2-5x slowdown** for workflows with many short steps
2. **Batch operations** into fewer, larger steps
3. **Use workflows for durability**, not just async execution
4. **Measure baseline performance** before and after migration

### For Improving Workflow Efficiency (Future Work)

1. **Reduce per-step mutations** by batching coordination
2. **Implement incremental journal** to avoid full replay
3. **Add "fast path"** for queries/mutations that bypass full workpool
4. **Consider worker pooling** to reduce cold start overhead

### When to Use Workflows vs Alternatives

| Need | Solution |
| --- | --- |
| Durability across restarts | Workflow |
| Operations spanning > 10 minutes | Workflow |
| Rate limiting external APIs | Workpool |
| Simple async fire-and-forget | `ctx.scheduler` |
| Complex orchestration | Workflow |
| High-frequency, low-latency | Direct calls |

* * *

## References

- [Workflow README](https://github.com/get-convex/workflow/blob/main/README.md)
- [Workpool README](https://github.com/get-convex/workpool/blob/main/README.md)
- [Convex Scheduled Functions](https://docs.convex.dev/scheduling/scheduled-functions)
- [Convex Actions](https://docs.convex.dev/functions/actions)
- Source: `attic/workflow/workflow/src/` - Workflow component source code
- Source: `attic/workpool/workpool/src/` - Workpool component source code

* * *

## Appendix A: Key Source Code Locations

### Workflow Component

| File | Purpose |
| --- | --- |
| `src/client/workflowMutation.ts` | Workflow handler execution model |
| `src/client/step.ts` | Step executor, journal management |
| `src/component/pool.ts` | Workpool integration, onComplete handlers |
| `src/component/workflow.ts` | Workflow CRUD operations |
| `src/component/journal.ts` | Journal load and step management |

### Workpool Component

| File | Purpose |
| --- | --- |
| `src/component/loop.ts` | Main loop, segment-based scheduling |
| `src/component/kick.ts` | Loop kicking mechanism |
| `src/component/shared.ts` | Constants (SEGMENT_MS, etc.) |
| `src/component/worker.ts` | Actual work execution wrappers |
| `src/component/crons.ts` | Recovery cron (30 min interval) |

### Key Constants

```typescript
// Workpool (shared.ts)
SEGMENT_MS = 100;                    // Time granularity
DEFAULT_MAX_PARALLELISM = 10;        // Default concurrent work

// Workpool (loop.ts)
RECOVERY_THRESHOLD_MS = 5 * MINUTE;  // Age for recovery
RECOVERY_PERIOD_SEGMENTS = 1 minute; // Recovery check interval
CURSOR_BUFFER_SEGMENTS = 30 seconds; // Out-of-order buffer

// Workflow (pool.ts)
DEFAULT_MAX_PARALLELISM = 25;        // Default for workflows
DEFAULT_RETRY_BEHAVIOR = {
  maxAttempts: 5,
  initialBackoffMs: 500,
  base: 2,
};
```

## Appendix B: Convex Scheduler Implementation

**Source**: `crates/application/src/scheduled_jobs/mod.rs`

### Event-Driven Scheduling (NOT Polling)

The Convex scheduler is **event-driven**, not poll-based. It uses three wake sources:

```rust
// From scheduled_jobs/mod.rs:303-322
select_biased! {
    // 1. Job finished notifications (immediate)
    num_jobs = self.job_finished_rx.recv_many(...) => { ... },

    // 2. Timer for next scheduled job (or 5s if behind)
    _ = next_job_future.fuse() => { },

    // 3. Database subscription invalidation (immediate)
    _ = subscription.wait_for_invalidation().fuse() => { },
}
```

### The 5-Second Fallback (Clarification)

The "5-second polling" mentioned in some discussions is **NOT** regular polling:

```rust
// From scheduled_jobs/mod.rs:288-293
let wait_time = next_job_ts.duration_since(now).unwrap_or_else(|_| {
    // If we're behind, re-run this loop every 5 seconds to log the gauge above and
    // track how far we're behind in our metrics.
    Duration::from_secs(5)
});
```

**This 5-second interval is ONLY used when**:
1. The scheduler is **already behind** (has jobs past due)
2. It's used for **logging metrics** about how far behind the scheduler is

**Normal operation** uses:
1. **Database subscriptions** that wake immediately when relevant data changes
2. **Direct timer waits** until the next job's scheduled time

### Implications for Workflow Performance

The scheduler itself adds minimal latency because:
1. When a workflow step completes and writes to the DB, the subscription wakes the scheduler immediately
2. The scheduler doesn't wait for a polling interval - it's event-driven
3. The overhead comes from the workflow/workpool layer, not the core scheduler

**Verified**: The inter-step gap is NOT caused by scheduler polling. It comes from:
- Multiple mutations in the workflow/workpool coordination
- Journal replay on each workflow handler invocation
- Workpool main loop processing (segment-based, 100ms granularity)
