import { test } from "node:test";
import assert from "node:assert/strict";
import { computeEfficiencyMetrics, type DeliveredItemMeasurement } from "./efficiency.js";

function item(label: DeliveredItemMeasurement["label"], tokenCount: number | null = 10): DeliveredItemMeasurement {
  return { memoryId: `mem-${Math.random()}`, tokenCount, label };
}

test("contextEfficiency: useful tokens over total delivered tokens", () => {
  const result = computeEfficiencyMetrics({
    delivered: [item("useful", 10), item("useful", 20), item("not_useful", 30)],
    candidateTokenCount: 200,
  });
  assert.equal(result.contextEfficiency, 30 / 60);
});

test("redundantRatio: redundant tokens over total delivered tokens, distinct from useful", () => {
  const result = computeEfficiencyMetrics({
    delivered: [item("useful", 10), item("redundant", 10), item("redundant", 20)],
    candidateTokenCount: 100,
  });
  assert.equal(result.redundantRatio, 30 / 40);
  assert.equal(result.contextEfficiency, 10 / 40);
});

test("retrievalEfficiency: delivered tokens over candidate-pool tokens", () => {
  const result = computeEfficiencyMetrics({ delivered: [item("useful", 50)], candidateTokenCount: 200 });
  assert.equal(result.retrievalEfficiency, 50 / 200);
});

test("labeledFraction: unlabeled items count toward deliveredItems but not labeledDeliveredItems", () => {
  const result = computeEfficiencyMetrics({
    delivered: [item("useful"), item("not_useful"), item("redundant"), item("unlabeled")],
    candidateTokenCount: 100,
  });
  assert.equal(result.deliveredItems, 4);
  assert.equal(result.labeledDeliveredItems, 3);
  assert.equal(result.labeledFraction, 0.75);
});

test("zero delivered items: every ratio is null (unavailable), never a fabricated zero", () => {
  const result = computeEfficiencyMetrics({ delivered: [], candidateTokenCount: 100 });
  assert.equal(result.contextEfficiency, null);
  assert.equal(result.redundantRatio, null);
  assert.equal(result.labeledFraction, null);
  assert.equal(result.deliveredTokens, null);
});

test("zero or missing candidateTokenCount: retrievalEfficiency is null, other ratios unaffected", () => {
  const result = computeEfficiencyMetrics({ delivered: [item("useful", 10)], candidateTokenCount: 0 });
  assert.equal(result.retrievalEfficiency, null);
  assert.equal(result.contextEfficiency, 1);

  const resultNull = computeEfficiencyMetrics({ delivered: [item("useful", 10)], candidateTokenCount: null });
  assert.equal(resultNull.retrievalEfficiency, null);
});

test("any delivered item with tokenCount null makes deliveredTokens/contextEfficiency/redundantRatio unavailable -- partial sums are not fabricated", () => {
  const result = computeEfficiencyMetrics({ delivered: [item("useful", 10), item("useful", null)], candidateTokenCount: 100 });
  assert.equal(result.deliveredTokens, null);
  assert.equal(result.contextEfficiency, null);
  assert.equal(result.redundantRatio, null);
  // labeledFraction does not depend on token measurement and stays computable
  assert.equal(result.labeledFraction, 1);
});

test("100% labeledFraction is required before a ratio may be read as a completeness claim (documented, not enforced by the type) -- sanity check the numbers compose correctly at labeledFraction 1.0", () => {
  const result = computeEfficiencyMetrics({ delivered: [item("useful", 40), item("not_useful", 60)], candidateTokenCount: 500 });
  assert.equal(result.labeledFraction, 1);
  assert.equal(result.contextEfficiency, 0.4);
});
