import { test } from "node:test";
import assert from "node:assert/strict";
import { globalScope, projectScope, sessionScope } from "@brain/contracts";
import { FakeEventStore } from "./fake-event-store.js";
import { FakeMemoryRepository } from "./fake-memory-repository.js";
import { FakeRetrievalStore } from "./fake-retrieval-store.js";
import { oneOfEachMemoryType, crossScopeFixture, buildMemoryRecord } from "./fixtures.js";
import { runRetrievalStoreConformance } from "./store-conformance.js";

test("fixtures: oneOfEachMemoryType covers all 12 types", () => {
  const records = oneOfEachMemoryType();
  assert.equal(new Set(records.map((r) => r.type)).size, 12);
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

// P2-001: the shared RetrievalStore behavioural contract, run against the fake.
// The same body runs against SqliteRetrievalStore in packages/storage -- that is
// the whole point: one contract, every implementation.
runRetrievalStoreConformance({
  name: "FakeRetrievalStore",
  async setup(seeds) {
    const store = new FakeRetrievalStore(
      seeds.map((seed) => buildMemoryRecord({ content: seed.content, scope: seed.scope })),
    );
    return { store, cleanup: () => {} };
  },
});
