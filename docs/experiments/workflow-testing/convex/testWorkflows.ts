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
