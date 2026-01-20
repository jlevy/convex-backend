# Research Brief: Convex Backend Limits Implementation and Configurability

**Last Updated**: 2026-01-20

**Status**: Complete

**Related**:

- [research-convex-db-limits-best-practices.md](../../../general/research/current/research-convex-db-limits-best-practices.md) -
  User-facing limits documentation and workarounds
- [research-convex-durable-workflows-architecture.md](./research-convex-durable-workflows-architecture.md) -
  Workflow and workpool architecture, overhead analysis

* * *

## Executive Summary

This research brief analyzes how Convex enforces its platform limits at the source code level,
identifying which limits are hard-coded constants versus configurable via environment variables
or the Consul-based knobs system. Understanding this implementation detail is critical for
organizations considering self-hosted Convex deployments where limits might need adjustment.

**Key Findings**:

1. **Most operational limits are configurable** via environment variables through the "knobs"
   system in `crates/common/src/knobs.rs`. This includes transaction limits, execution timeouts,
   concurrency caps, and memory limits.

2. **Document structure limits are hard-coded** in the value crate and cannot be changed without
   code modification. This includes document size (1 MiB), field count (1,024), array length
   (8,192), and nesting depth (16).

3. **Actual code limits are often more permissive** than documented user-facing limits. For
   example, the code allows 32,000 documents per transaction read vs. the documented 16,384.

4. **The knobs system supports runtime reconfiguration** in production via Consul, allowing
   operators to tune limits without redeploying.

**Research Questions**:

1. Where are Convex platform limits defined in the source code?

2. Which limits can be configured for self-hosted deployments?

3. What is the rationale for specific limit values?

4. What changes would be needed to modify hard-coded limits?

* * *

## Research Methodology

### Approach

This research was conducted through:

1. **Static code analysis** of the open-source Convex backend repository, focusing on limit
   definitions and enforcement points

2. **Pattern matching** for constants named `MAX_*`, `LIMIT_*`, and `*_SIZE` across Rust crates

3. **Trace analysis** of limit enforcement from constant definition through to error generation

4. **Comparison** with documented user-facing limits to identify discrepancies

### Sources

- Convex backend source code (`crates/` directory)
- Specifically: `common`, `value`, `database`, `isolate`, `model`, `udf`, `vector`, `search`

* * *

## Research Findings

### 1. Configuration System Architecture

#### 1.1 The Knobs System

**Status**: ✅ Complete

Convex uses a centralized configuration system called "knobs" defined in
`crates/common/src/knobs.rs`. This system provides:

- **Environment variable override**: All knobs can be set via environment variables for local
  development and self-hosted deployments
- **Consul integration**: Production deployments can modify knobs at runtime via Consul at
  `conductor/<partition-id>/knobs/<knob-name>`
- **Type-safe defaults**: Each knob has a compile-time default value

**Implementation Pattern**:

```rust
// From crates/common/src/knobs.rs
pub static TRANSACTION_MAX_READ_SIZE_BYTES: LazyLock<usize> = LazyLock::new(|| {
    env_config("TRANSACTION_MAX_READ_SIZE_BYTES", 1 << 24) // 16 MiB default
});
```

**Assessment**: The knobs system is well-designed for operational flexibility. Self-hosted
deployments can override any knob via environment variables without code changes.

* * *

### 2. Transaction Read/Write Limits

#### 2.1 Read Limits

**Status**: ✅ Complete

| Limit | Code Value | Documented Value | Location | Configurable |
|-------|------------|------------------|----------|--------------|
| Max documents read | 32,000 | 16,384 | `knobs.rs:351-352` | Yes (`TRANSACTION_MAX_READ_SIZE_ROWS`) |
| Max bytes read | 16 MiB | 8 MiB | `knobs.rs:355-357` | Yes (`TRANSACTION_MAX_READ_SIZE_BYTES`) |
| Max read set intervals | 4,096 | 4,096 | `knobs.rs:360-361` | Yes (`TRANSACTION_MAX_READ_SET_INTERVALS`) |

**Enforcement Location**: `crates/database/src/reads.rs`

**Rationale**: The documented limits (8 MiB, 16,384 docs) are more conservative than the code
defaults. This provides headroom for Convex Cloud to enforce stricter limits on certain plans
while the codebase supports higher values. The read set interval limit of 4,096 corresponds to
the maximum `db.get()`/`db.query()` calls per transaction.

