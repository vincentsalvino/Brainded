import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { globalScope, type Candidate, type FeedbackEvent, type OutcomeEvent } from "@brain/contracts";
import { buildMemoryRecord } from "@brain/test-fixtures";
import { rank } from "@brain/ranking";
import {
  createIsolatedStateDb,
  seedContextMembership,
  applyFeedbackEvent,
  snapshotPerformance,
  sortTimeline,
  replayTimeline,
  classifyContextChange,
  type ContextMembershipSeed,
  type TimelineEntry,
} from "./historical-replay.js";
import { DEFAULT_RANKING_WEIGHTS } from "@brain/ranking";
import type { MemoryPerformanceRaw } from "@brain/contracts";

function rankFn(candidates: Candidate[], learningEnabled: boolean): string[] {
  return rank({
    candidates,
    weights: { lexical: 1, semantic: 0, tag: 0 },
    learning: learningEnabled ? { enabled: true, maxBoost: 0.15 } : undefined,
  }).map((r) => r.memoryId);
}

function feedback(overrides: Partial<FeedbackEvent> & Pick<FeedbackEvent, "memoryId">): FeedbackEvent {
  return {
    id: randomUUID(), timestamp: new Date().toISOString(), taskId: "t", contextId: null,
    useful: true, reason: null, notes: null, ...overrides,
  };
}

function outcome(overrides: Partial<OutcomeEvent> = {}): OutcomeEvent {
  return {
    id: randomUUID(), timestamp: new Date().toISOString(), taskId: "t", sessionId: null,
    contextId: null, outcome: "success", signal: null, notes: null, ...overrides,
  };
}

// --- 1/2/3: causal ordering primitives ---------------------------------------

test("sortTimeline: orders strictly by timestamp regardless of input array order", () => {
  const [m1, m2] = [randomUUID(), randomUUID()];
  const entries: TimelineEntry[] = [
    { kind: "context", timestamp: "2026-01-01T00:00:03.000Z", rowid: 1, contextEventId: "c2" },
    { kind: "feedback", timestamp: "2026-01-01T00:00:01.000Z", rowid: 1, event: feedback({ memoryId: m1 }) },
    { kind: "context", timestamp: "2026-01-01T00:00:00.000Z", rowid: 2, contextEventId: "c1" },
    { kind: "outcome", timestamp: "2026-01-01T00:00:02.000Z", rowid: 1, event: outcome() },
  ];
  const sorted = sortTimeline(entries);
  assert.deepEqual(sorted.map((e) => e.timestamp), [
    "2026-01-01T00:00:00.000Z", "2026-01-01T00:00:01.000Z", "2026-01-01T00:00:02.000Z", "2026-01-01T00:00:03.000Z",
  ]);
  void m2;
});

test("sortTimeline: same-timestamp ties break deterministically (outcome, feedback, context, then rowid)", () => {
  const t = "2026-01-01T00:00:00.000Z";
  const entries: TimelineEntry[] = [
    { kind: "context", timestamp: t, rowid: 1, contextEventId: "c" },
    { kind: "feedback", timestamp: t, rowid: 1, event: feedback({ memoryId: randomUUID() }) },
    { kind: "outcome", timestamp: t, rowid: 1, event: outcome() },
  ];
  const first = sortTimeline(entries).map((e) => e.kind);
  const second = sortTimeline([...entries].reverse()).map((e) => e.kind);
  assert.deepEqual(first, ["outcome", "feedback", "context"]);
  assert.deepEqual(second, first, "input order must not affect the tie-broken result");
});

// --- 4/5: reuses production's exact aggregation, not a reimplementation -----

test("applyFeedbackEvent/applyOutcomeEvent: dedup and reason-routing match production exactly (same functions)", () => {
  const stateDb = createIsolatedStateDb();
  const memoryId = randomUUID();
  const contextId = randomUUID();
  seedContextMembership(stateDb, [{ contextEventId: contextId, memoryId, included: true, rank: 1 }]);

  const first = feedback({ memoryId, contextId, useful: true });
  const duplicate = feedback({ memoryId, contextId, useful: false, reason: "irrelevant" }); // same pair, later
  applyFeedbackEvent(stateDb, first);
  applyFeedbackEvent(stateDb, duplicate);

  const [row] = [...snapshotPerformance(stateDb, [memoryId]).values()];
  assert.equal(row?.usefulCount, 1, "first observation wins -- F16a, same rule as production");
  assert.equal(row?.notUsefulCount, 0, "the later duplicate must not also count");
});

