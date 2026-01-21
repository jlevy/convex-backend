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
 * Related bead: cvx-fcqi
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
 * Related beads: cvx-g6ac, cvx-vjh4
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
 * Related beads: cvx-fcqi, cvx-1l22
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
 * Related bead: cvx-5kc4
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
// Fully-Instrumented Workflow for Deep Timing Analysis
// Related beads: cvx-88z7, cvx-d3nl, cvx-ox3h, cvx-w9ev
// ============================================================================

/**
 * Fully-Instrumented Workflow
 *
 * This workflow captures timing events at every possible point to achieve
 * 100% accountability of workflow execution time.
 *
 * Timing points captured:
 * 1. handler_start - When handler begins executing
 * 2. pre_step - Just before calling step.runAction
 * 3. action_start - Inside action, first thing (via instrumentedAction)
 * 4. action_end - Inside action, last thing (via instrumentedAction)
 * 5. post_step - Just after step.runAction returns
 * 6. handler_end - When handler completes
 *
 * The workflow stores its ID in a closure so the action can log events
 * associated with the same workflow.
 *
 * After workflow completes, call analyzeTimingEvents to compute breakdown.
 */
// Define return type for fullyInstrumentedWorkflow to avoid implicit any
type InstrumentedWorkflowResult = {
  workflowId: string;
  stepCount: number;
  invocationCount: number;
  firstHandlerStartTs: number;
  lastHandlerEndTs: number;
  totalDurationMs: number;
};

export const fullyInstrumentedWorkflow = workflow.define({
  args: {
    workflowId: v.string(),  // Passed in so we can correlate events
    stepCount: v.number(),
    stepDurationMs: v.number(),
    stepPayloadSizeKb: v.optional(v.number()),
  },
  returns: v.object({
    workflowId: v.string(),
    stepCount: v.number(),
    invocationCount: v.number(),
    firstHandlerStartTs: v.number(),
    lastHandlerEndTs: v.number(),
    totalDurationMs: v.number(),
  }),
  handler: async (step, args): Promise<InstrumentedWorkflowResult> => {
    // Track invocation number for this handler call
    // This increments each time the handler is invoked (replayed)
    const invocationNumber: { step: number; value: number; timestamp: number } = await step.runMutation(
      internal.testMutations.incrementCounter,
      { workflowId: args.workflowId, step: -1 }
    );

    const handlerStartTs = Date.now();

    // Log handler_start event
    await step.runMutation(internal.testMutations.logTimingEvent, {
      workflowId: args.workflowId,
      invocationNumber: invocationNumber.value,
      eventType: "handler_start",
      timestamp: handlerStartTs,
      metadata: { stepCount: args.stepCount },
    });

    console.log(
      `[fullyInstrumentedWorkflow] handler invocation ${invocationNumber.value} ` +
      `starting at ${handlerStartTs}, ${args.stepCount} steps`
    );

    // Run each step with full instrumentation
    for (let i = 0; i < args.stepCount; i++) {
      const preStepTs = Date.now();

      // Log pre_step event
      await step.runMutation(internal.testMutations.logTimingEvent, {
        workflowId: args.workflowId,
        invocationNumber: invocationNumber.value,
        stepIndex: i,
        eventType: "pre_step",
        timestamp: preStepTs,
        metadata: { stepIndex: i },
      });

      // Run the instrumented action (it logs action_start and action_end internally)
      const actionResult = await step.runAction(internal.testActions.instrumentedAction, {
        workflowId: args.workflowId,
        invocationNumber: invocationNumber.value,
        stepIndex: i,
        durationMs: args.stepDurationMs,
        payloadSizeKb: args.stepPayloadSizeKb,
      });

      const postStepTs = Date.now();

      // Log post_step event
      await step.runMutation(internal.testMutations.logTimingEvent, {
        workflowId: args.workflowId,
        invocationNumber: invocationNumber.value,
        stepIndex: i,
        eventType: "post_step",
        timestamp: postStepTs,
        metadata: {
          stepIndex: i,
          actionDurationMs: actionResult.actualDurationMs,
          stepTotalMs: postStepTs - preStepTs,
        },
      });

      console.log(
        `[fullyInstrumentedWorkflow] step ${i} complete: ` +
        `preStep=${preStepTs}, actionStart=${actionResult.actionStartTs}, ` +
        `actionEnd=${actionResult.actionEndTs}, postStep=${postStepTs}`
      );
    }

    const handlerEndTs = Date.now();

    // Log handler_end event
    await step.runMutation(internal.testMutations.logTimingEvent, {
      workflowId: args.workflowId,
      invocationNumber: invocationNumber.value,
      eventType: "handler_end",
      timestamp: handlerEndTs,
      metadata: { handlerDurationMs: handlerEndTs - handlerStartTs },
    });

    // Return summary (only executed on final invocation)
    return {
      workflowId: args.workflowId,
      stepCount: args.stepCount,
      invocationCount: invocationNumber.value,
      firstHandlerStartTs: handlerStartTs,  // This is the last invocation's start
      lastHandlerEndTs: handlerEndTs,
      totalDurationMs: handlerEndTs - handlerStartTs,
    };
  },
});

