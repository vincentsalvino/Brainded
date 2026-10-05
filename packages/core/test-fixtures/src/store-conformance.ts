import { test } from "node:test";
import assert from "node:assert/strict";
import type { Candidate, MemoryRecord, RetrievalStore, ScopeRef } from "@brain/contracts";
import { globalScope, projectScope } from "@brain/contracts";

/**
 * P2-001: ONE behavioural contract for RetrievalStore, run against every
 * implementation.
 *
 * Phase 1 had a fake and a real store that satisfied the same *type* and
 * disagreed on the *semantics of the number*. FakeRetrievalStore scored word
 * overlap (higher = better match); SqliteRetrievalStore scored
 * 1/(1+|bm25_rank|), which is monotonically DECREASING in match quality because
 * FTS5's rank is negative and more-negative means better. Nothing required the
 * two to agree, so an inverted relevance signal shipped inside a fully green
 * 218-test suite (PHASE_2_FINDINGS.md 3.6).
 *
 * A signal's direction and range are behaviour, not implementation detail. Any
 * future signal added to Candidate extends this file, not a per-store test.
 */

export interface ConformanceSeed {
  content: string;
  scope: ScopeRef;
  /** Defaults to "active" -- set "archived" only for the eligibility tests below. */
  status?: MemoryRecord["status"];
}

export interface ConformanceStore {
  store: RetrievalStore;
  cleanup: () => void;
}

export interface ConformanceHarness {
  /** Implementation name, used in test titles so failures name the culprit. */
  name: string;
  /** Build a store containing exactly `seeds`, indexed and queryable. */
  setup(seeds: ConformanceSeed[]): Promise<ConformanceStore>;
  /**
   * Whether semantic search is exercised. A harness whose backing vector index
   * is unavailable (sqlite-vec failed to load) sets this false; the lexical
   * contract still runs, and the skip is reported rather than silently passing.
   */
  semantic?: boolean;
}

// Shaped after the real Phase 1 corpus (PHASE_2_FINDINGS.md 3.2), not invented:
// the query shares "database"/"layer"/"api" with STRONG and only the
// near-universal "api" with WEAK. Under the pre-fix transform WEAK scored
// 0.9999991 and STRONG scored 0.2910.
const STRONG = "notes-api: database access must go through the repository layer, never directly from route handlers";
const WEAK = "REST API resources should use plural nouns in endpoint paths such as widgets and gadgets";
const QUERY = "Refactor the database layer without changing API behavior";

const NEAR_DUPLICATE = "the repository pattern abstracts database access behind an interface";
const UNRELATED = "the weather tomorrow is sunny with a light southerly breeze";

function byContent(candidates: Candidate[], content: string): Candidate | undefined {
  return candidates.find((c) => c.record.content === content);
}

function scoresOf(candidates: Candidate[], key: "lexicalScore" | "semanticScore"): number[] {
  return candidates.map((c) => c.signals[key]).filter((s): s is number => s !== undefined);
}

