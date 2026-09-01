import { test } from "node:test";
import assert from "node:assert/strict";
import { globalScope, projectScope } from "@brain/contracts";
import type { CodeChunkRecord, CodeFileRecord } from "@brain/contracts";
import { openDatabase } from "./db.js";
import { SqliteCodebaseRepository } from "./codebase-repository.js";

async function setup() {
  const db = openDatabase(":memory:");
  const repo = new SqliteCodebaseRepository(db.raw);
  const repository = await repo.createRepository(projectScope("proj-a"), "/repo");
  return { db, repo, repositoryId: repository.id };
}

function file(repositoryId: string, overrides: Partial<CodeFileRecord> = {}): CodeFileRecord {
  return {
    id: "file-1",
    repositoryId,
    scope: projectScope("proj-a"),
    relativePath: "src/index.ts",
    language: "typescript",
    sizeBytes: 12,
    contentHash: "hash-1",
    indexedAt: new Date().toISOString(),
    ...overrides,
  };
}

function chunk(fileId: string, repositoryId: string, overrides: Partial<CodeChunkRecord> = {}): CodeChunkRecord {
  return {
    id: "chunk-1",
    fileId,
    repositoryId,
    scope: projectScope("proj-a"),
    relativePath: "src/index.ts",
    chunkIndex: 0,
    startLine: 1,
    endLine: 5,
    content: "const x = 1;",
    contentHash: "hash-1",
    ...overrides,
  };
}

test("createRepository then findRepository returns the same record", async () => {
  const { repo } = await setup();
  const created = await repo.createRepository(projectScope("proj-b"), "/other-repo");
  const found = await repo.findRepository(projectScope("proj-b"), "/other-repo");
  assert.equal(found?.id, created.id);
  assert.equal(found?.lastIndexedAt, null);
});

test("findRepository returns null for an unregistered root", async () => {
  const { repo } = await setup();
  assert.equal(await repo.findRepository(projectScope("proj-a"), "/nope"), null);
});

test("findRepository is scope-isolated: same rootPath, different project, no match", async () => {
  const { repo } = await setup();
  assert.equal(await repo.findRepository(projectScope("proj-b"), "/repo"), null);
});

test("markIndexed sets lastIndexedAt", async () => {
  const db = openDatabase(":memory:");
  const repo = new SqliteCodebaseRepository(db.raw);
  const created = await repo.createRepository(globalScope(), "/repo");
  await repo.markIndexed(created.id);
  const found = await repo.findRepository(globalScope(), "/repo");
  assert.ok(found?.lastIndexedAt);
});

test("replaceFile persists a new file with its chunks; listFiles sees it", async () => {
  const { repo, repositoryId } = await setup();
  const f = file(repositoryId);
  const { chunksCreated, chunksRemoved } = await repo.replaceFile(f, [chunk(f.id, repositoryId)]);
  assert.equal(chunksCreated, 1);
  assert.equal(chunksRemoved, 0);
  const files = await repo.listFiles(repositoryId);
  assert.equal(files.length, 1);
  assert.equal(files[0]?.contentHash, "hash-1");
});

test("replaceFile on an existing file id updates in place, never duplicates the file row", async () => {
  const { repo, repositoryId } = await setup();
  const f = file(repositoryId);
  await repo.replaceFile(f, [chunk(f.id, repositoryId)]);
  await repo.replaceFile(file(repositoryId, { contentHash: "hash-2", sizeBytes: 99 }), [
    chunk(f.id, repositoryId, { id: "chunk-2", contentHash: "hash-2" }),
  ]);
  const files = await repo.listFiles(repositoryId);
  assert.equal(files.length, 1, "re-indexing the same file id must update, not duplicate, the row");
  assert.equal(files[0]?.contentHash, "hash-2");
});

test("replaceFile replaces old chunks wholesale -- the old chunk id is gone", async () => {
  const { db, repo, repositoryId } = await setup();
  const f = file(repositoryId);
  await repo.replaceFile(f, [chunk(f.id, repositoryId, { id: "old-chunk" })]);
  const { chunksCreated, chunksRemoved } = await repo.replaceFile(file(repositoryId, { contentHash: "hash-2" }), [
    chunk(f.id, repositoryId, { id: "new-chunk", contentHash: "hash-2" }),
  ]);
  assert.equal(chunksRemoved, 1);
  assert.equal(chunksCreated, 1);
  const rows = db.raw.prepare(`SELECT id FROM code_chunks WHERE file_id = ?`).all(f.id) as { id: string }[];
  assert.deepEqual(
    rows.map((r) => r.id),
    ["new-chunk"],
  );
});

test("removeFile deletes the file and cascades its chunks", async () => {
  const { db, repo, repositoryId } = await setup();
  const f = file(repositoryId);
  await repo.replaceFile(f, [chunk(f.id, repositoryId), chunk(f.id, repositoryId, { id: "chunk-2", chunkIndex: 1 })]);
  const { chunksRemoved } = await repo.removeFile(f.id);
  assert.equal(chunksRemoved, 2);
  const files = await repo.listFiles(repositoryId);
  assert.equal(files.length, 0);
  const rows = db.raw.prepare(`SELECT id FROM code_chunks WHERE file_id = ?`).all(f.id);
  assert.equal(rows.length, 0);
});

test("listFiles is scoped to repositoryId: another repository's files never appear", async () => {
  const { repo, repositoryId: repoA } = await setup();
  const repoBRecord = await repo.createRepository(projectScope("proj-b"), "/repo-b");
  const repoB = repoBRecord.id;
  await repo.replaceFile(file(repoA, { id: "a-file" }), []);
  await repo.replaceFile(file(repoB, { id: "b-file" }), []);
  const filesA = await repo.listFiles(repoA);
  assert.deepEqual(
    filesA.map((f) => f.id),
    ["a-file"],
  );
});

test("two repositories may index the same relativePath without colliding (distinct file ids)", async () => {
  const { repo, repositoryId: repoA } = await setup();
  const repoB = (await repo.createRepository(projectScope("proj-b"), "/repo-b")).id;
  await repo.replaceFile(file(repoA, { id: "hash-of-repoA-src-index" }), []);
  await repo.replaceFile(file(repoB, { id: "hash-of-repoB-src-index" }), []);
  const filesA = await repo.listFiles(repoA);
  const filesB = await repo.listFiles(repoB);
  assert.equal(filesA.length, 1);
  assert.equal(filesB.length, 1);
  assert.notEqual(filesA[0]?.id, filesB[0]?.id);
});

test("replaceFile is a real transaction: a poisoned chunk batch leaves no partial rows", async () => {
  const { db, repo, repositoryId } = await setup();
  // A chunk with endLine < startLine cannot occur through the CodeChunkRecordSchema
  // (contracts layer rejects it), but the SQL CHECK constraint is the real,
  // storage-level guarantee -- exercised directly here, bypassing the schema, the
  // same way db.test.ts exercises `memories`' CHECK constraints directly.
  const f = file(repositoryId);
  const badChunk = chunk(f.id, repositoryId, { id: "bad", startLine: 10, endLine: 1 });
  await assert.rejects(() => repo.replaceFile(f, [chunk(f.id, repositoryId, { id: "good" }), badChunk]));
  const files = db.raw.prepare(`SELECT id FROM code_files WHERE id = ?`).all(f.id);
  assert.equal(files.length, 0, "the file row must not exist either -- same transaction, same rollback");
  const chunks = db.raw.prepare(`SELECT id FROM code_chunks WHERE file_id = ?`).all(f.id);
  assert.equal(chunks.length, 0, "neither the good nor the bad chunk may survive a rolled-back transaction");
});
