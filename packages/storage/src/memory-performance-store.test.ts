import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import type Database from "better-sqlite3";
import { globalScope, type MemoryPerformanceRaw } from "@brain/contracts";
import { FakeEmbeddingProvider } from "@brain/test-fixtures";
import { openDatabase } from "./db.js";
import { SqliteEventStore } from "./event-store.js";
import { SqliteMemoryRepository } from "./memory-repository.js";
import { SqliteMemoryPerformanceStore } from "./memory-performance-store.js";
import { runMemoryPerformanceStoreConformance } from "@brain/test-fixtures";

// SqliteEventStore.recordFeedback/recordOutcome apply their memory_performance delta
// automatically, in the same transaction as the raw insert (F12, event-store.ts). These tests
// exercise that real, public path -- not applyFeedbackToPerformance/applyOutcomeToPerformance
// directly -- so a broken wiring would fail here too, not just the dedicated atomicity tests in
// event-store.test.ts.

const NO_TIMINGS = { retrievalMs: null, rankingMs: null, compileMs: null, optimizeMs: null };

/** One memory, one retrieval event, ready for feedback/outcome fixtures. */
async function fixture() {
  const db = openDatabase(":memory:");
  const events = new SqliteEventStore(db.raw);
  const repo = new SqliteMemoryRepository(db.raw, new FakeEmbeddingProvider());
  const perf = new SqliteMemoryPerformanceStore(db.raw);
  const memory = await repo.create({ type: "fact", content: "fixture memory", scope: globalScope() });
  const retrieval = await events.recordRetrieval({ scope: globalScope(), queryText: "q", candidateIds: [memory.id], taskId: "t" });
  return { db, events, repo, perf, memoryId: memory.id, retrievalId: retrieval.id };
}

/** A ContextEvent that includes exactly `includedIds` (all `included: true`), plus any `omittedIds`. */
async function contextIncluding(events: SqliteEventStore, retrievalId: string, includedIds: string[], omittedIds: string[] = []) {
  return events.recordContext({
    retrievalEventId: retrievalId,
    scope: globalScope(),
    taskId: "t",
    includedMemoryIds: includedIds,
    omittedMemoryIds: omittedIds,
    tokenCount: includedIds.length,
    memories: [
      ...includedIds.map((memoryId) => ({ memoryId, included: true, rank: 1, tokenCount: 1 })),
      ...omittedIds.map((memoryId) => ({ memoryId, included: false, rank: null, tokenCount: null })),
    ],
    candidateCount: includedIds.length + omittedIds.length,
    candidateTokenCount: includedIds.length + omittedIds.length,
    ...NO_TIMINGS,
  });
}

async function oneRow(perf: SqliteMemoryPerformanceStore, memoryId: string) {
  return (await perf.getPerformanceBatch([memoryId])).get(memoryId);
}

// --- Feedback aggregation ---------------------------------------------------

test("one useful=true feedback -> usefulCount=1, labeledContextCount=1", async () => {
  const { db, events, perf, memoryId } = await fixture();
  const fb = await events.recordFeedback({ memoryId, taskId: "t", contextId: null, useful: true, reason: null, notes: null });
  const row = await oneRow(perf, memoryId);
  assert.equal(row?.usefulCount, 1);
  assert.equal(row?.notUsefulCount, 0);
  assert.equal(row?.labeledContextCount, 1);
  assert.equal(row?.lastFeedbackAt, fb.timestamp);
  db.close();
});

test("one useful=false feedback, reason=irrelevant -> notUsefulCount=1", async () => {
  const { db, events, perf, memoryId } = await fixture();
  await events.recordFeedback({ memoryId, taskId: "t", contextId: null, useful: false, reason: "irrelevant", notes: null });
  const row = await oneRow(perf, memoryId);
  assert.equal(row?.notUsefulCount, 1);
  assert.equal(row?.usefulCount, 0);
  assert.equal(row?.redundantReasonCount, 0);
  assert.equal(row?.incorrectReasonCount, 0);
  db.close();
});

test("reason=redundant feeds neither useful nor not-useful stream (E14/F5), but still labeled", async () => {
  const { db, events, perf, memoryId } = await fixture();
  await events.recordFeedback({ memoryId, taskId: "t", contextId: null, useful: false, reason: "redundant", notes: null });
  const row = await oneRow(perf, memoryId);
  assert.equal(row?.notUsefulCount, 0);
  assert.equal(row?.usefulCount, 0);
  assert.equal(row?.redundantReasonCount, 1);
  assert.equal(row?.labeledContextCount, 1, "still a real Tier-1 observation, just routed elsewhere");
  db.close();
});

