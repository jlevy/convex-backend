# Research Brief: Convex Platform Limits and Best Practices

**Last Updated**: 2026-01-10

**Status**: Active (reviewed January 2026; updated 2026-01-10 with expanded scope beyond
database limits)

<!-- TODO: SCOPE EXPANSION - This document has been renamed from "Convex Database
Limits" to "Convex Platform Limits" to reflect its broader scope covering execution,
concurrency, storage, and other platform-wide constraints.
Sections still needing expansion are marked with TODO comments throughout.
-->

**Legend**:

| Symbol | Meaning |
| --- | --- |
| ✅ | **Verified** - Confirmed against official Convex documentation |
| ⚠️ | **Unverified** - Not confirmed in recent documentation review; may need manual check |
| 📝 | **Anecdotal** - From production experience; not explicitly documented |
| 🔒 | **Hard Limit** - Cannot be changed regardless of plan |
| 🔄 | **Soft Limit** - Can be increased for Professional plan customers (contact support) |
| ❌ | **Not Allowed** - Operation is prohibited or not supported |
| 🔍 | **Undocumented/Discrepancy** - Not in official Convex docs, or source code differs from docs |
| 🛠️ | **Configurable** - Can be changed via environment variable for self-hosted deployments |

**Notation**: Combinations like “✅ 🔒” mean “Verified Hard Limit”

**Related Research**:

- [research-convex-backend-limits-implementation.md](../../../project/research/current/research-convex-backend-limits-implementation.md)
  — Deep dive into source code implementation of limits and configurability for
  self-hosted deployments

- [research-convex-durable-workflows-architecture.md](../../../project/research/current/research-convex-durable-workflows-architecture.md)
  — Backend architecture analysis for durable workflow patterns, including
  workflow-specific limits and constraints

* * *

## Executive Summary

Convex enforces a comprehensive set of platform-level limits designed to protect service
stability and ensure predictable performance.
Understanding these limits and their implications is critical for building scalable
applications that avoid runtime errors, performance degradation, and cost overruns.

This document provides a complete reference of Convex’s limits (as of January 2026),
explains the technical constraints behind them, and documents proven workarounds and
best practices. Key topics include: transaction read/write limits (8 MiB cap), document
size constraints (1 MiB max), concurrency quotas, indexing strategies, pagination
patterns, optimistic concurrency control (OCC), and the official Aggregate Component for
maintaining statistics at scale.

**Key Takeaway**: Applications can scale to substantial workloads within Convex by
combining official best practices—selective indexes, pagination, aggregate components,
bounded queries, proper namespacing, and scheduled jobs—with proactive monitoring of
storage and bandwidth quotas.

## Architectural Overview

This section provides a high-level map of the Convex platform architecture and how
limits apply to each component.
Understanding this landscape helps orient readers to where different constraints come
into play.

### Platform Architecture

Convex is a full-stack backend platform with the following major components:

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                              CLIENT LAYER                                   │
│  (React/Next.js/React Native apps using convex/react hooks)                │
├─────────────────────────────────────────────────────────────────────────────┤
│                           CONVEX BACKEND                                    │
│  ┌─────────────────┐  ┌─────────────────┐  ┌─────────────────┐             │
│  │    Queries      │  │   Mutations     │  │    Actions      │             │
│  │  (read-only,    │  │  (read-write,   │  │  (side effects, │             │
│  │   reactive)     │  │   transactional)│  │   external APIs)│             │
│  └────────┬────────┘  └────────┬────────┘  └────────┬────────┘             │
│           │                    │                    │                      │
│           v                    v                    v                      │
│  ┌─────────────────────────────────────────────────────────────────┐       │
│  │                      FUNCTION RUNTIME                           │       │
│  │   V8 Isolate (queries/mutations)  |  Node.js (actions)          │       │
│  └─────────────────────────────────────────────────────────────────┘       │
│           │                    │                    │                      │
│           v                    v                    v                      │
│  ┌─────────────────────────────────────────────────────────────────┐       │
│  │                    TRANSACTION LAYER                            │       │
│  │   Optimistic Concurrency Control (OCC) - automatic retries      │       │
│  └─────────────────────────────────────────────────────────────────┘       │
│           │                                                                │
│           v                                                                │
│  ┌─────────────────────────────────────────────────────────────────┐       │
│  │                      DATA LAYER                                 │       │
│  │   Documents │ Indexes │ File Storage │ Vector Search            │       │
│  └─────────────────────────────────────────────────────────────────┘       │
├─────────────────────────────────────────────────────────────────────────────┤
│                        SCHEDULING LAYER                                    │
│   Scheduled Functions │ Cron Jobs │ Durable Workflows                      │
└─────────────────────────────────────────────────────────────────────────────┘
```

### Where Limits Apply

Each architectural layer has its own set of constraints:

| Layer | Limit Categories | Key Constraints |
| --- | --- | --- |
| **Client Layer** | Subscriptions, WebSocket | Concurrent subscriptions, connection limits |
| **Queries** | Read limits, execution time | 8 MiB read, 16K docs scanned, 1s timeout |
| **Mutations** | Read + write limits, execution time | 8 MiB read/write, 8K docs written, 1s timeout |
| **Actions** | Execution time, memory, external calls | 10 min timeout, 512 MB memory, no DB transactions |
| **V8 Runtime** | Heap memory, syscalls | 64 MB heap, 1000 concurrent syscalls |
| **Node.js Runtime** | Memory, concurrency | 512 MB Lambda, 8 concurrent external ops |
| **Transaction Layer** | OCC conflicts, retry limits | Automatic retry on conflict, eventual consistency |
| **Document Storage** | Size, structure | 1 MiB per doc, 1024 fields, 16 nesting levels |
| **Indexes** | Count, backfill | 32 indexes per table (docs say; source says 64) |
| **File Storage** | Upload size, concurrency | Per-file limits, concurrent upload limits |
| **Scheduled Functions** | Queue depth, execution | Scheduler limits, timeout inheritance |
| **Cron Jobs** | Schedule frequency, retention | Cron syntax limits, log retention |

### Common Challenges by Component

Understanding where developers typically encounter issues:

**Database Operations**

- Transaction read limit exceeded when scanning large tables without pagination

- Document size limit hit when storing large blobs or arrays

- OCC conflicts under high write contention to the same documents

**Function Execution**

- Query/mutation timeout (1s) exceeded for complex operations

- Action timeout confusion (10 min documented, but 5 min for nested calls)

- Memory limits hit when processing large datasets in-memory

**Concurrency and Scaling**

- OCC retries causing latency spikes under contention

- Subscription fan-out limits for real-time features

- Scheduled function queue depth limits

**Cross-Runtime Patterns**

- Actions calling mutations/queries vs mutations calling actions

- Nested action timeout behavior (undocumented 5-minute limit)

- Error context lost across runtime boundaries

The sections that follow provide detailed coverage of each limit category, along with
workarounds and best practices for each challenge area.

* * *

## Configuration System Architecture

Understanding how Convex implements and configures its limits is essential for
self-hosted deployments and for understanding which limits can be adjusted.

### The Knobs System

Convex uses a centralized configuration system called “knobs” defined in
`crates/common/src/knobs.rs`. This system provides:

- **Environment variable override**: All knobs can be set via environment variables for
  local development and self-hosted deployments

- **Consul integration**: Production deployments can modify knobs at runtime via Consul
  at `conductor/<partition-id>/knobs/<knob-name>`

- **Type-safe defaults**: Each knob has a compile-time default value

**Implementation Pattern**:

```rust
// From crates/common/src/knobs.rs
pub static TRANSACTION_MAX_READ_SIZE_BYTES: LazyLock<usize> = LazyLock::new(|| {
    env_config("TRANSACTION_MAX_READ_SIZE_BYTES", 1 << 24) // 16 MiB default
});
```

The knobs system is well-designed for operational flexibility.
Self-hosted deployments can override any configurable knob via environment variables
without code changes.

### Configurable vs Hard-Coded Limits

Not all limits can be changed via configuration.
The breakdown:

| Category | Configurable | Hard-Coded | Total |
| --- | --- | --- | --- |
| Transaction limits | 6 | 0 | 6 |
| Document structure | 0 | 7 | 7 |
| Execution time | 6 | 0 | 6 |
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
| **Total** | **41** | **22** | **63** |

**Summary**: ~65% of limits are configurable via environment variables without code
changes. Hard-coded limits (document structure, index limits, search results) are deeply
embedded in serialization and storage layers.

### Code Defaults vs Documented Limits

Convex Cloud applies stricter limits than the source code defaults, likely
differentiated by plan tier:

| Limit | Code Default | Documented | Ratio |
| --- | --- | --- | --- |
| Max docs read | 32,000 | 16,384 | 1.95x |
| Max bytes read | 16 MiB | 8 MiB | 2x |
| Max docs written | 16,000 | 8,192 | 1.95x |
| Max bytes written | 16 MiB | 8 MiB | 2x |
| Max indexes per table | 64 | 32 | 2x |
| Max env vars | 1,000 | 100 | 10x |

Self-hosted deployments get the more permissive code defaults unless explicitly
configured otherwise.

* * *

## Core Limits Reference

### 1. Transaction Read/Write Limits

**Hard Limits (per function invocation)** ✅ 🔒:

| Limit Type | Documented Value | Source Code Default | Status |
| --- | --- | --- | --- |
| **Maximum data read** | 8 MiB per query/mutation | 16 MiB | ✅ 🔒 🔍 🛠️ |
| **Maximum documents scanned** | 16,384 documents per query/mutation | 32,000 | ✅ 🔒 🔍 🛠️ |
| **Maximum data written** | 8 MiB per mutation | 16 MiB | ✅ 🔒 🔍 🛠️ |
| **Maximum documents written** | 8,192 documents per mutation | 16,000 | ✅ 🔒 🔍 🛠️ |
| **Maximum db.get/db.query calls** | 4,096 per transaction | 4,096 | ✅ 🔒 🛠️ |

**🔍 Source Code vs Documentation Discrepancy**:

The source code defaults in `crates/common/src/knobs.rs` are **2x more permissive** than
documented limits:

- `TRANSACTION_MAX_READ_SIZE_BYTES`: 16 MiB (line 355-357)

- `TRANSACTION_MAX_READ_SIZE_ROWS`: 32,000 (line 351-352)

- `TRANSACTION_MAX_USER_WRITE_SIZE_BYTES`: 16 MiB (line 212-214)

- `TRANSACTION_MAX_NUM_USER_WRITES`: 16,000 (line 208-209)

- `TRANSACTION_MAX_READ_SET_INTERVALS`: 4,096 (line 360-361)

**Why the discrepancy?** Convex Cloud likely enforces stricter limits for free/starter
plans while the codebase supports higher values for professional/enterprise customers
and self-hosted deployments.

**🛠️ Self-Hosted Configuration**:

For self-hosted deployments, these limits can be adjusted via environment variables:

```bash
export TRANSACTION_MAX_READ_SIZE_BYTES=33554432  # 32 MiB
export TRANSACTION_MAX_READ_SIZE_ROWS=64000
export TRANSACTION_MAX_NUM_USER_WRITES=32000
export TRANSACTION_MAX_USER_WRITE_SIZE_BYTES=33554432  # 32 MiB
```

**Key Constraint**: The read limit includes **all scanned document bytes**, not just
returned results.
Convex does not support field projection—reading any document reads the
entire document.

**Error Manifestation**: `"transaction exceeded resource limits"` runtime error

**Common Causes**:

- Using `.collect()` on large result sets without pagination

- Scanning tables with large document sizes (e.g., documents approaching the 1 MiB
  limit)

- Counting operations that scan many large documents (even with `.take(limit)`)

- Post-index filtering with `.filter()` instead of using composite indexes

**Sources**:

- [Convex Limits - Database](https://docs.convex.dev/production/state/limits)

- Source: `crates/common/src/knobs.rs:208-214, 351-361`

### 2. Document Size and Structure Limits

**Hard Limits (per document)** ✅ 🔒:

| Limit | Value | Source Location | Status |
| --- | --- | --- | --- |
| **Maximum document size** | 1 MiB (1,048,576 bytes) | `crates/common/src/document.rs:101` | ✅ 🔒 |
| **Maximum fields per document** | 1,024 fields | `crates/value/src/object.rs:30` | ✅ 🔒 |
| **Maximum nesting depth (user)** | 16 levels | `crates/common/src/document.rs:102` | ✅ 🔒 |
| **Maximum nesting depth (system)** | 64 levels | `crates/value/src/size.rs:8` | ✅ 🔒 |
| **Maximum array elements** | 8,192 elements per array | `crates/value/src/array.rs:26` | ✅ 🔒 |
| **Maximum field name length** | 1,024 characters | `crates/sync_types/src/identifier.rs:124` | ✅ 🔒 🔍 |
| **Maximum identifier length** | 64 characters | `crates/sync_types/src/identifier.rs:10` | ✅ 🔒 |

**🔍 Note on Field Name vs Identifier Length**:

The docs say 64 characters for field names, but source code shows **1,024 characters**
for field names (`MAX_FIELD_NAME_LENGTH`) vs **64 characters** for identifiers like
table names (`MAX_IDENTIFIER_LEN`). These are different limits.

**Key Constraints**:

- Field names must be nonempty and cannot start with `$` or `_` (reserved for system
  fields)

- Only “plain old JavaScript objects” are supported (no custom prototypes)

- Strings are stored as UTF-8 and must be valid Unicode sequences

- System fields (`_id`, `_creationTime`) are automatically added and count toward limits

- **These limits are hard-coded** and cannot be changed via configuration—modifying them
  requires code changes to the value serialization layer

**Common Causes of Issues**:

- Storing large text fields (e.g., LLM conversation content, full API responses) in
  documents used for listing/counting

- Deeply nested object structures from external APIs

- Large arrays of embedded objects

- **Returning large query result arrays** - Queries that return >8,192 documents will
  fail even if total data size is under 8 MiB

**Note on 8,192 Array Element Limit**: This limit applies to:

1. Arrays **within** documents (e.g., `tags: string[]`)

2. Arrays **returned** by query functions (the result set itself)

For query results, set explicit limits <8,000 to account for overhead:

```typescript
// SAFE: Explicit limit under 8,192 with margin
const events = await ctx.db.query('events').take(8000);

