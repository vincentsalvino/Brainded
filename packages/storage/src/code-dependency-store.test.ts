import { test } from "node:test";
import assert from "node:assert/strict";
import { globalScope, projectScope, type CodeDependencyEdge, type ScopeRef } from "@brain/contracts";
import { runCodeDependencyStoreConformance } from "@brain/test-fixtures";
import { openDatabase } from "./db.js";
import { SqliteCodebaseRepository } from "./codebase-repository.js";
import { SqliteCodeDependencyStore } from "./code-dependency-store.js";

async function setup() {
  const db = openDatabase(":memory:");
  const codebase = new SqliteCodebaseRepository(db.raw);
  const store = new SqliteCodeDependencyStore(db.raw);
  const repository = await codebase.createRepository(projectScope("proj-a"), "/repo");
  return { db, codebase, store, repositoryId: repository.id };
}

function edge(repositoryId: string, overrides: Partial<CodeDependencyEdge> = {}): CodeDependencyEdge {
  return {
    id: "edge-1",
    repositoryId,
    scope: projectScope("proj-a") as ScopeRef,
    sourceFileId: "file-a",
    targetFileId: "file-b",
    specifier: "./b",
    kind: "static_import",
    resolution: "internal",
    sourceLine: 1,
    createdAt: new Date().toISOString(),
    ...overrides,
  };
}

test("replaceOutgoingEdges writes edges; listEdges reads them back", async () => {
  const { store, repositoryId } = await setup();
  const { edgesCreated, edgesRemoved } = await store.replaceOutgoingEdges(repositoryId, "file-a", "hash-1", [
    edge(repositoryId),
  ]);
  assert.equal(edgesCreated, 1);
  assert.equal(edgesRemoved, 0);
  const all = await store.listEdges(repositoryId);
  assert.equal(all.length, 1);
  assert.equal(all[0]?.specifier, "./b");
});

test("replaceOutgoingEdges also writes the dependency-state row (contentHash tracked)", async () => {
  const { store, repositoryId } = await setup();
  await store.replaceOutgoingEdges(repositoryId, "file-a", "hash-1", [edge(repositoryId)]);
  const state = await store.listDependencyState(repositoryId);
  assert.deepEqual(state, [{ fileId: "file-a", contentHash: "hash-1" }]);
});

test("a source-file update replaces old edges wholesale -- the old edge id is gone", async () => {
  const { store, repositoryId } = await setup();
  await store.replaceOutgoingEdges(repositoryId, "file-a", "hash-1", [
    edge(repositoryId, { id: "old-edge", specifier: "./old" }),
  ]);
  const { edgesRemoved, edgesCreated } = await store.replaceOutgoingEdges(repositoryId, "file-a", "hash-2", [
    edge(repositoryId, { id: "new-edge", specifier: "./new" }),
  ]);
  assert.equal(edgesRemoved, 1);
  assert.equal(edgesCreated, 1);
  const all = await store.listEdges(repositoryId);
  assert.deepEqual(all.map((e) => e.id), ["new-edge"]);
});

test("repository isolation is enforced in SQL: another repository's edges never appear", async () => {
  const { codebase, store, repositoryId: repoA } = await setup();
  const repoB = (await codebase.createRepository(projectScope("proj-b"), "/repo-b")).id;
  await store.replaceOutgoingEdges(repoA, "file-a", "hash-1", [edge(repoA, { id: "edge-a" })]);
  await store.replaceOutgoingEdges(repoB, "file-a", "hash-1", [edge(repoB, { id: "edge-b" })]);
  const edgesA = await store.listEdges(repoA);
  assert.deepEqual(edgesA.map((e) => e.id), ["edge-a"]);
});

test("dependenciesOf: direct outgoing edges for a source file", async () => {
  const { store, repositoryId } = await setup();
  await store.replaceOutgoingEdges(repositoryId, "file-a", "hash-1", [
    edge(repositoryId, { id: "e1", targetFileId: "file-b", specifier: "./b" }),
    edge(repositoryId, { id: "e2", targetFileId: "file-c", specifier: "./c" }),
  ]);
  const deps = await store.dependenciesOf(repositoryId, "file-a");
  assert.deepEqual(
    deps.map((e) => e.targetFileId).sort(),
    ["file-b", "file-c"],
  );
});