test("reason=incorrect increments both notUsefulCount and incorrectReasonCount", async () => {
  const { db, events, perf, memoryId } = await fixture();
  await events.recordFeedback({ memoryId, taskId: "t", contextId: null, useful: false, reason: "incorrect", notes: null });
  const row = await oneRow(perf, memoryId);
  assert.equal(row?.notUsefulCount, 1);
  assert.equal(row?.incorrectReasonCount, 1);
  db.close();
});

test("useful=null contributes no evidence and touches no row", async () => {
  const { db, events, perf, memoryId } = await fixture();
  await events.recordFeedback({ memoryId, taskId: "t", contextId: null, useful: null, reason: null, notes: null });
  assert.equal(await oneRow(perf, memoryId), undefined, "no aggregate row should exist -- useful:null is not a judgement");
  db.close();
});

test("repeated distinct contexts accumulate", async () => {
  const { db, events, perf, memoryId, retrievalId } = await fixture();
  for (let i = 0; i < 3; i++) {
    const ctx = await contextIncluding(events, retrievalId, [memoryId]);
    await events.recordFeedback({ memoryId, taskId: "t", contextId: ctx.id, useful: true, reason: null, notes: null });
  }
  const row = await oneRow(perf, memoryId);
  assert.equal(row?.usefulCount, 3);
  assert.equal(row?.labeledContextCount, 3);
  db.close();
});

test("opposite feedback across tasks nets both streams, does not cancel", async () => {
  const { db, events, perf, memoryId, retrievalId } = await fixture();
  const ctxA = await contextIncluding(events, retrievalId, [memoryId]);
  const ctxB = await contextIncluding(events, retrievalId, [memoryId]);
  await events.recordFeedback({ memoryId, taskId: "t", contextId: ctxA.id, useful: true, reason: null, notes: null });
  await events.recordFeedback({ memoryId, taskId: "t", contextId: ctxB.id, useful: false, reason: "irrelevant", notes: null });
  const row = await oneRow(perf, memoryId);
  assert.equal(row?.usefulCount, 1);
  assert.equal(row?.notUsefulCount, 1);
  db.close();
});

test("duplicate (memoryId, contextId) feedback: first observation wins, later ones contribute nothing (F16a)", async () => {
  const { db, events, perf, memoryId, retrievalId } = await fixture();
  const ctx = await contextIncluding(events, retrievalId, [memoryId]);
  await events.recordFeedback({ memoryId, taskId: "t", contextId: ctx.id, useful: true, reason: null, notes: null });
  await events.recordFeedback({ memoryId, taskId: "t", contextId: ctx.id, useful: false, reason: "irrelevant", notes: null });
  const row = await oneRow(perf, memoryId);
  assert.equal(row?.usefulCount, 1, "the first (winning) observation was useful=true");
  assert.equal(row?.notUsefulCount, 0, "the second, same-pair observation must not also count");
  assert.equal(row?.labeledContextCount, 1);
  db.close();
});

test("two distinct memories in the same context each get their own independent aggregate row", async () => {
  const { db, events, perf, memoryId, retrievalId, repo } = await fixture();
  const other = await repo.create({ type: "fact", content: "second memory", scope: globalScope() });
  const ctx = await contextIncluding(events, retrievalId, [memoryId, other.id]);
  await events.recordFeedback({ memoryId, taskId: "t", contextId: ctx.id, useful: true, reason: null, notes: null });
  await events.recordFeedback({ memoryId: other.id, taskId: "t", contextId: ctx.id, useful: false, reason: "irrelevant", notes: null });
  assert.equal((await oneRow(perf, memoryId))?.usefulCount, 1);
  assert.equal((await oneRow(perf, other.id))?.notUsefulCount, 1);
  assert.equal((await oneRow(perf, memoryId))?.notUsefulCount, 0, "the two memories' evidence must never merge");
  db.close();
});

