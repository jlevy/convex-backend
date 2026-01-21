/**
 * Variance Analysis Tests
 *
 * Analyzes the distribution of step overhead times to identify
 * outliers and understand the P95 vs typical overhead gap.
 *
 * External engineer observed:
 * - Typical step overhead: ~1.2s
 * - P95 step overhead: ~5.8s
 * - This 5x difference suggests significant variance
 *
 * Related bead: cvx-2t3o
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { ConvexHttpClient } from "convex/browser";
import { api } from "../convex/_generated/api";
import { calculateStats, logStats } from "./utils/stats";
import { sleep } from "./utils/timing";

const CONVEX_URL = process.env.CONVEX_URL || "http://127.0.0.1:3210";

describe("variance analysis (cvx-2t3o)", () => {
  let client: ConvexHttpClient;

  beforeAll(() => {
    client = new ConvexHttpClient(CONVEX_URL);
    console.log(`[test] Connected to Convex at ${CONVEX_URL}`);
  });

  afterAll(() => {
    // Clean up test data
  });

  it("should collect step overhead samples from multiple workflows", async () => {
    console.log("\n[test] Collecting step overhead samples from multiple workflows");
    console.log("[test] Running 5 workflows x 10 steps each = 50 samples");

    const allStepTimes: number[] = [];
    const workflowCount = 5;
    const stepsPerWorkflow = 10;

    for (let w = 0; w < workflowCount; w++) {
      console.log(`[test] Starting workflow ${w + 1}/${workflowCount}...`);

      const workflowId = await client.mutation(api.testWorkflows.startMinimalOverheadWorkflow, {
        steps: stepsPerWorkflow,
      });

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
          throw new Error(`Workflow ${w + 1} failed: ${JSON.stringify(status)}`);
        }

        await sleep(1000);
      }

      if (result) {
        allStepTimes.push(...result.stepTimes);
        console.log(`[test] Workflow ${w + 1} complete: ${result.stepTimes.length} samples`);
      }
    }

    expect(allStepTimes.length).toBe(workflowCount * stepsPerWorkflow);

    const stats = calculateStats(allStepTimes);
    logStats("Step overhead (noop actions)", stats);

    // Calculate P95/median ratio (external engineer saw ~5x)
    const p95MedianRatio = stats.p95 / stats.median;
    const p99MedianRatio = stats.p99 / stats.median;

    console.log("\n[test] Variance Analysis:");
    console.log(`  Median: ${stats.median.toFixed(0)}ms`);
    console.log(`  P95: ${stats.p95.toFixed(0)}ms`);
    console.log(`  P99: ${stats.p99.toFixed(0)}ms`);
    console.log(`  P95/Median ratio: ${p95MedianRatio.toFixed(2)}x`);
    console.log(`  P99/Median ratio: ${p99MedianRatio.toFixed(2)}x`);
    console.log(`  Outliers (>2σ): ${stats.outliers.length}`);

    if (stats.outliers.length > 0) {
      console.log(`  Outlier values: ${stats.outliers.map(o => `${o.toFixed(0)}ms`).join(", ")}`);
    }

    // Interpret results
    console.log("\n[test] Interpretation:");
    if (p95MedianRatio > 4) {
      console.log("  CONFIRMED (cvx-2t3o): High P95 variance (>4x median)");
      console.log("  This suggests occasional scheduler contention or other delays");
    } else if (p95MedianRatio > 2) {
      console.log("  PARTIAL (cvx-2t3o): Moderate P95 variance (2-4x median)");
      console.log("  Some outliers present but less severe than reported");
    } else {
      console.log("  DISPROVEN (cvx-2t3o): Low P95 variance (<2x median)");
      console.log("  Step overhead is consistent across samples");
    }
  });

  it("should analyze variance across different step durations", async () => {
    console.log("\n[test] Analyzing variance across different step durations");

    const testCases = [
      { label: "100ms steps", durations: [100, 100, 100, 100, 100] },
      { label: "500ms steps", durations: [500, 500, 500, 500, 500] },
      { label: "1000ms steps", durations: [1000, 1000, 1000, 1000] },
    ];

    const results: Array<{
      label: string;
      gapStats: ReturnType<typeof calculateStats>;
    }> = [];

    for (const tc of testCases) {
      console.log(`[test] Testing ${tc.label}...`);

      // Run 3 workflows for each configuration
      const allGaps: number[] = [];

      for (let run = 0; run < 3; run++) {
        const workflowId = await client.mutation(api.testWorkflows.startVariableDurationWorkflow, {
          durations: tc.durations,
        });

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

        if (result) {
          // Skip first gap (from workflow start)
          allGaps.push(...result.gaps.slice(1));
        }
      }

      const stats = calculateStats(allGaps);
      results.push({ label: tc.label, gapStats: stats });
      console.log(`[test] ${tc.label}: median=${stats.median.toFixed(0)}ms, p95=${stats.p95.toFixed(0)}ms`);
    }

    console.log("\n[test] Variance Summary:");
    console.log("| Step Duration | Median Gap | P95 Gap | P95/Median | Outliers |");
    console.log("|---------------|------------|---------|------------|----------|");
    for (const r of results) {
      const ratio = r.gapStats.p95 / r.gapStats.median;
      console.log(
        `| ${r.label.padEnd(13)} | ${r.gapStats.median.toFixed(0).padStart(8)}ms | ${r.gapStats.p95.toFixed(0).padStart(5)}ms | ${ratio.toFixed(2).padStart(10)} | ${r.gapStats.outliers.length.toString().padStart(8)} |`
      );
    }

    // Check if variance increases with step duration
    if (results.length >= 2) {
      const firstRatio = results[0].gapStats.p95 / results[0].gapStats.median;
      const lastRatio = results[results.length - 1].gapStats.p95 / results[results.length - 1].gapStats.median;

      if (lastRatio > firstRatio * 1.5) {
        console.log("\n[test] OBSERVATION: Variance increases with step duration");
        console.log("  Longer steps may correlate with more scheduler contention");
      }
    }
  });

  it("should measure variance in fully-instrumented workflow", async () => {
    console.log("\n[test] Measuring variance in fully-instrumented workflow");
    console.log("[test] Running 3 workflows with 10 steps each");

    const allStepCallOverheads: number[] = [];
    const allStepReturnOverheads: number[] = [];
    const allInterStepOverheads: number[] = [];

    for (let run = 0; run < 3; run++) {
      console.log(`[test] Run ${run + 1}/3...`);

      const { internalId, correlationId } = await client.mutation(
        api.testWorkflows.startFullyInstrumentedWorkflow,
        {
          stepCount: 10,
          stepDurationMs: 100,
          stepPayloadSizeKb: 1,
        }
      );

      // Wait for workflow completion
      let result;
      for (let i = 0; i < 180; i++) {
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

        await sleep(1000);
      }

      if (!result) {
        throw new Error("Workflow timed out");
      }

      // Fetch timing events for detailed analysis
      const events = await client.query(api.testMutations.getTimingEvents, {
        workflowId: correlationId,
      });

      // Calculate overheads from timing events
      for (let step = 0; step < 10; step++) {
        const preStep = events.find(
          (e: any) => e.eventType === "pre_step" && e.stepIndex === step
        );
        const actionStart = events.find(
          (e: any) => e.eventType === "action_start" && e.stepIndex === step
        );
        const actionEnd = events.find(
          (e: any) => e.eventType === "action_end" && e.stepIndex === step
        );
        const postStep = events.find(
          (e: any) => e.eventType === "post_step" && e.stepIndex === step
        );

        if (preStep && actionStart && actionEnd && postStep) {
          // Step call overhead: pre_step -> action_start
          allStepCallOverheads.push(actionStart.timestamp - preStep.timestamp);

          // Step return overhead: action_end -> post_step
          allStepReturnOverheads.push(postStep.timestamp - actionEnd.timestamp);

          // Inter-step overhead: previous post_step -> current pre_step
          if (step > 0) {
            const prevPostStep = events.find(
              (e: any) => e.eventType === "post_step" && e.stepIndex === step - 1
            );
            if (prevPostStep) {
              allInterStepOverheads.push(preStep.timestamp - prevPostStep.timestamp);
            }
          }
        }
      }
    }

    console.log("\n[test] Overhead Variance Analysis:");

    if (allStepCallOverheads.length > 0) {
      const callStats = calculateStats(allStepCallOverheads);
      console.log("\nStep Call Overhead (pre_step → action_start):");
      logStats("  ", callStats);
      console.log(`  P95/Median: ${(callStats.p95 / callStats.median).toFixed(2)}x`);
    }

    if (allStepReturnOverheads.length > 0) {
      const returnStats = calculateStats(allStepReturnOverheads);
      console.log("\nStep Return Overhead (action_end → post_step):");
      logStats("  ", returnStats);
      console.log(`  P95/Median: ${(returnStats.p95 / returnStats.median).toFixed(2)}x`);
    }

    if (allInterStepOverheads.length > 0) {
      const interStats = calculateStats(allInterStepOverheads);
      console.log("\nInter-Step Overhead (post_step → pre_step):");
      logStats("  ", interStats);
      console.log(`  P95/Median: ${(interStats.p95 / interStats.median).toFixed(2)}x`);
    }

    // Identify which component has highest variance
    console.log("\n[test] Variance Attribution:");
    const components = [
      { name: "Step Call", stats: calculateStats(allStepCallOverheads) },
      { name: "Step Return", stats: calculateStats(allStepReturnOverheads) },
      { name: "Inter-Step", stats: calculateStats(allInterStepOverheads) },
    ].filter(c => c.stats.count > 0);

    const sortedByVariance = components.sort(
      (a, b) => b.stats.p95 / b.stats.median - a.stats.p95 / a.stats.median
    );

    for (const c of sortedByVariance) {
      const ratio = c.stats.p95 / c.stats.median;
      console.log(`  ${c.name}: P95/Median = ${ratio.toFixed(2)}x`);
    }

    if (sortedByVariance.length > 0) {
      const highest = sortedByVariance[0];
      console.log(`\n[test] Highest variance component: ${highest.name}`);
      console.log(`  This is the primary source of P95 outliers`);
    }
  });

  it("should establish distribution baseline with high sample count", async () => {
    console.log("\n[test] Collecting large sample for distribution analysis");
    console.log("[test] Running 10 workflows x 20 steps each = 200 samples");

    const allStepTimes: number[] = [];
    const workflowCount = 10;
    const stepsPerWorkflow = 20;

    for (let w = 0; w < workflowCount; w++) {
      console.log(`[test] Workflow ${w + 1}/${workflowCount}...`);

      const workflowId = await client.mutation(api.testWorkflows.startMinimalOverheadWorkflow, {
        steps: stepsPerWorkflow,
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
        if (status.type === "failed") {
          throw new Error(`Workflow ${w + 1} failed: ${JSON.stringify(status)}`);
        }

        await sleep(1000);
      }

      if (result) {
        allStepTimes.push(...result.stepTimes);
      }
    }

    expect(allStepTimes.length).toBeGreaterThan(100);

    const stats = calculateStats(allStepTimes);
    logStats("Large sample distribution", stats);

    // Distribution histogram
    console.log("\n[test] Distribution Histogram (100ms buckets):");
    const buckets: { [key: string]: number } = {};
    for (const t of allStepTimes) {
      const bucket = Math.floor(t / 100) * 100;
      const label = `${bucket}-${bucket + 99}ms`;
      buckets[label] = (buckets[label] || 0) + 1;
    }

    const sortedBuckets = Object.entries(buckets)
      .sort((a, b) => parseInt(a[0]) - parseInt(b[0]));

    for (const [label, count] of sortedBuckets) {
      const pct = ((count / allStepTimes.length) * 100).toFixed(1);
      const bar = "█".repeat(Math.ceil(count / 5));
      console.log(`  ${label.padEnd(12)} | ${count.toString().padStart(3)} (${pct.padStart(5)}%) ${bar}`);
    }

    // Calculate coefficient of variation (CV)
    const cv = stats.stdDev / stats.mean;
    console.log(`\n[test] Coefficient of Variation: ${(cv * 100).toFixed(1)}%`);

    if (cv > 0.5) {
      console.log("[test] HIGH variability (CV > 50%)");
    } else if (cv > 0.25) {
      console.log("[test] MODERATE variability (CV 25-50%)");
    } else {
      console.log("[test] LOW variability (CV < 25%)");
    }
  });
});
