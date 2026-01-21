/**
 * Test actions for workflow performance testing.
 *
 * These actions are designed to simulate various workloads
 * to measure workflow overhead characteristics.
 */

import { v } from "convex/values";
import { internalAction } from "./_generated/server";
import { internal } from "./_generated/api";

/**
 * Sleeps for a specified duration.
 * Used to test scheduler wake-up behavior after long-running steps.
 */
export const sleepAction = internalAction({
  args: {
    durationMs: v.number(),
  },
  returns: v.object({
    requestedDurationMs: v.number(),
    actualDurationMs: v.number(),
    startTime: v.number(),
    endTime: v.number(),
  }),
  handler: async (_ctx, { durationMs }) => {
    const startTime = Date.now();

    // Sleep for the specified duration
    await new Promise((resolve) => setTimeout(resolve, durationMs));

    const endTime = Date.now();
    const actualDurationMs = endTime - startTime;

    console.log(
      `[sleepAction] slept for ${actualDurationMs}ms (requested: ${durationMs}ms)`
    );

    return {
      requestedDurationMs: durationMs,
      actualDurationMs,
      startTime,
      endTime,
    };
  },
});

/**
 * Generates a payload of specified size.
 * Used to test overhead from large payloads through workpool.
 */
export const generatePayload = internalAction({
  args: {
    sizeBytes: v.number(),
  },
  returns: v.object({
    payload: v.string(),
    requestedBytes: v.number(),
    actualBytes: v.number(),
    generationTimeMs: v.number(),
  }),
  handler: async (_ctx, { sizeBytes }) => {
    const startTime = Date.now();

    // Generate a string of approximately the requested size
    // Each character in base64 is 1 byte in UTF-8
    const payload = "x".repeat(sizeBytes);

    const endTime = Date.now();
    const generationTimeMs = endTime - startTime;

    console.log(
      `[generatePayload] generated ${sizeBytes} bytes in ${generationTimeMs}ms`
    );

    return {
      payload,
      requestedBytes: sizeBytes,
      actualBytes: payload.length,
      generationTimeMs,
    };
  },
});

/**
 * A no-op action that completes immediately.
 * Used as a baseline for measuring minimum overhead.
 */
export const noopAction = internalAction({
  args: {},
  returns: v.object({
    timestamp: v.number(),
  }),
  handler: async () => {
    const timestamp = Date.now();
    console.log(`[noopAction] executed at ${timestamp}`);
    return { timestamp };
  },
});

/**
 * Simulates the llm_filtered_web_search pattern from the external engineer's analysis.
 *
 * This action simulates:
 * 1. An initial API call (like web search)
 * 2. Multiple "LLM filtering" passes (simulating processing)
 * 3. Returns a large payload
 *
 * The external engineer observed ~6s inter-iteration gaps after this type of tool,
 * possibly due to DB subscription wake-up failures.
 *
 * Related beads: cvx-pznt, cvx-v6tf
 */
export const simulateLlmFilteredWebSearch = internalAction({
  args: {
    searchDurationMs: v.optional(v.number()),     // Simulated API call duration
    filterPassesCount: v.optional(v.number()),    // Number of "LLM" filtering passes
    filterPassDurationMs: v.optional(v.number()), // Duration per filter pass
    resultSizeKb: v.optional(v.number()),         // Size of result payload in KB
  },
  returns: v.object({
    searchResults: v.string(),
    timing: v.object({
      totalMs: v.number(),
      searchMs: v.number(),
      filterMs: v.number(),
      filterPasses: v.number(),
      resultSizeBytes: v.number(),
    }),
    timestamps: v.object({
      start: v.number(),
      afterSearch: v.number(),
      afterFilter: v.number(),
      end: v.number(),
    }),
  }),
  handler: async (_ctx, args) => {
    const searchDurationMs = args.searchDurationMs ?? 2000;
    const filterPassesCount = args.filterPassesCount ?? 3;
    const filterPassDurationMs = args.filterPassDurationMs ?? 500;
    const resultSizeKb = args.resultSizeKb ?? 50;

    const timestamps = {
      start: Date.now(),
      afterSearch: 0,
      afterFilter: 0,
      end: 0,
    };

    console.log(
      `[simulateLlmFilteredWebSearch] starting: search=${searchDurationMs}ms, ` +
      `filters=${filterPassesCount}x${filterPassDurationMs}ms, result=${resultSizeKb}KB`
    );

    // Phase 1: Simulate web search API call
    await new Promise((resolve) => setTimeout(resolve, searchDurationMs));
    timestamps.afterSearch = Date.now();
    const searchMs = timestamps.afterSearch - timestamps.start;
    console.log(`[simulateLlmFilteredWebSearch] search phase complete: ${searchMs}ms`);

    // Phase 2: Simulate multiple LLM filtering passes
    for (let i = 0; i < filterPassesCount; i++) {
      await new Promise((resolve) => setTimeout(resolve, filterPassDurationMs));
      console.log(`[simulateLlmFilteredWebSearch] filter pass ${i + 1}/${filterPassesCount} complete`);
    }
    timestamps.afterFilter = Date.now();
    const filterMs = timestamps.afterFilter - timestamps.afterSearch;
    console.log(`[simulateLlmFilteredWebSearch] filter phase complete: ${filterMs}ms`);

    // Phase 3: Generate large result payload
    const resultSizeBytes = resultSizeKb * 1024;
    const searchResults = "R".repeat(resultSizeBytes);

    timestamps.end = Date.now();
    const totalMs = timestamps.end - timestamps.start;

    console.log(
      `[simulateLlmFilteredWebSearch] complete: total=${totalMs}ms, ` +
      `result=${resultSizeBytes} bytes`
    );

    return {
      searchResults,
      timing: {
        totalMs,
        searchMs,
        filterMs,
        filterPasses: filterPassesCount,
        resultSizeBytes,
      },
      timestamps,
    };
  },
});

