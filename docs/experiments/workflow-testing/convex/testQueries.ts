/**
 * Test queries for workflow performance testing.
 *
 * These queries are used with step.runQuery() to test
 * payload overhead and query execution patterns.
 */

import { v } from "convex/values";
import { internalQuery, query } from "./_generated/server";

/**
 * Generates a payload of specified size via a query.
 * Used to test step.runQuery() overhead with varying payload sizes.
 */
export const generatePayload = internalQuery({
  args: {
    sizeBytes: v.number(),
  },
  returns: v.string(),
  handler: async (_ctx, { sizeBytes }) => {
    // Generate a string of approximately the requested size
    const payload = "x".repeat(sizeBytes);
    console.log(`[generatePayload query] generated ${sizeBytes} bytes`);
    return payload;
  },
});

/**
 * Returns the current server timestamp.
 * Used for basic latency measurements.
 */
export const getTimestamp = internalQuery({
  args: {},
  returns: v.number(),
  handler: async () => {
    return Date.now();
  },
});

/**
 * Fetches test run data (public for reporting).
 */
export const getTestRun = query({
  args: {
    testRunId: v.id("testRuns"),
  },
  handler: async (ctx, { testRunId }) => {
    return await ctx.db.get(testRunId);
  },
});

/**
 * Fetches all measurements for a test run (public for reporting).
 */
export const getMeasurements = query({
  args: {
    testRunId: v.id("testRuns"),
  },
  handler: async (ctx, { testRunId }) => {
    return await ctx.db
      .query("measurements")
      .withIndex("by_test_run", (q) => q.eq("testRunId", testRunId))
      .collect();
  },
});

/**
 * Fetches all test runs, optionally filtered by status (public for reporting).
 */
export const listTestRuns = query({
  args: {
    status: v.optional(v.union(v.literal("running"), v.literal("completed"), v.literal("failed"))),
  },
  handler: async (ctx, { status }) => {
    if (status) {
      return await ctx.db
        .query("testRuns")
        .withIndex("by_status", (q) => q.eq("status", status))
        .collect();
    }
    return await ctx.db.query("testRuns").collect();
  },
});
