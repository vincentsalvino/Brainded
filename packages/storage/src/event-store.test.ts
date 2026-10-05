import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { globalScope } from "@brain/contracts";
import { FakeEmbeddingProvider } from "@brain/test-fixtures";
import { openDatabase } from "./db.js";
import { SqliteEventStore } from "./event-store.js";
import { SqliteMemoryRepository } from "./memory-repository.js";

test("records and reads back all five event types", async () => {
  const db = openDatabase(":memory:");
  const events = new SqliteEventStore(db.raw);
  // feedback_events.memory_id and memory_mutation_events.memory_id carry a real FK
  // constraint (foreign_keys=ON) -- referencing a real memory here, not an
  // unconnected random id, is required for the constraint and correct as a test.
  const repo = new SqliteMemoryRepository(db.raw, new FakeEmbeddingProvider());
  const memory = await repo.create({ type: "fact", content: "fixture", scope: globalScope() });
  const memoryId = memory.id;

  const retrieval = await events.recordRetrieval({
    scope: globalScope(),
    queryText: "example query",
    candidateIds: [memoryId],
    taskId: "task-1",
  });
  await events.recordContext({
    retrievalEventId: retrieval.id,
    scope: globalScope(),
    taskId: "task-1",
    includedMemoryIds: [memoryId],
    omittedMemoryIds: [],
    memories: [], candidateCount: null, candidateTokenCount: null, retrievalMs: null, rankingMs: null, compileMs: null, optimizeMs: null, tokenCount: 42,
  });
  await events.recordOutcome({ taskId: "task-1", sessionId: null, contextId: null, outcome: "success", signal: null, notes: null });
  await events.recordFeedback({ memoryId, taskId: "task-1", contextId: null, reason: null, useful: true, notes: null });
  // Not calling recordMutation explicitly: repo.create() above already wrote one
  // (mutationType 'create') as its own required side effect -- that is the thing
  // under test in the mutation-event assertion below, not a second manual write.

  const forTask = await events.getEventsForTask("task-1");
  assert.equal(forTask.retrieval.length, 1);
  assert.equal(forTask.context.length, 1);
  assert.equal(forTask.outcome.length, 1);
  assert.equal(forTask.feedback.length, 1);

  const forMemory = await events.getEventsForMemory(memoryId);
  assert.equal(forMemory.length, 1);
  assert.equal(forMemory[0]?.useful, true);

  const mutations = await events.getMutationsForMemory(memoryId);
  assert.equal(mutations.length, 1);
  assert.equal(mutations[0]?.mutationType, "create");

  db.close();
});

test("ContextEvent correctly links back to its RetrievalEvent via retrievalEventId", async () => {
  const db = openDatabase(":memory:");
  const events = new SqliteEventStore(db.raw);

  const retrieval = await events.recordRetrieval({
    scope: globalScope(),
    queryText: "q",
    candidateIds: [],
    taskId: "task-2",
  });
  const context = await events.recordContext({
    retrievalEventId: retrieval.id,
    scope: globalScope(),
    taskId: "task-2",
    includedMemoryIds: [],
    omittedMemoryIds: [],
    memories: [], candidateCount: null, candidateTokenCount: null, retrievalMs: null, rankingMs: null, compileMs: null, optimizeMs: null, tokenCount: 0,
  });

  const forTask = await events.getEventsForTask("task-2");
  assert.equal(forTask.context[0]?.retrievalEventId, retrieval.id);
  assert.equal(context.retrievalEventId, retrieval.id);

  db.close();
});

