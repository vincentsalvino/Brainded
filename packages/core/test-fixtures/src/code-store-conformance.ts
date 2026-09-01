import { test } from "node:test";
import assert from "node:assert/strict";
import type { CodeSearchResult, CodeSearchStore, ScopeRef } from "@brain/contracts";
import { globalScope, projectScope } from "@brain/contracts";

/**
 * ONE behavioural contract for CodeSearchStore, run against every implementation --
 * same purpose as store-conformance.ts's runRetrievalStoreConformance (P2-001): a
 * signal's direction and range is behaviour, not an implementation detail, so both
 * FakeCodeSearchStore and SqliteCodeSearchStore must agree with it.
 */

export interface ConformanceCodeSeed {
  relativePath: string;
  content: string;
  scope: ScopeRef;
  repositoryId?: string;
  language?: string | null;
}

export interface ConformanceCodeStore {
  store: CodeSearchStore;
  cleanup: () => void;
}

export interface ConformanceCodeHarness {
  name: string;
  setup(seeds: ConformanceCodeSeed[]): Promise<ConformanceCodeStore>;
  /** As with runRetrievalStoreConformance: false when the backing vector index is unavailable. */
  semantic?: boolean;
}

const STRONG = "database access must go through the repository layer, never directly from route handlers";
const WEAK = "REST API resources should use plural nouns in endpoint paths such as widgets and gadgets";
const QUERY = "refactor the database repository layer api";

const NEAR_DUPLICATE = "the repository pattern abstracts database access behind an interface";
const UNRELATED = "the weather tomorrow is sunny with a light southerly breeze";

function byContent(results: CodeSearchResult[], content: string): CodeSearchResult | undefined {
  return results.find((r) => r.content === content);
}

function scoresOf(results: CodeSearchResult[], key: "lexicalScore" | "semanticScore"): number[] {
  return results.map((r) => r.signals[key]).filter((s): s is number => s !== undefined);
}

