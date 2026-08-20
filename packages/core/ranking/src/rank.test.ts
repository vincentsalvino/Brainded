import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { globalScope, type Candidate } from "@brain/contracts";
import { buildMemoryRecord } from "@brain/test-fixtures";
import { rank } from "./rank.js";

function candidate(overrides: Partial<Candidate> & { signals: Candidate["signals"] }, confidence = 0.5): Candidate {
  const memoryId = overrides.memoryId ?? randomUUID();
  return {
    memoryId,
    record: buildMemoryRecord({ id: memoryId, scope: globalScope(), confidence }),
    signals: overrides.signals,
  };
}

test("ranks multiple candidates by score, highest first", () => {
  const high = candidate({ signals: { lexicalScore: 0.9 } });
  const low = candidate({ signals: { lexicalScore: 0.1 } });
  const result = rank({ candidates: [low, high] });
  assert.equal(result[0]?.memoryId, high.memoryId);
  assert.equal(result[1]?.memoryId, low.memoryId);
});

test("lexical-only signal drives ranking when semantic is absent", () => {
  const a = candidate({ signals: { lexicalScore: 0.9 } });
  const b = candidate({ signals: { lexicalScore: 0.2 } });
  const result = rank({ candidates: [b, a] });
  assert.equal(result[0]?.memoryId, a.memoryId);
});

test("semantic-only signal drives ranking when lexical is absent", () => {
  const a = candidate({ signals: { semanticScore: 0.9 } });
  const b = candidate({ signals: { semanticScore: 0.2 } });
  const result = rank({ candidates: [b, a] });
  assert.equal(result[0]?.memoryId, a.memoryId);
});

test("ranking score matches the documented weighted-sum formula", () => {
  const a = candidate({ signals: { lexicalScore: 0.8, semanticScore: 0.4 } });
  const result = rank({ candidates: [a], weights: { lexical: 0.5, semantic: 0.5, tag: 0 } });
  assert.equal(result[0]?.score, 0.5 * 0.8 + 0.5 * 0.4);
});

test("deterministic: identical input produces identical output across repeated calls", () => {
  const candidates = [
    candidate({ signals: { lexicalScore: 0.5 } }),
    candidate({ signals: { lexicalScore: 0.5 } }),
    candidate({ signals: { semanticScore: 0.7 } }),
  ];
  const first = rank({ candidates });
  const second = rank({ candidates });
  assert.deepEqual(
    first.map((r) => r.memoryId),
    second.map((r) => r.memoryId),
  );
});

test("tie-break 1: equal score, higher confidence wins", () => {
  const lowConfidence = candidate({ signals: { lexicalScore: 0.5 } }, 0.3);
  const highConfidence = candidate({ signals: { lexicalScore: 0.5 } }, 0.9);
  const result = rank({ candidates: [lowConfidence, highConfidence] });
  assert.equal(result[0]?.memoryId, highConfidence.memoryId);
});

test("tie-break 2: equal score AND equal confidence falls back to memoryId, deterministically", () => {
  const idA = "aaaaaaaa-0000-0000-0000-000000000000";
  const idB = "bbbbbbbb-0000-0000-0000-000000000000";
  const a = candidate({ memoryId: idA, signals: { lexicalScore: 0.5 } }, 0.5);
  const b = candidate({ memoryId: idB, signals: { lexicalScore: 0.5 } }, 0.5);
  const result = rank({ candidates: [b, a] });
  assert.equal(result[0]?.memoryId, idA, "lexicographically smaller id sorts first");
});

test("empty candidate pool ranks to an empty array", () => {
  assert.deepEqual(rank({ candidates: [] }), []);
});

test("a single candidate gets rank 1", () => {
  const result = rank({ candidates: [candidate({ signals: { lexicalScore: 0.5 } })] });
  assert.equal(result[0]?.rank, 1);
});

test("multiple equal-score candidates each still get a distinct, sequential rank", () => {
  const candidates = [
    candidate({ signals: { lexicalScore: 0.5 } }, 0.5),
    candidate({ signals: { lexicalScore: 0.5 } }, 0.5),
    candidate({ signals: { lexicalScore: 0.5 } }, 0.5),
  ];
  const result = rank({ candidates });
  assert.deepEqual(result.map((r) => r.rank), [1, 2, 3]);
});

test("missing optional signals: a candidate with no signals at all still ranks (score 0), not dropped", () => {
  const result = rank({ candidates: [candidate({ signals: {} })] });
  assert.equal(result.length, 1);
  assert.equal(result[0]?.score, 0);
});

test("preserves candidate identity: memoryId on the RankedResult matches the input Candidate", () => {
  const c = candidate({ signals: { lexicalScore: 0.5 } });
  const result = rank({ candidates: [c] });
  assert.equal(result[0]?.memoryId, c.memoryId);
});

test("preserves provenance: record.source survives ranking untouched", () => {
  const c = candidate({ signals: { lexicalScore: 0.5 } });
  const withProvenance: Candidate = { ...c, record: { ...c.record, source: { origin: "import", sourceRef: "aeos-seed:x" } } };
  const result = rank({ candidates: [withProvenance] });
  assert.equal(result[0]?.record.source.origin, "import");
  assert.equal(result[0]?.record.source.sourceRef, "aeos-seed:x");
});

test("confidence is passed through on the record, untouched by ranking, and is not part of the score", () => {
  const c = candidate({ signals: { lexicalScore: 0.5 } }, 0.77);
  const result = rank({ candidates: [c] });
  assert.equal(result[0]?.record.confidence, 0.77);
  assert.equal(result[0]?.score, 0.5 * 0.5, "confidence must not appear in the computed score");
});

test("diversity is always null on output -- reserved, not fabricated", () => {
  const result = rank({ candidates: [candidate({ signals: { lexicalScore: 0.5 } })] });
  assert.equal(result[0]?.signals.diversity, null);
});

test("does not mutate the input Candidate objects (frozen input would throw on any write attempt)", () => {
  const c = candidate({ signals: { lexicalScore: 0.5 } });
  Object.freeze(c);
  Object.freeze(c.signals);
  Object.freeze(c.record);
  assert.doesNotThrow(() => rank({ candidates: [c] }));
});

// Adversarial regression guard (Step 11's example): Candidate must never carry a
// pre-computed `.score` -- that would mean P1-008's candidate-generation/merge
// layer started fusing scores, which is exactly the boundary this whole task
// exists to protect. If this ever fails, the violation is in retrieval/merge, not
// here -- but ranking is where a leaked score would first become dangerous
// (silently trusted instead of recomputed), so the guard lives here too.
test("architectural guard: Candidate objects never carry a pre-computed 'score' field", () => {
  const c = candidate({ signals: { lexicalScore: 0.5, semanticScore: 0.5 } });
  assert.equal("score" in c, false, "candidate generation (P1-008) must not compute a fused score");
  assert.equal("score" in c.signals, false);
});