// DANGEROUS: Could return >8,192 results
const events = await ctx.db.query('events').collect();
```

**Sources**:

- [Convex Limits - Document Size](https://docs.convex.dev/production/state/limits)

### 3. Concurrency and Execution Limits

**Concurrent Execution Limits** ✅ 🔄 🛠️:

| Resource Type | Default (Code) | Source Location | Status |
| --- | --- | --- | --- |
| **Queries** | 16 concurrent | `crates/common/src/knobs.rs:768-773` | ✅ 🔄 🛠️ |
| **Mutations** | 16 concurrent | `crates/common/src/knobs.rs:781-786` | ✅ 🔄 🛠️ |
| **V8 Actions** | 16 concurrent | `crates/common/src/knobs.rs:802-807` | ✅ 🔄 🛠️ |
| **Node Actions** | 16 concurrent | `crates/common/src/knobs.rs:818-823` | ✅ 🔄 🛠️ |
| **HTTP Actions** | 16 concurrent | `crates/common/src/knobs.rs:832-841` | ✅ 🔄 🛠️ |
| **Scheduled Job Parallelism** | 10 concurrent | `crates/common/src/knobs.rs:281-282` | ✅ 🔄 🛠️ |

**🔍 Note on Concurrency Defaults**:

The source code base constant `DEFAULT_APPLICATION_MAX_FUNCTION_CONCURRENCY` is **16**
for all function types.
Convex Cloud overrides these via a “big brain” service for Professional plan customers
(256 queries/mutations, 1000 Node actions, etc.).

**🛠️ Self-Hosted Configuration**:

```bash
export APPLICATION_MAX_CONCURRENT_QUERIES=64
export APPLICATION_MAX_CONCURRENT_MUTATIONS=64
export APPLICATION_MAX_CONCURRENT_V8_ACTIONS=64
export APPLICATION_MAX_CONCURRENT_NODE_ACTIONS=64
export APPLICATION_MAX_CONCURRENT_HTTP_ACTIONS=64
export SCHEDULED_JOB_EXECUTION_PARALLELISM=20
```

*Note: Professional plan limits (256, 1000, etc.)
are enforced by Convex Cloud’s “big brain” service, not by these code defaults.*

**Execution Time Limits** ✅ 🔒 🛠️:

| Limit | Value | Source Location | Status |
| --- | --- | --- | --- |
| **Query/Mutation user timeout** | 1 second | `crates/common/src/knobs.rs:692-693` | ✅ 🔒 🛠️ |
| **Query/Mutation system timeout** | 15 seconds | `crates/common/src/knobs.rs:703-704` | ✅ 🔒 🛠️ |
| **Action timeout** | 10 minutes (600s) | `crates/common/src/knobs.rs:119-120` | ✅ 🔒 🛠️ |
| **V8 action system timeout** | 5 minutes (300s) | `crates/common/src/knobs.rs:745-746` | ✅ 🔒 🛠️ |

**Scheduled Functions** ✅ 🔒 🛠️:

| Limit | Value | Source Location | Status |
| --- | --- | --- | --- |
| **Max scheduled per mutation** | 1,000 | `crates/common/src/knobs.rs:254-255` | ✅ 🔒 🛠️ |
| **Total scheduled args** | 16 MiB | `crates/common/src/knobs.rs:269-275` | ✅ 🔒 🛠️ 🔍 |

**🔍 Note**: The source code default for scheduled args is **16 MiB**, not 8 MiB as
sometimes documented.
Variable: `TRANSACTION_MAX_SCHEDULED_TOTAL_ARGUMENT_SIZE_BYTES`

**Key Constraints**:

- Professional customers can request higher Node action concurrency (>1,000) if needed

- Concurrency limits are per-deployment

- Execution time limits cannot be increased

**Common Issues**:

- Dashboard queries that scan large datasets monopolizing query slots

- Long-running data processing in queries/mutations instead of actions

- Recursive scheduling hitting the 1,000 function limit

**Sources**:

- [Convex Limits - Concurrency](https://docs.convex.dev/production/state/limits)

**Important Notes on Action Timeouts**:

Actions have a hard 10-minute (600-second) timeout that cannot be extended.
For operations that may exceed this limit:

1. **Sampling Strategy**: Process a representative subset of data instead of the entire
   dataset

   - Example: Validate first 100,000 records instead of all records

   - Mark results as “sampled” to indicate incomplete coverage

2. **Resumable Pattern**: Store progress in a database table and resume from last
   checkpoint

   - Use a state table to track: `{ operation: string, lastCursor: string, completed:
     boolean }`

   - Each action invocation processes a batch and updates the state

   - Trigger next batch via scheduled function or manual invocation

3. **Scheduled Functions**: Break large operations into smaller cron jobs

   - Schedule multiple functions to run sequentially

   - Each function processes a manageable chunk within timeout

4. **Optimize Efficiency**: Reduce round-trips and increase batch sizes

   - Use larger `numItems` in pagination (up to database limits)

   - Batch multiple operations within single queries/mutations

   - Minimize logging and console output

### 3.1 Logging Limits

**Limit** ✅ 🔒 🔍: 256 log lines per function execution

**Source Code Verification**: `MAX_LOG_LINES: usize = 256` in
`crates/isolate/src/environment/helpers/mod.rs:29`

This limit is not documented in official Convex docs but is verified in source code.

**Applies To**: All function types (queries, mutations, actions, HTTP actions)

**Error Manifestation**: Logs are silently truncated after 256 lines; no error is thrown

**Common Causes**:

- Verbose progress logging in long-running operations (e.g., logging every page during
  pagination)

- Debug logging in loops that process many items

- Excessive error logging when retrying operations

**Workarounds**:

1. **Log Strategically**: Only log major milestones, not every iteration
   ```typescript
   // Bad: Logs 1000+ times for large datasets
   for (let i = 0; i < items.length; i++) {
     console.log(`Processing item ${i}`);
   }
   
   // Good: Logs ~10 times for same dataset
   for (let i = 0; i < items.length; i++) {
     if (i % 100 === 0) {
       console.log(`Progress: ${i}/${items.length} items processed`);
     }
   }
   ```

2. **Use Log Levels**: Reserve `console.log` for important milestones, use structured
   logging for details

3. **External Logging**: For detailed trace logging, send events to external logging
   services (Datadog, Sentry, etc.)

4. **Return Data Instead**: For validation/analysis, return results in function return
   value instead of logging

**Best Practice for Long-Running Actions**:

- Log start, completion, and every N iterations (where N × iterations < 256)

- Example: For 1000+ pages, log every 100 pages = ~10 logs total

- Always log final summary with totals

**Sources**:

- Production experience and testing (limit not explicitly documented in official docs)

### 3.2 Action Memory Limits

**Limits (per action invocation)** ✅ 🔄 🛠️:

| Runtime | Memory Limit | Source Location | Cold Start | Status |
| --- | --- | --- | --- | --- |
| **Convex Runtime** (default) | 64 MB | `crates/common/src/knobs.rs:849-850` | Faster (no cold start) | ✅ 🔄 🛠️ |
| **Node.js Runtime (static)** | 512 MB | `crates/common/src/knobs.rs:1119-1120` | Slower (cold start possible) | ✅ 🔄 🛠️ |
| **Node.js Runtime (dynamic)** | 4,096 MB | `crates/common/src/knobs.rs:1130-1131` | Build/analyze only | ✅ 🔄 🛠️ |

**🛠️ Self-Hosted Configuration**:

For self-hosted deployments, memory limits can be adjusted via environment variables:

```bash
export ISOLATE_MAX_USER_HEAP_SIZE=134217728        # 128 MB for V8 (default 64 MB)
export ISOLATE_MAX_HEAP_EXTRA_SIZE=67108864        # 64 MB extra (default 32 MB)
export AWS_STATIC_LAMBDA_MEMORY_LIMIT_MB=1024     # 1 GB for Node.js (default 512 MB)
```

**Key Constraints**:

- **Default runtime is Convex Runtime** with 64 MB limit—actions without `"use node";`
  directive run here

- **Node.js runtime requires explicit opt-in** via `"use node";` directive at file top

- **Node.js actions have lower argument size limit**: 5 MiB instead of 8 MiB

- **Node.js versions supported**: 20 and 22 (configurable in `convex.json`)

- **File-level directive**: The `"use node";` directive applies to the entire file—you
  cannot mix runtimes in a single file

- **No queries/mutations in Node.js files**: Files with `"use node";` can only contain
  actions, not queries or mutations

**Error Manifestation**: `"JavaScript execution ran out of memory (maximum memory usage:
64 MB)"` for Convex runtime, similar for Node.js at 512 MB

**Common Causes**:

- Processing large API responses or JSON payloads in memory

- Building large data structures for LLM context

- Parsing or transforming large documents

- Memory leaks from accumulating data in loops

**Workaround**: Add `"use node";` directive to switch from 64 MB to 512 MB limit:

```typescript
"use node";

import { internalAction } from "./_generated/server";

export const memoryIntensiveAction = internalAction({
  handler: async (ctx, args) => {
    // Now has 512 MB memory limit instead of 64 MB
    const largeData = await fetchLargePayload();
    return processData(largeData);
  },
});
```

**Trade-offs of Node.js Runtime**:

| Aspect | Convex Runtime | Node.js Runtime |
| --- | --- | --- |
| Memory | 64 MB | 512 MB |
| Cold starts | None | Possible |
| Argument size | 8 MiB | 5 MiB |
| NPM packages | Limited (fetch-based) | Full Node.js ecosystem |
| Performance | Faster startup | Slower startup |

**Best Practice**: Start with Convex runtime (default) for simple actions.
Switch to Node.js runtime only when you need:

- More than 64 MB memory

- Node.js-specific NPM packages

- Node.js APIs not available in Convex runtime

**Limit Configurability**:

These memory limits are **hard limits by default** but can be increased for Professional
plan customers on a case-by-case basis:

| Plan | Default Limits | Can Request Increase? |
| --- | --- | --- |
| **Starter** (Free) | 64 MB / 512 MB | No |
| **Professional** ($25/member/mo) | 64 MB / 512 MB | Yes, contact support |
| **Enterprise** (coming soon) | TBD | Likely customizable |

To request a limit increase, Professional customers can send a support message through
the Convex dashboard or email mailto:support@convex.dev.
Per the docs: “Limits can be lifted for Professional plan customers on a case-by-case
basis … Usually this is only needed if your product has highly bursty traffic.”

**Sources**:

- [Convex Runtimes](https://docs.convex.dev/functions/runtimes) — Runtime comparison and
  `"use node";` directive

- [Convex Actions](https://docs.convex.dev/functions/actions) — Action limits and
  runtime selection

- [Convex Limits](https://docs.convex.dev/production/state/limits) — Official limits
  documentation

- [Convex Contact](https://docs.convex.dev/production/contact) — Support contact for
  limit increases (support@convex.dev)

### 4. Storage and Bandwidth Quotas

*Note: Storage quotas and pricing change periodically.
Verify current values at [Convex Pricing](https://www.convex.dev/pricing).*

**Database Storage** ⚠️ 🔄:

| Plan | Included Storage | Bandwidth/Month | Status |
| --- | --- | --- | --- |
| **Starter** | 0.5 GiB | 1 GiB | ⚠️ 🔄 |
| **Professional** | ~1 GiB+ (verify pricing page) | ~50 GiB (verify) | ⚠️ 🔄 |

*Recent changes (late 2025): Convex updated their pricing model.
Pro plan now includes 1 GB at $0.50/GB/month overage (down from previous $10/GB). Check
official pricing.*

**File Storage** ⚠️ 🔄:

| Plan | Included Storage | Bandwidth/Month | Status |
| --- | --- | --- | --- |
| **Starter** | 1 GiB | 1 GiB | ⚠️ 🔄 |
| **Professional** | (verify pricing page) | (verify) | ⚠️ 🔄 |

**Key Constraints**:

- Database storage includes all tables **and indexes** (indexes are not free)

- Bandwidth includes data transfer for queries, mutations, and file downloads

- Backups consume file storage bandwidth

**Common Issues**:

- Underestimating index storage overhead (especially on large tables)

- Retaining historical data indefinitely without archival strategy

- High-frequency queries on large result sets consuming bandwidth

**Sources**:

- [Convex Limits - Storage](https://docs.convex.dev/production/state/limits)

### 5. Index and Schema Limits

**Index Limits (per table)** ✅ 🔒:

| Limit | Documented | Source Code | Source Location | Status |
| --- | --- | --- | --- | --- |
| **Maximum indexes per table** | 32 | **64** | `crates/common/src/schemas/mod.rs:64` | ✅ 🔒 🔍 |
| **Maximum fields per index** | 16 | 16 | `crates/common/src/bootstrap_model/index/mod.rs:42` | ✅ 🔒 |
| **Maximum index name length** | 64 chars | 64 chars | `crates/sync_types/src/identifier.rs:10` | ✅ 🔒 |

**🔍 Index Count Discrepancy**:

The source code constant `MAX_INDEXES_PER_TABLE` is **64**, not 32 as documented.
This is the total across all index types (database indexes, text indexes, and vector
indexes).

**Schema Limits (per deployment)** ✅ 🔒:

| Limit | Value | Source Location | Status |
| --- | --- | --- | --- |
| **Maximum tables** | 10,000 | `crates/database/src/bootstrap_model/table.rs:62` | ✅ 🔒 |
| **Maximum user modules** | 4,096 | `crates/common/src/knobs.rs:1329-1330` | ✅ 🔒 🛠️ |

**Full-Text Search Indexes** ✅ 🔒:

| Limit | Value | Source Location | Status |
| --- | --- | --- | --- |
| **Maximum full-text indexes per table** | 4 | Docs (within 64 total) | ✅ 🔒 |
| **Maximum filters per full-text index** | 16 | `crates/common/src/bootstrap_model/index/mod.rs:43` | ✅ 🔒 |
| **Maximum results per query** | 1,024 | `crates/search/src/constants.rs:18` | ✅ 🔒 |

**Vector Search Indexes** ✅ 🔒:

| Limit | Value | Source Location | Status |
| --- | --- | --- | --- |
| **Maximum vector indexes per table** | 4 | Docs (within 64 total) | ✅ 🔒 |
| **Maximum filters per vector index** | 16 | `crates/common/src/bootstrap_model/index/mod.rs:44` | ✅ 🔒 |
| **Maximum dimensions** | 4,096 | `crates/common/src/bootstrap_model/index/vector_index/dimensions.rs:6` | ✅ 🔒 |
| **Maximum results per query** | 256 (default 10) | `crates/vector/src/lib.rs:64` | ✅ 🔒 |
| **Maximum indexed documents** | 100,000 per vector index | Docs | ✅ 🔒 |

**Key Constraints**:

- Index fields must be queried in the same order they are defined

- To query `field1` then `field2` AND `field2` then `field1`, you need two separate
  indexes

- Indexes add overhead during document insertion

- All index types (database, text, vector) share the 64 total indexes per table limit

**Sources**:

- [Convex Limits - Indexes](https://docs.convex.dev/production/state/limits)

- Source: `crates/common/src/schemas/mod.rs`,
  `crates/common/src/bootstrap_model/index/mod.rs`

### 6. Function and Code Limits

**Function Invocation Limits** ✅ 🔄:

| Resource | Starter Plan | Professional Plan | Status |
| --- | --- | --- | --- |
| **Function Calls/Month** | 1,000,000 | 25,000,000 | ✅ 🔄 |
| **Action Execution** | 20 GiB-hours | 250 GiB-hours | ⚠️ 🔄 |

**Code and Argument Limits** ⚠️ 🔒:

- **Maximum deployment code size**: 32 MiB ⚠️ (not verified in recent search)

- **Maximum argument size**: 8 MiB per function call ✅ (Convex Runtime); 5 MiB (Node.js)

- **Maximum return value size**: 8 MiB per function call ✅

**Team Limits** ✅ 🔄:

- **Starter**: 1–6 developers ✅

- **Professional**: Up to 25 developers per month ⚠️

**Environment Variables** ✅ 🔒:

| Limit | Documented | Source Code | Source Location | Status |
| --- | --- | --- | --- | --- |
| **Maximum environment variables** | 100 | **1,000** | `crates/common/src/knobs.rs:1537-1538` | ✅ 🔒 🔍 🛠️ |
| **Maximum variable name length** | 40 chars | 40 chars | `crates/common/src/types/environment_variables.rs:66` | ✅ 🔒 |
| **Maximum variable value length** | N/A | 8,192 bytes | `crates/common/src/types/environment_variables.rs:69` | ✅ 🔒 |

**🔍 Env Var Count Discrepancy**:

The source code default `ENV_VAR_LIMIT` is **1,000**, not 100 as documented.
This is configurable via the `ENV_VAR_LIMIT` environment variable for self-hosted
deployments.

**Sources**:

- [Convex Limits - Functions](https://docs.convex.dev/production/state/limits)

- Source: `crates/common/src/knobs.rs:1537-1538`,
  `crates/common/src/types/environment_variables.rs`

### 7. Runtime Architecture and Isolation Model

Understanding how Convex executes functions is critical for designing concurrent
workloads like experiments running multiple agent threads.

#### 7.1 V8 Isolate Architecture ✅

Convex uses **V8 JavaScript isolates** rather than containerized serverless functions
(like AWS Lambda). This provides:

- **Fast cold starts**: ~10ms to spin up an isolate vs 500ms–10s for Lambda

- **Low-latency database I/O**: No network hop between function and database

- **Memory isolation**: Each isolate has completely isolated memory

**Key constraint**: V8 has a limit of 128 threads per process, which led Convex to
create the Funrun service for horizontal scaling (see below).

**Sources**:

- [How We Horizontally Scaled Function
  Execution](https://stack.convex.dev/horizontally-scaling-functions)

- [How Convex Works](https://stack.convex.dev/how-convex-works)

#### 7.2 Function Execution Model ✅

**Per-invocation isolation**:

| Aspect | Behavior | Status |
| --- | --- | --- |
| **Memory per invocation** | 64 MB (Convex Runtime) or 512 MB (Node.js) | ✅ |
| **Isolate reuse** | Isolates reused only for same backend; contexts never reused between requests | ✅ |
| **Security boundary** | Fresh isolate context per request for security | ✅ |

**What this means for concurrent experiments**:

When you run an experiment with multiple threads, each calling actions/mutations:

1. **Each action invocation gets its own isolate context** with its own memory limit (64
   MB or 512 MB depending on runtime)

2. **Memory limits are per-invocation, not shared** - Thread A’s action using 50 MB
   doesn’t reduce Thread B’s available memory

3. **Isolates are pooled within the backend** - The scheduler picks an existing isolate
   from the same backend when possible, otherwise creates new

4. **Each `ctx.runAction()` call is a separate invocation** - Calling runAction creates
   a new function invocation with its own memory quota

#### 7.3 Funrun: Horizontal Scaling Service ✅

Before Funrun (pre-March 2024):

- Functions ran inside the backend process in V8 isolates

- Limited to 128 concurrent threads per deployment

- Scaling was constrained by V8’s threading model

After Funrun (March 2024+):

- Function execution is a separate multi-tenant service ("Funrun")

- Backend sends function requests to any Funrun instance

- Funrun executes, returns results to backend for conflict checking

- **Professional customers can run 10x more concurrent functions**

**Architecture diagram** (simplified):

```
┌──────────────┐     ┌──────────────┐     ┌──────────────┐
│   Client     │────▶│   Backend    │────▶│   Funrun     │
│  (your app)  │     │  (per-deploy)│     │ (multi-tenant)│
└──────────────┘     └──────────────┘     └──────────────┘
                            │                    │
                            ▼                    ▼
                     ┌──────────────┐     ┌──────────────┐
                     │  Database    │     │ V8 Isolates  │
                     │  (commits)   │     │ (execution)  │
                     └──────────────┘     └──────────────┘
```

**Sources**:

- [How We Horizontally Scaled Function
  Execution](https://stack.convex.dev/horizontally-scaling-functions)

#### 7.4 Local Development vs Cloud vs Self-Hosted ✅

| Deployment Mode | Architecture | Memory Limits | Scaling |
| --- | --- | --- | --- |
| **Local (`npx convex dev`)** | Backend runs as subprocess, SQLite storage | Same 64/512 MB limits | Single process, V8 threading limits |
| **Cloud (Convex Cloud)** | Funrun service, managed infrastructure | Same 64/512 MB limits | Horizontal scaling via Funrun |
| **Self-Hosted** | Same OSS code as cloud, single machine by default | Same 64/512 MB limits | Single machine unless you modify Funrun |

**Key insight**: Memory limits (64 MB / 512 MB) are enforced at the V8 isolate level, so
they apply **identically** across all deployment modes.
The difference is in concurrency scaling, not per-function memory.

**Local development specifics**:

- Backend runs as subprocess of `npx convex dev`

- Database stored locally (SQLite by default)

- Function calls don’t count against cloud quotas

- Same isolation model, just running locally

**Self-hosted specifics**:

- Same open-source code as cloud service

- By default, runs on single machine (no Funrun scaling)

- Can be modified to scale horizontally

**Sources**:

- [Local Deployments for Development](https://docs.convex.dev/cli/local-deployments)

- [Self-Hosting with Convex](https://stack.convex.dev/self-hosted-develop-and-deploy)

- [Self-Hosting Documentation](https://docs.convex.dev/self-hosting)

#### 7.5 Implications for Multi-Threaded Experiments 📝

When running experiments with multiple concurrent agent threads:

1. **Each action invocation is independent** - Memory limits apply per-action, not
   shared across your experiment threads

2. **Concurrency limits matter more than memory** - On Starter plan, you’re limited to
   ~~64 concurrent actions; Professional gets ~~256+ with Funrun scaling

3. **OCC conflicts are the bigger concern** - Multiple threads writing to the same
   documents will cause retry loops (see Pitfall 5)

4. **Scheduled functions have separate limits** - If you schedule many functions from
   one mutation, you hit the 1,000 function / 8 MiB argument limit per mutation

**Practical example**:

Running 10 agent threads, each doing parallel actions:

```
Thread 1 ─▶ Action (64 MB isolate) ─▶ Query + Mutation
Thread 2 ─▶ Action (64 MB isolate) ─▶ Query + Mutation
...
Thread 10 ─▶ Action (64 MB isolate) ─▶ Query + Mutation
```

Each thread’s action has its own 64 MB (or 512 MB if `"use node";`). They don’t share
memory. But they do compete for:

- Concurrency slots (Professional: 256 actions)

- Database OCC (if writing same documents)

- Function call quotas (monthly limit)

### 8. File Storage Limits

File storage in Convex is separate from document storage and has its own constraints.

**Upload Limits** ✅ 🔒 🛠️:

| Limit | Value | Source Location | Status |
| --- | --- | --- | --- |
| **Concurrent uploads (deployment)** | 4 | `knobs.rs:845-846` | ✅ 🛠️ |
| **Parallel upload parts (internal)** | 8 | `storage/src/lib.rs:92` | ✅ |
| **Max file size (theoretical)** | 2 TB | S3 multipart limit (10,000 parts × 200 MiB) | ✅ |
| **Multipart upload buffer** | 200 MiB | `knobs.rs:1418-1420` | ✅ 🛠️ |

**URL and Access**:

| Behavior | Details | Status |
| --- | --- | --- |
| **Signed URL expiration** | Configurable (typically short-lived for security) | ✅ |
| **Presigned upload URLs** | Generated via `storage.generateUploadUrl()` | ✅ |
| **File retrieval** | Via `storage.getUrl()` returning signed URLs | ✅ |

**Storage Quotas** (see Section 4 for plan-specific limits):

- File storage is billed separately from database storage

- Bandwidth includes file downloads

- Files are stored in S3-compatible object storage

**Key Constraints**:

- `APPLICATION_MAX_CONCURRENT_UPLOADS` limits simultaneous file uploads during
  deployment

- Large files use multipart upload automatically

- File metadata (size, content type) is stored alongside the file

**Sources**:

- `crates/storage/src/lib.rs` — Storage implementation

- `crates/file_storage/` — File storage API

- `crates/common/src/knobs.rs:845-846, 1416-1420` — Configurable limits

### 9. HTTP Actions Limits

HTTP actions (`httpAction` in `convex/http.ts`) have specific limits for
request/response handling.

**Body Size Limits** ✅ 🔒:

| Limit | Value | Source Location | Status |
| --- | --- | --- | --- |
| **Request body limit** | 20 MiB | `udf/src/http_action.rs:30` | ✅ 🔒 |
| **Response body limit** | 20 MiB | `udf/src/http_action.rs:30` | ✅ 🔒 |
| **Multipart form body** | 20 MiB | `isolate/src/environment/action/stream.rs:21` | ✅ 🔒 |

**Timeout Behavior**:

HTTP actions inherit the standard action timeout (10 minutes), but are also subject to:

| Timeout | Value | Affects | Status |
| --- | --- | --- | --- |
| **Action user timeout** | 10 minutes | Total execution time | ✅ 🛠️ |
| **HTTP server timeout** | 5 minutes | Request processing | ✅ 🛠️ 🔍 |

**Concurrency** ✅ 🔄 🛠️:

| Limit | Default | Professional | Env Var |
| --- | --- | --- | --- |
| **Concurrent HTTP actions** | 16 | 256+ | `APPLICATION_MAX_CONCURRENT_HTTP_ACTIONS` |

**Request Handling**:

- Headers are normalized (lowercase keys)

- Body is streamed (not buffered entirely in memory for large requests)

- CORS must be handled manually in your HTTP action code

**Response Handling**:

- Responses exceeding 20 MiB trigger `HttpResponseTooLarge` error

- Streaming responses are supported but still subject to total size limit

- Content-Type must be set explicitly

**Error Messages**:

| Error | Cause | Solution |
| --- | --- | --- |
| `HttpResponseTooLarge` | Response body > 20 MiB | Paginate or use file storage |
| Request timeout | HTTP server timeout (5 min) | Break into smaller operations |

**Sources**:

- `crates/udf/src/http_action.rs:30` — Body limit constant

- `crates/isolate/src/environment/action/mod.rs:605-614` — Response size enforcement

- `crates/isolate/src/environment/action/stream.rs:17-21` — Multipart limit

### 10. Cron Jobs Limits

Cron jobs in Convex have specific retention and execution constraints.

**Scheduling Limits** ✅ 🔒:

| Limit | Value | Source Location | Status |
| --- | --- | --- | --- |
| **Logs retained per cron job** | 5 | `model/src/cron_jobs/mod.rs:161` | ✅ 🔒 |
| **Log result max length** | 1,000 chars | `application/src/cron_jobs/mod.rs:95` | ✅ 🔒 |
| **Log line max length** | 1,000 chars | `application/src/cron_jobs/mod.rs:96` | ✅ 🔒 |

**Execution Behavior**:

| Aspect | Behavior | Status |
| --- | --- | --- |
| **Execution type** | Cron jobs run as mutations or actions | ✅ |
| **Timeout** | Inherits from function type (1s mutation, 10 min action) | ✅ |
| **Retry semantics** | No automatic retry on failure | ✅ |
| **Concurrency** | Cron jobs compete for normal function concurrency slots | ✅ |

**Cron Syntax**:

Convex uses standard cron syntax with 5 fields:

```
┌───────────── minute (0-59)
│ ┌───────────── hour (0-23)
│ │ ┌───────────── day of month (1-31)
│ │ │ ┌───────────── month (1-12)
│ │ │ │ ┌───────────── day of week (0-6, Sunday=0)
│ │ │ │ │
* * * * *
```

**Log Retention**:

- Only the **5 most recent logs** are retained per cron job

- Older logs are garbage collected automatically

- Log content is truncated at 1,000 characters

**Best Practices**:

1. **Keep cron jobs lightweight** — Use them to trigger work, not do heavy processing

2. **Handle failures gracefully** — No automatic retry means you need error handling

3. **Monitor execution** — Only 5 logs retained, so use external monitoring for history

4. **Avoid long-running crons** — Use scheduled functions for complex work chains

**Sources**:

- `crates/model/src/cron_jobs/mod.rs` — Cron job model and retention

- `crates/application/src/cron_jobs/mod.rs` — Execution and logging

- [Convex Cron Jobs Docs](https://docs.convex.dev/scheduling/cron-jobs)

### 11. Durable Workflows

Durable workflows in Convex (via `@convex-dev/workflow` package) have specific limits
for state management and execution.

**Package-Level Limits** ✅:

| Limit | Value | Rationale | Status |
| --- | --- | --- | --- |
| **Workflow journal** | 8 MiB | Total serialized state (subset of function result limit) | ✅ |
| **Step data** | 1 MiB | Args + return per step (matches document limit) | ✅ |
| **Recommended max steps** | ~50 | Beyond this, replay timeout risk increases | ⚠️ |

**Execution Constraints**:

| Constraint | Value | Notes |
| --- | --- | --- |
| **Workflow handler timeout** | 1 second | Workflows run as mutations |
| **Step action timeout** | 10 minutes | External work in `step.runAction()` |
| **Replay budget** | Must complete within mutation timeout | Journal replay counts toward timeout |

**Workflow Patterns**:

1. **Checkpoint-Based Orchestration**:

   - Workflow handler (mutation) coordinates steps

   - Each step is checkpointed to journal

   - On crash/timeout, workflow resumes from last checkpoint

2. **Fire-and-Forget Chains**:

   - For workflows spanning days, use `ctx.scheduler.runAfter()`

   - Chain workflows: Day 1 workflow schedules Day 2 workflow

   - Scheduler retention: 7 days (see Section 3)

3. **Pass-by-Reference Pattern**:

   - Store large payloads in documents, pass IDs through workflow

   - Avoids hitting journal and step data limits

   - Required for LLM responses, large datasets

**Memory Considerations**:

| Runtime | Heap | When to Use |
| --- | --- | --- |
| **Convex Runtime (V8)** | 64 MB | Simple workflows, quick operations |
| **Node.js** (`"use node";`) | 512 MB | LLM calls, large data processing |

**Step Count Guidelines**:

- **< 20 steps**: Safe for most workflows

- **20-50 steps**: Monitor replay time, consider chunking

- **> 50 steps**: High risk of replay timeout; use fire-and-forget chains

**Key Constraints**:

1. **Journal size** — Total workflow state must fit in 8 MiB

2. **Replay time** — All steps replay on each handler invocation

3. **Idempotency** — Steps must be idempotent (may replay on retry)

4. **Serialization** — All step data must be JSON-serializable

**Sources**:

- [Convex Workflow Component](https://github.com/get-convex/workflow)

- [Durable Workflows Architecture](../../../project/research/current/research-convex-durable-workflows-architecture.md)

- `@convex-dev/workflow` package documentation

* * *

## Function Calling Rules and Composition Patterns

Understanding which Convex functions can call other functions is critical for designing
correct architectures.
Violating these rules leads to runtime errors or architectural issues.

### Function Type Call Matrix

| Caller Type | Can Call | Method | Use Case |
| --- | --- | --- | --- |
| **Query** | Helper functions | Direct call | Extract shared read logic |
| **Query** | Other queries | ❌ **NO** | No `ctx.runQuery` in queries |
| **Query** | Mutations | ❌ **NO** | Queries are read-only |
| **Mutation** | Helper functions | Direct call | Extract shared write logic |
| **Mutation** | Other mutations | ❌ **NO** | No `ctx.runMutation` in mutations |
| **Mutation** | Queries | ❌ **NO** | Use helper functions instead |
| **Action** | Queries | Yes | `ctx.runQuery(internal.*)` |
| **Action** | Mutations | Yes | `ctx.runMutation(internal.*)` |
| **Action** | Other actions | Yes | `ctx.runAction(internal.*)` |
| **Action** | Schedule functions | Yes | `ctx.scheduler.runAfter(...)` |

### Key Principles

1. **Queries and mutations cannot call other queries/mutations**

   - They can only call helper functions that take their context as an argument

   - This enforces single-transaction semantics

2. **Actions are the orchestration layer**

   - Actions coordinate between queries and mutations

   - Multiple `runQuery`/`runMutation` calls execute in separate transactions

3. **Transactional boundaries**

   - Each query/mutation is one transaction

   - Actions can compose multiple transactions

   - No guarantees of consistency across action-orchestrated calls

4. **Avoid nested action calls within the same runtime** ✅

   - While `ctx.runAction()` is technically allowed, Convex officially recommends
     against calling actions from actions **in the same runtime**

   - Use `ctx.runAction()` **only** when crossing runtimes (V8 → Node.js)

   - For same-runtime calls, extract shared code into plain TypeScript helper functions

   - **Official guidance** ([Convex Actions
     Docs](https://docs.convex.dev/functions/actions)):
     > “If you want to call an action from another action that’s in the same runtime,
     > which is the normal case, the best way to do this is to pull the code you want to
     > call into a TypeScript helper function and call the helper instead.”

   - **Observed behavior**: Nested same-runtime action calls can silently timeout at ~5
     minutes (undocumented implementation detail)

### Pattern: Helper Functions for Shared Logic

**Correct pattern for sharing logic within queries/mutations**:

```typescript
// Helper function - takes context as parameter
async function getCompletedRecords(ctx: QueryCtx, userId: Id<'users'>) {
  return await ctx.db
    .query('records')
    .withIndex('by_user', q => q.eq('userId', userId))
    .filter(q => q.eq(q.field('status'), 'completed'))
    .collect();
}

// Use helper in multiple queries
export const getUserStats = query({
  handler: async (ctx, { userId }) => {
    const records = await getCompletedRecords(ctx, userId); // Helper call
    return { totalRecords: records.length };
  },
});

export const getUserHistory = query({
  handler: async (ctx, { userId }) => {
    const records = await getCompletedRecords(ctx, userId); // Reuse helper
    return records.map(r => ({ id: r._id, date: r.createdAt }));
  },
});
```

### Pattern: Actions Orchestrating Queries and Mutations

**Correct pattern for composing operations across transactions**:

```typescript
// Action orchestrates query + mutation
export const processData = internalAction({
  handler: async (ctx, { recordId }) => {
    // 1. Read data (separate transaction)
    const data = await ctx.runQuery(internal.data.getData, { recordId });

    // 2. Process data (JavaScript, no transaction)
    const processed = transform(data);

    // 3. Write results (separate transaction)
    await ctx.runMutation(internal.data.updateStats, {
      recordId,
      stats: processed,
    });
  },
});
```

**Important**: The query and mutation above are **not atomic**. Another mutation could
modify data between the query and mutation calls.

### Pattern: Atomic Operations in Single Mutations

**When you need atomicity, consolidate into one mutation**:

```typescript
// WRONG: Action with race condition
export const incrementCounter = internalAction({
  handler: async (ctx, { counterId }) => {
    const counter = await ctx.runQuery(internal.getCounter, { counterId });
    await ctx.runMutation(internal.updateCounter, {
      counterId,
      value: counter.value + 1  // Race condition!
    });
  },
});

// CORRECT: Single atomic mutation
export const incrementCounter = mutation({
  args: { counterId: v.id('counters') },
  handler: async (ctx, { counterId }) => {
    const counter = await ctx.db.get(counterId);
    if (!counter) throw new Error('Counter not found');

    await ctx.db.patch(counterId, {
      value: counter.value + 1, // Atomic - no race condition
    });
  },
});
```

### Sources

- [Convex Functions Documentation](https://docs.convex.dev/functions)

- [Actions Documentation](https://docs.convex.dev/functions/actions)

- [Query Functions](https://docs.convex.dev/functions/query-functions)

- [Mutation Functions](https://docs.convex.dev/functions/mutation-functions)

* * *

## Common Pitfalls and Workarounds

This section catalogs frequent issues encountered when building applications on Convex,
organized by category for easier reference.
Each pitfall includes symptoms, root causes, and proven mitigation strategies.

### Database Pitfalls

These pitfalls relate to reading and writing data, document structure, and query design.

#### Pitfall: Exceeding 8 MiB Read Limit with `.collect()`

**Symptom**: Runtime error `"transaction exceeded resource limits"` when querying tables
with many documents or large documents.

**Root Cause**: Using `.collect()` on queries that return large result sets.
Since Convex reads entire documents (no field projection), even seemingly small document
counts can exceed 8 MiB if individual documents are large.

**Example Scenario**:

```typescript
// DANGEROUS: Will fail if events table is large
const allEvents = await ctx.db.query('events').collect();
```

**Workarounds**:

1. **Use `.take(n)` for fixed limits**:

   ```typescript
   // Safe: Only reads first 100 documents
   const recentEvents = await ctx.db
     .query('events')
     .order('desc')
     .take(100);
   ```

2. **Use `.paginate(paginationOpts)` for cursor-based pagination**:

   ```typescript
   export const listEvents = query({
     args: { paginationOpts: paginationOptsValidator },
     handler: async (ctx, args) => {
       return await ctx.db
         .query('events')
         .order('desc')
         .paginate(args.paginationOpts);
     },
   });
   ```

3. **Use head+1 pattern for “N+” labels**:
   ```typescript
   const events = await ctx.db.query('events').take(limit + 1);
   const hasMore = events.length > limit;
   const displayLabel = hasMore ? `${limit}+` : `${events.length}`;
   ```

**Best Practice**: Never use `.collect()` on tables that can grow unbounded.
Always use `.take()` or `.paginate()`.

**Sources**:

- [Pagination Guide](https://docs.convex.dev/database/pagination)

- [Queries that Scale](https://stack.convex.dev/queries-that-scale)

#### Pitfall: Large Documents Causing Read Limit Issues Even with `.take()`

**Symptom**: Queries fail with read limit error even when using `.take(n)` with small
values of `n`.

**Root Cause**: Individual documents are large (approaching 1 MiB limit), so reading
even 10–15 documents exceeds the 8 MiB transaction limit.

**Example Scenario**:

```typescript
// Can still fail if message documents have ~900KB content fields
const rows = await ctx.db
  .query('messages')
  .withIndex('by_parent', (q) => q.eq('parentId', parentId))
  .take(10); // 10 × 900KB = 9 MiB > 8 MiB limit
```

**Workarounds**:

1. **Separate large payloads into detail tables**:

   ```typescript
   // Keep main table light for listing/counting
   messages: {
     parentId: v.id('threads'),
     timestamp: v.number(),
     role: v.string(),
     contentSummary: v.string(), // Small snippet
     detailId: v.id('messageDetails'), // Link to full content
   }
   
   // Store large content separately
   messageDetails: {
     fullContent: v.string(), // Large field
     metadata: v.object({ ... }),
   }
   ```

2. **Pre-aggregate counters instead of scanning**:

```typescript
// Maintain counts at write time instead of scanning large documents
const count = thread.messageCount; // Pre-computed
// Instead of:
// const count = (await ctx.db.query(...).collect()).length; // SLOW
```

3. **Use the Convex Aggregate Component** (see Pitfall 3): Official library for
   maintaining statistics without scanning source tables.

**Best Practice**: Keep documents used for listing, counting, and filtering small
(<10KB). Store large payloads in separate detail tables fetched on-demand.

**Sources**:

- [Convex Limits - Document Size](https://docs.convex.dev/production/state/limits)

### Aggregation Pitfalls

These pitfalls relate to counting, summing, and computing statistics over data.

#### Pitfall: Counting and Aggregating Over Large Datasets

**Symptom**: Need accurate counts, sums, or other aggregates over thousands to millions
of records, but scanning exceeds read limits.

**Root Cause**: Computing aggregates at query time by scanning all records is
incompatible with 8 MiB read limit for large datasets.

**Example Scenario**:

```typescript
// SLOW and will fail at scale
const errorCount = (await ctx.db.query('events')
  .withIndex('by_type', q => q.eq('eventType', 'error'))
  .collect()).length;
```

**Workarounds**:

1. **Use the official Convex Aggregate Component**:

   The [Convex Aggregate Component](https://github.com/get-convex/aggregate) provides
   O(log n) queries for counts and sums using an internal B-tree structure.

   ```typescript
   import { Aggregate } from '@convex-dev/aggregate';
   
   // Define aggregate
   const eventAggregate = new Aggregate<typeof schema.events>(components.aggregate, {
     filterKey: (event) => event.parentId,
     sumFields: { tokenCount: 0 },
   });
   
   // Query aggregates efficiently
   const stats = await eventAggregate.count(ctx, {
     prefix: parentId,
     bounds: { lower: ['error'], upper: ['error'] },
   });
   ```

**Key Features**:

- **Namespaces**: Isolate aggregates by entity (per-user, per-project, etc.)

- **Structured Keys**: Multi-level keys for flexible filtering

- **Sum Fields**: Track numeric aggregates (tokens, costs, etc.)

- **Batch Operations**: `countBatch()`, `sumBatch()`, `atBatch()` for efficient
  multi-query operations

- **Automatic Atomicity**: Handles concurrent writes correctly

- **TableAggregate wrapper**: Keeps aggregates in sync with table writes automatically

2. **Maintain counters at write time**:

```typescript
// Update counters when inserting events
await ctx.db.patch(entityId, {
 errorCount: (record.errorCount ?? 0) + 1,
 totalTokens: (record.totalTokens ?? 0) + tokens,
});
```

**Limitation**: Requires careful handling of concurrent updates and doesn’t support
ad-hoc filtering.

3. **Statistical sampling for approximate counts**:
   ```typescript
   const sample = await ctx.db.query('events').take(1000);
   const errorRate = sample.filter((e) => e.type === 'error').length / sample.length;
   const estimatedTotal = errorRate * totalEvents;
   ```
   **Limitation**: Not exact, unsuitable for critical metrics.

**Best Practice**: Use the Convex Aggregate Component for any aggregation over datasets
that can grow beyond a few hundred documents.

**Sources**:

- [Convex Aggregate Component](https://github.com/get-convex/aggregate)

#### Pitfall: Post-Index Filtering Instead of Composite Indexes

*Category: Database - placed here for topical flow with query optimization*

**Symptom**: Queries are slow or hit read limits even when using indexes.

**Root Cause**: Using `.withIndex()` to narrow results by one field, then using
`.filter()` to narrow by another field.
This causes Convex to read all documents matching the index, including those filtered
out.

**Example Scenario**:

```typescript
// INEFFICIENT: Reads all items for parentId, then filters
const items = await ctx.db
  .query('items')
  .withIndex('by_parent', (q) => q.eq('parentId', parentId))
  .filter((q) => q.eq(q.field('status'), 'active'))
  .take(100);
```

**Workaround**: Create composite indexes that include all filter conditions.

```typescript
// schema.ts
items: defineTable({
  parentId: v.id('parents'),
  status: v.string(),
  ...
}).index('by_parent_and_status', ['parentId', 'status'])

// Query using composite index
const items = await ctx.db
  .query('items')
  .withIndex('by_parent_and_status', q =>
    q.eq('parentId', parentId).eq('status', 'active')
  )
  .take(100);
```

**Best Practice**: Design indexes to match your query patterns.
Prefer composite indexes over post-index filtering.

**Sources**:

- [Indexes and Query Performance](https://docs.convex.dev/database/reading-data/indexes)

- [Queries that Scale](https://stack.convex.dev/queries-that-scale)

### Concurrency Pitfalls

These pitfalls relate to concurrent writes, OCC conflicts, and write contention.

#### Pitfall: Optimistic Concurrency Control (OCC) Conflicts

**Symptom**: Mutations fail or retry frequently with errors related to conflicting
writes, especially under high concurrency.

**Root Cause**: Multiple mutations trying to read and update the same documents
concurrently. Convex uses Optimistic Concurrency Control—if a mutation reads a document
that another mutation modifies before the first completes, it retries.

**Example Scenario**:

```typescript
// Multiple concurrent mutations updating the same counter
const record = await ctx.db.get(recordId);
await ctx.db.patch(recordId, {
  eventCount: record.eventCount + 1, // OCC conflict if another mutation updates this
});
```

**Workarounds**:

1. **Consolidate related writes into single mutations**:

   Combine operations that update the same document into a single atomic mutation
   instead of calling multiple mutations from an action.

```typescript
// WRONG: Action calls two mutations - race condition
export const startWorkflow = internalAction(async (ctx, args) => {
  const sessionId = await ctx.runMutation(internal.createSession, ...);
  const workflowId = await ctx.runMutation(internal.createWorkflow, ...); // Race!
});

// CORRECT: Single mutation does both operations atomically
export const createSessionAndWorkflow = mutation({
  handler: async (ctx, args) => {
    const sessionId = await ctx.db.insert('sessions', ...);
    const workflowId = await ctx.db.insert('workflows', { sessionId, ... });
    return { sessionId, workflowId };
  },
});
```

2. **Batch create operations in single mutations**:

   When creating many related entities, do it in a single mutation instead of a loop:

   ```typescript
   // WRONG: Loop calling mutation - OCC conflicts possible
   for (const config of configs) {
     await ctx.runMutation(internal.createEntity, config);
   }
   
   // CORRECT: Single mutation creates all entities
   export const createEntities = internalMutation({
     handler: async (ctx, { configs }) => {
       const ids = [];
       for (const config of configs) {
         ids.push(await ctx.db.insert('entities', config));
       }
       return ids;
     },
   });
   ```

3. **Stagger concurrent scheduled mutations**:

   When scheduling multiple mutations that may write to related documents, add small
   delays:

   ```typescript
   // Schedule mutations with stagger to reduce simultaneous writes
   for (let i = 0; i < items.length; i++) {
     await ctx.scheduler.runAfter(
       100 * i, // 100ms delay per item
       internal.processItem,
       { itemId: items[i] }
     );
   }
   ```

4. **Use namespacing to isolate writes**:

   Ensure different entities write to different documents.
   For example, use per-entity aggregates instead of global counters.

5. **Use the Aggregate Component with namespaces**:

   The Aggregate Component handles concurrency internally and supports per-entity
   namespaces to minimize contention.

   ```typescript
   // Each entity has its own aggregate namespace - no cross-entity conflicts
   await eventAggregate.insert(ctx, {
     namespace: entityId,
     value: event,
   });
   ```

6. **Avoid wide aggregate reads**:

   Reading without bounds can create large read dependency sets, amplifying reactivity
   and OCC conflicts. Always use tight bounds:

   ```typescript
   // WIDE: Triggers reruns on any aggregate change
   const count = await aggregate.count(ctx, { prefix: entityId });
   
   // BOUNDED: Only reruns when matching records change
   const count = await aggregate.count(ctx, {
     prefix: entityId,
     bounds: { lower: ['error'], upper: ['error'] },
   });
   ```

7. **Lazy root evaluation**: Configure aggregates with `rootLazy: true` to reduce write
   contention at the cost of slightly slower reads.

**Best Practices Summary**:

- Consolidate related database operations into single atomic mutations

- Batch create operations instead of loops calling mutations

- Design mutations to minimize shared write dependencies

- Use namespacing and bounded reads extensively

- Stagger scheduled mutations that may conflict

**Workflow-Specific Idempotency**:

When using `@convex-dev/workflow` or `@convex-dev/workpool`, additional idempotency
requirements apply beyond OCC conflict handling:

- **Workflow retries are automatic**: Even successful actions may re-run if the
  scheduler has a transient failure recording the return value

- **Check before executing**: Workflow step actions should query for existing results
  before performing work (e.g., check for summary event by step index)

- **Write-through pattern**: Write results to DB inside actions, return only IDs to
  avoid re-processing on retry

**See Also**:

- [research-durable-workflows-agent-conversations.md](../../../project/research/current/research-durable-workflows-agent-conversations.md)
  § “Idempotency Requirements for Workflow Steps” for idempotency patterns

- [plan-2026-01-09-durable-workflows-agent-conversations-v3.md](../../../project/specs/active/plan-2026-01-09-durable-workflows-agent-conversations-v3.md)
  § “Idempotency Contract” for implementation-ready details

**🛠️ OCC Configuration (Self-Hosted)**:

The OCC retry behavior is configurable via environment variables:

| Setting | Default | Env Var | Source |
| --- | --- | --- | --- |
| Max retries | 4 | `UDF_EXECUTOR_OCC_MAX_RETRIES` | `knobs.rs:146-147` |
| Initial backoff | 10ms | `UDF_EXECUTOR_OCC_INITIAL_BACKOFF_MS` | `knobs.rs:150-151` |
| Max backoff | 2,000ms | `UDF_EXECUTOR_OCC_MAX_BACKOFF_MS` | `knobs.rs:154-155` |

Self-hosted deployments with lower contention could reduce retries; high-contention
scenarios might benefit from longer backoffs:

```bash
export UDF_EXECUTOR_OCC_MAX_RETRIES=8
export UDF_EXECUTOR_OCC_INITIAL_BACKOFF_MS=20
export UDF_EXECUTOR_OCC_MAX_BACKOFF_MS=5000
```

**Sources**:

- [Convex Aggregate Component](https://github.com/get-convex/aggregate)

- [@convex-dev/workpool](https://www.npmjs.com/package/@convex-dev/workpool) — “you
  should ensure that each step is an idempotent Convex action”

- Source: `crates/common/src/knobs.rs:146-155`

### Operations Pitfalls

These pitfalls relate to storage, bandwidth, costs, and operational concerns.

#### Pitfall: Storage and Bandwidth Overages

**Symptom**: Unexpected costs from exceeding included storage or bandwidth quotas.

**Root Cause**: Retaining historical data indefinitely, underestimating index overhead,
or high-frequency queries on large result sets.

**Example Scenario**:

- Application stores detailed logs for every record indefinitely

- Indexes on large tables consume significant storage

- Dashboard queries transfer large amounts of data on every refresh

**Workarounds**:

1. **Implement data archival policies**:

   ```typescript
   // Archive completed runs to external storage (S3, etc.)
   export const archiveOldRuns = internalAction({
     handler: async (ctx, args) => {
      const oldRecords = await ctx.runQuery(internal.records.getCompleted, {
         beforeDate: Date.now() - 90 * 24 * 60 * 60 * 1000, // 90 days
       });
   
      for (const record of oldRecords) {
         // Export to S3
        await exportRecordToS3(record);
         // Delete from Convex
        await ctx.runMutation(internal.records.delete, { recordId: record._id });
       }
     },
   });
   ```

2. **Monitor storage and bandwidth proactively**:

   - Set up alerts at 75-80% of quota limits

   - Review Convex dashboard metrics monthly

   - Track growth trends to project future costs

3. **Optimize indexes**:

   - Remove unused indexes

   - Consider whether all composite index combinations are necessary

   - Index storage counts toward database storage quota

4. **Reduce bandwidth consumption**:

   - Use pagination to limit result set sizes

   - Cache frequently-accessed read-only data on the client

   - Avoid polling with reactive queries; use Convex’s real-time subscriptions instead

**Best Practice**: Design archival strategy before hitting quota limits.
Monitor usage monthly and set up automated alerts.

**Sources**:

- [Convex Limits - Storage](https://docs.convex.dev/production/state/limits)

#### Pitfall: File Storage URL Expiration Confusion

**Symptom**: File URLs stop working after some time, or users see access denied errors
when trying to download files they previously could access.

**Root Cause**: File storage URLs are signed with expiration times.
Storing these URLs in documents or sharing them externally will fail once they expire.

**Workarounds**:

1. **Always generate fresh URLs when needed**:
   ```typescript
   // GOOD: Generate URL at access time
   const url = await ctx.storage.getUrl(fileId);
   return { ...document, fileUrl: url };
   ```

2. **Don’t store signed URLs in documents**:
   ```typescript
   // BAD: URL will expire
   await ctx.db.patch(docId, { fileUrl: signedUrl });
   
   // GOOD: Store file ID, generate URL on read
   await ctx.db.patch(docId, { fileId: storageId });
   ```

3. **For long-lived sharing**, implement your own access control with fresh URL
   generation

**Best Practice**: Store `Id<"_storage">` references, not URL strings.

#### Pitfall: Cron Job Silent Failures

**Symptom**: Cron jobs stop running or fail silently, with no obvious errors in logs.

**Root Cause**: Cron jobs have limited log retention (5 logs) and no automatic retry.
Failures can be lost if not monitored externally.

**Workarounds**:

1. **Log to a dedicated table for monitoring**:
   ```typescript
   export const myCronJob = mutation({
     handler: async (ctx) => {
       try {
         // ... job logic
         await ctx.db.insert('cronLogs', { job: 'myCron', status: 'success', ts: Date.now() });
       } catch (e) {
         await ctx.db.insert('cronLogs', { job: 'myCron', status: 'error', error: String(e), ts: Date.now() });
         throw e;
       }
     }
   });
   ```

2. **Use external monitoring** (Datadog, etc.)
   for critical crons

3. **Keep cron jobs lightweight** — use them to trigger actions, not do heavy work

**Best Practice**: Never rely on Convex’s 5-log retention for cron job monitoring.

### Execution Pitfalls

These pitfalls relate to function execution, timeouts, and runtime behavior.

#### Pitfall: Pagination Loops in Queries and Mutations

**Symptom**: Pagination loops (do-while with cursor) hang in tests, timeout in
migrations, or fail with execution time limits.

**Root Cause**: Convex queries and mutations have limited execution time (1 second for
JS execution) and cannot safely iterate with pagination loops.
Additionally, pagination mocks in test environments can cause infinite loops.

**Example Scenario**:

```typescript
// PROBLEMATIC: Pagination loop in query
export const countAllTurns = query({
  handler: async (ctx, args) => {
    let total = 0;
    let cursor = null;
    do {
      const page = await ctx.db
        .query('conversationTurns')
        .paginate({ cursor, numItems: 100 });
      total += page.page.length;
      cursor = page.continueCursor;
    } while (cursor !== null); // Can loop forever or timeout!
    return total;
  },
});
```

**Problems with this pattern**:

1. **Test hanging**: Pagination mocks in `convex-test` can cause infinite loops

2. **Timeout risk**: Query/mutation execution time limit (1 second JS time)

3. **No progress guarantee**: If loop iteration fails, entire function retries from
   beginning

4. **Migration timeouts**: Validation queries using pagination loops hit 600-second
   timeout

**Workarounds**:

1. **Use `.take(limit)` instead of pagination loops**:

   ```typescript
   // CORRECT: Use take() with appropriate limit
   export const countTurns = query({
     handler: async (ctx, { conversationId }) => {
       const turns = await ctx.db
         .query('conversationTurns')
         .withIndex('by_conversation', (q) => q.eq('conversationId', conversationId))
         .take(1000); // Safe limit
       return turns.length;
     },
   });
   ```

2. **Move pagination to actions for large datasets**:

   Actions can safely loop because they have a 10-minute execution limit and don’t use
   mocked pagination in tests.

   ```typescript
   // CORRECT: Action can paginate safely
   export const processAllTurns = internalAction({
     handler: async (ctx, args) => {
       let cursor = null;
       let totalProcessed = 0;
   
       do {
         // Call mutation to process one batch
         const result = await ctx.runMutation(
           internal.processTurnsBatch,
           { cursor, numItems: 100 }
         );
   
         totalProcessed += result.processed;
         cursor = result.continueCursor;
       } while (cursor !== null);
   
       return { totalProcessed };
     },
   });
   
   // Mutation processes one batch
   export const processTurnsBatch = internalMutation({
     args: { cursor: v.union(v.string(), v.null()), numItems: v.number() },
     handler: async (ctx, args) => {
       const page = await ctx.db
         .query('conversationTurns')
         .paginate({ cursor: args.cursor, numItems: args.numItems });
   
       // Process page.page here
       const processed = page.page.length;
   
       return {
         processed,
         continueCursor: page.continueCursor,
       };
     },
   });
   ```

3. **For migrations: Use action-based validation**:

   ```typescript
   // Validation in action (not query)
   export const validateMigration = internalAction({
     handler: async (ctx, args) => {
       let cursor = null;
       let totalValidated = 0;
   
       do {
         const batch = await ctx.runQuery(internal.validateBatch, {
           cursor,
           numItems: 500,
         });
   
         totalValidated += batch.count;
         cursor = batch.continueCursor;
       } while (cursor !== null);
   
       return { totalValidated };
     },
   });
   ```

**Common Mistakes**:

1. **Declaring cursor as const**: `const cursor = null` in loop header means cursor
   never updates, causing infinite loop

2. **Not checking for null cursor**: Missing null check can cause issues

3. **Using in migrations**: Migration validation queries especially prone to timeouts

**Best Practices**:

- **Never use pagination loops in queries/mutations** - risk of timeouts and test hangs

- **Use `.take(n)` for bounded queries** - safer and faster than pagination

- **Use actions for pagination loops** - 10-minute limit allows safe iteration

- **For migrations: action-based validation** - query-based validation hits limits

- **Always update cursor in loops** - ensure cursor variable is mutable

**Sources**:

- [Convex Actions](https://docs.convex.dev/functions/actions)

- [Convex Pagination](https://docs.convex.dev/database/pagination)

#### Pitfall: Bucket Timestamp Keys to Avoid Monotonic Writes

*Category: Concurrency - placed here for topical flow with write patterns*

**Symptom**: High write contention when using aggregate keys based on `_creationTime` or
other monotonically increasing values.

**Root Cause**: Monotonically increasing keys cause all concurrent writes to target the
same B-tree leaf nodes, creating contention and OCC conflicts.

**Example Scenario**:

```typescript
// BAD: All events with similar timestamps hit same leaf node
await eventAggregate.insert(ctx, {
  namespace: entityId,
  key: [event._creationTime, event.type], // Monotonic first key
  value: event,
});
```

**Workaround**: Bucket timestamps to distribute writes across nodes.

```typescript
// GOOD: Bucket to nearest minute to spread writes
const bucketedTime = Math.floor(event._creationTime / 60000) * 60000;
await eventAggregate.insert(ctx, {
  namespace: entityId,
  key: [bucketedTime, event.type],
  value: event,
});
```

**Best Practice**: When using time-based keys in aggregates or indexes, bucket to
appropriate granularity (minute, hour, day) based on write frequency.

**Sources**:

- [Convex Aggregate Component](https://github.com/get-convex/aggregate)

#### Pitfall: Dangling Promises in Actions

**Symptom**: Console warnings showing “1 unawaited operation” in Convex logs, or
intermittent errors in action invocations that seem unrelated to the current operation.

**Root Cause**: Fire-and-forget async patterns like `void fn()` or `fn().catch()` create
unawaited promises. When an action returns, any promises still running may or may not
complete. Since Convex reuses Node.js execution environments between action calls,
dangling promises can cause errors in subsequent action invocations.

**Convex Documentation Warning**:

> “Make sure to await all promises created within an action.
> Async tasks still running when the function returns might or might not complete.
> In addition, since the Node.js execution environment might be reused between action
> calls, dangling promises might result in errors in subsequent action invocations.”

**Example Scenarios**:

```typescript
// BAD: Fire-and-forget with void (promise may not complete)
export const processData = internalAction({
  handler: async (ctx, args) => {
    void logger.trackEvent({ event: 'started', ...args }); // Dangling!

    const result = await doWork(args);

    void logger.trackEvent({ event: 'completed', result }); // Dangling!
    return result;
  },
});

// BAD: Fire-and-forget with .catch() (still dangling)
export const processData = internalAction({
  handler: async (ctx, args) => {
    logger.trackEvent({ event: 'started' }).catch((err) => {
      console.error('Logging failed:', err);
    }); // Dangling! The promise is not awaited

    const result = await doWork(args);
    return result;
  },
});
```

**Workaround**: Always await async operations, even “fire-and-forget” logging calls.

```typescript
// CORRECT: All promises awaited
export const processData = internalAction({
  handler: async (ctx, args) => {
    await logger.trackEvent({ event: 'started', ...args }); // Properly awaited

    const result = await doWork(args);

    await logger.trackEvent({ event: 'completed', result }); // Properly awaited
    return result;
  },
});

// CORRECT: With error handling that still awaits
export const processData = internalAction({
  handler: async (ctx, args) => {
    try {
      await logger.trackEvent({ event: 'started' });
    } catch (err) {
      console.error('Logging failed:', err);
      // Continue execution even if logging fails
    }

    const result = await doWork(args);
    return result;
  },
});
```

**Key Patterns to Avoid**:

| Pattern | Issue | Fix |
| --- | --- | --- |
| `void asyncFn()` | Promise not awaited | `await asyncFn()` |
| `asyncFn().catch(...)` | Promise not awaited (catch returns new Promise) | `await asyncFn()` with try/catch |
| `setTimeout(() => asyncFn(), 0)` | Promise escapes action scope | Use `ctx.scheduler.runAfter(0, ...)` |
| Returning before awaiting | Promise orphaned | Ensure all awaits complete before return |

**Common Affected Operations**:

- Logging and telemetry calls

- Background analytics tracking

- Non-critical side effects (notifications, metrics)

- Cleanup operations at end of actions

**Best Practices**:

1. **Always await every async call** in actions, even for “non-critical” operations

2. **Use try/catch if the operation can fail** and you want to continue:
   ```typescript
   try {
     await optionalOperation();
   } catch (err) {
     console.warn('Optional operation failed:', err);
   }
   ```

3. **Use `ctx.scheduler.runAfter`** for truly fire-and-forget operations that should run
   independently:
   ```typescript
   // If you truly don't need to wait and want it to run separately
   await ctx.scheduler.runAfter(0, internal.logging.trackEvent, { event: 'completed' });
   ```

4. **Audit existing code** for `void` keyword and `.catch()` patterns in actions

**Sources**:

- [Convex Actions Documentation](https://docs.convex.dev/functions/actions) — Section on
  awaiting promises

#### Pitfall: Nested Same-Runtime Action Calls ✅

**Symptom**: Actions that call other actions via `ctx.runAction()` within the same
runtime (both Node.js or both V8) silently timeout at ~5 minutes, well before the
documented 10-minute action timeout.

**Root Cause**: Convex officially recommends against nested action calls within the same
runtime. While technically allowed, this pattern has efficiency issues (parent action
wastes resources waiting idle) and observed timeout behavior that differs from
documented limits.

**🔍 Technical Root Cause (Source Code Verified)**:

The 5-minute timeout comes from **two different sources** depending on the runtime:

| Runtime Pattern | Timeout Source | Source Location | Env Var |
| --- | --- | --- | --- |
| **V8 → V8** | `V8_ACTION_SYSTEM_TIMEOUT` | `knobs.rs:745-746` | `V8_ACTION_SYSTEM_TIMEOUT_SECONDS` |
| **Node.js → Any** | `HTTP_SERVER_TIMEOUT_DURATION` | `knobs.rs:1315-1316` | `HTTP_SERVER_TIMEOUT_SECONDS` |

**V8 → V8 Nested Calls**:

- When a V8 action calls `ctx.runAction()`, the user timeout (10 min) **pauses**

- The system timeout (5 min) **starts counting** while waiting for the syscall

- Enforced in `crates/isolate/src/timeout.rs` via `max_time_paused`

**Node.js → Any Nested Calls**:

- Node.js actions make HTTP POST callbacks to the backend (`/api/actions/action`)

- The HTTP server applies a `TimeoutLayer` via Tower middleware
  (`crates/common/src/http/mod.rs:655`)

- Default timeout: 300 seconds (5 minutes)

- When timeout hits, returns `StatusCode::REQUEST_TIMEOUT` with **empty error message**

**Why Error Messages Are Empty**:

When the HTTP timeout occurs, the error handler loses context:
```rust
// crates/common/src/http/mod.rs:652-654
.layer(HandleErrorLayer::new(|_: BoxError| async {
    StatusCode::REQUEST_TIMEOUT  // No error message preserved!
}))
```

This results in errors with empty messages (`""` or `"Error"`) and stack traces
containing `performAsyncSyscall`, making debugging extremely difficult.

**🛠️ Self-Hosted Configuration**:

For self-hosted deployments, both timeouts can be increased:
```bash
# For V8 → V8 nested calls (default 300s)
export V8_ACTION_SYSTEM_TIMEOUT_SECONDS=600  # 10 minutes

# For Node.js → Any nested calls (default 300s)
export HTTP_SERVER_TIMEOUT_SECONDS=600  # 10 minutes
```

**⚠️ Important**: These limits are **not documented** in official Convex documentation.
The official docs only mention the 10-minute action timeout but do not disclose these
shorter timeouts that affect nested action calls.

**Convex Official Guidance:**

From [Actions Documentation](https://docs.convex.dev/functions/actions):

> “If you want to call an action from another action that’s in the same runtime, which
> is the normal case, the best way to do this is to pull the code you want to call into
> a TypeScript helper function and call the helper instead.”

From [Best Practices](https://docs.convex.dev/understanding/best-practices/):

> “It counts as an extra function call with its own memory and CPU usage, while the
> parent action is doing nothing except waiting for the result.
> Therefore, runAction should almost always be replaced with calling a plain TypeScript
> function.”

**Example Scenario**:

```typescript
// BAD: Nested action call within same Node.js runtime
"use node";

export const parentAction = internalAction({
  handler: async (ctx, args) => {
    // This call may silently timeout at ~5 minutes!
    const result = await ctx.runAction(internal.childAction, { data: args.data });
    return result;
  },
});

export const childAction = internalAction({
  handler: async (ctx, args) => {
    // Long-running operation...
    return await processData(args.data);
  },
});
```

**Workaround**: Extract shared logic into plain TypeScript helper functions.

```typescript
// CORRECT: Use helper function instead of nested action
"use node";

// Plain TypeScript helper - NOT a Convex action
async function processDataHelper(data: DataType): Promise<ResultType> {
  // Shared logic lives here
  return await processData(data);
}

export const parentAction = internalAction({
  handler: async (ctx, args) => {
    // Call helper directly - no nested action, no timeout issue
    const result = await processDataHelper(args.data);
    return result;
  },
});

// childAction can still exist for direct invocation if needed
export const childAction = internalAction({
  handler: async (ctx, args) => {
    return await processDataHelper(args.data);
  },
});
```

**When `ctx.runAction()` IS Appropriate**:

| Scenario | Appropriate? | Reason |
| --- | --- | --- |
| V8 action calling Node.js action | ✅ Yes | Cross-runtime call (different isolates) |
| Node.js action calling V8 action | ✅ Yes | Cross-runtime call (different isolates) |
| Node.js action calling Node.js action | ❌ No | Same runtime - use helper function |
| V8 action calling V8 action | ❌ No | Same runtime - use helper function |
| Workflow `step.runAction()` | ✅ Yes | Workflow orchestration (V8 → Node) |

**Key Distinction**:

| Aspect | Documented by Convex | Observed in Production |
| --- | --- | --- |
| **Reason to avoid** | Efficiency (wasted resources) | Silent ~5 min timeout |
| **Recommended alternative** | Plain TypeScript helper functions | Same |
| **Valid use case** | Cross-runtime calls only | Same |

**Impact on Durable Workflows**:

When using `@convex-dev/workflow`, workflow step actions (called via `step.runAction()`)
must be **leaf actions** that do not call `ctx.runAction()` internally.
The workflow orchestrator runs in V8 and calls Node.js actions, which is a valid
cross-runtime pattern.
But if those Node.js actions then call other Node.js actions, you recreate the
problematic nested same-runtime pattern.

**See Also**:

- [research-durable-workflows-agent-conversations.md](../../../project/research/current/research-durable-workflows-agent-conversations.md)
  § “Nested Action Timeout Issue” for detailed analysis

- [plan-2026-01-09-durable-workflows-agent-conversations-v3.md](../../../project/specs/active/plan-2026-01-09-durable-workflows-agent-conversations-v3.md)
  § “Leaf Action Requirement” for implementation guidance

**Best Practices**:

1. **Search codebase for `ctx.runAction`** and verify each call crosses runtimes

2. **Extract shared logic** into plain TypeScript helper functions

3. **Use dependency injection** to pass context to helpers when needed

4. **For workflows**: Ensure all `step.runAction()` targets are leaf actions

**Sources**:

- [Convex Actions Documentation](https://docs.convex.dev/functions/actions)

- [Convex Best Practices](https://docs.convex.dev/understanding/best-practices/)

#### Pitfall: HTTP Action Body Size Surprises

**Symptom**: HTTP actions fail with “Request body exceeds the 20MiB limit” or responses
are silently truncated when returning large payloads.

**Root Cause**: HTTP actions have a hard-coded 20 MiB limit on both request and response
bodies. This is not configurable even in self-hosted deployments.

**Example Scenarios**:

1. **Large file uploads via HTTP actions**: Trying to accept file uploads > 20 MiB

2. **Large JSON API responses**: Returning datasets that exceed 20 MiB

3. **Streaming not available**: No way to stream responses to work around the limit

```typescript
// BAD: Large payload that may exceed limit
export const getLargeDataset = httpAction(async (ctx, request) => {
  const data = await ctx.runQuery(internal.getAllRecords); // May return huge dataset
  return new Response(JSON.stringify(data), {
    headers: { "Content-Type": "application/json" },
  }); // Will fail if > 20 MiB
});
```

**Workarounds**:

1. **Use File Storage for large files**:
   ```typescript
   // GOOD: Use storage for large files
   export const uploadFile = httpAction(async (ctx, request) => {
     const file = await request.blob();
     // File Storage supports up to 2 TB via multipart upload
     const storageId = await ctx.storage.store(file);
     return new Response(JSON.stringify({ storageId }));
   });
   ```

2. **Paginate large responses**:
   ```typescript
   // GOOD: Paginate responses
   export const getRecords = httpAction(async (ctx, request) => {
     const url = new URL(request.url);
     const cursor = url.searchParams.get("cursor");
     const data = await ctx.runQuery(internal.getRecordsPaginated, {
       cursor,
       numItems: 100,
     });
     return new Response(JSON.stringify(data));
   });
   ```

3. **Return storage URLs for large datasets**:
   ```typescript
   // GOOD: Generate file and return download URL
   export const exportData = httpAction(async (ctx, request) => {
     const storageId = await ctx.runAction(internal.generateExportFile);
     const url = await ctx.storage.getUrl(storageId);
     return new Response(JSON.stringify({ downloadUrl: url }));
   });
   ```

**Best Practice**: Design HTTP actions to work within 20 MiB limits.
Use File Storage for large payloads and pagination for large datasets.

**Sources**:

- [Convex HTTP Actions](https://docs.convex.dev/functions/http-actions)

#### Pitfall: Durable Workflow Journal Limits

**Symptom**: Workflows fail with “Journal too large” errors or exhibit unexpected
behavior after many steps.
Workflows that worked in testing fail in production with larger data.

**Root Cause**: Durable workflows store their execution state in a journal that has
limits:

- **Total journal size**: 8 MiB (includes all step inputs, outputs, and metadata)

- **Per-step data**: 1 MiB (arguments + return value per step)

- **Step count**: No hard limit, but ~50 steps recommended maximum

The journal persists the entire history of the workflow, so even completed steps
contribute to the size limit.

**Example Scenarios**:

1. **Passing large data between steps**:
   ```typescript
   // BAD: Large data flowing through journal
   const workflow = new Workflow(components.workflow, { workpoolOptions });
   
   export const processWorkflow = workflow.define({
     args: { recordIds: v.array(v.id("records")) },
     handler: async (step, args) => {
       // Each step's input/output is persisted
       const records = await step.runQuery(internal.getRecords, {
         ids: args.recordIds
       }); // 500 records × 10KB = 5 MB in journal!
   
       const processed = await step.runAction(internal.processAll, {
         records
       }); // Another 5 MB in journal for input
   
       return processed; // 5 MB more for return value = 15 MB total, exceeds limit
     },
   });
   ```

2. **Too many steps accumulating state**:
   ```typescript
   // BAD: Many steps each adding to journal
   handler: async (step, args) => {
     const results = [];
     for (const id of args.ids) { // 100 items = 100 steps
       const result = await step.runAction(internal.process, { id });
       results.push(result); // Journal grows with each step
     }
     return results;
   }
   ```

**Workarounds**:

1. **Pass IDs instead of data**:
   ```typescript
   // GOOD: Steps work with IDs, not full data
   handler: async (step, args) => {
     // Step 1: Create temporary batch record
     const batchId = await step.runMutation(internal.createBatch, {
       recordIds: args.recordIds,
     });
   
     // Step 2: Process batch (action reads full data from DB)
     await step.runAction(internal.processBatch, { batchId });
   
     // Step 3: Get results summary (small)
     const summary = await step.runQuery(internal.getBatchSummary, { batchId });
     return summary; // Only small summary in journal
   }
   ```

2. **Batch operations to reduce step count**:
   ```typescript
   // GOOD: Process in batches, not individual items
   handler: async (step, args) => {
     const BATCH_SIZE = 50;
     const batches = chunkArray(args.ids, BATCH_SIZE);
   
     for (let i = 0; i < batches.length; i++) {
       await step.runAction(internal.processBatch, {
         batchIndex: i,
         ids: batches[i],
       });
     }
   }
   ```

3. **Store intermediate results externally**:
   ```typescript
   // GOOD: Use database for large intermediate state
   handler: async (step, args) => {
     const workflowRunId = args.runId;
   
     // Each step writes to database, not journal
     await step.runMutation(internal.setIntermediateResult, {
       runId: workflowRunId,
       step: "extraction",
       resultId: extractedDataId, // Store ID, not data
     });
   }
   ```

**Journal Size Estimation**:

| Data Type | Approximate Size |
| --- | --- |
| Document ID | ~50 bytes |
| Small object (5 fields) | ~200-500 bytes |
| Medium document (20 fields) | ~1-2 KB |
| Large document | 5-50 KB |
| Array of 100 IDs | ~5 KB |
| Array of 100 documents | ~100 KB - 5 MB |

**Best Practice**: Design workflows to pass IDs and references, not full data.
Keep step count under 50 and total journal under 4 MiB (50% safety margin).

**Sources**:

- [Convex Workflows](https://www.convex.dev/components/workflow)

#### Pitfall: Workflow Retry and Idempotency Confusion

**Symptom**: Workflows produce duplicate side effects (emails sent twice, records
created multiple times) or exhibit inconsistent behavior on retry.

**Root Cause**: Durable workflows guarantee exactly-once semantics for **steps**, but
only if you use the journal correctly.
If an action has side effects before a step boundary, those side effects may execute
multiple times on retry.

**Example Scenario**:

```typescript
// BAD: Side effect outside step boundary
handler: async (step, args) => {
  // This runs before any step - NOT protected by journal
  console.log("Starting workflow"); // Will log on every retry
  sendStartNotification(); // May send multiple notifications!

  // This is protected - runs exactly once
  const result = await step.runAction(internal.processData, args);

  return result;
}
```

**Workarounds**:

1. **All side effects inside steps**:
   ```typescript
   // GOOD: All side effects are journal-protected steps
   handler: async (step, args) => {
     // Step 1: Send notification (exactly once)
     await step.runAction(internal.sendStartNotification, {
       workflowId: args.workflowId,
     });
   
     // Step 2: Process data (exactly once)
     const result = await step.runAction(internal.processData, args);
   
     return result;
   }
   ```

2. **Idempotency keys for external services**:
   ```typescript
   // GOOD: Use idempotency keys even within steps
   export const sendEmail = internalAction({
     handler: async (ctx, args) => {
       await sendgrid.send({
         to: args.email,
         subject: args.subject,
         body: args.body,
         // Idempotency key prevents duplicate sends even if
         // the step is retried due to transient failure
         idempotencyKey: args.workflowStepId,
       });
     },
   });
   ```

3. **Track completion status**:
   ```typescript
   // GOOD: Check if already completed before running
   export const chargeCreditCard = internalAction({
     handler: async (ctx, args) => {
       // Check if already charged
       const existing = await ctx.runQuery(internal.getCharge, {
         orderId: args.orderId,
       });
       if (existing) {
         return existing.chargeId; // Already done, return existing
       }
   
       // Charge and record
       const chargeId = await stripe.charges.create({ ... });
       await ctx.runMutation(internal.recordCharge, {
         orderId: args.orderId,
         chargeId,
       });
       return chargeId;
     },
   });
   ```

**Best Practice**: Treat all code outside `step.*` calls as potentially running multiple
times. Put all side effects inside steps and use idempotency keys for external services.

**Sources**:

- [Convex Workflows - Durability](https://www.convex.dev/components/workflow)

* * *

## Best Practices Checklist

### Query Design

1. **Never use `.collect()` on unbounded tables**

   - Use `.take(n)` for fixed-size results

   - Use `.paginate(paginationOpts)` for cursor-based pagination

   - Use head+1 pattern (`.take(limit + 1)`) for “N+” labels

2. **Use composite indexes over post-index filtering**

   - Design indexes to match query patterns

   - Include all filter fields in index definition

   - Avoid `.withIndex()` followed by `.filter()`

3. **Keep scanned documents small**

   - Separate large payloads (>10KB) into detail tables

   - Fetch detail documents only when needed (on-demand)

   - Design listing/counting tables with minimal fields

4. **Index fields in query order**

   - Match index field order to query equality/range conditions

   - Create separate indexes for different query orders if needed

### Aggregation and Counting

5. **Use Aggregate Component for statistics at scale**

   - Leverage official
     [Convex Aggregate Component](https://github.com/get-convex/aggregate) for
     counts/sums over large datasets

   - Design aggregate namespaces for isolation (per-entity aggregates)

   - Use batch operations (`countBatch`, `sumBatch`, `atBatch`) for efficiency

6. **Bound all aggregate reads**

   - Always specify `bounds: { lower, upper }` to limit reactivity

   - Combine `prefix` with bounds for targeted queries

   - Avoid reading entire namespace without bounds

7. **Bucket timestamp keys**

   - Bucket `_creationTime` to appropriate granularity (minute/hour/day)

   - Avoid monotonically increasing first keys in aggregates

   - Distribute writes across B-tree nodes

### Concurrency and Performance

8. **Namespace to avoid write contention**

   - Use per-entity namespacing (e.g., per-run, per-user)

   - Isolate unrelated writes to different documents

   - Minimize shared write dependencies

9. **Use actions for long-running operations**

   - Move data exports, backfills, and heavy processing to actions

   - Keep queries/mutations under 1-second execution time

   - Break work into chunks that finish within 10-minute action limit

10. **Await all promises in actions**

    - Never use `void asyncFn()` or `asyncFn().catch()` patterns

    - Use try/catch for non-critical operations that can fail

    - Use `ctx.scheduler.runAfter` for truly independent operations

11. **Limit scheduled job fan-out**

    - Schedule at most 1,000 functions per mutation

    - Keep total scheduled arguments under 8 MiB

    - Use batch processing for larger workloads

12. **Avoid nested action calls within same runtime** ✅

    - Use `ctx.runAction()` **only** for cross-runtime calls (V8 → Node.js)

    - Extract shared logic into plain TypeScript helper functions

    - Audit codebase for `ctx.runAction` and verify each call crosses runtimes

    - For durable workflows: ensure step actions are “leaf actions” (no nested calls)

### Storage and Cost Management

13. **Monitor storage and bandwidth proactively**

    - Set up alerts at 75-80% of quota limits

    - Review Convex dashboard metrics monthly

    - Track growth trends to project costs

14. **Implement data archival policies**

    - Export historical data to external storage (S3, etc.)

    - Delete archived data from Convex to free quota

    - Define archival criteria before hitting limits

15. **Optimize index usage**

    - Remove unused indexes

    - Evaluate whether all composite index combinations are necessary

    - Remember: indexes consume storage quota

### Code Organization

16. **Use proper function visibility**

    - Use `internalQuery`/`internalMutation`/`internalAction` for private functions

    - Use `query`/`mutation`/`action` only for public API

    - Follow file-based routing conventions

17. **Always include validators**

    - Add `args` and `returns` validators to all functions

    - Use `v.null()` for functions with no return value

    - Leverage TypeScript types generated from validators

* * *

## References

### Official Convex Documentation

- [Convex Production Limits](https://docs.convex.dev/production/state/limits) — Complete
  limits reference (verified January 2026)

- [Convex Pricing](https://www.convex.dev/pricing) — Current plan limits and pricing

- [Convex Best Practices](https://docs.convex.dev/understanding/best-practices) —
  Official best practices guide

- [Convex Runtimes](https://docs.convex.dev/functions/runtimes) — Runtime comparison
  (Convex vs Node.js)

- [Indexes and Query Performance](https://docs.convex.dev/database/reading-data/indexes)
  — Index optimization and query patterns

- [Pagination Guide](https://docs.convex.dev/database/pagination) — Cursor-based and
  offset pagination

- [Query Functions](https://docs.convex.dev/functions/query-functions) — Query design
  and patterns

- [Full Text Search](https://docs.convex.dev/search/text-search) — Search index limits

- [Vector Search](https://docs.convex.dev/search/vector-search) — Vector index limits

- [Scheduled Functions](https://docs.convex.dev/scheduling/scheduled-functions) —
  Scheduling limits

- [Environment Variables](https://docs.convex.dev/production/environment-variables) —
  Environment variable limits

### Community Resources

- [Queries that Scale](https://stack.convex.dev/queries-that-scale) — Community article
  on scalable query patterns (February 2024)

### Official Libraries and Tools

- [Convex Aggregate Component](https://github.com/get-convex/aggregate) — Official
  library for maintaining denormalized aggregates

- [Convex Helpers](https://github.com/get-convex/convex-helpers) — Utilities for
  pagination, filtering, and common patterns

* * *

## Quick Reference Tables

### Limit Quick Reference (January 2026)

**Note**: Limits marked ✅ are verified against official documentation as of January
2026\. Limits marked 🔍 have source code values that differ from documentation.
Professional plan customers can request increases on a case-by-case basis by contacting
mailto:support@convex.dev.

| Category | Limit Type | Documented | Source Code | Status |
| --- | --- | --- | --- | --- |
| **Transaction Read** | Maximum data read | 8 MiB | **16 MiB** | ✅ 🔒 🔍 🛠️ |
|  | Maximum documents scanned | 16,384 | **32,000** | ✅ 🔒 🔍 🛠️ |
|  | Maximum db.get/db.query calls | 4,096 | 4,096 | ✅ 🔒 🛠️ |
| **Transaction Write** | Maximum data written | 8 MiB | **16 MiB** | ✅ 🔒 🔍 🛠️ |
|  | Maximum documents written | 8,192 | **16,000** | ✅ 🔒 🔍 🛠️ |
| **Document** | Maximum size | 1 MiB | 1 MiB | ✅ 🔒 |
|  | Maximum fields | 1,024 | 1,024 | ✅ 🔒 |
|  | Maximum nesting depth | 16 levels | 16 levels | ✅ 🔒 |
|  | Maximum array elements | 8,192 | 8,192 | ✅ 🔒 |
|  | Maximum field name length | 64 chars | **1,024 chars** | ✅ 🔒 🔍 |
| **Execution Time** | Query/Mutation user timeout | 1 second | 1 second | ✅ 🔒 🛠️ |
|  | Query/Mutation system timeout | N/A | 15 seconds | ✅ 🔒 🛠️ |
|  | Action execution | 10 minutes | 10 minutes | ✅ 🔒 🛠️ |
|  | V8 action system timeout | N/A | 5 minutes | 🔍 🛠️ |
|  | HTTP server request timeout | N/A | 5 minutes | 🔍 🛠️ |
| **Action Memory** | Convex Runtime | 64 MB | 64 MB | ✅ 🔄 🛠️ |
|  | Node.js Runtime | 512 MB | 512 MB | ✅ 🔄 🛠️ |
| **Function Arguments** | Convex Runtime | 8 MiB | **16 MiB** | ✅ 🔒 🔍 🛠️ |
|  | Node.js Runtime | 5 MiB | 5 MiB (error msg) | ✅ 🔒 |
| **Scheduled Functions** | Max functions per mutation | 1,000 | 1,000 | ✅ 🔒 🛠️ |
|  | Total argument size | 8 MiB | **16 MiB** | ✅ 🔒 🔍 🛠️ |
| **Logging** | Log lines per execution | N/A | 256 | ✅ 🔒 🔍 |
| **Concurrency (default)** | Queries | 16 | 16 | ✅ 🔄 🛠️ |
|  | Mutations | 16 | 16 | ✅ 🔄 🛠️ |
|  | V8/Node/HTTP Actions | 16 | 16 | ✅ 🔄 🛠️ |
|  | Scheduled Job Parallelism | 10 | 10 | ✅ 🔄 🛠️ |
| **Indexes** | Indexes per table | 32 | **64** | ✅ 🔒 🔍 |
|  | Fields per index | 16 | 16 | ✅ 🔒 |
|  | Full-text indexes per table | 4 | 4 | ✅ 🔒 |
|  | Vector indexes per table | 4 | 4 | ✅ 🔒 |
|  | Vector index max documents | 100,000 | 100,000 | ✅ 🔒 |
| **Search Results** | Full-text search results | 1,024 | 1,024 | ✅ 🔒 |
|  | Vector search results | 256 | 256 | ✅ 🔒 |
| **Environment Vars** | Maximum count | 100 | **1,000** | ✅ 🔒 🔍 🛠️ |
|  | Name length | 40 chars | 40 chars | ✅ 🔒 |
|  | Value length | N/A | 8,192 bytes | ✅ 🔒 |

**Key**: 🔍 = Source code differs from docs; 🛠️ = Configurable via env var for
self-hosted

### Common Error Messages and Solutions

| Error Message | Likely Cause | Solution |
| --- | --- | --- |
| `"transaction exceeded resource limits"` | Read limit (8 MiB) or document count (16,384) exceeded | Use `.take()` or `.paginate()` instead of `.collect()`; separate large fields into detail tables |
| `"document too large"` | Document exceeds 1 MiB | Split large fields into separate documents; compress or truncate large text |
| `"JavaScript execution ran out of memory (maximum memory usage: 64 MB)"` | Action exceeded Convex Runtime 64 MB limit | Add `"use node";` directive to file to switch to Node.js runtime (512 MB limit) |
| Action timeout (no error, just stops) | Action exceeded 600s limit | Use sampling strategy; implement resumable pattern; break into scheduled jobs |
| Logs truncated silently | Exceeded 256 log lines | Log less frequently (every 100 iterations instead of every 5); use external logging |
| High OCC retry rates | Write contention on shared documents | Use namespacing; avoid wide aggregate reads; isolate entity writes |
| Slow query performance | Table scan without index | Create composite index matching query pattern; avoid post-index `.filter()` |
| Storage overage charges | Data retention without archival | Implement archival policy; export historical data; delete old records |
| `"1 unawaited operation"` warning | Dangling promises from `void fn()` or `fn().catch()` | Await all async operations; use try/catch for error handling |
| Empty error message (`""` or `"Error"`) with `performAsyncSyscall` in stack | Nested `ctx.runAction()` exceeded 5-minute HTTP/system timeout | Use helper functions instead of nested action calls; ensure actions complete in <5 min |

### Decision Matrix: When to Use Each Pattern

| Use Case | Recommended Pattern | Alternative |
| --- | --- | --- |
| **Count/sum over <100 records** | Direct query with `.collect()` | N/A |
| **Count/sum over 100–1000 records** | `.take(limit)` with head+1 pattern | Aggregate Component |
| **Count/sum over >1000 records** | Convex Aggregate Component | Pre-computed counters (limited flexibility) |
| **List 10–100 records** | `.take(n)` | `.paginate()` if client needs multiple pages |
| **List unbounded records** | `.paginate(paginationOpts)` | Never use `.collect()` |
| **Large text fields (>10KB)** | Separate detail table | Compression (if feasible) |
| **High-frequency counters** | Aggregate Component with namespaces | Write-time counters (OCC risk) |
| **Long-running processing (< 10 min)** | Action with progress logging (every 100 iterations) | Break into scheduled mutations |
| **Long-running processing (> 10 min)** | Resumable action pattern or scheduled jobs | Sampling strategy for validation |
| **Historical data retention** | Archive to S3/external storage | Accept storage costs |

### Recommended Limit Values for Common Scenarios

This table provides practical limit values based on real-world usage patterns and Convex
constraints:

| Scenario | Recommended Limit | Rationale |
| --- | --- | --- |
| **Log/event queries** | 8,000 max return | Stays under 8,192 array limit with formatting overhead |
| **Activity tracking scans** | 10,000 max scan | Prevents 8 MiB read with typical record sizes (0.5-1KB each) |
| **Large text collection queries** | 1,000 per parent | Combined with 900KB content limit prevents excessive reads |
| **Dashboard tab counts** | 50-100 with head+1 | Balances UX clarity with query performance |
| **Truncated text fields** | 500 characters | Prevents 8 MiB return limit with thousands of records |
| **Large content fields** | 900 KB max | Leaves 100KB+ headroom below 1 MiB document limit |
| **Relational data queries** | 10,000-20,000 | Typical collection sizes stay well under limits |
| **File storage content** | 50 KB before compression | Use Brotli compression (3:1 ratio) for larger content |

### When to Use File Storage vs. Document Fields

| Content Size | Strategy | Implementation |
| --- | --- | --- |
| **<1 KB** | Store in document field | Direct field storage |
| **1-10 KB** | Store in document field | Consider if used for listing/counting |
| **10-50 KB** | Separate document or file storage | Use detail tables for on-demand fetch |
| **50-900 KB** | **Must** use detail table or file storage | Approaching 1 MiB document limit |
| **>900 KB** | **Must** use file storage with compression | Brotli compression for HTML/text (3:1 ratio) |

* * *

## Appendix A: Areas of Improvement for Convex

This appendix identifies gaps and shortcomings in Convex’s official documentation and
platform behavior discovered during this research.
These are areas where improved documentation or platform changes would benefit
developers.

### A.1 Undocumented Limits 🔍

The following limits are enforced by the Convex platform but are **not disclosed** in
the official
[Convex Limits documentation](https://docs.convex.dev/production/state/limits):

| Limit | Value | Impact | Source | Status |
| --- | --- | --- | --- | --- |
| **V8 action system timeout** | 5 minutes | V8 actions waiting on async syscalls (like nested `ctx.runAction()`) timeout after 5 min, not 10 min | `knobs.rs:745-746` | 🔍 🛠️ |
| **HTTP server request timeout** | 5 minutes | Node.js action callbacks timeout after 5 min; affects all nested action patterns | `knobs.rs:1315-1316` | 🔍 🛠️ |
| **Log lines per function** | 256 lines | Logs are silently truncated; no error thrown | `helpers/mod.rs:29` | 🔍 |

**Recommendation**: Convex should document these limits in the official limits page to
prevent developers from encountering silent failures and difficult-to-debug timeout
issues.

### A.2 Poor Error Messages

The following scenarios produce error messages that make debugging extremely difficult:

| Scenario | Error Message | What Developers See | Underlying Cause |
| --- | --- | --- | --- |
| Nested Node.js action timeout | Empty string (`""` or `"Error"`) | Stack trace with `performAsyncSyscall`, no explanation | HTTP timeout returns `StatusCode::REQUEST_TIMEOUT` without preserving error context |
| Nested V8 action timeout | Similar empty/generic error | Action appears to fail mysteriously at ~5 min | System timeout (not user timeout) exceeded |
| Log line truncation | No error | Logs just stop appearing | 256 line limit reached |

**Recommendation**: The HTTP timeout handler in `crates/common/src/http/mod.rs:652-654`
should preserve the timeout error context.
Consider:
```rust
// Current (loses context):
.layer(HandleErrorLayer::new(|_: BoxError| async {
    StatusCode::REQUEST_TIMEOUT
}))

// Better (preserves context):
.layer(HandleErrorLayer::new(|err: BoxError| async move {
    (StatusCode::REQUEST_TIMEOUT, format!("Request timeout: {}", err))
}))
```

### A.3 Documentation vs Source Code Discrepancies 🔍

Several documented limits are more restrictive than the actual source code defaults:

| Limit | Documented | Actual (Source) | Ratio | Implication |
| --- | --- | --- | --- | --- |
| Transaction read size | 8 MiB | 16 MiB | 2x | Developers design around stricter limit unnecessarily |
| Documents scanned | 16,384 | 32,000 | 2x | Same as above |
| Documents written | 8,192 | 16,000 | 2x | Same as above |
| Indexes per table | 32 | 64 | 2x | Developers may avoid creating useful indexes |
| Environment variables | 100 | 1,000 | 10x | Unnecessary complexity in env var management |

**Recommendation**: Convex should either:

1. Update documentation to reflect actual defaults, with a note that cloud may enforce
   stricter limits

2. Clearly document that Convex Cloud uses different (stricter) limits than the source
   code defaults

3. Provide a way to query the actual limits in effect for a deployment

### A.4 Missing Documentation Topics 🔍

The following topics lack adequate documentation:

| Topic | Gap | Impact |
| --- | --- | --- |
| **Nested action behavior** | Official docs say "inefficient" but don't mention 5-min timeout | Developers discover this through production failures |
| **System timeout vs user timeout** | Not explained in action timeout docs | Timeout at 5 min seems like a bug when docs say 10 min |
| **Runtime boundary semantics** | When crossing V8 ↔ Node.js is required vs optional | Developers don't understand when `ctx.runAction()` is appropriate |
| **Self-hosted configuration** | Environment variables for adjusting limits | Self-hosted users can't optimize for their workloads |
| **Error serialization across boundaries** | How errors are marshaled between runtimes | Developers lose error context without understanding why |

**Recommendation**: Create documentation pages covering:

- Action timeout architecture (user timeout, system timeout, HTTP timeout)

- Cross-runtime calling patterns and best practices

- Self-hosted deployment configuration reference

### A.5 Platform Behavior Issues

| Issue | Description | User Impact |
| --- | --- | --- |
| **Silent log truncation** | Logs stop at 256 lines with no warning | Developers miss critical debugging info |
| **Empty timeout errors** | HTTP timeouts return empty error body | Hours of debugging for simple timeout issues |
| **Inconsistent timeout behavior** | Same-runtime nested calls timeout earlier than documented | Breaks assumptions based on "10 minute action limit" |

**Recommendation**: Consider platform changes:

1. Add a log warning when approaching 256 line limit (e.g., “Warning: 250/256 log lines
   used”)

2. Include timeout reason in error responses (e.g., “Action timed out after 300s (HTTP
   server timeout)”)

3. Document all timeout sources that can affect an action’s execution

### A.6 Summary

The primary areas where Convex documentation and platform behavior could improve:

1. **Disclose hidden timeouts**: V8 system timeout (5 min) and HTTP timeout (5 min)
   should be documented alongside the 10-minute action limit

2. **Improve error messages**: Preserve error context across runtime boundaries,
   especially for timeout errors

3. **Reconcile documentation with source code**: Either update docs to match source or
   explain why cloud limits differ

4. **Document edge cases**: Nested action patterns, runtime boundaries, and self-hosted
   configuration options

5. **Add runtime warnings**: For approaching limits like log lines, give developers a
   warning before silent truncation

These improvements would significantly reduce developer friction and debugging time for
Convex applications at scale.

## Appendix B: Writing and Maintenance Process

This appendix documents how this research document was created and how it should be
maintained as a living document.

### Research Methodology

#### Approach

This research synthesizes information from:

1. **Official Documentation Review**: Convex Developer Hub “Limits” page (updated
   October 2025), covering database, function, transaction, and search quotas

2. **Community Best Practices**: Stack Convex articles including “Queries that Scale”
   (February 2024) for practical pagination and indexing guidance

3. **Component Documentation**: Convex Aggregate Component README (November 2025 update)
   detailing interaction with transaction limits and OCC behavior

4. **Real-World Application**: Analysis of common patterns, pitfalls, and production
   scenarios encountered when building scalable applications

5. **Source Code Analysis**: Direct examination of the Convex backend source code
   (`crates/common/src/knobs.rs` and related files) to verify limits and identify
   undocumented constraints

#### Primary Sources

- [Convex Production Limits](https://docs.convex.dev/production/state/limits) — Official
  limits documentation

- [Convex Best Practices](https://docs.convex.dev/understanding/best-practices) —
  Official best practices guide

- [Indexes and Query Performance](https://docs.convex.dev/database/reading-data/indexes)
  — Index optimization guide

- [Pagination Guide](https://docs.convex.dev/database/pagination) — Official pagination
  patterns

- [Queries that Scale](https://stack.convex.dev/queries-that-scale) — Community best
  practices

- [Convex Aggregate Component](https://github.com/get-convex/aggregate) — Official
  aggregation library

- [Convex Helpers](https://github.com/get-convex/convex-helpers) — Additional utilities
  for pagination and queries

### Updating This Document

#### When to Update

This document should be reviewed and updated when:

1. **Convex releases new versions**: Check changelog for limit changes

2. **Documentation discrepancies are found**: Report and document any differences
   between official docs and observed behavior

3. **New platform features are added**: Document limits for new functionality (e.g., new
   storage types, new runtime options)

4. **Source code changes**: Major backend releases may change default limits in
   `knobs.rs` or hard-coded values

#### Update Process

1. **Verify changes**: Confirm limit changes against both official docs and source code

2. **Update relevant sections**: Modify the specific limit values and explanations

3. **Update Quick Reference Tables**: Ensure summary tables match prose content

4. **Update verification dates**: Mark when limits were last verified with ✅

5. **Document discrepancies**: Note any differences between docs and source code with 🔍

6. **Update tracking document**: Mark completed items in the companion tracking document

#### Verification Checklist

When verifying limits, check:

- [ ] Official Convex documentation (docs.convex.dev)

- [ ] Source code in `crates/common/src/knobs.rs` for configurable limits

- [ ] Source code in relevant crate files for hard-coded limits

- [ ] Convex changelog for recent changes

- [ ] Community resources (Stack Convex, Discord) for practical observations

### Related Documents

- [research-convex-limits-best-practices-tracking.md](research-convex-limits-best-practices-tracking.md)
  — Tracking document with TODOs for coverage expansion and structural improvements

- [research-convex-durable-workflows-architecture.md](../../../project/research/current/research-convex-durable-workflows-architecture.md)
  — Durable workflows architecture analysis

## Appendix C: Complete Knobs Reference

The following is a categorized list of all configurable knobs with their environment
variable names and default values.
These can be set via environment variables for self-hosted deployments.

### Transaction Limits

| Knob | Env Var | Default |
| --- | --- | --- |
| `TRANSACTION_MAX_READ_SIZE_ROWS` | `TRANSACTION_MAX_READ_SIZE_ROWS` | 32,000 |
| `TRANSACTION_MAX_READ_SIZE_BYTES` | `TRANSACTION_MAX_READ_SIZE_BYTES` | 16 MiB |
| `TRANSACTION_MAX_READ_SET_INTERVALS` | `TRANSACTION_MAX_READ_SET_INTERVALS` | 4,096 |
| `TRANSACTION_MAX_NUM_USER_WRITES` | `TRANSACTION_MAX_NUM_USER_WRITES` | 16,000 |
| `TRANSACTION_MAX_USER_WRITE_SIZE_BYTES` | `TRANSACTION_MAX_USER_WRITE_SIZE_BYTES` | 16 MiB |
| `TRANSACTION_MAX_NUM_SCHEDULED` | `TRANSACTION_MAX_NUM_SCHEDULED` | 1,000 |

### Execution Limits

| Knob | Env Var | Default |
| --- | --- | --- |
| `DATABASE_UDF_USER_TIMEOUT` | `DATABASE_UDF_USER_TIMEOUT_SECONDS` | 1s |
| `DATABASE_UDF_SYSTEM_TIMEOUT` | `DATABASE_UDF_SYSTEM_TIMEOUT_SECONDS` | 15s |
| `ACTION_USER_TIMEOUT` | `ACTIONS_USER_TIMEOUT_SECS` | 600s |
| `V8_ACTION_SYSTEM_TIMEOUT` | `V8_ACTION_SYSTEM_TIMEOUT_SECONDS` | 300s |
| `HTTP_SERVER_TIMEOUT_DURATION` | `HTTP_SERVER_TIMEOUT_SECONDS` | 300s 🔍 |

### Memory Limits

| Knob | Env Var | Default |
| --- | --- | --- |
| `ISOLATE_MAX_USER_HEAP_SIZE` | `ISOLATE_MAX_USER_HEAP_SIZE` | 64 MB |
| `ISOLATE_MAX_HEAP_EXTRA_SIZE` | `ISOLATE_MAX_HEAP_EXTRA_SIZE` | 32 MB |
| `ISOLATE_MAX_ARRAY_BUFFER_TOTAL_SIZE` | `ISOLATE_MAX_ARRAY_BUFFER_TOTAL_SIZE` | 64 MB |
| `AWS_STATIC_LAMBDA_MEMORY_LIMIT_MB` | `AWS_STATIC_LAMBDA_MEMORY_LIMIT_MB` | 512 |
| `AWS_DYNAMIC_LAMBDA_MEMORY_LIMIT_MB` | `AWS_DYNAMIC_LAMBDA_MEMORY_LIMIT_MB` | 4,096 |

### Concurrency Limits

| Knob | Env Var | Default |
| --- | --- | --- |
| `APPLICATION_MAX_CONCURRENT_QUERIES` | `APPLICATION_MAX_CONCURRENT_QUERIES` | 16 |
| `APPLICATION_MAX_CONCURRENT_MUTATIONS` | `APPLICATION_MAX_CONCURRENT_MUTATIONS` | 16 |
| `APPLICATION_MAX_CONCURRENT_V8_ACTIONS` | `APPLICATION_MAX_CONCURRENT_V8_ACTIONS` | 16 |
| `APPLICATION_MAX_CONCURRENT_NODE_ACTIONS` | `APPLICATION_MAX_CONCURRENT_NODE_ACTIONS` | 16 |
| `APPLICATION_MAX_CONCURRENT_HTTP_ACTIONS` | `APPLICATION_MAX_CONCURRENT_HTTP_ACTIONS` | 16 |
| `HTTP_SERVER_MAX_CONCURRENT_REQUESTS` | `HTTP_SERVER_MAX_CONCURRENT_REQUESTS` | 1,024 |

### Search Index Limits

| Knob | Env Var | Default |
| --- | --- | --- |
| `SEARCH_INDEX_SIZE_SOFT_LIMIT` | `SEARCH_INDEX_SIZE_SOFT_LIMIT` | 10 MiB |
| `TEXT_INDEX_SIZE_HARD_LIMIT` | `SEARCH_INDEX_SIZE_HARD_LIMIT` | 100 MiB |
| `VECTOR_INDEX_SIZE_SOFT_LIMIT` | `VECTOR_INDEX_SIZE_SOFT_LIMIT` | 30 MiB |
| `VECTOR_INDEX_SIZE_HARD_LIMIT` | `VECTOR_INDEX_SIZE_HARD_LIMIT` | 100 MiB |

### OCC (Optimistic Concurrency Control)

| Knob | Env Var | Default |
| --- | --- | --- |
| `UDF_EXECUTOR_OCC_MAX_RETRIES` | `UDF_EXECUTOR_OCC_MAX_RETRIES` | 4 |
| `UDF_EXECUTOR_OCC_INITIAL_BACKOFF_MS` | `UDF_EXECUTOR_OCC_INITIAL_BACKOFF_MS` | 10ms |
| `UDF_EXECUTOR_OCC_MAX_BACKOFF_MS` | `UDF_EXECUTOR_OCC_MAX_BACKOFF_MS` | 2,000ms |

### Scheduling Limits

| Knob | Env Var | Default |
| --- | --- | --- |
| `MAX_SCHEDULED_JOB_ARGUMENT_SIZE_BYTES` | `MAX_SCHEDULED_JOB_ARGUMENT_SIZE_BYTES` | 1 MiB |
| `TRANSACTION_MAX_SCHEDULED_TOTAL_ARGUMENT_SIZE_BYTES` | `TRANSACTION_MAX_SCHEDULED_TOTAL_ARGUMENT_SIZE_BYTES` | 16 MiB |
| `SCHEDULED_JOB_EXECUTION_PARALLELISM` | `SCHEDULED_JOB_EXECUTION_PARALLELISM` | 10 |
| `SCHEDULED_JOB_RETENTION` | `SCHEDULED_JOB_RETENTION` | 7 days |

### Other Limits

| Knob | Env Var | Default |
| --- | --- | --- |
| `FUNCTION_MAX_ARGS_SIZE` | `FUNCTION_MAX_ARGS_SIZE` | 16 MiB |
| `FUNCTION_MAX_RESULT_SIZE` | `FUNCTION_MAX_RESULT_SIZE` | 16 MiB |
| `MAX_USER_MODULES` | `MAX_USER_MODULES` | 4,096 |
| `MAX_PUSH_BYTES` | `MAX_PUSH_BYTES` | 200 MB |
| `ENV_VAR_LIMIT` | `ENV_VAR_LIMIT` | 1,000 |

## Appendix D: Hard-Coded Limits Reference

The following limits require code modification to change.
They are deeply embedded in the value serialization and storage layers.

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

### Environment Variables (`crates/common/src/types/environment_variables.rs`)

```rust
pub const MAX_ENV_VAR_NAME_LENGTH: usize = 40;
pub const MAX_ENV_VAR_VALUE_LENGTH: usize = 8192;
```

## Appendix E: Self-Hosted Configuration Guide

This appendix consolidates guidance for configuring limits in self-hosted Convex
deployments.

### Safe Limits to Increase

These limits can be safely increased based on available resources:

- **Concurrency limits** (`APPLICATION_MAX_CONCURRENT_*`): Scale based on CPU cores and
  memory

- **Memory limits** (`ISOLATE_MAX_USER_HEAP_SIZE`): Scale based on available RAM

- **Execution timeouts**: Increase if running longer batch operations

- **Transaction limits**: Increase for larger batch operations if storage can handle it

### Limits Requiring Caution

These require careful consideration before changing:

- **Search index hard limits**: Affects memory usage during search operations

- **OCC retry counts**: Too many retries can cause cascading failures under load

- **HTTP concurrent requests**: May overwhelm downstream services

### Limits Not Recommended to Change

These are fundamental to system correctness:

- **Document structure limits**: Deeply embedded in serialization

- **Max search/vector results**: Query planning depends on these

- **Index field counts**: Storage format assumptions

### Example Configuration File

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

### Recommended Approach

1. **Start with defaults**: The default limits are well-tuned for general use cases

2. **Monitor before changing**: Use metrics to identify actual bottlenecks before
   adjusting limits

3. **Test thoroughly**: Changes to limits can have cascading effects on system behavior

4. **Document changes**: Maintain a configuration file with explanations for any
   modified limits