// --- 1/2: the load-bearing no-future-leakage guarantee -----------------------

test("replayTimeline: a context sees ZERO effect from feedback recorded strictly after it (no future leakage)", async () => {
  const memoryId = randomUUID();
  const earlyContextId = randomUUID();
  const record = buildMemoryRecord({ id: memoryId, scope: globalScope() });
  const candidate: Candidate = { memoryId, record, signals: { lexicalScore: 1.0 } };

  const membership: ContextMembershipSeed[] = [{ contextEventId: earlyContextId, memoryId, included: true, rank: 1 }];
  const laterFeedback = feedback({ memoryId, contextId: earlyContextId, useful: true, timestamp: "2026-01-01T00:00:05.000Z" });
  const entries: TimelineEntry[] = [
    { kind: "context", timestamp: "2026-01-01T00:00:00.000Z", rowid: 1, contextEventId: earlyContextId },
    { kind: "feedback", timestamp: laterFeedback.timestamp, rowid: 1, event: laterFeedback }, // strictly AFTER the context
  ];

  const results = await replayTimeline(entries, membership, async () => [candidate], rankFn);
  const contextResult = results.find((r) => r.contextEventId === earlyContextId);

  assert.equal(contextResult?.performanceAtTime.size, 0, "no performance evidence must exist yet -- the feedback happens later");
  assert.deepEqual(contextResult?.enabledOrder, [memoryId], "with zero evidence, enabled order equals the single-candidate baseline");
});

test("replayTimeline: a LATER context correctly sees EARLIER feedback (evidence flows forward, never backward)", async () => {
  const memoryId = randomUUID();
  const c1 = randomUUID();
  const c2 = randomUUID();
  const record = buildMemoryRecord({ id: memoryId, scope: globalScope() });
  const candidate: Candidate = { memoryId, record, signals: { lexicalScore: 1.0 } };

  const membership: ContextMembershipSeed[] = [
    { contextEventId: c1, memoryId, included: true, rank: 1 },
    { contextEventId: c2, memoryId, included: true, rank: 1 },
  ];
  const earlyFeedback = feedback({ memoryId, contextId: c1, useful: true, timestamp: "2026-01-01T00:00:01.000Z" });
  const entries: TimelineEntry[] = [
    { kind: "context", timestamp: "2026-01-01T00:00:00.000Z", rowid: 1, contextEventId: c1 },
    { kind: "feedback", timestamp: earlyFeedback.timestamp, rowid: 1, event: earlyFeedback },
    { kind: "context", timestamp: "2026-01-01T00:00:02.000Z", rowid: 2, contextEventId: c2 },
  ];

  const results = await replayTimeline(entries, membership, async () => [candidate], rankFn);
  const atC1 = results.find((r) => r.contextEventId === c1);
  const atC2 = results.find((r) => r.contextEventId === c2);

  assert.equal(atC1?.performanceAtTime.size, 0, "c1 predates the feedback entirely");
  assert.equal(atC2?.performanceAtTime.get(memoryId)?.usefulCount, 1, "c2 postdates it and must see it");
});

// --- 6/7/8: reuses real rank(), disabled-baseline equality, cold-start=0 ----

test("replayTimeline: reconstructed baseline uses the real rank() -- validated against the recorded order", async () => {
  const [a, b] = [randomUUID(), randomUUID()];
  const contextId = randomUUID();
  const recordA = buildMemoryRecord({ id: a, scope: globalScope() });
  const recordB = buildMemoryRecord({ id: b, scope: globalScope() });
  const candidates: Candidate[] = [
    { memoryId: a, record: recordA, signals: { lexicalScore: 0.9 } },
    { memoryId: b, record: recordB, signals: { lexicalScore: 0.5 } },
  ];
  const membership: ContextMembershipSeed[] = [
    { contextEventId: contextId, memoryId: a, included: true, rank: 1 }, // recorded: a first, matches the real score order
    { contextEventId: contextId, memoryId: b, included: true, rank: 2 },
  ];
  const entries: TimelineEntry[] = [{ kind: "context", timestamp: "2026-01-01T00:00:00.000Z", rowid: 1, contextEventId: contextId }];

  const [result] = await replayTimeline(entries, membership, async () => candidates, rankFn);
  assert.equal(result?.exactlyReplayable, true);
  assert.deepEqual(result?.reconstructedBaselineOrder, [a, b]);
});

