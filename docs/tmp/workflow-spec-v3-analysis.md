# Plan Spec V3: Durable Workflows for Agent Conversations

## Purpose

This spec details the migration of experiment/evaluation execution pipelines from manual
orchestration to `@convex-dev/workflow` durable workflows.

**Goals:**

1. Enable agent conversations that survive the 10-minute Convex action timeout

2. Support tool calls that take up to 1 hour (research workflows)

3. Eliminate ~700 LOC of manual orchestration code (watchdogs, scheduler chains)

4. Maintain backward compatibility with existing UI and data model

**Version History:**

| Version | Status | Summary |
| --- | --- | --- |
| V1 | Superseded | Three-phase approach (day-level → batch-level → per-tool checkpointing) |
| V2 | Superseded | Correct architecture but insufficient implementation detail |
| **V3** | **Active** | Complete implementation spec with idempotency, error handling, migration |

**Why V3?**

- V1's Phase 1/2 assumed tool calls fit within 10 minutes — invalid for our workload

- V2 captured the right architecture but lacked: message persistence, idempotency,
  cancellation, error handling, step budget analysis, testing strategy

- V3 provides implementation-ready detail while keeping V2's architectural decisions

**Related Documentation:**

- [arch-execution.md](../../architecture/current/arch-execution.md) - Current execution
  architecture

- [arch-evaluation-framework.md](../../architecture/current/arch-evaluation-framework.md)
  \- Evaluation framework