export function runRetrievalStoreConformance(harness: ConformanceHarness): void {
  const semantic = harness.semantic ?? true;
  const label = (name: string) => `[conformance:${harness.name}] ${name}`;

  test(label("lexical: a strictly better match scores strictly higher"), async () => {
    const { store, cleanup } = await harness.setup([
      { content: STRONG, scope: globalScope() },
      { content: WEAK, scope: globalScope() },
    ]);
    try {
      const candidates = await store.lexicalSearch({ text: QUERY, scope: globalScope(), limit: 10 });
      const strong = byContent(candidates, STRONG);
      const weak = byContent(candidates, WEAK);
      assert.ok(strong, "the strongly-matching record must be returned as a candidate");
      assert.ok(weak, "the weakly-matching record must be returned as a candidate");
      assert.ok(
        (strong.signals.lexicalScore ?? 0) > (weak.signals.lexicalScore ?? 0),
        `lexicalScore must increase with match quality, got strong=${strong.signals.lexicalScore} ` +
          `weak=${weak.signals.lexicalScore}. A lower score for the better match means the signal ` +
          `is direction-inverted (FTS5 rank is negative; more negative = better).`,
      );
    } finally {
      cleanup();
    }
  });

  test(label("lexical: every score is within [0, 1]"), async () => {
    const { store, cleanup } = await harness.setup([
      { content: STRONG, scope: globalScope() },
      { content: WEAK, scope: globalScope() },
      { content: NEAR_DUPLICATE, scope: globalScope() },
    ]);
    try {
      const scores = scoresOf(await store.lexicalSearch({ text: QUERY, scope: globalScope(), limit: 10 }), "lexicalScore");
      assert.ok(scores.length > 0, "expected at least one scored candidate");
      for (const s of scores) {
        assert.ok(Number.isFinite(s), `lexicalScore must be finite, got ${s}`);
        assert.ok(s >= 0 && s <= 1, `lexicalScore must be within [0,1], got ${s}`);
      }
    } finally {
      cleanup();
    }
  });

  test(label("lexical: a single candidate scores 1.0"), async () => {
    const { store, cleanup } = await harness.setup([{ content: STRONG, scope: globalScope() }]);
    try {
      const candidates = await store.lexicalSearch({ text: QUERY, scope: globalScope(), limit: 10 });
      assert.equal(candidates.length, 1, "expected exactly one candidate");
      assert.equal(
        candidates[0]?.signals.lexicalScore,
        1,
        "with nothing to compare against, the only candidate is the best available match and scores 1.0",
      );
    } finally {
      cleanup();
    }
  });

  test(label("lexical: equally-matching candidates all score 1.0"), async () => {
    const { store, cleanup } = await harness.setup([
      { content: STRONG, scope: globalScope() },
      { content: STRONG, scope: projectScope("project-a") },
    ]);
    try {
      const scores = scoresOf(
        await store.lexicalSearch({ text: QUERY, scope: projectScope("project-a"), limit: 10 }),
        "lexicalScore",
      );
      assert.equal(scores.length, 2, "expected both equally-matching candidates");
      for (const s of scores) {
        assert.equal(s, 1, "a degenerate all-equal set scores 1.0 for every member, never 0 and never NaN");
      }
    } finally {
      cleanup();
    }
  });

  test(label("lexical: scope isolation -- another scope's record is never returned"), async () => {
    const { store, cleanup } = await harness.setup([{ content: STRONG, scope: projectScope("project-a") }]);
    try {
      const candidates = await store.lexicalSearch({ text: QUERY, scope: projectScope("project-b"), limit: 10 });
      assert.equal(candidates.length, 0, "a project-b query must never see a project-a record");
    } finally {
      cleanup();
    }
  });

  // Brain Corpus Hygiene V1: candidate generation is where archived-eligibility
  // actually has to hold -- a memory can be scope-eligible and still be excluded
  // because status says it shouldn't surface in normal retrieval.
  test(label("lexical: an archived record is never returned as a candidate"), async () => {
    const { store, cleanup } = await harness.setup([
      { content: STRONG, scope: globalScope(), status: "archived" },
      { content: WEAK, scope: globalScope() },
    ]);
    try {
      const candidates = await store.lexicalSearch({ text: QUERY, scope: globalScope(), limit: 10 });
      assert.equal(byContent(candidates, STRONG), undefined, "an archived record must never be a candidate");
      assert.ok(byContent(candidates, WEAK), "the active record must still be a candidate");
    } finally {
      cleanup();
    }
  });

  if (!semantic) {
    test(label("semantic: SKIPPED -- vector backend unavailable in this harness"), (t) => {
      t.skip("harness reported semantic:false");
    });
    return;
  }

  test(label("semantic: a nearer neighbour scores strictly higher"), async () => {
    const { store, cleanup } = await harness.setup([
      { content: NEAR_DUPLICATE, scope: globalScope() },
      { content: UNRELATED, scope: globalScope() },
    ]);
    try {
      const candidates = await store.semanticSearch({ text: NEAR_DUPLICATE, scope: globalScope(), limit: 10 });
      const near = byContent(candidates, NEAR_DUPLICATE);
      const far = byContent(candidates, UNRELATED);
      assert.ok(near, "the near-duplicate must be returned");
      assert.ok(far, "the unrelated record must be returned");
      assert.ok(
        (near.signals.semanticScore ?? 0) > (far.signals.semanticScore ?? 0),
        `semanticScore must increase with similarity, got near=${near.signals.semanticScore} far=${far.signals.semanticScore}`,
      );
    } finally {
      cleanup();
    }
  });

  test(label("semantic: every score is within [0, 1]"), async () => {
    const { store, cleanup } = await harness.setup([
      { content: NEAR_DUPLICATE, scope: globalScope() },
      { content: UNRELATED, scope: globalScope() },
      { content: STRONG, scope: globalScope() },
    ]);
    try {
      const scores = scoresOf(await store.semanticSearch({ text: QUERY, scope: globalScope(), limit: 10 }), "semanticScore");
      assert.ok(scores.length > 0, "expected at least one scored candidate");
      for (const s of scores) {
        assert.ok(Number.isFinite(s), `semanticScore must be finite, got ${s}`);
        assert.ok(s >= 0 && s <= 1, `semanticScore must be within [0,1], got ${s}`);
      }
    } finally {
      cleanup();
    }
  });

  test(label("semantic: a single candidate scores 1.0"), async () => {
    const { store, cleanup } = await harness.setup([{ content: NEAR_DUPLICATE, scope: globalScope() }]);
    try {
      const candidates = await store.semanticSearch({ text: QUERY, scope: globalScope(), limit: 10 });
      assert.equal(candidates.length, 1, "expected exactly one candidate");
      assert.equal(candidates[0]?.signals.semanticScore, 1, "the only candidate is the nearest available neighbour");
    } finally {
      cleanup();
    }
  });

  test(label("semantic: scope isolation -- another scope's record is never returned"), async () => {
    const { store, cleanup } = await harness.setup([{ content: NEAR_DUPLICATE, scope: projectScope("project-a") }]);
    try {
      const candidates = await store.semanticSearch({ text: NEAR_DUPLICATE, scope: projectScope("project-b"), limit: 10 });
      assert.equal(candidates.length, 0, "a project-b query must never see a project-a record");
    } finally {
      cleanup();
    }
  });

  test(label("semantic: an archived record is never returned as a candidate"), async () => {
    const { store, cleanup } = await harness.setup([
      { content: NEAR_DUPLICATE, scope: globalScope(), status: "archived" },
      { content: UNRELATED, scope: globalScope() },
    ]);
    try {
      const candidates = await store.semanticSearch({ text: NEAR_DUPLICATE, scope: globalScope(), limit: 10 });
      assert.equal(byContent(candidates, NEAR_DUPLICATE), undefined, "an archived record must never be a candidate");
    } finally {
      cleanup();
    }
  });

  async function idOf(store: RetrievalStore, scope: ScopeRef, content: string): Promise<string> {
    const results = await store.lexicalSearch({ text: content, scope, limit: 10 });
    const match = results.find((r) => r.record.content === content);
    if (!match) throw new Error(`conformance fixture setup: could not resolve memoryId for "${content}"`);
    return match.memoryId;
  }

  test(label("findSimilarPairs: a near-duplicate pair scores strictly higher than an unrelated pair"), async () => {
    const { store, cleanup } = await harness.setup([
      { content: STRONG, scope: globalScope() },
      { content: NEAR_DUPLICATE, scope: globalScope() },
      { content: UNRELATED, scope: globalScope() },
    ]);
    try {
      const strongId = await idOf(store, globalScope(), STRONG);
      const nearId = await idOf(store, globalScope(), NEAR_DUPLICATE);
      const unrelatedId = await idOf(store, globalScope(), UNRELATED);
      const pairs = await store.findSimilarPairs([strongId, nearId, unrelatedId], 0);
      const find = (x: string, y: string) => pairs.find((p) => (p.a === x && p.b === y) || (p.a === y && p.b === x));
      const strongNear = find(strongId, nearId);
      const strongUnrelated = find(strongId, unrelatedId);
      assert.ok(strongNear, "the near-duplicate pair must be returned at threshold 0");
      assert.ok(strongUnrelated, "the unrelated pair must be returned at threshold 0");
      assert.ok(
        (strongNear?.similarity ?? -2) > (strongUnrelated?.similarity ?? 2),
        `near-duplicate similarity (${strongNear?.similarity}) must exceed the unrelated pair's (${strongUnrelated?.similarity})`,
      );
    } finally {
      cleanup();
    }
  });

  test(label("findSimilarPairs: every similarity is within [-1, 1]"), async () => {
    const { store, cleanup } = await harness.setup([
      { content: STRONG, scope: globalScope() },
      { content: NEAR_DUPLICATE, scope: globalScope() },
      { content: UNRELATED, scope: globalScope() },
    ]);
    try {
      const ids = await Promise.all([STRONG, NEAR_DUPLICATE, UNRELATED].map((c) => idOf(store, globalScope(), c)));
      const pairs = await store.findSimilarPairs(ids, -1);
      assert.ok(pairs.length > 0);
      for (const p of pairs) {
        assert.ok(Number.isFinite(p.similarity) && p.similarity >= -1 && p.similarity <= 1);
      }
    } finally {
      cleanup();
    }
  });

  test(label("findSimilarPairs: a threshold above every pair's similarity returns nothing"), async () => {
    const { store, cleanup } = await harness.setup([
      { content: STRONG, scope: globalScope() },
      { content: NEAR_DUPLICATE, scope: globalScope() },
    ]);
    try {
      const ids = await Promise.all([STRONG, NEAR_DUPLICATE].map((c) => idOf(store, globalScope(), c)));
      assert.deepEqual(await store.findSimilarPairs(ids, 1.01), []);
    } finally {
      cleanup();
    }
  });

  test(label("findSimilarPairs: fewer than two ids never produces a pair"), async () => {
    const { store, cleanup } = await harness.setup([{ content: STRONG, scope: globalScope() }]);
    try {
      const id = await idOf(store, globalScope(), STRONG);
      assert.deepEqual(await store.findSimilarPairs([id], 0), []);
      assert.deepEqual(await store.findSimilarPairs([], 0), []);
    } finally {
      cleanup();
    }
  });

  test(label("findSimilarPairs: never returns a pair naming an id outside the requested set"), async () => {
    const { store, cleanup } = await harness.setup([
      { content: STRONG, scope: globalScope() },
      { content: NEAR_DUPLICATE, scope: globalScope() },
      { content: UNRELATED, scope: globalScope() },
    ]);
    try {
      const strongId = await idOf(store, globalScope(), STRONG);
      const nearId = await idOf(store, globalScope(), NEAR_DUPLICATE);
      const pairs = await store.findSimilarPairs([strongId, nearId], -1);
      for (const p of pairs) {
        assert.ok([strongId, nearId].includes(p.a) && [strongId, nearId].includes(p.b));
      }
    } finally {
      cleanup();
    }
  });

  test(label("findSimilarPairs: deterministic across repeated calls"), async () => {
    const { store, cleanup } = await harness.setup([
      { content: STRONG, scope: globalScope() },
      { content: NEAR_DUPLICATE, scope: globalScope() },
      { content: UNRELATED, scope: globalScope() },
    ]);
    try {
      const ids = await Promise.all([STRONG, NEAR_DUPLICATE, UNRELATED].map((c) => idOf(store, globalScope(), c)));
      const first = await store.findSimilarPairs(ids, -1);
      const second = await store.findSimilarPairs(ids, -1);
      assert.deepEqual(first, second);
    } finally {
      cleanup();
    }
  });
}
