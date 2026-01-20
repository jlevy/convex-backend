/**
 * Report Generator
 *
 * Generates RESULTS.md from test run data stored in Convex.
 */

import { ConvexHttpClient } from "convex/browser";
import { api } from "../convex/_generated/api";
import { writeFileSync } from "fs";
import { join } from "path";

const CONVEX_URL = process.env.CONVEX_URL || "http://127.0.0.1:3210";

interface Stats {
  count: number;
  mean: number;
  median: number;
  min: number;
  max: number;
  stdDev: number;
  p95: number;
  p99: number;
}

function calculateStats(values: number[]): Stats {
  if (values.length === 0) {
    return { count: 0, mean: 0, median: 0, min: 0, max: 0, stdDev: 0, p95: 0, p99: 0 };
  }

  const sorted = [...values].sort((a, b) => a - b);
  const count = sorted.length;
  const sum = sorted.reduce((a, b) => a + b, 0);
  const mean = sum / count;

  const median =
    count % 2 === 0
      ? (sorted[count / 2 - 1] + sorted[count / 2]) / 2
      : sorted[Math.floor(count / 2)];

  const squaredDiffs = sorted.map((v) => Math.pow(v - mean, 2));
  const avgSquaredDiff = squaredDiffs.reduce((a, b) => a + b, 0) / count;
  const stdDev = Math.sqrt(avgSquaredDiff);

  const p95Index = Math.floor(0.95 * (count - 1));
  const p99Index = Math.floor(0.99 * (count - 1));

  return {
    count,
    mean,
    median,
    min: sorted[0],
    max: sorted[count - 1],
    stdDev,
    p95: sorted[p95Index],
    p99: sorted[p99Index],
  };
}

async function main() {
  console.log("[report] Generating results report...");
  console.log(`[report] Connecting to Convex at ${CONVEX_URL}`);

  const client = new ConvexHttpClient(CONVEX_URL);

  // Fetch completed test runs
  const testRuns = await client.query(api.testQueries.listTestRuns, {
    status: "completed",
  });

  if (testRuns.length === 0) {
    console.log("[report] No completed test runs found. Run tests first.");
    process.exit(1);
  }

  console.log(`[report] Found ${testRuns.length} completed test runs`);

  // Generate report
  const lines: string[] = [
    "# Workflow Testing Results",
    "",
    `**Generated**: ${new Date().toISOString()}`,
    `**Test Runs**: ${testRuns.length}`,
    "",
    "## Summary",
    "",
  ];

  // Group by test name
  const byTestName = new Map<string, typeof testRuns>();
  for (const run of testRuns) {
    const existing = byTestName.get(run.testName) || [];
    existing.push(run);
    byTestName.set(run.testName, existing);
  }

  for (const [testName, runs] of byTestName) {
    lines.push(`### ${testName}`);
    lines.push("");
    lines.push(`- Runs: ${runs.length}`);

    // Fetch measurements for each run
    for (const run of runs) {
      const measurements = await client.query(api.testQueries.getMeasurements, {
        testRunId: run._id,
      });

      if (measurements.length > 0) {
        // Group measurements by metric
        const byMetric = new Map<string, number[]>();
        for (const m of measurements) {
          const existing = byMetric.get(m.metricName) || [];
          existing.push(m.value);
          byMetric.set(m.metricName, existing);
        }

        lines.push("- Metrics:");
        for (const [metricName, values] of byMetric) {
          const stats = calculateStats(values);
          lines.push(
            `  - ${metricName}: mean=${stats.mean.toFixed(2)}${measurements[0].unit}, ` +
              `median=${stats.median.toFixed(2)}${measurements[0].unit}, ` +
              `n=${stats.count}`
          );
        }
      }
    }

    lines.push("");
  }

  // Add interpretation section
  lines.push("## Findings");
  lines.push("");
  lines.push("### Scheduler Wake-up (cvx-pznt)");
  lines.push("");
  lines.push("*Run the scheduler tests and analyze the output for gap patterns.*");
  lines.push("");
  lines.push("### Payload Overhead (cvx-6c37, cvx-w816)");
  lines.push("");
  lines.push("*Run the payload tests and check the correlation analysis.*");
  lines.push("");
  lines.push("### Journal Scaling");
  lines.push("");
  lines.push("*Run the journal tests and verify O(N) scaling hypothesis.*");
  lines.push("");
  lines.push("## Recommendations");
  lines.push("");
  lines.push("Based on the test results, consider:");
  lines.push("");
  lines.push("1. **For scheduler wake-up issues**: Check if long-running steps correlate with gaps > 5s");
  lines.push("2. **For payload overhead**: If R² > 0.8, consider limiting step result sizes");
  lines.push("3. **For journal scaling**: For workflows with many steps, consider splitting into sub-workflows");
  lines.push("");
  lines.push("## Raw Data");
  lines.push("");
  lines.push("Test run data is stored in the Convex database:");
  lines.push("");
  lines.push("- `testRuns` table: Test execution records");
  lines.push("- `measurements` table: Individual timing measurements");
  lines.push("- `testCounters` table: Counter data from journal scaling tests");
  lines.push("");

  // Write report
  const reportPath = join(process.cwd(), "RESULTS.md");
  writeFileSync(reportPath, lines.join("\n"));

  console.log(`[report] Report written to ${reportPath}`);
}

main().catch((error) => {
  console.error("[report] Error:", error);
  process.exit(1);
});
