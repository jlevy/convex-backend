/**
 * Scheduler Wake-up Tests
 *
 * Investigates whether the DB subscription wake-up fails after
 * long-running steps, causing fallback to 5-second polling.
 *
 * Related bead: cvx-fcqi
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { ConvexHttpClient } from "convex/browser";
import { api } from "../convex/_generated/api";
import { calculateStats, logStats, formatStats } from "./utils/stats";
import { sleep } from "./utils/timing";

const CONVEX_URL = process.env.CONVEX_URL || "http://127.0.0.1:3210";

describe("scheduler wake-up", () => {
  let client: ConvexHttpClient;

  beforeAll(() => {
    client = new ConvexHttpClient(CONVEX_URL);
    console.log(`[test] Connected to Convex at ${CONVEX_URL}`);
  });

  afterAll(() => {
    // Clean up test data
  });

  it("should measure inter-iteration gaps with short steps (100ms)", async () => {
    console.log("\n[test] Starting short step duration test (100ms x 5)");

    const durations = [100, 100, 100, 100, 100];
    const workflowId = await client.mutation(api.testWorkflows.startVariableDurationWorkflow, {
      durations,
    });

    console.log(`[test] Started workflow: ${workflowId}`);

    // Poll for completion
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
    console.log(`[test] Workflow completed`);

    // Analyze gaps (skip first gap which is from workflow start)
    const gaps = result.gaps.slice(1);
    const stats = calculateStats(gaps);
    logStats("Short step gaps", stats);

    // For short steps, we expect gaps to be < 2s
    expect(stats.p95).toBeLessThan(5000);
    console.log(`[test] Short step test passed: p95 gap = ${stats.p95.toFixed(0)}ms`);
  });

  it("should measure inter-iteration gaps with medium steps (1s)", async () => {
    console.log("\n[test] Starting medium step duration test (1000ms x 5)");

    const durations = [1000, 1000, 1000, 1000, 1000];
    const workflowId = await client.mutation(api.testWorkflows.startVariableDurationWorkflow, {
      durations,
    });

    console.log(`[test] Started workflow: ${workflowId}`);

    // Poll for completion
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
    console.log(`[test] Workflow completed`);

    const gaps = result.gaps.slice(1);
    const stats = calculateStats(gaps);
    logStats("Medium step gaps", stats);

    // Check if any gaps exceed 5s (potential wake-up failure)
    const largeGaps = gaps.filter((g: number) => g > 5000);
    console.log(`[test] Gaps > 5s: ${largeGaps.length} (${((largeGaps.length / gaps.length) * 100).toFixed(1)}%)`);

    if (largeGaps.length > 0) {
      console.log(`[test] WARNING: Detected ${largeGaps.length} gaps > 5s, possible scheduler fallback`);
    }
  });

  it("should measure inter-iteration gaps with long steps (5s)", async () => {
    console.log("\n[test] Starting long step duration test (5000ms x 3)");

    const durations = [5000, 5000, 5000];
    const workflowId = await client.mutation(api.testWorkflows.startVariableDurationWorkflow, {
      durations,
    });

    console.log(`[test] Started workflow: ${workflowId}`);

    // Poll for completion - longer timeout for long steps
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
    console.log(`[test] Workflow completed`);

    const gaps = result.gaps.slice(1);
    const stats = calculateStats(gaps);
    logStats("Long step gaps", stats);

    // This is where we expect to see the scheduler fallback behavior
    const largeGaps = gaps.filter((g: number) => g > 5000);
    const percentLarge = (largeGaps.length / gaps.length) * 100;

    console.log(`[test] Gaps > 5s: ${largeGaps.length} (${percentLarge.toFixed(1)}%)`);

    // Document findings
    if (percentLarge > 10) {
      console.log(`[test] CONFIRMED: Scheduler falls back to polling after long steps`);
    } else if (percentLarge > 0) {
      console.log(`[test] PARTIAL: Some scheduler fallback observed`);
    } else {
      console.log(`[test] DISPROVEN: No scheduler fallback observed`);
    }
  });

  it("should compare gaps across different step durations", async () => {
    console.log("\n[test] Running comparative gap analysis");

    const testCases = [
      { label: "50ms", durations: [50, 50, 50, 50, 50] },
      { label: "500ms", durations: [500, 500, 500, 500, 500] },
      { label: "2000ms", durations: [2000, 2000, 2000] },
    ];

    const results: Array<{ label: string; meanGap: number; maxGap: number }> = [];

    for (const testCase of testCases) {
      console.log(`[test] Testing ${testCase.label} steps...`);

      const workflowId = await client.mutation(api.testWorkflows.startVariableDurationWorkflow, {
        durations: testCase.durations,
      });

      // Poll for completion
      let result;
      for (let i = 0; i < 120; i++) {
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
        const gaps = result.gaps.slice(1);
        const stats = calculateStats(gaps);
        results.push({
          label: testCase.label,
          meanGap: stats.mean,
          maxGap: stats.max,
        });
        console.log(`[test] ${testCase.label}: mean=${stats.mean.toFixed(0)}ms, max=${stats.max.toFixed(0)}ms`);
      }
    }

    console.log("\n[test] Summary:");
    console.log("| Step Duration | Mean Gap | Max Gap |");
    console.log("|---------------|----------|---------|");
    for (const r of results) {
      console.log(`| ${r.label.padEnd(13)} | ${r.meanGap.toFixed(0).padStart(6)}ms | ${r.maxGap.toFixed(0).padStart(5)}ms |`);
    }
  });

  it("should reproduce external engineer pattern - alternating simple/complex tools (cvx-fcqi)", async () => {
    console.log("\n[test] Reproducing external engineer's observed pattern");
    console.log("[test] Pattern: simple → complex → simple → complex → simple");

    // This pattern mimics what the external engineer observed:
    // - Simple tools (stock_prices_historical): ~100ms, ~5KB result, ~1.1s gaps
    // - Complex tools (llm_filtered_web_search): ~3.5s, ~50KB result, ~6s gaps
    const pattern: Array<"simple" | "complex"> = [
      "simple",
      "complex",
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

    console.log(`[test] Started workflow: ${workflowId}`);

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
    console.log(`[test] Workflow completed`);

    // Analyze gaps by tool type
    console.log("\n[test] Iteration Details:");
    console.log("| # | Tool Type | Tool Duration | Gap from Prev |");
    console.log("|---|-----------|---------------|---------------|");
    for (const it of result.iterations) {
      console.log(
        `| ${it.index} | ${it.toolType.padEnd(9)} | ${it.toolDurationMs.toFixed(0).padStart(11)}ms | ${it.gapFromPrevMs.toFixed(0).padStart(11)}ms |`
      );
    }

    console.log("\n[test] Summary:");
    console.log(`  Simple tool avg gap: ${result.summary.simpleToolAvgGapMs.toFixed(0)}ms`);
    console.log(`  Complex tool avg gap: ${result.summary.complexToolAvgGapMs.toFixed(0)}ms`);
    console.log(`  Max gap: ${result.summary.maxGapMs}ms`);
    console.log(`  Gaps > 5s: ${result.summary.gapsOver5s}`);

    // External engineer observed: simple ~1.1s gaps, complex ~6s gaps
    // If complex gaps are significantly higher, we've reproduced the issue
    const gapRatio = result.summary.complexToolAvgGapMs / result.summary.simpleToolAvgGapMs;

    console.log(`\n[test] Gap ratio (complex/simple): ${gapRatio.toFixed(2)}x`);

    if (result.summary.gapsOver5s > 0) {
      console.log("[test] CONFIRMED (cvx-fcqi): Observed gaps > 5s after complex tools");
      console.log("[test] This indicates scheduler fallback to polling behavior");
    } else if (gapRatio > 3) {
      console.log("[test] PARTIAL (cvx-fcqi): Complex tools have significantly higher gaps");
      console.log("[test] But no gaps exceeded 5s threshold");
    } else {
      console.log("[test] DISPROVEN (cvx-fcqi): No significant gap difference between tool types");
    }
  });

  it("should test very long steps (15s) to stress scheduler subscription", async () => {
    console.log("\n[test] Testing very long steps (15000ms x 2)");
    console.log("[test] This should reliably trigger scheduler subscription timeout");

    const durations = [15000, 15000];
    const workflowId = await client.mutation(api.testWorkflows.startVariableDurationWorkflow, {
      durations,
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
    console.log(`[test] Workflow completed`);

    const gaps = result.gaps.slice(1);
    const stats = calculateStats(gaps);
    logStats("Very long step gaps", stats);

    // With 15s steps, we should definitely see scheduler fallback
    const largeGaps = gaps.filter((g: number) => g > 5000);

    if (largeGaps.length > 0) {
      console.log(`[test] CONFIRMED: ${largeGaps.length} gaps > 5s observed with 15s steps`);
      console.log(`[test] Large gaps: ${largeGaps.map((g: number) => `${g}ms`).join(", ")}`);
    } else {
      console.log(`[test] UNEXPECTED: No gaps > 5s even with 15s steps`);
      console.log(`[test] This suggests scheduler subscription is working correctly`);
    }
  });
});