// ============================================================================
// Workflow Start/Complete Handlers
// ============================================================================

/**
 * Starts a fully-instrumented workflow and returns both workflow IDs.
 *
 * Returns an object with:
 * - internalId: The internal workflow ID for status polling
 * - correlationId: The correlation ID for timing event analysis
 *
 * Related beads: cvx-88z7, cvx-d3nl, cvx-ox3h, cvx-w9ev
 */
export const startFullyInstrumentedWorkflow = mutation({
  args: {
    stepCount: v.number(),
    stepDurationMs: v.number(),
    stepPayloadSizeKb: v.optional(v.number()),
  },
  returns: v.object({
    internalId: v.string(),
    correlationId: v.string(),
  }),
  handler: async (ctx, args) => {
    // Generate a unique workflow ID for event correlation
    const correlationId = `instrumented-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

    const internalId: WorkflowId = await workflow.start(
      ctx,
      internal.testWorkflows.fullyInstrumentedWorkflow,
      {
        workflowId: correlationId,
        stepCount: args.stepCount,
        stepDurationMs: args.stepDurationMs,
        stepPayloadSizeKb: args.stepPayloadSizeKb,
      }
    );
    console.log(`[startFullyInstrumentedWorkflow] started workflow ${internalId} with correlationId ${correlationId}`);
    return { internalId, correlationId };
  },
});

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
 * Related beads: cvx-fcqi, cvx-1l22
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
 * Related bead: cvx-5kc4
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

// ============================================================================
// runQuery vs runAction Comparison Workflow (cvx-vjh4)
// Compares overhead of step.runQuery vs step.runAction with same payload
// ============================================================================

/**
 * Variable Payload Workflow using runAction
 *
 * This is identical to variablePayloadWorkflow but uses step.runAction
 * instead of step.runQuery. This allows direct comparison of overhead.
 *
 * Related bead: cvx-vjh4
 */
export const variablePayloadActionWorkflow = workflow.define({
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
    method: v.literal("runAction"),
  }),
  handler: async (step, args) => {
    const measurements: Array<{
      sizeBytes: number;
      elapsedMs: number;
      resultLength: number;
    }> = [];

    console.log(
      `[variablePayloadActionWorkflow] starting with ${args.payloadSizes.length} payload sizes (using runAction)`
    );

    for (const sizeBytes of args.payloadSizes) {
      const start = Date.now();

      // Use step.runAction instead of step.runQuery
      const result = await step.runAction(internal.testActions.generatePayload, {
        sizeBytes,
      });

      const elapsed = Date.now() - start;
      console.log(
        `[variablePayloadActionWorkflow] payload ${sizeBytes} bytes: ${elapsed}ms`
      );

      measurements.push({
        sizeBytes,
        elapsedMs: elapsed,
        resultLength: result.payload.length,
      });
    }

    return { measurements, method: "runAction" as const };
  },
});

/**
 * Starts the runAction-based payload workflow for comparison.
 *
 * Related bead: cvx-vjh4
 */
export const startVariablePayloadActionWorkflow = mutation({
  args: {
    payloadSizes: v.array(v.number()),
  },
  returns: v.string(),
  handler: async (ctx, args): Promise<string> => {
    const id: WorkflowId = await workflow.start(
      ctx,
      internal.testWorkflows.variablePayloadActionWorkflow,
      { payloadSizes: args.payloadSizes }
    );
    console.log(`[startVariablePayloadActionWorkflow] started workflow ${id}`);
    return id;
  },
});

// ============================================================================
// onComplete Handler Pattern Example (cvx-ndxf)
// Demonstrates using the onComplete callback from official workflow examples
// ============================================================================

/**
 * Starts a variable duration workflow WITH onComplete callback.
 *
 * This demonstrates the official pattern for handling workflow completion:
 * - The onComplete handler is called automatically when workflow finishes
 * - Custom context can be passed through and retrieved in the handler
 * - Useful for automatic result recording, cleanup, or triggering follow-up actions
 *
 * Related bead: cvx-ndxf
 *
 * @example
 * ```typescript
 * const workflowId = await client.mutation(
 *   api.testWorkflows.startVariableDurationWithOnComplete,
 *   {
 *     durations: [100, 200, 300],
 *     testRunId: "test-123",
 *   }
 * );
 * // Later, check completion record:
 * const completion = await client.query(
 *   api.testMutations.getWorkflowCompletion,
 *   { workflowId }
 * );
 * ```
 */
export const startVariableDurationWithOnComplete = mutation({
  args: {
    durations: v.array(v.number()),
    testRunId: v.optional(v.string()),
  },
  returns: v.string(),
  handler: async (ctx, args): Promise<string> => {
    const id: WorkflowId = await workflow.start(
      ctx,
      internal.testWorkflows.variableDurationWorkflow,
      { durations: args.durations },
      {
        // onComplete callback - called automatically when workflow finishes
        onComplete: internal.testMutations.handleWorkflowComplete,
        // Custom context - passed through to onComplete handler
        context: {
          testRunId: args.testRunId ?? `auto-${Date.now()}`,
          startedAt: Date.now(),
          description: "Variable duration workflow with onComplete pattern",
        },
      }
    );
    console.log(`[startVariableDurationWithOnComplete] started workflow ${id} with onComplete`);
    return id;
  },
});

// ============================================================================
// Event-Based Workflow Pattern Example (cvx-5i6y)
// Demonstrates awaitEvent/sendEvent for human-in-the-loop or external signals
// ============================================================================

/**
 * Event-Based Workflow
 *
 * Demonstrates the event coordination pattern from official workflow examples:
 * - Workflow pauses at `step.waitForEvent()` until event is received
 * - External code calls `workflow.sendEvent()` to resume the workflow
 * - Useful for human-in-the-loop, approval workflows, or external integrations
 *
 * Related bead: cvx-5i6y
 */
export const eventBasedWorkflow = workflow.define({
  args: {
    initialValue: v.number(),
  },
  returns: v.object({
    initialValue: v.number(),
    approvalReceived: v.boolean(),
    approvalValue: v.optional(v.any()),
    finalValue: v.number(),
    waitDurationMs: v.number(),
  }),
  handler: async (step, args) => {
    console.log(`[eventBasedWorkflow] starting with initialValue=${args.initialValue}`);

    // Do some initial work
    const doubled = args.initialValue * 2;
    console.log(`[eventBasedWorkflow] doubled value to ${doubled}`);

    // Wait for external approval event
    // This pauses the workflow until workflow.sendEvent() is called
    const waitStart = Date.now();
    console.log(`[eventBasedWorkflow] waiting for 'userApproval' event...`);

    const approvalEvent = await step.waitForEvent("userApproval", {
      // Timeout after 60 seconds (optional)
      timeoutMs: 60000,
    });

    const waitEnd = Date.now();
    const waitDurationMs = waitEnd - waitStart;

    console.log(`[eventBasedWorkflow] received approval event after ${waitDurationMs}ms`);
    console.log(`[eventBasedWorkflow] approval value: ${JSON.stringify(approvalEvent)}`);

    // Continue with result based on approval
    const finalValue = approvalEvent?.approved ? doubled : args.initialValue;

    return {
      initialValue: args.initialValue,
      approvalReceived: !!approvalEvent,
      approvalValue: approvalEvent,
      finalValue,
      waitDurationMs,
    };
  },
});

/**
 * Starts an event-based workflow.
 *
 * After starting, the workflow will pause waiting for the 'userApproval' event.
 * Use `sendApprovalEvent` to resume it.
 *
 * Related bead: cvx-5i6y
 */
export const startEventBasedWorkflow = mutation({
  args: {
    initialValue: v.number(),
  },
  returns: v.string(),
  handler: async (ctx, args): Promise<string> => {
    const id: WorkflowId = await workflow.start(
      ctx,
      internal.testWorkflows.eventBasedWorkflow,
      args
    );
    console.log(`[startEventBasedWorkflow] started workflow ${id}, waiting for userApproval event`);
    return id;
  },
});

/**
 * Sends an approval event to a waiting workflow.
 *
 * This resumes a workflow that's paused at `step.waitForEvent("userApproval")`.
 *
 * Related bead: cvx-5i6y
 *
 * @example
 * ```typescript
 * // Start workflow (will pause waiting for approval)
 * const workflowId = await client.mutation(
 *   api.testWorkflows.startEventBasedWorkflow,
 *   { initialValue: 10 }
 * );
 *
 * // Later, send approval to resume
 * await client.mutation(
 *   api.testWorkflows.sendApprovalEvent,
 *   { workflowId, approved: true }
 * );
 *
 * // Check result
 * const status = await client.query(
 *   api.testWorkflows.getWorkflowStatus,
 *   { workflowId }
 * );
 * ```
 */
export const sendApprovalEvent = mutation({
  args: {
    workflowId: v.string(),
    approved: v.boolean(),
    reason: v.optional(v.string()),
  },
  returns: v.null(),
  handler: async (ctx, args): Promise<null> => {
    await workflow.sendEvent(ctx, args.workflowId as WorkflowId, {
      name: "userApproval",
      value: {
        approved: args.approved,
        reason: args.reason,
        approvedAt: Date.now(),
      },
    });
    console.log(
      `[sendApprovalEvent] sent userApproval event to ${args.workflowId}: approved=${args.approved}`
    );
    return null;
  },
});
