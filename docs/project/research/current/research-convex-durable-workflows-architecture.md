# Research Brief: Convex Backend Architecture for Durable Workflows

**Last Updated**: 2026-01-10

**Status**: Complete

**Convex Backend Revision**: ac3c9dd (January 9, 2026)

**Related**:

- [research-convex-backend-limits-implementation.md](research-convex-backend-limits-implementation.md) —
  Source code analysis of limits and configurability
- [research-convex-db-limits-best-practices.md](../../../general/research/current/research-convex-db-limits-best-practices.md) —
  User-facing limits and best practices

* * *

## Executive Summary

This research brief analyzes how the Convex backend architecture supports durable workflows,
specifically validating the design decisions in a production workflow migration spec against
the actual source code constraints.

**Key Findings**:

1. **All limits referenced in the workflow spec are accurate** and verified against
   `crates/common/src/knobs.rs` (revision ac3c9dd)

2. **The architecture is well-suited for durable workflows** - the combination of
   10-minute action timeout, 1-second mutation timeout, and configurable concurrency
   provides a solid foundation for checkpoint-based orchestration

3. **The "fire-and-forget" chain pattern is correct** - the `scheduler.runAfter` mechanism
   combined with workflow state journaling enables long-running processes that span days

4. **Memory constraints require careful runtime selection** - the 64 MB V8 heap limit
   necessitates `"use node";` directive for LLM-heavy actions (512 MB)

5. **Pass-by-reference patterns are essential** - the 1 MiB document limit and function
   result limits require storing large payloads in tables rather than flowing through
   workflow steps

**Research Questions**:

1. Are the platform limits cited in the workflow spec accurate?
2. How does the backend architecture support long-running durable workflows?
3. What constraints must workflow implementations respect?
4. How do the limits affect architectural decisions for workflows?

* * *

## Limit Verification Against Source Code

### Verified Limits Table

All limits were verified against Convex backend revision ac3c9dd (January 9, 2026).

| Limit | Spec Value | Source Code Value | Source Location | Status |
|-------|------------|-------------------|-----------------|--------|
| **Action timeout** | 10 minutes | 600 seconds | `knobs.rs:119-120` | ✅ Verified |
| **Mutation user timeout** | 1 second | 1 second | `knobs.rs:692-693` | ✅ Verified |
| **V8 heap (Convex Runtime)** | 64 MB | 64 MB (1 << 26) | `knobs.rs:849-850` | ✅ Verified |
| **Node.js Lambda memory** | 512 MB | 512 MB | `knobs.rs:1119-1120` | ✅ Verified |
| **Log lines per execution** | 256 | 256 | `isolate/helpers/mod.rs:29` | ✅ Verified |
| **Array elements (return)** | 8,192 | 8,192 | `value/src/array.rs:26` | ✅ Verified |
| **Document size** | 1 MiB | 1 MiB (1 << 20) | `document.rs:101` | ✅ Verified |
| **Document nesting** | N/A | 16 levels | `document.rs:102` | ✅ Verified |
| **Scheduled functions/mutation** | 1,000 | 1,000 | `knobs.rs:254-255` | ✅ Verified |
| **Function args size** | 8 MiB (docs) | 16 MiB | `knobs.rs:223-224` | ✅ Code more permissive |
| **Function result size** | 8 MiB (docs) | 16 MiB | `knobs.rs:228-229` | ✅ Code more permissive |

### Workflow-Specific Limits (External Package)

The following limits are imposed by the `@convex-dev/workflow` package, not the core backend:

| Limit | Value | Rationale |
|-------|-------|-----------|
| **Workflow journal** | 8 MiB | Total serialized state - subset of function result limit |
| **Step data** | 1 MiB | Args + return per step - matches document limit |

These are conservative limits within the backend's capabilities, providing safety margin
for journal serialization overhead.

* * *

## Architectural Analysis

### How Convex Supports Durable Workflows

The Convex backend provides several key mechanisms that enable durable workflow patterns:

#### 1. Separation of Queries, Mutations, and Actions

| Function Type | Timeout | Memory | Transactional | Use Case |
|---------------|---------|--------|---------------|----------|
| **Query** | 1s user / 15s system | 64 MB | Yes (read-only) | State reads, checksums |
| **Mutation** | 1s user / 15s system | 64 MB | Yes (read-write) | State updates, journaling |
| **Action** | 10 minutes | 64 MB / 512 MB | No | External calls, LLM, I/O |

