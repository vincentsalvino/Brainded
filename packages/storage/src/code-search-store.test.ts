import { test } from "node:test";
import assert from "node:assert/strict";
import { globalScope, projectScope, type CodeFileRecord, type CodeChunkRecord, type ScopeRef } from "@brain/contracts";
import { FakeEmbeddingProvider, runCodeSearchStoreConformance } from "@brain/test-fixtures";
import { openDatabase } from "./db.js";
import { SqliteCodebaseRepository } from "./codebase-repository.js";
import { SqliteCodeSearchStore } from "./code-search-store.js";

function setup() {
  const db = openDatabase(":memory:");
  const embeddings = new FakeEmbeddingProvider();
  const codebase = new SqliteCodebaseRepository(db.raw);
  const search = new SqliteCodeSearchStore(db.raw, embeddings, db.vectorSearchAvailable);
  return { db, codebase, search, embeddings };
}

let counter = 0;

async function seedChunk(
  codebase: SqliteCodebaseRepository,
  repositoryId: string,
  scope: ScopeRef,
  relativePath: string,
  content: string,
  overrides: Partial<CodeFileRecord & CodeChunkRecord> = {},
): Promise<CodeChunkRecord> {
  const n = counter++;
  const fileId = overrides.fileId ?? `file-${n}-${relativePath}`;
  const contentHash = overrides.contentHash ?? `hash-${n}-v1`;
  const file: CodeFileRecord = {
    id: fileId,
    repositoryId,
    scope,
    relativePath,
    language: overrides.language ?? "typescript",
    sizeBytes: content.length,
    contentHash,
    indexedAt: new Date().toISOString(),
  };
  const chunk: CodeChunkRecord = {
    id: overrides.id ?? `chunk-${n}-${relativePath}`,
    fileId,
    repositoryId,
    scope,
    relativePath,
    chunkIndex: 0,
    startLine: 1,
    endLine: content.split("\n").length,
    content,
    contentHash,
  };
  await codebase.replaceFile(file, [chunk]);
  return chunk;
}

async function seedRepo(codebase: SqliteCodebaseRepository, scope: ScopeRef = globalScope()) {
  return codebase.createRepository(scope, "/repo");
}

test("lexicalSearch: an exact identifier query retrieves the expected chunk", async () => {
  const { db, codebase, search } = setup();
  const repo = await seedRepo(codebase);
  await seedChunk(codebase, repo.id, repo.scope, "src/users.ts", "export function validateUserInput(payload) { return schema.parse(payload); }");
  await seedChunk(codebase, repo.id, repo.scope, "src/weather.ts", "export function getForecast() { return sunny; }");

  const results = await search.lexicalSearch({ text: "validateUserInput", scope: repo.scope, limit: 10 });
  assert.equal(results.length, 1);
  assert.equal(results[0]?.relativePath, "src/users.ts");
  db.close();
});

test("lexicalSearch: a natural-language query returns the relevant chunk", async () => {
  const { db, codebase, search } = setup();
  const repo = await seedRepo(codebase);
  await seedChunk(
    codebase,
    repo.id,
    repo.scope,
    "src/routes/users.ts",
    "router.post('/users', (req, res) => { validate the incoming request body against the schema before repository.save(body); });",
  );
  await seedChunk(codebase, repo.id, repo.scope, "src/routes/health.ts", "router.get('/health', (req, res) => { res.send('ok'); });");

  // FTS5's default tokenizer has no stemming: "validation" would not match
  // "validate" as written above. Phrased as a natural question sharing real tokens
  // with the target chunk (validate/request/body), not the health-check chunk.
  const results = await search.lexicalSearch({ text: "where do we validate the request body", scope: repo.scope, limit: 10 });
  assert.ok(results.some((r) => r.relativePath === "src/routes/users.ts"));
  assert.ok(!results.some((r) => r.relativePath === "src/routes/health.ts"));
  db.close();
});