test("dependentsOf: direct incoming edges for a target file", async () => {
  const { store, repositoryId } = await setup();
  await store.replaceOutgoingEdges(repositoryId, "file-a", "hash-1", [
    edge(repositoryId, { id: "e1", sourceFileId: "file-a", targetFileId: "file-shared", specifier: "./shared" }),
  ]);
  await store.replaceOutgoingEdges(repositoryId, "file-b", "hash-1", [
    edge(repositoryId, { id: "e2", sourceFileId: "file-b", targetFileId: "file-shared", specifier: "./shared" }),
  ]);
  const dependents = await store.dependentsOf(repositoryId, "file-shared");
  assert.deepEqual(
    dependents.map((e) => e.sourceFileId).sort(),
    ["file-a", "file-b"],
  );
});

test("updateEdgeResolution: a targeted resolution flip does not touch other edges", async () => {
  const { store, repositoryId } = await setup();
  await store.replaceOutgoingEdges(repositoryId, "file-a", "hash-1", [
    edge(repositoryId, { id: "e1", targetFileId: "file-b", resolution: "internal" }),
    edge(repositoryId, { id: "e2", targetFileId: null, resolution: "unresolved", specifier: "./gone" }),
  ]);
  await store.updateEdgeResolution("e2", "internal", "file-b-now-exists");
  const all = await store.listEdges(repositoryId);
  const e1 = all.find((e) => e.id === "e1");
  const e2 = all.find((e) => e.id === "e2");
  assert.equal(e1?.resolution, "internal", "untouched edge must be unaffected");
  assert.equal(e2?.resolution, "internal");
  assert.equal(e2?.targetFileId, "file-b-now-exists");
});

test("removeFileState deletes a source file's outgoing edges and its state row", async () => {
  const { store, repositoryId } = await setup();
  await store.replaceOutgoingEdges(repositoryId, "file-a", "hash-1", [edge(repositoryId)]);
  const { edgesRemoved } = await store.removeFileState(repositoryId, "file-a");
  assert.equal(edgesRemoved, 1);
  assert.deepEqual(await store.listEdges(repositoryId), []);
  assert.deepEqual(await store.listDependencyState(repositoryId), []);
});

test("replaceOutgoingEdges is a real transaction: a poisoned edge batch leaves no partial rows", async () => {
  const { db, store, repositoryId } = await setup();
  // resolution='internal' with a null targetFileId cannot occur through
  // CodeDependencyEdgeSchema (contracts layer rejects it via .refine()), but the SQL
  // CHECK constraint is the real, storage-level guarantee -- exercised directly
  // here, bypassing the schema, same discipline as codebase-repository.test.ts's
  // poisoned-chunk-batch test.
  const good = edge(repositoryId, { id: "good" });
  const bad = edge(repositoryId, { id: "bad", resolution: "internal", targetFileId: null });
  await assert.rejects(() => store.replaceOutgoingEdges(repositoryId, "file-a", "hash-1", [good, bad]));
  assert.deepEqual(await store.listEdges(repositoryId), []);
  const state = db.raw.prepare(`SELECT 1 FROM code_dependency_state WHERE file_id = ?`).get("file-a");
  assert.equal(state, undefined, "the state row must not exist either -- same transaction, same rollback");
});

// Phase 3.3's CodeDependencyStore behavioural contract (@brain/test-fixtures), the
// same body run against FakeCodeDependencyStore -- one contract, every
// implementation. The conformance suite addresses fixed repository id labels
// ("repo-1", "repo-a", "repo-b") directly, so the harness inserts `repositories`
// rows with exactly those ids up front (raw SQL -- code_dependency_edges.repository_id
// has a real FK, same as code-search-store.test.ts's repositoryId-filter harness).
runCodeDependencyStoreConformance({
  name: "SqliteCodeDependencyStore",
  async setup() {
    const db = openDatabase(":memory:");
    const store = new SqliteCodeDependencyStore(db.raw);
    const now = new Date().toISOString();
    const insertRepo = db.raw.prepare(
      `INSERT INTO repositories (id, scope_kind, scope_id, root_path, created_at, updated_at, last_indexed_at)
       VALUES (?,'global',NULL,?,?,?,NULL)`,
    );
    for (const label of ["repo-1", "repo-a", "repo-b"]) {
      insertRepo.run(label, label, now, now);
    }
    return { store, cleanup: () => db.close() };
  },
});

test("scope isolation: edges are scoped like any other codebase record (defense in depth alongside repositoryId)", async () => {
  const { store, repositoryId } = await setup();
  await store.replaceOutgoingEdges(repositoryId, "file-a", "hash-1", [edge(repositoryId, { scope: globalScope() })]);
  const all = await store.listEdges(repositoryId);
  assert.equal(all[0]?.scope.kind, "global");
});
