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

### ⚠️ Source Code Cross-Reference (Required for Maintenance)

**IMPORTANT**: Before updating this documentation or investigating workflow issues,
clone the component source code into the `attic/` directory for cross-reference:

```bash
# From repository root
mkdir -p attic/workflow attic/workpool

# Clone workflow component
git clone https://github.com/get-convex/workflow.git attic/workflow/workflow

# Clone workpool component
git clone https://github.com/get-convex/workpool.git attic/workpool/workpool
```

**Key Files to Cross-Reference**:

| Component | File | Purpose |
|-----------|------|---------|
| Workflow | `src/client/workflowMutation.ts` | Handler execution, journal replay |
| Workflow | `src/client/step.ts` | Step executor, journal size tracking |
| Workflow | `src/component/journal.ts` | Journal load/save, `MAX_JOURNAL_SIZE` |
| Workflow | `src/component/pool.ts` | Workpool integration, `DEFAULT_MAX_PARALLELISM=25` |
| Workpool | `src/component/loop.ts` | Main loop, recovery, segment scheduling |
| Workpool | `src/component/shared.ts` | Constants: `SEGMENT_MS=100`, `DEFAULT_MAX_PARALLELISM=10` |
| Workpool | `src/component/kick.ts` | Loop wake-up mechanism |

**Verification Checklist** when updating this doc:
- [ ] Pulled latest source from GitHub repos
- [ ] Verified line numbers in source references
- [ ] Checked for new constants or behavior changes
- [ ] Tested claims with [workflow-testing harness](../../../experiments/workflow-testing/)

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

### Root Cause: Scheduler Hops, Not Database Latency

**Key insight**: The dominant source of workflow overhead is **Convex scheduler latency**, not
database operations. Each `ctx.scheduler.runAfter(0, ...)` call adds platform latency (typically
hundreds of milliseconds, up to 1-3 seconds under load).

Each workflow step requires **5 scheduler hops**:

```
┌─────────────────────────────────────────────────────────────────┐
│ HOP 1: Workflow handler → kickMainLoop() → scheduler.runAt()    │
│        Enqueues step to workpool, kicks main loop               │
│        Source: kick.ts:68                                       │
└─────────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────────┐
│ HOP 2: loop.main → beginWork() → scheduler.runAfter(0, worker)  │
│        Main loop finds pending work, schedules actual execution │
│        Source: loop.ts:567-569                                  │
└─────────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────────┐
│ HOP 3: Worker executes → scheduler.runAfter(0, complete)        │
│        Step executes, then schedules completion                 │
│        Source: worker.ts:31, 69                                 │
└─────────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────────┐
│ HOP 4: complete.complete → pool.onComplete → kickMainLoop()     │
│        Completion processed, re-enqueues workflow handler       │
│        Source: pool.ts:183-184, kick.ts:68                      │
└─────────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────────┐
│ HOP 5: loop.main → beginWork() → scheduler.runAfter(0, handler) │
│        Main loop picks up workflow handler, schedules it        │
│        Source: loop.ts:567-569                                  │
└─────────────────────────────────────────────────────────────────┘
```

**Why this matters**: 5 hops × 200-500ms each = 1-2.5s minimum per step, regardless of how fast
your actual step code runs. This explains why trivial operations still take seconds.

### kick.ts Short-Circuit Optimization

The workpool has a short-circuit optimization in `kick.ts:45-49`:

```typescript
if (runStatus.state.segment <= toSegment(Date.now() + SECOND)) {
  console.debug(`[${source}] main is scheduled to run soon enough`);
  return next;
}
```

**Behavior**: If the main loop is already scheduled to run within 1 second, kicks are skipped.
This reduces redundant scheduling but means work may wait up to 1 second before being picked up.

**(Tracked: cvx-v5zc, cvx-dwge)**

### ⚠️ Important: Per-Step Overhead vs Inter-Iteration Gap

**Per-step overhead** (~100-300ms): The database operation time shown above. This is the
minimum overhead for each `step.run*()` call through the workpool.

**Inter-iteration gap** (~1.2-1.5s typical, up to 6s): The time between the END of one
workflow handler invocation and the START of the next. This is larger because it includes:

1. **onComplete processing**: Update journal, re-enqueue workflow (~50-100ms)
2. **Scheduler wake-up**: DB subscription triggers scheduler (~50-200ms)
3. **Workpool segment granularity**: 100ms time slices mean minimum ~100ms scheduling delay
4. **Journal load query**: Fetches ALL steps for workflow (grows O(N) with step count)
5. **Replay overhead**: Handler replays all cached steps from beginning

**Journal Load Scaling Issue**: Each workflow handler invocation runs this query:
```typescript
for await (const entry of ctx.db
  .query("steps")
  .withIndex("workflow", (q) => q.eq("workflowId", workflowId))) {
  journalEntries.push(entry);
}
```

For a workflow with 50 steps, this fetches all 50 entries on every re-invocation.
This O(N) cost accumulates over long-running workflows.

**Scheduler Fallback**: When the DB subscription wake-up is missed (e.g., after complex
tool executions), the Convex scheduler falls back to a 5-second polling interval. This
explains occasional ~6 second gaps observed in production.

### Overhead Comparison

| Execution Pattern | Per-Step Overhead | Inter-Iteration Gap | Use Case |
| --- | --- | --- | --- |
| **Direct action call** | ~0ms | N/A | Simple one-shot operations |
| **ctx.scheduler.runAfter** | ~20-50ms | N/A | Fire-and-forget async |
| **Workpool enqueue** | ~100-200ms | N/A | Rate-limited async with retry |
| **Workflow step** | ~100-300ms | ~1.2-1.5s (up to 6s) | Durable, resumable operations |

**Note**: Inter-iteration gap is measured from the END of one handler invocation to the
START of the next. It includes scheduler wake-up, journal load, and replay overhead.

### Why 4-5x Slower for Short Steps

For a step that takes 1 second to execute:

- **Direct call**: 1s
- **Workflow step**: 1s + ~200ms DB overhead + ~1.2s inter-iteration gap = ~2.4s

For a workflow with 5 iterations, each with an LLM call (5s) + tool call (1s):

- **Direct inline**: 5 × (5s + 1s) = 30s
- **Workflow**: 5 × (6s + 1.2s inter-iteration gap + 0.2s step overhead) = ~37s + journal replays

**Real-world measurement** (from arena project, 9-iteration workflow):
- Total workflow time: 203 seconds
- Raw LLM API time: 43 seconds (21%)
- Infrastructure overhead: 160 seconds (79%)

**The overhead has multiple components**:
- **Per-step DB operations**: Relatively fixed ~100-300ms
- **Inter-iteration gap**: ~1.2-1.5s typical, increases with scheduler fallback
- **Journal replay**: Grows O(N) with iteration count
- **Accumulated**: For N iterations, total overhead ≈ N × (inter-iteration gap + step overhead)

**Performance guidance**:
- For short steps (< 1s): overhead dominates → 2-5x slower
- For long steps (> 10s): overhead less significant → ~1.5-2x slower
- For many iterations (> 20): journal replay becomes noticeable

### Sources of Unmeasured/Unaccounted Overhead

In typical workflow timing measurements, some `step.run*()` calls are not instrumented:

| Step Call | Purpose | Typical Location | Overhead |
| --- | --- | --- | --- |
| `step.runQuery(getStatus)` | Cancellation check | Before LLM call | ~100-300ms |
| `step.runMutation(persist*)` | Save state | After tool execution | Measured |
| `step.runQuery(getResult)` | Idempotency check | Before tool execution | ~100-300ms |
| `step.runQuery(getResult)` | Timing/result fetch | After tool execution | **Variable** (Bug: cvx-vjh4, Outliers: cvx-2t3o) |

**Large payload effect**: The timing/result query returns the full tool result. For tools
returning large payloads (e.g., web search results, API responses), this query takes longer
because the entire result must be serialized through the workpool round-trip.

**Observed pattern** (from arena project):
- Small payloads (stock prices): ~2-3s unaccounted time per iteration
- Large payloads (web search, earnings data): ~6-8s unaccounted time per iteration

**Root cause**: Each `step.run*()` call incurs workpool overhead even for simple queries.
The overhead varies with payload size due to serialization and DB write costs.

**Mitigation**: Design step return values to be small (IDs, status flags). Store large
results directly in the database and return only references. **(Verification: cvx-g6ac)**

### Detailed Overhead Breakdown (From Arena Project Analysis)

A comprehensive analysis of a 9-iteration workflow (203 seconds total) reveals:

| Category | Time | % of Total | Notes |
| --- | --- | --- | --- |
| **Raw LLM API Time** | 43s | 21.0% | Actual `generateText()` call duration |
| **LLM Step Overhead** | 16s | 7.8% | Workflow overhead for LLM calls |
| **Persistence** | 18s | 9.1% | Database write operations |
| **Tool Execution** | 4s | 2.1% | Actual tool work |
| **Step Wall Clock** | 38s | 18.6% | Total measured step time |
| **Inter-iteration Gaps** | 12s | 6.1% | Workpool queue time between iterations |
| **Unaccounted** | 45s | 22.0% | Time not attributed to measured categories |
| **Unmeasured** | 31s | 15.4% | Gap between total time and sum of measurements |

**Key insight**: ~37% of workflow time (unaccounted + unmeasured) is not captured in typical
timing instrumentation. **(Investigation: cvx-5kc4)** This comes from:

1. **Unmeasured step.run*() calls**: Cancellation checks, idempotency queries (~2-4s/iteration)
2. **Journal load time**: Grows O(N), not typically instrumented (~50-200ms/iteration)
3. **Message/state reconstruction**: Rebuilding conversation history from journal
4. **Workpool loop coordination**: Segment-based scheduling overhead

### Step Count and Workflow Invocation Correlation

**Key relationship**: `totalSteps ≈ totalWorkflowInvocations` (minus batched parallel steps)

For a typical single-tool-per-iteration workflow:
- **7-10 steps per iteration** (observed average: 7.5)
- Steps per iteration include:
  1. `getExperimentRunStatus` - Cancellation check
  2. `decideNextStep` - LLM call
  3. `persistAssistantTurn` - Save assistant message
  4. `getToolResult` - Idempotency check
  5. `executeToolCall` - Tool execution
  6. `getToolResult` - Fetch result for timing
  7. `logIterationTiming` - Persist timing event

**Total invocations** = (steps_per_iteration × iterations) - batched_steps

For a 9-iteration workflow with 60 total steps: 60 steps / 9 iterations = 6.7 steps/iteration

**Why this matters for overhead**:
- Each NEW step causes a workflow handler re-invocation
- Parallel steps (via `Promise.all`) share a single re-invocation
- More steps = more journal replays = more accumulated overhead

### Inter-Iteration Gap Variability

**Typical range**: 1.2-1.5s (median ~1.2s)
**Outlier range**: Up to 6s (observed after complex tools)
**Average variance**: 1.2s to 3.5s depending on tool complexity

**Factors affecting gap variability**:

1. **Tool complexity**: Simple queries → ~1.2s, Complex multi-step tools → ~3-6s
2. **Payload size**: Large tool results take longer to serialize through workpool
3. **Database load**: Concurrent workflows competing for DB resources
4. **Workpool segment timing**: 100ms granularity can add up to 100ms jitter

**Observed pattern** (DeepSeek run):
- After `stock_prices_historical`: ~1.1s gap
- After `technical_indicators`: ~0.7s gap
- After `llm_filtered_web_search`: **~6s gap** (scheduler fallback)

The ~6s gaps occur specifically after `llm_filtered_web_search` because this tool involves
multiple LLM + API calls and takes longer to complete, potentially causing the DB subscription
wake-up to be missed. **(Investigation: cvx-fcqi, Test case: cvx-1l22)**

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

1. **Journal Size Limit (Recommended)**: 1 MiB total for step arguments + return values
   - From README: "Steps can only take in and return a total of 1 MiB of data"
   - This is a recommended limit, not a hard cutoff at exactly 1 MiB
   - Workaround: Store large data in DB, pass IDs

2. **Journal Size Limit (Hard)**: 8 MiB (`MAX_JOURNAL_SIZE` in shared.ts)
   - This is the hard limit enforced in `journal.load()` and `step.ts`
   - Exceeding this causes workflow to fail with "journal size limit exceeded"
   - The 8 MiB limit exists to stay within mutation read bounds

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

### 7. AI SDK Loop Exit Behavior with Workflow Tools

**Key Issue**: When using Vercel AI SDK's `generateText` with workflow tools, the loop
exits after EVERY tool call because workflow tools lack an `execute` stub.