test("distinguishes retrieved-but-omitted from included memories on a ContextEvent", async () => {
  const db = openDatabase(":memory:");
  const events = new SqliteEventStore(db.raw);
  const [includedId, omittedId] = [randomUUID(), randomUUID()];

  const retrieval = await events.recordRetrieval({
    scope: globalScope(),
    queryText: "q",
    candidateIds: [includedId, omittedId],
    taskId: "task-3",
  });
  await events.recordContext({
    retrievalEventId: retrieval.id,
    scope: globalScope(),
    taskId: "task-3",
    includedMemoryIds: [includedId],
    omittedMemoryIds: [omittedId],
    memories: [], candidateCount: null, candidateTokenCount: null, retrievalMs: null, rankingMs: null, compileMs: null, optimizeMs: null, tokenCount: 10,
  });

  const forTask = await events.getEventsForTask("task-3");
  assert.deepEqual(forTask.context[0]?.includedMemoryIds, [includedId]);
  assert.deepEqual(forTask.context[0]?.omittedMemoryIds, [omittedId]);

  db.close();
});

// --- P2-006: normalized context membership ---------------------------------

async function contextFixture() {
  const db = openDatabase(":memory:");
  const events = new SqliteEventStore(db.raw);
  const repo = new SqliteMemoryRepository(db.raw, new FakeEmbeddingProvider());
  const included = await repo.create({ type: "fact", content: "delivered memory", scope: globalScope() });
  const omitted = await repo.create({ type: "fact", content: "considered but not delivered", scope: globalScope() });
  const retrieval = await events.recordRetrieval({
    scope: globalScope(),
    queryText: "q",
    candidateIds: [included.id, omitted.id],
    taskId: "task-junction",
  });
  return { db, events, retrieval, includedId: included.id, omittedId: omitted.id };
}

const NO_TIMINGS = { retrievalMs: null, rankingMs: null, compileMs: null, optimizeMs: null };

test("P2-006: junction rows are written and read back with rank and delivered token cost", async () => {
  const { db, events, retrieval, includedId, omittedId } = await contextFixture();

  const written = await events.recordContext({
    retrievalEventId: retrieval.id,
    scope: globalScope(),
    taskId: "task-junction",
    includedMemoryIds: [includedId],
    omittedMemoryIds: [omittedId],
    tokenCount: 6,
    memories: [
      { memoryId: includedId, included: true, rank: 1, tokenCount: 6 },
      { memoryId: omittedId, included: false, rank: null, tokenCount: null },
    ],
    candidateCount: 2,
    candidateTokenCount: 17,
    retrievalMs: 3,
    rankingMs: 0,
    compileMs: 0,
    optimizeMs: 1,
  });

  const rows = db.raw
    .prepare(`SELECT * FROM context_event_memories WHERE context_event_id = ? ORDER BY included DESC`)
    .all(written.id) as {
    context_event_id: string;
    memory_id: string;
    included: number;
    rank: number | null;
    token_count: number | null;
  }[];
  assert.equal(rows.length, 2);
  assert.deepEqual(rows[0], {
    context_event_id: written.id,
    memory_id: includedId,
    included: 1,
    rank: 1,
    token_count: 6,
  });
  assert.deepEqual(rows[1], {
    context_event_id: written.id,
    memory_id: omittedId,
    included: 0,
    rank: null,
    token_count: null,
  });

  const readBack = await events.getContextEvent(written.id);
  assert.ok(readBack);
  assert.equal(readBack.candidateCount, 2);
  assert.equal(readBack.candidateTokenCount, 17);
  assert.equal(readBack.retrievalMs, 3);
  assert.equal(readBack.optimizeMs, 1);
  db.close();
});

test("P2-006: normalized rows reconstruct includedMemoryIds/omittedMemoryIds exactly", async () => {
  const { db, events, retrieval, includedId, omittedId } = await contextFixture();
  const written = await events.recordContext({
    retrievalEventId: retrieval.id,
    scope: globalScope(),
    taskId: "task-junction",
    includedMemoryIds: [includedId],
    omittedMemoryIds: [omittedId],
    tokenCount: 6,
    memories: [
      { memoryId: includedId, included: true, rank: 1, tokenCount: 6 },
      { memoryId: omittedId, included: false, rank: null, tokenCount: null },
    ],
    candidateCount: 2,
    candidateTokenCount: 17,
    ...NO_TIMINGS,
  });

  // The whole point of keeping both forms for one migration cycle: each must be
  // reconstructible from the other, verified against storage rather than assumed.
  const stored = await events.getContextEvent(written.id);
  assert.ok(stored);
  assert.deepEqual(
    stored.memories.filter((m) => m.included).map((m) => m.memoryId).sort(),
    [...stored.includedMemoryIds].sort(),
  );
  assert.deepEqual(
    stored.memories.filter((m) => !m.included).map((m) => m.memoryId).sort(),
    [...stored.omittedMemoryIds].sort(),
  );
  db.close();
});

