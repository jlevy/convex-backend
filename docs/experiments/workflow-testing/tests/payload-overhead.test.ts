/**
 * Payload Overhead Tests
 *
 * Measures the relationship between step result payload size
 * and step overhead, particularly through step.runQuery().
 *
 * Related beads: cvx-g6ac, cvx-vjh4
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { ConvexHttpClient } from "convex/browser";
import { api } from "../convex/_generated/api";
import { calculateStats, logStats, linearRegression } from "./utils/stats";
import { sleep } from "./utils/timing";

const CONVEX_URL = process.env.CONVEX_URL || "http://127.0.0.1:3210";

describe("payload overhead", () => {
  let client: ConvexHttpClient;

  beforeAll(() => {
    client = new ConvexHttpClient(CONVEX_URL);
    console.log(`[test] Connected to Convex at ${CONVEX_URL}`);
  });

  afterAll(() => {
    // Clean up test data
  });

  it("should measure step.runQuery overhead with small payloads (1KB-10KB)", async () => {
    console.log("\n[test] Testing small payloads (1KB, 5KB, 10KB)");

    const payloadSizes = [1024, 5120, 10240];
    const workflowId = await client.mutation(api.testWorkflows.startVariablePayloadWorkflow, {
      payloadSizes,
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
    expect(result.measurements).toHaveLength(3);

    console.log("[test] Results:");
    for (const m of result.measurements) {
      console.log(`  ${(m.sizeBytes / 1024).toFixed(1)}KB: ${m.elapsedMs}ms`);
    }

    // Verify payloads were returned correctly
    for (const m of result.measurements) {
      expect(m.resultLength).toBe(m.sizeBytes);
    }
  });

  it("should measure step.runQuery overhead with medium payloads (50KB-200KB)", async () => {
    console.log("\n[test] Testing medium payloads (50KB, 100KB, 200KB)");

    const payloadSizes = [51200, 102400, 204800];
    const workflowId = await client.mutation(api.testWorkflows.startVariablePayloadWorkflow, {
      payloadSizes,
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

    console.log("[test] Results:");
    for (const m of result.measurements) {
      console.log(`  ${(m.sizeBytes / 1024).toFixed(0)}KB: ${m.elapsedMs}ms`);
    }
  });

  it("should measure step.runQuery overhead with large payloads (500KB-1MB)", async () => {
    console.log("\n[test] Testing large payloads (500KB, 750KB, 1MB)");

    const payloadSizes = [512000, 768000, 1024000];
    const workflowId = await client.mutation(api.testWorkflows.startVariablePayloadWorkflow, {
      payloadSizes,
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

    console.log("[test] Results:");
    for (const m of result.measurements) {
      console.log(`  ${(m.sizeBytes / 1024).toFixed(0)}KB: ${m.elapsedMs}ms`);
    }
  });

  it("should analyze correlation between payload size and overhead", async () => {
    console.log("\n[test] Running correlation analysis");

    // Run a comprehensive test with many payload sizes
    const payloadSizes = [
      1024,     // 1KB
      10240,    // 10KB
      51200,    // 50KB
      102400,   // 100KB
      256000,   // 250KB
      512000,   // 500KB
      768000,   // 750KB
      1024000,  // 1MB
    ];

    const workflowId = await client.mutation(api.testWorkflows.startVariablePayloadWorkflow, {
      payloadSizes,
    });

    console.log(`[test] Started comprehensive workflow: ${workflowId}`);

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

    // Prepare data for linear regression
    const points = result.measurements.map((m: any) => ({
      x: m.sizeBytes / 1024, // KB
      y: m.elapsedMs,
    }));

    const regression = linearRegression(points);

    console.log("\n[test] Linear Regression Analysis:");
    console.log(`  Slope: ${regression.slope.toFixed(4)} ms/KB`);
    console.log(`  Intercept: ${regression.intercept.toFixed(2)} ms (baseline overhead)`);
    console.log(`  R²: ${regression.rSquared.toFixed(4)}`);

    console.log("\n[test] Data points:");
    console.log("| Size (KB) | Elapsed (ms) | Predicted (ms) | Diff |");
    console.log("|-----------|--------------|----------------|------|");
    for (const p of points) {
      const predicted = regression.slope * p.x + regression.intercept;
      const diff = p.y - predicted;
      console.log(
        `| ${p.x.toFixed(0).padStart(9)} | ${p.y.toFixed(0).padStart(12)} | ${predicted.toFixed(0).padStart(14)} | ${diff.toFixed(0).padStart(4)} |`
      );
    }

    // Interpret results
    console.log("\n[test] Interpretation:");
    if (regression.rSquared > 0.8) {
      console.log("  CONFIRMED: Strong linear correlation between payload size and overhead");
      console.log(`  Each 1KB adds approximately ${regression.slope.toFixed(2)}ms overhead`);
    } else if (regression.rSquared > 0.5) {
      console.log("  PARTIAL: Moderate correlation exists but with significant variance");
    } else if (regression.rSquared > 0.3) {
      console.log("  WEAK: Some correlation but other factors dominate");
    } else {
      console.log("  DISPROVEN: No significant correlation between payload size and overhead");
    }
  });

  it("should establish baseline overhead with minimal payload", async () => {
    console.log("\n[test] Measuring baseline overhead with noop steps");

    const workflowId = await client.mutation(api.testWorkflows.startMinimalOverheadWorkflow, {
      steps: 10,
    });

    console.log(`[test] Started minimal workflow: ${workflowId}`);

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

    const stats = calculateStats(result.stepTimes);
    logStats("Noop step times", stats);

    console.log(`[test] Baseline per-step overhead: ~${stats.median.toFixed(0)}ms (median)`);
  });
});