**Workflow implications**:
- Workflow handlers are treated as mutations (journaling state)
- Long-running work must be in actions called via `step.runAction()`
- The 1-second mutation limit constrains workflow replay overhead

#### 2. Scheduler System

**Source**: `crates/model/src/scheduled_jobs/mod.rs`, `crates/common/src/knobs.rs:254-320`

| Setting | Value | Source |
|---------|-------|--------|
| Max scheduled per mutation | 1,000 | `TRANSACTION_MAX_NUM_SCHEDULED` |
| Single job args | 1 MiB | `MAX_SCHEDULED_JOB_ARGUMENT_SIZE_BYTES` |
| Total scheduled args | 16 MiB | `TRANSACTION_MAX_SCHEDULED_TOTAL_ARGUMENT_SIZE_BYTES` |
| Job retention | 7 days | `SCHEDULED_JOB_RETENTION` |
| Execution parallelism | 10 | `SCHEDULED_JOB_EXECUTION_PARALLELISM` |

**Workflow implications**:
- Fire-and-forget patterns (Day N → Day N+1) use scheduler
- Each workflow step can schedule follow-up work
- Retention policy matters for long-running chains (7 days default)

#### 3. OCC (Optimistic Concurrency Control)

**Source**: `crates/common/src/knobs.rs:146-155`

| Setting | Value | Source |
|---------|-------|--------|
| Max retries | 4 | `UDF_EXECUTOR_OCC_MAX_RETRIES` |
| Initial backoff | 10ms | `UDF_EXECUTOR_OCC_INITIAL_BACKOFF_MS` |
| Max backoff | 2,000ms | `UDF_EXECUTOR_OCC_MAX_BACKOFF_MS` |

**Workflow implications**:
- Concurrent workflow steps writing to same documents will contend
- Namespacing by workflow ID / step index reduces contention
- Idempotency keys are essential for retry safety

### Key Architectural Patterns Enabled

#### Pattern 1: Checkpoint-Based Orchestration

The workflow engine exploits the mutation + action separation:

```
Workflow Handler (Mutation, 1s limit)
    │
    ├── step.runQuery() → Read state (checkpointed)
    ├── step.runMutation() → Update state (checkpointed)
    └── step.runAction() → External work (10 min limit, checkpointed)
         │
         └── [If timeout/crash, workflow resumes from last checkpoint]
```

**Backend support**:
- Mutations provide ACID guarantees for journal writes
- Actions provide extended timeout for external work
- Scheduler enables continuation after checkpoint

#### Pattern 2: Fire-and-Forget Chains

For 300-day backtests, the spec correctly identifies that accumulating 300 steps would
exceed replay limits. The fire-and-forget pattern works because:

```
Day 1 Workflow                    Day 2 Workflow
┌──────────────────┐              ┌──────────────────┐
│ Do work          │              │ Do work          │
│ Finalize         │              │ Finalize         │
│ Schedule Day 2   │──────────────│ Schedule Day 3   │───► ...
│ EXIT             │              │ EXIT             │
└──────────────────┘              └──────────────────┘
     O(1) journal                      O(1) journal
```

**Backend support**:
- `scheduler.runAfter(0, ...)` creates independent job
- New workflow gets fresh journal (O(1) not O(N))
- `workflowId` tracking in DB enables cancellation

#### Pattern 3: Pass-by-Reference

Large payloads (LLM responses, tool results) cannot flow through workflow steps due to
journal limits. The pattern stores in DB, passes IDs:

```typescript
// Inside action: write to DB, return ID
const toolResultId = await ctx.runMutation(internal.saveToolResult, {
  result: largePayload  // Goes to toolResults table
});
return toolResultId;  // Only ID flows through workflow
```

**Backend support**:
- Document size: 1 MiB per document (can split across multiple)
- Function result: 16 MiB (sufficient for IDs + metadata)
- Workflow journal: 8 MiB (workflow package limit)

### Constraint Interactions

The following constraint interactions are critical for workflow design:

| Constraint A | Constraint B | Interaction |
|--------------|--------------|-------------|
| 1s mutation timeout | Workflow replay | Steps > 50-100 may timeout on replay |
| 64 MB V8 heap | LLM responses | Must use `"use node";` for LLM actions |
| 256 log lines | Long workflows | Log milestones only, not iterations |
| 8,192 array limit | Message history | Cap `buildMessagesForLlm` at ~1000 |
| 1 MiB document | Tool results | Truncate at 900 KB, use file storage for larger |

