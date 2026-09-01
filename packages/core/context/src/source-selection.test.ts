import { test } from "node:test";
import assert from "node:assert/strict";
import { globalScope } from "@brain/contracts";
import type { ContextItem, CodeContextItem, DependencyContextItem } from "@brain/contracts";
import { selectSources } from "./source-selection.js";

function memoryItem(memoryId: string, score: number): ContextItem {
  return {
    memoryId,
    content: `memory content for ${memoryId}`,
    type: "fact",
    domain: null,
    scope: globalScope(),
    source: { origin: "system" },
    confidence: 0.8,
    score,
    rank: 1,
    wasCompressed: false,
  };
}

function codeItem(chunkId: string, fileId: string, score: number): CodeContextItem {
  return {
    sourceType: "code",
    chunkId,
    repositoryId: "repo-1",
    fileId,
    relativePath: `src/${fileId}.ts`,
    language: "typescript",
    startLine: 1,
    endLine: 10,
    content: `code content for ${chunkId}`,
    score,
    rank: 1,
    wasCompressed: false,
  };
}

function dependencyItem(seedFileId: string): DependencyContextItem {
  return {
    sourceType: "dependency",
    repositoryId: "repo-1",
    seedFileId,
    seedRelativePath: `src/${seedFileId}.ts`,
    relation: "dependency",
    facts: [{ fileId: "dep-1", relativePath: "src/dep-1.ts", depth: null }],
    content: "[DEPENDENCY] ...",
    rank: 1,
    wasCompressed: false,
  };
}

test("selectSources: memory and code interleave by score, highest first", () => {
  const memory = [memoryItem("m1", 0.9), memoryItem("m2", 0.3)];
  const code = [codeItem("c1", "f1", 0.95), codeItem("c2", "f2", 0.5)];
  const result = selectSources(memory, code, new Map());
  assert.deepEqual(
    result.map((w) => (w.sourceType === "memory" ? w.item.memoryId : w.sourceType === "code" ? w.item.chunkId : "dep")),
    ["c1", "m1", "c2", "m2"],
  );
});

test("selectSources: rank is assigned sequentially 1..N over the final combined array", () => {
  const result = selectSources([memoryItem("m1", 0.5)], [codeItem("c1", "f1", 0.9)], new Map());
  assert.deepEqual(result.map((w) => w.rank), [1, 2]);
});

test("selectSources: a source with zero candidates gets zero items -- no padding", () => {
  const result = selectSources([], [codeItem("c1", "f1", 0.9)], new Map());
  assert.ok(result.every((w) => w.sourceType !== "memory"));
});

test("selectSources: starvation safety -- memory's best item is promoted into the top window when code otherwise dominates it entirely", () => {
  const memory = [memoryItem("m1", 0.1)]; // scores far below every code item
  const code = [codeItem("c1", "f1", 0.9), codeItem("c2", "f2", 0.85), codeItem("c3", "f3", 0.8), codeItem("c4", "f4", 0.75)];
  const result = selectSources(memory, code, new Map());
  const memoryPosition = result.findIndex((w) => w.sourceType === "memory");
  assert.ok(memoryPosition >= 0 && memoryPosition < 3, `expected memory promoted into top 3, got position ${memoryPosition}`);
});

test("selectSources: starvation safety never fires when a source has zero candidates -- no promotion out of thin air", () => {
  const result = selectSources([], [codeItem("c1", "f1", 0.9), codeItem("c2", "f2", 0.8)], new Map());
  assert.equal(result.filter((w) => w.sourceType === "memory").length, 0);
});

test("selectSources: dependency items for a seed file are spliced immediately after that seed, not globally re-sorted by score", () => {
  const code = [codeItem("c1", "f1", 0.9)];
  const deps = new Map([["f1", [dependencyItem("f1")]]]);
  const result = selectSources([], code, deps);
  assert.equal(result[0]?.sourceType, "code");
  assert.equal(result[1]?.sourceType, "dependency");
});

test("selectSources: dependency enrichment is bounded to maxDependencySeedFiles -- later code items get no enrichment even if present in the map", () => {
  const code = [codeItem("c1", "f1", 0.9), codeItem("c2", "f2", 0.8), codeItem("c3", "f3", 0.7), codeItem("c4", "f4", 0.6)];
  const deps = new Map([
    ["f1", [dependencyItem("f1")]],
    ["f2", [dependencyItem("f2")]],
    ["f3", [dependencyItem("f3")]],
    ["f4", [dependencyItem("f4")]],
  ]);
  const result = selectSources([], code, deps, { maxDependencySeedFiles: 2 });
  assert.equal(result.filter((w) => w.sourceType === "dependency").length, 2);
});

test("selectSources: deterministic -- identical input produces identical output across repeated calls", () => {
  const memory = [memoryItem("m1", 0.5), memoryItem("m2", 0.5)]; // tied score, exercises the id tie-break
  const code = [codeItem("c1", "f1", 0.5)];
  const first = selectSources(memory, code, new Map()).map((w) => w.rank);
  const second = selectSources(memory, code, new Map()).map((w) => w.rank);
  assert.deepEqual(first, second);
});

// Beyond the brief: the "deterministic" test above ties memory-vs-memory (m1/m2)
// and memory-vs-code (c1/m1), but never two code items against each other, so it
// cannot catch a comparator that special-cases sourceType instead of comparing
// ids uniformly. codeItem ids are passed reversed (c2 before c1) so a stable
// pass-through sort would fail this -- only an actual ascending-id tie-break passes.
test("selectSources: tie-break by id also applies code-vs-code (ascending chunkId when scores are equal)", () => {
  const code = [codeItem("c2", "f2", 0.5), codeItem("c1", "f1", 0.5)];
  const result = selectSources([], code, new Map());
  assert.deepEqual(
    result.map((w) => (w.sourceType === "code" ? w.item.chunkId : "n/a")),
    ["c1", "c2"],
  );
});