#### 2.2 Write Limits

**Status**: ✅ Complete

| Limit | Code Value | Documented Value | Location | Configurable |
|-------|------------|------------------|----------|--------------|
| Max documents written | 16,000 | 8,192 | `knobs.rs:208-209` | Yes (`TRANSACTION_MAX_NUM_USER_WRITES`) |
| Max bytes written | 16 MiB | 8 MiB | `knobs.rs:212-214` | Yes (`TRANSACTION_MAX_USER_WRITE_SIZE_BYTES`) |
| Max system writes | 40,000 | N/A | `knobs.rs:243-244` | Yes (`TRANSACTION_MAX_SYSTEM_NUM_WRITES`) |
| Max system write bytes | 128 MiB | N/A | `knobs.rs:249-251` | Yes (`TRANSACTION_MAX_SYSTEM_WRITE_SIZE_BYTES`) |

**Enforcement Location**: `crates/database/src/writes.rs:288-307`

**Rationale**: System write limits are higher than user limits to accommodate internal operations
that generate multiple system documents per user write (e.g., index entries, metadata).

**Key Constraint**: When modifying `TRANSACTION_MAX_NUM_USER_WRITES`, you must also update
`MAX_INSERT_SIZE` in `mysql/src/lib.rs` and `postgres/src/lib.rs` to match.

* * *

### 3. Document Structure Limits

#### 3.1 Core Document Limits

**Status**: ✅ Complete

| Limit | Value | Location | Configurable |
|-------|-------|----------|--------------|
| Max document size | 1 MiB (1,048,576 bytes) | `common/src/document.rs:101` | **No** (hard-coded) |
| Max fields per document | 1,024 | `value/src/object.rs:30` | **No** (hard-coded) |
| Max nesting depth (user) | 16 levels | `common/src/document.rs:102` | **No** (hard-coded) |
| Max nesting depth (system) | 64 levels | `value/src/size.rs:8` | **No** (hard-coded) |
| Max array elements | 8,192 | `value/src/array.rs:27` | **No** (hard-coded) |
| Max field name length | 1,024 chars | `convex/sync_types/src/identifier.rs:124` | **No** (hard-coded) |
| Max identifier length | 64 chars | `convex/sync_types/src/identifier.rs:10` | **No** (hard-coded) |

**Enforcement Locations**:

- Document size: `common/src/document.rs:599-614` (`check_user_size()`)
- Object fields: `value/src/object.rs:66-75` (`TryFrom<BTreeMap>`)
- Array length: `value/src/array.rs:70-79` (`TryFrom<Vec>`)
- Nesting: `common/src/document.rs:456-459` (`validate()`)

**Assessment**: These limits are deeply embedded in the value serialization layer. Changing them
would require modifications to:

1. The constant definitions
2. Serialization/deserialization logic
3. Storage layer assumptions
4. Client SDK validation

**Rationale**: Document structure limits ensure predictable memory usage during serialization
and prevent pathological cases that could impact system stability.

* * *

### 4. Execution Time and Memory Limits

#### 4.1 Timeout Limits

**Status**: ✅ Complete

| Limit | Value | Location | Configurable |
|-------|-------|----------|--------------|
| Query/mutation user timeout | 1 second | `knobs.rs:692-693` | Yes (`DATABASE_UDF_USER_TIMEOUT_SECONDS`) |
| Query/mutation system timeout | 15 seconds | `knobs.rs:703-704` | Yes (`DATABASE_UDF_SYSTEM_TIMEOUT_SECONDS`) |
| Action user timeout | 600 seconds (10 min) | `knobs.rs:119-120` | Yes (`ACTIONS_USER_TIMEOUT_SECS`) |
| V8 action system timeout | 300 seconds (5 min) | `knobs.rs:745-746` | Yes (`V8_ACTION_SYSTEM_TIMEOUT_SECONDS`) |
| Code analysis timeout | 2 seconds | `knobs.rs:707-708` | Yes (`ISOLATE_ANALYZE_USER_TIMEOUT_SECONDS`) |