* * *

## Spec Validation Results

### Validated Design Decisions

| Decision | Rationale | Backend Support |
|----------|-----------|-----------------|
| **All tools as child workflows** | Uniform handling regardless of duration | ✅ Actions + workflows both supported |
| **LLM actions require Node.js** | 512 MB vs 64 MB for responses | ✅ `AWS_STATIC_LAMBDA_MEMORY_LIMIT_MB` = 512 |
| **Eval batch size = 20** | 2 steps × 20 = 40, under 50-step limit | ✅ Stays within replay overhead |
| **Fire-and-forget chain** | O(1) journal per day, not O(300) | ✅ Scheduler enables independent jobs |
| **Pass-by-reference for results** | Tool results may exceed step limits | ✅ DB supports 1 MiB documents |
| **Record result in child workflow** | Saves 1 step per datapoint | ✅ Mutations work inside workflows |

### Potential Issues Identified

| Issue | Risk | Mitigation |
|-------|------|------------|
| **Workflow journal 8 MiB limit** | Not enforced by backend directly | Workflow package responsibility |
| **256 log line limit** | Silent truncation | Spec correctly notes milestone logging |
| **Nested action timeout** | ~5 min observed vs 10 min documented | Spec addresses via "leaf action" requirement |
| **OCC contention on batch updates** | Multiple workflows writing same table | Spec uses namespacing by workflow/datapoint |

### Limits Summary for Workflow Implementers

**Hard Limits (Cannot Change)**:
- Action timeout: 10 minutes per step
- Mutation timeout: 1 second for workflow handler
- Document size: 1 MiB for tool results
- Array elements: 8,192 for query returns

**Configurable Limits (Self-Hosted)**:
- Concurrency: `APPLICATION_MAX_CONCURRENT_*` vars
- Memory: `ISOLATE_MAX_USER_HEAP_SIZE`, `AWS_STATIC_LAMBDA_MEMORY_LIMIT_MB`
- Timeouts: `DATABASE_UDF_USER_TIMEOUT_SECONDS`, `ACTIONS_USER_TIMEOUT_SECS`
- Scheduled: `SCHEDULED_JOB_EXECUTION_PARALLELISM`

* * *

## Workflow-Specific Backend Features

### Scheduled Job System Details

The backend's scheduled job system (`crates/model/src/scheduled_jobs/`) provides:

1. **Durable scheduling**: Jobs survive restarts
2. **Backoff on failure**: Configurable via `SCHEDULED_JOB_INITIAL_BACKOFF`, `SCHEDULED_JOB_MAX_BACKOFF`
3. **Garbage collection**: Completed jobs cleaned after `SCHEDULED_JOB_RETENTION` (7 days)
4. **Parallelism control**: `SCHEDULED_JOB_EXECUTION_PARALLELISM` (default 10)

### Cron Job Integration

For workflow cleanup, the backend supports cron jobs (`crates/model/src/cron_jobs/`):

- UTC hour/minute scheduling
- Automatic retries with backoff
- Log retention (5 logs per cron job by default)

### Transaction Isolation

Workflows benefit from Convex's transaction model:

- **Serializable isolation**: Mutations see consistent snapshots
- **Automatic retry on OCC conflict**: Up to 4 retries with backoff
- **Real-time subscriptions**: UI can observe workflow progress via queries

* * *

## Recommendations

### For Workflow Implementers

1. **Respect the 50-step guideline**: Keep workflow steps under 50 to avoid replay timeout
2. **Use pass-by-reference**: Store large payloads in DB, pass only IDs through steps
3. **Select runtime carefully**: Use `"use node";` for any action processing large data
4. **Log sparingly**: 256 lines total - log start, complete, errors only
5. **Implement idempotency**: Use `toolCallId` or similar keys to detect replay
6. **Namespace writes**: Use workflow/datapoint IDs to avoid OCC contention

### For Self-Hosted Deployments

Operators can tune these knobs for workflow-heavy workloads:

```bash
# Increase concurrency for parallel workflows
export APPLICATION_MAX_CONCURRENT_MUTATIONS=64
export SCHEDULED_JOB_EXECUTION_PARALLELISM=20

# Extend timeouts if needed (not recommended for cloud parity)
export ACTIONS_USER_TIMEOUT_SECS=900  # 15 minutes

# Increase memory for LLM-heavy workloads
export AWS_STATIC_LAMBDA_MEMORY_LIMIT_MB=1024

# Tune OCC for high-contention scenarios
export UDF_EXECUTOR_OCC_MAX_RETRIES=8
export UDF_EXECUTOR_OCC_MAX_BACKOFF_MS=5000
```

