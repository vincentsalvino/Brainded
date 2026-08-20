import { test } from "node:test";
import assert from "node:assert/strict";
import { globalScope, projectScope } from "@brain/contracts";
import { FakeEventStore, FakeMemoryRepository } from "@brain/test-fixtures";
import { exportFromEvents } from "./export.js";

async function scenario() {
  const events = new FakeEventStore();
  const memories = new FakeMemoryRepository(events);
  return { events, memories };
}

test("exportFromEvents: useful=true maps to grade 2", async () => {
  const { events, memories } = await scenario();
  const mem = await memories.create({ type: "rule", content: "notes-api uses plural resource names", scope: projectScope("notes-api"), confidence: 1 });
  const retrieval = await events.recordRetrieval({ scope: projectScope("notes-api"), queryText: "naming convention", candidateIds: [mem.id], taskId: null });
  const context = await events.recordContext({
    retrievalEventId: retrieval.id,
    scope: projectScope("notes-api"),
    taskId: null,
    includedMemoryIds: [mem.id],
    omittedMemoryIds: [],
    tokenCount: 10,
    memories: [{ memoryId: mem.id, included: true, rank: 1, tokenCount: 10 }],
    candidateCount: 1,
    candidateTokenCount: 10,
    retrievalMs: 1,
    rankingMs: 1,
    compileMs: 1,
    optimizeMs: 1,
  });
  await events.recordFeedback({ memoryId: mem.id, taskId: null, contextId: context.id, useful: true, reason: null, notes: null });

  const [example] = await exportFromEvents(events, memories);
  assert.ok(example);
  assert.equal(example.task, "naming convention");
  assert.equal(example.labels[mem.id], 2);
});

test("exportFromEvents: useful=false + irrelevant maps to grade 0", async () => {
  const { events, memories } = await scenario();
  const mem = await memories.create({ type: "rule", content: "x", scope: globalScope() });
  const retrieval = await events.recordRetrieval({ scope: globalScope(), queryText: "q", candidateIds: [mem.id], taskId: null });
  const context = await events.recordContext({
    retrievalEventId: retrieval.id, scope: globalScope(), taskId: null,
    includedMemoryIds: [mem.id], omittedMemoryIds: [], tokenCount: 5,
    memories: [{ memoryId: mem.id, included: true, rank: 1, tokenCount: 5 }],
    candidateCount: 1, candidateTokenCount: 5, retrievalMs: 1, rankingMs: 1, compileMs: 1, optimizeMs: 1,
  });
  await events.recordFeedback({ memoryId: mem.id, taskId: null, contextId: context.id, useful: false, reason: "irrelevant", notes: null });

  const [example] = await exportFromEvents(events, memories);
  assert.equal(example?.labels[mem.id], 0);
});

test("exportFromEvents: useful=false + redundant is excluded from labels entirely (not grade 0, not grade 2)", async () => {
  const { events, memories } = await scenario();
  const mem = await memories.create({ type: "rule", content: "x", scope: globalScope() });
  const retrieval = await events.recordRetrieval({ scope: globalScope(), queryText: "q", candidateIds: [mem.id], taskId: null });
  const context = await events.recordContext({
    retrievalEventId: retrieval.id, scope: globalScope(), taskId: null,
    includedMemoryIds: [mem.id], omittedMemoryIds: [], tokenCount: 5,
    memories: [{ memoryId: mem.id, included: true, rank: 1, tokenCount: 5 }],
    candidateCount: 1, candidateTokenCount: 5, retrievalMs: 1, rankingMs: 1, compileMs: 1, optimizeMs: 1,
  });
  await events.recordFeedback({ memoryId: mem.id, taskId: null, contextId: context.id, useful: false, reason: "redundant", notes: null });

  const [example] = await exportFromEvents(events, memories);
  assert.equal(mem.id in (example?.labels ?? {}), false);
  assert.deepEqual(example?.redundantWith, {}, "no structured target exists on FeedbackEvent -- documented limitation, not fabricated");
});

test("exportFromEvents: no feedback at all leaves the memory unlabeled, excluded from labels", async () => {
  const { events, memories } = await scenario();
  const mem = await memories.create({ type: "rule", content: "x", scope: globalScope() });
  const retrieval = await events.recordRetrieval({ scope: globalScope(), queryText: "q", candidateIds: [mem.id], taskId: null });
  await events.recordContext({
    retrievalEventId: retrieval.id, scope: globalScope(), taskId: null,
    includedMemoryIds: [mem.id], omittedMemoryIds: [], tokenCount: 5,
    memories: [{ memoryId: mem.id, included: true, rank: 1, tokenCount: 5 }],
    candidateCount: 1, candidateTokenCount: 5, retrievalMs: 1, rankingMs: 1, compileMs: 1, optimizeMs: 1,
  });

  const [example] = await exportFromEvents(events, memories);
  assert.equal(mem.id in (example?.labels ?? {}), false);
});