/**
 * Simulates a simple, fast tool for comparison.
 * Like stock_prices_historical which showed ~1.1s gaps.
 *
 * Related bead: cvx-pznt (for comparison)
 */
export const simulateSimpleTool = internalAction({
  args: {
    durationMs: v.optional(v.number()),
    resultSizeKb: v.optional(v.number()),
  },
  returns: v.object({
    result: v.string(),
    timing: v.object({
      totalMs: v.number(),
      resultSizeBytes: v.number(),
    }),
    timestamps: v.object({
      start: v.number(),
      end: v.number(),
    }),
  }),
  handler: async (_ctx, args) => {
    const durationMs = args.durationMs ?? 100;
    const resultSizeKb = args.resultSizeKb ?? 5;

    const start = Date.now();

    await new Promise((resolve) => setTimeout(resolve, durationMs));

    const resultSizeBytes = resultSizeKb * 1024;
    const result = "S".repeat(resultSizeBytes);

    const end = Date.now();
    const totalMs = end - start;

    console.log(`[simulateSimpleTool] complete: ${totalMs}ms, ${resultSizeBytes} bytes`);

    return {
      result,
      timing: {
        totalMs,
        resultSizeBytes,
      },
      timestamps: {
        start,
        end,
      },
    };
  },
});

// ============================================================================
// Instrumented Actions for Full Timing Analysis
// Related beads: cvx-r7di, cvx-c6rk, cvx-yoap, cvx-md6f
// ============================================================================

/**
 * An instrumented action that logs precise timing events.
 *
 * This action:
 * 1. Logs action_start event to database
 * 2. Performs work (sleep for specified duration)
 * 3. Logs action_end event to database
 * 4. Returns timestamps for verification
 *
 * The timestamps are captured at the action level (inside the action),
 * which allows us to measure workpool overhead by comparing:
 * - pre_step timestamp (in handler, before step.runAction)
 * - action_start timestamp (in action, first thing)
 * - action_end timestamp (in action, last thing)
 * - post_step timestamp (in handler, after step.runAction returns)
 */
export const instrumentedAction = internalAction({
  args: {
    workflowId: v.string(),
    invocationNumber: v.number(),
    stepIndex: v.number(),
    durationMs: v.number(),
    payloadSizeKb: v.optional(v.number()),
  },
  returns: v.object({
    actionStartTs: v.number(),
    actionEndTs: v.number(),
    actualDurationMs: v.number(),
    resultSizeBytes: v.number(),
  }),
  handler: async (ctx, args) => {
    const actionStartTs = Date.now();

    // Log action_start event
    await ctx.runMutation(internal.testMutations.logTimingEvent, {
      workflowId: args.workflowId,
      invocationNumber: args.invocationNumber,
      stepIndex: args.stepIndex,
      eventType: "action_start",
      timestamp: actionStartTs,
      metadata: { durationMs: args.durationMs, payloadSizeKb: args.payloadSizeKb ?? 0 },
    });

    // Perform work
    await new Promise((resolve) => setTimeout(resolve, args.durationMs));

    // Generate result payload if requested
    const payloadSizeKb = args.payloadSizeKb ?? 1;
    const resultSizeBytes = payloadSizeKb * 1024;
    const _payload = "X".repeat(resultSizeBytes);

    const actionEndTs = Date.now();

    // Log action_end event
    await ctx.runMutation(internal.testMutations.logTimingEvent, {
      workflowId: args.workflowId,
      invocationNumber: args.invocationNumber,
      stepIndex: args.stepIndex,
      eventType: "action_end",
      timestamp: actionEndTs,
      metadata: { actualDurationMs: actionEndTs - actionStartTs, resultSizeBytes },
    });

    return {
      actionStartTs,
      actionEndTs,
      actualDurationMs: actionEndTs - actionStartTs,
      resultSizeBytes,
    };
  },
});