**Root cause** (from AI SDK source):
```typescript
// ai/packages/ai/src/generate-text/execute-tool-call.ts:35-37
if (tool?.execute == null) {
  return undefined;  // ← Workflow tools hit this, causing no output
}

// ai/packages/ai/src/generate-text/generate-text.ts:822-831
} while (
  ((clientToolCalls.length > 0 &&
    clientToolOutputs.length === clientToolCalls.length) ||  // ← Fails when outputs = 0
    pendingDeferredToolCalls.size > 0) &&
  !(await isStopConditionMet({ stopConditions, steps }))
);
```

**Implications**:
- Each tool call becomes a separate iteration
- No tool batching (even if LLM requests multiple tools)
- Iteration count = number of tool calls (not number of LLM decisions)

**Potential optimization** (breaks durability):
- Add execute stubs to workflow tools
- Allow AI SDK to batch tool calls
- Trade-off: Crash during tool batch loses all results in that batch

* * *

## Open Research Questions

### Infrastructure Improvements

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

6. **Direct Mutation Calls vs Scheduler** (cvx-387z): Could some `ctx.scheduler.runAfter(0, ...)`
   calls be replaced with `ctx.runMutation()` to reduce scheduler hops? For example:
   ```typescript
   // Current (adds scheduler latency):
   await ctx.scheduler.runAfter(0, internal.complete.complete, {...});

   // Potential (no scheduler hop, but longer transaction):
   await ctx.runMutation(internal.complete.complete, {...});
   ```
   Trade-off: Longer transaction times vs reduced scheduler latency. Needs benchmarking.

7. **Workpool Bypass for Trivial Steps**: For steps that execute quickly (simple queries,
   mutations), the workflow could execute them inline rather than through the workpool,
   eliminating 5 scheduler hops entirely.

### Active Investigations (Tracked Beads)

| Bead ID | Priority | Issue | Status |
| --- | --- | --- | --- |
| ~~cvx-5kc4~~ | ~~P1~~ | ~~Investigate 37% unaccounted/unmeasured time~~ | ✅ ANSWERED: Deep instrumentation achieved 91.9% accountability |
| cvx-fcqi | P1 | DB subscription wake-up failure after complex tools (6s gaps) | Open - needs long-running step tests |
| cvx-g6ac | P2 | Verify large payload overhead claim | Open - needs payload size variance tests |
| ~~cvx-1l22~~ | ~~P2~~ | ~~Add test case for `llm_filtered_web_search` pattern~~ | ✅ DONE: `external-engineer-issues.test.ts` |
| cvx-2t3o | P2 | Step overhead P95 outliers (5.8s vs 1.2s typical) | Open - needs variance analysis |
| cvx-vjh4 | P2 | step.runQuery latency bug - full result through workpool | Open - needs query vs action comparison |
| ~~cvx-d3nl~~ | ~~P2~~ | ~~Investigate journal load time scaling~~ | ✅ ANSWERED: Only 1.4% of time - NOT main issue |
| ~~cvx-ox3h~~ | ~~P2~~ | ~~Investigate workpool coordination overhead~~ | ✅ ANSWERED: 56.3% = call(36%) + return(20.3%) |
| ~~cvx-w9ev~~ | ~~P2~~ | ~~Investigate step completion handling~~ | ✅ ANSWERED: 20.3% step return overhead |

### Key Findings from Instrumented Workflow Analysis

The fully-instrumented workflow (cvx-88z7) answered multiple investigation questions:

| Question | Answer |
| --- | --- |
| What causes 37% unaccounted time? | Lack of deep instrumentation. With proper instrumentation: 91.9% accountability |
| Is journal replay the bottleneck? | NO - only 1.4% of time. Workpool is the bottleneck (56.3%) |
| What is workpool coordination overhead? | 56.3% = Step Call (36.0%) + Step Return (20.3%) |
| What is step completion overhead? | 20.3% (~936ms per step) |

### Remaining Investigations

1. **cvx-fcqi: 6s Gaps** - Need tests with long-running steps to reproduce scheduler fallback
2. **cvx-g6ac: Payload Overhead** - Need tests with varying payload sizes
3. **cvx-2t3o: P95 Outliers** - Need variance analysis across many runs
4. **cvx-vjh4: runQuery Latency** - Need to compare runQuery vs runAction overhead

