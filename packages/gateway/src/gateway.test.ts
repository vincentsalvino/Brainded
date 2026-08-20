import { test } from "node:test";
import assert from "node:assert/strict";
import { globalScope, projectScope } from "@brain/contracts";
import { FakeMemoryRepository, FakeRetrievalStore, FakeEventStore, buildMemoryRecord } from "@brain/test-fixtures";
import { MemoryService } from "@brain/memory";
import { RetrievalService } from "@brain/retrieval";
import { EventService } from "@brain/learning";
import { Gateway } from "./gateway.js";
import { BrainError } from "./errors.js";

function setup(seedRecords: ReturnType<typeof buildMemoryRecord>[] = []) {
  const eventStore = new FakeEventStore();
  const memoryRepo = new FakeMemoryRepository(eventStore);
  const retrievalStore = new FakeRetrievalStore(seedRecords);
  const gateway = new Gateway(
    new MemoryService(memoryRepo),
    new RetrievalService(retrievalStore),
    new EventService(eventStore),
    { vectorSearchAvailable: true },
  );
  return { gateway, memoryRepo, retrievalStore, eventStore };
}

test("brain_context: runs the full retrieval -> ranking -> context -> budget pipeline and stays within budget", async () => {
  const record = buildMemoryRecord({ content: "use conventional commits for every pull request", scope: globalScope() });
  const { gateway } = setup([record]);
  const pack = await gateway.getContext({ task: "conventional commits", scope: globalScope(), budget: { maxTokens: 1000 } });
  assert.ok(pack.tokenCount <= 1000);
  assert.ok(pack.items.length >= 0);
});

test("brain_context: records retrieval and context telemetry automatically", async () => {
  const record = buildMemoryRecord({ content: "use conventional commits for every pull request", scope: globalScope() });
  const { gateway, eventStore } = setup([record]);
  await gateway.getContext({ task: "conventional commits", scope: globalScope(), budget: { maxTokens: 1000 }, taskId: "task-1" });
  assert.equal(eventStore.retrievalEvents.length, 1);
  assert.equal(eventStore.contextEvents.length, 1);
  assert.equal(eventStore.retrievalEvents[0]?.taskId, "task-1");
});

test("brain_context: rejects an empty task string", async () => {
  const { gateway } = setup();
  await assert.rejects(() => gateway.getContext({ task: "", scope: globalScope(), budget: { maxTokens: 1000 } }), BrainError);
});

test("brain_recall: by id returns the exact record", async () => {
  const { gateway, memoryRepo } = setup();
  const created = await memoryRepo.create({ type: "fact", content: "hello", scope: globalScope() });
  const result = await gateway.recall({ scope: globalScope(), id: created.id });
  assert.equal((result as { id: string }).id, created.id);
});

test("brain_recall: by id raises not_found (BrainError) for a nonexistent id, not a generic throw", async () => {
  const { gateway } = setup();
  await assert.rejects(
    () => gateway.recall({ scope: globalScope(), id: "00000000-0000-0000-0000-000000000000" }),
    (err: unknown) => err instanceof BrainError && err.code === "not_found",
  );
});

test("brain_recall: by filter returns a MemoryResult", async () => {
  const { gateway, memoryRepo } = setup();
  await memoryRepo.create({ type: "fact", content: "a", scope: globalScope() });
  await memoryRepo.create({ type: "pattern", content: "b", scope: globalScope() });
  const result = await gateway.recall({ scope: globalScope(), type: "pattern" });
  assert.equal((result as { items: unknown[] }).items.length, 1);
});

test("brain_search: returns ranked results, not a budget-enforced ContextPack", async () => {
  const record = buildMemoryRecord({ content: "repository pattern for data access", scope: globalScope() });
  const { gateway } = setup([record]);
  const results = await gateway.search({ text: "repository pattern for data access", scope: globalScope() });
  assert.ok(Array.isArray(results));
  assert.ok(results.length > 0);
  assert.ok("rank" in (results[0] ?? {}));
});

test("brain_remember creates a real memory, retrievable afterward", async () => {
  const { gateway } = setup();
  const created = await gateway.remember({ type: "fact", content: "remembered fact", scope: globalScope() });
  const fetched = await gateway.recall({ scope: globalScope(), id: created.id });
  assert.equal((fetched as { content: string }).content, "remembered fact");
});

test("brain_update modifies an existing memory", async () => {
  const { gateway, memoryRepo } = setup();
  const created = await memoryRepo.create({ type: "fact", content: "original", scope: globalScope() });
  const updated = await gateway.update({ input: { id: created.id, content: "updated" }, scope: globalScope() });
  assert.equal(updated.content, "updated");
});