* * *

## Conclusion

The Convex backend architecture is well-suited for durable workflow patterns. The combination
of:

- **Transactional mutations** for state journaling
- **Long-running actions** for external work (10 min timeout)
- **Scheduler system** for continuation and fire-and-forget
- **Document storage** for pass-by-reference patterns

...provides a solid foundation for implementing complex, long-running workflows that can
survive crashes, handle hour-long operations, and scale to thousands of concurrent items.

The workflow spec analyzed correctly interprets these constraints and designs around them.
All limits cited are accurate against the source code (revision ac3c9dd).

**Key insight**: The apparent "limitation" of 1-second mutation timeout is actually a
feature - it forces workflow handlers to be lightweight orchestrators that delegate real
work to actions, ensuring predictable replay performance.

* * *

## Appendix A: Source Code References

### Timeout Configuration
```rust
// crates/common/src/knobs.rs:119-120
pub static ACTION_USER_TIMEOUT: LazyLock<Duration> =
    LazyLock::new(|| Duration::from_secs(env_config("ACTIONS_USER_TIMEOUT_SECS", 600)));

// crates/common/src/knobs.rs:692-693
pub static DATABASE_UDF_USER_TIMEOUT: LazyLock<Duration> =
    LazyLock::new(|| Duration::from_secs(env_config("DATABASE_UDF_USER_TIMEOUT_SECONDS", 1)));
```

### Memory Configuration
```rust
// crates/common/src/knobs.rs:849-850
pub static ISOLATE_MAX_USER_HEAP_SIZE: LazyLock<usize> =
    LazyLock::new(|| env_config("ISOLATE_MAX_USER_HEAP_SIZE", 1 << 26)); // 64 MB

// crates/common/src/knobs.rs:1119-1120
pub static AWS_STATIC_LAMBDA_MEMORY_LIMIT_MB: LazyLock<i32> =
    LazyLock::new(|| env_config("AWS_STATIC_LAMBDA_MEMORY_LIMIT_MB", 512));
```

### Document Limits
```rust
// crates/common/src/document.rs:101-102
pub const MAX_USER_SIZE: usize = 1 << 20; // 1 MiB
pub const MAX_DOCUMENT_NESTING: usize = 16;

// crates/value/src/array.rs:26
const MAX_ARRAY_LEN: usize = 8192;
```

### Logging Limits
```rust
// crates/isolate/src/environment/helpers/mod.rs:28-29
pub const MAX_LOG_LINE_LENGTH: usize = 32768;
pub const MAX_LOG_LINES: usize = 256;
```

### Scheduler Configuration
```rust
// crates/common/src/knobs.rs:254-255
pub static TRANSACTION_MAX_NUM_SCHEDULED: LazyLock<usize> =
    LazyLock::new(|| env_config("TRANSACTION_MAX_NUM_SCHEDULED", 1000));

// crates/common/src/knobs.rs:281-282
pub static SCHEDULED_JOB_EXECUTION_PARALLELISM: LazyLock<usize> =
    LazyLock::new(|| env_config("SCHEDULED_JOB_EXECUTION_PARALLELISM", 10));
```

* * *

## Appendix B: Workflow Step Budget Calculator

For planning workflow step counts:

| Operation | Steps | Notes |
|-----------|-------|-------|
| `step.runQuery()` | 1 | Fast, for state checks |
| `step.runMutation()` | 1 | Fast, for state updates |
| `step.runAction()` | 1 | Up to 10 min each |
| `step.runChildWorkflow()` | 1 | Blocks until child completes |
| Cancellation check | 1 | Query for run status |

**Example**: Agent conversation with 20 iterations
- Per iteration: 1 (LLM action) + 1 (tool workflow) = 2 steps
- Total: 20 × 2 + 2 (setup/finish) = 42 steps ✅ Safe

**Example**: Evaluation batch of 20 items
- Per item: 1 (init mutation) + 1 (child workflow) = 2 steps
- Total: 20 × 2 + 5 (overhead) = 45 steps ✅ Safe

**Danger zone**: >50 steps may cause replay timeout
