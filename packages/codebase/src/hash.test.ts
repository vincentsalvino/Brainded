import { test } from "node:test";
import assert from "node:assert/strict";
import { hashContent, deriveFileId, deriveChunkId, deriveEdgeId } from "./hash.js";

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

test("deriveEdgeId is deterministic per (repositoryId, sourceFileId, specifier, kind)", () => {
  const a = deriveEdgeId("repo-1", "file-1", "./b", "static_import");
  const b = deriveEdgeId("repo-1", "file-1", "./b", "static_import");
  assert.equal(a, b);
});

test("deriveEdgeId collapses duplicate occurrences: identical (specifier, kind) from the same file is one id", () => {
  // Two separate extracted occurrences of the same specifier+kind must hash to the
  // same id -- this IS the duplicate-collapsing mechanism (PHASE_3_SPEC.md Edge
  // Identity), not an accident of the hash inputs.
  const first = deriveEdgeId("repo-1", "file-1", "./b", "static_import");
  const second = deriveEdgeId("repo-1", "file-1", "./b", "static_import");
  assert.equal(first, second);
});

test("deriveEdgeId differs across kind for the same specifier (a require and an import of the same module are distinct edges)", () => {
  assert.notEqual(
    deriveEdgeId("repo-1", "file-1", "./b", "static_import"),
    deriveEdgeId("repo-1", "file-1", "./b", "require"),
  );
});

test("deriveEdgeId differs across specifiers, sourceFileIds, and repositoryIds", () => {
  const base = deriveEdgeId("repo-1", "file-1", "./b", "static_import");
  assert.notEqual(base, deriveEdgeId("repo-1", "file-1", "./c", "static_import"));
  assert.notEqual(base, deriveEdgeId("repo-1", "file-2", "./b", "static_import"));
  assert.notEqual(base, deriveEdgeId("repo-2", "file-1", "./b", "static_import"));
});
