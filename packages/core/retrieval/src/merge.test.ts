import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { globalScope, type Candidate } from "@brain/contracts";
import { buildMemoryRecord } from "@brain/test-fixtures";
import { mergeCandidates } from "./merge.js";

function candidate(memoryId: string, signals: Candidate["signals"]): Candidate {
  return { memoryId, record: buildMemoryRecord({ id: memoryId, scope: globalScope() }), signals };
}

test("a memoryId present in only one source appears once, signals untouched", () => {
  const id = randomUUID();
  const merged = mergeCandidates([candidate(id, { lexicalScore: 0.8 })], []);
  assert.equal(merged.length, 1);
  assert.equal(merged[0]?.signals.lexicalScore, 0.8);
  assert.equal(merged[0]?.signals.semanticScore, undefined);
});

test("a memoryId present in both sources merges into ONE candidate with both signals -- not a combined score", () => {
  const id = randomUUID();
  const merged = mergeCandidates([candidate(id, { lexicalScore: 0.8 })], [candidate(id, { semanticScore: 0.6 })]);
  assert.equal(merged.length, 1, "identity-merged, not duplicated");
  assert.equal(merged[0]?.signals.lexicalScore, 0.8);
  assert.equal(merged[0]?.signals.semanticScore, 0.6);
  // No fused "score" field anywhere on Candidate/CandidateSignals -- ranking (P1-009)
  // computes that. This assertion exists specifically to catch that regression.
  assert.equal(Object.keys(merged[0]?.signals ?? {}).sort().join(","), "lexicalScore,semanticScore");
});

test("disjoint sources: result size is the union, up to lexical.length + semantic.length", () => {
  const [a, b, c] = [randomUUID(), randomUUID(), randomUUID()];
  const merged = mergeCandidates([candidate(a, { lexicalScore: 0.5 }), candidate(b, { lexicalScore: 0.4 })], [
    candidate(c, { semanticScore: 0.3 }),
  ]);
  assert.equal(merged.length, 3);
});

test("empty inputs produce an empty pool", () => {
  assert.deepEqual(mergeCandidates([], []), []);
});
