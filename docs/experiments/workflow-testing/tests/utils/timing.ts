/**
 * Precision timing utilities for workflow performance testing.
 */

/**
 * Returns a high-precision timestamp in milliseconds.
 * Uses performance.now() when available, falls back to Date.now().
 */
export function getTimestamp(): number {
  if (typeof performance !== "undefined" && performance.now) {
    return performance.now();
  }
  return Date.now();
}

/**
 * Measures the execution time of an async function.
 */
export async function measureAsync<T>(
  fn: () => Promise<T>
): Promise<{ result: T; durationMs: number }> {
  const start = getTimestamp();
  const result = await fn();
  const durationMs = getTimestamp() - start;
  return { result, durationMs };
}

/**
 * Creates a timer that can be started and stopped multiple times.
 */
export function createTimer() {
  let startTime: number | null = null;
  let accumulated = 0;

  return {
    start() {
      if (startTime === null) {
        startTime = getTimestamp();
      }
    },
    stop() {
      if (startTime !== null) {
        accumulated += getTimestamp() - startTime;
        startTime = null;
      }
    },
    reset() {
      startTime = null;
      accumulated = 0;
    },
    getElapsed(): number {
      if (startTime !== null) {
        return accumulated + (getTimestamp() - startTime);
      }
      return accumulated;
    },
  };
}

/**
 * Waits for a specified duration in milliseconds.
 */
export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Polls a condition until it returns true or times out.
 */
export async function waitFor(
  condition: () => Promise<boolean> | boolean,
  options: { timeoutMs?: number; intervalMs?: number } = {}
): Promise<void> {
  const { timeoutMs = 30000, intervalMs = 100 } = options;
  const start = getTimestamp();

  while (getTimestamp() - start < timeoutMs) {
    if (await condition()) {
      return;
    }
    await sleep(intervalMs);
  }

  throw new Error(`waitFor timed out after ${timeoutMs}ms`);
}

/**
 * Logs a timing message with timestamp.
 */
export function logTiming(label: string, durationMs: number): void {
  console.log(`[timing] ${label}: ${durationMs.toFixed(2)}ms`);
}