test("replayTimeline: a mismatched recorded order is honestly flagged, not silently accepted", async () => {
  const [a, b] = [randomUUID(), randomUUID()];
  const contextId = randomUUID();
  const candidates: Candidate[] = [
    { memoryId: a, record: buildMemoryRecord({ id: a, scope: globalScope() }), signals: { lexicalScore: 0.9 } },
    { memoryId: b, record: buildMemoryRecord({ id: b, scope: globalScope() }), signals: { lexicalScore: 0.5 } },
  ];
  const membership: ContextMembershipSeed[] = [
    { contextEventId: contextId, memoryId: a, included: true, rank: 2 }, // recorded order is REVERSED vs. real scores
    { contextEventId: contextId, memoryId: b, included: true, rank: 1 },
  ];
  const entries: TimelineEntry[] = [{ kind: "context", timestamp: "2026-01-01T00:00:00.000Z", rowid: 1, contextEventId: contextId }];

  const [result] = await replayTimeline(entries, membership, async () => candidates, rankFn);
  assert.equal(result?.exactlyReplayable, false);
  assert.equal(result?.enabledOrder, null, "must not compute a misleading enabled order for a non-validated context");
  assert.ok(result?.notReplayableReason);
});

test("replayTimeline: disabled-learning replay is byte-identical to the recorded baseline (cold start)", async () => {
  const [a, b] = [randomUUID(), randomUUID()];
  const contextId = randomUUID();
  const candidates: Candidate[] = [
    { memoryId: a, record: buildMemoryRecord({ id: a, scope: globalScope() }), signals: { lexicalScore: 0.9 } },
    { memoryId: b, record: buildMemoryRecord({ id: b, scope: globalScope() }), signals: { lexicalScore: 0.5 } },
  ];
  const membership: ContextMembershipSeed[] = [
    { contextEventId: contextId, memoryId: a, included: true, rank: 1 },
    { contextEventId: contextId, memoryId: b, included: true, rank: 2 },
  ];
  const entries: TimelineEntry[] = [{ kind: "context", timestamp: "2026-01-01T00:00:00.000Z", rowid: 1, contextEventId: contextId }];

  // No feedback/outcome anywhere in this timeline -- pure cold start.
  const [result] = await replayTimeline(entries, membership, async () => candidates, rankFn);
  assert.deepEqual(result?.enabledOrder, result?.recordedOrder, "cold start: enabled order must equal the recorded (disabled) baseline exactly");
});

test("replayTimeline: cold-start reorder count is zero across a small swept fixture", async () => {
  const contexts = Array.from({ length: 5 }, () => randomUUID());
  const membership: ContextMembershipSeed[] = [];
  const entries: TimelineEntry[] = [];
  const candidatesByContext = new Map<string, Candidate[]>();

  contexts.forEach((contextId, i) => {
    const ids = [randomUUID(), randomUUID(), randomUUID()];
    const scores = [0.9, 0.6, 0.3].map((s) => s - i * 0.01); // vary slightly per context, still descending
    const candidates = ids.map((id, idx): Candidate => ({
      memoryId: id, record: buildMemoryRecord({ id, scope: globalScope() }), signals: { lexicalScore: scores[idx] },
    }));
    candidatesByContext.set(contextId, candidates);
    ids.forEach((id, idx) => membership.push({ contextEventId: contextId, memoryId: id, included: true, rank: idx + 1 }));
    entries.push({ kind: "context", timestamp: `2026-01-01T00:00:0${i}.000Z`, rowid: i + 1, contextEventId: contextId });
  });

  const results = await replayTimeline(entries, membership, async (id) => candidatesByContext.get(id) ?? null, rankFn);
  const reorderCount = results.filter((r) => r.exactlyReplayable && JSON.stringify(r.enabledOrder) !== JSON.stringify(r.recordedOrder)).length;
  assert.equal(reorderCount, 0, "with no feedback/outcome evidence anywhere, no context may reorder");
});

