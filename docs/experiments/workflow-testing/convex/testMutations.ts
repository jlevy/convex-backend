/**
 * Test mutations for workflow performance testing.
 *
 * These mutations handle test run management and
 * measurement recording.
 */

import { v } from "convex/values";
import { internalMutation, mutation } from "./_generated/server";

/**
 * Creates a new test run record.
 */
export const createTestRun = mutation({
  args: {
    testName: v.string(),
    config: v.any(),
  },
  returns: v.id("testRuns"),
  handler: async (ctx, { testName, config }) => {
    const testRunId = await ctx.db.insert("testRuns", {
      testName,
      startTime: Date.now(),
      config,
      status: "running",
    });
    console.log(`[createTestRun] created test run ${testRunId} for ${testName}`);
    return testRunId;
  },
});

/**
 * Marks a test run as completed.
 */
export const completeTestRun = mutation({
  args: {
    testRunId: v.id("testRuns"),
    error: v.optional(v.string()),
  },
  returns: v.null(),
  handler: async (ctx, { testRunId, error }) => {
    await ctx.db.patch(testRunId, {
      endTime: Date.now(),
      status: error ? "failed" : "completed",
      error,
    });
    console.log(`[completeTestRun] completed test run ${testRunId}${error ? ` with error: ${error}` : ""}`);
    return null;
  },
});

/**
 * Records a measurement for a test run.
 */
export const recordMeasurement = mutation({
  args: {
    testRunId: v.id("testRuns"),
    metricName: v.string(),
    value: v.number(),
    unit: v.union(v.literal("ms"), v.literal("bytes"), v.literal("count")),
    metadata: v.optional(v.any()),
  },
  returns: v.id("measurements"),
  handler: async (ctx, { testRunId, metricName, value, unit, metadata }) => {
    const measurementId = await ctx.db.insert("measurements", {
      testRunId,
      metricName,
      value,
      unit,
      metadata,
      timestamp: Date.now(),
    });
    return measurementId;
  },
});

/**
 * Records multiple measurements in a single transaction.
 */
export const recordMeasurements = mutation({
  args: {
    testRunId: v.id("testRuns"),
    measurements: v.array(
      v.object({
        metricName: v.string(),
        value: v.number(),
        unit: v.union(v.literal("ms"), v.literal("bytes"), v.literal("count")),
        metadata: v.optional(v.any()),
      })
    ),
  },
  returns: v.array(v.id("measurements")),
  handler: async (ctx, { testRunId, measurements }) => {
    const timestamp = Date.now();
    const ids = [];
    for (const m of measurements) {
      const id = await ctx.db.insert("measurements", {
        testRunId,
        metricName: m.metricName,
        value: m.value,
        unit: m.unit,
        metadata: m.metadata,
        timestamp,
      });
      ids.push(id);
    }
    console.log(`[recordMeasurements] recorded ${ids.length} measurements`);
    return ids;
  },
});

/**
 * Increments a counter for journal scaling tests.
 * Used within workflows to add entries to the journal.
 */
export const incrementCounter = internalMutation({
  args: {
    workflowId: v.string(),
    step: v.number(),
  },
  returns: v.object({
    step: v.number(),
    value: v.number(),
    timestamp: v.number(),
  }),
  handler: async (ctx, { workflowId, step }) => {
    const timestamp = Date.now();

    // Get existing counter or start at 0
    const existing = await ctx.db
      .query("testCounters")
      .withIndex("by_workflow", (q) => q.eq("workflowId", workflowId))
      .order("desc")
      .first();

    const value = (existing?.value ?? 0) + 1;

    await ctx.db.insert("testCounters", {
      workflowId,
      step,
      value,
      createdAt: timestamp,
    });

    console.log(`[incrementCounter] workflow=${workflowId} step=${step} value=${value}`);

    return { step, value, timestamp };
  },
});

// ============================================================================
// Timing Event Logging for Full Instrumentation
// Related beads: cvx-r7di, cvx-c6rk, cvx-yoap, cvx-md6f
// ============================================================================

/**
 * Logs a timing event for the fully-instrumented workflow.
 *
 * Events are stored in timingEvents table and later analyzed
 * to compute full time breakdown.
 */
