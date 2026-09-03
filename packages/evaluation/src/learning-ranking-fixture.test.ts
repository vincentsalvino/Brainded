import { test } from "node:test";
import assert from "node:assert/strict";
import { globalScope, DEFAULT_LEARNING_CONFIG, type Candidate, type MemoryPerformanceRaw } from "@brain/contracts";
import { buildMemoryRecord, FakeMemoryPerformanceStore } from "@brain/test-fixtures";
import { LearningSignalService } from "@brain/learning";
import { rank } from "@brain/ranking";

/**
 * Phase 4.2 Layer 1 (PHASE_4_DECISIONS.md F14/F15): a small, frozen, deterministic fixture --
 * known candidate relevance, known performance histories, known expected order under both
 * enabled and disabled learning. This validates the shipped policy (E5's formula, F2's bounded
 * multiplier); it does not choose it -- every number here was fixed by earlier decisions, not
 * tuned against this file to make it pass.
 *
 * Exercises the real chained pipeline (LearningSignalService.decorate -> rank), not each stage in
 * isolation -- packages/core/learning and packages/core/ranking's own unit tests already cover
 * each stage alone in much more depth; this file is the one place that proves they compose.
 *
 * weights: {lexical: 1, semantic: 0, tag: 0} throughout, so `lexicalScore` IS the base score,
 * exactly, with no hidden weighted-sum arithmetic to account for.
 */

function memory(baseScore: number): Candidate {
  const record = buildMemoryRecord({ scope: globalScope() });
  return { memoryId: record.id, record, signals: { lexicalScore: baseScore } };
}

function seedRow(memoryId: string, overrides: Partial<MemoryPerformanceRaw>): MemoryPerformanceRaw {
  return {
    memoryId, scopeKey: "*", usefulCount: 0, notUsefulCount: 0, redundantReasonCount: 0,
    incorrectReasonCount: 0, dilutedSuccessEvidence: 0, dilutedFailureEvidence: 0,
    successContextCount: 0, failureContextCount: 0, labeledContextCount: 0,
    lastFeedbackAt: null, lastOutcomeAt: null,
    ...overrides,
  };
}

test("Layer 1 fixture: enabled reorders the reorder-possible pair, respects the true bound, leaves cold-start/irrelevant untouched", async () => {
  // Case 1: positive-supported memory (base 0.5, strong useful history).
  const positive = memory(0.5);
  // Case 2: negative-supported memory (base 0.5, strong not-useful history).
  const negative = memory(0.5);
  // Case 3: cold-start memory -- no memory_performance row at all.
  const coldStart = memory(0.5);
  // Case 4: clearly irrelevant memory -- far below everything else, no history needed.
  const irrelevant = memory(0.05);
  // Case 5: close-relevance pair -- ratio 1.25, inside (1+m)/(1-m)~=1.3529 -- CAN reorder.
  const closeHigh = memory(1.0);
  const closeLow = memory(0.8);
  // Case 6: large-gap pair -- ratio 2.0, outside the bound -- CANNOT reorder, even under
  // maximally opposite evidence.
  const farHigh = memory(1.0);
  const farLow = memory(0.5);

  const store = new FakeMemoryPerformanceStore();
  store.seed(seedRow(positive.memoryId, { usefulCount: 20 }));
  store.seed(seedRow(negative.memoryId, { notUsefulCount: 20 }));
  store.seed(seedRow(closeLow.memoryId, { usefulCount: 50 }));
  store.seed(seedRow(closeHigh.memoryId, { notUsefulCount: 50 }));
  store.seed(seedRow(farLow.memoryId, { usefulCount: 50 }));
  store.seed(seedRow(farHigh.memoryId, { notUsefulCount: 50 }));
  // coldStart and irrelevant: deliberately not seeded.

  const candidates = [positive, negative, coldStart, irrelevant, closeHigh, closeLow, farHigh, farLow];
  const learningConfig = { ...DEFAULT_LEARNING_CONFIG, enabled: true };
  const learning = new LearningSignalService(store, learningConfig);

  // --- DISABLED: strict base-score order (1.0 > 0.8 > 0.5 > 0.05) -- within a tied base
  // score, which of two candidates comes first is rank()'s own tie-break concern, already
  // covered by packages/core/ranking's own tests; this fixture only asserts the buckets.
  const disabledOrder = rank({ candidates, weights: { lexical: 1, semantic: 0, tag: 0 } }).map((r) => r.memoryId);
  const bucketIndex = (id: string) => disabledOrder.indexOf(id);
  const highBucket = [closeHigh.memoryId, farHigh.memoryId]; // base 1.0
  const midBucket = [closeLow.memoryId]; // base 0.8
  // base 0.5 -- farLow deliberately shares this bucket (its role is the ratio-2.0 partner
  // of farHigh for case 6, not a base-0.8 candidate).
  const lowBucket = [positive.memoryId, negative.memoryId, coldStart.memoryId, farLow.memoryId];
  assert.ok(Math.max(...highBucket.map(bucketIndex)) < Math.min(...midBucket.map(bucketIndex)), "base 1.0 must rank above base 0.8");
  assert.ok(Math.max(...midBucket.map(bucketIndex)) < Math.min(...lowBucket.map(bucketIndex)), "base 0.8 must rank above base 0.5");
  assert.ok(Math.max(...lowBucket.map(bucketIndex)) < bucketIndex(irrelevant.memoryId), "base 0.5 must rank above base 0.05");

  // --- ENABLED: decorate through the real store, then rank with learning on ---
  const decorated = await learning.decorate(candidates);
  const enabledResults = rank({ candidates: decorated, weights: { lexical: 1, semantic: 0, tag: 0 }, learning: { enabled: true, maxBoost: learningConfig.maxBoost } });
  const enabledOrder = enabledResults.map((r) => r.memoryId);
  const scoreOf = (id: string) => enabledResults.find((r) => r.memoryId === id)?.score ?? -1;

  // Case 1/2: positive moves up, negative moves down, relative to their own 0.5 baseline.
  assert.ok(scoreOf(positive.memoryId) > 0.5, "positive-supported memory must score above its base");
  assert.ok(scoreOf(negative.memoryId) < 0.5, "negative-supported memory must score below its base");

  // Case 3: cold start is an exact no-op.
  assert.equal(scoreOf(coldStart.memoryId), 0.5, "cold start must be untouched, not merely close");

  // Case 4: irrelevant stays last regardless -- its base score is far below any boosted rival's floor.
  assert.equal(enabledOrder[enabledOrder.length - 1], irrelevant.memoryId, "irrelevant must remain last under learning too");

  // Case 5: the close pair reorders -- closeLow (boosted) now outranks closeHigh (penalized).
  assert.ok(enabledOrder.indexOf(closeLow.memoryId) < enabledOrder.indexOf(closeHigh.memoryId), "close-relevance pair must reorder under strong opposite evidence");

  // Case 6: the far pair does NOT reorder -- the true worst-case bound protects it even
  // though farLow/farHigh received the exact same extreme evidence as closeLow/closeHigh.
  assert.ok(enabledOrder.indexOf(farHigh.memoryId) < enabledOrder.indexOf(farLow.memoryId), "large relevance gap must NOT reorder, despite equally extreme evidence");
});
