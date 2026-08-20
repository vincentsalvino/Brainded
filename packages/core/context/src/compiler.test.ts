import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { globalScope, projectScope, type RankedResult } from "@brain/contracts";
import { buildMemoryRecord } from "@brain/test-fixtures";
import { compileContext } from "./compiler.js";

function rankedResult(overrides: Partial<RankedResult> = {}, recordOverrides: Record<string, unknown> = {}): RankedResult {
  const memoryId = (recordOverrides.id as string) ?? randomUUID();
  return {
    memoryId,
    record: buildMemoryRecord({ id: memoryId, scope: globalScope(), ...recordOverrides }),
    score: 0.5,
    signals: { diversity: null },
    rank: 1,
    ...overrides,
  };
}

function input(rankedResults: RankedResult[], overrides: Record<string, unknown> = {}) {
  return { task: "example task", scope: globalScope(), rankedResults, ...overrides };
}

test("empty candidate list compiles to an empty context", () => {
  const result = compileContext(input([]));
  assert.deepEqual(result.items, []);
  assert.equal(result.duplicatesRemoved, 0);
});

test("a single ranked result becomes a single context item", () => {
  const r = rankedResult({ rank: 1 });
  const result = compileContext(input([r]));
  assert.equal(result.items.length, 1);
  assert.equal(result.items[0]?.memoryId, r.memoryId);
});

test("multiple candidates all become context items", () => {
  const results = [
    rankedResult({ rank: 1 }, { content: "first distinct content" }),
    rankedResult({ rank: 2 }, { content: "second distinct content" }),
    rankedResult({ rank: 3 }, { content: "third distinct content" }),
  ];
  const compiled = compileContext(input(results));
  assert.equal(compiled.items.length, 3);
});

test("preserves ranking order exactly -- does not re-sort by score or anything else", () => {
  // Deliberately out-of-score-order input: rank 1 has the LOWEST score. If this
  // stage re-ranked, the output order would differ from input order -- it must not.
  const first = rankedResult({ rank: 1, score: 0.1 }, { content: "first content, ranked first" });
  const second = rankedResult({ rank: 2, score: 0.9 }, { content: "second content, ranked second" });
  const compiled = compileContext(input([first, second]));
  assert.deepEqual(
    compiled.items.map((i) => i.memoryId),
    [first.memoryId, second.memoryId],
  );
});

test("deterministic: identical input compiles to identical output across repeated calls", () => {
  const results = [rankedResult({ rank: 1 }), rankedResult({ rank: 2 })];
  const a = compileContext(input(results));
  const b = compileContext(input(results));
  assert.deepEqual(a, b);
});

test("selection: every ranked candidate is included by default -- no relevance thresholding at this stage", () => {
  const weak = rankedResult({ rank: 1, score: 0.01 });
  const compiled = compileContext(input([weak]));
  assert.equal(compiled.items.length, 1, "a low score alone is not a reason to omit -- that would be ranking's job");
});

test("duplicate handling: an exact content match is removed, the higher-ranked (first) copy is kept", () => {
  const duplicateContent = "identical content shared by two different memories";
  const kept = rankedResult({ rank: 1 }, { content: duplicateContent });
  const dropped = rankedResult({ rank: 2 }, { content: duplicateContent });
  const compiled = compileContext(input([kept, dropped]));
  assert.equal(compiled.items.length, 1);
  assert.equal(compiled.items[0]?.memoryId, kept.memoryId);
  assert.equal(compiled.duplicatesRemoved, 1);
});

test("near-duplicate (similar but not identical) content is NOT removed -- only exact matches are", () => {
  const a = rankedResult({ rank: 1 }, { content: "use conventional commits for every pull request" });
  const b = rankedResult({ rank: 2 }, { content: "use conventional commits for every merge request" });
  const compiled = compileContext(input([a, b]));
  assert.equal(compiled.items.length, 2, "similar text must survive -- fuzzy dedup was not required and is not implemented");
  assert.equal(compiled.duplicatesRemoved, 0);
});

test("memory + knowledge coexistence: an experience (memory) and a pattern (knowledge) both compile with type intact", () => {
  const memoryItem = rankedResult({ rank: 1 }, { type: "experience", content: "memory-shaped content" });
  const knowledgeItem = rankedResult({ rank: 2 }, { type: "pattern", content: "knowledge-shaped content" });
  const compiled = compileContext(input([memoryItem, knowledgeItem]));
  assert.equal(compiled.items.find((i) => i.memoryId === memoryItem.memoryId)?.type, "experience");
  assert.equal(compiled.items.find((i) => i.memoryId === knowledgeItem.memoryId)?.type, "pattern");
});