test("exportFromEvents: outcome is attached as metadata and does not create a label", async () => {
  const { events, memories } = await scenario();
  const mem = await memories.create({ type: "rule", content: "x", scope: globalScope() });
  const retrieval = await events.recordRetrieval({ scope: globalScope(), queryText: "q", candidateIds: [mem.id], taskId: "t1" });
  const context = await events.recordContext({
    retrievalEventId: retrieval.id, scope: globalScope(), taskId: "t1",
    includedMemoryIds: [mem.id], omittedMemoryIds: [], tokenCount: 5,
    memories: [{ memoryId: mem.id, included: true, rank: 1, tokenCount: 5 }],
    candidateCount: 1, candidateTokenCount: 5, retrievalMs: 1, rankingMs: 1, compileMs: 1, optimizeMs: 1,
  });
  await events.recordOutcome({ taskId: "t1", sessionId: null, contextId: context.id, outcome: "success", signal: null, notes: null });

  const [example] = await exportFromEvents(events, memories);
  assert.equal(example?.outcome, "success");
  assert.equal(mem.id in (example?.labels ?? {}), false);
});

test("exportFromEvents: a pre-migration context event (empty memories[]) is skipped, not fabricated", async () => {
  const { events, memories } = await scenario();
  const mem = await memories.create({ type: "rule", content: "x", scope: globalScope() });
  const retrieval = await events.recordRetrieval({ scope: globalScope(), queryText: "q", candidateIds: [mem.id], taskId: null });
  events.contextEvents.push({
    id: "aaaaaaaa-0000-0000-0000-000000000000", timestamp: new Date().toISOString(),
    retrievalEventId: retrieval.id, scope: globalScope(), taskId: null,
    includedMemoryIds: [mem.id], omittedMemoryIds: [], tokenCount: 5, memories: [],
    candidateCount: null, candidateTokenCount: null, retrievalMs: null, rankingMs: null, compileMs: null, optimizeMs: null,
  });
  assert.deepEqual(await exportFromEvents(events, memories), []);
});

test("exportFromEvents: a memory purged (hard-deleted) since delivery is skipped rather than fabricated", async () => {
  const { events, memories } = await scenario();
  const mem = await memories.create({ type: "rule", content: "x", scope: globalScope() });
  await memories.purge(mem.id, globalScope());
  const retrieval = await events.recordRetrieval({ scope: globalScope(), queryText: "q", candidateIds: [mem.id], taskId: null });
  await events.recordContext({
    retrievalEventId: retrieval.id, scope: globalScope(), taskId: null,
    includedMemoryIds: [mem.id], omittedMemoryIds: [], tokenCount: 5,
    memories: [{ memoryId: mem.id, included: true, rank: 1, tokenCount: 5 }],
    candidateCount: 1, candidateTokenCount: 5, retrievalMs: 1, rankingMs: 1, compileMs: 1, optimizeMs: 1,
  });
  assert.deepEqual(await exportFromEvents(events, memories), []);
});

test("exportFromEvents: an archived (soft-deleted) memory is still exported with its label intact -- archiving is not deletion", async () => {
  const { events, memories } = await scenario();
  const mem = await memories.create({ type: "rule", content: "x", scope: globalScope() });
  const retrieval = await events.recordRetrieval({ scope: globalScope(), queryText: "q", candidateIds: [mem.id], taskId: null });
  const context = await events.recordContext({
    retrievalEventId: retrieval.id, scope: globalScope(), taskId: null,
    includedMemoryIds: [mem.id], omittedMemoryIds: [], tokenCount: 5,
    memories: [{ memoryId: mem.id, included: true, rank: 1, tokenCount: 5 }],
    candidateCount: 1, candidateTokenCount: 5, retrievalMs: 1, rankingMs: 1, compileMs: 1, optimizeMs: 1,
  });
  await events.recordFeedback({ memoryId: mem.id, taskId: null, contextId: context.id, useful: true, reason: null, notes: null });
  await memories.archive(mem.id, globalScope());

  const [example] = await exportFromEvents(events, memories);
  assert.ok(example, "an archived-but-not-purged memory is still replayable");
  assert.equal(example.labels[mem.id], 2, "the historical judgment survives archiving");
});

test("exportFromEvents: `since` excludes context events before the given timestamp", async () => {
  const { events, memories } = await scenario();
  const mem = await memories.create({ type: "rule", content: "x", scope: globalScope() });
  const retrieval = await events.recordRetrieval({ scope: globalScope(), queryText: "q", candidateIds: [mem.id], taskId: null });
  await events.recordContext({
    retrievalEventId: retrieval.id, scope: globalScope(), taskId: null,
    includedMemoryIds: [mem.id], omittedMemoryIds: [], tokenCount: 5,
    memories: [{ memoryId: mem.id, included: true, rank: 1, tokenCount: 5 }],
    candidateCount: 1, candidateTokenCount: 5, retrievalMs: 1, rankingMs: 1, compileMs: 1, optimizeMs: 1,
  });
  const future = new Date(Date.now() + 60_000).toISOString();
  assert.deepEqual(await exportFromEvents(events, memories, { since: future }), []);
});
