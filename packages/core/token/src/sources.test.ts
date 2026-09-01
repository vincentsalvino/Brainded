import { test } from "node:test";
import assert from "node:assert/strict";
import type { ContextSourceWrapper } from "@brain/contracts";
import { optimizeSources } from "./sources.js";

function wrapper(sourceType: "memory" | "code" | "dependency", content: string, rank: number): ContextSourceWrapper {
  const base = { content, rank, wasCompressed: false };
  if (sourceType === "memory") return { ...base, sourceType, item: { memoryId: `id-${rank}`, content, type: "fact", domain: null, scope: { kind: "global", id: null }, source: { origin: "system" }, confidence: 0.5, score: 1, rank, wasCompressed: false } };
  if (sourceType === "code") return { ...base, sourceType, item: { sourceType: "code", chunkId: `c-${rank}`, repositoryId: "r", fileId: `f-${rank}`, relativePath: "a.ts", language: "typescript", startLine: 1, endLine: 2, content, score: 1, rank, wasCompressed: false } };
  return { ...base, sourceType, item: { sourceType: "dependency", repositoryId: "r", seedFileId: `f-${rank}`, seedRelativePath: "a.ts", relation: "dependency", facts: [], content, rank, wasCompressed: false } };
}

const estimate = (text: string): number => text.length;
const noCompress = (content: string): { content: string; wasCompressed: boolean } => ({ content, wasCompressed: false });

test("optimizeSources: fills across all three source types under one shared budget, never exceeding it", () => {
  const items = [wrapper("code", "12345", 1), wrapper("memory", "123", 2), wrapper("dependency", "12", 3)];
  const result = optimizeSources(items, { maxTokens: 100 }, estimate, noCompress);
  assert.equal(result.items.length, 3);
  assert.ok(result.tokenCount <= 100);
});

test("optimizeSources: a tiny budget across mixed sources omits predictably and never exceeds maxTokens", () => {
  const items = [wrapper("code", "1234567890", 1), wrapper("memory", "1234567890", 2), wrapper("dependency", "1234567890", 3)];
  const result = optimizeSources(items, { maxTokens: 15 }, estimate, noCompress);
  assert.ok(result.tokenCount <= 15);
  assert.ok(result.omittedCount > 0);
});

test("optimizeSources: output order matches input rank order (already the caller's intended order, selectSources' output)", () => {
  const items = [wrapper("memory", "1", 1), wrapper("code", "2", 2)];
  const result = optimizeSources(items, { maxTokens: 100 }, estimate, noCompress);
  assert.deepEqual(result.items.map((w) => w.rank), [1, 2]);
});
