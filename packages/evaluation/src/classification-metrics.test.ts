import { test } from "node:test";
import assert from "node:assert/strict";
import { cosineSimilarity, distributionStats, classificationMetrics, sweepThresholds } from "./classification-metrics.js";

function assertClose(actual: number, expected: number, tolerance = 1e-9): void {
  assert.ok(Math.abs(actual - expected) < tolerance, `expected ${actual} to be within ${tolerance} of ${expected}`);
}

test("cosineSimilarity: identical vectors score 1", () => {
  assertClose(cosineSimilarity([1, 2, 3], [1, 2, 3]), 1);
});

test("cosineSimilarity: orthogonal vectors score 0", () => {
  assertClose(cosineSimilarity([1, 0], [0, 1]), 0);
});

test("cosineSimilarity: opposite vectors score -1", () => {
  // Floating-point dot/magnitude arithmetic, not exact -1 -- assert within tolerance, not strict equality.
  assertClose(cosineSimilarity([1, 2], [-1, -2]), -1);
});

test("distributionStats: empty input returns nulls, count 0", () => {
  assert.deepEqual(distributionStats([]), { count: 0, min: null, max: null, mean: null, median: null });
});

test("distributionStats: even-length input", () => {
  const stats = distributionStats([4, 1, 3, 2]);
  assert.deepEqual(stats, { count: 4, min: 1, max: 4, mean: 2.5, median: 2.5 });
});

test("distributionStats: odd-length input", () => {
  const stats = distributionStats([5, 1, 3]);
  assert.deepEqual(stats, { count: 3, min: 1, max: 5, mean: 3, median: 3 });
});

test("classificationMetrics: hand-built confusion matrix at a fixed threshold", () => {
  const samples = [
    { similarity: 0.9, expectedLabel: "redundant" as const }, // TP
    { similarity: 0.8, expectedLabel: "distinct" as const }, // FP
    { similarity: 0.4, expectedLabel: "distinct" as const }, // TN
    { similarity: 0.3, expectedLabel: "redundant" as const }, // FN
  ];
  const m = classificationMetrics(samples, 0.75);
  assert.equal(m.tp, 1);
  assert.equal(m.fp, 1);
  assert.equal(m.tn, 1);
  assert.equal(m.fn, 1);
  assert.equal(m.precision, 0.5);
  assert.equal(m.recall, 0.5);
  assert.equal(m.f1, 0.5);
  assert.equal(m.falsePositiveRate, 0.5);
  assert.equal(m.falseNegativeRate, 0.5);
});

test("classificationMetrics: threshold boundary is inclusive (similarity === threshold predicts redundant)", () => {
  const m = classificationMetrics([{ similarity: 0.75, expectedLabel: "redundant" }], 0.75);
  assert.equal(m.tp, 1);
  assert.equal(m.fn, 0);
});

test("classificationMetrics: no predicted-redundant items yields null precision, not a fabricated 0 or 1", () => {
  const m = classificationMetrics([{ similarity: 0.1, expectedLabel: "distinct" }], 0.75);
  assert.equal(m.precision, null);
  assert.equal(m.recall, null);
});

test("sweepThresholds: one row per threshold, in the order given", () => {
  const samples = [
    { similarity: 0.9, expectedLabel: "redundant" as const },
    { similarity: 0.2, expectedLabel: "distinct" as const },
  ];
  const rows = sweepThresholds(samples, [0.5, 0.6, 0.95]);
  assert.deepEqual(
    rows.map((r) => r.threshold),
    [0.5, 0.6, 0.95],
  );
  assert.equal(rows[0]?.tp, 1);
  assert.equal(rows[2]?.tp, 0); // 0.9 < 0.95, no longer predicted redundant
});