export function runCodeSearchStoreConformance(harness: ConformanceCodeHarness): void {
  const semantic = harness.semantic ?? true;
  const label = (name: string) => `[conformance:${harness.name}] ${name}`;

  test(label("lexical: a strictly better match scores strictly higher"), async () => {
    const { store, cleanup } = await harness.setup([
      { relativePath: "src/strong.ts", content: STRONG, scope: globalScope() },
      { relativePath: "src/weak.ts", content: WEAK, scope: globalScope() },
    ]);
    try {
      const results = await store.lexicalSearch({ text: QUERY, scope: globalScope(), limit: 10 });
      const strong = byContent(results, STRONG);
      const weak = byContent(results, WEAK);
      assert.ok(strong, "the strongly-matching chunk must be returned");
      assert.ok(weak, "the weakly-matching chunk must be returned");
      assert.ok(
        (strong.signals.lexicalScore ?? 0) > (weak.signals.lexicalScore ?? 0),
        `lexicalScore must increase with match quality, got strong=${strong.signals.lexicalScore} weak=${weak.signals.lexicalScore}`,
      );
    } finally {
      cleanup();
    }
  });

  test(label("lexical: every score is within [0, 1]"), async () => {
    const { store, cleanup } = await harness.setup([
      { relativePath: "src/strong.ts", content: STRONG, scope: globalScope() },
      { relativePath: "src/weak.ts", content: WEAK, scope: globalScope() },
      { relativePath: "src/near.ts", content: NEAR_DUPLICATE, scope: globalScope() },
    ]);
    try {
      const scores = scoresOf(await store.lexicalSearch({ text: QUERY, scope: globalScope(), limit: 10 }), "lexicalScore");
      assert.ok(scores.length > 0);
      for (const s of scores) {
        assert.ok(Number.isFinite(s) && s >= 0 && s <= 1, `lexicalScore must be within [0,1], got ${s}`);
      }
    } finally {
      cleanup();
    }
  });

  test(label("lexical: a single result scores 1.0"), async () => {
    const { store, cleanup } = await harness.setup([{ relativePath: "src/strong.ts", content: STRONG, scope: globalScope() }]);
    try {
      const results = await store.lexicalSearch({ text: QUERY, scope: globalScope(), limit: 10 });
      assert.equal(results.length, 1);
      assert.equal(results[0]?.signals.lexicalScore, 1, "the only result is the best available match and scores 1.0");
    } finally {
      cleanup();
    }
  });

  test(label("lexical: equally-matching results all score 1.0"), async () => {
    const { store, cleanup } = await harness.setup([
      { relativePath: "src/a/strong.ts", content: STRONG, scope: globalScope() },
      { relativePath: "src/b/strong.ts", content: STRONG, scope: projectScope("project-a") },
    ]);
    try {
      const scores = scoresOf(await store.lexicalSearch({ text: QUERY, scope: projectScope("project-a"), limit: 10 }), "lexicalScore");
      assert.equal(scores.length, 2);
      for (const s of scores) {
        assert.equal(s, 1, "a degenerate all-equal set scores 1.0 for every member, never 0 and never NaN");
      }
    } finally {
      cleanup();
    }
  });

  test(label("lexical: scope isolation -- another scope's chunk is never returned"), async () => {
    const { store, cleanup } = await harness.setup([{ relativePath: "src/a.ts", content: STRONG, scope: projectScope("project-a") }]);
    try {
      const results = await store.lexicalSearch({ text: QUERY, scope: projectScope("project-b"), limit: 10 });
      assert.equal(results.length, 0);
    } finally {
      cleanup();
    }
  });

  test(label("filters: repositoryId narrows to one registered repository"), async () => {
    const { store, cleanup } = await harness.setup([
      { relativePath: "src/a.ts", content: STRONG, scope: globalScope(), repositoryId: "repo-a" },
      { relativePath: "src/a.ts", content: STRONG, scope: globalScope(), repositoryId: "repo-b" },
    ]);
    try {
      const results = await store.lexicalSearch({ text: QUERY, scope: globalScope(), filters: { repositoryId: "repo-a" }, limit: 10 });
      assert.equal(results.length, 1);
      assert.equal(results[0]?.repositoryId, "repo-a");
    } finally {
      cleanup();
    }
  });

  test(label("filters: pathPrefix narrows to chunks under that path"), async () => {
    const { store, cleanup } = await harness.setup([
      { relativePath: "src/services/a.ts", content: STRONG, scope: globalScope() },
      { relativePath: "tests/a.ts", content: STRONG, scope: globalScope() },
    ]);
    try {
      const results = await store.lexicalSearch({ text: QUERY, scope: globalScope(), filters: { pathPrefix: "src/services/" }, limit: 10 });
      assert.equal(results.length, 1);
      assert.equal(results[0]?.relativePath, "src/services/a.ts");
    } finally {
      cleanup();
    }
  });

  test(label("filters: language narrows to one language"), async () => {
    const { store, cleanup } = await harness.setup([
      { relativePath: "src/a.ts", content: STRONG, scope: globalScope(), language: "typescript" },
      { relativePath: "src/a.py", content: STRONG, scope: globalScope(), language: "python" },
    ]);
    try {
      const results = await store.lexicalSearch({ text: QUERY, scope: globalScope(), filters: { language: "python" }, limit: 10 });
      assert.equal(results.length, 1);
      assert.equal(results[0]?.relativePath, "src/a.py");
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
      { relativePath: "src/near.ts", content: NEAR_DUPLICATE, scope: globalScope() },
      { relativePath: "src/far.ts", content: UNRELATED, scope: globalScope() },
    ]);
    try {
      const results = await store.semanticSearch({ text: NEAR_DUPLICATE, scope: globalScope(), limit: 10 });
      const near = byContent(results, NEAR_DUPLICATE);
      const far = byContent(results, UNRELATED);
      assert.ok(near, "the near-duplicate must be returned");
      assert.ok(far, "the unrelated chunk must be returned");
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
      { relativePath: "src/near.ts", content: NEAR_DUPLICATE, scope: globalScope() },
      { relativePath: "src/far.ts", content: UNRELATED, scope: globalScope() },
      { relativePath: "src/strong.ts", content: STRONG, scope: globalScope() },
    ]);
    try {
      const scores = scoresOf(await store.semanticSearch({ text: QUERY, scope: globalScope(), limit: 10 }), "semanticScore");
      assert.ok(scores.length > 0);
      for (const s of scores) {
        assert.ok(Number.isFinite(s) && s >= 0 && s <= 1, `semanticScore must be within [0,1], got ${s}`);
      }
    } finally {
      cleanup();
    }
  });

  test(label("semantic: a single result scores 1.0"), async () => {
    const { store, cleanup } = await harness.setup([{ relativePath: "src/near.ts", content: NEAR_DUPLICATE, scope: globalScope() }]);
    try {
      const results = await store.semanticSearch({ text: QUERY, scope: globalScope(), limit: 10 });
      assert.equal(results.length, 1);
      assert.equal(results[0]?.signals.semanticScore, 1, "the only result is the nearest available neighbour");
    } finally {
      cleanup();
    }
  });

  test(label("semantic: scope isolation -- another scope's chunk is never returned"), async () => {
    const { store, cleanup } = await harness.setup([{ relativePath: "src/near.ts", content: NEAR_DUPLICATE, scope: projectScope("project-a") }]);
    try {
      const results = await store.semanticSearch({ text: NEAR_DUPLICATE, scope: projectScope("project-b"), limit: 10 });
      assert.equal(results.length, 0);
    } finally {
      cleanup();
    }
  });
}