// Recall the Phase 2 memory-retrieval bug (PHASE_2_FINDINGS.md 3.2): FTS5's bm25
// `rank` is negative, more-negative-is-better. `1 / (1 + Math.abs(rank))` inverted
// this. code-search-store.ts negates rank before normalizeScores -- this is the
// regression test the mission spec explicitly requires for code lexical retrieval.
test("REGRESSION: bm25 orientation -- a strictly better FTS match ranks strictly higher, never lower", async () => {
  const { db, codebase, search } = setup();
  const repo = await seedRepo(codebase);
  const STRONG = "database access must go through the repository layer, never directly from route handlers";
  const WEAK = "REST API resources should use plural nouns such as widgets and gadgets";
  await seedChunk(codebase, repo.id, repo.scope, "src/strong.ts", STRONG);
  await seedChunk(codebase, repo.id, repo.scope, "src/weak.ts", WEAK);

  const results = await search.lexicalSearch({
    text: "refactor the database repository layer api",
    scope: repo.scope,
    limit: 10,
  });
  const strong = results.find((r) => r.relativePath === "src/strong.ts");
  const weak = results.find((r) => r.relativePath === "src/weak.ts");
  assert.ok(strong && weak, "both chunks must be returned as candidates");
  assert.ok(
    (strong?.signals.lexicalScore ?? 0) > (weak?.signals.lexicalScore ?? 0),
    `strong match (${strong?.signals.lexicalScore}) must out-score the weak match (${weak?.signals.lexicalScore}) -- ` +
      `a lower score for the better match means the signal is direction-inverted`,
  );
  db.close();
});

test("lexicalSearch: scope isolation -- another scope's chunk is never returned", async () => {
  const { db, codebase, search } = setup();
  const repoA = await seedRepo(codebase, projectScope("project-a"));
  await seedChunk(codebase, repoA.id, repoA.scope, "src/secret.ts", "projectA specific secret token format handling");

  const results = await search.lexicalSearch({ text: "secret token format", scope: projectScope("project-b"), limit: 10 });
  assert.equal(results.length, 0);
  db.close();
});

test("lexicalSearch: repositoryId filter narrows to one registered repository", async () => {
  const { db, codebase, search } = setup();
  const repoA = await codebase.createRepository(globalScope(), "/repo-a");
  const repoB = await codebase.createRepository(globalScope(), "/repo-b");
  await seedChunk(codebase, repoA.id, globalScope(), "src/a.ts", "shared keyword alpha implementation");
  await seedChunk(codebase, repoB.id, globalScope(), "src/b.ts", "shared keyword alpha implementation");

  const results = await search.lexicalSearch({
    text: "shared keyword alpha",
    scope: globalScope(),
    filters: { repositoryId: repoA.id },
    limit: 10,
  });
  assert.equal(results.length, 1);
  assert.equal(results[0]?.repositoryId, repoA.id);
  db.close();
});

test("lexicalSearch: pathPrefix filter narrows to chunks under that path", async () => {
  const { db, codebase, search } = setup();
  const repo = await seedRepo(codebase);
  await seedChunk(codebase, repo.id, repo.scope, "src/services/user-service.ts", "shared keyword beta implementation");
  await seedChunk(codebase, repo.id, repo.scope, "tests/user-service.test.ts", "shared keyword beta implementation");

  const results = await search.lexicalSearch({
    text: "shared keyword beta",
    scope: repo.scope,
    filters: { pathPrefix: "src/services/" },
    limit: 10,
  });
  assert.equal(results.length, 1);
  assert.equal(results[0]?.relativePath, "src/services/user-service.ts");
  db.close();
});

test("lexicalSearch: language filter narrows to one language", async () => {
  const { db, codebase, search } = setup();
  const repo = await seedRepo(codebase);
  await seedChunk(codebase, repo.id, repo.scope, "src/main.ts", "shared keyword gamma implementation", { language: "typescript" });
  await seedChunk(codebase, repo.id, repo.scope, "scripts/build.py", "shared keyword gamma implementation", { language: "python" });

  const results = await search.lexicalSearch({
    text: "shared keyword gamma",
    scope: repo.scope,
    filters: { language: "python" },
    limit: 10,
  });
  assert.equal(results.length, 1);
  assert.equal(results[0]?.relativePath, "scripts/build.py");
  db.close();
});

