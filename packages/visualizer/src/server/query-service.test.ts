import { test } from "node:test";
import assert from "node:assert/strict";
import { globalScope, projectScope } from "@brain/contracts";
import { FakeEventStore, FakeMemoryRepository, FakeRetrievalStore, FakeMemoryPerformanceStore } from "@brain/test-fixtures";
import { VisualizerQueryService } from "./query-service.js";

function tick(ms = 2): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function setup() {
  const eventStore = new FakeEventStore();
  const memoryRepo = new FakeMemoryRepository(eventStore);
  const retrievalStore = new FakeRetrievalStore();
  const performanceStore = new FakeMemoryPerformanceStore();
  const queryService = new VisualizerQueryService(memoryRepo, eventStore, retrievalStore, performanceStore, {
    vectorSearchAvailable: true,
    appliedMigrations: ["0001_initial_schema.sql"],
  });
  return { queryService, memoryRepo, eventStore, retrievalStore, performanceStore };
}

/** memoryRepo.create() alone doesn't make a record visible to findSimilarPairs -- FakeRetrievalStore is a separate store, kept in sync explicitly, same as gateway.test.ts's convention. */
async function createIndexed(
  memoryRepo: FakeMemoryRepository,
  retrievalStore: FakeRetrievalStore,
  input: Parameters<FakeMemoryRepository["create"]>[0],
) {
  const record = await memoryRepo.create(input);
  retrievalStore.index(record);
  return record;
}

const NO_TIMINGS = { retrievalMs: null, rankingMs: null, compileMs: null, optimizeMs: null };

