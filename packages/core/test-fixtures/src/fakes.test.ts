import { test } from "node:test";
import assert from "node:assert/strict";
import { globalScope, projectScope, sessionScope } from "@brain/contracts";
import { FakeEventStore } from "./fake-event-store.js";
import { FakeMemoryRepository } from "./fake-memory-repository.js";
import { FakeRetrievalStore } from "./fake-retrieval-store.js";
import { FakeCodebaseRepository } from "./fake-codebase-repository.js";
import { FakeCodeSearchStore } from "./fake-code-search-store.js";
import { FakeCodeDependencyStore } from "./fake-code-dependency-store.js";
import { FakeEmbeddingProvider } from "./fake-embedding-provider.js";
import { FakeMemoryPerformanceStore } from "./fake-memory-performance-store.js";
import { oneOfEachMemoryType, crossScopeFixture, buildMemoryRecord } from "./fixtures.js";
import { runRetrievalStoreConformance } from "./store-conformance.js";
import { runCodeSearchStoreConformance } from "./code-store-conformance.js";
import { runCodeDependencyStoreConformance } from "./code-dependency-conformance.js";
import { runMemoryPerformanceStoreConformance } from "./memory-performance-conformance.js";

test("fixtures: oneOfEachMemoryType covers all 12 types", () => {
  const records = oneOfEachMemoryType();
  assert.equal(new Set(records.map((r) => r.type)).size, 12);
});

test("FakeEventStore: recordContextSources tracked per contextEventId, readable back", async () => {
  const store = new FakeEventStore();
  await store.recordContextSources("ctx-1", [
    { sourceType: "code", sourceId: "chunk-1", repositoryId: "repo-1", fileId: "file-1", relativePath: "a.ts", relation: null, depth: null, included: true, rank: 1, tokenCount: 10 },
  ]);
  const rows = await store.getContextEventSources("ctx-1");
  assert.equal(rows.length, 1);
  assert.equal(await store.getContextEventSources("ctx-2").then((r) => r.length), 0);
});

test("FakeMemoryRepository: create records exactly one mutation event", async () => {
  const events = new FakeEventStore();
  const repo = new FakeMemoryRepository(events);
  const record = await repo.create({ type: "fact", content: "hello", scope: globalScope() });
  const mutations = await events.getMutationsForMemory(record.id);
  assert.equal(mutations.length, 1);
  assert.equal(mutations[0]?.mutationType, "create");
});

test("FakeMemoryRepository: update and archive each record exactly one further mutation event", async () => {
  const events = new FakeEventStore();
  const repo = new FakeMemoryRepository(events);
  const record = await repo.create({ type: "fact", content: "hello", scope: globalScope() });
  await repo.update({ id: record.id, content: "hello again" }, globalScope());
  await repo.archive(record.id, globalScope());
  const mutations = await events.getMutationsForMemory(record.id);
  assert.equal(mutations.length, 3);
  assert.deepEqual(mutations.map((m) => m.mutationType), ["create", "update", "archive"]);
});

test("FakeMemoryRepository: scope isolation -- a project-scoped record is invisible under a different project scope", async () => {
  const repo = new FakeMemoryRepository(new FakeEventStore());
  const record = await repo.create({ type: "fact", content: "secret", scope: projectScope("project-a") });
  assert.equal(await repo.get(record.id, projectScope("project-a")), record);
  assert.equal(await repo.get(record.id, projectScope("project-b")), null);
  assert.equal(await repo.get(record.id, globalScope()), null);
});

test("FakeMemoryRepository: a global record is visible from any scope", async () => {
  const repo = new FakeMemoryRepository(new FakeEventStore());
  const record = await repo.create({ type: "fact", content: "universal", scope: globalScope() });
  assert.ok(await repo.get(record.id, projectScope("project-a")));
  assert.ok(await repo.get(record.id, sessionScope("session-x")));
});

test("FakeMemoryRepository: query never returns another scope's rows (adversarial near-identical content)", async () => {
  const repo = new FakeMemoryRepository(new FakeEventStore());
  const fixture = crossScopeFixture();
  await repo.create({ type: fixture.projectA.type, content: fixture.projectA.content, scope: fixture.projectA.scope });
  await repo.create({ type: fixture.projectB.type, content: fixture.projectB.content, scope: fixture.projectB.scope });
  const resultA = await repo.query({ scope: projectScope("project-a"), limit: 50 });
  assert.equal(resultA.items.length, 1);
  assert.equal(resultA.items[0]?.scope.id, "project-a");
});

