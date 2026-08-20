import { test } from "node:test";
import assert from "node:assert/strict";
import { MEMORY_TYPES, globalScope, projectScope } from "@brain/contracts";
import { FakeEmbeddingProvider } from "@brain/test-fixtures";
import { openDatabase } from "./db.js";
import { SqliteMemoryRepository } from "./memory-repository.js";
import { SqliteEventStore } from "./event-store.js";

// SqliteMemoryRepository writes its audit row directly (in the same SQL
// transaction as the memory row -- see writeMutationAtomically), not through an
// injected EventStore. A real SqliteEventStore reading the same db is what
// verifies that write here; a FakeEventStore would never see it.
function setup() {
  const db = openDatabase(":memory:");
  const events = new SqliteEventStore(db.raw);
  const repo = new SqliteMemoryRepository(db.raw, new FakeEmbeddingProvider());
  return { db, events, repo };
}

test("round-trips a record of every one of the 12 memory types", async () => {
  const { db, repo } = setup();
  for (const type of MEMORY_TYPES) {
    const created = await repo.create({ type, content: `example ${type}`, scope: globalScope() });
    const fetched = await repo.get(created.id, globalScope());
    assert.equal(fetched?.type, type);
    assert.equal(fetched?.content, `example ${type}`);
  }
  assert.equal(MEMORY_TYPES.length, 12);
  db.close();
});

test("create writes exactly one mutation audit event", async () => {
  const { db, events, repo } = setup();
  const record = await repo.create({ type: "fact", content: "hello", scope: globalScope() });
  const mutations = await events.getMutationsForMemory(record.id);
  assert.equal(mutations.length, 1);
  assert.equal(mutations[0]?.mutationType, "create");
  db.close();
});

test("update and archive each write exactly one further mutation event", async () => {
  const { db, events, repo } = setup();
  const record = await repo.create({ type: "fact", content: "hello", scope: globalScope() });
  await repo.update({ id: record.id, content: "hello again" }, globalScope());
  await repo.archive(record.id, globalScope());
  const mutations = await events.getMutationsForMemory(record.id);
  assert.deepEqual(mutations.map((m) => m.mutationType), ["create", "update", "archive"]);
  db.close();
});

test("archived status is reflected on the stored record", async () => {
  const { db, repo } = setup();
  const record = await repo.create({ type: "fact", content: "hello", scope: globalScope() });
  const archived = await repo.archive(record.id, globalScope());
  assert.equal(archived.status, "archived");
  const fetched = await repo.get(record.id, globalScope());
  assert.equal(fetched?.status, "archived");
  db.close();
});

test("scope isolation is enforced at the storage-query layer: a project record is invisible under another project", async () => {
  const { db, repo } = setup();
  const record = await repo.create({ type: "fact", content: "secret", scope: projectScope("project-a") });
  assert.ok(await repo.get(record.id, projectScope("project-a")));
  assert.equal(await repo.get(record.id, projectScope("project-b")), null);
  assert.equal(await repo.get(record.id, globalScope()), null);
  db.close();
});

test("a global record is visible from any scope", async () => {
  const { db, repo } = setup();
  const record = await repo.create({ type: "fact", content: "universal", scope: globalScope() });
  assert.ok(await repo.get(record.id, projectScope("project-a")));
  db.close();
});

test("query never returns another scope's rows (adversarial near-identical content, per AUDIT_AEOS_BRAIN.md 11)", async () => {
  const { db, repo } = setup();
  const content = "the deployment key rotates every 90 days";
  await repo.create({ type: "fact", content, scope: projectScope("project-a") });
  await repo.create({ type: "fact", content, scope: projectScope("project-b") });
  const resultA = await repo.query({ scope: projectScope("project-a") });
  assert.equal(resultA.items.length, 1);
  assert.equal(resultA.items[0]?.scope.id, "project-a");
  db.close();
});

test("update rejects a non-existent id within scope", async () => {
  const { db, repo } = setup();
  await assert.rejects(() => repo.update({ id: "00000000-0000-0000-0000-000000000000", content: "x" }, globalScope()));
  db.close();
});

test("purge removes the record so it is no longer retrievable", async () => {
  const { db, repo } = setup();
  const record = await repo.create({ type: "fact", content: "temp", scope: globalScope() });
  await repo.purge(record.id, globalScope());
  assert.equal(await repo.get(record.id, globalScope()), null);
  db.close();
});

test("purge cascades to remove the memory's mutation/feedback history too (a genuine hard delete, unlike archive)", async () => {
  const { db, events, repo } = setup();
  const record = await repo.create({ type: "fact", content: "temp", scope: globalScope() });
  await events.recordFeedback({ memoryId: record.id, taskId: null, contextId: null, reason: null, useful: true, notes: null });
  assert.equal((await events.getMutationsForMemory(record.id)).length, 1);
  assert.equal((await events.getEventsForMemory(record.id)).length, 1);

  await repo.purge(record.id, globalScope());

  assert.equal((await events.getMutationsForMemory(record.id)).length, 0);
  assert.equal((await events.getEventsForMemory(record.id)).length, 0);
  db.close();
});

test("create writes the memory row and its audit row atomically -- both exist together, never one without the other", async () => {
  const { db, events, repo } = setup();
  const record = await repo.create({ type: "fact", content: "hello", scope: globalScope() });
  // If writeMutationAtomically's transaction were broken, one of these could exist
  // without the other. Both must be present after a successful create.
  assert.ok(await repo.get(record.id, globalScope()));
  assert.equal((await events.getMutationsForMemory(record.id)).length, 1);
  db.close();
});