test("semanticSearch: after syncEmbeddings, a near-duplicate query returns the expected chunk as nearest neighbor", async () => {
  const { db, codebase, search } = setup();
  const repo = await seedRepo(codebase);
  const target = await seedChunk(codebase, repo.id, repo.scope, "src/repo-pattern.ts", "repository pattern abstracts database access behind an interface");
  await seedChunk(codebase, repo.id, repo.scope, "src/weather.ts", "totally unrelated content about weather forecasting");
  await search.syncEmbeddings(repo.id);

  const results = await search.semanticSearch({
    text: "repository pattern abstracts database access behind an interface",
    scope: repo.scope,
    limit: 5,
  });
  assert.ok(results.length > 0);
  assert.equal(results[0]?.chunkId, target.id);
  db.close();
});

test("semanticSearch: scope isolation -- another scope's chunk is never returned", async () => {
  const { db, codebase, search } = setup();
  const repoA = await seedRepo(codebase, projectScope("project-a"));
  await seedChunk(codebase, repoA.id, repoA.scope, "src/notes.ts", "project A specific architecture notes and boundary decisions");
  await search.syncEmbeddings(repoA.id);

  const results = await search.semanticSearch({
    text: "project A specific architecture notes and boundary decisions",
    scope: projectScope("project-b"),
    limit: 5,
  });
  assert.equal(results.length, 0);
  db.close();
});

test("degradation: semanticSearch throws a clear error when vector search is unavailable, for the caller to catch", async () => {
  const db = openDatabase(":memory:");
  const embeddings = new FakeEmbeddingProvider();
  const search = new SqliteCodeSearchStore(db.raw, embeddings, false);
  await assert.rejects(() => search.semanticSearch({ text: "anything", scope: globalScope(), limit: 5 }), /vector search unavailable/);
  db.close();
});

test("degradation: lexicalSearch still succeeds when vector search is unavailable", async () => {
  const db = openDatabase(":memory:");
  const embeddings = new FakeEmbeddingProvider();
  const codebase = new SqliteCodebaseRepository(db.raw);
  const search = new SqliteCodeSearchStore(db.raw, embeddings, false);
  const repo = await seedRepo(codebase);
  await seedChunk(codebase, repo.id, repo.scope, "src/only.ts", "lexical-only fixture content unique-marker-token");

  const results = await search.lexicalSearch({ text: "unique-marker-token", scope: repo.scope, limit: 5 });
  assert.equal(results.length, 1);
  db.close();
});

test("degradation: syncEmbeddings reports available:false and performs no work when vector search is unavailable", async () => {
  const db = openDatabase(":memory:");
  const embeddings = new FakeEmbeddingProvider();
  const codebase = new SqliteCodebaseRepository(db.raw);
  const search = new SqliteCodeSearchStore(db.raw, embeddings, false);
  const repo = await seedRepo(codebase);
  await seedChunk(codebase, repo.id, repo.scope, "src/x.ts", "content");

  const result = await search.syncEmbeddings(repo.id);
  assert.deepEqual(result, { chunksEmbedded: 0, chunksUnchanged: 0, chunksRemoved: 0, available: false });
  db.close();
});

test("syncEmbeddings: first sync embeds every chunk in the repository", async () => {
  const { db, codebase, search } = setup();
  const repo = await seedRepo(codebase);
  await seedChunk(codebase, repo.id, repo.scope, "src/a.ts", "alpha content");
  await seedChunk(codebase, repo.id, repo.scope, "src/b.ts", "beta content");
  await seedChunk(codebase, repo.id, repo.scope, "src/c.ts", "gamma content");

  const result = await search.syncEmbeddings(repo.id);
  assert.deepEqual(result, { chunksEmbedded: 3, chunksUnchanged: 0, chunksRemoved: 0, available: true });
  db.close();
});

test("syncEmbeddings: a second sync over unchanged chunks embeds zero", async () => {
  const { db, codebase, search } = setup();
  const repo = await seedRepo(codebase);
  await seedChunk(codebase, repo.id, repo.scope, "src/a.ts", "alpha content");
  await seedChunk(codebase, repo.id, repo.scope, "src/b.ts", "beta content");

  await search.syncEmbeddings(repo.id);
  const second = await search.syncEmbeddings(repo.id);
  assert.deepEqual(second, { chunksEmbedded: 0, chunksUnchanged: 2, chunksRemoved: 0, available: true });
  db.close();
});