test("FakeMemoryRepository: countAllMemories aggregates across every scope, unscoped, including archived", async () => {
  const repo = new FakeMemoryRepository(new FakeEventStore());
  await repo.create({ type: "fact", content: "g1", scope: globalScope() });
  await repo.create({ type: "rule", content: "p1", scope: projectScope("project-a") });
  const toArchive = await repo.create({ type: "fact", content: "will archive", scope: projectScope("project-b") });
  await repo.archive(toArchive.id, projectScope("project-b"));

  const counts = await repo.countAllMemories();
  assert.equal(counts.total, 3);
  assert.equal(counts.active, 2);
  assert.equal(counts.archived, 1);
  assert.equal(counts.byType.fact, 2);
  assert.equal(counts.byType.rule, 1);
  assert.equal(counts.byType.decision, 0);
});

function tick(ms = 2): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

test("FakeEventStore: getEventCounts reflects each array's length", async () => {
  const store = new FakeEventStore();
  await store.recordRetrieval({ scope: globalScope(), queryText: "q", candidateIds: [], taskId: null });
  await store.recordContext({
    retrievalEventId: "r1",
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
  await store.recordFeedback({ memoryId: "m1", taskId: null, contextId: null, useful: true, reason: null, notes: null });
  await store.recordOutcome({ taskId: "t1", sessionId: null, contextId: null, outcome: "success", signal: null, notes: null });

  assert.deepEqual(await store.getEventCounts(), { contextEvents: 1, feedbackEvents: 1, outcomeEvents: 1, retrievalEvents: 1 });
});

test("FakeEventStore: getWorkflowAdherence counts tasks by pipeline stage reached, including an outcome with no matching context", async () => {
  const store = new FakeEventStore();
  const baseContext = {
    retrievalEventId: "r1",
    scope: globalScope(),
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
  };
  // task-a: context, feedback, and outcome.
  await store.recordContext({ ...baseContext, taskId: "task-a" });
  await store.recordFeedback({ memoryId: "m1", taskId: "task-a", contextId: null, useful: true, reason: null, notes: null });
  await store.recordOutcome({ taskId: "task-a", sessionId: null, contextId: null, outcome: "success", signal: null, notes: null });
  // task-b: context only.
  await store.recordContext({ ...baseContext, taskId: "task-b" });
  // task-c: outcome with no preceding context -- the missing-preflight case.
  await store.recordOutcome({ taskId: "task-c", sessionId: null, contextId: null, outcome: "success", signal: null, notes: null });

  assert.deepEqual(await store.getWorkflowAdherence(), {
    tasksTracked: 3,
    tasksWithContext: 2,
    tasksWithFeedback: 1,
    tasksWithOutcome: 2,
  });
});

test("FakeEventStore: getWorkflowAdherence reports all-zero on an empty store", async () => {
  const store = new FakeEventStore();
  assert.deepEqual(await store.getWorkflowAdherence(), {
    tasksTracked: 0,
    tasksWithContext: 0,
    tasksWithFeedback: 0,
    tasksWithOutcome: 0,
  });
});

test("FakeEventStore: listRecent* return newest first and respect limit", async () => {
  const store = new FakeEventStore();
  const ids: string[] = [];
  for (let i = 0; i < 3; i++) {
    const fb = await store.recordFeedback({ memoryId: "m1", taskId: null, contextId: null, useful: true, reason: null, notes: `n${i}` });
    ids.push(fb.id);
    await tick();
  }
  assert.deepEqual((await store.listRecentFeedbackEvents(10)).map((f) => f.id), [...ids].reverse());
  assert.equal((await store.listRecentFeedbackEvents(1))[0]?.id, ids[2]);
});

test("FakeEventStore: getFeedbackForContext / getOutcomesForContext isolate by contextId", async () => {
  const store = new FakeEventStore();
  await store.recordFeedback({ memoryId: "m1", taskId: "shared", contextId: "ctx-a", useful: true, reason: null, notes: null });
  await store.recordFeedback({ memoryId: "m1", taskId: "shared", contextId: "ctx-b", useful: false, reason: "irrelevant", notes: null });
  await store.recordOutcome({ taskId: "shared", sessionId: null, contextId: "ctx-a", outcome: "success", signal: null, notes: null });

  assert.equal((await store.getFeedbackForContext("ctx-a")).length, 1);
  assert.equal((await store.getFeedbackForContext("ctx-b")).length, 1);
  assert.equal((await store.getOutcomesForContext("ctx-a")).length, 1);
  assert.equal((await store.getOutcomesForContext("ctx-b")).length, 0);
});

test("FakeEventStore: countDeliveriesForMemory counts only included deliveries", async () => {
  const store = new FakeEventStore();
  const base = { retrievalEventId: "r1", scope: globalScope(), taskId: null, candidateCount: null, candidateTokenCount: null, retrievalMs: null, rankingMs: null, compileMs: null, optimizeMs: null };
  await store.recordContext({ ...base, includedMemoryIds: ["m1"], omittedMemoryIds: [], tokenCount: 1, memories: [{ memoryId: "m1", included: true, rank: 1, tokenCount: 1 }] });
  await store.recordContext({ ...base, includedMemoryIds: [], omittedMemoryIds: ["m1"], tokenCount: 0, memories: [{ memoryId: "m1", included: false, rank: null, tokenCount: null }] });

  assert.equal(await store.countDeliveriesForMemory("m1"), 1);
});

test("FakeMemoryRepository: listAllMemories excludes archived and respects an optional scope filter", async () => {
  const repo = new FakeMemoryRepository(new FakeEventStore());
  await repo.create({ type: "fact", content: "global", scope: globalScope() });
  const archived = await repo.create({ type: "fact", content: "archived", scope: globalScope() });
  await repo.archive(archived.id, globalScope());
  await repo.create({ type: "fact", content: "project-a", scope: projectScope("project-a") });

  const all = await repo.listAllMemories();
  assert.equal(all.length, 2);

  const forA = await repo.listAllMemories({ scope: projectScope("project-a") });
  assert.equal(forA.length, 2); // global + project-a's own
});

test("FakeMemoryRepository: getMemoryById finds regardless of scope; null for unknown", async () => {
  const repo = new FakeMemoryRepository(new FakeEventStore());
  const record = await repo.create({ type: "fact", content: "x", scope: projectScope("project-a") });
  assert.equal((await repo.getMemoryById(record.id))?.id, record.id);
  assert.equal(await repo.getMemoryById("nope"), null);
});

test("FakeRetrievalStore: lexicalSearch respects scope and returns overlap-scored candidates", async () => {
  const store = new FakeRetrievalStore([
    buildMemoryRecord({ content: "use conventional commits for this repository", scope: globalScope() }),
    buildMemoryRecord({ content: "totally unrelated content", scope: globalScope() }),
  ]);
  const results = await store.lexicalSearch({ text: "conventional commits", scope: globalScope(), limit: 10 });
  assert.equal(results.length, 1);
  assert.ok((results[0]?.signals.lexicalScore ?? 0) > 0);
});

test("FakeRetrievalStore: semanticSearch failure can be simulated for degradation tests", async () => {
  const store = new FakeRetrievalStore();
  store.simulateSemanticFailure(true);
  await assert.rejects(() => store.semanticSearch({ text: "anything", scope: globalScope(), limit: 10 }));
});

test("FakeCodebaseRepository: findRepository is scope-isolated by (scope, rootPath)", async () => {
  const repo = new FakeCodebaseRepository();
  const created = await repo.createRepository(projectScope("project-a"), "/repo");
  assert.equal((await repo.findRepository(projectScope("project-a"), "/repo"))?.id, created.id);
  assert.equal(await repo.findRepository(projectScope("project-b"), "/repo"), null);
});

test("FakeCodebaseRepository: replaceFile upserts by id and wholesale-replaces chunks", async () => {
  const repo = new FakeCodebaseRepository();
  const { id: repositoryId } = await repo.createRepository(globalScope(), "/repo");
  const fileBase = {
    id: "file-1",
    repositoryId,
    scope: globalScope(),
    relativePath: "a.ts",
    language: "typescript",
    sizeBytes: 1,
    indexedAt: new Date().toISOString(),
  };
  const chunkBase = { fileId: "file-1", repositoryId, scope: globalScope(), relativePath: "a.ts", startLine: 1, endLine: 1, content: "x" };

  await repo.replaceFile(
    { ...fileBase, contentHash: "h1" },
    [{ ...chunkBase, id: "c1", chunkIndex: 0, contentHash: "h1" }],
  );
  const { chunksRemoved } = await repo.replaceFile(
    { ...fileBase, contentHash: "h2" },
    [{ ...chunkBase, id: "c2", chunkIndex: 0, contentHash: "h2" }],
  );
  assert.equal(chunksRemoved, 1);
  const files = await repo.listFiles(repositoryId);
  assert.equal(files.length, 1, "same file id must update in place, not duplicate");
  assert.equal(files[0]?.contentHash, "h2");
});

test("FakeCodebaseRepository: removeFile deletes the file and reports its chunk count", async () => {
  const repo = new FakeCodebaseRepository();
  const { id: repositoryId } = await repo.createRepository(globalScope(), "/repo");
  const file = {
    id: "file-1",
    repositoryId,
    scope: globalScope(),
    relativePath: "a.ts",
    language: null,
    sizeBytes: 1,
    contentHash: "h1",
    indexedAt: new Date().toISOString(),
  };
  await repo.replaceFile(file, [
    { id: "c1", fileId: "file-1", repositoryId, scope: globalScope(), relativePath: "a.ts", chunkIndex: 0, startLine: 1, endLine: 1, content: "x", contentHash: "h1" },
  ]);
  const { chunksRemoved } = await repo.removeFile("file-1");
  assert.equal(chunksRemoved, 1);
  assert.deepEqual(await repo.listFiles(repositoryId), []);
});

// P2-001: the shared RetrievalStore behavioural contract, run against the fake.
// The same body runs against SqliteRetrievalStore in packages/storage -- that is
// the whole point: one contract, every implementation.
runRetrievalStoreConformance({
  name: "FakeRetrievalStore",
  async setup(seeds) {
    const store = new FakeRetrievalStore(
      seeds.map((seed) => buildMemoryRecord({ content: seed.content, scope: seed.scope, status: seed.status ?? "active" })),
    );
    return { store, cleanup: () => {} };
  },
});

test("FakeCodeSearchStore: lexicalSearch respects scope and returns overlap-scored results", async () => {
  const store = new FakeCodeSearchStore(new FakeEmbeddingProvider());
  store.index({
    id: "c1",
    fileId: "f1",
    repositoryId: "repo-1",
    scope: globalScope(),
    relativePath: "src/a.ts",
    chunkIndex: 0,
    startLine: 1,
    endLine: 1,
    content: "use conventional commits for this repository",
    contentHash: "h1",
  });
  const results = await store.lexicalSearch({ text: "conventional commits", scope: globalScope(), limit: 10 });
  assert.equal(results.length, 1);
  assert.ok((results[0]?.signals.lexicalScore ?? 0) > 0);
});

test("FakeCodeSearchStore: semanticSearch failure can be simulated for degradation tests", async () => {
  const store = new FakeCodeSearchStore(new FakeEmbeddingProvider());
  store.simulateSemanticFailure(true);
  await assert.rejects(() => store.semanticSearch({ text: "anything", scope: globalScope(), limit: 10 }));
});

test("FakeCodeSearchStore: syncEmbeddings embeds new chunks once, then reports the rest unchanged", async () => {
  const store = new FakeCodeSearchStore(new FakeEmbeddingProvider());
  store.index({
    id: "c1",
    fileId: "f1",
    repositoryId: "repo-1",
    scope: globalScope(),
    relativePath: "src/a.ts",
    chunkIndex: 0,
    startLine: 1,
    endLine: 1,
    content: "alpha",
    contentHash: "h1",
  });
  const first = await store.syncEmbeddings("repo-1");
  assert.deepEqual(first, { chunksEmbedded: 1, chunksUnchanged: 0, chunksRemoved: 0, available: true });
  const second = await store.syncEmbeddings("repo-1");
  assert.deepEqual(second, { chunksEmbedded: 0, chunksUnchanged: 1, chunksRemoved: 0, available: true });
});

// Phase 3.2's CodeSearchStore behavioural contract, run against the fake. The same
// body runs against SqliteCodeSearchStore in packages/storage.
runCodeSearchStoreConformance({
  name: "FakeCodeSearchStore",
  async setup(seeds) {
    const store = new FakeCodeSearchStore(new FakeEmbeddingProvider());
    const repositoryIds = new Set<string>();
    seeds.forEach((seed, i) => {
      const repositoryId = seed.repositoryId ?? "repo-default";
      repositoryIds.add(repositoryId);
      store.index(
        {
          id: `chunk-${i}`,
          fileId: `file-${i}`,
          repositoryId,
          scope: seed.scope,
          relativePath: seed.relativePath,
          chunkIndex: 0,
          startLine: 1,
          endLine: 1,
          content: seed.content,
          contentHash: `hash-${i}`,
        },
        seed.language ?? null,
      );
    });
    for (const repositoryId of repositoryIds) {
      await store.syncEmbeddings(repositoryId);
    }
    return { store, cleanup: () => {} };
  },
});

// Phase 3.3's CodeDependencyStore behavioural contract, run against the fake. The
// same body runs against SqliteCodeDependencyStore in packages/storage.
runCodeDependencyStoreConformance({
  name: "FakeCodeDependencyStore",
  async setup() {
    return { store: new FakeCodeDependencyStore(), cleanup: () => {} };
  },
});

test("FakeMemoryPerformanceStore: seed() makes a row visible via getPerformanceBatch", async () => {
  const store = new FakeMemoryPerformanceStore();
  const raw = {
    memoryId: "11111111-1111-4111-8111-111111111111",
    scopeKey: "*",
    usefulCount: 2,
    notUsefulCount: 0,
    redundantReasonCount: 0,
    incorrectReasonCount: 0,
    dilutedSuccessEvidence: 0,
    dilutedFailureEvidence: 0,
    successContextCount: 0,
    failureContextCount: 0,
    labeledContextCount: 2,
    lastFeedbackAt: null,
    lastOutcomeAt: null,
  };
  store.seed(raw);
  assert.deepEqual((await store.getPerformanceBatch([raw.memoryId])).get(raw.memoryId), raw);
});

test("FakeMemoryPerformanceStore: getPerformanceBatchCallCount tracks real reads, for zero-I/O assertions", async () => {
  const store = new FakeMemoryPerformanceStore();
  assert.equal(store.getPerformanceBatchCallCount, 0);
  await store.getPerformanceBatch([]);
  await store.getPerformanceBatch(["11111111-1111-4111-8111-111111111111"]);
  assert.equal(store.getPerformanceBatchCallCount, 2);
});

test("FakeMemoryPerformanceStore: simulateFailure makes getPerformanceBatch reject, for degradation tests", async () => {
  const store = new FakeMemoryPerformanceStore();
  store.simulateFailure(true);
  await assert.rejects(() => store.getPerformanceBatch(["11111111-1111-4111-8111-111111111111"]));
  store.simulateFailure(false);
  await assert.doesNotReject(() => store.getPerformanceBatch([]));
});

test("FakeMemoryPerformanceStore: rebuildAll reports the current seeded row count", async () => {
  const store = new FakeMemoryPerformanceStore();
  assert.equal((await store.rebuildAll()).memoriesRebuilt, 0);
  store.seed({
    memoryId: "22222222-2222-4222-8222-222222222222",
    scopeKey: "*",
    usefulCount: 1,
    notUsefulCount: 0,
    redundantReasonCount: 0,
    incorrectReasonCount: 0,
    dilutedSuccessEvidence: 0,
    dilutedFailureEvidence: 0,
    successContextCount: 0,
    failureContextCount: 0,
    labeledContextCount: 1,
    lastFeedbackAt: null,
    lastOutcomeAt: null,
  });
  assert.equal((await store.rebuildAll()).memoriesRebuilt, 1);
});

// Phase 4.1's MemoryPerformanceStore read-side behavioural contract, run against the fake. The
// same body runs against SqliteMemoryPerformanceStore in packages/storage.
runMemoryPerformanceStoreConformance({
  name: "FakeMemoryPerformanceStore",
  async setup(seeds) {
    const store = new FakeMemoryPerformanceStore();
    for (const seed of seeds) store.seed(seed);
    return { store, cleanup: () => {} };
  },
});