test("P2-006: a divergent membership write is rejected loudly, before anything is stored", async () => {
  const { db, events, retrieval, includedId, omittedId } = await contextFixture();

  await assert.rejects(
    () =>
      events.recordContext({
        retrievalEventId: retrieval.id,
        scope: globalScope(),
        taskId: "task-junction",
        includedMemoryIds: [includedId, omittedId], // claims two were included...
        omittedMemoryIds: [],
        tokenCount: 6,
        memories: [{ memoryId: includedId, included: true, rank: 1, tokenCount: 6 }], // ...but names one
        candidateCount: 2,
        candidateTokenCount: 17,
        ...NO_TIMINGS,
      }),
    /context membership diverged/,
  );

  assert.equal(
    (db.raw.prepare(`SELECT COUNT(*) n FROM context_events`).get() as { n: number }).n,
    0,
    "nothing may be written when the two forms disagree",
  );
  db.close();
});

test("P2-006 atomicity: a failing junction write rolls back the context_events row too", async () => {
  const { db, events, retrieval, includedId } = await contextFixture();
  const ghost = randomUUID(); // no such memory -> FK violation on the junction insert

  await assert.rejects(() =>
    events.recordContext({
      retrievalEventId: retrieval.id,
      scope: globalScope(),
      taskId: "task-junction",
      includedMemoryIds: [includedId, ghost],
      omittedMemoryIds: [],
      tokenCount: 6,
      memories: [
        { memoryId: includedId, included: true, rank: 1, tokenCount: 4 },
        { memoryId: ghost, included: true, rank: 2, tokenCount: 2 },
      ],
      candidateCount: 2,
      candidateTokenCount: 17,
      ...NO_TIMINGS,
    }),
  );

  // A context event whose membership rows are missing is indistinguishable from a
  // genuinely empty delivery, so the whole record has to roll back together.
  assert.equal((db.raw.prepare(`SELECT COUNT(*) n FROM context_events`).get() as { n: number }).n, 0);
  assert.equal((db.raw.prepare(`SELECT COUNT(*) n FROM context_event_memories`).get() as { n: number }).n, 0);
  db.close();
});

test("P2-005: feedback and outcome persist contextId and reason", async () => {
  const { db, events, retrieval, includedId, omittedId } = await contextFixture();
  const ctx = await events.recordContext({
    retrievalEventId: retrieval.id,
    scope: globalScope(),
    taskId: "task-junction",
    includedMemoryIds: [includedId],
    omittedMemoryIds: [omittedId],
    tokenCount: 6,
    memories: [
      { memoryId: includedId, included: true, rank: 1, tokenCount: 6 },
      { memoryId: omittedId, included: false, rank: null, tokenCount: null },
    ],
    candidateCount: 2,
    candidateTokenCount: 17,
    ...NO_TIMINGS,
  });

  await events.recordFeedback({
    memoryId: includedId,
    taskId: "task-junction",
    contextId: ctx.id,
    useful: false,
    reason: "redundant",
    notes: null,
  });
  await events.recordOutcome({
    taskId: "task-junction",
    sessionId: null,
    contextId: ctx.id,
    outcome: "success",
    signal: null,
    notes: null,
  });

  const stored = await events.getEventsForTask("task-junction");
  assert.equal(stored.feedback[0]?.contextId, ctx.id);
  assert.equal(stored.feedback[0]?.reason, "redundant");
  assert.equal(stored.outcome[0]?.contextId, ctx.id);
  db.close();
});

