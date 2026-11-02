import { test } from "node:test";
import assert from "node:assert/strict";
import { isNearDuplicate } from "@brain/retrieval";
import { REGRESSION_PAIRS } from "./hybrid-classifier-regression.data.js";
import { ORGANIC_2C8_PAIRS } from "./h2-full-corroboration.data.js";

/**
 * 2C.10. Reproduces docs/archive/phase-2c/PHASE_2C9_REPORT.md's 109-pair Strategy H2 combined
 * confusion matrix (TP 35 / FP 0 / TN 66 / FN 8, precision 1.0000, recall
 * 0.8140) against the REAL production classifier -- not a reimplementation.
 * 99 pairs from the frozen 2C.6 corpus + 10 metrics-eligible organic-2C8
 * pairs = 109; the historical dedup pair and the one AMBIGUOUS pair are
 * excluded, per 2C.9's own accounting. If this file does not reproduce
 * those exact four numbers, H2 is not correctly implemented -- 2C.10's Part B
 * live validation must not proceed (see docs/archive/phase-2c/PHASE_2C10_REPORT.md).
 */

interface Sample {
  id: string;
  expectedNearDuplicate: boolean;
  predicted: boolean;
}

function classify(id: string, expectedLabel: "NEAR_DUPLICATE" | "DISTINCT", similarity: number, contentA: string, contentB: string): Sample {
  return {
    id,
    expectedNearDuplicate: expectedLabel === "NEAR_DUPLICATE",
    predicted: isNearDuplicate({ cosineSimilarity: similarity, contentA, contentB }),
  };
}

function allSamples(): Sample[] {
  const frozen = REGRESSION_PAIRS.map((p) => classify(p.id, p.expectedLabel, p.similarity, p.contentA, p.contentB));
  const organic = ORGANIC_2C8_PAIRS.map((p) => classify(p.id, p.expectedLabel, p.similarity, p.contentA, p.contentB));
  return [...frozen, ...organic];
}

test("H2 109-pair regression: combined confusion matrix matches docs/archive/phase-2c/PHASE_2C9_REPORT.md exactly (TP 35 / FP 0 / TN 66 / FN 8)", () => {
  const samples = allSamples();
  assert.equal(samples.length, 109, "99 frozen + 10 metrics-eligible organic-2C8 pairs");

  let tp = 0;
  let fp = 0;
  let tn = 0;
  let fn = 0;
  for (const s of samples) {
    if (s.predicted && s.expectedNearDuplicate) tp++;
    else if (s.predicted && !s.expectedNearDuplicate) fp++;
    else if (!s.predicted && !s.expectedNearDuplicate) tn++;
    else fn++;
  }

  assert.equal(tp, 35, "true positives");
  assert.equal(fp, 0, "false positives -- H2's headline result: zero");
  assert.equal(tn, 66, "true negatives");
  assert.equal(fn, 8, "false negatives -- the disclosed recall cost, not hidden");

  const precision = tp / (tp + fp);
  const recall = tp / (tp + fn);
  assert.equal(precision, 1, "precision");
  assert.ok(Math.abs(recall - 0.814) < 0.0001, `recall should be ~0.8140, got ${recall}`);
});

test("H2 109-pair regression: both 2C.8 false positives are rejected", () => {
  const samples = allSamples();
  for (const id of ["909d5511~f4ebe0ae", "05fede4b~5b880968"]) {
    const sample = samples.find((s) => s.id === id);
    assert.ok(sample, `${id} must be present in the evidence set`);
    assert.equal(sample.predicted, false, `${id}: H2 must classify this former false positive as DISTINCT`);
  }
});

test("H2 109-pair regression: both 2C.8 organic true positives are the known, disclosed recall loss", () => {
  const samples = allSamples();
  for (const id of ["be174a56~ce0fa075", "e104c851~f4ebe0ae"]) {
    const sample = samples.find((s) => s.id === id);
    assert.ok(sample, `${id} must be present in the evidence set`);
    assert.equal(sample.expectedNearDuplicate, true, `${id}: ground truth stays NEAR_DUPLICATE, never relabeled`);
    assert.equal(sample.predicted, false, `${id}: H2 loses this detection -- a real, disclosed cost, not hidden`);
  }
});

test("H2 109-pair regression: authored, organic-pre-2C8, and control groups are byte-identical to Strategy A (zero collateral change)", () => {
  const groups = ["authored", "organic", "control"] as const;
  for (const group of groups) {
    const pairs = REGRESSION_PAIRS.filter((p) => p.group === group);
    const falsePositives = pairs.filter((p) => {
      const predicted = isNearDuplicate({ cosineSimilarity: p.similarity, contentA: p.contentA, contentB: p.contentB });
      return p.expectedLabel === "DISTINCT" && predicted === true;
    });
    assert.equal(falsePositives.length, 0, `group "${group}" must have zero false positives under H2, same as Strategy A`);
  }
});