**Rationale for System Timeout**: The 15-second system timeout accounts for up to 4,096 queries
at ~1.6ms average = 6.4 seconds, plus buffer for network latency and processing overhead.

#### 4.2 Memory Limits

**Status**: ✅ Complete

| Limit | Value | Location | Configurable |
|-------|-------|----------|--------------|
| V8 user heap size | 64 MB | `knobs.rs:849-850` | Yes (`ISOLATE_MAX_USER_HEAP_SIZE`) |
| V8 heap extra size | 32 MB | `knobs.rs:854-855` | Yes (`ISOLATE_MAX_HEAP_EXTRA_SIZE`) |
| V8 ArrayBuffer total | 64 MB | `knobs.rs:858-859` | Yes (`ISOLATE_MAX_ARRAY_BUFFER_TOTAL_SIZE`) |
| Node.js Lambda (static) | 512 MB | `knobs.rs:1119-1120` | Yes (`AWS_STATIC_LAMBDA_MEMORY_LIMIT_MB`) |
| Node.js Lambda (dynamic) | 4,096 MB | `knobs.rs:1130-1131` | Yes (`AWS_DYNAMIC_LAMBDA_MEMORY_LIMIT_MB`) |

**Enforcement**: V8 memory limits are enforced at the isolate level during execution.

**Assessment**: Memory limits are fully configurable but require careful consideration:

- Higher V8 heap limits may cause memory pressure on shared infrastructure
- Lambda memory limits affect AWS billing
- Self-hosted deployments can safely increase these based on available resources

#### 4.3 Argument and Result Size Limits

**Status**: ✅ Complete

| Limit | Value | Location | Configurable |
|-------|-------|----------|--------------|
| Function args size | 16 MiB | `knobs.rs:223-225` | Yes (`FUNCTION_MAX_ARGS_SIZE`) |
| Function result size | 16 MiB | `knobs.rs:228-230` | Yes (`FUNCTION_MAX_RESULT_SIZE`) |
| Node.js args size | 5 MiB | `node_executor/src/executor.rs:132-134` | **No** (hard-coded message) |
| HTTP action body | 20 MiB | `udf/src/http_action.rs:30` | **No** (hard-coded) |

**Note**: The Node.js 5 MiB limit is documented in an error message but the actual enforcement
may use the general function args limit. The HTTP action body limit is separate and hard-coded.

* * *

### 5. Index and Schema Limits

#### 5.1 Index Limits

**Status**: ✅ Complete

| Limit | Code Value | Documented Value | Location | Configurable |
|-------|------------|------------------|----------|--------------|
| Max indexes per table | 64 | 32 | `common/src/schemas/mod.rs:64` | **No** (hard-coded) |
| Max fields per index | 16 | 16 | `bootstrap_model/index/mod.rs:42` | **No** (hard-coded) |
| Max text index filters | 16 | 16 | `bootstrap_model/index/mod.rs:43` | **No** (hard-coded) |
| Max vector index filters | 16 | 16 | `bootstrap_model/index/mod.rs:44` | **No** (hard-coded) |

**Enforcement**: `crates/database/src/bootstrap_model/index.rs:129-130`

**Discrepancy**: The code allows 64 indexes per table, but documentation says 32. The 64 limit
is the total across all index types (database, text, vector).

#### 5.2 Schema Limits

**Status**: ✅ Complete

| Limit | Value | Location | Configurable |
|-------|-------|----------|--------------|
| Max tables per deployment | 10,000 | `database/src/bootstrap_model/table.rs:62` | **No** (hard-coded) |
| Max user modules | 4,096 | `knobs.rs:1329-1330` | Yes (`MAX_USER_MODULES`) |
| Max push size | 200 MB | `knobs.rs:1320-1321` | Yes (`MAX_PUSH_BYTES`) |

#### 5.3 Search Index Limits

**Status**: ✅ Complete

