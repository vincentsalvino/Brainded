import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { MemoryPerformanceRawSchema, LearningConfigSchema, DEFAULT_LEARNING_CONFIG } from "./learning.js";

function baseRaw(overrides: Record<string, unknown> = {}) {
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

test("MemoryPerformanceRaw: accepts a well-formed zero-evidence row", () => {
  const raw = MemoryPerformanceRawSchema.parse(baseRaw());
  assert.equal(raw.scopeKey, "*");
  assert.equal(raw.usefulCount, 0);
  assert.equal(raw.lastFeedbackAt, null);
});

test("MemoryPerformanceRaw: accepts a well-formed row with real evidence", () => {
  const now = new Date().toISOString();
  const raw = MemoryPerformanceRawSchema.parse(
    baseRaw({
      usefulCount: 7,
      notUsefulCount: 43,
      dilutedSuccessEvidence: 1.5,
      dilutedFailureEvidence: 0.25,
      labeledContextCount: 50,
      lastFeedbackAt: now,
      lastOutcomeAt: now,
    }),
  );
  assert.equal(raw.usefulCount, 7);
  assert.equal(raw.dilutedSuccessEvidence, 1.5);
  assert.equal(raw.lastFeedbackAt, now);
});

test("MemoryPerformanceRaw: rejects a negative count", () => {
  assert.throws(() => MemoryPerformanceRawSchema.parse(baseRaw({ usefulCount: -1 })));
  assert.throws(() => MemoryPerformanceRawSchema.parse(baseRaw({ notUsefulCount: -1 })));
  assert.throws(() => MemoryPerformanceRawSchema.parse(baseRaw({ dilutedSuccessEvidence: -0.1 })));
});

test("MemoryPerformanceRaw: rejects a non-integer context count", () => {
  assert.throws(() => MemoryPerformanceRawSchema.parse(baseRaw({ successContextCount: 1.5 })));
});

test("MemoryPerformanceRaw: rejects unrecognized fields (strict -- no silent drop)", () => {
  assert.throws(() => MemoryPerformanceRawSchema.parse(baseRaw({ usefulnessSignal: 0.5 })));
});

test("MemoryPerformanceRaw: rejects a non-uuid memoryId", () => {
  assert.throws(() => MemoryPerformanceRawSchema.parse(baseRaw({ memoryId: "not-a-uuid" })));
});

test("LearningConfig: DEFAULT_LEARNING_CONFIG is disabled by default (F10 regression guard)", () => {
  assert.equal(DEFAULT_LEARNING_CONFIG.enabled, false);
});

test("LearningConfig: DEFAULT_LEARNING_CONFIG parses as valid and matches F4/F2's frozen constants", () => {
  const parsed = LearningConfigSchema.parse(DEFAULT_LEARNING_CONFIG);
  assert.equal(parsed.k, 5);
  assert.equal(parsed.outcomeWeight, 0);
  assert.equal(parsed.maxBoost, 0.15);
});

test("LearningConfig: rejects a non-positive k", () => {
  assert.throws(() => LearningConfigSchema.parse({ ...DEFAULT_LEARNING_CONFIG, k: 0 }));
});

test("LearningConfig: rejects a negative outcomeWeight", () => {
  assert.throws(() => LearningConfigSchema.parse({ ...DEFAULT_LEARNING_CONFIG, outcomeWeight: -0.1 }));
});

test("LearningConfig: rejects maxBoost outside [0, 1]", () => {
  assert.throws(() => LearningConfigSchema.parse({ ...DEFAULT_LEARNING_CONFIG, maxBoost: 1.5 }));
  assert.throws(() => LearningConfigSchema.parse({ ...DEFAULT_LEARNING_CONFIG, maxBoost: -0.01 }));
});

test("LearningConfig: rejects unrecognized fields (strict -- no silent drop)", () => {
  assert.throws(() => LearningConfigSchema.parse({ ...DEFAULT_LEARNING_CONFIG, extra: true }));
});
