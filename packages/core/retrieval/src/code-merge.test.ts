import { test } from "node:test";
import assert from "node:assert/strict";
import type { CodeSearchResult } from "@brain/contracts";
import { buildCodeSearchResult } from "@brain/test-fixtures";
import { mergeCodeCandidates } from "./code-merge.js";

function result(chunkId: string, signals: CodeSearchResult["signals"], overrides: Partial<CodeSearchResult> = {}): CodeSearchResult {
  return buildCodeSearchResult({ chunkId, signals, ...overrides });
}

test("a chunkId present in only one source appears once, signals untouched", () => {
  const merged = mergeCodeCandidates([result("chunk-a", { lexicalScore: 0.8 })], []);
  assert.equal(merged.length, 1);
  assert.equal(merged[0]?.signals.lexicalScore, 0.8);
  assert.equal(merged[0]?.signals.semanticScore, undefined);
});

test("a chunkId present in both sources merges into ONE result with both signals -- not a combined score", () => {
  const merged = mergeCodeCandidates(
    [result("chunk-a", { lexicalScore: 0.8 })],
    [result("chunk-a", { semanticScore: 0.6 })],
  );
  assert.equal(merged.length, 1, "identity-merged by chunkId, not duplicated");
  assert.equal(merged[0]?.signals.lexicalScore, 0.8);
  assert.equal(merged[0]?.signals.semanticScore, 0.6);
  assert.equal(Object.keys(merged[0]?.signals ?? {}).sort().join(","), "lexicalScore,semanticScore");
});

test("deterministic channel selection: when both channels return the same chunk, the lexical channel's non-signal fields win", () => {
  const merged = mergeCodeCandidates(
    [result("chunk-a", { lexicalScore: 0.8 }, { relativePath: "src/from-lexical.ts", content: "lexical copy" })],
    [result("chunk-a", { semanticScore: 0.6 }, { relativePath: "src/from-semantic.ts", content: "semantic copy" })],
  );
  assert.equal(merged.length, 1);
  assert.equal(merged[0]?.relativePath, "src/from-lexical.ts", "lexical is inserted first; semantic only overlays signals");
  assert.equal(merged[0]?.content, "lexical copy");
});

test("disjoint sources: result size is the union, up to lexical.length + semantic.length", () => {
  const merged = mergeCodeCandidates(
    [result("chunk-a", { lexicalScore: 0.5 }), result("chunk-b", { lexicalScore: 0.4 })],
    [result("chunk-c", { semanticScore: 0.3 })],
  );
  assert.equal(merged.length, 3);
});

test("empty inputs produce an empty pool", () => {
  assert.deepEqual(mergeCodeCandidates([], []), []);
});
