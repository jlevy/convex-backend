import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

/**
 * Schema for workflow testing harness.
 *
 * Stores test runs and their associated measurements for statistical analysis.
 */
export default defineSchema({
  /**
   * Records of test execution runs.
   */
  testRuns: defineTable({
    testName: v.string(),
    startTime: v.number(),
    endTime: v.optional(v.number()),
    config: v.any(),
    status: v.union(v.literal("running"), v.literal("completed"), v.literal("failed")),
    error: v.optional(v.string()),
  }).index("by_status", ["status"]),

  /**
   * Individual timing measurements collected during test runs.
   */
  measurements: defineTable({
    testRunId: v.id("testRuns"),
    metricName: v.string(),
    value: v.number(),
    unit: v.union(v.literal("ms"), v.literal("bytes"), v.literal("count")),
    metadata: v.optional(v.any()),
    timestamp: v.number(),
  })
    .index("by_test_run", ["testRunId"])
    .index("by_metric", ["metricName"]),

  /**
   * Simple counter for journal scaling tests.
   */
  testCounters: defineTable({
    workflowId: v.string(),
    step: v.number(),
    value: v.number(),
    createdAt: v.number(),
  }).index("by_workflow", ["workflowId"]),
});