test("syncEmbeddings: changing one file's chunk re-embeds only that chunk", async () => {
  const { db, codebase, search } = setup();
  const repo = await seedRepo(codebase);
  await seedChunk(codebase, repo.id, repo.scope, "src/a.ts", "alpha content", { fileId: "file-a", id: "chunk-a", contentHash: "hash-a-v1" });
  await seedChunk(codebase, repo.id, repo.scope, "src/b.ts", "beta content", { fileId: "file-b", id: "chunk-b", contentHash: "hash-b-v1" });
  await search.syncEmbeddings(repo.id);

  // Simulate CodebaseIndexer re-indexing file "a" with changed content: replaceFile
  // upserts the same fileId with a new chunk id/contentHash for its (single) chunk.
  await seedChunk(codebase, repo.id, repo.scope, "src/a.ts", "alpha content CHANGED", {
    fileId: "file-a",
    id: "chunk-a-v2",
    contentHash: "hash-a-v2",
  });

  const result = await search.syncEmbeddings(repo.id);
  assert.equal(result.chunksEmbedded, 1, "only the changed file's chunk should be re-embedded");
  assert.equal(result.chunksUnchanged, 1, "the untouched file's chunk stays unchanged");
  assert.equal(result.chunksRemoved, 1, "the old chunk id for the changed file is gone (replaceFile deletes it)");
  db.close();
});

test("syncEmbeddings: removing a file's chunks removes the corresponding vector entries on next sync", async () => {
  const { db, codebase, search } = setup();
  const repo = await seedRepo(codebase);
  const chunk = await seedChunk(codebase, repo.id, repo.scope, "src/gone.ts", "will be removed", { fileId: "file-gone" });
  await seedChunk(codebase, repo.id, repo.scope, "src/stays.ts", "will remain");
  await search.syncEmbeddings(repo.id);

  await codebase.removeFile("file-gone");
  const result = await search.syncEmbeddings(repo.id);
  assert.equal(result.chunksRemoved, 1);
  assert.equal(result.chunksEmbedded, 0);
  assert.equal(result.chunksUnchanged, 1);

  const remaining = db.raw.prepare(`SELECT 1 FROM code_chunk_vectors WHERE chunk_id = ?`).get(chunk.id);
  assert.equal(remaining, undefined, "the removed chunk's vector row must be gone");
  db.close();
});

function vectorSearchSupported(): boolean {
  const probe = openDatabase(":memory:");
  const available = probe.vectorSearchAvailable;
  probe.close();
  return available;
}

// Phase 3.2's CodeSearchStore behavioural contract (@brain/test-fixtures), the same
// body run against FakeCodeSearchStore -- one contract, every implementation.
runCodeSearchStoreConformance({
  name: "SqliteCodeSearchStore",
  async setup(seeds) {
    const db = openDatabase(":memory:");
    const embeddings = new FakeEmbeddingProvider();
    const codebase = new SqliteCodebaseRepository(db.raw);
    const search = new SqliteCodeSearchStore(db.raw, embeddings, db.vectorSearchAvailable);

    // The conformance suite queries filters.repositoryId by the exact label it
    // passed into the seed (e.g. "repo-a") -- so the `repositories` row's id must
    // BE that label, not a fresh randomUUID from codebase.createRepository(). A raw
    // insert (SQL is allowed in this package) satisfies the FK from code_files/
    // code_chunks.repository_id while giving exact control over the id value.
    const repoLabels = new Set(seeds.map((seed) => seed.repositoryId ?? "repo-default"));
    const now = new Date().toISOString();
    for (const label of repoLabels) {
      db.raw
        .prepare(
          `INSERT INTO repositories (id, scope_kind, scope_id, root_path, created_at, updated_at, last_indexed_at)
           VALUES (?,'global',NULL,?,?,?,NULL)`,
        )
        .run(label, label, now, now);
    }
    for (const [i, seed] of seeds.entries()) {
      const repositoryId = seed.repositoryId ?? "repo-default";
      await seedChunk(codebase, repositoryId, seed.scope, seed.relativePath, seed.content, {
        id: `chunk-${i}`,
        fileId: `file-${i}`,
        language: seed.language ?? "typescript",
      });
    }
    for (const repositoryId of repoLabels) {
      await search.syncEmbeddings(repositoryId);
    }

    return { store: search, cleanup: () => db.close() };
  },
  semantic: vectorSearchSupported(),
});