export const logTimingEvent = internalMutation({
  args: {
    workflowId: v.string(),
    invocationNumber: v.number(),
    stepIndex: v.optional(v.number()),
    eventType: v.string(),
    timestamp: v.number(),
    metadata: v.optional(v.any()),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    await ctx.db.insert("timingEvents", {
      workflowId: args.workflowId,
      invocationNumber: args.invocationNumber,
      stepIndex: args.stepIndex,
      eventType: args.eventType,
      timestamp: args.timestamp,
      metadata: args.metadata,
    });
    return null;
  },
});

/**
 * Logs multiple timing events in a single transaction.
 * More efficient for batching events at end of handler.
 */
export const logTimingEventsBatch = internalMutation({
  args: {
    events: v.array(
      v.object({
        workflowId: v.string(),
        invocationNumber: v.number(),
        stepIndex: v.optional(v.number()),
        eventType: v.string(),
        timestamp: v.number(),
        metadata: v.optional(v.any()),
      })
    ),
  },
  returns: v.number(),
  handler: async (ctx, { events }) => {
    for (const event of events) {
      await ctx.db.insert("timingEvents", event);
    }
    return events.length;
  },
});

/**
 * Retrieves all timing events for a workflow.
 */
export const getTimingEvents = internalMutation({
  args: {
    workflowId: v.string(),
  },
  returns: v.array(
    v.object({
      _id: v.id("timingEvents"),
      _creationTime: v.number(),
      workflowId: v.string(),
      invocationNumber: v.number(),
      stepIndex: v.optional(v.number()),
      eventType: v.string(),
      timestamp: v.number(),
      metadata: v.optional(v.any()),
    })
  ),
  handler: async (ctx, { workflowId }) => {
    return await ctx.db
      .query("timingEvents")
      .withIndex("by_workflow", (q) => q.eq("workflowId", workflowId))
      .collect();
  },
});

/**
 * Analyzes timing events and stores the breakdown.
 *
 * Computes:
 * - actionExecutionMs: Sum of (action_end - action_start)
 * - stepCallOverheadMs: Sum of (action_start - pre_step)
 * - stepReturnOverheadMs: Sum of (post_step - action_end)
 * - interStepOverheadMs: Sum of (pre_step[n+1] - post_step[n])
 * - handlerSetupMs: Sum of (first_pre_step - handler_start) per invocation
 * - interInvocationMs: Sum of (handler_start[n+1] - handler_end[n])
 */
