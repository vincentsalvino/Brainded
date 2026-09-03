import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { globalScope, type Candidate, type LearningConfig } from "@brain/contracts";
import { FakeMemoryPerformanceStore } from "@brain/test-fixtures";
import { LearningSignalService } from "./decorate.js";

function config(overrides: Partial<LearningConfig> = {}): LearningConfig {
  return { enabled: false, k: 5, outcomeWeight: 0, maxBoost: 0.15, ...overrides };
}

function candidate(memoryId: string): Candidate {
  const now = new Date().toISOString();
  return {
    memoryId,
    record: {
      id: memoryId,
      type: "fact",
      content: "example",
      domain: null,
      scope: globalScope(),
      source: { origin: "system" },
      confidence: 0.5,
      status: "active",
      tags: [],
      supersedes: null,
      createdAt: now,
      updatedAt: now,
    },
    signals: { lexicalScore: 0.8 },
  };
}

test("disabled: returns the original candidates, unmodified", async () => {
  const store = new FakeMemoryPerformanceStore();
  const id = randomUUID();
  store.seed({
    memoryId: id, scopeKey: "*", usefulCount: 9, notUsefulCount: 0, redundantReasonCount: 0,
    incorrectReasonCount: 0, dilutedSuccessEvidence: 0, dilutedFailureEvidence: 0,
    successContextCount: 0, failureContextCount: 0, labeledContextCount: 9,
    lastFeedbackAt: null, lastOutcomeAt: null,
  });
  const service = new LearningSignalService(store, config({ enabled: false }));
  const input = [candidate(id)];

  const result = await service.decorate(input);

  assert.equal(result, input, "disabled must return the exact same array reference -- a true no-op");
  assert.equal(result[0]?.performance, undefined);
});

test("disabled: performs zero store reads (spy, not an assumption)", async () => {
  const store = new FakeMemoryPerformanceStore();
  const service = new LearningSignalService(store, config({ enabled: false }));
  await service.decorate([candidate(randomUUID())]);
  assert.equal(store.getPerformanceBatchCallCount, 0);
});

test("enabled: performs exactly one batch read, not one query per candidate", async () => {
  const store = new FakeMemoryPerformanceStore();
  const service = new LearningSignalService(store, config({ enabled: true }));
  await service.decorate([candidate(randomUUID()), candidate(randomUUID()), candidate(randomUUID())]);
  assert.equal(store.getPerformanceBatchCallCount, 1);
});

test("enabled: a candidate with a seeded aggregate gets a derived performance object", async () => {
  const store = new FakeMemoryPerformanceStore();
  const id = randomUUID();
  store.seed({
    memoryId: id, scopeKey: "*", usefulCount: 5, notUsefulCount: 0, redundantReasonCount: 0,
    incorrectReasonCount: 0, dilutedSuccessEvidence: 0, dilutedFailureEvidence: 0,
    successContextCount: 0, failureContextCount: 0, labeledContextCount: 5,
    lastFeedbackAt: null, lastOutcomeAt: null,
  });
  const service = new LearningSignalService(store, config({ enabled: true }));
  const [decorated] = await service.decorate([candidate(id)]);
  assert.ok(decorated?.performance);
  assert.ok(decorated.performance.usefulnessSignal > 0.5);
  assert.equal(decorated.performance.evidenceMass, 5);
});

test("enabled: a memoryId with no aggregate row leaves that candidate's performance absent, not fabricated", async () => {
  const store = new FakeMemoryPerformanceStore(); // nothing seeded
  const service = new LearningSignalService(store, config({ enabled: true }));
  const [decorated] = await service.decorate([candidate(randomUUID())]);
  assert.equal(decorated?.performance, undefined, "cold start must not fabricate a zero-evidence object");
});

test("enabled: a mixed batch of known and unknown candidates decorates only the known ones", async () => {
  const store = new FakeMemoryPerformanceStore();
  const known = randomUUID();
  const unknown = randomUUID();
  store.seed({
    memoryId: known, scopeKey: "*", usefulCount: 3, notUsefulCount: 0, redundantReasonCount: 0,
    incorrectReasonCount: 0, dilutedSuccessEvidence: 0, dilutedFailureEvidence: 0,
    successContextCount: 0, failureContextCount: 0, labeledContextCount: 3,
    lastFeedbackAt: null, lastOutcomeAt: null,
  });
  const service = new LearningSignalService(store, config({ enabled: true }));
  const [a, b] = await service.decorate([candidate(known), candidate(unknown)]);
  assert.ok(a?.performance);
  assert.equal(b?.performance, undefined);
});

test("enabled: a performance-store failure degrades to the original candidates, unmodified, not a throw", async () => {
  const store = new FakeMemoryPerformanceStore();
  store.simulateFailure(true);
  const service = new LearningSignalService(store, config({ enabled: true }));
  const input = [candidate(randomUUID())];

  const result = await service.decorate(input);

  assert.equal(result, input, "a store failure must degrade to the original array, not throw");
});