test("provenance survives compilation: source/sourceRef intact on the ContextItem", () => {
  const r = rankedResult({ rank: 1 }, { source: { origin: "import", sourceRef: "aeos-seed:example" } });
  const compiled = compileContext(input([r]));
  assert.equal(compiled.items[0]?.source.origin, "import");
  assert.equal(compiled.items[0]?.source.sourceRef, "aeos-seed:example");
});

test("memoryId is preserved exactly", () => {
  const r = rankedResult({ rank: 1 });
  const compiled = compileContext(input([r]));
  assert.equal(compiled.items[0]?.memoryId, r.memoryId);
});

test("scope is preserved exactly", () => {
  const r = rankedResult({ rank: 1 }, { scope: projectScope("project-a") });
  const compiled = compileContext(input([r]));
  assert.equal(compiled.items[0]?.scope.kind, "project");
  assert.equal(compiled.items[0]?.scope.id, "project-a");
});

test("type is preserved exactly", () => {
  const r = rankedResult({ rank: 1 }, { type: "constraint" });
  const compiled = compileContext(input([r]));
  assert.equal(compiled.items[0]?.type, "constraint");
});

test("confidence is preserved exactly, unmodified", () => {
  const r = rankedResult({ rank: 1 }, { confidence: 0.83 });
  const compiled = compileContext(input([r]));
  assert.equal(compiled.items[0]?.confidence, 0.83);
});

test("context structure: item carries both the ranking score and rank position", () => {
  const r = rankedResult({ rank: 7, score: 0.42 });
  const compiled = compileContext(input([r]));
  assert.equal(compiled.items[0]?.score, 0.42);
  assert.equal(compiled.items[0]?.rank, 7);
});

test("does not mutate RankedResult inputs (frozen input would throw on any write attempt)", () => {
  const r = rankedResult({ rank: 1 });
  Object.freeze(r);
  Object.freeze(r.record);
  Object.freeze(r.signals);
  assert.doesNotThrow(() => compileContext(input([r])));
});

test("repeated compilation of the same object graph produces identical output (no hidden state)", () => {
  const results = [rankedResult({ rank: 1 }), rankedResult({ rank: 2 })];
  const runs = [compileContext(input(results)), compileContext(input(results)), compileContext(input(results))];
  assert.deepEqual(runs[0], runs[1]);
  assert.deepEqual(runs[1], runs[2]);
});

test("no token-budget enforcement: CompiledContext has no tokenCount/truncated fields at all", () => {
  const compiled = compileContext(input([rankedResult({ rank: 1 })]));
  assert.equal("tokenCount" in compiled, false);
  assert.equal("truncated" in compiled, false);
});

// --- Step 16: adversarial architectural-boundary tests ----------------------

test("boundary: is NOT a ranking engine -- output order matches input rankedResults order, never re-derived from score", () => {
  const lowScoreButRankedFirst = rankedResult({ rank: 1, score: 0.05 });
  const highScoreButRankedSecond = rankedResult({ rank: 2, score: 0.95 });
  const compiled = compileContext(input([lowScoreButRankedFirst, highScoreButRankedSecond]));
  assert.equal(compiled.items[0]?.memoryId, lowScoreButRankedFirst.memoryId, "must trust P1-009's order, not re-rank by score");
});

test("boundary: is NOT a token optimizer -- a very long, high-ranked item is never dropped for its length", () => {
  const longContent = "x".repeat(50_000);
  const r = rankedResult({ rank: 1 }, { content: longContent });
  const compiled = compileContext(input([r]));
  assert.equal(compiled.items.length, 1);
  assert.equal(compiled.items[0]?.content.length, 50_000, "content must survive at full length -- no silent truncation");
});

test("boundary: is NOT an LLM summarizer -- content passes through byte-for-byte unchanged", () => {
  const exactContent = "Line one.\nLine two with \"quotes\" and unicode: café.\n";
  const r = rankedResult({ rank: 1 }, { content: exactContent });
  const compiled = compileContext(input([r]));
  assert.equal(compiled.items[0]?.content, exactContent);
  assert.equal(compiled.items[0]?.wasCompressed, false);
});

test("boundary: is NOT an agent formatter -- output contains no agent-specific keys or values", () => {
  const compiled = compileContext(input([rankedResult({ rank: 1 })]));
  const serialized = JSON.stringify(compiled).toLowerCase();
  for (const forbidden of ["claude", "cursor", "codex", "aider", "anthropic", "openai", "mcp"]) {
    assert.equal(serialized.includes(forbidden), false, `output must not mention '${forbidden}'`);
  }
});

test("boundary: is NOT a retrieval layer -- compileContext is a plain function with no I/O, given only in-memory input", () => {
  // Structural: this test itself never opens a database, never imports storage,
  // and compileContext's signature takes no repository/store argument at all --
  // see package.json (no @brain/storage dependency) for the compile-time guarantee.
  const compiled = compileContext(input([rankedResult({ rank: 1 })]));
  assert.equal(compiled.items.length, 1);
});