export const analyzeTimingEvents = internalMutation({
  args: {
    workflowId: v.string(),
  },
  returns: v.id("timingAnalysis"),
  handler: async (ctx, { workflowId }) => {
    const events = await ctx.db
      .query("timingEvents")
      .withIndex("by_workflow", (q) => q.eq("workflowId", workflowId))
      .collect();

    if (events.length === 0) {
      throw new Error(`No timing events found for workflow ${workflowId}`);
    }

    // Sort by timestamp
    events.sort((a, b) => a.timestamp - b.timestamp);

    // Group by step for per-step analysis
    const stepEvents = new Map<number, typeof events>();
    const handlerEvents: typeof events = [];

    for (const event of events) {
      if (event.stepIndex !== undefined) {
        if (!stepEvents.has(event.stepIndex)) {
          stepEvents.set(event.stepIndex, []);
        }
        stepEvents.get(event.stepIndex)!.push(event);
      }
      if (event.eventType === "handler_start" || event.eventType === "handler_end") {
        handlerEvents.push(event);
      }
    }

    // Calculate breakdown
    let actionExecutionMs = 0;
    let stepCallOverheadMs = 0;
    let stepReturnOverheadMs = 0;
    let interStepOverheadMs = 0;
    let handlerSetupMs = 0;
    let interInvocationMs = 0;

    const perStepDetails: Array<{
      stepIndex: number;
      actionDurationMs: number;
      stepCallOverheadMs: number;
      stepReturnOverheadMs: number;
    }> = [];

    // Process each step
    for (const [stepIndex, stepEvts] of stepEvents) {
      const preStep = stepEvts.find((e) => e.eventType === "pre_step");
      const postStep = stepEvts.find((e) => e.eventType === "post_step");
      const actionStart = stepEvts.find((e) => e.eventType === "action_start");
      const actionEnd = stepEvts.find((e) => e.eventType === "action_end");

      const detail: typeof perStepDetails[0] = {
        stepIndex,
        actionDurationMs: 0,
        stepCallOverheadMs: 0,
        stepReturnOverheadMs: 0,
      };

      if (actionStart && actionEnd) {
        detail.actionDurationMs = actionEnd.timestamp - actionStart.timestamp;
        actionExecutionMs += detail.actionDurationMs;
      }

      if (preStep && actionStart) {
        detail.stepCallOverheadMs = actionStart.timestamp - preStep.timestamp;
        stepCallOverheadMs += detail.stepCallOverheadMs;
      }

      if (actionEnd && postStep) {
        detail.stepReturnOverheadMs = postStep.timestamp - actionEnd.timestamp;
        stepReturnOverheadMs += detail.stepReturnOverheadMs;
      }

      perStepDetails.push(detail);
    }

    // Calculate inter-step overhead
    const sortedStepIndices = Array.from(stepEvents.keys()).sort((a, b) => a - b);
    for (let i = 0; i < sortedStepIndices.length - 1; i++) {
      const currStep = stepEvents.get(sortedStepIndices[i])!;
      const nextStep = stepEvents.get(sortedStepIndices[i + 1])!;
      const currPostStep = currStep.find((e) => e.eventType === "post_step");
      const nextPreStep = nextStep.find((e) => e.eventType === "pre_step");

      if (currPostStep && nextPreStep) {
        interStepOverheadMs += nextPreStep.timestamp - currPostStep.timestamp;
      }
    }

    // Calculate handler setup and inter-invocation time
    const handlerStarts = handlerEvents.filter((e) => e.eventType === "handler_start").sort((a, b) => a.timestamp - b.timestamp);
    const handlerEnds = handlerEvents.filter((e) => e.eventType === "handler_end").sort((a, b) => a.timestamp - b.timestamp);

    // Handler setup: time from handler_start to first pre_step in each invocation
    for (const start of handlerStarts) {
      const firstPreStep = events.find(
        (e) => e.eventType === "pre_step" && e.invocationNumber === start.invocationNumber
      );
      if (firstPreStep) {
        handlerSetupMs += firstPreStep.timestamp - start.timestamp;
      }
    }

    // Inter-invocation: time from handler_end to next handler_start
    for (let i = 0; i < handlerEnds.length - 1; i++) {
      const nextStart = handlerStarts.find((s) => s.timestamp > handlerEnds[i].timestamp);
      if (nextStart) {
        interInvocationMs += nextStart.timestamp - handlerEnds[i].timestamp;
      }
    }

    // Calculate totals
    const firstEvent = events[0];
    const lastEvent = events[events.length - 1];
    const totalDurationMs = lastEvent.timestamp - firstEvent.timestamp;

    const totalMeasured =
      actionExecutionMs +
      stepCallOverheadMs +
      stepReturnOverheadMs +
      interStepOverheadMs +
      handlerSetupMs +
      interInvocationMs;

    const accountabilityPct = totalDurationMs > 0 ? (totalMeasured / totalDurationMs) * 100 : 0;

    const analysisId = await ctx.db.insert("timingAnalysis", {
      workflowId,
      totalDurationMs,
      totalInvocations: handlerStarts.length,
      totalSteps: stepEvents.size,
      breakdown: {
        actionExecutionMs,
        stepCallOverheadMs,
        stepReturnOverheadMs,
        interStepOverheadMs,
        handlerSetupMs,
        interInvocationMs,
        journalReplayMs: 0, // Cannot directly measure this
      },
      accountabilityPct,
      perStepDetails,
      completedAt: Date.now(),
    });

    console.log(
      `[analyzeTimingEvents] workflow=${workflowId} ` +
      `total=${totalDurationMs}ms accountability=${accountabilityPct.toFixed(1)}% ` +
      `action=${actionExecutionMs}ms callOH=${stepCallOverheadMs}ms returnOH=${stepReturnOverheadMs}ms ` +
      `interStep=${interStepOverheadMs}ms setup=${handlerSetupMs}ms interInvoc=${interInvocationMs}ms`
    );

    return analysisId;
  },
});

/**
 * Public mutation to analyze timing events for a workflow.
 * Wraps the internal analyzeTimingEvents for test access.
 */