| Limit | Value | Location | Configurable |
|-------|-------|----------|--------------|
| Text index size soft limit | 10 MiB | `knobs.rs:535-536` | Yes (`SEARCH_INDEX_SIZE_SOFT_LIMIT`) |
| Text index size hard limit | 100 MiB | `knobs.rs:420-421` | Yes (`SEARCH_INDEX_SIZE_HARD_LIMIT`) |
| Vector index size soft limit | 30 MiB | `knobs.rs:649-650` | Yes (`VECTOR_INDEX_SIZE_SOFT_LIMIT`) |
| Vector index size hard limit | 100 MiB | `knobs.rs:427-428` | Yes (`VECTOR_INDEX_SIZE_HARD_LIMIT`) |
| Max text search results | 1,024 | `search/src/constants.rs:18` | **No** (hard-coded) |
| Max vector search results | 256 | `vector/src/lib.rs:64` | **No** (hard-coded) |
| Max vector dimensions | 4,096 | `bootstrap_model/index/vector_index/dimensions.rs:6` | **No** (hard-coded) |

* * *

### 6. Concurrency and Scheduling Limits

#### 6.1 Function Concurrency

**Status**: ✅ Complete

| Limit | Default | Location | Configurable |
|-------|---------|----------|--------------|
| Base concurrency (all types) | 16 | `knobs.rs:760` | N/A (base constant) |
| Concurrent queries | 16 | `knobs.rs:768-773` | Yes (`APPLICATION_MAX_CONCURRENT_QUERIES`) |
| Concurrent mutations | 16 | `knobs.rs:781-786` | Yes (`APPLICATION_MAX_CONCURRENT_MUTATIONS`) |
| Concurrent V8 actions | 16 | `knobs.rs:802-807` | Yes (`APPLICATION_MAX_CONCURRENT_V8_ACTIONS`) |
| Concurrent Node actions | 16 | `knobs.rs:818-823` | Yes (`APPLICATION_MAX_CONCURRENT_NODE_ACTIONS`) |
| Concurrent HTTP actions | 16 | `knobs.rs:832-841` | Yes (`APPLICATION_MAX_CONCURRENT_HTTP_ACTIONS`) |
| HTTP server concurrent | 1,024 | `knobs.rs:203-204` | Yes (`HTTP_SERVER_MAX_CONCURRENT_REQUESTS`) |

**Note**: These defaults are for the "basic plan". Production Convex Cloud overrides these via
the "big brain" service for professional plan customers (256 queries/mutations, 1000 Node actions).

#### 6.2 Scheduling Limits

**Status**: ✅ Complete

| Limit | Value | Location | Configurable |
|-------|-------|----------|--------------|
| Max scheduled per mutation | 1,000 | `knobs.rs:254-255` | Yes (`TRANSACTION_MAX_NUM_SCHEDULED`) |
| Max scheduled arg size (single) | 1 MiB | `knobs.rs:263-265` | Yes (`MAX_SCHEDULED_JOB_ARGUMENT_SIZE_BYTES`) |
| Max scheduled args total | 16 MiB | `knobs.rs:269-275` | Yes (`TRANSACTION_MAX_SCHEDULED_TOTAL_ARGUMENT_SIZE_BYTES`) |
| Scheduled job parallelism | 10 | `knobs.rs:281-282` | Yes (`SCHEDULED_JOB_EXECUTION_PARALLELISM`) |
| Scheduled job retention | 7 days | `knobs.rs:315-320` | Yes (`SCHEDULED_JOB_RETENTION`) |

**Enforcement**: `crates/model/src/scheduled_jobs/mod.rs:181-211` (`check_scheduling_limits()`)

#### 6.3 Logging Limits

**Status**: ✅ Complete

| Limit | Value | Location | Configurable |
|-------|-------|----------|--------------|
| Max log lines per execution | 256 | `isolate/src/environment/helpers/mod.rs:29` | **No** (hard-coded) |

**Enforcement**: Logs are truncated silently after 256 lines with a message:
"Log overflow (maximum 256). Remaining log lines omitted."

* * *

### 7. OCC (Optimistic Concurrency Control) Configuration

**Status**: ✅ Complete

| Setting | Value | Location | Configurable |
|---------|-------|----------|--------------|
| Max OCC retries | 4 | `knobs.rs:146-147` | Yes (`UDF_EXECUTOR_OCC_MAX_RETRIES`) |
| Initial OCC backoff | 10ms | `knobs.rs:150-151` | Yes (`UDF_EXECUTOR_OCC_INITIAL_BACKOFF_MS`) |
| Max OCC backoff | 2,000ms | `knobs.rs:154-155` | Yes (`UDF_EXECUTOR_OCC_MAX_BACKOFF_MS`) |