test("P2-006: a pre-migration context row reads back with memories: [] rather than fabricated rows", async () => {
  const { db, events, retrieval, includedId } = await contextFixture();
  // A row as written before migration 0002: JSON arrays present, no junction rows.
  const legacyId = randomUUID();
  db.raw
    .prepare(
      `INSERT INTO context_events (id, timestamp, retrieval_event_id, scope_kind, scope_id, task_id, included_memory_ids, omitted_memory_ids, token_count)
       VALUES (?,?,?,?,?,?,?,?,?)`,
    )
    .run(
      legacyId,
      "2020-01-01T00:00:00.000Z",
      retrieval.id,
      "global",
      null,
      "task-junction",
      JSON.stringify([includedId]),
      "[]",
      12,
    );

  const stored = await events.getContextEvent(legacyId);
  assert.ok(stored);
  assert.deepEqual(stored.memories, [], "no per-item rank or token cost was ever observed, so none is invented");
  assert.deepEqual(stored.includedMemoryIds, [includedId]);
  assert.equal(stored.candidateTokenCount, null);
  db.close();
});

test("P2-005: getContextEvent returns null for an unknown id", async () => {
  const db = openDatabase(":memory:");
  const events = new SqliteEventStore(db.raw);
  assert.equal(await events.getContextEvent(randomUUID()), null);
  db.close();
});

// --- Phase 3.4: context_event_sources -----------------------------------

test("recordContextSources: writes rows readable back via getContextEventSources", async () => {
  const db = openDatabase(":memory:");
  const store = new SqliteEventStore(db.raw);
  const retrieval = await store.recordRetrieval({ scope: globalScope(), queryText: "q", candidateIds: [], taskId: null });
  const context = await store.recordContext({
    retrievalEventId: retrieval.id,
    scope: globalScope(),
    taskId: null,
    includedMemoryIds: [],
    omittedMemoryIds: [],
    tokenCount: 0,
    memories: [],
    candidateCount: null,
    candidateTokenCount: null,
    retrievalMs: null,
    rankingMs: null,
    compileMs: null,
    optimizeMs: null,
  });

  await store.recordContextSources(context.id, [
    { sourceType: "code", sourceId: "chunk-1", repositoryId: "repo-1", fileId: "file-1", relativePath: "src/a.ts", relation: null, depth: null, included: true, rank: 1, tokenCount: 40 },
    { sourceType: "dependency", sourceId: "file-1:file-2:dependency", repositoryId: "repo-1", fileId: "file-2", relativePath: "src/b.ts", relation: "dependency", depth: null, included: false, rank: null, tokenCount: null },
  ]);

  const rows = await store.getContextEventSources(context.id);
  assert.equal(rows.length, 2);
  assert.equal(rows[0]?.sourceType, "code");
  assert.equal(rows[1]?.relation, "dependency");
  db.close();
});

test("getContextEventSources: an unknown contextEventId returns an empty array, not an error", async () => {
  const db = openDatabase(":memory:");
  const store = new SqliteEventStore(db.raw);
  assert.deepEqual(await store.getContextEventSources("00000000-0000-0000-0000-000000000000"), []);
  db.close();
});

// --- Phase 4.1 (F12): recordFeedback/recordOutcome update memory_performance atomically -----

test("recordFeedback also updates memory_performance, in the same call", async () => {
  const { db, events, retrieval, includedId } = await contextFixture();
  const ctx = await events.recordContext({
    retrievalEventId: retrieval.id,
    scope: globalScope(),
    taskId: "task-junction",
    includedMemoryIds: [includedId],
    omittedMemoryIds: [],
    tokenCount: 1,
    memories: [{ memoryId: includedId, included: true, rank: 1, tokenCount: 1 }],
    candidateCount: 1,
    candidateTokenCount: 1,
    ...NO_TIMINGS,
  });
  await events.recordFeedback({ memoryId: includedId, taskId: "task-junction", contextId: ctx.id, useful: true, reason: null, notes: null });

  const row = db.raw.prepare(`SELECT useful_count FROM memory_performance WHERE memory_id = ?`).get(includedId) as
    | { useful_count: number }
    | undefined;
  assert.equal(row?.useful_count, 1);
  db.close();
});

