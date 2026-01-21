/**
 * Fully-Instrumented Workflow Tests
 *
 * These tests run the fully-instrumented workflow to achieve 100% accountability
 * of workflow execution time. The instrumentation captures timing at every point:
 *
 * - handler_start: When handler begins executing
 * - pre_step: Just before calling step.runAction
 * - action_start: Inside action, first thing
 * - action_end: Inside action, last thing
 * - post_step: Just after step.runAction returns
 * - handler_end: When handler completes
 *
 * The analysis computes:
 * - actionExecutionMs: Time actions actually ran (action_end - action_start)
 * - stepCallOverheadMs: Workpool enqueue + scheduling (pre_step → action_start)
 * - stepReturnOverheadMs: Workpool completion handling (action_end → post_step)
 * - interStepOverheadMs: Time between steps within handler (post_step → next pre_step)
 * - handlerSetupMs: Journal replay + context setup (handler_start → first pre_step)
 * - interInvocationMs: Scheduler wake-up delay (handler_end → next handler_start)
 *
 * Related beads: cvx-r7di, cvx-c6rk, cvx-yoap, cvx-md6f
 */

import { describe, it, expect, beforeAll, beforeEach } from "vitest";
import { ConvexHttpClient } from "convex/browser";
import { api } from "../convex/_generated/api";
import { sleep } from "./utils/timing";

const CONVEX_URL = process.env.CONVEX_URL || "http://127.0.0.1:3210";

interface TimingBreakdown {
  actionExecutionMs: number;
  stepCallOverheadMs: number;
  stepReturnOverheadMs: number;
  interStepOverheadMs: number;
  handlerSetupMs: number;
  interInvocationMs: number;
  journalReplayMs: number;
}

interface AnalysisResult {
  analysisId: string;
  summary: {
    totalDurationMs: number;
    totalInvocations: number;
    totalSteps: number;
    accountabilityPct: number;
    breakdown: TimingBreakdown;
  };
}

function formatBreakdown(breakdown: TimingBreakdown, totalMs: number): string {
  const lines = [
    `  Action Execution:    ${breakdown.actionExecutionMs.toFixed(0)}ms (${((breakdown.actionExecutionMs / totalMs) * 100).toFixed(1)}%)`,
    `  Step Call Overhead:  ${breakdown.stepCallOverheadMs.toFixed(0)}ms (${((breakdown.stepCallOverheadMs / totalMs) * 100).toFixed(1)}%)`,
    `  Step Return Overhead: ${breakdown.stepReturnOverheadMs.toFixed(0)}ms (${((breakdown.stepReturnOverheadMs / totalMs) * 100).toFixed(1)}%)`,
    `  Inter-Step Overhead: ${breakdown.interStepOverheadMs.toFixed(0)}ms (${((breakdown.interStepOverheadMs / totalMs) * 100).toFixed(1)}%)`,
    `  Handler Setup:       ${breakdown.handlerSetupMs.toFixed(0)}ms (${((breakdown.handlerSetupMs / totalMs) * 100).toFixed(1)}%)`,
    `  Inter-Invocation:    ${breakdown.interInvocationMs.toFixed(0)}ms (${((breakdown.interInvocationMs / totalMs) * 100).toFixed(1)}%)`,
  ];
  return lines.join("\n");
}

async function runInstrumentedWorkflow(
  client: ConvexHttpClient,
  config: {
    stepCount: number;
    stepDurationMs: number;
    stepPayloadSizeKb?: number;
  },
  timeoutMs = 300000
): Promise<{ result: any; analysis: AnalysisResult }> {
  // Start the workflow
  const { internalId, correlationId } = await client.mutation(
    api.testWorkflows.startFullyInstrumentedWorkflow,
    config
  );

  console.log(`[test] Started workflow: internal=${internalId}, correlation=${correlationId}`);

  // Wait for completion
  let result;
  const startTime = Date.now();
  while (Date.now() - startTime < timeoutMs) {
    const status = await client.query(api.testWorkflows.getWorkflowStatus, {
      workflowId: internalId,
    });

    if (status.type === "completed" && status.result) {
      result = status.result;
      break;
    }
    if (status.type === "failed") {
      throw new Error(`Workflow failed: ${JSON.stringify(status)}`);
    }

    await sleep(500);
  }

  if (!result) {
    throw new Error(`Workflow timed out after ${timeoutMs}ms`);
  }

  // Allow some time for final events to be logged
  await sleep(500);

  // Analyze timing events
  const analysis = await client.mutation(api.testMutations.analyzeInstrumentedWorkflow, {
    workflowId: correlationId,
  });

  return { result, analysis };
}

