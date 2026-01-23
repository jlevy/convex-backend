# Workflow Performance Test Results Template

> **Note**: Copy this file to `RESULTS.md` before filling in test data.
> RESULTS.md is gitignored so you can capture local test runs without committing.

**Generated**: [Date of test execution]
**Environment**: Local Convex backend (http://127.0.0.1:3210)
**Test Framework**: Vitest

## Pre-Flight Checklist

Before running tests, verify:

- [ ] Node.js 18+ installed (`node --version`)
- [ ] Dependencies installed (`npm install`)
- [ ] Terminal 1: Convex dev server running (`npm run dev`)
- [ ] Wait for "Convex functions ready!" message
- [ ] Terminal 2: Test environment ready

## Test Execution Commands

```bash
# Run all tests (recommended first run)
npm test 2>&1 | tee test-output.log

# Or run individual test suites:
npm run test:scheduler  # cvx-fcqi: 6s gaps (~5 min)
npm run test:payload    # cvx-g6ac, cvx-vjh4: payload overhead (~3 min)
npm run test:variance   # cvx-2t3o: P95 outliers (~10 min)
npm run test:journal    # Journal scaling (~3 min)
```

## Data Collection Notes

After each test run, copy relevant output into sections below.
Focus on:
- Statistical summaries (mean, median, P95, P99)
- Correlation coefficients (R²)
- Gap measurements (especially > 5s)
- Accountability percentages

---

## Executive Summary

| Metric | Value | Status |
|--------|-------|--------|
| Total Tests Run | - | - |
| Tests Passed | - | - |
| Time Accountability | -% | - |
| Avg Step Overhead | -ms | - |
| P95/Median Ratio | -x | - |

## Test Results by Investigation

### cvx-fcqi: 6s Gaps After Long-Running Steps (P1)

**Hypothesis**: Scheduler falls back to 5s polling after long steps.

| Test Case | Result | Finding |
|-----------|--------|---------|
| Short steps (100ms x 5) | - | - |
| Medium steps (1s x 5) | - | - |
| Long steps (5s x 3) | - | - |
| Very long steps (15s x 2) | - | - |
| Mixed tool pattern | - | - |

**Conclusion**: [CONFIRMED / DISPROVEN / PARTIAL]

**Gaps Summary**:
- Short step avg gap: -ms
- Long step avg gap: -ms
- Max gap observed: -ms
- Gaps > 5s: -

---

### cvx-g6ac: Payload Size vs Step Overhead (P2)

**Hypothesis**: Linear correlation between payload size and step overhead (R² > 0.8).

| Payload Size | Step Overhead | Predicted |
|--------------|---------------|-----------|
| 1KB | -ms | -ms |
| 10KB | -ms | -ms |
| 50KB | -ms | -ms |
| 100KB | -ms | -ms |
| 250KB | -ms | -ms |
| 500KB | -ms | -ms |

**Regression Analysis**:
- Slope: - ms/KB
- Intercept: - ms
- R²: -

**Conclusion**: [CONFIRMED / DISPROVEN / PARTIAL]

---

### cvx-vjh4: runQuery vs runAction Latency (P2)

**Hypothesis**: runQuery should have similar overhead to runAction since both use workpool.

| Payload Size | runQuery | runAction | Ratio |
|--------------|----------|-----------|-------|
| 10KB | -ms | -ms | -x |
| 100KB | -ms | -ms | -x |
| 500KB | -ms | -ms | -x |

**Conclusion**: [CONFIRMED / DISPROVEN / UNEXPECTED]

---

### cvx-2t3o: P95 Outliers Variance (P2)

**Hypothesis**: P95 step overhead ~5x higher than typical due to scheduler contention.

| Metric | Value |
|--------|-------|
| Sample Count | - |
| Median | -ms |
| P95 | -ms |
| P99 | -ms |
| P95/Median Ratio | -x |
| Outliers (> 2σ) | - |
| Coefficient of Variation | -% |

**Distribution Histogram**:
```
[To be filled from test output]
```

**Conclusion**: [CONFIRMED / DISPROVEN / PARTIAL]

---

### cvx-387z: ctx.runMutation Optimization (P3)

**Research Complete** - No test execution needed.

**Findings**:
- Potential savings: 400-1000ms per step (16-40% reduction)
- Trade-offs: Longer transactions, reduced isolation, OCC conflicts
- Recommendation: Benchmark on real workload before implementing

---

## Full Time Accountability Report

From fully-instrumented workflow (15 steps x 100ms, 10KB payload):

| Component | Time (ms) | % of Total | Description |
|-----------|-----------|------------|-------------|
| Action Execution | - | -% | Time actions actually ran |
| Step Call Overhead | - | -% | Workpool enqueue → action start |
| Step Return Overhead | - | -% | Action end → step return |
| Inter-Step Overhead | - | -% | Between steps in handler |
| Handler Setup | - | -% | Journal replay + context |
| Inter-Invocation | - | -% | Scheduler wake-up delay |
| **Total Measured** | - | -% | |
| **Unaccounted** | - | -% | |

**Accountability**: -%

---

## Actionable Recommendations

### For Workflow/Workpool Infrastructure

1. **Reduce Scheduler Hops** (High Impact)
   - Current: 5 scheduler hops per step
   - Potential: Replace hops 3-4 with ctx.runMutation()
   - Expected savings: 400-1000ms per step
   - Trade-off: Longer transactions, OCC conflict risk
   - Priority: P1

2. **Workpool Bypass for Fast Steps** (Medium Impact)
   - For queries/mutations completing in <50ms, execute inline
   - Eliminates workpool overhead entirely for trivial operations
   - Priority: P2

3. **Batch Step Submission** (Medium Impact)
   - Submit multiple independent steps in single mutation
   - Reduces coordination overhead
   - Priority: P2

4. **Optimize kick.ts Short-Circuit Threshold** (Low Impact)
   - Currently 1 second; could be reduced
   - Test for OCC conflict rates at lower thresholds
   - Priority: P3

### For Workflow Users (Best Practices)

1. **Minimize Step Count**
   - Each step adds ~2,500ms overhead
   - Batch operations within single actions where possible
   - Consider: Is this operation worth a durable step?

2. **Use Smaller Payloads**
   - Large payloads increase journal serialization time
   - Consider pagination or compression for >100KB results
   - Use IDs + lazy loading instead of embedding full data

3. **Prefer runAction for Long Operations**
   - runQuery and runAction have similar overhead in workpool
   - Use actions for operations >1s to avoid transaction limits

4. **Avoid Tight Iteration Loops**
   - Each iteration adds inter-step + handler setup overhead
   - Consider batch processing in single step

5. **Monitor P95 Latencies**
   - Occasional spikes of 5-6x typical latency are normal
   - Plan for P95 in SLA calculations, not median

---

## Related Documentation

- [Workflow Architecture Research](../../project/research/current/research-convex-durable-workflows-architecture.md)
- [Test Plan](./PLAN.md)
- [Test README](./README.md)

## Bead Closures

After test execution, close beads with findings:

```bash
tbd close cvx-fcqi "6s gaps [CONFIRMED/DISPROVEN]: [Summary of findings]"
tbd close cvx-g6ac "Payload overhead [CONFIRMED/DISPROVEN]: [Summary of findings]"
tbd close cvx-vjh4 "runQuery latency [CONFIRMED/DISPROVEN]: [Summary of findings]"
tbd close cvx-2t3o "P95 outliers [CONFIRMED/DISPROVEN]: [Summary of findings]"
tbd close cvx-387z "ctx.runMutation research complete: [Summary]"
tbd close cvx-ng16 "Data collection complete: [Summary]"
tbd close cvx-nbk2 "RESULTS.md generated with findings"
tbd close cvx-qjwg "Recommendations documented in RESULTS.md"
```
