import { test } from "node:test";
import assert from "node:assert/strict";
import { globalScope, projectScope } from "@brain/contracts";
import { FakeEmbeddingProvider, runRetrievalStoreConformance } from "@brain/test-fixtures";
import { openDatabase } from "./db.js";
import { SqliteMemoryRepository } from "./memory-repository.js";
import { SqliteRetrievalStore } from "./retrieval-store.js";

function setup() {
  const db = openDatabase(":memory:");
  const embeddings = new FakeEmbeddingProvider();
  const repo = new SqliteMemoryRepository(db.raw, embeddings);
  const retrieval = new SqliteRetrievalStore(db.raw, embeddings, db.vectorSearchAvailable);
  return { db, repo, retrieval };
}

test("lexicalSearch (FTS5): a known-relevant fixture query returns the expected record in the top result", async () => {
  const { db, repo, retrieval } = setup();
  await repo.create({ type: "rule", content: "use conventional commits for every pull request", scope: globalScope() });
  await repo.create({ type: "fact", content: "the sky is blue on a clear day", scope: globalScope() });

  const results = await retrieval.lexicalSearch({ text: "conventional commits", scope: globalScope(), limit: 10 });
  assert.equal(results.length, 1);
  assert.match(results[0]?.record.content ?? "", /conventional commits/);
  db.close();
});

test("lexicalSearch respects scope isolation", async () => {
  const { db, repo, retrieval } = setup();
  await repo.create({ type: "fact", content: "project A specific secret token format", scope: projectScope("project-a") });
  const results = await retrieval.lexicalSearch({ text: "secret token", scope: projectScope("project-b"), limit: 10 });
  assert.equal(results.length, 0);
  db.close();
});

test("semanticSearch: returns the expected nearest neighbor for a near-duplicate query", async () => {
  const { db, repo, retrieval } = setup();
  const target = await repo.create({
    type: "pattern",
    content: "repository pattern for database access abstraction",
    scope: globalScope(),
  });
  await repo.create({ type: "pattern", content: "totally unrelated content about weather forecasting", scope: globalScope() });

  const results = await retrieval.semanticSearch({
    text: "repository pattern for database access abstraction",
    scope: globalScope(),
    limit: 5,
  });
  assert.ok(results.length > 0);
  assert.equal(results[0]?.memoryId, target.id);
  db.close();
});

test("semanticSearch respects scope isolation", async () => {
  const { db, repo, retrieval } = setup();
  await repo.create({ type: "fact", content: "project A specific architecture notes", scope: projectScope("project-a") });
  const results = await retrieval.semanticSearch({
    text: "project A specific architecture notes",
    scope: projectScope("project-b"),
    limit: 5,
  });
  assert.equal(results.length, 0);
  db.close();
});

test("degradation: semanticSearch throws a clear error when vector search is unavailable, for the caller to catch", async () => {
  const db = openDatabase(":memory:");
  const embeddings = new FakeEmbeddingProvider();
  const retrieval = new SqliteRetrievalStore(db.raw, embeddings, false);
  await assert.rejects(
    () => retrieval.semanticSearch({ text: "anything", scope: globalScope(), limit: 5 }),
    /vector search unavailable/,
  );
  db.close();
});

test("degradation: findSimilarPairs returns no pairs (not an error) when vector search is unavailable", async () => {
  const db = openDatabase(":memory:");
  const embeddings = new FakeEmbeddingProvider();
  const repo = new SqliteMemoryRepository(db.raw, embeddings);
  const a = await repo.create({ type: "fact", content: "alpha", scope: globalScope() });
  const b = await repo.create({ type: "fact", content: "alpha again", scope: globalScope() });
  const retrieval = new SqliteRetrievalStore(db.raw, embeddings, false);
  assert.deepEqual(await retrieval.findSimilarPairs([a.id, b.id], 0), []);
  db.close();
});

// P2-001: the shared RetrievalStore behavioural contract (@brain/test-fixtures),
// identical to the body run against FakeRetrievalStore. Signal direction and
// range are behaviour, so both implementations answer to the same tests.
function vectorSearchSupported(): boolean {
  const probe = openDatabase(":memory:");
  const available = probe.vectorSearchAvailable;
  probe.close();
  return available;
}

runRetrievalStoreConformance({
  name: "SqliteRetrievalStore",
  async setup(seeds) {
    const db = openDatabase(":memory:");
    const embeddings = new FakeEmbeddingProvider();
    const repo = new SqliteMemoryRepository(db.raw, embeddings);
    for (const seed of seeds) {
      const record = await repo.create({ type: "fact", content: seed.content, scope: seed.scope });
      if (seed.status === "archived") await repo.archive(record.id, seed.scope);
    }
    const store = new SqliteRetrievalStore(db.raw, embeddings, db.vectorSearchAvailable);
    return { store, cleanup: () => db.close() };
  },
  semantic: vectorSearchSupported(),
});

// P2-002 regression: the exact Finding B failure from the Phase 1 real-world test
// (PHASE_2_FINDINGS.md 3.2), reproduced as a deterministic, network-free fixture.
// Before the fix, FTS5 ranked the repository constraint as the best BM25 match and
// the storage layer then scored it 0.2910 while the two endpoint-naming memories --
// which matched only the near-universal terms "the" and "API" -- scored 0.9999.
// Ranking faithfully sorted by those numbers and produced the observed wrong order.
test("REGRESSION (Finding B): the repository constraint out-scores the endpoint-naming memories", async () => {
  const { db, repo, retrieval } = setup();
  const REPO_CONSTRAINT =
    "notes-api: database access must go through the repository layer (NotesRepository interface); route handlers must never touch the database directly";
  const PROJECT_PLURAL = "notes-api REST endpoints use plural resource names: /notes, /notes/:id (POST, GET, GET/:id)";
  const GLOBAL_PLURAL = "REST API resources should use plural nouns in endpoint paths, such as /tasks and /notes.";

  await repo.create({ type: "constraint", content: REPO_CONSTRAINT, scope: projectScope("notes-api"), confidence: 1 });
  await repo.create({ type: "rule", content: PROJECT_PLURAL, scope: projectScope("notes-api"), confidence: 1 });
  await repo.create({ type: "rule", content: GLOBAL_PLURAL, scope: globalScope(), confidence: 0.5 });

  const candidates = await retrieval.lexicalSearch({
    text: "Refactor the database layer without changing API behavior.",
    scope: projectScope("notes-api"),
    limit: 10,
  });

  const scoreOf = (content: string) =>
    candidates.find((c) => c.record.content === content)?.signals.lexicalScore ?? -1;

  assert.equal(candidates.length, 3, "all three memories are candidates -- the failure was ordering, not recall");
  assert.ok(
    scoreOf(REPO_CONSTRAINT) > scoreOf(PROJECT_PLURAL),
    `repository constraint (${scoreOf(REPO_CONSTRAINT)}) must out-score the project plural rule (${scoreOf(PROJECT_PLURAL)})`,
  );
  assert.ok(
    scoreOf(REPO_CONSTRAINT) > scoreOf(GLOBAL_PLURAL),
    `repository constraint (${scoreOf(REPO_CONSTRAINT)}) must out-score the global plural rule (${scoreOf(GLOBAL_PLURAL)})`,
  );
  db.close();
});