export const analyzeInstrumentedWorkflow = mutation({
  args: {
    workflowId: v.string(),
  },
  returns: v.object({
    analysisId: v.id("timingAnalysis"),
    summary: v.object({
      totalDurationMs: v.number(),
      totalInvocations: v.number(),
      totalSteps: v.number(),
      accountabilityPct: v.number(),
      breakdown: v.object({
        actionExecutionMs: v.number(),
        stepCallOverheadMs: v.number(),
        stepReturnOverheadMs: v.number(),
        interStepOverheadMs: v.number(),
        handlerSetupMs: v.number(),
        interInvocationMs: v.number(),
        journalReplayMs: v.number(),
      }),
    }),
  }),
  handler: async (ctx, { workflowId }) => {
    // First, get the events
    const events = await ctx.db
      .query("timingEvents")
      .withIndex("by_workflow", (q) => q.eq("workflowId", workflowId))
      .collect();

    if (events.length === 0) {
      throw new Error(`No timing events found for workflow ${workflowId}`);
    }

    // Sort by timestamp
    events.sort((a, b) => a.timestamp - b.timestamp);

    // Group by step for per-step analysis
    const stepEvents = new Map<number, typeof events>();
    const handlerEvents: typeof events = [];

    for (const event of events) {
      if (event.stepIndex !== undefined) {
        if (!stepEvents.has(event.stepIndex)) {
          stepEvents.set(event.stepIndex, []);
        }
        stepEvents.get(event.stepIndex)!.push(event);
      }
      if (event.eventType === "handler_start" || event.eventType === "handler_end") {
        handlerEvents.push(event);
      }
    }

    // Calculate breakdown
    let actionExecutionMs = 0;
    let stepCallOverheadMs = 0;
    let stepReturnOverheadMs = 0;
    let interStepOverheadMs = 0;
    let handlerSetupMs = 0;
    let interInvocationMs = 0;

    const perStepDetails: Array<{
      stepIndex: number;
      actionDurationMs: number;
      stepCallOverheadMs: number;
      stepReturnOverheadMs: number;
    }> = [];

    // Process each step
    for (const [stepIndex, stepEvts] of stepEvents) {
      const preStep = stepEvts.find((e) => e.eventType === "pre_step");
      const postStep = stepEvts.find((e) => e.eventType === "post_step");
      const actionStart = stepEvts.find((e) => e.eventType === "action_start");
      const actionEnd = stepEvts.find((e) => e.eventType === "action_end");

      const detail = {
        stepIndex,
        actionDurationMs: 0,
        stepCallOverheadMs: 0,
        stepReturnOverheadMs: 0,
      };

      if (actionStart && actionEnd) {
        detail.actionDurationMs = actionEnd.timestamp - actionStart.timestamp;
        actionExecutionMs += detail.actionDurationMs;
      }

      if (preStep && actionStart) {
        detail.stepCallOverheadMs = actionStart.timestamp - preStep.timestamp;
        stepCallOverheadMs += detail.stepCallOverheadMs;
      }

      if (actionEnd && postStep) {
        detail.stepReturnOverheadMs = postStep.timestamp - actionEnd.timestamp;
        stepReturnOverheadMs += detail.stepReturnOverheadMs;
      }

      perStepDetails.push(detail);
    }

    // Calculate inter-step overhead
    const sortedStepIndices = Array.from(stepEvents.keys()).sort((a, b) => a - b);
    for (let i = 0; i < sortedStepIndices.length - 1; i++) {
      const currStep = stepEvents.get(sortedStepIndices[i])!;
      const nextStep = stepEvents.get(sortedStepIndices[i + 1])!;
      const currPostStep = currStep.find((e) => e.eventType === "post_step");
      const nextPreStep = nextStep.find((e) => e.eventType === "pre_step");

      if (currPostStep && nextPreStep) {
        interStepOverheadMs += nextPreStep.timestamp - currPostStep.timestamp;
      }
    }

    // Calculate handler setup and inter-invocation time
    const handlerStarts = handlerEvents.filter((e) => e.eventType === "handler_start").sort((a, b) => a.timestamp - b.timestamp);
    const handlerEnds = handlerEvents.filter((e) => e.eventType === "handler_end").sort((a, b) => a.timestamp - b.timestamp);

    // Handler setup: time from handler_start to first pre_step in each invocation
    for (const start of handlerStarts) {
      const firstPreStep = events.find(
        (e) => e.eventType === "pre_step" && e.invocationNumber === start.invocationNumber
      );
      if (firstPreStep) {
        handlerSetupMs += firstPreStep.timestamp - start.timestamp;
      }
    }

    // Inter-invocation: time from handler_end to next handler_start
    for (let i = 0; i < handlerEnds.length - 1; i++) {
      const nextStart = handlerStarts.find((s) => s.timestamp > handlerEnds[i].timestamp);
      if (nextStart) {
        interInvocationMs += nextStart.timestamp - handlerEnds[i].timestamp;
      }
    }

    // Calculate totals
    const firstEvent = events[0];
    const lastEvent = events[events.length - 1];
    const totalDurationMs = lastEvent.timestamp - firstEvent.timestamp;

    const totalMeasured =
      actionExecutionMs +
      stepCallOverheadMs +
      stepReturnOverheadMs +
      interStepOverheadMs +
      handlerSetupMs +
      interInvocationMs;

    const accountabilityPct = totalDurationMs > 0 ? (totalMeasured / totalDurationMs) * 100 : 0;

    const analysisId = await ctx.db.insert("timingAnalysis", {
      workflowId,
      totalDurationMs,
      totalInvocations: handlerStarts.length,
      totalSteps: stepEvents.size,
      breakdown: {
        actionExecutionMs,
        stepCallOverheadMs,
        stepReturnOverheadMs,
        interStepOverheadMs,
        handlerSetupMs,
        interInvocationMs,
        journalReplayMs: 0,
      },
      accountabilityPct,
      perStepDetails,
      completedAt: Date.now(),
    });

    console.log(
      `[analyzeInstrumentedWorkflow] workflow=${workflowId} ` +
      `total=${totalDurationMs}ms accountability=${accountabilityPct.toFixed(1)}% ` +
      `action=${actionExecutionMs}ms callOH=${stepCallOverheadMs}ms returnOH=${stepReturnOverheadMs}ms ` +
      `interStep=${interStepOverheadMs}ms setup=${handlerSetupMs}ms interInvoc=${interInvocationMs}ms`
    );

    return {
      analysisId,
      summary: {
        totalDurationMs,
        totalInvocations: handlerStarts.length,
        totalSteps: stepEvents.size,
        accountabilityPct,
        breakdown: {
          actionExecutionMs,
          stepCallOverheadMs,
          stepReturnOverheadMs,
          interStepOverheadMs,
          handlerSetupMs,
          interInvocationMs,
          journalReplayMs: 0,
        },
      },
    };
  },
});