**Assessment**: OCC parameters are fully tunable. Self-hosted deployments with lower contention
could reduce retries; high-contention scenarios might benefit from longer backoffs.

* * *

### 8. Environment Variable Limits

**Status**: ✅ Complete

| Limit | Value | Location | Configurable |
|-------|-------|----------|--------------|
| Max environment variables | 1,000 | `knobs.rs:1537-1538` | Yes (`ENV_VAR_LIMIT`) |
| Max env var name length | 40 chars | `types/environment_variables.rs:66` | **No** (hard-coded) |
| Max env var value length | 8,192 bytes | `types/environment_variables.rs:69` | **No** (hard-coded) |

**Note**: The documented limit of 100 environment variables is more conservative than the code
default of 1,000.

* * *

## Comparative Analysis

### Configurable vs Hard-Coded Limits

| Category | Configurable | Hard-Coded | Total |
|----------|--------------|------------|-------|
| Transaction limits | 6 | 0 | 6 |
| Document structure | 0 | 7 | 7 |
| Execution time | 5 | 0 | 5 |
| Memory limits | 5 | 0 | 5 |
| Arg/result sizes | 2 | 2 | 4 |
| Index limits | 0 | 6 | 6 |
| Schema limits | 2 | 1 | 3 |
| Search limits | 4 | 3 | 7 |
| Concurrency | 7 | 0 | 7 |
| Scheduling | 5 | 0 | 5 |
| Logging | 0 | 1 | 1 |
| OCC | 3 | 0 | 3 |
| Env vars | 1 | 2 | 3 |
| **Total** | **40** | **22** | **62** |

**Summary**: ~65% of limits are configurable via environment variables without code changes.

### Code Defaults vs Documented Limits

| Limit | Code Default | Documented | Ratio |
|-------|--------------|------------|-------|
| Max docs read | 32,000 | 16,384 | 1.95x |
| Max bytes read | 16 MiB | 8 MiB | 2x |
| Max docs written | 16,000 | 8,192 | 1.95x |
| Max bytes written | 16 MiB | 8 MiB | 2x |
| Max indexes per table | 64 | 32 | 2x |
| Max env vars | 1,000 | 100 | 10x |

**Assessment**: Convex Cloud likely applies stricter limits for free/starter plans while the
codebase supports higher values for professional/enterprise customers and self-hosted deployments.

* * *

## Best Practices for Self-Hosted Deployments

### 1. Safe Limits to Increase

These limits can be safely increased based on available resources:

- **Concurrency limits** (`APPLICATION_MAX_CONCURRENT_*`): Scale based on CPU cores and memory
- **Memory limits** (`ISOLATE_MAX_USER_HEAP_SIZE`): Scale based on available RAM
- **Execution timeouts**: Increase if running longer batch operations
- **Transaction limits**: Increase for larger batch operations if storage can handle it

### 2. Limits Requiring Caution

These require careful consideration before changing:

- **Search index hard limits**: Affects memory usage during search operations
- **OCC retry counts**: Too many retries can cause cascading failures under load
- **HTTP concurrent requests**: May overwhelm downstream services

### 3. Limits Not Recommended to Change

These are fundamental to system correctness:

- **Document structure limits**: Deeply embedded in serialization
- **Max search/vector results**: Query planning depends on these
- **Index field counts**: Storage format assumptions

### 4. Environment Variable Configuration

For self-hosted deployments, create a configuration file:

```bash
# Transaction limits (increase for larger batch operations)
export TRANSACTION_MAX_READ_SIZE_ROWS=64000
export TRANSACTION_MAX_READ_SIZE_BYTES=33554432  # 32 MiB
export TRANSACTION_MAX_NUM_USER_WRITES=32000
export TRANSACTION_MAX_USER_WRITE_SIZE_BYTES=33554432  # 32 MiB

# Execution limits (adjust based on workload)
export DATABASE_UDF_USER_TIMEOUT_SECONDS=2
export ACTIONS_USER_TIMEOUT_SECS=900  # 15 minutes

# Memory limits (scale with available RAM)
export ISOLATE_MAX_USER_HEAP_SIZE=134217728  # 128 MB

# Concurrency (scale with CPU cores)
export APPLICATION_MAX_CONCURRENT_QUERIES=64
export APPLICATION_MAX_CONCURRENT_MUTATIONS=64
export APPLICATION_MAX_CONCURRENT_V8_ACTIONS=64
```

