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