test("null-context feedback rows are never deduplicated against each other -- each counts independently", async () => {
  const { db, events, perf, memoryId } = await fixture();
  await events.recordFeedback({ memoryId, taskId: "t", contextId: null, useful: true, reason: null, notes: null });
  await events.recordFeedback({ memoryId, taskId: "t", contextId: null, useful: true, reason: null, notes: null });
  const row = await oneRow(perf, memoryId);
  assert.equal(row?.usefulCount, 2, "two independent null-context observations must both count");
  db.close();
});

// --- Outcome attribution -----------------------------------------------------

test("success outcome distributes 1/N unweighted dilution to every included memory", async () => {
  const { db, events, perf, repo, retrievalId } = await fixture();
  const b = await repo.create({ type: "fact", content: "b", scope: globalScope() });
  const a = await repo.create({ type: "fact", content: "a", scope: globalScope() });
  const ctx = await contextIncluding(events, retrievalId, [a.id, b.id]);
  const outcome = await events.recordOutcome({ taskId: "t", sessionId: null, contextId: ctx.id, outcome: "success", signal: null, notes: null });
  const rowA = await oneRow(perf, a.id);
  const rowB = await oneRow(perf, b.id);
  assert.equal(rowA?.dilutedSuccessEvidence, 0.5);
  assert.equal(rowB?.dilutedSuccessEvidence, 0.5);
  assert.equal(rowA?.successContextCount, 1);
  assert.equal(rowA?.dilutedFailureEvidence, 0, "outcomeWeight is never applied at write time -- this is raw, unweighted 1/N");
  assert.equal(rowA?.lastOutcomeAt, outcome.timestamp);
  db.close();
});

test("failure outcome distributes negative-bucket dilution symmetrically", async () => {
  const { db, events, perf, memoryId, retrievalId } = await fixture();
  const ctx = await contextIncluding(events, retrievalId, [memoryId]);
  await events.recordOutcome({ taskId: "t", sessionId: null, contextId: ctx.id, outcome: "failure", signal: null, notes: null });
  const row = await oneRow(perf, memoryId);
  assert.equal(row?.dilutedFailureEvidence, 1);
  assert.equal(row?.failureContextCount, 1);
  assert.equal(row?.dilutedSuccessEvidence, 0);
  db.close();
});

test("partial and unknown outcomes contribute no evidence to either bucket (F16c -- E12 is silent on them)", async () => {
  const { db, events, perf, memoryId, retrievalId } = await fixture();
  const ctxPartial = await contextIncluding(events, retrievalId, [memoryId]);
  await events.recordOutcome({ taskId: "t", sessionId: null, contextId: ctxPartial.id, outcome: "partial", signal: null, notes: null });
  const ctxUnknown = await contextIncluding(events, retrievalId, [memoryId]);
  await events.recordOutcome({ taskId: "t", sessionId: null, contextId: ctxUnknown.id, outcome: "unknown", signal: null, notes: null });
  assert.equal(await oneRow(perf, memoryId), undefined, "neither outcome value may create an aggregate row");
  db.close();
});

test("outcome with contextId: null contributes zero Tier-2 evidence (no context to fan out to)", async () => {
  const { db, events, perf, memoryId } = await fixture();
  await events.recordOutcome({ taskId: "t", sessionId: null, contextId: null, outcome: "success", signal: null, notes: null });
  assert.equal(await oneRow(perf, memoryId), undefined);
  db.close();
});

test("outcome linked to a context with zero included memories is a no-op, never divides by zero", async () => {
  const { db, events, retrievalId } = await fixture();
  const ctx = await contextIncluding(events, retrievalId, []); // nothing included
  await assert.doesNotReject(() =>
    events.recordOutcome({ taskId: "t", sessionId: null, contextId: ctx.id, outcome: "success", signal: null, notes: null }),
  );
  db.close();
});

test("duplicate outcomes for the same context: first eligible (success/failure) one wins (F16b)", async () => {
  const { db, events, perf, memoryId, retrievalId } = await fixture();
  const ctx = await contextIncluding(events, retrievalId, [memoryId]);
  await events.recordOutcome({ taskId: "t", sessionId: null, contextId: ctx.id, outcome: "success", signal: null, notes: null });
  await events.recordOutcome({ taskId: "t", sessionId: null, contextId: ctx.id, outcome: "failure", signal: null, notes: null });
  const row = await oneRow(perf, memoryId);
  assert.equal(row?.dilutedSuccessEvidence, 1, "the first outcome (success) must win");
  assert.equal(row?.dilutedFailureEvidence, 0, "the later duplicate outcome must not also count");
  db.close();
});

