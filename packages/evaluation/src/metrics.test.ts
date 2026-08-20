import { test } from "node:test";
import assert from "node:assert/strict";
import {
  dcgAtK,
  idealDcgAtK,
  mean,
  ndcgAtK,
  precisionAtK,
  recallAtK,
  reciprocalRank,
  relevantCount,
  type Labels,
} from "./metrics.js";
import { parseDataset } from "./dataset.js";

// Every expected value below is computed by hand in the comment above it. A
// metric that agrees with its own implementation proves nothing; these agree with
// arithmetic done independently of the code.
const LABELS: Labels = { a: 2, b: 1, c: 0 };

test("relevantCount: grades 1 and 2 count, grade 0 does not", () => {
  assert.equal(relevantCount(LABELS), 2);
});

test("precision@K: hand-verified", () => {
  // ranked = [c, a, b]; relevant = {a, b}
  // P@1 = 0 relevant in [c] / 1 = 0
  // P@2 = 1 relevant in [c,a] / 2 = 0.5
  // P@3 = 2 relevant in [c,a,b] / 3 = 0.6667
  const ranked = ["c", "a", "b"];
  assert.equal(precisionAtK(ranked, LABELS, 1), 0);
  assert.equal(precisionAtK(ranked, LABELS, 2), 0.5);
  assert.ok(Math.abs(precisionAtK(ranked, LABELS, 3) - 2 / 3) < 1e-12);
});

test("recall@K: hand-verified", () => {
  // total relevant = 2
  // R@1 = 0/2 = 0 ; R@2 = 1/2 = 0.5 ; R@3 = 2/2 = 1
  const ranked = ["c", "a", "b"];
  assert.equal(recallAtK(ranked, LABELS, 1), 0);
  assert.equal(recallAtK(ranked, LABELS, 2), 0.5);
  assert.equal(recallAtK(ranked, LABELS, 3), 1);
});

test("recall@K: no relevant items yields 0 rather than NaN", () => {
  assert.equal(recallAtK(["x"], { x: 0 }, 5), 0);
});

test("reciprocal rank: hand-verified", () => {
  assert.equal(reciprocalRank(["a", "b", "c"], LABELS), 1); // a is relevant at position 1
  assert.equal(reciprocalRank(["c", "a", "b"], LABELS), 0.5); // first relevant at position 2
  assert.equal(reciprocalRank(["c"], LABELS), 0); // none relevant
});

test("DCG@K: hand-verified with gain 2^grade-1 and discount log2(i+2)", () => {
  // ranked [a,b,c] with grades 2,1,0
  //   pos1: (2^2-1)/log2(2) = 3/1     = 3
  //   pos2: (2^1-1)/log2(3) = 1/1.585 = 0.63093
  //   pos3: (2^0-1)/log2(4) = 0/2     = 0
  //   total                           = 3.63093
  assert.ok(Math.abs(dcgAtK(["a", "b", "c"], LABELS, 3) - (3 + 1 / Math.log2(3))) < 1e-12);

  // reversed [c,b,a]:
  //   pos1: 0/1 = 0 ; pos2: 1/log2(3) = 0.63093 ; pos3: 3/2 = 1.5  => 2.13093
  assert.ok(Math.abs(dcgAtK(["c", "b", "a"], LABELS, 3) - (1 / Math.log2(3) + 1.5)) < 1e-12);
});

test("ideal DCG@K: grades sorted descending regardless of the ranking", () => {
  assert.ok(Math.abs(idealDcgAtK(LABELS, 3) - (3 + 1 / Math.log2(3))) < 1e-12);
});

test("NDCG@K: a perfect ordering scores exactly 1.0", () => {
  assert.equal(ndcgAtK(["a", "b", "c"], LABELS, 3), 1);
});

test("NDCG@K: hand-verified for a wrong ordering", () => {
  // DCG 2.13093 / IDCG 3.63093 = 0.58687
  const expected = (1 / Math.log2(3) + 1.5) / (3 + 1 / Math.log2(3));
  assert.ok(Math.abs(ndcgAtK(["c", "b", "a"], LABELS, 3) - expected) < 1e-12);
  assert.ok(Math.abs(expected - 0.586874) < 1e-5, `sanity: expected ~0.5869, got ${expected}`);
});

test("NDCG@1 distinguishes a grade-2 top hit from a grade-1 top hit -- the Finding B question", () => {
  // This is precisely why labels are graded rather than boolean: under binary
  // relevance both orderings below score NDCG@1 = 1.0 and the metric is blind to
  // the failure the whole phase is about.
  assert.equal(ndcgAtK(["a"], LABELS, 1), 1);
  assert.ok(ndcgAtK(["b"], LABELS, 1) < 1);
  assert.ok(Math.abs(ndcgAtK(["b"], LABELS, 1) - 1 / 3) < 1e-12);
});

test("NDCG@K: nothing relevant yields 0, never NaN", () => {
  assert.equal(ndcgAtK(["x"], { x: 0 }, 3), 0);
});

test("mean: empty input yields 0, never NaN", () => {
  assert.equal(mean([]), 0);
  assert.equal(mean([1, 2, 3]), 2);
});

// --- dataset loader ---------------------------------------------------------

const VALID = JSON.stringify({
  id: "x",
  task: "do a thing",
  scope: { kind: "global", id: null },
  memories: [{ key: "m1", type: "rule", content: "some rule", scope: { kind: "global", id: null } }],
  labels: { m1: 2 },
});

test("dataset: a valid line parses and applies defaults", () => {
  const [example] = parseDataset(VALID);
  assert.equal(example?.id, "x");
  assert.equal(example?.memories[0]?.confidence, 0.5);
  assert.deepEqual(example?.redundantWith, {});
});

test("dataset: blank lines and // comments are skipped", () => {
  assert.equal(parseDataset(`\n// a comment\n${VALID}\n\n`).length, 1);
});

test("dataset: malformed JSON is rejected loudly with a line number", () => {
  assert.throws(() => parseDataset("{not json"), /:1: not valid JSON/);
});

test("dataset: an unrecognized field is rejected, not silently dropped", () => {
  const bad = JSON.stringify({ ...JSON.parse(VALID), surpriseField: 1 });
  assert.throws(() => parseDataset(bad), /invalid example/);
});

test("dataset: a label naming an undeclared memory is rejected", () => {
  const bad = JSON.stringify({ ...JSON.parse(VALID), labels: { ghost: 2 } });
  assert.throws(() => parseDataset(bad), /label references unknown memory/);
});

test("dataset: a dangling redundancy edge is rejected", () => {
  const bad = JSON.stringify({ ...JSON.parse(VALID), redundantWith: { m1: "ghost" } });
  assert.throws(() => parseDataset(bad), /redundantWith targets unknown memory/);
});

test("dataset: duplicate example ids are rejected", () => {
  assert.throws(() => parseDataset(`${VALID}\n${VALID}`), /duplicate example id/);
});
