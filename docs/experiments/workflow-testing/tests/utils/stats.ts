/**
 * Statistical analysis utilities for workflow performance testing.
 */

export interface Stats {
  count: number;
  mean: number;
  median: number;
  min: number;
  max: number;
  stdDev: number;
  p95: number;
  p99: number;
  outliers: number[];
}

/**
 * Calculates comprehensive statistics for a set of numeric values.
 */
export function calculateStats(values: number[]): Stats {
  if (values.length === 0) {
    return {
      count: 0,
      mean: 0,
      median: 0,
      min: 0,
      max: 0,
      stdDev: 0,
      p95: 0,
      p99: 0,
      outliers: [],
    };
  }

  const sorted = [...values].sort((a, b) => a - b);
  const count = sorted.length;
  const sum = sorted.reduce((a, b) => a + b, 0);
  const mean = sum / count;

  // Median
  const median =
    count % 2 === 0
      ? (sorted[count / 2 - 1] + sorted[count / 2]) / 2
      : sorted[Math.floor(count / 2)];

  // Standard deviation
  const squaredDiffs = sorted.map((v) => Math.pow(v - mean, 2));
  const avgSquaredDiff = squaredDiffs.reduce((a, b) => a + b, 0) / count;
  const stdDev = Math.sqrt(avgSquaredDiff);

  // Percentiles
  const p95 = percentile(sorted, 95);
  const p99 = percentile(sorted, 99);

  // Outliers (values > 2 standard deviations from mean)
  const outlierThreshold = 2 * stdDev;
  const outliers = sorted.filter((v) => Math.abs(v - mean) > outlierThreshold);

  return {
    count,
    mean,
    median,
    min: sorted[0],
    max: sorted[count - 1],
    stdDev,
    p95,
    p99,
    outliers,
  };
}

/**
 * Calculates the nth percentile of a sorted array.
 */
function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  if (sorted.length === 1) return sorted[0];

  const index = (p / 100) * (sorted.length - 1);
  const lower = Math.floor(index);
  const upper = Math.ceil(index);
  const weight = index - lower;

  if (lower === upper) {
    return sorted[lower];
  }

  return sorted[lower] * (1 - weight) + sorted[upper] * weight;
}

/**
 * Formats statistics as a human-readable string.
 */
export function formatStats(stats: Stats, unit = "ms"): string {
  return [
    `n=${stats.count}`,
    `mean=${stats.mean.toFixed(2)}${unit}`,
    `median=${stats.median.toFixed(2)}${unit}`,
    `min=${stats.min.toFixed(2)}${unit}`,
    `max=${stats.max.toFixed(2)}${unit}`,
    `stdDev=${stats.stdDev.toFixed(2)}${unit}`,
    `p95=${stats.p95.toFixed(2)}${unit}`,
    `p99=${stats.p99.toFixed(2)}${unit}`,
    `outliers=${stats.outliers.length}`,
  ].join(", ");
}

/**
 * Calculates linear regression for x,y data points.
 * Returns slope, intercept, and R² correlation coefficient.
 */
export function linearRegression(
  points: Array<{ x: number; y: number }>
): { slope: number; intercept: number; rSquared: number } {
  if (points.length < 2) {
    return { slope: 0, intercept: 0, rSquared: 0 };
  }

  const n = points.length;
  const sumX = points.reduce((a, p) => a + p.x, 0);
  const sumY = points.reduce((a, p) => a + p.y, 0);
  const sumXY = points.reduce((a, p) => a + p.x * p.y, 0);
  const sumXX = points.reduce((a, p) => a + p.x * p.x, 0);
  const sumYY = points.reduce((a, p) => a + p.y * p.y, 0);

  const slope = (n * sumXY - sumX * sumY) / (n * sumXX - sumX * sumX);
  const intercept = (sumY - slope * sumX) / n;

  // R² calculation
  const meanY = sumY / n;
  const ssTotal = points.reduce((a, p) => a + Math.pow(p.y - meanY, 2), 0);
  const ssResidual = points.reduce(
    (a, p) => a + Math.pow(p.y - (slope * p.x + intercept), 2),
    0
  );
  const rSquared = ssTotal === 0 ? 0 : 1 - ssResidual / ssTotal;

  return { slope, intercept, rSquared };
}

/**
 * Determines if there's a significant correlation between two variables.
 */
export function hasSignificantCorrelation(
  rSquared: number,
  threshold = 0.5
): boolean {
  return rSquared >= threshold;
}

/**
 * Logs statistics to console in a clean format.
 */
export function logStats(label: string, stats: Stats): void {
  console.log(`[stats] ${label}:`);
  console.log(`  count:   ${stats.count}`);
  console.log(`  mean:    ${stats.mean.toFixed(2)}ms`);
  console.log(`  median:  ${stats.median.toFixed(2)}ms`);
  console.log(`  min/max: ${stats.min.toFixed(2)}ms / ${stats.max.toFixed(2)}ms`);
  console.log(`  stdDev:  ${stats.stdDev.toFixed(2)}ms`);
  console.log(`  p95/p99: ${stats.p95.toFixed(2)}ms / ${stats.p99.toFixed(2)}ms`);
  if (stats.outliers.length > 0) {
    console.log(`  outliers: ${stats.outliers.length} values`);
  }
}