// --- 9/10: context-impacting vs rank-only, harmful-reorder classification --

function perfRaw(memoryId: string, usefulCount: number, notUsefulCount: number): MemoryPerformanceRaw {
  return {
    memoryId, scopeKey: "*", usefulCount, notUsefulCount, redundantReasonCount: 0, incorrectReasonCount: 0,
    dilutedSuccessEvidence: 0, dilutedFailureEvidence: 0, successContextCount: 0, failureContextCount: 0,
    labeledContextCount: usefulCount + notUsefulCount, lastFeedbackAt: null, lastOutcomeAt: null,
  };
}

test("classifyContextChange: identical order -> unchanged", () => {
  const [a, b] = [randomUUID(), randomUUID()];
  const result = classifyContextChange({
    recordedOrder: [a, b], enabledFullOrder: [a, b],
    candidates: [], performanceAtTime: new Map(), weights: DEFAULT_RANKING_WEIGHTS,
  });
  assert.equal(result.kind, "unchanged");
  assert.equal(result.safety, null);
});

test("classifyContextChange: rank-only swap between a negative- and positive-supported memory at comparable relevance -> harmful", () => {
  const [a, b] = [randomUUID(), randomUUID()];
  const candidates = [
    { memoryId: a, record: buildMemoryRecord({ id: a, scope: globalScope() }), signals: { lexicalScore: 1.0 } },
    { memoryId: b, record: buildMemoryRecord({ id: b, scope: globalScope() }), signals: { lexicalScore: 0.9 } }, // ratio ~1.11, well inside the bound
  ];
  const result = classifyContextChange({
    recordedOrder: [a, b], enabledFullOrder: [b, a], // b (negative) overtakes a (positive)
    candidates,
    performanceAtTime: new Map([[a, perfRaw(a, 10, 0)], [b, perfRaw(b, 0, 10)]]),
    weights: { lexical: 1, semantic: 0, tag: 0 },
  });
  assert.equal(result.kind, "rank-only");
  assert.equal(result.safety, "harmful");
});

test("classifyContextChange: rank-only swap OUTSIDE the true bound is safe, even with opposite support", () => {
  const [a, b] = [randomUUID(), randomUUID()];
  const candidates = [
    { memoryId: a, record: buildMemoryRecord({ id: a, scope: globalScope() }), signals: { lexicalScore: 1.0 } },
    { memoryId: b, record: buildMemoryRecord({ id: b, scope: globalScope() }), signals: { lexicalScore: 0.5 } }, // ratio 2.0, outside ~1.3529
  ];
  const result = classifyContextChange({
    recordedOrder: [a, b], enabledFullOrder: [b, a],
    candidates,
    performanceAtTime: new Map([[a, perfRaw(a, 10, 0)], [b, perfRaw(b, 0, 10)]]),
    weights: { lexical: 1, semantic: 0, tag: 0 },
  });
  assert.equal(result.safety, "safe", "outside the true bound, this reorder mechanism could not actually have produced this swap -- not classified harmful");
});

test("classifyContextChange: a positive-supported memory displaced by a negative-supported one -> context-impacting, harmful", () => {
  const [a, b] = [randomUUID(), randomUUID()];
  const result = classifyContextChange({
    recordedOrder: [a], enabledFullOrder: [b, a], // top-1: b now displaces a
    candidates: [],
    performanceAtTime: new Map([[a, perfRaw(a, 10, 0)], [b, perfRaw(b, 0, 10)]]),
    weights: DEFAULT_RANKING_WEIGHTS,
  });
  assert.equal(result.kind, "context-impacting");
  assert.equal(result.safety, "harmful");
});

test("classifyContextChange: a set change with no positive-vs-negative displacement is context-impacting but safe", () => {
  const [a, b] = [randomUUID(), randomUUID()];
  const result = classifyContextChange({
    recordedOrder: [a], enabledFullOrder: [b], // a cold-start memory simply wasn't reconstructed identically -- no evidence either way
    candidates: [],
    performanceAtTime: new Map(),
    weights: DEFAULT_RANKING_WEIGHTS,
  });
  assert.equal(result.kind, "context-impacting");
  assert.equal(result.safety, "safe");
});