test("a leading partial outcome does not block a later success outcome from counting (dedup is scoped to eligible outcomes)", async () => {
  const { db, events, perf, memoryId, retrievalId } = await fixture();
  const ctx = await contextIncluding(events, retrievalId, [memoryId]);
  await events.recordOutcome({ taskId: "t", sessionId: null, contextId: ctx.id, outcome: "partial", signal: null, notes: null });
  await events.recordOutcome({ taskId: "t", sessionId: null, contextId: ctx.id, outcome: "success", signal: null, notes: null });
  const row = await oneRow(perf, memoryId);
  assert.equal(row?.dilutedSuccessEvidence, 1, "partial was never eligible, so it must not consume the dedup slot");
  db.close();
});

test("no-outcome context: feedback alone still aggregates correctly (Tier-1 only)", async () => {
  const { db, events, perf, memoryId, retrievalId } = await fixture();
  const ctx = await contextIncluding(events, retrievalId, [memoryId]);
  await events.recordFeedback({ memoryId, taskId: "t", contextId: ctx.id, useful: true, reason: null, notes: null });
  const row = await oneRow(perf, memoryId);
  assert.equal(row?.usefulCount, 1);
  assert.equal(row?.dilutedSuccessEvidence, 0);
  assert.equal(row?.lastOutcomeAt, null);
  db.close();
});

// --- getPerformanceBatch -----------------------------------------------------

test("getPerformanceBatch: returns only requested, present memoryIds; absent ones are simply missing", async () => {
  const { db, events, perf, memoryId } = await fixture();
  await events.recordFeedback({ memoryId, taskId: "t", contextId: null, useful: true, reason: null, notes: null });
  const batch = await perf.getPerformanceBatch([memoryId, randomUUID()]);
  assert.equal(batch.size, 1);
  assert.ok(batch.has(memoryId));
  db.close();
});

test("getPerformanceBatch: an empty request returns an empty map", async () => {
  const { db, perf } = await fixture();
  assert.equal((await perf.getPerformanceBatch([])).size, 0);
  db.close();
});

// --- rebuildAll ---------------------------------------------------------------

test("rebuildAll: reconstructs the exact incrementally-maintained state from raw events", async () => {
  const { db, events, perf, repo, retrievalId } = await fixture();
  const b = await repo.create({ type: "fact", content: "b", scope: globalScope() });
  const a = await repo.create({ type: "fact", content: "a", scope: globalScope() });

  const ctx1 = await contextIncluding(events, retrievalId, [a.id, b.id]);
  await events.recordFeedback({ memoryId: a.id, taskId: "t", contextId: ctx1.id, useful: true, reason: null, notes: null });
  await events.recordFeedback({ memoryId: b.id, taskId: "t", contextId: ctx1.id, useful: false, reason: "irrelevant", notes: null });
  await events.recordOutcome({ taskId: "t", sessionId: null, contextId: ctx1.id, outcome: "success", signal: null, notes: null });

  const ctx2 = await contextIncluding(events, retrievalId, [a.id]);
  await events.recordFeedback({ memoryId: a.id, taskId: "t", contextId: ctx2.id, useful: false, reason: "redundant", notes: null });

  const before = new Map([...(await perf.getPerformanceBatch([a.id, b.id])).entries()]);

  const result = await perf.rebuildAll();
  assert.equal(result.memoriesRebuilt, 2);

  const after = await perf.getPerformanceBatch([a.id, b.id]);
  assert.deepEqual(after.get(a.id), before.get(a.id));
  assert.deepEqual(after.get(b.id), before.get(b.id));
  db.close();
});

test("rebuildAll: on an empty event log, produces zero rows", async () => {
  const { db, perf } = await fixture();
  const result = await perf.rebuildAll();
  assert.equal(result.memoriesRebuilt, 0);
  db.close();
});

test("rebuildAll: recovers correct state after the projection is corrupted", async () => {
  const { db, events, perf, memoryId, retrievalId } = await fixture();
  const ctx = await contextIncluding(events, retrievalId, [memoryId]);
  await events.recordFeedback({ memoryId, taskId: "t", contextId: ctx.id, useful: true, reason: null, notes: null });

  // Simulate corruption: overwrite the correct row with wrong values directly.
  db.raw
    .prepare(`UPDATE memory_performance SET useful_count = 999, not_useful_count = 999 WHERE memory_id = ?`)
    .run(memoryId);
  assert.equal((await oneRow(perf, memoryId))?.usefulCount, 999, "precondition: corruption applied");

  await perf.rebuildAll();

  const recovered = await oneRow(perf, memoryId);
  assert.equal(recovered?.usefulCount, 1, "rebuild must overwrite corrupted state with the truth from raw events");
  assert.equal(recovered?.notUsefulCount, 0);
  db.close();
});