describe("fully-instrumented workflow", () => {
  let client: ConvexHttpClient;

  beforeAll(() => {
    client = new ConvexHttpClient(CONVEX_URL);
    console.log(`[test] Connected to Convex at ${CONVEX_URL}`);
  });

  beforeEach(async () => {
    // Clear previous test data
    const cleared = await client.mutation(api.testMutations.clearTestData, {});
    console.log(`[test] Cleared test data: ${JSON.stringify(cleared)}`);
  });

  it("should achieve near-100% accountability with 5 steps x 100ms", async () => {
    console.log("\n[test] Running 5 steps x 100ms instrumented workflow");

    const { result, analysis } = await runInstrumentedWorkflow(client, {
      stepCount: 5,
      stepDurationMs: 100,
    });

    expect(result).toBeDefined();
    expect(result.stepCount).toBe(5);

    const { summary } = analysis;

    console.log("\n[test] TIMING BREAKDOWN:");
    console.log(`  Total Duration: ${summary.totalDurationMs}ms`);
    console.log(`  Total Invocations: ${summary.totalInvocations}`);
    console.log(`  Total Steps: ${summary.totalSteps}`);
    console.log(`  Accountability: ${summary.accountabilityPct.toFixed(1)}%`);
    console.log("\n[test] Component Breakdown:");
    console.log(formatBreakdown(summary.breakdown, summary.totalDurationMs));

    // Calculate unaccounted time
    const totalMeasured =
      summary.breakdown.actionExecutionMs +
      summary.breakdown.stepCallOverheadMs +
      summary.breakdown.stepReturnOverheadMs +
      summary.breakdown.interStepOverheadMs +
      summary.breakdown.handlerSetupMs +
      summary.breakdown.interInvocationMs;

    const unaccountedMs = summary.totalDurationMs - totalMeasured;
    console.log(`\n[test] Unaccounted: ${unaccountedMs.toFixed(0)}ms (${((unaccountedMs / summary.totalDurationMs) * 100).toFixed(1)}%)`);

    // We expect high accountability with full instrumentation
    expect(summary.accountabilityPct).toBeGreaterThan(80);
  });

  it("should identify overhead sources with 10 steps x 50ms", async () => {
    console.log("\n[test] Running 10 steps x 50ms instrumented workflow");

    const { result, analysis } = await runInstrumentedWorkflow(client, {
      stepCount: 10,
      stepDurationMs: 50,
    });

    expect(result).toBeDefined();
    expect(result.stepCount).toBe(10);

    const { summary } = analysis;

    console.log("\n[test] TIMING BREAKDOWN:");
    console.log(`  Total Duration: ${summary.totalDurationMs}ms`);
    console.log(`  Total Invocations: ${summary.totalInvocations}`);
    console.log(`  Accountability: ${summary.accountabilityPct.toFixed(1)}%`);
    console.log("\n[test] Component Breakdown:");
    console.log(formatBreakdown(summary.breakdown, summary.totalDurationMs));

    // Expected: 10 * 50ms = 500ms of action time
    // Check that action time is roughly what we expect
    const expectedActionTimeMs = 10 * 50;
    const actionTimeRatio = summary.breakdown.actionExecutionMs / expectedActionTimeMs;
    console.log(`\n[test] Action time ratio: ${actionTimeRatio.toFixed(2)}x expected`);

    // Calculate overhead per step
    const overheadPerStep =
      (summary.breakdown.stepCallOverheadMs + summary.breakdown.stepReturnOverheadMs) / 10;
    console.log(`[test] Overhead per step: ${overheadPerStep.toFixed(0)}ms`);
  });

  it("should measure scaling with 25 steps x 50ms", async () => {
    console.log("\n[test] Running 25 steps x 50ms instrumented workflow");

    const { result, analysis } = await runInstrumentedWorkflow(client, {
      stepCount: 25,
      stepDurationMs: 50,
    });

    expect(result).toBeDefined();
    expect(result.stepCount).toBe(25);

    const { summary } = analysis;

    console.log("\n[test] TIMING BREAKDOWN:");
    console.log(`  Total Duration: ${summary.totalDurationMs}ms`);
    console.log(`  Total Invocations: ${summary.totalInvocations}`);
    console.log(`  Accountability: ${summary.accountabilityPct.toFixed(1)}%`);
    console.log("\n[test] Component Breakdown:");
    console.log(formatBreakdown(summary.breakdown, summary.totalDurationMs));

    // Calculate overhead percentages
    const totalOverhead =
      summary.breakdown.stepCallOverheadMs +
      summary.breakdown.stepReturnOverheadMs +
      summary.breakdown.interStepOverheadMs +
      summary.breakdown.handlerSetupMs +
      summary.breakdown.interInvocationMs;

    const overheadPct = (totalOverhead / summary.totalDurationMs) * 100;
    console.log(`\n[test] Total Overhead: ${totalOverhead.toFixed(0)}ms (${overheadPct.toFixed(1)}%)`);
    console.log(`[test] Per-invocation overhead: ${(summary.breakdown.handlerSetupMs / summary.totalInvocations).toFixed(0)}ms`);
  });

  it("should compare short vs long action durations", async () => {
    console.log("\n[test] Comparing short (50ms) vs long (500ms) action durations");

    // Run with short duration
    const shortResult = await runInstrumentedWorkflow(client, {
      stepCount: 5,
      stepDurationMs: 50,
    });

    // Clear data between runs
    await client.mutation(api.testMutations.clearTestData, {});

    // Run with long duration
    const longResult = await runInstrumentedWorkflow(client, {
      stepCount: 5,
      stepDurationMs: 500,
    });

    const shortSummary = shortResult.analysis.summary;
    const longSummary = longResult.analysis.summary;

    console.log("\n[test] SHORT ACTIONS (5 x 50ms):");
    console.log(`  Total Duration: ${shortSummary.totalDurationMs}ms`);
    console.log(`  Accountability: ${shortSummary.accountabilityPct.toFixed(1)}%`);
    console.log(formatBreakdown(shortSummary.breakdown, shortSummary.totalDurationMs));

    console.log("\n[test] LONG ACTIONS (5 x 500ms):");
    console.log(`  Total Duration: ${longSummary.totalDurationMs}ms`);
    console.log(`  Accountability: ${longSummary.accountabilityPct.toFixed(1)}%`);
    console.log(formatBreakdown(longSummary.breakdown, longSummary.totalDurationMs));

    // Compare overhead as percentage
    const shortOverheadPct =
      ((shortSummary.totalDurationMs - shortSummary.breakdown.actionExecutionMs) / shortSummary.totalDurationMs) * 100;
    const longOverheadPct =
      ((longSummary.totalDurationMs - longSummary.breakdown.actionExecutionMs) / longSummary.totalDurationMs) * 100;

    console.log("\n[test] COMPARISON:");
    console.log(`  Short actions overhead: ${shortOverheadPct.toFixed(1)}%`);
    console.log(`  Long actions overhead: ${longOverheadPct.toFixed(1)}%`);

    // Long actions should have lower overhead percentage (overhead is relatively smaller)
    expect(longOverheadPct).toBeLessThan(shortOverheadPct);
  });

  it("should identify step call vs return overhead asymmetry", async () => {
    console.log("\n[test] Analyzing step call vs return overhead asymmetry");

    const { analysis } = await runInstrumentedWorkflow(client, {
      stepCount: 10,
      stepDurationMs: 100,
    });

    const { summary } = analysis;

    console.log("\n[test] OVERHEAD ASYMMETRY:");
    console.log(`  Step Call Overhead:   ${summary.breakdown.stepCallOverheadMs.toFixed(0)}ms`);
    console.log(`  Step Return Overhead: ${summary.breakdown.stepReturnOverheadMs.toFixed(0)}ms`);

    const callPerStep = summary.breakdown.stepCallOverheadMs / 10;
    const returnPerStep = summary.breakdown.stepReturnOverheadMs / 10;

    console.log(`  Per-step call overhead:   ${callPerStep.toFixed(1)}ms`);
    console.log(`  Per-step return overhead: ${returnPerStep.toFixed(1)}ms`);

    const ratio = callPerStep / returnPerStep;
    console.log(`  Ratio (call/return): ${ratio.toFixed(2)}x`);

    // Document findings about which direction has more overhead
    if (callPerStep > returnPerStep) {
      console.log("\n[test] FINDING: Step CALL overhead > Step RETURN overhead");
      console.log("  This suggests workpool enqueue/scheduling is more expensive than completion handling");
    } else if (returnPerStep > callPerStep) {
      console.log("\n[test] FINDING: Step RETURN overhead > Step CALL overhead");
      console.log("  This suggests workpool completion handling is more expensive than enqueue/scheduling");
    } else {
      console.log("\n[test] FINDING: Symmetric overhead between call and return");
    }
  });

  it("should measure inter-invocation delay scaling", async () => {
    console.log("\n[test] Measuring inter-invocation delay with increasing step counts");

    const configs = [
      { stepCount: 5, stepDurationMs: 100 },
      { stepCount: 10, stepDurationMs: 100 },
      { stepCount: 20, stepDurationMs: 100 },
    ];

    const results: Array<{
      stepCount: number;
      totalInvocations: number;
      interInvocationMs: number;
      avgPerInvocation: number;
    }> = [];

    for (const config of configs) {
      // Clear data between runs
      await client.mutation(api.testMutations.clearTestData, {});

      const { analysis } = await runInstrumentedWorkflow(client, config);
      const { summary } = analysis;

      results.push({
        stepCount: config.stepCount,
        totalInvocations: summary.totalInvocations,
        interInvocationMs: summary.breakdown.interInvocationMs,
        avgPerInvocation:
          summary.totalInvocations > 1
            ? summary.breakdown.interInvocationMs / (summary.totalInvocations - 1)
            : 0,
      });

      console.log(
        `[test] ${config.stepCount} steps: ` +
          `${summary.totalInvocations} invocations, ` +
          `${summary.breakdown.interInvocationMs.toFixed(0)}ms inter-invocation time`
      );
    }

    console.log("\n[test] INTER-INVOCATION SCALING:");
    console.log("| Steps | Invocations | Inter-Invoc (ms) | Avg per Gap (ms) |");
    console.log("|-------|-------------|------------------|------------------|");
    for (const r of results) {
      console.log(
        `| ${r.stepCount.toString().padStart(5)} | ${r.totalInvocations.toString().padStart(11)} | ${r.interInvocationMs.toFixed(0).padStart(16)} | ${r.avgPerInvocation.toFixed(0).padStart(16)} |`
      );
    }

    // Check if inter-invocation delay is consistent
    const avgDelays = results.map((r) => r.avgPerInvocation);
    const maxDelay = Math.max(...avgDelays);
    const minDelay = Math.min(...avgDelays);

    if (maxDelay > 0 && minDelay > 0) {
      const variationRatio = maxDelay / minDelay;
      console.log(`\n[test] Delay variation ratio: ${variationRatio.toFixed(2)}x`);

      if (variationRatio > 2) {
        console.log("[test] WARNING: High variation in inter-invocation delay");
      } else {
        console.log("[test] Inter-invocation delay is relatively consistent");
      }
    }
  });

  it("should generate full time accountability report", async () => {
    console.log("\n[test] Generating full time accountability report");

    const { analysis } = await runInstrumentedWorkflow(client, {
      stepCount: 15,
      stepDurationMs: 100,
      stepPayloadSizeKb: 10,
    });

    const { summary } = analysis;
    const breakdown = summary.breakdown;

    console.log("\n" + "=".repeat(60));
    console.log("FULL TIME ACCOUNTABILITY REPORT");
    console.log("=".repeat(60));
    console.log(`Configuration: 15 steps x 100ms, 10KB payload`);
    console.log(`Total Duration: ${summary.totalDurationMs}ms`);
    console.log(`Total Invocations: ${summary.totalInvocations}`);
    console.log(`Accountability: ${summary.accountabilityPct.toFixed(1)}%`);
    console.log("-".repeat(60));

    const components = [
      { name: "Action Execution", ms: breakdown.actionExecutionMs, desc: "Time actions actually ran" },
      { name: "Step Call Overhead", ms: breakdown.stepCallOverheadMs, desc: "Workpool enqueue → action start" },
      { name: "Step Return Overhead", ms: breakdown.stepReturnOverheadMs, desc: "Action end → step return" },
      { name: "Inter-Step Overhead", ms: breakdown.interStepOverheadMs, desc: "Between steps in handler" },
      { name: "Handler Setup", ms: breakdown.handlerSetupMs, desc: "Journal replay + context" },
      { name: "Inter-Invocation", ms: breakdown.interInvocationMs, desc: "Scheduler wake-up delay" },
    ];

    console.log("COMPONENT BREAKDOWN:");
    console.log("-".repeat(60));

    let totalMeasured = 0;
    for (const c of components) {
      const pct = (c.ms / summary.totalDurationMs) * 100;
      console.log(`${c.name.padEnd(22)} ${c.ms.toFixed(0).padStart(8)}ms  ${pct.toFixed(1).padStart(5)}%  ${c.desc}`);
      totalMeasured += c.ms;
    }

    console.log("-".repeat(60));
    console.log(`${"TOTAL MEASURED".padEnd(22)} ${totalMeasured.toFixed(0).padStart(8)}ms  ${((totalMeasured / summary.totalDurationMs) * 100).toFixed(1).padStart(5)}%`);

    const unaccounted = summary.totalDurationMs - totalMeasured;
    console.log(`${"UNACCOUNTED".padEnd(22)} ${unaccounted.toFixed(0).padStart(8)}ms  ${((unaccounted / summary.totalDurationMs) * 100).toFixed(1).padStart(5)}%`);
    console.log("=".repeat(60));

    // Key insights
    console.log("\nKEY INSIGHTS:");

    // 1. What percentage is actual work?
    const workPct = (breakdown.actionExecutionMs / summary.totalDurationMs) * 100;
    console.log(`- Actual work time: ${workPct.toFixed(1)}% of total`);

    // 2. What's the overhead per step?
    const overheadPerStep = (breakdown.stepCallOverheadMs + breakdown.stepReturnOverheadMs) / 15;
    console.log(`- Overhead per step: ${overheadPerStep.toFixed(1)}ms`);

    // 3. Inter-invocation delay
    if (summary.totalInvocations > 1) {
      const avgInterInvoc = breakdown.interInvocationMs / (summary.totalInvocations - 1);
      console.log(`- Avg inter-invocation delay: ${avgInterInvoc.toFixed(1)}ms`);
    }

    // 4. Handler setup per invocation
    const avgSetup = breakdown.handlerSetupMs / summary.totalInvocations;
    console.log(`- Avg handler setup: ${avgSetup.toFixed(1)}ms per invocation`);

    // Verify high accountability
    expect(summary.accountabilityPct).toBeGreaterThan(75);
  });
});