test("brain_update on a nonexistent id raises not_found", async () => {
  const { gateway } = setup();
  await assert.rejects(
    () => gateway.update({ input: { id: "00000000-0000-0000-0000-000000000000", content: "x" }, scope: globalScope() }),
    (err: unknown) => err instanceof BrainError && err.code === "not_found",
  );
});

test("brain_forget archives (not purges) a memory", async () => {
  const { gateway, memoryRepo } = setup();
  const created = await memoryRepo.create({ type: "fact", content: "temp", scope: globalScope() });
  const forgotten = await gateway.forget({ id: created.id, scope: globalScope() });
  assert.equal(forgotten.status, "archived");
});

test("brain_feedback records durably and is queryable back out", async () => {
  const { gateway, memoryRepo, eventStore } = setup();
  const created = await memoryRepo.create({ type: "fact", content: "x", scope: globalScope() });
  await gateway.feedback({ memoryId: created.id, taskId: "task-1", contextId: null, reason: null, useful: true, notes: null });
  const stored = await eventStore.getEventsForMemory(created.id);
  assert.equal(stored.length, 1);
  assert.equal(stored[0]?.useful, true);
});

test("brain_record_outcome records durably", async () => {
  const { gateway, eventStore } = setup();
  await gateway.recordOutcome({ taskId: "task-1", sessionId: null, contextId: null, outcome: "success", signal: null, notes: null });
  const forTask = await eventStore.getEventsForTask("task-1");
  assert.equal(forTask.outcome.length, 1);
});

test("brain_status reports capability flags, no scope resolution required", async () => {
  const { gateway } = setup();
  const status = await gateway.status();
  assert.equal(status.ok, true);
  assert.equal(status.vectorSearchAvailable, true);
});

test("brain_project reports a memory count for the given project scope", async () => {
  const { gateway, memoryRepo } = setup();
  await memoryRepo.create({ type: "fact", content: "a", scope: projectScope("project-a") });
  await memoryRepo.create({ type: "fact", content: "b", scope: projectScope("project-a") });
  await memoryRepo.create({ type: "fact", content: "c", scope: projectScope("project-b") });
  const info = await gateway.project({ projectId: "project-a" });
  assert.equal(info.memoryCount, 2);
});

// --- Scope isolation surviving the gateway boundary (this task's Step 9) ----

test("scope isolation survives the gateway: Project A and Project B with identical content never cross", async () => {
  const { gateway, memoryRepo } = setup();
  const contentA = await memoryRepo.create({ type: "fact", content: "Authentication uses JWT.", scope: projectScope("project-a") });
  await memoryRepo.create({ type: "fact", content: "Authentication uses JWT.", scope: projectScope("project-b") });

  const recalled = await gateway.recall({ scope: projectScope("project-a") });
  const items = (recalled as { items: { id: string }[] }).items;
  assert.equal(items.length, 1);
  assert.equal(items[0]?.id, contentA.id);

  // brain_recall by id, cross-scope: must not find Project B's record via Project A's scope.
  const crossScopeAttempt = await memoryRepo.create({ type: "fact", content: "secret", scope: projectScope("project-b") });
  await assert.rejects(() => gateway.recall({ scope: projectScope("project-a"), id: crossScopeAttempt.id }), BrainError);
});

test("scope isolation survives the gateway: brain_search never returns another project's data", async () => {
  const record = buildMemoryRecord({ content: "project A specific secret token format", scope: projectScope("project-a") });
  const { gateway } = setup([record]);
  const results = await gateway.search({ text: "secret token format", scope: projectScope("project-b") });
  assert.equal(results.length, 0);
});

// --- Concurrency (PHASE_1_TASKS.md P1-015: "Two concurrent resolutions under
// different request contexts never share or leak state") -- Gateway is request-
// scoped by construction (no module-level or instance-mutable "current scope"
// field), ruling out the AUDIT_AEOS_BRAIN.md §20 currentAgentScope race condition
// by design; this proves it under real overlapping execution, not just by
// reading the constructor. Promise.all starts every call before any of them
// resolve, so this interleaves for real at each internal await, the same shape
// as concurrent requests hitting one live server. ----------------------------

