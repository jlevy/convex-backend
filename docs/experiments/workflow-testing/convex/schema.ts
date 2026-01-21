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

  /**
   * Detailed timing events for fully-instrumented workflow analysis.
   *
   * Each event captures a specific timing point with high precision
   * to enable full accountability of workflow execution time.
   *
   * Event types:
   * - handler_start: Workflow handler begins executing
   * - handler_end: Workflow handler completes (before suspension)
   * - pre_step: Just before calling step.runAction/runQuery/runMutation
   * - post_step: Just after step.run* returns
   * - action_start: Action begins executing (logged from action)
   * - action_end: Action completes (logged from action)
   * - journal_replay_start: Before replaying completed steps
   * - journal_replay_end: After replaying completed steps
   *
   * Related beads: cvx-r7di, cvx-c6rk, cvx-yoap, cvx-md6f
   */
  timingEvents: defineTable({
    workflowId: v.string(),
    invocationNumber: v.number(),  // Which handler invocation (increments each replay)
    stepIndex: v.optional(v.number()),  // Which step (0-indexed)
    eventType: v.string(),
    timestamp: v.number(),
    metadata: v.optional(v.any()),  // Additional context (e.g., step name, args size)
  })
    .index("by_workflow", ["workflowId"])
    .index("by_workflow_invocation", ["workflowId", "invocationNumber"]),

  /**
   * Aggregated timing analysis results for a workflow run.
   *
   * Computed after workflow completes by analyzing timingEvents.
   */
  timingAnalysis: defineTable({
    workflowId: v.string(),
    totalDurationMs: v.number(),
    totalInvocations: v.number(),
    totalSteps: v.number(),
    breakdown: v.object({
      actionExecutionMs: v.number(),      // Time actions actually ran
      stepCallOverheadMs: v.number(),     // Time between pre_step and action_start
      stepReturnOverheadMs: v.number(),   // Time between action_end and post_step
      interStepOverheadMs: v.number(),    // Time between post_step and next pre_step
      handlerSetupMs: v.number(),         // Time from handler_start to first pre_step
      interInvocationMs: v.number(),      // Time between handler_end and next handler_start
      journalReplayMs: v.number(),        // Time in journal replay (if measurable)
    }),
    accountabilityPct: v.number(),
    perStepDetails: v.array(v.object({
      stepIndex: v.number(),
      actionDurationMs: v.number(),
      stepCallOverheadMs: v.number(),
      stepReturnOverheadMs: v.number(),
    })),
    completedAt: v.number(),
  }).index("by_workflow", ["workflowId"]),
});
