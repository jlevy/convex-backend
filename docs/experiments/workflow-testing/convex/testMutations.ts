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

/**
 * Clears all test data (for cleanup between test runs).
 */
export const clearTestData = mutation({
  args: {},
  returns: v.object({
    testRuns: v.number(),
    measurements: v.number(),
    counters: v.number(),
  }),
  handler: async (ctx) => {
    let testRuns = 0;
    let measurements = 0;
    let counters = 0;

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

    console.log(`[clearTestData] deleted ${testRuns} test runs, ${measurements} measurements, ${counters} counters`);
    return { testRuns, measurements, counters };
  },
});
