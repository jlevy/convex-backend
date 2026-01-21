/**
 * Test workflows for performance testing.
 *
 * These workflows are designed to exercise specific aspects
 * of the workflow/workpool system to measure overhead.
 */

import { v } from "convex/values";
import { WorkflowManager, type WorkflowId } from "@convex-dev/workflow";
import { components, internal } from "./_generated/api";
import { mutation, query } from "./_generated/server";

// Create workflow manager instance
export const workflow = new WorkflowManager(components.workflow);

/**
 * Variable Duration Workflow
 *
 * Runs a series of steps with varying durations to test
 * scheduler wake-up behavior and inter-iteration gaps.
 *
 * Related bead: cvx-pznt
 */
export const variableDurationWorkflow = workflow.define({
  args: {
    durations: v.array(v.number()),
  },
  returns: v.object({
    gaps: v.array(v.number()),
    durations: v.array(v.number()),
    iterationTimestamps: v.array(v.number()),
  }),
  handler: async (step, args) => {
    const gaps: number[] = [];
    const iterationTimestamps: number[] = [];
    let prevEnd = Date.now();

    console.log(`[variableDurationWorkflow] starting with ${args.durations.length} steps`);

    for (let i = 0; i < args.durations.length; i++) {
      const iterStart = Date.now();
      const gap = iterStart - prevEnd;
      gaps.push(gap);
      iterationTimestamps.push(iterStart);

      console.log(
        `[variableDurationWorkflow] step ${i}: gap=${gap}ms, sleeping for ${args.durations[i]}ms`
      );

      await step.runAction(internal.testActions.sleepAction, {
        durationMs: args.durations[i],
      });

      prevEnd = Date.now();
    }

    console.log(`[variableDurationWorkflow] completed with gaps: ${gaps.join(", ")}`);

    return {
      gaps,
      durations: args.durations,
      iterationTimestamps,
    };
  },
});

/**
 * Variable Payload Workflow
 *
 * Runs steps that return payloads of varying sizes to test
 * the overhead from serialization/deserialization through workpool.
 *
 * Related beads: cvx-6c37, cvx-w816
 */
export const variablePayloadWorkflow = workflow.define({
  args: {
    payloadSizes: v.array(v.number()),
  },
  returns: v.object({
    measurements: v.array(
      v.object({
        sizeBytes: v.number(),
        elapsedMs: v.number(),
        resultLength: v.number(),
      })
    ),
  }),
  handler: async (step, args) => {
    const measurements: Array<{
      sizeBytes: number;
      elapsedMs: number;
      resultLength: number;
    }> = [];

    console.log(
      `[variablePayloadWorkflow] starting with ${args.payloadSizes.length} payload sizes`
    );

    for (const sizeBytes of args.payloadSizes) {
      const start = Date.now();

      // Use step.runQuery to return a payload of the specified size
      const result = await step.runQuery(internal.testQueries.generatePayload, {
        sizeBytes,
      });

      const elapsed = Date.now() - start;
      console.log(
        `[variablePayloadWorkflow] payload ${sizeBytes} bytes: ${elapsed}ms`
      );

      measurements.push({
        sizeBytes,
        elapsedMs: elapsed,
        resultLength: result.length,
      });
    }

    return { measurements };
  },
});

/**
 * Journal Scaling Workflow
 *
 * Runs N iterations to test how journal load time scales
 * with the number of completed steps.
 *
 * Each iteration measures the time from handler start to step completion,
 * which includes journal load time.
 */
export const journalScalingWorkflow = workflow.define({
  args: {
    iterations: v.number(),
  },
  returns: v.object({
    iterationTimes: v.array(
      v.object({
        iteration: v.number(),
        elapsedMs: v.number(),
        timestamp: v.number(),
      })
    ),
    totalIterations: v.number(),
  }),
  handler: async (step, args) => {
    const iterationTimes: Array<{
      iteration: number;
      elapsedMs: number;
      timestamp: number;
    }> = [];

    console.log(
      `[journalScalingWorkflow] starting with ${args.iterations} iterations`
    );

    for (let i = 0; i < args.iterations; i++) {
      const iterStart = Date.now();

      // Increment counter (adds a journal entry)
      await step.runMutation(internal.testMutations.incrementCounter, {
        workflowId: step.workflowId,
        step: i,
      });

      const elapsed = Date.now() - iterStart;
      console.log(
        `[journalScalingWorkflow] iteration ${i}: ${elapsed}ms`
      );

      iterationTimes.push({
        iteration: i,
        elapsedMs: elapsed,
        timestamp: Date.now(),
      });
    }

    return {
      iterationTimes,
      totalIterations: args.iterations,
    };
  },
});