test("recordOutcome also updates memory_performance for every included memory, in the same call", async () => {
  const { db, events, retrieval, includedId } = await contextFixture();
  const ctx = await events.recordContext({
    retrievalEventId: retrieval.id,
    scope: globalScope(),
    taskId: "task-junction",
    includedMemoryIds: [includedId],
    omittedMemoryIds: [],
    tokenCount: 1,
    memories: [{ memoryId: includedId, included: true, rank: 1, tokenCount: 1 }],
    candidateCount: 1,
    candidateTokenCount: 1,
    ...NO_TIMINGS,
  });
  await events.recordOutcome({ taskId: "task-junction", sessionId: null, contextId: ctx.id, outcome: "success", signal: null, notes: null });

  const row = db.raw.prepare(`SELECT success_context_count FROM memory_performance WHERE memory_id = ?`).get(includedId) as
    | { success_context_count: number }
    | undefined;
  assert.equal(row?.success_context_count, 1);
  db.close();
});

test("atomicity: if the memory_performance update fails, the raw feedback_events insert rolls back too", async () => {
  const { db, events, includedId } = await contextFixture();
  db.raw.exec(`DROP TABLE memory_performance`); // forces a real SQL error mid-transaction

  await assert.rejects(() =>
    events.recordFeedback({ memoryId: includedId, taskId: "task-junction", contextId: null, useful: true, reason: null, notes: null }),
  );

  assert.equal(
    (db.raw.prepare(`SELECT COUNT(*) n FROM feedback_events`).get() as { n: number }).n,
    0,
    "the raw event must not persist if its aggregate update failed in the same transaction",
  );
  db.close();
});

test("atomicity: if the memory_performance update fails, the raw outcome_events insert rolls back too", async () => {
  const { db, events, retrieval, includedId } = await contextFixture();
  const ctx = await events.recordContext({
    retrievalEventId: retrieval.id,
    scope: globalScope(),
    taskId: "task-junction",
    includedMemoryIds: [includedId],
    omittedMemoryIds: [],
    tokenCount: 1,
    memories: [{ memoryId: includedId, included: true, rank: 1, tokenCount: 1 }],
    candidateCount: 1,
    candidateTokenCount: 1,
    ...NO_TIMINGS,
  });
  db.raw.exec(`DROP TABLE memory_performance`);

  await assert.rejects(() =>
    events.recordOutcome({ taskId: "task-junction", sessionId: null, contextId: ctx.id, outcome: "success", signal: null, notes: null }),
  );

  assert.equal(
    (db.raw.prepare(`SELECT COUNT(*) n FROM outcome_events`).get() as { n: number }).n,
    0,
    "the raw event must not persist if its aggregate fan-out failed in the same transaction",
  );
  db.close();
});

// --- Observability reads (packages/visualizer) ------------------------------

function tick(ms = 2): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

test("getEventCounts reflects the row count of each of the four event tables", async () => {
  const { db, events, retrieval, includedId } = await contextFixture();
  const ctx = await events.recordContext({
    retrievalEventId: retrieval.id,
    scope: globalScope(),
    taskId: "task-junction",
    includedMemoryIds: [includedId],
    omittedMemoryIds: [],
    tokenCount: 1,
    memories: [{ memoryId: includedId, included: true, rank: 1, tokenCount: 1 }],
    candidateCount: 1,
    candidateTokenCount: 1,
    ...NO_TIMINGS,
  });
  await events.recordFeedback({ memoryId: includedId, taskId: "task-junction", contextId: ctx.id, useful: true, reason: null, notes: null });
  await events.recordOutcome({ taskId: "task-junction", sessionId: null, contextId: ctx.id, outcome: "success", signal: null, notes: null });

  const counts = await events.getEventCounts();
  assert.equal(counts.contextEvents, 1);
  assert.equal(counts.feedbackEvents, 1);
  assert.equal(counts.outcomeEvents, 1);
  assert.equal(counts.retrievalEvents, 1);
  db.close();
});

