import { test } from "node:test";
import assert from "node:assert/strict";
import type { RankedResult, ScopeRef, SimilarityPair } from "@brain/contracts";
import { globalScope, projectScope } from "@brain/contracts";
import { buildMemoryRecord } from "@brain/test-fixtures";
import { toRedundancyPairs } from "./redundancy.js";

function ranked(memoryId: string, rank: number, scope: ScopeRef = globalScope()): RankedResult {
  return { memoryId, record: buildMemoryRecord({ id: memoryId, scope }), score: 1 / rank, signals: { diversity: null }, rank };
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

// --- 2C.1: redundancy-anchor scope preference. Rank-only orientation let a
// higher-ranked global memory demote a lower-ranked project-specific memory
// it is redundant with -- observed for real in the Phase 2C pilot
// (docs/archive/phase-2c/PHASE_2C_PILOT_REPORT.md). These fix that, without touching rank
// itself (asserted directly below) or retrieval/ranking/token behavior.

test("toRedundancyPairs: project vs global redundant pair -- global ranks higher, project still becomes the anchor", () => {
  const globalMem = ranked("11111111-1111-1111-1111-111111111111", 1, globalScope());
  const projectMem = ranked("22222222-2222-2222-2222-222222222222", 3, projectScope("phase2c-pilot"));
  const raw: SimilarityPair[] = [{ a: globalMem.memoryId, b: projectMem.memoryId, similarity: 0.8 }];

  const result = toRedundancyPairs([globalMem, projectMem], raw);

  assert.deepEqual(result, [{ a: projectMem.memoryId, b: globalMem.memoryId, similarity: 0.8 }]);
  // Redundancy-cluster policy, not a ranking change: the RankedResult inputs'
  // own rank numbers must stay exactly as given.
  assert.equal(globalMem.rank, 1);
  assert.equal(projectMem.rank, 3);
});

test("toRedundancyPairs: project vs global redundant pair -- project already ranks higher, project remains anchor", () => {
  const projectMem = ranked("11111111-1111-1111-1111-111111111111", 1, projectScope("phase2c-pilot"));
  const globalMem = ranked("22222222-2222-2222-2222-222222222222", 2, globalScope());
  const raw: SimilarityPair[] = [{ a: globalMem.memoryId, b: projectMem.memoryId, similarity: 0.8 }];

  const result = toRedundancyPairs([projectMem, globalMem], raw);

  assert.deepEqual(result, [{ a: projectMem.memoryId, b: globalMem.memoryId, similarity: 0.8 }]);
});

test("toRedundancyPairs: global vs global -- same scope specificity, normal rank decides", () => {
  const higher = ranked("11111111-1111-1111-1111-111111111111", 1, globalScope());
  const lower = ranked("22222222-2222-2222-2222-222222222222", 2, globalScope());
  const raw: SimilarityPair[] = [{ a: lower.memoryId, b: higher.memoryId, similarity: 0.9 }];

  const result = toRedundancyPairs([higher, lower], raw);

  assert.deepEqual(result, [{ a: higher.memoryId, b: lower.memoryId, similarity: 0.9 }]);
});

test("toRedundancyPairs: project vs project -- same scope specificity, normal rank decides", () => {
  const higher = ranked("11111111-1111-1111-1111-111111111111", 1, projectScope("phase2c-pilot"));
  const lower = ranked("22222222-2222-2222-2222-222222222222", 2, projectScope("phase2c-pilot"));
  const raw: SimilarityPair[] = [{ a: lower.memoryId, b: higher.memoryId, similarity: 0.9 }];

  const result = toRedundancyPairs([higher, lower], raw);

  assert.deepEqual(result, [{ a: higher.memoryId, b: lower.memoryId, similarity: 0.9 }]);
});
