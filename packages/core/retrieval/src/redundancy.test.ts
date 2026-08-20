import { test } from "node:test";
import assert from "node:assert/strict";
import type { RankedResult, SimilarityPair } from "@brain/contracts";
import { buildMemoryRecord } from "@brain/test-fixtures";
import { toRedundancyPairs } from "./redundancy.js";

function ranked(memoryId: string, rank: number): RankedResult {
  return { memoryId, record: buildMemoryRecord({ id: memoryId }), score: 1 / rank, signals: { diversity: null }, rank };
}

test("toRedundancyPairs: orients a so it is always the higher-ranked (lower .rank number) member", () => {
  const higher = ranked("11111111-1111-1111-1111-111111111111", 1);
  const lower = ranked("22222222-2222-2222-2222-222222222222", 2);
  const raw: SimilarityPair[] = [{ a: lower.memoryId, b: higher.memoryId, similarity: 0.9 }];
  const result = toRedundancyPairs([higher, lower], raw);
  assert.deepEqual(result, [{ a: higher.memoryId, b: lower.memoryId, similarity: 0.9 }]);
});

test("toRedundancyPairs: a pair naming a memoryId absent from rankedResults is dropped", () => {
  const higher = ranked("11111111-1111-1111-1111-111111111111", 1);
  const raw: SimilarityPair[] = [{ a: higher.memoryId, b: "99999999-9999-9999-9999-999999999999", similarity: 0.9 }];
  assert.deepEqual(toRedundancyPairs([higher], raw), []);
});

test("toRedundancyPairs: empty input produces empty output", () => {
  assert.deepEqual(toRedundancyPairs([], []), []);
});

test("toRedundancyPairs: output stays sorted (similarity desc, then a, then b)", () => {
  const [r1, r2, r3] = [
    ranked("11111111-1111-1111-1111-111111111111", 1),
    ranked("22222222-2222-2222-2222-222222222222", 2),
    ranked("33333333-3333-3333-3333-333333333333", 3),
  ];
  const raw: SimilarityPair[] = [
    { a: r3.memoryId, b: r1.memoryId, similarity: 0.5 },
    { a: r2.memoryId, b: r3.memoryId, similarity: 0.9 },
  ];
  const result = toRedundancyPairs([r1, r2, r3], raw);
  assert.equal(result.length, 2);
  assert.equal(result[0]?.similarity, 0.9);
  assert.equal(result[0]?.a, r2.memoryId);
});