test("listRecentContextEvents: newest first, respects limit", async () => {
  const db = openDatabase(":memory:");
  const events = new SqliteEventStore(db.raw);
  const ids: string[] = [];
  for (let i = 0; i < 3; i++) {
    const retrieval = await events.recordRetrieval({ scope: globalScope(), queryText: `q${i}`, candidateIds: [], taskId: null });
    const ctx = await events.recordContext({
      retrievalEventId: retrieval.id,
      scope: globalScope(),
      taskId: null,
      includedMemoryIds: [],
      omittedMemoryIds: [],
      tokenCount: i,
      memories: [],
      candidateCount: null,
      candidateTokenCount: null,
      ...NO_TIMINGS,
    });
    ids.push(ctx.id);
    await tick();
  }

  assert.deepEqual((await events.listRecentContextEvents(10)).map((c) => c.id), [...ids].reverse());
  assert.deepEqual((await events.listRecentContextEvents(2)).map((c) => c.id), [ids[2], ids[1]]);
  db.close();
});

test("listRecentFeedbackEvents: newest first, respects limit", async () => {
  const { db, events, includedId } = await contextFixture();
  const ids: string[] = [];
  for (let i = 0; i < 3; i++) {
    const fb = await events.recordFeedback({ memoryId: includedId, taskId: null, contextId: null, useful: true, reason: null, notes: `note-${i}` });
    ids.push(fb.id);
    await tick();
  }
  assert.deepEqual((await events.listRecentFeedbackEvents(10)).map((f) => f.id), [...ids].reverse());
  assert.equal((await events.listRecentFeedbackEvents(1))[0]?.id, ids[2]);
  db.close();
});

test("listRecentOutcomeEvents: newest first, respects limit", async () => {
  const db = openDatabase(":memory:");
  const events = new SqliteEventStore(db.raw);
  const ids: string[] = [];
  for (let i = 0; i < 3; i++) {
    const outcome = await events.recordOutcome({ taskId: `task-${i}`, sessionId: null, contextId: null, outcome: "success", signal: null, notes: null });
    ids.push(outcome.id);
    await tick();
  }
  assert.deepEqual((await events.listRecentOutcomeEvents(10)).map((o) => o.id), [...ids].reverse());
  assert.equal((await events.listRecentOutcomeEvents(1))[0]?.id, ids[2]);
  db.close();
});

test("listRecentMutationEvents: newest first, respects limit, across different memories", async () => {
  const db = openDatabase(":memory:");
  const events = new SqliteEventStore(db.raw);
  const repo = new SqliteMemoryRepository(db.raw, new FakeEmbeddingProvider());
  const first = await repo.create({ type: "fact", content: "one", scope: globalScope() });
  await tick();
  const second = await repo.create({ type: "fact", content: "two", scope: globalScope() });
  await tick();
  await repo.update({ id: first.id, content: "one, updated" }, globalScope());

  const recent = await events.listRecentMutationEvents(10);
  assert.deepEqual(recent.map((m) => m.memoryId), [first.id, second.id, first.id]);
  assert.deepEqual(recent.map((m) => m.mutationType), ["update", "create", "create"]);

  const limited = await events.listRecentMutationEvents(1);
  assert.equal(limited.length, 1);
  assert.equal(limited[0]?.mutationType, "update");
  db.close();
});