New actions added to support these tests:
- `simulateLlmFilteredWebSearch`: Multi-phase action (search → LLM filter passes → large result)
- `simulateSimpleTool`: Fast, small payload action for comparison

### Documentation & Testing Harness Tasks

| Bead ID | Priority | Task |
| --- | --- | --- |
| ~~cvx-qmwt~~ | ~~P2~~ | ~~Cross-reference workflow-testing harness against attic/workflow examples~~ | ✅ DONE: See section below |
| ~~cvx-ndxf~~ | ~~P3~~ | ~~Add onComplete handler pattern to workflow-testing harness~~ | ✅ DONE: `startVariableDurationWithOnComplete`, `handleWorkflowComplete` |
| ~~cvx-5i6y~~ | ~~P3~~ | ~~Add workflow event testing (awaitEvent/sendEvent) to testing harness~~ | ✅ DONE: `eventBasedWorkflow`, `sendApprovalEvent` |
| ~~cvx-h63b~~ | ~~P3~~ | ~~Document unit test vs integration test approaches~~ | ✅ DONE: [README.md#testing-approaches](../../../experiments/workflow-testing/README.md#testing-approaches) |

### Workflow-Testing Harness Cross-Reference Analysis

Comparing `docs/experiments/workflow-testing/` against `attic/workflow/workflow/example/`:

**Patterns we follow correctly:**
- `workflow.define()` with proper args/returns validators
- `step.run*` methods for durable step execution
- Explicit return types to break type inference cycles
- Status polling via `workflow.status()`

**Gaps identified (tracked as beads):**
1. ~~**Missing onComplete pattern** (cvx-ndxf)~~: ✅ DONE - Added `startVariableDurationWithOnComplete`
   mutation and `handleWorkflowComplete` handler demonstrating this pattern.

2. **No retry configuration**: Official example shows `workpoolOptions: { retryActionsByDefault: true }`
   and per-step retry overrides. Testing harness doesn't configure retries.

3. ~~**Missing event tests** (cvx-5i6y)~~: ✅ DONE - Added `eventBasedWorkflow` with
   `step.waitForEvent()` and `sendApprovalEvent` mutation demonstrating the event pattern.

4. ~~**Test approach documentation** (cvx-h63b)~~: ✅ DONE - See
   [README.md Testing Approaches](../../../experiments/workflow-testing/README.md#testing-approaches)
   for comprehensive comparison of unit tests (fake timers) vs integration tests (live Convex).

**Official example patterns to adopt:**
```typescript
// onComplete handler pattern
await workflow.start(ctx, internal.example.myWorkflow, args, {
  onComplete: internal.example.handleOnComplete,
  context: { customData: "passed through" },
});

// Retry configuration
const workflow = new WorkflowManager(components.workflow, {
  workpoolOptions: {
    retryActionsByDefault: true,
    defaultRetryBehavior: { maxAttempts: 3, initialBackoffMs: 100, base: 2 },
  },
});

// Event-based coordination
await ctx.awaitEvent({ name: "userApproval" });
await workflow.sendEvent(ctx, { name: "userApproval", workflowId, value: true });
```

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

### Workflow vs Inline Mode Trade-offs

For AI agent loops (LLM + tool calls), there are two execution patterns:

**Workflow Mode** (durable):
- Each iteration: journal load → LLM call → tool call → journal save
- Inter-iteration gap: ~1.2-1.5s typical (up to 6s with scheduler fallback)
- Total infrastructure overhead: ~79% in real measurements (arena project)
- Crashes: workflow resumes from last completed step
- Suitable for: production, long-running, must-complete operations

**Inline Mode** (AI SDK loop):
- Continuous execution in single function invocation
- No inter-step persistence or scheduling overhead
- ~10x faster for many-iteration workflows
- Crashes: entire run lost, must restart from beginning
- Suitable for: development, testing, short operations (< 10 min)

**Key insight**: The durability guarantee adds significant overhead. Choose inline mode
when you can tolerate restarts; choose workflow mode when completion is critical.

### Measuring Workflow Overhead Accurately

**⚠️ Common measurement pitfalls** (documented from arena project debugging):

1. **Wrong timestamp source**: Use precise start/end timestamps, not event timestamps
   ```typescript
   // BAD: Using event.timestamp from DB
   const gap = events[i+1].timestamp - events[i].timestamp;

   // GOOD: Using captured timestamps in event metadata
   const gap = events[i+1].metadata.iterationStartTimestamp - events[i].metadata.iterationEndTimestamp;
   ```

2. **Multi-workflow interference**: When measuring gaps across parallel workflows, iterations
   from different workflows get interleaved, producing artificially large gaps
   ```
   // BAD measurement:
   Workflow A iter 1 → Workflow B iter 1 → gap appears as 16s

   // GOOD measurement:
   Single workflow run, gaps are ~1.2s
   ```

3. **Excluding LLM time**: A common bug is capturing iteration start AFTER the LLM call
   ```typescript
   // BAD: iterationStartTime set AFTER LLM call
   const llmResult = await step.runAction(decideNextStep, args);
   const iterationStartTime = Date.now();  // Wrong! LLM time excluded

   // GOOD: iterationStartTimestamp set BEFORE LLM call
   const iterationStartTimestamp = Date.now();  // Correct
   const llmResult = await step.runAction(decideNextStep, args);
   ```

4. **Conflating different overhead types**: Inter-iteration gap (~1.2s) is NOT the same as
   total infrastructure overhead (~79%). The gap is just one component.

**Recommended measurement approach**:
```typescript
// Phase 1: Capture TRUE iteration start
const iterationStartTimestamp = Date.now();

// ... do LLM call and tool execution ...

// Phase 2: Capture iteration end
const iterationEndTimestamp = Date.now();

// Inter-iteration gap = next iteration start - this iteration end
```

**Key metrics to track**:
- **accountabilityPct**: sum(measured times) / total time (should be 95-100%)
- **avgInterIterationGapMs**: typical ~1.2-1.5s, outliers up to 6s
- **avgStepOverheadMs**: workflow overhead per tool call (~100-300ms)

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
SEGMENT_MS = 100;                    // Time granularity (100ms scheduling quantum)
DEFAULT_MAX_PARALLELISM = 10;        // Default concurrent work for raw workpool

// Workpool (loop.ts)
RECOVERY_THRESHOLD_MS = 5 * MINUTE;  // Age for recovery
RECOVERY_PERIOD_SEGMENTS = 1 minute; // Recovery check interval
CURSOR_BUFFER_SEGMENTS = 30 seconds; // Out-of-order buffer

// Workflow (pool.ts)
DEFAULT_MAX_PARALLELISM = 25;        // Default for workflows (overrides workpool default)
DEFAULT_RETRY_BEHAVIOR = {
  maxAttempts: 5,
  initialBackoffMs: 500,
  base: 2,
};

// Convex Scheduler (crates/common/src/knobs.rs)
SCHEDULED_JOB_EXECUTION_PARALLELISM = 10;  // Max concurrent scheduled jobs at backend level
```

**⚠️ Parallelism Confusion**: There are THREE different parallelism limits:
1. **Workpool maxParallelism** (default 10): How many work items the workpool processes concurrently
2. **Workflow maxParallelism** (default 25): Overrides workpool default for workflow steps
3. **Scheduler parallelism** (default 10): How many `ctx.scheduler.runAfter` jobs run concurrently

The workflow's 25-step parallelism is bounded by the scheduler's 10-job limit, so actual
concurrent execution is min(25, 10) = 10 steps unless scheduler parallelism is increased.

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

### Why ~6s Gaps Occur After Complex Tools

**Observed pattern**: After `llm_filtered_web_search` or other complex multi-step tools,
inter-iteration gaps can jump from ~1.2s to ~6s.

**Root cause analysis** (requires further investigation - see cvx-fcqi):

1. **Long-running tools hypothesis**: Complex tools that involve multiple LLM calls and API
   requests take longer to complete. During this extended execution:
   - The workpool's internal state may not be updated frequently
   - DB subscription invalidations might be missed
   - The scheduler falls back to 5s polling

2. **Workpool segment boundary hypothesis**: The workpool operates on 100ms segments.
   If a completion event arrives just after a segment boundary was processed, it must
   wait for the next loop iteration.

3. **Concurrent workflow contention hypothesis**: Multiple workflows competing for the
   same workpool resources may cause delays.

**Testing recommendation**: Use the [workflow-testing harness](../../../experiments/workflow-testing/)
to reproduce this pattern with controlled tool durations and measure the correlation
between tool execution time and subsequent gap length.
