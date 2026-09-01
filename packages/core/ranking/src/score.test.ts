import { test } from "node:test";
import assert from "node:assert/strict";
import { computeScore, DEFAULT_RANKING_WEIGHTS } from "./score.js";

test("weighted sum of present signals", () => {
  const score = computeScore({ lexicalScore: 0.8, semanticScore: 0.6 }, { lexical: 0.5, semantic: 0.5, tag: 0 });
  assert.equal(score, 0.5 * 0.8 + 0.5 * 0.6);
});

test("a missing signal contributes 0, not a penalty", () => {
  const withBoth = computeScore({ lexicalScore: 0.8, semanticScore: 0 }, DEFAULT_RANKING_WEIGHTS);
  const lexicalOnly = computeScore({ lexicalScore: 0.8 }, DEFAULT_RANKING_WEIGHTS);
  assert.equal(withBoth, lexicalOnly, "an explicit 0 and an absent signal must score identically");
});

test("all signals missing scores exactly 0", () => {
  assert.equal(computeScore({}, DEFAULT_RANKING_WEIGHTS), 0);
});

test("tagScore participates in the formula even though no Phase 1 retrieval source populates it yet", () => {
  const score = computeScore({ tagScore: 1 }, { lexical: 0, semantic: 0, tag: 0.3 });
  assert.equal(score, 0.3);
});

test("default weights sum to 1", () => {
  const sum = DEFAULT_RANKING_WEIGHTS.lexical + DEFAULT_RANKING_WEIGHTS.semantic + DEFAULT_RANKING_WEIGHTS.tag;
  assert.equal(sum, 1);
});

test("zero weights produce a zero score regardless of signal strength", () => {
  const score = computeScore({ lexicalScore: 1, semanticScore: 1, tagScore: 1 }, { lexical: 0, semantic: 0, tag: 0 });
  assert.equal(score, 0);
});

// Phase 3.2 ranking-compatibility proof (PHASE_3_SPEC.md Part B / RANKING BOUNDARY):
// CodeSearchResult.signals reuses CandidateSignals verbatim (not a copy, not a
// lookalike), so computeScore -- the actual, unmodified scoring function -- must
// run correctly on it with zero special-casing. This test constructs plain
// CandidateSignals-shaped objects directly; it deliberately does not import
// anything from @brain/codebase or @brain/contracts' code-search module, proving
// the compatibility is structural, not a new dependency wired in to make it work.
test("Phase 3.2 proof: computeScore runs unmodified on a CodeSearchResult-shaped signals object", () => {
  const codeSignals = { lexicalScore: 0.9, semanticScore: 0.4 };
  const score = computeScore(codeSignals, DEFAULT_RANKING_WEIGHTS);
  assert.equal(score, DEFAULT_RANKING_WEIGHTS.lexical * 0.9 + DEFAULT_RANKING_WEIGHTS.semantic * 0.4);
});

test("Phase 3.2 proof: ordering by computeScore over code-shaped signals matches ordering by the same manual weighted sum -- no code-specific formula exists", () => {
  const chunks = [
    { chunkId: "strong-lexical", signals: { lexicalScore: 0.95, semanticScore: 0.1 } },
    { chunkId: "strong-semantic", signals: { lexicalScore: 0.1, semanticScore: 0.95 } },
    { chunkId: "weak-both", signals: { lexicalScore: 0.2, semanticScore: 0.2 } },
  ];
  const weights = DEFAULT_RANKING_WEIGHTS;
  const ranked = [...chunks].sort((a, b) => computeScore(b.signals, weights) - computeScore(a.signals, weights));
  const expected = [...chunks].sort(
    (a, b) =>
      weights.lexical * b.signals.lexicalScore + weights.semantic * b.signals.semanticScore -
      (weights.lexical * a.signals.lexicalScore + weights.semantic * a.signals.semanticScore),
  );
  assert.deepEqual(ranked.map((c) => c.chunkId), expected.map((c) => c.chunkId));
});