test("getOverview: merges the four recent-event kinds into one feed sorted newest-first", async () => {
  const { queryService, eventStore, memoryRepo } = setup();

  const memory = await memoryRepo.create({ type: "fact", content: "x", scope: globalScope() }); // mutation #1
  await tick();
  const retrieval = await eventStore.recordRetrieval({ scope: globalScope(), queryText: "q", candidateIds: [memory.id], taskId: null });
  await tick();
  const ctx = await eventStore.recordContext({
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
  await tick();
  await eventStore.recordFeedback({ memoryId: memory.id, taskId: null, contextId: ctx.id, useful: true, reason: null, notes: null });
  await tick();
  await eventStore.recordOutcome({ taskId: "task-x", sessionId: null, contextId: ctx.id, outcome: "success", signal: null, notes: null });

  const overview = await queryService.getOverview();
  // call order: mutation, (retrieval -- not part of the feed), context, feedback, outcome
  assert.deepEqual(overview.recentActivity.map((a) => a.kind), ["outcome", "feedback", "context", "mutation"]);
});

test("getOverview: recentActivity caps at 20 and keeps the most recent, not an arbitrary 20", async () => {
  const { queryService, eventStore } = setup();
  const notes: string[] = [];
  for (let i = 0; i < 23; i++) {
    await eventStore.recordFeedback({ memoryId: "m", taskId: null, contextId: null, useful: true, reason: null, notes: `n${i}` });
    notes.push(`n${i}`);
    await tick();
  }
  const overview = await queryService.getOverview();
  assert.equal(overview.recentActivity.length, 20);
  const seenNotes = overview.recentActivity.map((a) => (a.kind === "feedback" ? a.event.notes : null));
  assert.deepEqual(seenNotes, [...notes].slice(3).reverse());
});

test("getOverview: memory/event counts pass through countAllMemories/getEventCounts unchanged", async () => {
  const { queryService, memoryRepo } = setup();
  await memoryRepo.create({ type: "fact", content: "a", scope: globalScope() });
  await memoryRepo.create({ type: "rule", content: "b", scope: globalScope() });

  const overview = await queryService.getOverview();
  assert.equal(overview.memories.total, 2);
  assert.equal(overview.memories.byType.fact, 1);
  assert.equal(overview.memories.byType.rule, 1);
  assert.equal(overview.events.contextEvents, 0);
});

test("getOverview: vectorSearchAvailable/appliedMigrations come from injected capabilities; learning/redundancy are both false", async () => {
  const { queryService } = setup();
  const overview = await queryService.getOverview();
  assert.equal(overview.vectorSearchAvailable, true);
  assert.deepEqual(overview.appliedMigrations, ["0001_initial_schema.sql"]);
  assert.equal(overview.learning.enabled, false);
  assert.equal(overview.redundancy.enabled, false);
});

test("getOverview: workflow passes through EventStore.getWorkflowAdherence unchanged", async () => {
  const { queryService, eventStore } = setup();
  await eventStore.recordOutcome({ taskId: "task-untracked-context", sessionId: null, contextId: null, outcome: "success", signal: null, notes: null });

  const overview = await queryService.getOverview();
  assert.deepEqual(overview.workflow, { tasksTracked: 1, tasksWithContext: 0, tasksWithFeedback: 0, tasksWithOutcome: 1 });
});

test("listContexts: passes through listRecentContextEvents", async () => {
  const { queryService, eventStore } = setup();
  const retrieval = await eventStore.recordRetrieval({ scope: globalScope(), queryText: "q", candidateIds: [], taskId: null });
  await eventStore.recordContext({
    retrievalEventId: retrieval.id,
    scope: globalScope(),
    taskId: null,
    includedMemoryIds: [],
    omittedMemoryIds: [],
    tokenCount: 0,
    memories: [],
    candidateCount: null,
    candidateTokenCount: null,
    ...NO_TIMINGS,
  });

  const result = await queryService.listContexts();
  assert.equal(result.items.length, 1);
});

test("getContextDetail: returns null for an unknown id", async () => {
  const { queryService } = setup();
  assert.equal(await queryService.getContextDetail("00000000-0000-0000-0000-000000000000"), null);
});

test("getContextDetail: combines context + sources + feedback + outcomes for that exact id", async () => {
  const { queryService, eventStore, memoryRepo } = setup();
  const memory = await memoryRepo.create({ type: "fact", content: "x", scope: globalScope() });
  const retrieval = await eventStore.recordRetrieval({ scope: globalScope(), queryText: "q", candidateIds: [memory.id], taskId: "t1" });
  const ctx = await eventStore.recordContext({
    retrievalEventId: retrieval.id,
    scope: globalScope(),
    taskId: "t1",
    includedMemoryIds: [memory.id],
    omittedMemoryIds: [],
    tokenCount: 1,
    memories: [{ memoryId: memory.id, included: true, rank: 1, tokenCount: 1 }],
    candidateCount: 1,
    candidateTokenCount: 1,
    ...NO_TIMINGS,
  });
  await eventStore.recordContextSources(ctx.id, [
    { sourceType: "code", sourceId: "c1", repositoryId: "r1", fileId: "f1", relativePath: "a.ts", relation: null, depth: null, included: true, rank: 1, tokenCount: 10 },
  ]);
  await eventStore.recordFeedback({ memoryId: memory.id, taskId: "t1", contextId: ctx.id, useful: true, reason: null, notes: null });
  await eventStore.recordOutcome({ taskId: "t1", sessionId: null, contextId: ctx.id, outcome: "success", signal: null, notes: null });

  const detail = await queryService.getContextDetail(ctx.id);
  assert.ok(detail);
  assert.equal(detail.context.id, ctx.id);
  assert.equal(detail.sources.length, 1);
  assert.equal(detail.feedback.length, 1);
  assert.equal(detail.outcomes.length, 1);
});

test("getContextDetail: a context delivered with taskId=null still resolves its own feedback/outcomes", async () => {
  const { queryService, eventStore, memoryRepo } = setup();
  const memory = await memoryRepo.create({ type: "fact", content: "x", scope: globalScope() });
  const retrieval = await eventStore.recordRetrieval({ scope: globalScope(), queryText: "q", candidateIds: [memory.id], taskId: null });
  const ctx = await eventStore.recordContext({
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
  await eventStore.recordFeedback({ memoryId: memory.id, taskId: null, contextId: ctx.id, useful: true, reason: null, notes: null });
  await eventStore.recordOutcome({ taskId: "orphan-task", sessionId: null, contextId: ctx.id, outcome: "success", signal: null, notes: null });

  const detail = await queryService.getContextDetail(ctx.id);
  assert.ok(detail);
  assert.equal(detail.feedback.length, 1);
  assert.equal(detail.outcomes.length, 1);
});

// --- Memory graph -----------------------------------------------------------

test("getMemoryGraph: returns MemoryRecord-backed nodes with a server-truncated content preview", async () => {
  const { queryService, memoryRepo, retrievalStore } = setup();
  await createIndexed(memoryRepo, retrievalStore, { type: "fact", content: "x".repeat(200), scope: globalScope() });

  const graph = await queryService.getMemoryGraph();
  assert.equal(graph.nodes.length, 1);
  assert.equal(graph.nodes[0]?.contentPreview.length, 141); // 140 chars + ellipsis
  assert.ok(graph.nodes[0]?.contentPreview.endsWith("…"));
  assert.equal(graph.meta.totalMemories, 1);
});

test("getMemoryGraph: similarity edges come from findSimilarPairs; threshold controls edge count", async () => {
  const { queryService, memoryRepo, retrievalStore } = setup();
  // jaccard(a,b) = 4/6 ~= 0.667 (>0.6 default); jaccard(*,c) = 0
  const a = await createIndexed(memoryRepo, retrievalStore, { type: "fact", content: "alpha beta gamma delta epsilon", scope: globalScope() });
  const b = await createIndexed(memoryRepo, retrievalStore, { type: "fact", content: "alpha beta gamma delta zeta", scope: globalScope() });
  await createIndexed(memoryRepo, retrievalStore, { type: "fact", content: "unrelated widgets gears mechanisms", scope: globalScope() });

  const atDefault = await queryService.getMemoryGraph();
  assert.equal(atDefault.similarityEdges.length, 1);
  assert.equal(atDefault.meta.threshold, 0.6);
  assert.ok(atDefault.similarityEdges.some((p) => [p.a, p.b].sort().join() === [a.id, b.id].sort().join()));

  const atZero = await queryService.getMemoryGraph({ minSimilarity: 0 });
  assert.equal(atZero.similarityEdges.length, 3); // every pair, including the zero-similarity ones
});

test("getMemoryGraph: no embedding/vector field anywhere in the response shape", async () => {
  const { queryService, memoryRepo, retrievalStore } = setup();
  await createIndexed(memoryRepo, retrievalStore, { type: "fact", content: "alpha beta", scope: globalScope() });
  await createIndexed(memoryRepo, retrievalStore, { type: "fact", content: "alpha beta", scope: globalScope() });

  const graph = await queryService.getMemoryGraph({ minSimilarity: 0 });
  for (const node of graph.nodes) assert.deepEqual(Object.keys(node).some((k) => /embed|vector/i.test(k)), false);
  for (const edge of graph.similarityEdges) assert.deepEqual(Object.keys(edge).sort(), ["a", "b", "similarity"]);
});

test("getMemoryGraph: supersedes edges derived from the fetched list, directional (from=newer, to=older)", async () => {
  const { queryService, memoryRepo, retrievalStore } = setup();
  const old = await createIndexed(memoryRepo, retrievalStore, { type: "fact", content: "old version", scope: globalScope() });
  const replacement = await createIndexed(memoryRepo, retrievalStore, {
    type: "fact",
    content: "new version",
    scope: globalScope(),
    supersedes: old.id,
  });

  const graph = await queryService.getMemoryGraph();
  assert.deepEqual(graph.supersedesEdges, [{ from: replacement.id, to: old.id }]);
});

test("getMemoryGraph: scope filtering prevents leakage (project-a sees global + its own, not project-b's)", async () => {
  const { queryService, memoryRepo, retrievalStore } = setup();
  await createIndexed(memoryRepo, retrievalStore, { type: "fact", content: "global", scope: globalScope() });
  await createIndexed(memoryRepo, retrievalStore, { type: "fact", content: "a-only", scope: projectScope("project-a") });
  await createIndexed(memoryRepo, retrievalStore, { type: "fact", content: "b-only", scope: projectScope("project-b") });

  const graph = await queryService.getMemoryGraph({ scope: projectScope("project-a") });
  assert.equal(graph.nodes.length, 2);
  assert.ok(!graph.nodes.some((n) => n.contentPreview === "b-only"));
});

test("getMemoryDetail: returns null for an unknown id", async () => {
  const { queryService } = setup();
  assert.equal(await queryService.getMemoryDetail("00000000-0000-0000-0000-000000000000"), null);
});

test("getMemoryDetail: neighbors are filtered to pairs touching this id; supersededBy reflects a newer replacement", async () => {
  const { queryService, memoryRepo, retrievalStore } = setup();
  const a = await createIndexed(memoryRepo, retrievalStore, { type: "fact", content: "alpha beta gamma delta epsilon", scope: globalScope() });
  const b = await createIndexed(memoryRepo, retrievalStore, { type: "fact", content: "alpha beta gamma delta zeta", scope: globalScope() });
  const c = await createIndexed(memoryRepo, retrievalStore, { type: "fact", content: "unrelated widgets gears mechanisms", scope: globalScope() });
  const replacement = await createIndexed(memoryRepo, retrievalStore, { type: "fact", content: "replaces a", scope: globalScope(), supersedes: a.id });

  const detail = await queryService.getMemoryDetail(a.id);
  assert.ok(detail);
  assert.ok(detail.neighbors.every((p) => p.a === a.id || p.b === a.id));
  assert.ok(detail.neighbors.some((p) => p.a === b.id || p.b === b.id));
  assert.equal(detail.supersededBy, replacement.id);
  void c;
});

test("getMemoryDetail: feedback summary buckets useful/notUseful/other; deliveryCount reflects included deliveries", async () => {
  const { queryService, memoryRepo, retrievalStore, eventStore } = setup();
  const memory = await createIndexed(memoryRepo, retrievalStore, { type: "fact", content: "x", scope: globalScope() });
  await eventStore.recordFeedback({ memoryId: memory.id, taskId: null, contextId: null, useful: true, reason: null, notes: null });
  await eventStore.recordFeedback({ memoryId: memory.id, taskId: null, contextId: null, useful: false, reason: "irrelevant", notes: null });
  await eventStore.recordFeedback({ memoryId: memory.id, taskId: null, contextId: null, useful: null, reason: null, notes: null });
  await eventStore.recordContext({
    retrievalEventId: "r1",
    scope: globalScope(),
    taskId: null,
    includedMemoryIds: [memory.id],
    omittedMemoryIds: [],
    tokenCount: 1,
    memories: [{ memoryId: memory.id, included: true, rank: 1, tokenCount: 1 }],
    candidateCount: null,
    candidateTokenCount: null,
    retrievalMs: null,
    rankingMs: null,
    compileMs: null,
    optimizeMs: null,
  });

  const detail = await queryService.getMemoryDetail(memory.id);
  assert.ok(detail);
  assert.deepEqual(detail.feedback, { useful: 1, notUseful: 1, other: 1 });
  assert.equal(detail.deliveryCount, 1);
});

test("getMemoryDetail: performance is null on cold start, populated with evidenceMass/usefulnessSignal when a row exists", async () => {
  const { queryService, memoryRepo, retrievalStore, performanceStore } = setup();
  const withoutRow = await createIndexed(memoryRepo, retrievalStore, { type: "fact", content: "no evidence yet", scope: globalScope() });
  const coldDetail = await queryService.getMemoryDetail(withoutRow.id);
  assert.equal(coldDetail?.performance, null);

  const withRow = await createIndexed(memoryRepo, retrievalStore, { type: "fact", content: "has evidence", scope: globalScope() });
  performanceStore.seed({
    memoryId: withRow.id,
    scopeKey: "*",
    usefulCount: 3,
    notUsefulCount: 1,
    redundantReasonCount: 0,
    incorrectReasonCount: 0,
    dilutedSuccessEvidence: 0,
    dilutedFailureEvidence: 0,
    successContextCount: 0,
    failureContextCount: 0,
    labeledContextCount: 4,
    lastFeedbackAt: null,
    lastOutcomeAt: null,
  });
  const warmDetail = await queryService.getMemoryDetail(withRow.id);
  assert.ok(warmDetail?.performance);
  assert.equal(warmDetail.performance.usefulCount, 3);
  assert.equal(warmDetail.performance.notUsefulCount, 1);
  assert.ok(typeof warmDetail.performance.evidenceMass === "number");
  assert.ok(typeof warmDetail.performance.usefulnessSignal === "number");
});