/**
 * Clears all test data (for cleanup between test runs).
 */
export const clearTestData = mutation({
  args: {},
  returns: v.object({
    testRuns: v.number(),
    measurements: v.number(),
    counters: v.number(),
    timingEvents: v.number(),
    timingAnalysis: v.number(),
  }),
  handler: async (ctx) => {
    let testRuns = 0;
    let measurements = 0;
    let counters = 0;
    let timingEvents = 0;
    let timingAnalysis = 0;

    // Clear test runs
    const runs = await ctx.db.query("testRuns").collect();
    for (const run of runs) {
      await ctx.db.delete(run._id);
      testRuns++;
    }

    // Clear measurements
    const meas = await ctx.db.query("measurements").collect();
    for (const m of meas) {
      await ctx.db.delete(m._id);
      measurements++;
    }

    // Clear counters
    const ctrs = await ctx.db.query("testCounters").collect();
    for (const c of ctrs) {
      await ctx.db.delete(c._id);
      counters++;
    }

    // Clear timing events
    const events = await ctx.db.query("timingEvents").collect();
    for (const e of events) {
      await ctx.db.delete(e._id);
      timingEvents++;
    }

    // Clear timing analysis
    const analyses = await ctx.db.query("timingAnalysis").collect();
    for (const a of analyses) {
      await ctx.db.delete(a._id);
      timingAnalysis++;
    }

    console.log(
      `[clearTestData] deleted ${testRuns} test runs, ${measurements} measurements, ` +
      `${counters} counters, ${timingEvents} timing events, ${timingAnalysis} timing analyses`
    );
    return { testRuns, measurements, counters, timingEvents, timingAnalysis };
  },
});
