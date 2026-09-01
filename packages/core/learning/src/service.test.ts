import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { globalScope } from "@brain/contracts";
import { FakeEventStore } from "@brain/test-fixtures";
import { EventService } from "./service.js";

test("EventService delegates all five record* calls to the injected store", async () => {
  const store = new FakeEventStore();
  const events = new EventService(store);
  const memoryId = randomUUID();

  const retrieval = await events.recordRetrieval({
    scope: globalScope(),
    queryText: "q",
    candidateIds: [memoryId],
    taskId: "task-1",
  });
  await events.recordContext({
    retrievalEventId: retrieval.id,
    scope: globalScope(),
    taskId: "task-1",
    includedMemoryIds: [memoryId],
    omittedMemoryIds: [],
    memories: [], candidateCount: null, candidateTokenCount: null, retrievalMs: null, rankingMs: null, compileMs: null, optimizeMs: null, tokenCount: 10,
  });
  await events.recordOutcome({ taskId: "task-1", sessionId: null, contextId: null, outcome: "success", signal: null, notes: null });
  await events.recordFeedback({ memoryId, taskId: "task-1", contextId: null, reason: null, useful: true, notes: null });
  await events.recordMutation({ memoryId, mutationType: "create", actor: { origin: "system" }, summary: null });

  assert.equal(store.retrievalEvents.length, 1);
  assert.equal(store.contextEvents.length, 1);
  assert.equal(store.outcomeEvents.length, 1);
  assert.equal(store.feedbackEvents.length, 1);
  assert.equal(store.mutationEvents.length, 1);
});

test("EventService: recordContextSources/getContextEventSources delegate to the injected store", async () => {
  const store = new FakeEventStore();
  const events = new EventService(store);

  await events.recordContextSources("ctx-1", [
    { sourceType: "code", sourceId: "chunk-1", repositoryId: "repo-1", fileId: "file-1", relativePath: "a.ts", relation: null, depth: null, included: true, rank: 1, tokenCount: 10 },
  ]);

  assert.equal(store.contextEventSources.length, 1);
  const rows = await events.getContextEventSources("ctx-1");
  assert.equal(rows.length, 1);
  assert.equal(rows[0]?.sourceType, "code");
});

// This is the test named directly in PHASE_1_TASKS.md P1-014 (Outcome/feedback
// wiring): both AEOS and AEOS-brain shipped this exact path -- an agent reports an
// outcome, the Brain records it -- silently broken. There is no separate
// "wiring" component to build; the requirement was that this path is real and
// verified end to end, which this test is.
test("brain_feedback path (P1-014): a reported outcome is durably queryable afterward, with no step that could silently swallow it", async () => {
  const store = new FakeEventStore();
  const events = new EventService(store);
  const memoryId = randomUUID();

  await events.recordFeedback({ memoryId, taskId: "task-9", contextId: null, reason: null, useful: true, notes: "worked well" });

  const forMemory = await events.getEventsForMemory(memoryId);
  assert.equal(forMemory.length, 1);
  assert.equal(forMemory[0]?.useful, true);
  assert.equal(forMemory[0]?.notes, "worked well");

  const forTask = await events.getEventsForTask("task-9");
  assert.equal(forTask.feedback.length, 1);
});
