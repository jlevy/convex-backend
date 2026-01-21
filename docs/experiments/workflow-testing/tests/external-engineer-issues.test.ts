/**
 * External Engineer Issue Reproduction Tests
 *
 * These tests specifically reproduce the issues identified by the external
 * engineer in their "Workflow Infrastructure Overhead: Deep Dive Analysis"
 * document.
 *
 * Related beads:
 * - cvx-5kc4: 37% unaccounted/unmeasured time
 * - cvx-fcqi: DB subscription wake-up failure after complex tools (6s gaps)
 * - cvx-1l22: Test case for llm_filtered_web_search pattern
 * - cvx-g6ac: Large payload overhead verification
 * - cvx-2t3o: Step overhead P95 outliers
 * - cvx-vjh4: step.runQuery latency bug
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { ConvexHttpClient } from "convex/browser";
import { api } from "../convex/_generated/api";
import { calculateStats, logStats, linearRegression } from "./utils/stats";
import { sleep } from "./utils/timing";

const CONVEX_URL = process.env.CONVEX_URL || "http://127.0.0.1:3210";

describe("External Engineer Issue Reproduction", () => {
  let client: ConvexHttpClient;

  beforeAll(() => {
    client = new ConvexHttpClient(CONVEX_URL);
    console.log(`[test] Connected to Convex at ${CONVEX_URL}`);
  });

  afterAll(() => {
    // Clean up
  });

  /**
   * Issue: cvx-5kc4 - 37% Unaccounted Time
   *
   * The external engineer observed that ~37% of workflow time (22% unaccounted +
   * 15% unmeasured) was not captured in timing instrumentation.
   *
   * This test measures total workflow time vs sum of measured components to
   * calculate the "accountability percentage".
   */
  describe("cvx-5kc4: 37% Unaccounted Time", () => {
    it("should measure accountability percentage with 5 iterations", async () => {
      console.log("\n[cvx-5kc4] Testing accountability with 5 iterations");

      const workflowId = await client.mutation(api.testWorkflows.startAccountabilityTrackingWorkflow, {
        iterations: 5,
        toolDurationMs: 500, // 500ms tool execution per iteration
      });

      console.log(`[cvx-5kc4] Started workflow: ${workflowId}`);

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

      console.log("\n[cvx-5kc4] Results:");
      console.log(`  Total workflow time: ${result.totalWorkflowMs}ms`);
      console.log(`  Tool execution: ${result.measuredComponents.toolExecutionMs}ms`);
      console.log(`  Gaps between iterations: ${result.measuredComponents.gapsBetweenIterationsMs}ms`);
      console.log(`  Step overhead: ${result.measuredComponents.stepOverheadMs}ms`);
      console.log(`  Accountability: ${result.accountabilityPct.toFixed(1)}%`);
      console.log(`  Unaccounted: ${result.unaccountedMs}ms`);

      // Check if we reproduce the ~63% accountability (37% unaccounted)
      if (result.accountabilityPct < 70) {
        console.log("\n[cvx-5kc4] REPRODUCED: Accountability < 70% - similar to external engineer's findings");
      } else if (result.accountabilityPct < 85) {
        console.log("\n[cvx-5kc4] PARTIAL: Some unaccounted time present");
      } else {
        console.log("\n[cvx-5kc4] NOT REPRODUCED: High accountability suggests different conditions");
      }
    });

    it("should analyze accountability across different iteration counts", async () => {
      console.log("\n[cvx-5kc4] Comparing accountability across iteration counts");

      const testCases = [
        { iterations: 3, label: "3 iterations" },
        { iterations: 5, label: "5 iterations" },
        { iterations: 10, label: "10 iterations" },
      ];

      const results: Array<{
        label: string;
        totalMs: number;
        accountabilityPct: number;
        unaccountedMs: number;
      }> = [];

      for (const tc of testCases) {
        console.log(`[cvx-5kc4] Testing ${tc.label}...`);

        const workflowId = await client.mutation(api.testWorkflows.startAccountabilityTrackingWorkflow, {
          iterations: tc.iterations,
          toolDurationMs: 500,
        });

        let result;
        for (let i = 0; i < 240; i++) {
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
          results.push({
            label: tc.label,
            totalMs: result.totalWorkflowMs,
            accountabilityPct: result.accountabilityPct,
            unaccountedMs: result.unaccountedMs,
          });
        }
      }

      console.log("\n[cvx-5kc4] Summary:");
      console.log("| Iterations | Total (ms) | Accountability | Unaccounted |");
      console.log("|------------|------------|----------------|-------------|");
      for (const r of results) {
        console.log(
          `| ${r.label.padEnd(10)} | ${r.totalMs.toFixed(0).padStart(10)} | ${r.accountabilityPct.toFixed(1).padStart(13)}% | ${r.unaccountedMs.toFixed(0).padStart(9)}ms |`
        );
      }

      // Check if accountability decreases with more iterations (indicating O(N) scaling)
      if (results.length >= 2) {
        const firstAccountability = results[0].accountabilityPct;
        const lastAccountability = results[results.length - 1].accountabilityPct;
        if (lastAccountability < firstAccountability - 5) {
          console.log("\n[cvx-5kc4] OBSERVATION: Accountability decreases with more iterations");
        }
      }
    });
  });

  /**
   * Issue: cvx-fcqi, cvx-1l22 - 6s Gaps After Complex Tools
   *
   * The external engineer observed ~6s inter-iteration gaps after llm_filtered_web_search,
   * possibly due to DB subscription wake-up failures causing fallback to 5s polling.
   */
  describe("cvx-fcqi, cvx-1l22: 6s Gaps After Complex Tools", () => {
    it("should compare gaps after simple vs complex tools", async () => {
      console.log("\n[cvx-fcqi] Testing gap differences between simple and complex tools");

      // Pattern mimics external engineer's observation:
      // simple -> simple -> complex -> simple -> complex -> simple
      const pattern: Array<"simple" | "complex"> = [
        "simple",   // stock_prices_historical equivalent
        "simple",   // technical_indicators equivalent
        "complex",  // llm_filtered_web_search equivalent
        "simple",
        "complex",
        "simple",
      ];

      const workflowId = await client.mutation(api.testWorkflows.startMixedToolPatternWorkflow, {
        pattern,
        simpleToolDurationMs: 100,
        complexToolSearchMs: 2000,
        complexToolFilterPasses: 3,
        complexToolFilterMs: 500,
        complexToolResultKb: 50,
      });

      console.log(`[cvx-fcqi] Started workflow: ${workflowId}`);

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

      console.log("\n[cvx-fcqi] Iteration details:");
      console.log("| Iteration | Tool Type | Duration (ms) | Gap (ms) |");
      console.log("|-----------|-----------|---------------|----------|");
      for (const it of result.iterations) {
        console.log(
          `| ${it.index.toString().padStart(9)} | ${it.toolType.padEnd(9)} | ${it.toolDurationMs.toFixed(0).padStart(13)} | ${it.gapFromPrevMs.toFixed(0).padStart(8)} |`
        );
      }

      console.log("\n[cvx-fcqi] Summary:");
      console.log(`  Simple tool avg gap: ${result.summary.simpleToolAvgGapMs.toFixed(0)}ms`);
      console.log(`  Complex tool avg gap: ${result.summary.complexToolAvgGapMs.toFixed(0)}ms`);
      console.log(`  Max gap: ${result.summary.maxGapMs}ms`);
      console.log(`  Gaps > 5s: ${result.summary.gapsOver5s}`);

      // Check if we reproduce the ~6s gap phenomenon
      if (result.summary.gapsOver5s > 0) {
        console.log("\n[cvx-fcqi] REPRODUCED: Gaps > 5s detected after complex tools");
        console.log("[cvx-fcqi] This suggests scheduler wake-up failure, falling back to 5s polling");
      } else if (result.summary.complexToolAvgGapMs > result.summary.simpleToolAvgGapMs * 2) {
        console.log("\n[cvx-fcqi] PARTIAL: Complex tools show significantly higher gaps");
      } else {
        console.log("\n[cvx-fcqi] NOT REPRODUCED: Gap differences not significant");
      }
    });

    it("should specifically test llm_filtered_web_search pattern", async () => {
      console.log("\n[cvx-1l22] Testing llm_filtered_web_search pattern specifically");

      // Run multiple complex tools in a row to see if gaps accumulate
      const pattern: Array<"simple" | "complex"> = [
        "simple",   // baseline
        "complex",  // first llm_filtered_web_search
        "complex",  // second llm_filtered_web_search
        "complex",  // third llm_filtered_web_search
        "simple",   // recovery check
      ];

      const workflowId = await client.mutation(api.testWorkflows.startMixedToolPatternWorkflow, {
        pattern,
        complexToolSearchMs: 3000,      // Longer search
        complexToolFilterPasses: 5,     // More filter passes
        complexToolFilterMs: 500,
        complexToolResultKb: 100,       // Larger result
      });

      console.log(`[cvx-1l22] Started workflow: ${workflowId}`);

      let result;
      for (let i = 0; i < 360; i++) {
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

      // Focus on gaps AFTER complex tools
      const gapsAfterComplex: number[] = [];
      for (let i = 1; i < result.iterations.length; i++) {
        if (result.iterations[i - 1].toolType === "complex") {
          gapsAfterComplex.push(result.iterations[i].gapFromPrevMs);
        }
      }

      console.log("\n[cvx-1l22] Gaps after complex tools:");
      gapsAfterComplex.forEach((gap, idx) => {
        console.log(`  After complex #${idx + 1}: ${gap}ms${gap > 5000 ? " *** OVER 5s ***" : ""}`);
      });

      const avgGapAfterComplex =
        gapsAfterComplex.length > 0
          ? gapsAfterComplex.reduce((a, b) => a + b, 0) / gapsAfterComplex.length
          : 0;

      console.log(`\n[cvx-1l22] Average gap after complex: ${avgGapAfterComplex.toFixed(0)}ms`);

      if (gapsAfterComplex.some((g) => g > 5000)) {
        console.log("[cvx-1l22] REPRODUCED: Found gaps > 5s after llm_filtered_web_search pattern");
      }
    });
  });

  /**
   * Issue: cvx-2t3o - Step Overhead P95 Outliers
   *
   * The external engineer observed P95 outliers of 5.8s vs typical 1.2s,
   * indicating extreme variance in step overhead.
   */
  describe("cvx-2t3o: Step Overhead P95 Outliers", () => {
    it("should measure step overhead variance across many iterations", async () => {
      console.log("\n[cvx-2t3o] Testing step overhead variance with 20 iterations");

      const workflowId = await client.mutation(api.testWorkflows.startMinimalOverheadWorkflow, {
        steps: 20,
      });

      console.log(`[cvx-2t3o] Started workflow: ${workflowId}`);

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

      const stats = calculateStats(result.stepTimes);
      logStats("Step overhead", stats);

      // Calculate variance ratio
      const varianceRatio = stats.p95 / stats.median;

      console.log(`\n[cvx-2t3o] Variance analysis:`);
      console.log(`  P95 / Median ratio: ${varianceRatio.toFixed(2)}x`);
      console.log(`  P95: ${stats.p95.toFixed(0)}ms`);
      console.log(`  Median: ${stats.median.toFixed(0)}ms`);

      // Identify outliers (> 2x median)
      const outliers = result.stepTimes.filter((t: number) => t > stats.median * 2);
      console.log(`  Outliers (> 2x median): ${outliers.length} / ${result.stepTimes.length}`);

      if (varianceRatio > 3) {
        console.log("\n[cvx-2t3o] REPRODUCED: High variance ratio (> 3x) detected");
        console.log("[cvx-2t3o] This matches external engineer's observation of 5.8s vs 1.2s outliers");
      } else if (varianceRatio > 2) {
        console.log("\n[cvx-2t3o] PARTIAL: Moderate variance detected");
      } else {
        console.log("\n[cvx-2t3o] NOT REPRODUCED: Low variance in step overhead");
      }
    });
  });

  /**
   * Issue: cvx-g6ac - Large Payload Overhead
   *
   * Verify that large tool result payloads increase step.runQuery overhead
   * significantly due to workpool serialization.
   */
  describe("cvx-g6ac: Large Payload Overhead", () => {
    it("should measure overhead scaling with payload size", async () => {
      console.log("\n[cvx-g6ac] Testing payload size vs overhead correlation");

      const payloadSizes = [
        1024,      // 1KB
        10240,     // 10KB
        51200,     // 50KB
        102400,    // 100KB
        256000,    // 250KB
        512000,    // 500KB
      ];

      const workflowId = await client.mutation(api.testWorkflows.startVariablePayloadWorkflow, {
        payloadSizes,
      });

      console.log(`[cvx-g6ac] Started workflow: ${workflowId}`);

      let result;
      for (let i = 0; i < 240; i++) {
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

      // Run linear regression
      const points = result.measurements.map((m: any) => ({
        x: m.sizeBytes / 1024, // KB
        y: m.elapsedMs,
      }));

      const regression = linearRegression(points);

      console.log("\n[cvx-g6ac] Payload size vs overhead:");
      console.log("| Size (KB) | Elapsed (ms) |");
      console.log("|-----------|--------------|");
      for (const m of result.measurements) {
        console.log(
          `| ${(m.sizeBytes / 1024).toFixed(0).padStart(9)} | ${m.elapsedMs.toFixed(0).padStart(12)} |`
        );
      }

      console.log(`\n[cvx-g6ac] Regression analysis:`);
      console.log(`  Slope: ${regression.slope.toFixed(4)} ms/KB`);
      console.log(`  Intercept: ${regression.intercept.toFixed(0)} ms`);
      console.log(`  R²: ${regression.rSquared.toFixed(4)}`);

      // Calculate estimated overhead for 500KB payload
      const overhead500kb = regression.slope * 500 + regression.intercept;
      console.log(`  Estimated overhead for 500KB: ${overhead500kb.toFixed(0)}ms`);

      if (regression.rSquared > 0.7 && regression.slope > 0.01) {
        console.log("\n[cvx-g6ac] VERIFIED: Strong correlation between payload size and overhead");
        console.log(`[cvx-g6ac] Each 100KB adds approximately ${(regression.slope * 100).toFixed(0)}ms overhead`);
      } else if (regression.slope > 0.005) {
        console.log("\n[cvx-g6ac] PARTIAL: Some correlation exists");
      } else {
        console.log("\n[cvx-g6ac] NOT VERIFIED: Weak correlation");
      }
    });
  });

  /**
   * Combined reproduction test that mimics the external engineer's exact scenario
   */
  describe("Full Arena Pattern Reproduction", () => {
    it("should reproduce full arena project pattern", async () => {
      console.log("\n[FULL] Reproducing full arena project pattern");
      console.log("[FULL] Pattern: simple -> simple -> complex -> simple -> complex -> ...");

      // Pattern that mimics 9-iteration arena run
      // Mix of simple tools (stock prices, indicators) and complex (web search)
      const pattern: Array<"simple" | "complex"> = [
        "simple",   // Iteration 1: stock_prices_historical
        "simple",   // Iteration 2: technical_indicators
        "complex",  // Iteration 3: llm_filtered_web_search
        "simple",   // Iteration 4: insider_transactions
        "complex",  // Iteration 5: llm_filtered_web_search
        "simple",   // Iteration 6: stock_prices_historical
        "simple",   // Iteration 7: company_financials
        "complex",  // Iteration 8: llm_filtered_web_search
        "simple",   // Iteration 9: final analysis
      ];

      const workflowId = await client.mutation(api.testWorkflows.startMixedToolPatternWorkflow, {
        pattern,
        simpleToolDurationMs: 200,      // Simple API calls
        complexToolSearchMs: 2500,      // Web search
        complexToolFilterPasses: 4,     // LLM filtering
        complexToolFilterMs: 600,
        complexToolResultKb: 75,        // Larger results
      });

      console.log(`[FULL] Started workflow: ${workflowId}`);

      let result;
      for (let i = 0; i < 600; i++) {
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

      // Calculate total time and components
      const totalTime = result.iterations[result.iterations.length - 1].iterationEndTs -
        result.iterations[0].iterationStartTs;

      const totalToolTime = result.iterations.reduce(
        (sum: number, it: any) => sum + it.toolDurationMs,
        0
      );
      const totalGapTime = result.iterations.slice(1).reduce(
        (sum: number, it: any) => sum + it.gapFromPrevMs,
        0
      );

      const accountabilityPct = ((totalToolTime + totalGapTime) / totalTime) * 100;

      console.log("\n[FULL] Full run summary:");
      console.log(`  Total time: ${totalTime}ms (${(totalTime / 1000).toFixed(1)}s)`);
      console.log(`  Tool execution: ${totalToolTime}ms (${((totalToolTime / totalTime) * 100).toFixed(1)}%)`);
      console.log(`  Inter-iteration gaps: ${totalGapTime}ms (${((totalGapTime / totalTime) * 100).toFixed(1)}%)`);
      console.log(`  Accountability: ${accountabilityPct.toFixed(1)}%`);
      console.log(`  Simple avg gap: ${result.summary.simpleToolAvgGapMs.toFixed(0)}ms`);
      console.log(`  Complex avg gap: ${result.summary.complexToolAvgGapMs.toFixed(0)}ms`);
      console.log(`  Max gap: ${result.summary.maxGapMs}ms`);
      console.log(`  Gaps > 5s: ${result.summary.gapsOver5s}`);

      // Final assessment
      console.log("\n[FULL] Assessment:");
      const issues: string[] = [];

      if (accountabilityPct < 80) {
        issues.push("Low accountability (< 80%) - matches cvx-5kc4");
      }
      if (result.summary.gapsOver5s > 0) {
        issues.push("Gaps > 5s detected - matches cvx-fcqi");
      }
      if (result.summary.complexToolAvgGapMs > result.summary.simpleToolAvgGapMs * 1.5) {
        issues.push("Complex tools show higher gaps - supports cvx-1l22 hypothesis");
      }

      if (issues.length > 0) {
        console.log("[FULL] Issues reproduced:");
        issues.forEach((issue) => console.log(`  - ${issue}`));
      } else {
        console.log("[FULL] No significant issues reproduced in this run");
      }
    });
  });
});