test("purge cascades to remove the memory's memory_performance row too", async () => {
  const { db, events, repo, perf, memoryId } = await fixture();
  await events.recordFeedback({ memoryId, taskId: "t", contextId: null, useful: true, reason: null, notes: null });
  assert.ok(await oneRow(perf, memoryId), "precondition: an aggregate row exists");

  await repo.purge(memoryId, globalScope());

  assert.equal(await oneRow(perf, memoryId), undefined, "ON DELETE CASCADE must remove the performance row with the memory");
  db.close();
});

test("rebuildAll: never modifies raw feedback_events/outcome_events or memories rows", async () => {
  const { db, events, perf, memoryId, retrievalId } = await fixture();
  const ctx = await contextIncluding(events, retrievalId, [memoryId]);
  await events.recordFeedback({ memoryId, taskId: "t", contextId: ctx.id, useful: true, reason: null, notes: null });
  await events.recordOutcome({ taskId: "t", sessionId: null, contextId: ctx.id, outcome: "success", signal: null, notes: null });

  const feedbackBefore = db.raw.prepare(`SELECT * FROM feedback_events`).all();
  const outcomeBefore = db.raw.prepare(`SELECT * FROM outcome_events`).all();
  const memoriesBefore = db.raw.prepare(`SELECT * FROM memories`).all();

  await perf.rebuildAll();

  assert.deepEqual(db.raw.prepare(`SELECT * FROM feedback_events`).all(), feedbackBefore);
  assert.deepEqual(db.raw.prepare(`SELECT * FROM outcome_events`).all(), outcomeBefore);
  assert.deepEqual(db.raw.prepare(`SELECT * FROM memories`).all(), memoriesBefore);
  db.close();
});

// --- Shared conformance -------------------------------------------------------

/** Inserts a bare `memories` row directly (bypassing the repository, which cannot accept a
 * caller-chosen id) purely as an FK target for a hand-seeded memory_performance row -- this is
 * a read-side (getPerformanceBatch) conformance harness, not a test of memory creation. */
function insertBareMemory(db: Database.Database, id: string): void {
  const now = new Date().toISOString();
  db.prepare(
    `INSERT INTO memories (id, type, content, domain, scope_kind, scope_id, source_origin, confidence, status, tags, supersedes, created_at, updated_at)
     VALUES (?, 'fact', 'conformance fixture', NULL, 'global', NULL, 'system', 0.5, 'active', '[]', NULL, ?, ?)`,
  ).run(id, now, now);
}

function insertPerformanceRow(db: Database.Database, raw: MemoryPerformanceRaw): void {
  db.prepare(
    `INSERT INTO memory_performance (
       memory_id, scope_key, useful_count, not_useful_count, redundant_reason_count, incorrect_reason_count,
       diluted_success_evidence, diluted_failure_evidence, success_context_count, failure_context_count,
       labeled_context_count, last_feedback_at, last_outcome_at
     ) VALUES (@memoryId, @scopeKey, @usefulCount, @notUsefulCount, @redundantReasonCount, @incorrectReasonCount,
       @dilutedSuccessEvidence, @dilutedFailureEvidence, @successContextCount, @failureContextCount,
       @labeledContextCount, @lastFeedbackAt, @lastOutcomeAt)`,
  ).run(raw);
}

// Phase 4.1's MemoryPerformanceStore read-side behavioural contract, run against the real
// implementation. The same body runs against FakeMemoryPerformanceStore in test-fixtures.
runMemoryPerformanceStoreConformance({
  name: "SqliteMemoryPerformanceStore",
  async setup(seeds) {
    const db = openDatabase(":memory:");
    for (const seed of seeds) {
      insertBareMemory(db.raw, seed.memoryId);
      insertPerformanceRow(db.raw, seed);
    }
    return { store: new SqliteMemoryPerformanceStore(db.raw), cleanup: () => db.close() };
  },
});
