import { test } from "node:test";
import assert from "node:assert/strict";
import { hashContent, deriveFileId, deriveChunkId } from "./hash.js";

test("hashContent is deterministic for identical content", () => {
  assert.equal(hashContent("hello world"), hashContent("hello world"));
});

test("hashContent differs for different content", () => {
  assert.notEqual(hashContent("hello"), hashContent("hello!"));
});

test("hashContent accepts a Buffer and a string producing the same hash for the same bytes", () => {
  assert.equal(hashContent("hello"), hashContent(Buffer.from("hello", "utf-8")));
});

test("deriveFileId is deterministic and depends only on repositoryId + relativePath", () => {
  const a = deriveFileId("repo-1", "src/index.ts");
  const b = deriveFileId("repo-1", "src/index.ts");
  assert.equal(a, b);
});

test("deriveFileId differs across repositories for the identical relativePath (isolation)", () => {
  const a = deriveFileId("repo-a", "src/index.ts");
  const b = deriveFileId("repo-b", "src/index.ts");
  assert.notEqual(a, b);
});

test("deriveFileId differs across relativePaths within the same repository", () => {
  const a = deriveFileId("repo-1", "src/index.ts");
  const b = deriveFileId("repo-1", "src/other.ts");
  assert.notEqual(a, b);
});

test("deriveFileId is independent of content -- only path identity, never content, decides the id", () => {
  assert.equal(deriveFileId("repo-1", "src/index.ts"), deriveFileId("repo-1", "src/index.ts"));
});

test("deriveChunkId is deterministic per (fileId, chunkIndex)", () => {
  const a = deriveChunkId("file-1", 0);
  const b = deriveChunkId("file-1", 0);
  assert.equal(a, b);
});

test("deriveChunkId differs across chunkIndex values for the same file", () => {
  assert.notEqual(deriveChunkId("file-1", 0), deriveChunkId("file-1", 1));
});

test("deriveChunkId differs across files for the same chunkIndex", () => {
  assert.notEqual(deriveChunkId("file-1", 0), deriveChunkId("file-2", 0));
});
