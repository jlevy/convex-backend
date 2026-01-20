/**
 * Test actions for workflow performance testing.
 *
 * These actions are designed to simulate various workloads
 * to measure workflow overhead characteristics.
 */

import { v } from "convex/values";
import { internalAction } from "./_generated/server";

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