/**
 * Mixed Tool Pattern Workflow
 *
 * Simulates the external engineer's observed pattern with a mix of:
 * - Simple, fast tools (like stock_prices_historical)
 * - Complex, multi-step tools (like llm_filtered_web_search)
 *
 * This workflow measures gaps after each tool type to identify
 * scheduler wake-up failures.
 *
 * Related beads: cvx-pznt, cvx-v6tf
 */
export const mixedToolPatternWorkflow = workflow.define({
  args: {
    // Pattern: "simple" | "complex" for each iteration
    pattern: v.array(v.union(v.literal("simple"), v.literal("complex"))),
    // Optional: Override default tool parameters
    simpleToolDurationMs: v.optional(v.number()),
    complexToolSearchMs: v.optional(v.number()),
    complexToolFilterPasses: v.optional(v.number()),
    complexToolFilterMs: v.optional(v.number()),
    complexToolResultKb: v.optional(v.number()),
  },
  returns: v.object({
    iterations: v.array(
      v.object({
        index: v.number(),
        toolType: v.string(),
        toolDurationMs: v.number(),
        gapFromPrevMs: v.number(),
        iterationStartTs: v.number(),
        iterationEndTs: v.number(),
        toolStartTs: v.number(),
        toolEndTs: v.number(),
      })
    ),
    summary: v.object({
      simpleToolAvgGapMs: v.number(),
      complexToolAvgGapMs: v.number(),
      maxGapMs: v.number(),
      gapsOver5s: v.number(),
    }),
  }),
  handler: async (step, args) => {
    const iterations: Array<{
      index: number;
      toolType: string;
      toolDurationMs: number;
      gapFromPrevMs: number;
      iterationStartTs: number;
      iterationEndTs: number;
      toolStartTs: number;
      toolEndTs: number;
    }> = [];

    let prevEndTs = Date.now();
    console.log(`[mixedToolPatternWorkflow] starting with ${args.pattern.length} iterations`);

    for (let i = 0; i < args.pattern.length; i++) {
      const iterationStartTs = Date.now();
      const gapFromPrevMs = iterationStartTs - prevEndTs;
      const toolType = args.pattern[i];

      console.log(
        `[mixedToolPatternWorkflow] iteration ${i}: type=${toolType}, gap=${gapFromPrevMs}ms`
      );

      let toolStartTs: number;
      let toolEndTs: number;
      let toolDurationMs: number;

      if (toolType === "simple") {
        toolStartTs = Date.now();
        const result = await step.runAction(internal.testActions.simulateSimpleTool, {
          durationMs: args.simpleToolDurationMs ?? 100,
          resultSizeKb: 5,
        });
        toolEndTs = Date.now();
        toolDurationMs = result.timing.totalMs;
      } else {
        toolStartTs = Date.now();
        const result = await step.runAction(internal.testActions.simulateLlmFilteredWebSearch, {
          searchDurationMs: args.complexToolSearchMs ?? 2000,
          filterPassesCount: args.complexToolFilterPasses ?? 3,
          filterPassDurationMs: args.complexToolFilterMs ?? 500,
          resultSizeKb: args.complexToolResultKb ?? 50,
        });
        toolEndTs = Date.now();
        toolDurationMs = result.timing.totalMs;
      }

      const iterationEndTs = Date.now();
      prevEndTs = iterationEndTs;

      iterations.push({
        index: i,
        toolType,
        toolDurationMs,
        gapFromPrevMs,
        iterationStartTs,
        iterationEndTs,
        toolStartTs,
        toolEndTs,
      });
    }

    // Calculate summary statistics
    const simpleGaps = iterations.filter((it) => it.toolType === "simple").map((it) => it.gapFromPrevMs);
    const complexGaps = iterations.filter((it) => it.toolType === "complex").map((it) => it.gapFromPrevMs);
    const allGaps = iterations.map((it) => it.gapFromPrevMs);

    // Skip first gap (from workflow start)
    const simpleAvg =
      simpleGaps.length > 1
        ? simpleGaps.slice(1).reduce((a, b) => a + b, 0) / (simpleGaps.length - 1)
        : 0;
    const complexAvg =
      complexGaps.length > 1
        ? complexGaps.slice(1).reduce((a, b) => a + b, 0) / (complexGaps.length - 1)
        : 0;

    const summary = {
      simpleToolAvgGapMs: simpleAvg,
      complexToolAvgGapMs: complexAvg,
      maxGapMs: Math.max(...allGaps.slice(1)),
      gapsOver5s: allGaps.slice(1).filter((g) => g > 5000).length,
    };

    console.log(
      `[mixedToolPatternWorkflow] complete: simpleAvg=${simpleAvg.toFixed(0)}ms, ` +
      `complexAvg=${complexAvg.toFixed(0)}ms, maxGap=${summary.maxGapMs}ms, ` +
      `gapsOver5s=${summary.gapsOver5s}`
    );

    return { iterations, summary };
  },
});

