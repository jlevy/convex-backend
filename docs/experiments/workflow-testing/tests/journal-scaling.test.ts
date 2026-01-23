/**
 * Journal Scaling Tests
 *
 * Verifies O(N) scaling of journal load time with iteration count.
 * Each workflow re-invocation loads the entire journal to replay
 * completed steps.
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { ConvexHttpClient } from "convex/browser";
import { api } from "../convex/_generated/api";
import { calculateStats, logStats, linearRegression } from "./utils/stats";
import { sleep } from "./utils/timing";

const CONVEX_URL = process.env.CONVEX_URL || "http://127.0.0.1:3210";

describe("journal scaling", () => {
  let client: ConvexHttpClient;

  beforeAll(() => {
    client = new ConvexHttpClient(CONVEX_URL);
    console.log(`[test] Connected to Convex at ${CONVEX_URL}`);
  });

  afterAll(() => {
    // Clean up test data
  });

  it("should measure iteration times for 10 steps", async () => {
    console.log("\n[test] Testing journal scaling with 10 iterations");

    const workflowId = await client.mutation(api.testWorkflows.startJournalScalingWorkflow, {
      iterations: 10,
    });

    console.log(`[test] Started workflow: ${workflowId}`);

    let result;
    for (let i = 0; i < 120; i++) {
      const status = await client.query(api.testWorkflows.getWorkflowStatus, {
        workflowId,
      });

      if (status.type === "completed" && status.result) {
        result = status.result;
        break;
      }
      if (status.type === "failed") {
        throw new Error(`Workflow failed: ${JSON.stringify(status)}`);
      }

      await sleep(1000);
    }

    expect(result).toBeDefined();
    expect(result.totalIterations).toBe(10);

    console.log("[test] Iteration times:");
    for (const it of result.iterationTimes) {
      console.log(`  Step ${it.iteration}: ${it.elapsedMs}ms`);
    }

    const times = result.iterationTimes.map((it: any) => it.elapsedMs);
    const stats = calculateStats(times);
    logStats("10-step iteration times", stats);
  });

  it("should measure iteration times for 25 steps", async () => {
    console.log("\n[test] Testing journal scaling with 25 iterations");

    const workflowId = await client.mutation(api.testWorkflows.startJournalScalingWorkflow, {
      iterations: 25,
    });

    console.log(`[test] Started workflow: ${workflowId}`);

    let result;
    for (let i = 0; i < 180; i++) {
      const status = await client.query(api.testWorkflows.getWorkflowStatus, {
        workflowId,
      });

      if (status.type === "completed" && status.result) {
        result = status.result;
        break;
      }
      if (status.type === "failed") {
        throw new Error(`Workflow failed: ${JSON.stringify(status)}`);
      }

      await sleep(1000);
    }

    expect(result).toBeDefined();
    expect(result.totalIterations).toBe(25);

    // Analyze if later iterations take longer (indicating O(N) journal load)
    const firstHalf = result.iterationTimes.slice(0, 12).map((it: any) => it.elapsedMs);
    const secondHalf = result.iterationTimes.slice(12).map((it: any) => it.elapsedMs);

    const firstStats = calculateStats(firstHalf);
    const secondStats = calculateStats(secondHalf);

    console.log("[test] First half (iterations 0-11):");
    logStats("  ", firstStats);

    console.log("[test] Second half (iterations 12-24):");
    logStats("  ", secondStats);

    const slowdown = secondStats.mean / firstStats.mean;
    console.log(`[test] Second half is ${slowdown.toFixed(2)}x slower than first half`);

    if (slowdown > 1.3) {
      console.log("[test] OBSERVATION: Significant slowdown in later iterations");
    }
  });

  it("should analyze correlation between iteration number and time", async () => {
    console.log("\n[test] Running correlation analysis on 50 iterations");

    const workflowId = await client.mutation(api.testWorkflows.startJournalScalingWorkflow, {
      iterations: 50,
    });

    console.log(`[test] Started workflow: ${workflowId}`);

    let result;
    for (let i = 0; i < 300; i++) {
      const status = await client.query(api.testWorkflows.getWorkflowStatus, {
        workflowId,
      });

      if (status.type === "completed" && status.result) {
        result = status.result;
        break;
      }
      if (status.type === "failed") {
        throw new Error(`Workflow failed: ${JSON.stringify(status)}`);
      }

      await sleep(1000);
    }

    expect(result).toBeDefined();

    // Prepare data for linear regression
    const points = result.iterationTimes.map((it: any) => ({
      x: it.iteration,
      y: it.elapsedMs,
    }));

    const regression = linearRegression(points);

    console.log("\n[test] Linear Regression Analysis:");
    console.log(`  Slope: ${regression.slope.toFixed(4)} ms/iteration`);
    console.log(`  Intercept: ${regression.intercept.toFixed(2)} ms (initial overhead)`);
    console.log(`  R²: ${regression.rSquared.toFixed(4)}`);

    // Print sample of data
    console.log("\n[test] Sample data points (every 10th iteration):");
    console.log("| Iteration | Elapsed (ms) | Predicted (ms) |");
    console.log("|-----------|--------------|----------------|");
    for (let i = 0; i < 50; i += 10) {
      const p = points[i];
      const predicted = regression.slope * p.x + regression.intercept;
      console.log(
        `| ${p.x.toString().padStart(9)} | ${p.y.toFixed(0).padStart(12)} | ${predicted.toFixed(0).padStart(14)} |`
      );
    }

    // Interpret results
    console.log("\n[test] Interpretation:");
    if (regression.rSquared > 0.7 && regression.slope > 0) {
      console.log("  CONFIRMED: Journal load scales O(N) with iteration count");
      console.log(`  Each additional step adds ~${regression.slope.toFixed(2)}ms overhead`);
      console.log(`  At 100 iterations, expect ~${(100 * regression.slope + regression.intercept).toFixed(0)}ms per step`);
    } else if (regression.slope > 0.5) {
      console.log("  PARTIAL: Some growth in iteration time, but not strongly linear");
    } else {
      console.log("  DISPROVEN: No significant O(N) scaling observed");
    }

    // Calculate projected overhead for larger workflows
    console.log("\n[test] Projected overhead for larger workflows:");
    for (const n of [100, 200, 500, 1000]) {
      const projected = n * regression.slope + regression.intercept;
      console.log(`  ${n} iterations: ~${projected.toFixed(0)}ms per step`);
    }
  });

  it("should compare workflows with different step counts", async () => {
    console.log("\n[test] Comparing workflows with 10, 25, and 50 steps");

    const testCases = [
      { iterations: 10, label: "10 steps" },
      { iterations: 25, label: "25 steps" },
      { iterations: 50, label: "50 steps" },
    ];

    const summaries: Array<{ label: string; meanTime: number; lastIterTime: number }> = [];

    for (const tc of testCases) {
      console.log(`[test] Running ${tc.label}...`);

      const workflowId = await client.mutation(api.testWorkflows.startJournalScalingWorkflow, {
        iterations: tc.iterations,
      });

      let result;
      for (let i = 0; i < 300; i++) {
        const status = await client.query(api.testWorkflows.getWorkflowStatus, {
          workflowId,
        });

        if (status.type === "completed" && status.result) {
          result = status.result;
          break;
        }
        await sleep(1000);
      }

      if (result) {
        const times = result.iterationTimes.map((it: any) => it.elapsedMs);
        const stats = calculateStats(times);
        const lastIterTime = result.iterationTimes[result.iterationTimes.length - 1].elapsedMs;

        summaries.push({
          label: tc.label,
          meanTime: stats.mean,
          lastIterTime,
        });

        console.log(`[test] ${tc.label}: mean=${stats.mean.toFixed(0)}ms, last=${lastIterTime}ms`);
      }
    }

    console.log("\n[test] Summary:");
    console.log("| Steps | Mean Time | Last Iteration |");
    console.log("|-------|-----------|----------------|");
    for (const s of summaries) {
      console.log(`| ${s.label.padEnd(5)} | ${s.meanTime.toFixed(0).padStart(7)}ms | ${s.lastIterTime.toFixed(0).padStart(12)}ms |`);
    }

    // Check if last iteration time scales with step count
    if (summaries.length === 3) {
      const ratio50to10 = summaries[2].lastIterTime / summaries[0].lastIterTime;
      console.log(`\n[test] Last iteration time ratio (50 vs 10 steps): ${ratio50to10.toFixed(2)}x`);

      if (ratio50to10 > 3) {
        console.log("[test] CONFIRMED: Journal load overhead scales significantly with step count");
      } else if (ratio50to10 > 1.5) {
        console.log("[test] PARTIAL: Some scaling observed but not fully linear");
      } else {
        console.log("[test] DISPROVEN: No significant scaling in journal load time");
      }
    }
  });
});