test("concurrency: overlapping getContext calls under different scopes never leak state (AUDIT_AEOS_BRAIN.md §20)", async () => {
  const recordA = buildMemoryRecord({ content: "Project A uses JWT for authentication.", scope: projectScope("project-a") });
  const recordB = buildMemoryRecord({ content: "Project B uses session cookies for authentication.", scope: projectScope("project-b") });
  const { gateway } = setup([recordA, recordB]);

  const requestA = () => gateway.getContext({ task: "authentication", scope: projectScope("project-a"), budget: { maxTokens: 1000 } });
  const requestB = () => gateway.getContext({ task: "authentication", scope: projectScope("project-b"), budget: { maxTokens: 1000 } });

  const calls = Array.from({ length: 10 }, (_, i) => (i % 2 === 0 ? requestA() : requestB()));
  const results = await Promise.all(calls);

  results.forEach((pack, i) => {
    const text = JSON.stringify(pack);
    if (i % 2 === 0) {
      assert.ok(text.includes("Project A uses JWT"), `call ${i} (scope A) lost its own data`);
      assert.ok(!text.includes("Project B uses session cookies"), `call ${i} (scope A) leaked Project B's data`);
    } else {
      assert.ok(text.includes("Project B uses session cookies"), `call ${i} (scope B) lost its own data`);
      assert.ok(!text.includes("Project A uses JWT"), `call ${i} (scope B) leaked Project A's data`);
    }
  });
});

// --- P2-005 / P2-006 / P2-015: correlation and measurement -----------------

function contextSetup() {
  const records = [
    buildMemoryRecord({ content: "database access must go through the repository layer", scope: globalScope() }),
    buildMemoryRecord({ content: "REST resources use plural nouns in endpoint paths", scope: globalScope() }),
  ];
  return { ...setup(records), records };
}

test("P2-005: a successful brain_context returns a non-null contextId naming the recorded ContextEvent", async () => {
  const { gateway, eventStore } = contextSetup();

  const delivery = await gateway.getContext({
    task: "repository layer database access",
    scope: globalScope(),
    budget: { maxTokens: 1000 },
  });

  assert.ok(delivery.contextId, "a recorded delivery must return its id");
  assert.equal(delivery.contextId, eventStore.contextEvents[0]?.id);
  // The pack itself is unchanged -- ContextDelivery is ContextPack plus one field.
  assert.equal(typeof delivery.tokenCount, "number");
  assert.equal(typeof delivery.truncated, "boolean");
  assert.equal(typeof delivery.omittedCount, "number");
});

test("P2-005: feedback and outcome accept a valid contextId", async () => {
  const { gateway, records } = contextSetup();
  const delivery = await gateway.getContext({
    task: "repository layer database access",
    scope: globalScope(),
    budget: { maxTokens: 1000 },
  });
  assert.ok(delivery.contextId);

  const feedback = await gateway.feedback({
    memoryId: records[0]!.id,
    taskId: null,
    contextId: delivery.contextId,
    useful: true,
    reason: null,
    notes: null,
  });
  assert.equal(feedback.contextId, delivery.contextId);

  const outcome = await gateway.recordOutcome({
    taskId: "t-1",
    sessionId: null,
    contextId: delivery.contextId,
    outcome: "success",
    signal: null,
    notes: null,
  });
  assert.equal(outcome.contextId, delivery.contextId);
});

test("P2-005: an unknown contextId is rejected loudly on feedback and on outcome", async () => {
  const { gateway, records } = contextSetup();
  const ghost = "00000000-0000-4000-8000-000000000000";

  // Silently accepting an unverifiable correlation id is worse than having none:
  // it produces a durable event that looks correlated and is not.
  await assert.rejects(
    () =>
      gateway.feedback({
        memoryId: records[0]!.id,
        taskId: null,
        contextId: ghost,
        useful: true,
        reason: null,
        notes: null,
      }),
    (error: unknown) => error instanceof BrainError && error.code === "invalid_request",
  );

  await assert.rejects(
    () =>
      gateway.recordOutcome({
        taskId: "t-1",
        sessionId: null,
        contextId: ghost,
        outcome: "success",
        signal: null,
        notes: null,
      }),
    (error: unknown) => error instanceof BrainError && error.code === "invalid_request",
  );
});

test("P2-005: feedback and outcome without a contextId still work (backward compatible)", async () => {
  const { gateway, records } = contextSetup();
  const feedback = await gateway.feedback({
    memoryId: records[0]!.id,
    taskId: "t-1",
    contextId: null,
    useful: true,
    reason: null,
    notes: null,
  });
  assert.equal(feedback.contextId, null);

  const outcome = await gateway.recordOutcome({
    taskId: "t-1",
    sessionId: null,
    contextId: null,
    outcome: "success",
    signal: null,
    notes: null,
  });
  assert.equal(outcome.contextId, null);
});

test("P2-005: telemetry failure yields contextId null and still returns the context", async () => {
  const { gateway, eventStore } = contextSetup();
  // Telemetry must never block the agent from getting its context; the agent must
  // also be able to tell that the delivery was not recorded.
  eventStore.recordContext = async () => {
    throw new Error("simulated telemetry failure");
  };

  const delivery = await gateway.getContext({
    task: "repository layer database access",
    scope: globalScope(),
    budget: { maxTokens: 1000 },
  });

  assert.equal(delivery.contextId, null);
  assert.ok(delivery.items.length > 0, "the agent still receives its context");
});