* * *

## Open Research Questions

1. **Storage quotas**: How are database storage and bandwidth quotas enforced? These appear to
   be managed externally (billing/usage tracking) rather than as hard limits in the backend code.

2. **Plan-based limits**: How does the "big brain" service override default concurrency limits
   for professional plan customers?

3. **Vector index document limits**: The documented 100,000 document limit per vector index
   wasn't found as a code constant - it may be enforced through index size limits instead.

* * *

## Recommendations

### Summary

Self-hosted Convex deployments have significant flexibility to adjust operational limits via
environment variables. The knobs system provides a well-designed configuration interface that
supports both local development overrides and production runtime tuning.

### Recommended Approach

1. **Start with defaults**: The default limits are well-tuned for general use cases

2. **Monitor before changing**: Use metrics to identify actual bottlenecks before adjusting limits

3. **Test thoroughly**: Changes to limits can have cascading effects on system behavior

4. **Document changes**: Maintain a configuration file with explanations for any modified limits

### Alternative Approaches

- **Code modification**: For hard-coded limits, fork and modify the relevant constants. This
  requires maintaining a custom build and careful testing of affected subsystems.

- **Hybrid approach**: Use configurable limits for operational tuning while accepting hard-coded
  structural limits as part of the platform contract.

* * *

## References

### Source Code Locations

- `crates/common/src/knobs.rs` - Central configuration system (1,539 lines)
- `crates/common/src/document.rs` - Document size and structure limits
- `crates/value/src/` - Value type limits (array, object, string)
- `crates/database/src/` - Transaction and index limit enforcement
- `crates/isolate/src/` - V8 execution limits
- `crates/model/src/` - Schema and scheduling limits

### Related Documentation