/**
 * Accountability Tracking Workflow
 *
 * Measures total workflow time vs sum of measured components to calculate
 * the "accountability percentage" - identifying unaccounted time.
 *
 * The external engineer observed only ~63% accountability (37% unaccounted).
 *
 * Related bead: cvx-13wu
 */
export const accountabilityTrackingWorkflow = workflow.define({
  args: {
    iterations: v.number(),
    toolDurationMs: v.optional(v.number()),
  },
  returns: v.object({
    totalWorkflowMs: v.number(),
    measuredComponents: v.object({
      toolExecutionMs: v.number(),
      gapsBetweenIterationsMs: v.number(),
      stepOverheadMs: v.number(),
    }),
    accountabilityPct: v.number(),
    unaccountedMs: v.number(),
    iterationDetails: v.array(
      v.object({
        iteration: v.number(),
        iterationStartTs: v.number(),
        toolStartTs: v.number(),
        toolEndTs: v.number(),
        iterationEndTs: v.number(),
        gapFromPrevMs: v.number(),
        toolDurationMs: v.number(),
        stepOverheadMs: v.number(),
      })
    ),
  }),
  handler: async (step, args) => {
    const workflowStartTs = Date.now();
    const iterationDetails: Array<{
      iteration: number;
      iterationStartTs: number;
      toolStartTs: number;
      toolEndTs: number;
      iterationEndTs: number;
      gapFromPrevMs: number;
      toolDurationMs: number;
      stepOverheadMs: number;
    }> = [];

    let prevEndTs = workflowStartTs;
    const toolDurationMs = args.toolDurationMs ?? 500;

    console.log(
      `[accountabilityTrackingWorkflow] starting with ${args.iterations} iterations, ` +
      `toolDuration=${toolDurationMs}ms`
    );

    for (let i = 0; i < args.iterations; i++) {
      const iterationStartTs = Date.now();
      const gapFromPrevMs = iterationStartTs - prevEndTs;

      const toolStartTs = Date.now();
      await step.runAction(internal.testActions.sleepAction, {
        durationMs: toolDurationMs,
      });
      const toolEndTs = Date.now();

      const iterationEndTs = Date.now();
      const actualToolDurationMs = toolEndTs - toolStartTs;
      const stepOverheadMs = (iterationEndTs - iterationStartTs) - actualToolDurationMs;

      iterationDetails.push({
        iteration: i,
        iterationStartTs,
        toolStartTs,
        toolEndTs,
        iterationEndTs,
        gapFromPrevMs,
        toolDurationMs: actualToolDurationMs,
        stepOverheadMs,
      });

      prevEndTs = iterationEndTs;

      console.log(
        `[accountabilityTrackingWorkflow] iteration ${i}: gap=${gapFromPrevMs}ms, ` +
        `tool=${actualToolDurationMs}ms, overhead=${stepOverheadMs}ms`
      );
    }

    const workflowEndTs = Date.now();
    const totalWorkflowMs = workflowEndTs - workflowStartTs;

    // Sum measured components (skip first gap which is from workflow start)
    const totalToolExecutionMs = iterationDetails.reduce((sum, it) => sum + it.toolDurationMs, 0);
    const totalGapsMs = iterationDetails.slice(1).reduce((sum, it) => sum + it.gapFromPrevMs, 0);
    const totalStepOverheadMs = iterationDetails.reduce((sum, it) => sum + it.stepOverheadMs, 0);

    const measuredComponents = {
      toolExecutionMs: totalToolExecutionMs,
      gapsBetweenIterationsMs: totalGapsMs,
      stepOverheadMs: totalStepOverheadMs,
    };

    const totalMeasuredMs =
      measuredComponents.toolExecutionMs +
      measuredComponents.gapsBetweenIterationsMs +
      measuredComponents.stepOverheadMs;

    const accountabilityPct = (totalMeasuredMs / totalWorkflowMs) * 100;
    const unaccountedMs = totalWorkflowMs - totalMeasuredMs;

    console.log(
      `[accountabilityTrackingWorkflow] complete: total=${totalWorkflowMs}ms, ` +
      `measured=${totalMeasuredMs}ms, accountability=${accountabilityPct.toFixed(1)}%, ` +
      `unaccounted=${unaccountedMs}ms`
    );

    return {
      totalWorkflowMs,
      measuredComponents,
      accountabilityPct,
      unaccountedMs,
      iterationDetails,
    };
  },
});

/**
 * Minimal Overhead Workflow
 *
 * Runs N noop steps to establish baseline overhead.
 */