test("getFeedbackForContext / getOutcomesForContext: isolate by exact contextId, not taskId -- two deliveries sharing one taskId don't leak into each other", async () => {
  const db = openDatabase(":memory:");
  const events = new SqliteEventStore(db.raw);
  const repo = new SqliteMemoryRepository(db.raw, new FakeEmbeddingProvider());
  const memory = await repo.create({ type: "fact", content: "shared", scope: globalScope() });

  const retrieval = await events.recordRetrieval({ scope: globalScope(), queryText: "q", candidateIds: [memory.id], taskId: "shared-task" });
  const ctxA = await events.recordContext({
    retrievalEventId: retrieval.id,
    scope: globalScope(),
    taskId: "shared-task",
    includedMemoryIds: [memory.id],
    omittedMemoryIds: [],
    tokenCount: 1,
    memories: [{ memoryId: memory.id, included: true, rank: 1, tokenCount: 1 }],
    candidateCount: 1,
    candidateTokenCount: 1,
    ...NO_TIMINGS,
  });
  const ctxB = await events.recordContext({
    retrievalEventId: retrieval.id,
    scope: globalScope(),
    taskId: "shared-task",
    includedMemoryIds: [memory.id],
    omittedMemoryIds: [],
    tokenCount: 1,
    memories: [{ memoryId: memory.id, included: true, rank: 1, tokenCount: 1 }],
    candidateCount: 1,
    candidateTokenCount: 1,
    ...NO_TIMINGS,
  });

  await events.recordFeedback({ memoryId: memory.id, taskId: "shared-task", contextId: ctxA.id, useful: true, reason: null, notes: "for A only" });
  await events.recordOutcome({ taskId: "shared-task", sessionId: null, contextId: ctxA.id, outcome: "success", signal: null, notes: null });

  assert.equal((await events.getFeedbackForContext(ctxA.id)).length, 1);
  assert.equal((await events.getFeedbackForContext(ctxB.id)).length, 0);
  assert.equal((await events.getOutcomesForContext(ctxA.id)).length, 1);
  assert.equal((await events.getOutcomesForContext(ctxB.id)).length, 0);
  db.close();
});

test("getFeedbackForContext / getOutcomesForContext: a context delivered with taskId=null still resolves its own feedback/outcome", async () => {
  const db = openDatabase(":memory:");
  const events = new SqliteEventStore(db.raw);
  const repo = new SqliteMemoryRepository(db.raw, new FakeEmbeddingProvider());
  const memory = await repo.create({ type: "fact", content: "no task", scope: globalScope() });

  const retrieval = await events.recordRetrieval({ scope: globalScope(), queryText: "q", candidateIds: [memory.id], taskId: null });
  const ctx = await events.recordContext({
    retrievalEventId: retrieval.id,
    scope: globalScope(),
    taskId: null,
    includedMemoryIds: [memory.id],
    omittedMemoryIds: [],
    tokenCount: 1,
    memories: [{ memoryId: memory.id, included: true, rank: 1, tokenCount: 1 }],
    candidateCount: 1,
    candidateTokenCount: 1,
    ...NO_TIMINGS,
  });
  await events.recordFeedback({ memoryId: memory.id, taskId: null, contextId: ctx.id, useful: true, reason: null, notes: null });
  await events.recordOutcome({ taskId: "orphan-task", sessionId: null, contextId: ctx.id, outcome: "success", signal: null, notes: null });

  assert.equal((await events.getFeedbackForContext(ctx.id)).length, 1);
  assert.equal((await events.getOutcomesForContext(ctx.id)).length, 1);
  db.close();
});

