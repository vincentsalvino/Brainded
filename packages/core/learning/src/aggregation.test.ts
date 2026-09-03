import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { MemoryPerformanceRaw, LearningConfig } from "@brain/contracts";
import { computeUsefulnessSignal } from "./aggregation.js";

function raw(overrides: Partial<MemoryPerformanceRaw> = {}): MemoryPerformanceRaw {
  return {
    memoryId: randomUUID(),
    scopeKey: "*",
    usefulCount: 0,
    notUsefulCount: 0,
    redundantReasonCount: 0,
    incorrectReasonCount: 0,
    dilutedSuccessEvidence: 0,
    dilutedFailureEvidence: 0,
    successContextCount: 0,
    failureContextCount: 0,
    labeledContextCount: 0,
    lastFeedbackAt: null,
    lastOutcomeAt: null,
    ...overrides,
  };
}

function config(overrides: Partial<LearningConfig> = {}): LearningConfig {
  return { enabled: false, k: 5, outcomeWeight: 0, maxBoost: 0.15, ...overrides };
}

function closeTo(actual: number, expected: number, tolerance = 0.001): void {
  assert.ok(
    Math.abs(actual - expected) < tolerance,
    `expected ${actual} to be within ${tolerance} of ${expected}`,
  );
}

// E5's own worked table (PHASE_2_DECISIONS.md:186-195), reproduced against the shipped formula.

test("zero evidence -> usefulnessSignal exactly 0.5, evidenceMass exactly 0 (cold start, F6)", () => {
  const result = computeUsefulnessSignal(raw(), config());
  assert.equal(result.usefulnessSignal, 0.5);
  assert.equal(result.evidenceMass, 0);
});

test("one useful -> 0.528 (symmetric with one not-useful)", () => {
  const result = computeUsefulnessSignal(raw({ usefulCount: 1 }), config());
  closeTo(result.usefulnessSignal, 0.528);
  assert.equal(result.evidenceMass, 1);
});

test("one not-useful -> 0.472 (a nudge, not a suppression -- E14)", () => {
  const result = computeUsefulnessSignal(raw({ notUsefulCount: 1 }), config());
  closeTo(result.usefulnessSignal, 0.472);
  assert.equal(result.evidenceMass, 1);
});

test("positive/negative symmetry: signal(1 useful) and signal(1 not-useful) are equidistant from 0.5", () => {
  const pos = computeUsefulnessSignal(raw({ usefulCount: 1 }), config()).usefulnessSignal;
  const neg = computeUsefulnessSignal(raw({ notUsefulCount: 1 }), config()).usefulnessSignal;
  closeTo(pos - 0.5, 0.5 - neg);
});

test("mixed evidence: 5 useful / 6 not-useful -> 0.474 (lands just below neutral)", () => {
  const result = computeUsefulnessSignal(raw({ usefulCount: 5, notUsefulCount: 6 }), config());
  closeTo(result.usefulnessSignal, 0.474);
  assert.equal(result.evidenceMass, 11);
});

test("heavy negative evidence: 0 useful / 5 not-useful -> 0.321 (meaningful, still recoverable)", () => {
  const result = computeUsefulnessSignal(raw({ notUsefulCount: 5 }), config());
  closeTo(result.usefulnessSignal, 0.321);
});

test("high-mass convergence: 18 useful / 2 not-useful -> 0.791 (converges toward the true rate)", () => {
  const result = computeUsefulnessSignal(raw({ usefulCount: 18, notUsefulCount: 2 }), config());
  closeTo(result.usefulnessSignal, 0.791);
  assert.equal(result.evidenceMass, 20);
});

test("outcomeWeight=0: diluted outcome evidence contributes nothing to evidenceMass or the signal", () => {
  const row = raw({ dilutedSuccessEvidence: 5, dilutedFailureEvidence: 3 });
  const result = computeUsefulnessSignal(row, config({ outcomeWeight: 0 }));
  assert.equal(result.usefulnessSignal, 0.5);
  assert.equal(result.evidenceMass, 0, "unweighted diluted evidence must not silently count as mass");
});

test("outcomeWeight>0: the SAME stored (unweighted) row now contributes, weighted exactly once", () => {
  const row = raw({ dilutedSuccessEvidence: 1, dilutedFailureEvidence: 0 });
  const result = computeUsefulnessSignal(row, config({ outcomeWeight: 0.15 }));
  // positiveEvidence = 0.15 * 1 = 0.15; matches E12's own worked example almost exactly
  // (PHASE_2_DECISIONS.md:193: "one diluted failure in a 7-item pack ... 0.021 ... nonzero and
  // correctly signed") -- same shape, opposite sign, larger single-context magnitude here.
  assert.ok(result.usefulnessSignal > 0.5, "positive diluted evidence must move the signal up");
  closeTo(result.evidenceMass, 0.15);
});

test("changing outcomeWeight changes the derived signal without the stored row changing at all", () => {
  const row = raw({ dilutedFailureEvidence: 2 });
  const off = computeUsefulnessSignal(row, config({ outcomeWeight: 0 }));
  const on = computeUsefulnessSignal(row, config({ outcomeWeight: 1 }));
  assert.equal(off.usefulnessSignal, 0.5, "row is identical in both calls -- only config differs");
  assert.ok(on.usefulnessSignal < 0.5, "with outcomeWeight=1, the same stored row now moves the signal down");
});

test("redundantReasonCount alone has no effect on the usefulness calculation", () => {
  const withRedundant = computeUsefulnessSignal(raw({ redundantReasonCount: 10 }), config());
  const withoutIt = computeUsefulnessSignal(raw(), config());
  assert.deepEqual(withRedundant, withoutIt, "redundantReasonCount is observability-only, per E14/F5");
});

test("incorrectReasonCount does not double-count -- its negative evidence already lives in notUsefulCount", () => {
  // A useful=false, reason='incorrect' feedback increments BOTH notUsefulCount and
  // incorrectReasonCount at write time (F5) -- the formula must read notUsefulCount only, once.
  const row = raw({ notUsefulCount: 3, incorrectReasonCount: 3 });
  const result = computeUsefulnessSignal(row, config());
  const expectedFromNotUsefulAlone = computeUsefulnessSignal(raw({ notUsefulCount: 3 }), config());
  assert.deepEqual(result, expectedFromNotUsefulAlone, "incorrectReasonCount must not add a second penalty");
});

test("REGRESSION guard: no storage dependency -- package.json declares none, structural", () => {
  const dir = dirname(fileURLToPath(import.meta.url));
  const pkg = JSON.parse(readFileSync(join(dir, "..", "package.json"), "utf-8")) as {
    dependencies?: Record<string, string>;
  };
  assert.equal(pkg.dependencies?.["@brain/storage"], undefined);
  assert.deepEqual(Object.keys(pkg.dependencies ?? {}), ["@brain/contracts"]);
});