export const minimalOverheadWorkflow = workflow.define({
  args: {
    steps: v.number(),
  },
  returns: v.object({
    stepTimes: v.array(v.number()),
    totalSteps: v.number(),
  }),
  handler: async (step, args) => {
    const stepTimes: number[] = [];

    console.log(`[minimalOverheadWorkflow] starting with ${args.steps} steps`);

    for (let i = 0; i < args.steps; i++) {
      const start = Date.now();
      await step.runAction(internal.testActions.noopAction, {});
      stepTimes.push(Date.now() - start);
    }

    return {
      stepTimes,
      totalSteps: args.steps,
    };
  },
});

// ============================================================================
// Workflow Start/Complete Handlers
// ============================================================================

/**
 * Starts a variable duration workflow and returns the workflow ID.
 */
export const startVariableDurationWorkflow = mutation({
  args: {
    durations: v.array(v.number()),
  },
  returns: v.string(),
  handler: async (ctx, args): Promise<string> => {
    const id: WorkflowId = await workflow.start(
      ctx,
      internal.testWorkflows.variableDurationWorkflow,
      { durations: args.durations }
    );
    console.log(`[startVariableDurationWorkflow] started workflow ${id}`);
    return id;
  },
});

/**
 * Starts a variable payload workflow and returns the workflow ID.
 */
export const startVariablePayloadWorkflow = mutation({
  args: {
    payloadSizes: v.array(v.number()),
  },
  returns: v.string(),
  handler: async (ctx, args): Promise<string> => {
    const id: WorkflowId = await workflow.start(
      ctx,
      internal.testWorkflows.variablePayloadWorkflow,
      { payloadSizes: args.payloadSizes }
    );
    console.log(`[startVariablePayloadWorkflow] started workflow ${id}`);
    return id;
  },
});

/**
 * Starts a journal scaling workflow and returns the workflow ID.
 */
export const startJournalScalingWorkflow = mutation({
  args: {
    iterations: v.number(),
  },
  returns: v.string(),
  handler: async (ctx, args): Promise<string> => {
    const id: WorkflowId = await workflow.start(
      ctx,
      internal.testWorkflows.journalScalingWorkflow,
      { iterations: args.iterations }
    );
    console.log(`[startJournalScalingWorkflow] started workflow ${id}`);
    return id;
  },
});

/**
 * Starts a minimal overhead workflow and returns the workflow ID.
 */
export const startMinimalOverheadWorkflow = mutation({
  args: {
    steps: v.number(),
  },
  returns: v.string(),
  handler: async (ctx, args): Promise<string> => {
    const id: WorkflowId = await workflow.start(
      ctx,
      internal.testWorkflows.minimalOverheadWorkflow,
      { steps: args.steps }
    );
    console.log(`[startMinimalOverheadWorkflow] started workflow ${id}`);
    return id;
  },
});

/**
 * Starts a mixed tool pattern workflow and returns the workflow ID.
 *
 * Related beads: cvx-pznt, cvx-v6tf
 */
export const startMixedToolPatternWorkflow = mutation({
  args: {
    pattern: v.array(v.union(v.literal("simple"), v.literal("complex"))),
    simpleToolDurationMs: v.optional(v.number()),
    complexToolSearchMs: v.optional(v.number()),
    complexToolFilterPasses: v.optional(v.number()),
    complexToolFilterMs: v.optional(v.number()),
    complexToolResultKb: v.optional(v.number()),
  },
  returns: v.string(),
  handler: async (ctx, args): Promise<string> => {
    const id: WorkflowId = await workflow.start(
      ctx,
      internal.testWorkflows.mixedToolPatternWorkflow,
      args
    );
    console.log(`[startMixedToolPatternWorkflow] started workflow ${id}`);
    return id;
  },
});

/**
 * Starts an accountability tracking workflow and returns the workflow ID.
 *
 * Related bead: cvx-13wu
 */
export const startAccountabilityTrackingWorkflow = mutation({
  args: {
    iterations: v.number(),
    toolDurationMs: v.optional(v.number()),
  },
  returns: v.string(),
  handler: async (ctx, args): Promise<string> => {
    const id: WorkflowId = await workflow.start(
      ctx,
      internal.testWorkflows.accountabilityTrackingWorkflow,
      args
    );
    console.log(`[startAccountabilityTrackingWorkflow] started workflow ${id}`);
    return id;
  },
});

/**
 * Gets the status and result of a workflow.
 */
export const getWorkflowStatus = query({
  args: {
    workflowId: v.string(),
  },
  handler: async (ctx, { workflowId }) => {
    const status = await workflow.status(ctx, workflowId as WorkflowId);
    console.log(`[getWorkflowStatus] ${workflowId}: ${status.type}`);
    return status;
  },
});