- [Convex Production Limits](https://docs.convex.dev/production/state/limits)
- [Self-Hosting Documentation](https://docs.convex.dev/self-hosting)

* * *

## Appendix A: Complete Knobs Reference

The following is a categorized list of all configurable knobs with their environment variable
names and default values:

### Transaction Limits

| Knob | Env Var | Default |
|------|---------|---------|
| `TRANSACTION_MAX_READ_SIZE_ROWS` | `TRANSACTION_MAX_READ_SIZE_ROWS` | 32,000 |
| `TRANSACTION_MAX_READ_SIZE_BYTES` | `TRANSACTION_MAX_READ_SIZE_BYTES` | 16 MiB |
| `TRANSACTION_MAX_READ_SET_INTERVALS` | `TRANSACTION_MAX_READ_SET_INTERVALS` | 4,096 |
| `TRANSACTION_MAX_NUM_USER_WRITES` | `TRANSACTION_MAX_NUM_USER_WRITES` | 16,000 |
| `TRANSACTION_MAX_USER_WRITE_SIZE_BYTES` | `TRANSACTION_MAX_USER_WRITE_SIZE_BYTES` | 16 MiB |
| `TRANSACTION_MAX_NUM_SCHEDULED` | `TRANSACTION_MAX_NUM_SCHEDULED` | 1,000 |

### Execution Limits

| Knob | Env Var | Default |
|------|---------|---------|
| `DATABASE_UDF_USER_TIMEOUT` | `DATABASE_UDF_USER_TIMEOUT_SECONDS` | 1s |
| `DATABASE_UDF_SYSTEM_TIMEOUT` | `DATABASE_UDF_SYSTEM_TIMEOUT_SECONDS` | 15s |
| `ACTION_USER_TIMEOUT` | `ACTIONS_USER_TIMEOUT_SECS` | 600s |
| `V8_ACTION_SYSTEM_TIMEOUT` | `V8_ACTION_SYSTEM_TIMEOUT_SECONDS` | 300s |

### Memory Limits

| Knob | Env Var | Default |
|------|---------|---------|
| `ISOLATE_MAX_USER_HEAP_SIZE` | `ISOLATE_MAX_USER_HEAP_SIZE` | 64 MB |
| `ISOLATE_MAX_HEAP_EXTRA_SIZE` | `ISOLATE_MAX_HEAP_EXTRA_SIZE` | 32 MB |
| `ISOLATE_MAX_ARRAY_BUFFER_TOTAL_SIZE` | `ISOLATE_MAX_ARRAY_BUFFER_TOTAL_SIZE` | 64 MB |
| `AWS_STATIC_LAMBDA_MEMORY_LIMIT_MB` | `AWS_STATIC_LAMBDA_MEMORY_LIMIT_MB` | 512 |
| `AWS_DYNAMIC_LAMBDA_MEMORY_LIMIT_MB` | `AWS_DYNAMIC_LAMBDA_MEMORY_LIMIT_MB` | 4,096 |

### Concurrency Limits

| Knob | Env Var | Default |
|------|---------|---------|
| `APPLICATION_MAX_CONCURRENT_QUERIES` | `APPLICATION_MAX_CONCURRENT_QUERIES` | 16 |
| `APPLICATION_MAX_CONCURRENT_MUTATIONS` | `APPLICATION_MAX_CONCURRENT_MUTATIONS` | 16 |
| `APPLICATION_MAX_CONCURRENT_V8_ACTIONS` | `APPLICATION_MAX_CONCURRENT_V8_ACTIONS` | 16 |
| `APPLICATION_MAX_CONCURRENT_NODE_ACTIONS` | `APPLICATION_MAX_CONCURRENT_NODE_ACTIONS` | 16 |
| `APPLICATION_MAX_CONCURRENT_HTTP_ACTIONS` | `APPLICATION_MAX_CONCURRENT_HTTP_ACTIONS` | 16 |
| `HTTP_SERVER_MAX_CONCURRENT_REQUESTS` | `HTTP_SERVER_MAX_CONCURRENT_REQUESTS` | 1,024 |

### Search Index Limits

| Knob | Env Var | Default |
|------|---------|---------|
| `SEARCH_INDEX_SIZE_SOFT_LIMIT` | `SEARCH_INDEX_SIZE_SOFT_LIMIT` | 10 MiB |
| `TEXT_INDEX_SIZE_HARD_LIMIT` | `SEARCH_INDEX_SIZE_HARD_LIMIT` | 100 MiB |
| `VECTOR_INDEX_SIZE_SOFT_LIMIT` | `VECTOR_INDEX_SIZE_SOFT_LIMIT` | 30 MiB |
| `VECTOR_INDEX_SIZE_HARD_LIMIT` | `VECTOR_INDEX_SIZE_HARD_LIMIT` | 100 MiB |

* * *

## Appendix B: Hard-Coded Limits Reference

The following limits require code modification to change:

### Document Structure (`crates/value/src/` and `crates/common/src/document.rs`)

```rust
pub const MAX_USER_SIZE: usize = 1 << 20;           // 1 MiB
pub const MAX_DOCUMENT_NESTING: usize = 16;
pub const MAX_OBJECT_FIELDS: usize = 1024;
pub const MAX_ARRAY_LEN: usize = 8192;
pub const MAX_FIELD_NAME_LENGTH: usize = 1024;
pub const MAX_IDENTIFIER_LEN: usize = 64;
```

### Index Limits (`crates/common/src/` and `crates/database/src/`)

```rust
pub const MAX_INDEXES_PER_TABLE: usize = 64;
pub const MAX_INDEX_FIELDS_SIZE: usize = 16;
pub const MAX_TEXT_INDEX_FILTER_FIELDS_SIZE: usize = 16;
pub const MAX_VECTOR_INDEX_FILTER_FIELDS_SIZE: usize = 16;
pub const MAX_USER_TABLES: usize = 10000;
```

### Search Limits (`crates/search/src/` and `crates/vector/src/`)

```rust
pub const MAX_CANDIDATE_REVISIONS: usize = 1024;    // Text search results
pub const MAX_VECTOR_RESULTS: usize = 256;
pub const MAX_VECTOR_DIMENSIONS: u32 = 4096;
```

### Logging (`crates/isolate/src/environment/helpers/mod.rs`)

```rust
pub const MAX_LOG_LINES: usize = 256;
```

### HTTP Actions (`crates/udf/src/http_action.rs`)

```rust
pub const HTTP_ACTION_BODY_LIMIT: usize = 20 << 20; // 20 MiB
```
