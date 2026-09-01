import { test } from "node:test";
import assert from "node:assert/strict";
import { chunkContent, DEFAULT_CHUNK_POLICY } from "./chunker.js";

test("empty content produces zero chunks", () => {
  assert.deepEqual(chunkContent(""), []);
});

test("a file smaller than maxLines produces exactly one chunk covering every line", () => {
  const content = "a\nb\nc";
  const chunks = chunkContent(content, { maxLines: 200, overlapLines: 0 });
  assert.equal(chunks.length, 1);
  assert.equal(chunks[0]?.startLine, 1);
  assert.equal(chunks[0]?.endLine, 3);
  assert.equal(chunks[0]?.content, "a\nb\nc");
});

test("a trailing newline is not counted as an extra blank final line", () => {
  const chunks = chunkContent("a\nb\nc\n", { maxLines: 200, overlapLines: 0 });
  assert.equal(chunks.length, 1);
  assert.equal(chunks[0]?.endLine, 3);
});

test("line ranges are correct and contiguous across multiple chunks (no overlap)", () => {
  const content = ["1", "2", "3", "4", "5"].join("\n");
  const chunks = chunkContent(content, { maxLines: 2, overlapLines: 0 });
  assert.deepEqual(
    chunks.map((c) => [c.startLine, c.endLine]),
    [
      [1, 2],
      [3, 4],
      [5, 5],
    ],
  );
  assert.deepEqual(
    chunks.map((c) => c.content),
    ["1\n2", "3\n4", "5"],
  );
});

test("chunkIndex is 0-based and strictly increasing", () => {
  const content = ["1", "2", "3", "4", "5"].join("\n");
  const chunks = chunkContent(content, { maxLines: 2, overlapLines: 0 });
  assert.deepEqual(
    chunks.map((c) => c.chunkIndex),
    [0, 1, 2],
  );
});

test("no chunk ever exceeds maxLines lines", () => {
  const content = Array.from({ length: 503 }, (_, i) => `line ${i}`).join("\n");
  const chunks = chunkContent(content, { maxLines: 100, overlapLines: 0 });
  for (const c of chunks) {
    assert.ok(c.endLine - c.startLine + 1 <= 100);
  }
  assert.equal(chunks.at(-1)?.endLine, 503);
});

test("chunking the same content twice is deterministic", () => {
  const content = Array.from({ length: 250 }, (_, i) => `line ${i}`).join("\n");
  assert.deepEqual(chunkContent(content, DEFAULT_CHUNK_POLICY), chunkContent(content, DEFAULT_CHUNK_POLICY));
});

test("DEFAULT_CHUNK_POLICY has 0 overlap and a 200-line window", () => {
  assert.deepEqual(DEFAULT_CHUNK_POLICY, { maxLines: 200, overlapLines: 0 });
});