test("P2-006: every candidate appears exactly once in the normalized membership rows", async () => {
  const { gateway, eventStore, records } = contextSetup();
  await gateway.getContext({
    task: "repository layer database access plural nouns",
    scope: globalScope(),
    budget: { maxTokens: 1000 },
  });

  const event = eventStore.contextEvents[0]!;
  const ids = event.memories.map((m) => m.memoryId);
  assert.equal(new Set(ids).size, ids.length, "no duplicate membership rows");
  assert.equal(ids.length, event.candidateCount);
  assert.deepEqual(
    [...ids].sort(),
    [...event.includedMemoryIds, ...event.omittedMemoryIds].sort(),
    "membership covers exactly the candidate pool",
  );
  assert.ok(records.length > 0);
});

test("P2-006: included membership token counts sum to ContextPack.tokenCount", async () => {
  const { gateway, eventStore } = contextSetup();
  const delivery = await gateway.getContext({
    task: "repository layer database access plural nouns",
    scope: globalScope(),
    budget: { maxTokens: 1000 },
  });

  const event = eventStore.contextEvents[0]!;
  const sum = event.memories
    .filter((m) => m.included)
    .reduce((total, m) => total + (m.tokenCount ?? 0), 0);
  // Equal by construction, not coincidence: both are the same estimator applied to
  // the same delivered content.
  assert.equal(sum, delivery.tokenCount);
});

test("P2-006: an omitted candidate carries null rank and null delivered token cost", async () => {
  const { gateway, eventStore } = contextSetup();
  // A budget of 1 token cannot fit any real memory, so every candidate is omitted.
  await gateway.getContext({
    task: "repository layer database access plural nouns",
    scope: globalScope(),
    budget: { maxTokens: 1 },
  });

  const event = eventStore.contextEvents[0]!;
  const omitted = event.memories.filter((m) => !m.included);
  assert.ok(omitted.length > 0, "expected at least one omitted candidate");
  for (const memory of omitted) {
    assert.equal(memory.rank, null, "an omitted candidate never had a delivered rank");
    assert.equal(memory.tokenCount, null, "nothing was delivered, so there is no delivered cost");
  }
});

test("P2-015: stage timings and candidate measurements are recorded on the ContextEvent", async () => {
  const { gateway, eventStore } = contextSetup();
  await gateway.getContext({
    task: "repository layer database access",
    scope: globalScope(),
    budget: { maxTokens: 1000 },
  });

  const event = eventStore.contextEvents[0]!;
  for (const field of ["retrievalMs", "rankingMs", "compileMs", "optimizeMs"] as const) {
    const value = event[field];
    assert.equal(typeof value, "number", `${field} must be recorded`);
    assert.ok((value as number) >= 0, `${field} must never be negative`);
  }
  assert.equal(event.candidateCount, event.memories.length);
  assert.ok((event.candidateTokenCount ?? 0) > 0, "the candidate pool has a measurable cost");
});

test("P2-015: candidateTokenCount measures the pool before compilation, so it is >= delivered tokens", async () => {
  const { gateway, eventStore } = contextSetup();
  const delivery = await gateway.getContext({
    task: "repository layer database access plural nouns",
    scope: globalScope(),
    budget: { maxTokens: 1000 },
  });

  const event = eventStore.contextEvents[0]!;
  // deliveredTokens / candidateTokens measures selection compression from pool to
  // delivered context. It is NOT "tokens saved" -- the pool was never going to be
  // sent in full.
  assert.ok(
    (event.candidateTokenCount ?? 0) >= delivery.tokenCount,
    `candidate pool cost ${event.candidateTokenCount} must be at least the delivered ${delivery.tokenCount}`,
  );
});

test("P2-015: no context request carries a taskId it was not given", async () => {
  const { gateway, eventStore } = contextSetup();
  await gateway.getContext({ task: "anything", scope: globalScope(), budget: { maxTokens: 1000 } });
  // taskId stays the broader, caller-supplied logical-task identifier and is never
  // invented by the Brain; contextId is the precise delivery identifier.
  assert.equal(eventStore.contextEvents[0]?.taskId, null);
  assert.equal(eventStore.retrievalEvents[0]?.taskId, null);
});

test("P2-005: taskId, when supplied, is preserved alongside contextId on every event", async () => {
  const { gateway, eventStore } = contextSetup();
  const delivery = await gateway.getContext({
    task: "repository layer database access",
    scope: globalScope(),
    budget: { maxTokens: 1000 },
    taskId: "logical-task-7",
  });

  assert.equal(eventStore.retrievalEvents[0]?.taskId, "logical-task-7");
  assert.equal(eventStore.contextEvents[0]?.taskId, "logical-task-7");
  assert.equal(eventStore.contextEvents[0]?.id, delivery.contextId);
});