test("countDeliveriesForMemory: counts only deliveries where the memory was actually included", async () => {
  const db = openDatabase(":memory:");
  const events = new SqliteEventStore(db.raw);
  const repo = new SqliteMemoryRepository(db.raw, new FakeEmbeddingProvider());
  const memory = await repo.create({ type: "fact", content: "delivered sometimes", scope: globalScope() });
  const other = await repo.create({ type: "fact", content: "other", scope: globalScope() });

  const retrieval = await events.recordRetrieval({ scope: globalScope(), queryText: "q", candidateIds: [memory.id, other.id], taskId: null });
  const baseContext = {
    retrievalEventId: retrieval.id,
    scope: globalScope(),
    taskId: null,
    ...NO_TIMINGS,
  };
  // included
  await events.recordContext({
    ...baseContext,
    includedMemoryIds: [memory.id],
    omittedMemoryIds: [],
    tokenCount: 1,
    memories: [{ memoryId: memory.id, included: true, rank: 1, tokenCount: 1 }],
    candidateCount: 1,
    candidateTokenCount: 1,
  });
  // included again
  await events.recordContext({
    ...baseContext,
    includedMemoryIds: [memory.id],
    omittedMemoryIds: [],
    tokenCount: 1,
    memories: [{ memoryId: memory.id, included: true, rank: 1, tokenCount: 1 }],
    candidateCount: 1,
    candidateTokenCount: 1,
  });
  // omitted -- must not count
  await events.recordContext({
    ...baseContext,
    includedMemoryIds: [other.id],
    omittedMemoryIds: [memory.id],
    tokenCount: 1,
    memories: [
      { memoryId: other.id, included: true, rank: 1, tokenCount: 1 },
      { memoryId: memory.id, included: false, rank: null, tokenCount: null },
    ],
    candidateCount: 2,
    candidateTokenCount: 2,
  });

  assert.equal(await events.countDeliveriesForMemory(memory.id), 2);
  assert.equal(await events.countDeliveriesForMemory(other.id), 1);
  db.close();
});

test("getWorkflowAdherence: counts tasks by pipeline stage reached, including an outcome with no matching preflight", async () => {
  const db = openDatabase(":memory:");
  const events = new SqliteEventStore(db.raw);
  const repo = new SqliteMemoryRepository(db.raw, new FakeEmbeddingProvider());
  const memory = await repo.create({ type: "fact", content: "fixture", scope: globalScope() });

  // task-a: context, feedback, and outcome -- full adherence.
  const retrievalA = await events.recordRetrieval({ scope: globalScope(), queryText: "q", candidateIds: [memory.id], taskId: "task-a" });
  await events.recordContext({
    retrievalEventId: retrievalA.id,
    scope: globalScope(),
    taskId: "task-a",
    includedMemoryIds: [memory.id],
    omittedMemoryIds: [],
    tokenCount: 1,
    memories: [{ memoryId: memory.id, included: true, rank: 1, tokenCount: 1 }],
    candidateCount: 1,
    candidateTokenCount: 1,
    ...NO_TIMINGS,
  });
  await events.recordFeedback({ memoryId: memory.id, taskId: "task-a", contextId: null, useful: true, reason: null, notes: null });
  await events.recordOutcome({ taskId: "task-a", sessionId: null, contextId: null, outcome: "success", signal: null, notes: null });

  // task-b: context only -- preflight ran, no feedback or outcome recorded yet.
  const retrievalB = await events.recordRetrieval({ scope: globalScope(), queryText: "q", candidateIds: [memory.id], taskId: "task-b" });
  await events.recordContext({
    retrievalEventId: retrievalB.id,
    scope: globalScope(),
    taskId: "task-b",
    includedMemoryIds: [],
    omittedMemoryIds: [memory.id],
    tokenCount: 0,
    memories: [{ memoryId: memory.id, included: false, rank: null, tokenCount: null }],
    candidateCount: 1,
    candidateTokenCount: 1,
    ...NO_TIMINGS,
  });

  // task-c: an outcome with no preceding context event -- the missing-preflight case.
  await events.recordOutcome({ taskId: "task-c", sessionId: null, contextId: null, outcome: "success", signal: null, notes: null });

  const adherence = await events.getWorkflowAdherence();
  assert.equal(adherence.tasksTracked, 3);
  assert.equal(adherence.tasksWithContext, 2);
  assert.equal(adherence.tasksWithFeedback, 1);
  assert.equal(adherence.tasksWithOutcome, 2);
  db.close();
});

test("getWorkflowAdherence: an empty database reports all-zero, not a division error", async () => {
  const db = openDatabase(":memory:");
  const events = new SqliteEventStore(db.raw);
  assert.deepEqual(await events.getWorkflowAdherence(), {
    tasksTracked: 0,
    tasksWithContext: 0,
    tasksWithFeedback: 0,
    tasksWithOutcome: 0,
  });
  db.close();
});