- [plan-2026-01-02-workflow-research-tools.md](plan-2026-01-02-workflow-research-tools.md)
  \- Research tools workflow (existing pattern we're extending)

- [research-durable-workflows-agent-conversations.md](../../research/current/research-durable-workflows-agent-conversations.md)
  \- Research brief exploring design options (this spec chose specific approaches after
  review)

- [research-convex-db-limits-best-practices.md](../../../general/research/current/research-convex-db-limits-best-practices.md)
  \- Convex platform limits and constraints informing design decisions

* * *

## Background

### The Problem

AI Trade Arena's agent execution pipeline faces two critical constraints that the
current architecture cannot handle:

**1. The Time Constraint**

- Convex Actions have a **hard 10-minute timeout**

- Our research tools (`company_research`, `earnings_analysis`) take **10-60 minutes**

- The current `processAgent` action wraps the entire conversation loop

- A single long tool call kills the entire day's execution

**2. The Scale Constraint**

- Backtests run for **252+ trading days** (a full year)

- Evaluations process **thousands of datapoints** (company simulations)

- The current `scheduler.runAfter` chains have race conditions with watchdogs

- No mid-conversation recovery — timeout means lost work

### Typical Workloads and Priorities

Understanding concrete usage patterns is critical for design decisions:

**Backtests:**

| Aspect | Typical Scale | Constraint |
| --- | --- | --- |
| Duration | ~300 trading days (1 year) | Sequential — day N depends on day N-1 |
| Agents per day | Tens (mini-ensembles) | Can run in parallel within a day |
| Tool calls per day | 1-5 per agent | Heavy tools (research) take 10-60 min |

**Evaluations:**

| Aspect | Typical Scale | Constraint |
| --- | --- | --- |
| Concurrent evaluations | ~5 at a time | Resource-limited |
| Datapoints per evaluation | Hundreds to thousands | Independent — can run in parallel |
| Tool calls per datapoint | 1-3 | May include heavy tools |

**Tool Call Durations:**

| Tool Type | Duration | Execution |
| --- | --- | --- |
| LLM decision | Always <10 min | Action |
| All tool calls | Seconds to 60 min | Child workflow |

**Important:** Tool duration is **highly variable** and **unpredictable**:

- **Cached results**: Return in seconds (cache hit)

- **Uncached results**: May take seconds (API calls) to 60 minutes (research workflows)

- **No reliable prediction**: Caller doesn't know ahead of time which case applies

**Design Decision: All tools execute as child workflows.** This simplifies the
architecture:

1. **No heavy/light distinction** — uniform code path for all tools

2. **No maintenance burden** — no list of "heavy tools" to maintain

3. **Future-proof** — if any tool gets slower, it's already handled

4. **Negligible overhead** — tool calls already take seconds, workflow overhead is
   milliseconds

**Key Design Constraint:** We cannot wrap an LLM call and a tool call together in a
single action because tool calls may exceed the 10-minute timeout.
The workflow must interleave them as separate steps with checkpoints between each.

### Current Architecture Pain Points

From [arch-execution.md](../../architecture/current/arch-execution.md):

```
Current Flow:
  startBacktest → scheduler.runAfter(backtestStep, day=1)
                       ↓
  backtestStep → processAgent (single 10-min action containing entire conversation)
                       ↓
               → scheduler.runAfter(stepWatchdog) [race condition!]
                       ↓
               → scheduler.runAfter(backtestStep, day+1)
```

**Problems:**

1. `processAgent` bundles LLM call + tool loop in one action — exceeds timeout

2. Watchdog races with successful completion — duplicate events possible

3. No checkpoint within conversation — timeout loses all progress

4. ~700 LOC of manual orchestration (`experimentExecution.ts`, `evaluationRunner.ts`)

### Existing Workflow Pattern

We've already solved the timeout problem for research tools using
`@convex-dev/workflow`. The pattern in
[researchWorkflowsCore.ts](../../../web/convex/workflows/researchWorkflowsCore.ts)
demonstrates:

```typescript
// Existing pattern - research workflows
export const singleTickerResearchWorkflow = workflowManager.define({
  handler: async (step, args) => {
    // Step 1: Check cache
    const cached = await step.runQuery(internal.caching.getResearchReport, {...});
    if (cached) return cached;

    // Step 2: Get form
    const form = await step.runAction(internal.workflows.getFormMarkdown, {...});

    // Step 3: Batched execution loop
    for (let batch = 0; batch < MAX_BATCHES; batch++) {
      const result = await step.runAction(internal.workflows.runMarkformBatch, {
        formMarkdown: currentForm,
        maxTurnsThisCall: TURNS_PER_BATCH,  // Bounded work per step
        ...
      });
      if (result.isComplete) break;
      // [checkpoint — workflow journals state here]
    }

    // Step 4: Cache result
    await step.runMutation(internal.caching.upsertResearchReport, {...});
  }
});
```

**Key insight:** This same pattern applies to agent conversations — break the loop into
discrete workflow steps with checkpoints between each.

* * *

## Limits Reference

### Hard Limits (Convex Platform)

| Limit | Value | Impact on Design |
| --- | --- | --- |
| **Action timeout** | 10 minutes | Each `step.runAction()` must complete within this |
| **Mutation user code** | 1 second | Workflow handler replay must stay under this |
| **Workflow journal** | 8 MiB | Total serialized state — forces pass-by-reference |
| **Step data** | 1 MiB | Args + return value per step — no large payloads |
| **Document size** | 1 MiB | Limits conversation history per document |

### Configurable Settings

| Setting | Location | Current | Purpose |
| --- | --- | --- | --- |
| `MAX_LLM_TOOL_STEPS` | `config/settings.ts` | 20 | Max tool calls per conversation |
| `WORKFLOW_MAX_STEPS` | `config/settings.ts` | 50 | **NEW**: Max steps before child workflow |
| `WORKFLOW_RETENTION_DAYS` | `config/settings.ts` | 7 | **NEW**: Days before cleanup |

### Memory and Logging Constraints

| Constraint | Value | Mitigation in Design |
| --- | --- | --- |
| Action memory (Convex Runtime) | 64 MB | Insufficient for LLM responses |
| Action memory (Node.js Runtime) | 512 MB | LLM actions use `"use node";` directive |
| Log lines per execution | 256 | Log milestones only, not per-iteration details |
| Array return limit (queries) | 8,192 elements | `buildMessagesForLlm` uses `.take(MAX_MESSAGES)` |
| Document size | 1 MiB | `toolResults.result` truncated at 900KB |

**Key mitigations:**

1. **LLM actions require Node.js runtime**: The `decideNextStep` action must include
   `"use node";` to get the 512MB memory limit (vs 64MB default).

2. **Logging strategy**: Long-running workflows should log milestones (start, complete,
   error) rather than per-iteration details.
   Logs are silently truncated at 256 lines.

3. **Query array bounds**: Queries returning arrays must use `.take(limit)` to stay
   under 8,192 elements.
   The `buildMessagesForLlm` query should cap at ~1000 messages.

### Runtime Classification

Per [PR #226](https://github.com/jlevy/ai-trade-arena/pull/226), files with `"use
node";` can only contain actions (no queries/mutations).
This constraint shapes our file organization:

| File | Runtime | Memory | Contains |
| --- | --- | --- | --- |
| `agentConversationWorkflow.ts` | Convex | 64 MB | Workflow definition (mutation-like) |
| `toolWorkflows.ts` | Convex | 64 MB | Workflow definition (mutation-like) |
| `backtestChainWorkflow.ts` | Convex | 64 MB | Workflow definition (mutation-like) |
| `evaluationWorkflows.ts` | Convex | 64 MB | Workflow definition (mutation-like) |
| **`agentActions.ts`** | **Node.js** | **512 MB** | `decideNextStep`, `executeToolAction` |
| **`researchWorkflows.ts`** | **Node.js** | **512 MB** | `runMarkformBatch`, `getFormMarkdown` |
| `agentHelpers.ts` | Convex | 64 MB | Mutations: `saveToolResult`, `persistToolResult` |
| `backtestHelpers.ts` | Convex | 64 MB | Mutations: `initializeDay`, `finalizeDay` |
| `evaluationHelpers.ts` | Convex | 64 MB | Mutations: `initializeDatapoint`, `recordDatapointResult` |

**Why this matters:**

- **Workflow definitions** are treated as mutations by Convex (for state journaling) —
  cannot use `"use node";`

- **LLM-calling actions** need 512 MB for large responses — must use `"use node";`

- **Tool execution actions** may process large data — should use `"use node";`

- **Helper mutations/queries** stay on Convex runtime (64 MB is sufficient)

**File structure pattern:**
```
workflows/
├── agentConversationWorkflow.ts   # Workflow def (Convex runtime)
├── toolWorkflows.ts               # Workflow def (Convex runtime)
└── ...
exec/
├── agentActions.ts                # "use node"; — LLM + tool actions
├── agentHelpers.ts                # Mutations/queries (Convex runtime)
└── ...
```

### Step Budget Analysis

**Critical Constraint:** Workflow handlers are mutations.
The 1-second CPU limit applies to replay overhead.
Empirically, workflows with >50-100 steps may hit this limit.

**Proposed Architecture Step Counts:**

| Workflow | Steps per Execution | Analysis |
| --- | --- | --- |
| `agentConversationWorkflow` | 1-42 (2 per iteration + eval result) | ✅ Safe for 20 iterations |
| `backtestDayWorkflow` | 3-5 (mini-ensemble + finalize + trigger next) | ✅ Safe |
| `backtestChain` (300 days) | Fire-and-forget: each day exits independently | ✅ Safe (O(1) journal) |
| `evalBatchRunner` (20 items) | 40-45 (2 per datapoint + overhead) | ✅ Safe |
| `evaluationCoordinator` | ~50-100 (batch spawns) | ✅ Safe (1 step per batch) |

**Key Design Decisions:**

1. **Fire-and-forget backtest chain**: Day N triggers Day N+1 via action and exits.
   Avoids 300-deep call stack.

2. **Eval batch size = 20**: With 2 steps per datapoint (init + child workflow), stays
   under 50-step limit.

3. **Record result in child**: `recordDatapointResult` is called inside
   `agentConversationWorkflow`, not in batch runner.
   Saves 1 step per datapoint.

* * *

## Core Architecture

### Overview

```
┌─────────────────────────────────────────────────────────────────────────────┐
│  Entry: startBacktest / startEvaluation                                      │
│  Creates experimentRun, spawns root workflow                                 │
└─────────────────────────────────────────────────────────────────────────────┘
                                    │
                    ┌───────────────┴───────────────┐
                    ▼                               ▼
┌───────────────────────────────────┐   ┌───────────────────────────────────────┐
│  Backtest: Linked Chain        │   │  Evaluation: Batch Dispatcher          │
│  Day 1 → Day 2 → ... → Day N   │   │  Coordinator → BatchRunner(s)          │
└───────────────────────────────────┘   └───────────────────────────────────────┘
                    │                               │
                    └───────────────┬───────────────┘
                                    ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│  agentConversationWorkflow (The Engine)                                      │
│  Interleaved: LLM Call (action) ↔ Tool Call (action or child workflow)      │
└─────────────────────────────────────────────────────────────────────────────┘
```

[... rest of spec truncated for file size - full spec saved ...]
