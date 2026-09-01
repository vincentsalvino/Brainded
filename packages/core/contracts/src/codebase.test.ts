import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { CodebaseRecordSchema, CodeFileRecordSchema, CodeChunkRecordSchema } from "./codebase.js";
import { globalScope, projectScope } from "./scope.js";

function now() {
  return new Date().toISOString();
}

test("CodebaseRecord: accepts a well-formed record and rejects unrecognized fields", () => {
  const record = CodebaseRecordSchema.parse({
    id: randomUUID(),
    scope: projectScope("proj-a"),
    rootPath: "/repo",
    createdAt: now(),
    updatedAt: now(),
    lastIndexedAt: null,
  });
  assert.equal(record.lastIndexedAt, null);
  assert.throws(() =>
    CodebaseRecordSchema.parse({
      id: randomUUID(),
      scope: globalScope(),
      rootPath: "/repo",
      createdAt: now(),
      updatedAt: now(),
      lastIndexedAt: null,
      extra: true,
    }),
  );
});

test("CodeFileRecord: id is a plain non-empty string, not required to be a uuid", () => {
  const file = CodeFileRecordSchema.parse({
    id: "deadbeef",
    repositoryId: "repo-1",
    scope: projectScope("proj-a"),
    relativePath: "src/index.ts",
    language: "typescript",
    sizeBytes: 42,
    contentHash: "abc123",
    indexedAt: now(),
  });
  assert.equal(file.id, "deadbeef");
});

test("CodeFileRecord: language may be null; sizeBytes must be non-negative", () => {
  const file = CodeFileRecordSchema.parse({
    id: "deadbeef",
    repositoryId: "repo-1",
    scope: projectScope("proj-a"),
    relativePath: "README",
    language: null,
    sizeBytes: 0,
    contentHash: "abc123",
    indexedAt: now(),
  });
  assert.equal(file.language, null);
  assert.throws(() =>
    CodeFileRecordSchema.parse({
      id: "deadbeef",
      repositoryId: "repo-1",
      scope: projectScope("proj-a"),
      relativePath: "README",
      language: null,
      sizeBytes: -1,
      contentHash: "abc123",
      indexedAt: now(),
    }),
  );
});

function baseChunk(overrides: Record<string, unknown> = {}) {
  return {
    id: "chunk-1",
    fileId: "file-1",
    repositoryId: "repo-1",
    scope: projectScope("proj-a"),
    relativePath: "src/index.ts",
    chunkIndex: 0,
    startLine: 1,
    endLine: 10,
    content: "const x = 1;",
    contentHash: "abc123",
    ...overrides,
  };
}

test("CodeChunkRecord: accepts a well-formed chunk", () => {
  const chunk = CodeChunkRecordSchema.parse(baseChunk());
  assert.equal(chunk.chunkIndex, 0);
});

test("CodeChunkRecord: rejects endLine before startLine", () => {
  assert.throws(() => CodeChunkRecordSchema.parse(baseChunk({ startLine: 10, endLine: 5 })));
});

test("CodeChunkRecord: rejects a negative chunkIndex and a zero startLine", () => {
  assert.throws(() => CodeChunkRecordSchema.parse(baseChunk({ chunkIndex: -1 })));
  assert.throws(() => CodeChunkRecordSchema.parse(baseChunk({ startLine: 0 })));
});
