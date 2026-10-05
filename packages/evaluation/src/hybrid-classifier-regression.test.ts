import { test } from "node:test";
import assert from "node:assert/strict";
import { isNearDuplicate } from "@brain/retrieval";
import { REGRESSION_PAIRS, HARD_CASES, type RegressionPair } from "./hybrid-classifier-regression.data.js";

/**
 * 2C.7. Reproduces Phase 2C.6's offline Hybrid C evaluation (zero false
 * positives across 99 real pairs, all four hard cases correct) against the
 * REAL production classifier -- not a reimplementation of it. No embedding
 * model, no network: every similarity here is already-frozen real-model
 * evidence (docs/phase-2c/PHASE_2C2_REPORT.md through PHASE_2C6_REPORT.md), so this
 * runs in the default suite. Content and labels are unchanged from 2C.6.
 */

interface Verdict extends RegressionPair {
  predicted: boolean;
}

function classifyAll(pairs: RegressionPair[]): Verdict[] {
  return pairs.map((pair) => ({
    ...pair,
    predicted: isNearDuplicate({ cosineSimilarity: pair.similarity, contentA: pair.contentA, contentB: pair.contentB }),
  }));
}

test("hybrid classifier: zero false positives across all 99 frozen pairs, in every group", () => {
  const verdicts = classifyAll(REGRESSION_PAIRS);
  const falsePositives = verdicts.filter((v) => v.expectedLabel === "DISTINCT" && v.predicted === true);
  assert.deepEqual(
    falsePositives.map((v) => v.id),
    [],
    "every DISTINCT-labeled pair must classify as distinct",
  );

  for (const group of ["authored", "organic", "control"] as const) {
    const groupFalsePositives = verdicts.filter((v) => v.group === group && v.expectedLabel === "DISTINCT" && v.predicted === true);
    assert.equal(groupFalsePositives.length, 0, `group "${group}" must have zero false positives`);
  }
});

test("hybrid classifier: reproduces Phase 2C.6 Hybrid C's exact detections (same TP count per group)", () => {
  const verdicts = classifyAll(REGRESSION_PAIRS);
  const truePositivesByGroup = (group: string) =>
    verdicts.filter((v) => v.group === group && v.expectedLabel === "NEAR_DUPLICATE" && v.predicted === true).length;

  // Exact counts from docs/phase-2c/PHASE_2C6_REPORT.md's Hybrid C row: authored 33/36,
  // organic 2/4, control 0/1 (2C.4 A~C's cosine never reaches the candidate
  // floor, correctly unrecoverable by this rule -- see that report's CONTROL
  // RESULT section).
  assert.equal(truePositivesByGroup("authored"), 33);
  assert.equal(truePositivesByGroup("organic"), 2);
  assert.equal(truePositivesByGroup("control"), 0);
});

test("hybrid classifier: all four required hard cases retain their Phase 2C.6 verdict", () => {
  const byId = new Map(classifyAll(REGRESSION_PAIRS).map((v) => [v.id, v]));
  for (const id of HARD_CASES) {
    const verdict = byId.get(id);
    assert.ok(verdict, `hard case "${id}" must exist in the frozen dataset`);
    const expected = verdict.expectedLabel === "NEAR_DUPLICATE";
    assert.equal(verdict.predicted, expected, `hard case "${id}": expected ${verdict.expectedLabel}, classifier said ${verdict.predicted ? "NEAR_DUPLICATE" : "DISTINCT"}`);
  }
});

test("hybrid classifier: dataset shape matches Phase 2C.6 exactly (71 authored, 24 organic, 4 control)", () => {
  const counts = { authored: 0, organic: 0, control: 0 };
  for (const pair of REGRESSION_PAIRS) counts[pair.group]++;
  assert.deepEqual(counts, { authored: 71, organic: 24, control: 4 });
});
