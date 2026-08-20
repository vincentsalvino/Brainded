# Phase 2C: Efficiency Measurement + Redundancy Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add token/context efficiency measurement and redundancy-aware context selection to the Brain, without touching ranking behavior or implementing any form of historical-usefulness learning.

**Architecture:** A new `RetrievalStore.findSimilarPairs()` primitive keeps raw embedding vectors inside `packages/storage` and returns only `{a, b, similarity}` triples (resolves E25). `packages/core/retrieval` re-orients those pairs by rank into `redundancyPairs`, which the still-pure `packages/core/context` compiler consumes to demote (never delete) redundant items behind non-redundant ones. `packages/evaluation` gains a pure efficiency-metrics module and an `exportFromEvents` function that turns real correlated events into replayable examples, then a gate test compares strategy A′ (current, Phase 2A/2B) against C′ (A′ + redundancy) over both ranking and efficiency metrics.

**Tech Stack:** TypeScript (strict, `NodeNext`, `exactOptionalPropertyTypes`), Zod schemas, better-sqlite3 + sqlite-vec (`vec_distance_cosine`), Node's built-in test runner (`node --test`), npm workspaces.

**Spec:** `docs/PHASE_2C_SPEC.md` (also read `docs/PHASE_2_SPEC.md`, `docs/PHASE_2_DECISIONS.md`, and `docs/PHASE_2_FINDINGS.md` for the historical grounding the spec assumes).

## Global Constraints

- Do NOT implement `UsefulnessStore`, `memory_usefulness_stats`, `historicalUsefulness`, `usefulnessSampleCount`, `RankingWeights.usefulness`, `LearningSignalService`, adaptive ranking, UCB, memory consolidation, or automatic capture. P2-010/011/012 stay on hold.
- Redundancy is a context-**selection** concern only: no memory deletion, archive, merge, rewrite, or confidence change, ever.
- Similarity comparison operates only on already scope-authorized candidates. `findSimilarPairs` takes no `ScopeRef` and must never be able to return anything beyond the exact id set it was given.
- `core/ranking`, `core/context`, `core/compression`, `core/token` stay pure: no I/O, no storage import, no embeddings. `core/token` (`optimize.ts`) is not touched anywhere in this plan.
- Default configuration requires zero network calls. Anything needing the real embedding model (`@huggingface/transformers`) goes in an integration-only test (`test:integration`), never the default `test` script.
- Threshold values (redundancy τ) are configurable parameters with a documented default, never hardcoded at a call site, never presented as statistically optimal.
- `.strict()` on every Zod object schema; new fields are additive and optional; omitting every new optional field must reproduce exactly the current (Phase 2B) behavior and output shape.
- `exactOptionalPropertyTypes` is on: never assign a key the literal value `undefined`. Use conditional spread (`...(x !== null ? { key: x } : {})`) to omit an optional key, matching the pattern already used throughout `packages/storage`.
- Baseline verified at plan time: `npm run build`, `npm run typecheck`, `npm test` (292/292), `npm audit` (0 vulnerabilities) all pass. Every task below ends with these still green (module test counts will grow).
- `packages/evaluation`'s production `dependencies` stay exactly `["@brain/contracts", "zod"]` (test-only devDependencies may grow); no production package may import `@brain/evaluation`.

## File Structure

```
packages/core/contracts/src/
  signals.ts          MODIFY  + SimilarityPairSchema/SimilarityPair, sortSimilarityPairs
  repositories.ts      MODIFY  + RetrievalStore.findSimilarPairs
  context.ts            MODIFY  + CompileContextInput.redundancyPairs, ContextItem.redundantWith
  shapes.test.ts        MODIFY  + schema tests for the three additions above

packages/core/test-fixtures/src/
  store-conformance.ts  MODIFY  + shared findSimilarPairs conformance tests
  fake-retrieval-store.ts MODIFY + FakeRetrievalStore.findSimilarPairs (Jaccard word-overlap)

packages/storage/src/
  retrieval-store.ts    MODIFY  + SqliteRetrievalStore.findSimilarPairs (vec_distance_cosine self-join)
  retrieval-store.test.ts MODIFY + degradation test
  local-embedding-provider.test.ts MODIFY + real-model redundancy-detection integration test

packages/core/retrieval/src/
  redundancy.ts          CREATE  pure re-orientation: SimilarityPair[] + RankedResult[] -> redundancyPairs
  redundancy.test.ts      CREATE
  service.ts               MODIFY  + RetrievalService.getRedundancyPairs()
  service.test.ts           MODIFY  + coverage for the new method

packages/core/context/src/
  compiler.ts             MODIFY  + redundancy demotion
  compiler.test.ts          MODIFY  + demotion/purity tests

packages/gateway/src/
  gateway.ts               MODIFY  + redundancy config, wiring, degradation
  gateway.test.ts            MODIFY  + wiring/degradation/regression tests
  types.ts                    (no change)

packages/mcp/src/
  bootstrap.ts             MODIFY  + explicit (disabled-by-default) redundancy config

packages/evaluation/
  package.json              MODIFY  + @brain/context, @brain/token devDependencies
  src/efficiency.ts          CREATE  pure computeEfficiencyMetrics
  src/efficiency.test.ts      CREATE
  src/types.ts                 MODIFY  + EvalExample.outcome
  src/export.ts                 CREATE  exportFromEvents
  src/export.test.ts             CREATE
  src/redundancy-gate.test.ts     CREATE  threshold sweep, A' vs C' comparison, all regressions

docs/
  PHASE_2C_SPEC.md          (already created)
  PHASE_2C_FINDINGS.md       CREATE  (Task 9) stopword audit + real-data report + final report
```

---

### Task 1: E25 — `SimilarityPair` contract + `findSimilarPairs` on both `RetrievalStore` implementations

**Files:**
- Modify: `packages/core/contracts/src/signals.ts`
- Modify: `packages/core/contracts/src/repositories.ts`
- Modify: `packages/core/contracts/src/shapes.test.ts`
- Modify: `packages/core/test-fixtures/src/store-conformance.ts`
- Modify: `packages/core/test-fixtures/src/fake-retrieval-store.ts`
- Modify: `packages/storage/src/retrieval-store.ts`
- Modify: `packages/storage/src/retrieval-store.test.ts`

**Interfaces:**
- Produces: `SimilarityPair = { a: string; b: string; similarity: number }` (contracts, exported from `signals.ts` and re-exported via `index.ts`'s existing `export * from "./signals.js"`). `sortSimilarityPairs(pairs: SimilarityPair[]): SimilarityPair[]` (pure, deterministic: similarity desc, then `a` asc, then `b` asc). `RetrievalStore.findSimilarPairs(memoryIds: string[], minSimilarity: number): Promise<SimilarityPair[]>`.
- Consumes: nothing new (contracts is the leaf).

This task changes an interface every `RetrievalStore` implementer must satisfy, so contract + both implementations land together — an intermediate commit with only one implementation would not build. TDD here means "add the failing/non-compiling conformance test first," then make it compile and pass.

- [ ] **Step 1: Add `SimilarityPair` and `sortSimilarityPairs` to contracts**

`packages/core/contracts/src/signals.ts` — append:

```ts
export const SimilarityPairSchema = z
  .object({
    a: z.string().uuid(),
    b: z.string().uuid(),
    similarity: z.number().min(-1).max(1),
  })
  .strict();
export type SimilarityPair = z.infer<typeof SimilarityPairSchema>;

/**
 * Deterministic ordering for SimilarityPair[] (E25 requirement): similarity
 * descending, then `a` ascending, then `b` ascending. Both RetrievalStore
 * implementations must produce output in this order so a caller never has to
 * re-sort, and so tests can assert exact array equality.
 */
export function sortSimilarityPairs(pairs: SimilarityPair[]): SimilarityPair[] {
  return [...pairs].sort((x, y) => {
    if (y.similarity !== x.similarity) return y.similarity - x.similarity;
    if (x.a !== y.a) return x.a < y.a ? -1 : 1;
    if (x.b !== y.b) return x.b < y.b ? -1 : 1;
    return 0;
  });
}
```

This requires adding `import { z } from "zod";` at the top of `signals.ts` (it currently has no imports at all — `normalizeScores` needs none).

- [ ] **Step 2: Add `findSimilarPairs` to the `RetrievalStore` interface**

`packages/core/contracts/src/repositories.ts` — modify:

```ts
import type { RetrievalQuery, Candidate } from "./retrieval.js";
import type { SimilarityPair } from "./signals.js";
// ...
export interface RetrievalStore {
  lexicalSearch(query: RetrievalQuery): Promise<Candidate[]>;
  semanticSearch(query: RetrievalQuery): Promise<Candidate[]>;
  /**
   * E25: pairwise similarity over an ALREADY scope-authorized set of memory
   * ids. Never returns a pair naming an id outside `memoryIds` -- this
   * function must not be able to widen scope, because it never receives one.
   * Vectors unavailable -> empty array, never a thrown error.
   */
  findSimilarPairs(memoryIds: string[], minSimilarity: number): Promise<SimilarityPair[]>;
}
```

At this point `npm run build` fails for `packages/storage` and `packages/core/test-fixtures` (their classes no longer satisfy `RetrievalStore`). That failure is expected and resolved by Steps 3-4.

- [ ] **Step 3: Implement `SqliteRetrievalStore.findSimilarPairs`**

Verified empirically (spike, not guessed): `sqlite-vec`'s `vec_distance_cosine(a, b)` scalar function works directly in a self-join over the `memory_vectors` table's stored (packed) column, with no manual byte/blob handling needed, and returns **cosine distance** (`1 - cosine_similarity`) — confirmed via `vec_distance_cosine([1,0,0,0],[0,1,0,0]) = 1.0` for orthogonal vectors.

`packages/storage/src/retrieval-store.ts` — add import and method:

```ts
import {
  type RetrievalStore,
  type RetrievalQuery,
  type Candidate,
  type MemoryRecord,
  type ScopeRef,
  type EmbeddingProvider,
  type SimilarityPair,
  RetrievalQuerySchema,
  normalizeScores,
  sortSimilarityPairs,
} from "@brain/contracts";
```

Add as a method on `SqliteRetrievalStore`, after `semanticSearch`:

```ts
  /**
   * E25. Vectors never leave this method: the query computes cosine distance
   * natively in SQLite via sqlite-vec and only scalar {a,b,similarity} triples
   * cross back into JS. `memory_vectors` has no row for a memory whose
   * embedding failed to index (see memory-repository.ts's indexVector) -- the
   * inner join simply excludes it, which is the correct degradation (no
   * similarity data means no pair, not an error).
   */
  async findSimilarPairs(memoryIds: string[], minSimilarity: number): Promise<SimilarityPair[]> {
    const uniqueIds = [...new Set(memoryIds)];
    if (!this.vectorSearchAvailable || uniqueIds.length < 2) return [];

    const placeholders = uniqueIds.map(() => "?").join(",");
    let rows: { a: string; b: string; distance: number }[];
    try {
      rows = this.db
        .prepare(
          `SELECT x.memory_id AS a, y.memory_id AS b, vec_distance_cosine(x.embedding, y.embedding) AS distance
           FROM memory_vectors x
           JOIN memory_vectors y ON x.memory_id < y.memory_id
           WHERE x.memory_id IN (${placeholders}) AND y.memory_id IN (${placeholders})`,
        )
        .all(...uniqueIds, ...uniqueIds) as { a: string; b: string; distance: number }[];
    } catch (error) {
      console.warn("findSimilarPairs: vector query failed, returning no pairs:", error);
      return [];
    }

    const pairs: SimilarityPair[] = rows
      .map((r) => ({ a: r.a, b: r.b, similarity: 1 - r.distance }))
      .filter((p) => p.similarity >= minSimilarity);
    return sortSimilarityPairs(pairs);
  }
```

- [ ] **Step 4: Implement `FakeRetrievalStore.findSimilarPairs`**

The fake has no embeddings concept at all (its `semanticSearch` already uses word-overlap instead of vectors). Give it a self-contained Jaccard word-overlap similarity for the same reason — this is fixture-quality behavior, not a stand-in for real cosine similarity, matching the class's existing documented philosophy.

`packages/core/test-fixtures/src/fake-retrieval-store.ts` — add import and method:

```ts
import type { RetrievalStore, RetrievalQuery, Candidate, MemoryRecord, SimilarityPair } from "@brain/contracts";
import { scopeIncludes, normalizeScores, sortSimilarityPairs } from "@brain/contracts";

function jaccardSimilarity(a: string, b: string): number {
  const wordsA = new Set(termsOf(a));
  const wordsB = new Set(termsOf(b));
  const intersection = [...wordsA].filter((w) => wordsB.has(w)).length;
  const union = new Set([...wordsA, ...wordsB]).size;
  return union === 0 ? 0 : intersection / union;
}
```

Add as a method on `FakeRetrievalStore`, after `semanticSearch`:

```ts
  async findSimilarPairs(memoryIds: string[], minSimilarity: number): Promise<SimilarityPair[]> {
    const uniqueIds = [...new Set(memoryIds)];
    const records = uniqueIds
      .map((id) => this.records.find((r) => r.id === id))
      .filter((r): r is MemoryRecord => r !== undefined);

    const pairs: SimilarityPair[] = [];
    for (let i = 0; i < records.length; i++) {
      for (let j = i + 1; j < records.length; j++) {
        const a = records[i] as MemoryRecord;
        const b = records[j] as MemoryRecord;
        const similarity = jaccardSimilarity(a.content, b.content);
        if (similarity >= minSimilarity) pairs.push({ a: a.id, b: b.id, similarity });
      }
    }
    return sortSimilarityPairs(pairs);
  }
```

- [ ] **Step 5: Run build to confirm both implementations satisfy the interface again**

Run: `npm run build`
Expected: PASS across all workspaces (this is the "does it compile" half of TDD red/green for an interface change).

- [ ] **Step 6: Add schema tests for `SimilarityPair`**

`packages/core/contracts/src/shapes.test.ts` — add (near the other `Candidate`/`RankedResult` tests):

```ts
test("SimilarityPair: accepts a valid pair and rejects unrecognized fields", () => {
  const a = randomUUID();
  const b = randomUUID();
  const valid = SimilarityPairSchema.parse({ a, b, similarity: 0.75 });
  assert.equal(valid.similarity, 0.75);
  assert.throws(() => SimilarityPairSchema.parse({ a, b, similarity: 0.75, extra: 1 }));
});

test("SimilarityPair: similarity must be within [-1, 1]", () => {
  const a = randomUUID();
  const b = randomUUID();
  assert.throws(() => SimilarityPairSchema.parse({ a, b, similarity: 1.5 }));
  assert.throws(() => SimilarityPairSchema.parse({ a, b, similarity: -1.5 }));
});

test("sortSimilarityPairs: orders by similarity descending, then a, then b ascending", () => {
  const [x, y, z] = [randomUUID(), randomUUID(), randomUUID()].sort();
  const input: SimilarityPair[] = [
    { a: y as string, b: z as string, similarity: 0.5 },
    { a: x as string, b: y as string, similarity: 0.9 },
    { a: x as string, b: z as string, similarity: 0.9 },
  ];
  const sorted = sortSimilarityPairs(input);
  assert.deepEqual(sorted.map((p) => [p.a, p.b]), [
    [x, y],
    [x, z],
    [y, z],
  ]);
});
```

Add `SimilarityPairSchema`, `sortSimilarityPairs`, and (if not already imported) `randomUUID` from `node:crypto` to this file's imports.

- [ ] **Step 7: Extend the shared conformance suite with `findSimilarPairs` tests**

These test **relative/structural** properties true for any correct implementation, not fixed cross-implementation similarity values (`FakeRetrievalStore` uses Jaccard word-overlap; `SqliteRetrievalStore` uses cosine-over-embeddings — the two never agree on an absolute number, only on direction and structure). Verified by spike that the existing `STRONG`/`NEAR_DUPLICATE`/`UNRELATED`/`WEAK` fixture constants already separate cleanly under both algorithms (`STRONG`~`NEAR_DUPLICATE` scores meaningfully higher than any pairing with `UNRELATED`/`WEAK`, both under `FakeEmbeddingProvider` cosine — 0.46 vs ≤0.29 — and under Jaccard — 0.21 vs ≤0.06).

`packages/core/test-fixtures/src/store-conformance.ts` — add helper and tests (inside `runRetrievalStoreConformance`, after the existing semantic tests, still before the closing brace, so it's still gated by the `if (!semantic) { ...; return; }` early exit above):

```ts
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
```

Add `type ScopeRef` to this file's existing `import type { Candidate, RetrievalStore, ScopeRef } from "@brain/contracts";` line if not already present (it already is, per the current file).

- [ ] **Step 8: Add the Sqlite-specific degradation test**

`packages/storage/src/retrieval-store.test.ts` — add, after the existing `semanticSearch` degradation test:

```ts
test("degradation: findSimilarPairs returns no pairs (not an error) when vector search is unavailable", async () => {
  const db = openDatabase(":memory:");
  const embeddings = new FakeEmbeddingProvider();
  const repo = new SqliteMemoryRepository(db.raw, embeddings);
  const a = await repo.create({ type: "fact", content: "alpha", scope: globalScope() });
  const b = await repo.create({ type: "fact", content: "alpha again", scope: globalScope() });
  const retrieval = new SqliteRetrievalStore(db.raw, embeddings, false);
  assert.deepEqual(await retrieval.findSimilarPairs([a.id, b.id], 0), []);
  db.close();
});
```

- [ ] **Step 9: Run the full suite and typecheck**

Run: `npm run typecheck && npm run build && npm test`
Expected: PASS, test count increased by 2 (`shapes.test.ts`) + 12 (6 conformance tests × 2 harnesses) + 1 (Sqlite degradation) = 15 new tests (307 total).

- [ ] **Step 10: Commit**

```bash
git add packages/core/contracts/src/signals.ts packages/core/contracts/src/repositories.ts packages/core/contracts/src/shapes.test.ts packages/core/test-fixtures/src/store-conformance.ts packages/core/test-fixtures/src/fake-retrieval-store.ts packages/storage/src/retrieval-store.ts packages/storage/src/retrieval-store.test.ts
git commit -m "feat(2C): resolve E25 -- RetrievalStore.findSimilarPairs on both implementations"
```

---

### Task 2: Context contracts — `CompileContextInput.redundancyPairs` + `ContextItem.redundantWith`

**Files:**
- Modify: `packages/core/contracts/src/context.ts`
- Modify: `packages/core/contracts/src/shapes.test.ts`

**Interfaces:**
- Consumes: `SimilarityPair` (Task 1, `signals.ts`).
- Produces: `ContextItemSchema` gains optional `redundantWith?: string` (a memoryId). `CompileContextInputSchema` gains optional `redundancyPairs?: SimilarityPair[]`.

This is purely additive data-shape work: no class implements `ContextItemSchema`/`CompileContextInputSchema`, so nothing else needs to change in the same commit, unlike Task 1's interface change.

- [ ] **Step 1: Write failing schema tests**

`packages/core/contracts/src/shapes.test.ts` — add:

```ts
test("ContextItem: redundantWith is optional and, when present, must be a uuid", () => {
  const base = { memoryId: randomUUID(), content: "x", type: "fact" as const, domain: null, scope: globalScope(), source: { origin: "system" as const }, confidence: 0.5, score: 1, rank: 1, wasCompressed: false };
  const withoutIt = ContextItemSchema.parse(base);
  assert.equal("redundantWith" in withoutIt, false);
  const withIt = ContextItemSchema.parse({ ...base, redundantWith: randomUUID() });
  assert.ok(typeof withIt.redundantWith === "string");
  assert.throws(() => ContextItemSchema.parse({ ...base, redundantWith: "not-a-uuid" }));
});

test("CompileContextInput: redundancyPairs is optional and defaults to absent", () => {
  const input = CompileContextInputSchema.parse({ task: "t", scope: globalScope(), rankedResults: [] });
  assert.equal("redundancyPairs" in input, false);
});

test("CompileContextInput: redundancyPairs accepts a valid SimilarityPair array", () => {
  const a = randomUUID();
  const b = randomUUID();
  const input = CompileContextInputSchema.parse({
    task: "t",
    scope: globalScope(),
    rankedResults: [],
    redundancyPairs: [{ a, b, similarity: 0.8 }],
  });
  assert.equal(input.redundancyPairs?.length, 1);
});
```

Run: `npm run typecheck` (in `packages/core/contracts`) — expect a compile error (`redundantWith`/`redundancyPairs` don't exist on the schema output types yet) or a runtime `.strict()` rejection once the pretest compile succeeds against the *old* schema. Either way, confirm it fails before Step 2.

- [ ] **Step 2: Add the fields**

`packages/core/contracts/src/context.ts` — modify:

```ts
import { z } from "zod";
import { ScopeRefSchema } from "./scope.js";
import { MEMORY_TYPES, ProvenanceSchema } from "./memory.js";
import { RankedResultSchema } from "./retrieval.js";
import { SimilarityPairSchema } from "./signals.js";
```

`ContextItemSchema` — add one field before the closing `.strict()`:

```ts
export const ContextItemSchema = z
  .object({
    memoryId: z.string().uuid(),
    content: z.string(),
    type: z.enum(MEMORY_TYPES),
    domain: z.string().min(1).nullable(),
    scope: ScopeRefSchema,
    source: ProvenanceSchema,
    confidence: z.number().min(0).max(1),
    score: z.number(),
    rank: z.number().int().positive(),
    wasCompressed: z.boolean(),
    // 2C-005 (E10/E25). Absent = normal/non-marked. Points only to another
    // memoryId within the SAME compileContext() call's candidate set -- never
    // an authorization signal, never persisted onto MemoryRecord.
    redundantWith: z.string().uuid().optional(),
  })
  .strict();
```

`CompileContextInputSchema` — add one field:

```ts
export const CompileContextInputSchema = z
  .object({
    task: z.string().min(1),
    scope: ScopeRefSchema,
    rankedResults: z.array(RankedResultSchema),
    agentCapabilities: z.array(z.string().min(1)).optional(),
    // 2C-004/005. Produced by core/retrieval's redundancy-pair computation
    // (which has store access); consumed here by the still-pure compiler.
    // Absent -> Phase 2B behavior exactly.
    redundancyPairs: z.array(SimilarityPairSchema).optional(),
  })
  .strict();
```

- [ ] **Step 3: Run tests**

Run: `npm run typecheck && npm run build && npm test` (in `packages/core/contracts`, then full monorepo)
Expected: PASS. 3 new tests (310 total).

- [ ] **Step 4: Commit**

```bash
git add packages/core/contracts/src/context.ts packages/core/contracts/src/shapes.test.ts
git commit -m "feat(2C): add CompileContextInput.redundancyPairs and ContextItem.redundantWith"
```

---

### Task 3: `core/retrieval` — redundancy-pair computation

**Files:**
- Create: `packages/core/retrieval/src/redundancy.ts`
- Create: `packages/core/retrieval/src/redundancy.test.ts`
- Modify: `packages/core/retrieval/src/service.ts`
- Modify: `packages/core/retrieval/src/service.test.ts`

**Interfaces:**
- Consumes: `RankedResult[]` (existing), `RetrievalStore.findSimilarPairs` (Task 1), `SimilarityPair` (Task 1).
- Produces: `toRedundancyPairs(rankedResults: RankedResult[], similarityPairs: SimilarityPair[]): SimilarityPair[]` (pure; re-orients each pair so `a` = the higher-ranked memoryId). `RetrievalService.getRedundancyPairs(rankedResults: RankedResult[], minSimilarity: number): Promise<SimilarityPair[]>` (I/O: calls the injected store, then `toRedundancyPairs`). Later tasks (Gateway) call `getRedundancyPairs`.

Mirrors the existing `merge.ts` (pure) / `service.ts` (I/O, delegates to `merge.ts`) split already established in this package.

- [ ] **Step 1: Write the failing test for the pure re-orientation function**

`packages/core/retrieval/src/redundancy.test.ts`:

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import type { RankedResult, SimilarityPair } from "@brain/contracts";
import { buildMemoryRecord } from "@brain/test-fixtures";
import { toRedundancyPairs } from "./redundancy.js";

function ranked(memoryId: string, rank: number): RankedResult {
  return { memoryId, record: buildMemoryRecord({ id: memoryId }), score: 1 / rank, signals: {}, rank };
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
```

Run: `npm run pretest` (in `packages/core/retrieval`) — expect a compile error (`./redundancy.js` does not exist).

- [ ] **Step 2: Implement the pure function**

`packages/core/retrieval/src/redundancy.ts`:

```ts
import type { RankedResult, SimilarityPair } from "@brain/contracts";
import { sortSimilarityPairs } from "@brain/contracts";

/**
 * Re-orients raw {a,b,similarity} triples from RetrievalStore.findSimilarPairs
 * (which knows nothing about rank -- it is a pure similarity primitive) so
 * that `a` is always the HIGHER-ranked member (lower RankedResult.rank
 * number), per PHASE_2C_SPEC.md 2C-004: "a being the higher-ranked member."
 * `core/context`'s compileContext() demotes `b` behind `a` on this basis.
 *
 * A pair naming a memoryId not present in `rankedResults` is dropped rather
 * than passed through -- it cannot be oriented by rank, and compileContext()
 * only ever sees items that came from rankedResults in the first place.
 */
export function toRedundancyPairs(rankedResults: RankedResult[], similarityPairs: SimilarityPair[]): SimilarityPair[] {
  const rankOf = new Map(rankedResults.map((r) => [r.memoryId, r.rank]));

  const oriented: SimilarityPair[] = [];
  for (const pair of similarityPairs) {
    const rankA = rankOf.get(pair.a);
    const rankB = rankOf.get(pair.b);
    if (rankA === undefined || rankB === undefined) continue;
    oriented.push(
      rankA <= rankB
        ? { a: pair.a, b: pair.b, similarity: pair.similarity }
        : { a: pair.b, b: pair.a, similarity: pair.similarity },
    );
  }
  return sortSimilarityPairs(oriented);
}
```

- [ ] **Step 3: Run the redundancy.test.ts suite**

Run: `npm run pretest && npm test` (in `packages/core/retrieval`)
Expected: PASS, 4 new tests.

- [ ] **Step 4: Write the failing test for `RetrievalService.getRedundancyPairs`**

`packages/core/retrieval/src/service.test.ts` — add (near the existing `RetrievalService` tests):

```ts
test("getRedundancyPairs: delegates to the store and re-orients by rank", async () => {
  const store = new FakeRetrievalStore();
  const a = buildMemoryRecord({ content: "database access must go through the repository layer" });
  const b = buildMemoryRecord({ content: "repository pattern abstracts database access" });
  store.index(a);
  store.index(b);
  const service = new RetrievalService(store);
  const rankedResults: RankedResult[] = [
    { memoryId: a.id, record: a, score: 1, signals: {}, rank: 1 },
    { memoryId: b.id, record: b, score: 0.5, signals: {}, rank: 2 },
  ];
  const pairs = await service.getRedundancyPairs(rankedResults, 0);
  assert.ok(pairs.length > 0);
  assert.equal(pairs[0]?.a, a.id, "the higher-ranked memory (rank 1) must be `a`");
});

test("getRedundancyPairs: fewer than two ranked results returns no pairs, no error", async () => {
  const store = new FakeRetrievalStore();
  const service = new RetrievalService(store);
  assert.deepEqual(await service.getRedundancyPairs([], 0.5), []);
});
```

Add `buildMemoryRecord` and `FakeRetrievalStore` to this file's `@brain/test-fixtures` import if not already present, and `type RankedResult` to its `@brain/contracts` import.

- [ ] **Step 5: Implement `RetrievalService.getRedundancyPairs`**

`packages/core/retrieval/src/service.ts` — add import and method:

```ts
import { RetrievalQuerySchema, type RetrievalQuery, type Candidate, type RetrievalStore, type RankedResult, type SimilarityPair } from "@brain/contracts";
import { mergeCandidates } from "./merge.js";
import { toRedundancyPairs } from "./redundancy.js";
```

Add as a method on `RetrievalService`, after `getCandidates`:

```ts
  /**
   * P2-013: redundancy-pair computation in retrieval preparation, which
   * already has store access (PHASE_2_SPEC.md 8). Delegates the actual
   * similarity math to the store (E25) and only re-orients by rank here --
   * this method does no vector math itself.
   */
  async getRedundancyPairs(rankedResults: RankedResult[], minSimilarity: number): Promise<SimilarityPair[]> {
    if (rankedResults.length < 2) return [];
    const pairs = await this.store.findSimilarPairs(rankedResults.map((r) => r.memoryId), minSimilarity);
    return toRedundancyPairs(rankedResults, pairs);
  }
```

- [ ] **Step 6: Run the full package suite**

Run: `npm run typecheck && npm run build && npm test` (in `packages/core/retrieval`, then full monorepo)
Expected: PASS. 6 new tests (316 total).

- [ ] **Step 7: Commit**

```bash
git add packages/core/retrieval/src/redundancy.ts packages/core/retrieval/src/redundancy.test.ts packages/core/retrieval/src/service.ts packages/core/retrieval/src/service.test.ts
git commit -m "feat(2C): P2-013 -- redundancy-pair computation in core/retrieval"
```

---

### Task 4: `core/context` — redundancy demotion in `compileContext()`

**Files:**
- Modify: `packages/core/context/src/compiler.ts`
- Modify: `packages/core/context/src/compiler.test.ts`

**Interfaces:**
- Consumes: `CompileContextInput.redundancyPairs` (Task 2).
- Produces: `ContextItem.redundantWith` set on demoted items; `CompiledContext.items` reordered (non-redundant first, in original rank order; redundant items after, in original relative order).

Nothing downstream needs a signature change: `core/token/optimize.ts`'s two-pass greedy fill already iterates `compiledContext.items` in array order and re-sorts its *output* by `.rank` at the end — reordering the *input* array here is sufficient by itself to make redundant items lose the budget race first, and to have them reappear in their natural rank position if included. **No change to `core/token` in this plan.**

- [ ] **Step 1: Write the failing tests**

`packages/core/context/src/compiler.test.ts` — add:

```ts
test("redundancy: a redundant item is marked and moved after all non-redundant items", () => {
  const a = rankedResult({ content: "project rule", rank: 1 });
  const b = rankedResult({ content: "global rule", rank: 2 });
  const c = rankedResult({ content: "distinct rule", rank: 3 });
  const result = compileContext({
    task: "t",
    scope: globalScope(),
    rankedResults: [a, b, c],
    redundancyPairs: [{ a: a.memoryId, b: b.memoryId, similarity: 0.9 }],
  });
  assert.deepEqual(result.items.map((i) => i.memoryId), [a.memoryId, c.memoryId, b.memoryId]);
  assert.equal(result.items.find((i) => i.memoryId === b.memoryId)?.redundantWith, a.memoryId);
  assert.equal("redundantWith" in (result.items.find((i) => i.memoryId === a.memoryId) ?? {}), false);
});

test("redundancy: relative order is preserved within each group", () => {
  const a = rankedResult({ content: "1", rank: 1 });
  const b = rankedResult({ content: "2", rank: 2 });
  const c = rankedResult({ content: "3", rank: 3 });
  const d = rankedResult({ content: "4", rank: 4 });
  const result = compileContext({
    task: "t",
    scope: globalScope(),
    rankedResults: [a, b, c, d],
    redundancyPairs: [
      { a: a.memoryId, b: b.memoryId, similarity: 0.9 },
      { a: c.memoryId, b: d.memoryId, similarity: 0.9 },
    ],
  });
  assert.deepEqual(result.items.map((i) => i.memoryId), [a.memoryId, c.memoryId, b.memoryId, d.memoryId]);
});

test("redundancy: absent redundancyPairs produces byte-identical output to Phase 2B (no reordering, no redundantWith)", () => {
  const a = rankedResult({ content: "1", rank: 1 });
  const b = rankedResult({ content: "2", rank: 2 });
  const withField = compileContext({ task: "t", scope: globalScope(), rankedResults: [a, b] });
  const withoutField = compileContext({ task: "t", scope: globalScope(), rankedResults: [a, b], redundancyPairs: [] });
  assert.deepEqual(withField, withoutField);
  for (const item of withField.items) assert.equal("redundantWith" in item, false);
});

test("redundancy: a pair naming a memoryId dropped by dedup is ignored, not a crash", () => {
  const a = rankedResult({ content: "same text", rank: 1 });
  const dup = rankedResult({ content: "same text", rank: 2 }); // exact-content dup of `a`, removed by existing dedup
  const b = rankedResult({ content: "other text", rank: 3 });
  const result = compileContext({
    task: "t",
    scope: globalScope(),
    rankedResults: [a, dup, b],
    redundancyPairs: [{ a: dup.memoryId, b: b.memoryId, similarity: 0.9 }], // dup.memoryId no longer survives
  });
  assert.equal(result.duplicatesRemoved, 1);
  assert.deepEqual(result.items.map((i) => i.memoryId).sort(), [a.memoryId, b.memoryId].sort());
  for (const item of result.items) assert.equal("redundantWith" in item, false);
});

test("redundancy: structural purity -- package.json still declares no embedding/storage dependency", async () => {
  const pkg = JSON.parse(readFileSync(join(dirname(fileURLToPath(import.meta.url)), "..", "package.json"), "utf-8"));
  assert.deepEqual(Object.keys(pkg.dependencies), ["@brain/contracts"]);
});
```

Add a small local helper near the top of the test file (if an equivalent doesn't already exist — check existing fixtures in this file first and reuse/adapt rather than duplicate):

```ts
function rankedResult(opts: { content: string; rank: number; confidence?: number }): RankedResult {
  const record = buildMemoryRecord({ content: opts.content, confidence: opts.confidence ?? 0.5 });
  return { memoryId: record.id, record, score: 1 / opts.rank, signals: {}, rank: opts.rank };
}
```

Add `readFileSync`, `join`/`dirname`, `fileURLToPath` imports if the structural-purity test pattern isn't already present in this file (it mirrors the existing REGRESSION-2-style guard used in `core/token`'s `optimize.test.ts`).

Run: `npm run pretest` (in `packages/core/context`) — expect failures (redundancy fields don't exist on the schema output the compiler currently produces, and no demotion logic exists).

- [ ] **Step 2: Implement demotion in `compileContext`**

`packages/core/context/src/compiler.ts` — replace the function body:

```ts
import { CompileContextInputSchema, type CompileContextInput, type CompiledContext, type ContextItem } from "@brain/contracts";

export function compileContext(rawInput: CompileContextInput): CompiledContext {
  const input = CompileContextInputSchema.parse(rawInput);

  const seenContent = new Set<string>();
  const nonRedundant: ContextItem[] = [];
  const redundant: ContextItem[] = [];
  let duplicatesRemoved = 0;

  // 2C-005: memoryId -> the higher-ranked memoryId it duplicates. Built before
  // the main loop so membership can be checked in one pass. A pair naming a
  // memoryId that gets dropped by dedup below, or that was never a candidate
  // here at all, simply never matches -- no special-casing needed.
  const redundantWithById = new Map<string, string>();
  for (const pair of input.redundancyPairs ?? []) {
    redundantWithById.set(pair.b, pair.a);
  }

  for (const ranked of input.rankedResults) {
    if (seenContent.has(ranked.record.content)) {
      duplicatesRemoved++;
      continue;
    }
    seenContent.add(ranked.record.content);

    const item: ContextItem = {
      memoryId: ranked.memoryId,
      content: ranked.record.content,
      type: ranked.record.type,
      domain: ranked.record.domain,
      scope: ranked.record.scope,
      source: ranked.record.source,
      confidence: ranked.record.confidence,
      score: ranked.score,
      rank: ranked.rank,
      wasCompressed: false,
    };

    const redundantWith = redundantWithById.get(ranked.memoryId);
    if (redundantWith !== undefined) {
      redundant.push({ ...item, redundantWith });
    } else {
      nonRedundant.push(item);
    }
  }

  return { items: [...nonRedundant, ...redundant], duplicatesRemoved };
}
```

Note: `redundantWithById.get(ranked.memoryId)` naturally handles "the pair named a memoryId dropped by dedup" -- if `ranked.memoryId` (the `b` of a pair) never reaches this loop iteration because an earlier item with the same content already consumed it... actually dedup only skips items whose *content* was already seen, not particular memoryIds -- every distinct `ranked` entry still gets its own loop iteration and its own lookup, so this is correct as written: an item that itself gets deduped away (`continue`d) never enters `nonRedundant`/`redundant` at all, and its `redundantWith` mapping (if any) is simply unused, matching Test 4's expectation.

- [ ] **Step 3: Run the full package suite**

Run: `npm run typecheck && npm run build && npm test` (in `packages/core/context`, then full monorepo)
Expected: PASS. 5 new tests (321 total). All 23 pre-existing `compiler.test.ts` tests still pass unchanged (dedup, ordering-preservation, provenance-preservation, and the four `boundary:` guard tests).

- [ ] **Step 4: Commit**

```bash
git add packages/core/context/src/compiler.ts packages/core/context/src/compiler.test.ts
git commit -m "feat(2C): P2-014 -- redundancy demotion in core/context, core/token untouched"
```

---

### Task 5: Gateway wiring + degradation

**Files:**
- Modify: `packages/gateway/src/gateway.ts`
- Modify: `packages/gateway/src/gateway.test.ts`
- Modify: `packages/mcp/src/bootstrap.ts`

**Interfaces:**
- Consumes: `RetrievalService.getRedundancyPairs` (Task 3), `CompileContextInput.redundancyPairs` (Task 2).
- Produces: `Gateway`'s constructor gains a 5th, defaulted parameter `redundancy: { enabled: boolean; threshold: number }`.

Default is **disabled** (`enabled: false`) — matching "ship disabled, machinery in place" until Task 8's evaluation justifies turning it on. With it disabled, `getContext()`'s output is byte-identical to today (satisfies the no-redundancy regression at the production default, not just as a threshold edge case).

- [ ] **Step 1: Write the failing tests**

Verified against the actual current file: `setup()` has signature `setup(seedRecords: ReturnType<typeof buildMemoryRecord>[] = [])`, constructs `Gateway` with exactly 4 positional args, and returns `{ gateway, memoryRepo, retrievalStore, eventStore }`. Extend it with an optional 2nd parameter (a TS default-parameter argument may always be passed `undefined`, so this is a non-breaking change — every existing call site, `setup()` and `setup([...])` alike, is unaffected):

`packages/gateway/src/gateway.test.ts` — modify `setup()`:

```ts
function setup(
  seedRecords: ReturnType<typeof buildMemoryRecord>[] = [],
  redundancy?: { enabled: boolean; threshold: number },
) {
  const eventStore = new FakeEventStore();
  const memoryRepo = new FakeMemoryRepository(eventStore);
  const retrievalStore = new FakeRetrievalStore(seedRecords);
  const gateway = new Gateway(
    new MemoryService(memoryRepo),
    new RetrievalService(retrievalStore),
    new EventService(eventStore),
    { vectorSearchAvailable: true },
    redundancy,
  );
  return { gateway, memoryRepo, retrievalStore, eventStore };
}
```

Add the three new tests (using the real `buildMemoryRecord`-seeded, `{ gateway }`-destructuring style every other test in this file already uses):

```ts
test("redundancy disabled by default: getContext output carries no redundantWith marks", async () => {
  const projectRule = buildMemoryRecord({ content: "notes-api uses plural resource names", scope: projectScope("notes-api") });
  const globalRule = buildMemoryRecord({ content: "REST resources use plural nouns in endpoint paths", scope: globalScope() });
  const { gateway } = setup([projectRule, globalRule]); // no redundancy arg -> Gateway's own default (disabled)
  const delivery = await gateway.getContext({ task: "notes-api uses plural resource names", scope: projectScope("notes-api"), budget: { maxTokens: 2000 } });
  for (const item of delivery.items) assert.equal("redundantWith" in item, false);
});

// STRONG/NEAR_DUPLICATE content reused verbatim from
// core/test-fixtures/store-conformance.ts -- spiked and confirmed their
// Jaccard word-overlap similarity is 0.2105 under FakeRetrievalStore, so
// threshold 0.15 reliably catches this specific pair with margin.
test("redundancy enabled: a near-duplicate lower-ranked candidate is marked redundantWith under an ample budget", async () => {
  const strong = buildMemoryRecord({
    content: "notes-api: database access must go through the repository layer, never directly from route handlers",
    scope: projectScope("notes-api"),
    confidence: 1,
  });
  const nearDuplicate = buildMemoryRecord({
    content: "the repository pattern abstracts database access behind an interface",
    scope: projectScope("notes-api"),
    confidence: 1,
  });
  const { gateway } = setup([strong, nearDuplicate], { enabled: true, threshold: 0.15 });
  const delivery = await gateway.getContext({
    task: "database access repository pattern",
    scope: projectScope("notes-api"),
    budget: { maxTokens: 2000 }, // ample -- isolates "is redundancy wired" from budget selection, which Task 8 covers
  });
  assert.equal(delivery.items.length, 2, "ample budget: both items still delivered -- demoted, not deleted");
  assert.ok(
    delivery.items.some((i) => i.redundantWith !== undefined),
    "the lower-ranked near-duplicate must be marked redundantWith when redundancy is enabled",
  );
});

class ThrowingRetrievalStore extends FakeRetrievalStore {
  override async findSimilarPairs(): Promise<never> {
    throw new Error("simulated findSimilarPairs failure");
  }
}

test("redundancy degradation: a store that throws on findSimilarPairs never fails the request", async () => {
  const record = buildMemoryRecord({ content: "anything", scope: globalScope() });
  const eventStore = new FakeEventStore();
  const memoryRepo = new FakeMemoryRepository(eventStore);
  const retrievalStore = new ThrowingRetrievalStore([record]);
  const gateway = new Gateway(
    new MemoryService(memoryRepo),
    new RetrievalService(retrievalStore),
    new EventService(eventStore),
    { vectorSearchAvailable: true },
    { enabled: true, threshold: 0.5 },
  );
  const delivery = await gateway.getContext({ task: "anything", scope: globalScope(), budget: { maxTokens: 500 } });
  assert.ok(delivery.items.length > 0);
});
```

`ThrowingRetrievalStore` must be a real subclass (`extends FakeRetrievalStore`, `override` one method) — spreading a class instance (`{...new FakeRetrievalStore()}`) would silently drop its prototype methods (`lexicalSearch`/`semanticSearch` are not own-enumerable-properties), producing an object that fails `RetrievalStore` structurally at the call site, not a working fake.

- [ ] **Step 2: Wire it into `Gateway.getContext`**

`packages/gateway/src/gateway.ts` — modify:

```ts
import {
  type Candidate,
  type ContextEventMemory,
  type MemoryRecord,
  type MemoryResult,
  type RankedResult,
  type ContextPack,
  type FeedbackEvent,
  type OutcomeEvent,
  type SimilarityPair,
} from "@brain/contracts";
```

Add a documented default constant near the top of the file, after the existing `DEFAULT_CANDIDATE_LIMIT`/`PROJECT_COUNT_LIMIT`:

```ts
/**
 * 2C-004. NOT a statistically fit value -- the one real datapoint
 * (PHASE_2_FINDINGS.md 5) puts the known redundant pair at cosine 0.785 with
 * the next-nearest distinct memory at 0.518. 0.75 gives margin below the
 * former and above the latter. Adjustable; see docs/PHASE_2C_FINDINGS.md for
 * the threshold sweep this default is informed by.
 */
export const DEFAULT_REDUNDANCY_THRESHOLD = 0.75;
```

Constructor:

```ts
export class Gateway {
  constructor(
    private readonly memory: MemoryService,
    private readonly retrieval: RetrievalService,
    private readonly events: EventService,
    private readonly capabilities: { vectorSearchAvailable: boolean },
    // 2C-005. Disabled by default: with this flag off, getContext() output is
    // byte-identical to Phase 2B (the no-redundancy regression at the
    // production default, not just as a below-threshold edge case). Ship
    // disabled until Task 8's evaluation justifies enabling it.
    private readonly redundancy: { enabled: boolean; threshold: number } = {
      enabled: false,
      threshold: DEFAULT_REDUNDANCY_THRESHOLD,
    },
  ) {}
```

Inside `getContext`, between the existing ranking block and the existing compile block:

```ts
    const rankingStart = performance.now();
    const rankedResults: RankedResult[] = rank({ candidates, task: request.task });
    const rankingMs = performance.now() - rankingStart;

    // 2C-004/005: redundancy pairs, computed only when enabled. A failure
    // here degrades to "no pairs" -- the same discipline as vector-search
    // unavailability elsewhere in this pipeline -- never a failed request.
    let redundancyPairs: SimilarityPair[] = [];
    if (this.redundancy.enabled) {
      try {
        redundancyPairs = await this.retrieval.getRedundancyPairs(rankedResults, this.redundancy.threshold);
      } catch (error) {
        console.warn("brain_context: redundancy detection failed, continuing without it:", error);
      }
    }

    const compileStart = performance.now();
    const compiledContext = compileContext({ task: request.task, scope: request.scope, rankedResults, redundancyPairs });
    const compileMs = performance.now() - compileStart;
```

(The rest of `getContext` — `optimizeContext`, telemetry recording — is unchanged.)

- [ ] **Step 3: Give `mcp/bootstrap.ts` an explicit (still disabled) config**

`packages/mcp/src/bootstrap.ts` — modify the `Gateway` construction to pass the config explicitly rather than relying on the default, so the composition root states the current phase's decision instead of leaving it implicit:

```ts
import { Gateway, DEFAULT_REDUNDANCY_THRESHOLD } from "@brain/gateway";
// ...
  const gateway = new Gateway(
    new MemoryService(memoryRepository),
    new RetrievalService(retrievalStore),
    new EventService(eventStore),
    { vectorSearchAvailable: db.vectorSearchAvailable },
    // 2C: machinery in place, disabled pending Task 8's evaluation result.
    { enabled: false, threshold: DEFAULT_REDUNDANCY_THRESHOLD },
  );
```

(`Gateway`'s default parameter value already makes this redundant behaviorally — this change is purely to make the phase's current decision visible at the one place that wires production dependencies together, matching this file's existing role as the composition root.)

- [ ] **Step 4: Run the full suite**

Run: `npm run typecheck && npm run build && npm test`
Expected: PASS. 3 new tests (324 total). Existing `boundaries.test.ts` in `packages/mcp` still passes (Gateway still imports no MCP SDK; bootstrap.ts is still the sole `@brain/storage` importer).

- [ ] **Step 5: Commit**

```bash
git add packages/gateway/src/gateway.ts packages/gateway/src/gateway.test.ts packages/mcp/src/bootstrap.ts
git commit -m "feat(2C): wire redundancy pairs into Gateway.getContext, disabled by default"
```

---

### Task 6: `packages/evaluation` — pure efficiency metrics (2C-001)

**Files:**
- Create: `packages/evaluation/src/efficiency.ts`
- Create: `packages/evaluation/src/efficiency.test.ts`
- Modify: `packages/evaluation/src/index.ts`

**Interfaces:**
- Produces: `DeliveredItemLabel = "useful" | "not_useful" | "redundant" | "unlabeled"`; `DeliveredItemMeasurement = { memoryId: string; tokenCount: number | null; label: DeliveredItemLabel }`; `EfficiencyInput = { delivered: DeliveredItemMeasurement[]; candidateTokenCount: number | null }`; `EfficiencyMetrics = { contextEfficiency: number | null; redundantRatio: number | null; retrievalEfficiency: number | null; labeledFraction: number | null; deliveredItems: number; labeledDeliveredItems: number; deliveredTokens: number | null }`; `computeEfficiencyMetrics(input: EfficiencyInput): EfficiencyMetrics`.

Deliberately generic over *where* a label came from — Task 8's live-pipeline strategy runner and Task 7's `exportFromEvents`-derived reports both build `DeliveredItemMeasurement[]` from different sources and feed the same function. Four-way label split (not three) because "known redundant" and "known not useful" are different findings that must not be conflated (a redundant item is not evidence the memory is wrong).

- [ ] **Step 1: Write the failing tests**

`packages/evaluation/src/efficiency.test.ts`:

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { computeEfficiencyMetrics, type DeliveredItemMeasurement } from "./efficiency.js";

function item(label: DeliveredItemMeasurement["label"], tokenCount: number | null = 10): DeliveredItemMeasurement {
  return { memoryId: `mem-${Math.random()}`, tokenCount, label };
}

test("contextEfficiency: useful tokens over total delivered tokens", () => {
  const result = computeEfficiencyMetrics({
    delivered: [item("useful", 10), item("useful", 20), item("not_useful", 30)],
    candidateTokenCount: 200,
  });
  assert.equal(result.contextEfficiency, 30 / 60);
});

test("redundantRatio: redundant tokens over total delivered tokens, distinct from useful", () => {
  const result = computeEfficiencyMetrics({
    delivered: [item("useful", 10), item("redundant", 10), item("redundant", 20)],
    candidateTokenCount: 100,
  });
  assert.equal(result.redundantRatio, 30 / 40);
  assert.equal(result.contextEfficiency, 10 / 40);
});

test("retrievalEfficiency: delivered tokens over candidate-pool tokens", () => {
  const result = computeEfficiencyMetrics({ delivered: [item("useful", 50)], candidateTokenCount: 200 });
  assert.equal(result.retrievalEfficiency, 50 / 200);
});

test("labeledFraction: unlabeled items count toward deliveredItems but not labeledDeliveredItems", () => {
  const result = computeEfficiencyMetrics({
    delivered: [item("useful"), item("not_useful"), item("redundant"), item("unlabeled")],
    candidateTokenCount: 100,
  });
  assert.equal(result.deliveredItems, 4);
  assert.equal(result.labeledDeliveredItems, 3);
  assert.equal(result.labeledFraction, 0.75);
});

test("zero delivered items: every ratio is null (unavailable), never a fabricated zero", () => {
  const result = computeEfficiencyMetrics({ delivered: [], candidateTokenCount: 100 });
  assert.equal(result.contextEfficiency, null);
  assert.equal(result.redundantRatio, null);
  assert.equal(result.labeledFraction, null);
  assert.equal(result.deliveredTokens, null);
});

test("zero or missing candidateTokenCount: retrievalEfficiency is null, other ratios unaffected", () => {
  const result = computeEfficiencyMetrics({ delivered: [item("useful", 10)], candidateTokenCount: 0 });
  assert.equal(result.retrievalEfficiency, null);
  assert.equal(result.contextEfficiency, 1);

  const resultNull = computeEfficiencyMetrics({ delivered: [item("useful", 10)], candidateTokenCount: null });
  assert.equal(resultNull.retrievalEfficiency, null);
});

test("any delivered item with tokenCount null makes deliveredTokens/contextEfficiency/redundantRatio unavailable -- partial sums are not fabricated", () => {
  const result = computeEfficiencyMetrics({ delivered: [item("useful", 10), item("useful", null)], candidateTokenCount: 100 });
  assert.equal(result.deliveredTokens, null);
  assert.equal(result.contextEfficiency, null);
  assert.equal(result.redundantRatio, null);
  // labeledFraction does not depend on token measurement and stays computable
  assert.equal(result.labeledFraction, 1);
});

test("100% labeledFraction is required before a ratio may be read as a completeness claim (documented, not enforced by the type) -- sanity check the numbers compose correctly at labeledFraction 1.0", () => {
  const result = computeEfficiencyMetrics({ delivered: [item("useful", 40), item("not_useful", 60)], candidateTokenCount: 500 });
  assert.equal(result.labeledFraction, 1);
  assert.equal(result.contextEfficiency, 0.4);
});
```

Run: `npm run pretest` (in `packages/evaluation`) — expect a compile error (`./efficiency.js` does not exist).

- [ ] **Step 2: Implement**

`packages/evaluation/src/efficiency.ts`:

```ts
/**
 * 2C-001. Pure token/context efficiency metrics, computed from Phase 2B's
 * already-stored measurements -- no re-estimation with a different
 * tokenizer. Deliberately generic over the SOURCE of each item's label: both
 * a live pipeline run (Task 8) and exportFromEvents-derived real data
 * (Task 7) build DeliveredItemMeasurement[] and feed this same function.
 *
 * "redundant" is its own label, never folded into "not_useful": a memory
 * flagged redundant is not evidence it is wrong (PHASE_2C_SPEC.md 2C-002),
 * so counting its tokens as contextEfficiency's numerator OR as evidence of
 * waste would both misrepresent it.
 */

export type DeliveredItemLabel = "useful" | "not_useful" | "redundant" | "unlabeled";

export interface DeliveredItemMeasurement {
  memoryId: string;
  /** Delivered (post-compression) token cost. null = measurement unavailable for this item. */
  tokenCount: number | null;
  label: DeliveredItemLabel;
}

export interface EfficiencyInput {
  delivered: DeliveredItemMeasurement[];
  /** Candidate-pool token cost BEFORE compilation/optimization. null = unavailable. */
  candidateTokenCount: number | null;
}

export interface EfficiencyMetrics {
  contextEfficiency: number | null;
  redundantRatio: number | null;
  retrievalEfficiency: number | null;
  labeledFraction: number | null;
  deliveredItems: number;
  labeledDeliveredItems: number;
  /** null when any delivered item's tokenCount is unavailable -- a partial sum would understate the true total. */
  deliveredTokens: number | null;
}

export function computeEfficiencyMetrics(input: EfficiencyInput): EfficiencyMetrics {
  const deliveredItems = input.delivered.length;
  const labeledDeliveredItems = input.delivered.filter((d) => d.label !== "unlabeled").length;
  const labeledFraction = deliveredItems === 0 ? null : labeledDeliveredItems / deliveredItems;

  const anyTokenCountMissing = input.delivered.some((d) => d.tokenCount === null);
  let deliveredTokens: number | null = null;
  let usefulTokens = 0;
  let redundantTokens = 0;
  if (deliveredItems > 0 && !anyTokenCountMissing) {
    deliveredTokens = 0;
    for (const d of input.delivered) {
      const cost = d.tokenCount as number;
      deliveredTokens += cost;
      if (d.label === "useful") usefulTokens += cost;
      if (d.label === "redundant") redundantTokens += cost;
    }
  }

  // deliveredTokens === 0 (distinct from null: a real measurement, every
  // delivered item genuinely cost zero tokens -- practically near-impossible
  // since MemoryRecord.content is non-empty, but 0/0 is undefined regardless
  // of why the denominator is zero) is treated the same as "unavailable":
  // there is nothing to compute a meaningful ratio over either way.
  const contextEfficiency = deliveredTokens === null || deliveredTokens === 0 ? null : usefulTokens / deliveredTokens;
  const redundantRatio = deliveredTokens === null || deliveredTokens === 0 ? null : redundantTokens / deliveredTokens;
  const retrievalEfficiency =
    deliveredTokens === null || input.candidateTokenCount === null || input.candidateTokenCount === 0
      ? null
      : deliveredTokens / input.candidateTokenCount;

  return {
    contextEfficiency,
    redundantRatio,
    retrievalEfficiency,
    labeledFraction,
    deliveredItems,
    labeledDeliveredItems,
    deliveredTokens,
  };
}
```

- [ ] **Step 3: Export from the package index**

`packages/evaluation/src/index.ts`:

```ts
export * from "./types.js";
export * from "./metrics.js";
export * from "./evaluate.js";
export * from "./dataset.js";
export * from "./efficiency.js";
```

- [ ] **Step 4: Run the full suite**

Run: `npm run typecheck && npm run build && npm test` (in `packages/evaluation`, then full monorepo)
Expected: PASS. 8 new tests (332 total).

- [ ] **Step 5: Commit**

```bash
git add packages/evaluation/src/efficiency.ts packages/evaluation/src/efficiency.test.ts packages/evaluation/src/index.ts
git commit -m "feat(2C-001): pure efficiency metrics -- contextEfficiency, redundantRatio, retrievalEfficiency, labeledFraction"
```

---

### Task 7: `packages/evaluation` — `exportFromEvents` (2C-002)

**Files:**
- Modify: `packages/evaluation/src/types.ts`
- Create: `packages/evaluation/src/export.ts`
- Create: `packages/evaluation/src/export.test.ts`
- Modify: `packages/evaluation/src/index.ts`

**Interfaces:**
- Consumes: `RetrievalEvent`, `ContextEvent`, `FeedbackEvent`, `OutcomeEvent` (existing, `@brain/contracts`). `EventTables = { retrievalEvents; contextEvents; feedbackEvents; outcomeEvents }` (structurally satisfied directly by `@brain/test-fixtures`' existing `FakeEventStore`, no wrapping needed). `MemoryLookup = { get(memoryId, scope): Promise<MemoryRecord | null> }` (structurally satisfied directly by `MemoryRepository`/`FakeMemoryRepository`/`SqliteMemoryRepository`).
- Produces: `EvalExampleSchema` gains optional `outcome`. `exportFromEvents(events: EventTables, memories: MemoryLookup, options?: { since?: string }): Promise<EvalExample[]>`.

`@brain/test-fixtures` already has `FakeEventStore` and `FakeMemoryRepository` (confirmed by reading them) — this task adds zero new fakes, only a devDependency-style import of what already exists.

**Known, documented limitation (real, not a bug to silently fix):** `FeedbackEvent.reason === "redundant"` has no structured field naming *which* other memory it is redundant with (only free-text `notes`, e.g. `"Redundant with a0ae3295..."`). `exportFromEvents` therefore always produces `redundantWith: {}` on exported examples — it cannot reconstruct redundancy edges from history. Note this in the final report (Task 9); do not add a new field to `FeedbackEvent` to fix it — out of this phase's scope.

- [ ] **Step 1: Add `EvalExample.outcome`**

`packages/evaluation/src/types.ts` — modify import and schema:

```ts
import { z } from "zod";
import { ScopeRefSchema, MEMORY_TYPES, OUTCOME_VALUES } from "@brain/contracts";
```

`EvalExampleSchema` — add one field before `.strict()`:

```ts
    redundantWith: z.record(z.string(), z.string()).default({}),
    notes: z.string().nullable().default(null),
    /**
     * 2C-002. Outcome attached as METADATA -- it does not automatically label
     * any included memory (PHASE_2C_SPEC.md 2C-002). Present so
     * exportFromEvents can carry a real OutcomeEvent's value through without
     * fabricating a per-memory grade from it.
     */
    outcome: z.enum(OUTCOME_VALUES).nullable().default(null),
```

- [ ] **Step 2: Write the failing tests**

`packages/evaluation/src/export.test.ts`:

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { globalScope, projectScope } from "@brain/contracts";
import { FakeEventStore, FakeMemoryRepository } from "@brain/test-fixtures";
import { exportFromEvents } from "./export.js";

async function scenario() {
  const events = new FakeEventStore();
  const memories = new FakeMemoryRepository(events);
  return { events, memories };
}

test("exportFromEvents: useful=true maps to grade 2", async () => {
  const { events, memories } = await scenario();
  const mem = await memories.create({ type: "rule", content: "notes-api uses plural resource names", scope: projectScope("notes-api"), confidence: 1 });
  const retrieval = await events.recordRetrieval({ scope: projectScope("notes-api"), queryText: "naming convention", candidateIds: [mem.id], taskId: null });
  const context = await events.recordContext({
    retrievalEventId: retrieval.id,
    scope: projectScope("notes-api"),
    taskId: null,
    includedMemoryIds: [mem.id],
    omittedMemoryIds: [],
    tokenCount: 10,
    memories: [{ memoryId: mem.id, included: true, rank: 1, tokenCount: 10 }],
    candidateCount: 1,
    candidateTokenCount: 10,
    retrievalMs: 1,
    rankingMs: 1,
    compileMs: 1,
    optimizeMs: 1,
  });
  await events.recordFeedback({ memoryId: mem.id, taskId: null, contextId: context.id, useful: true, reason: null, notes: null });

  const [example] = await exportFromEvents(events, memories);
  assert.ok(example);
  assert.equal(example.task, "naming convention");
  assert.equal(example.labels[mem.id], 2);
});

test("exportFromEvents: useful=false + irrelevant maps to grade 0", async () => {
  const { events, memories } = await scenario();
  const mem = await memories.create({ type: "rule", content: "x", scope: globalScope() });
  const retrieval = await events.recordRetrieval({ scope: globalScope(), queryText: "q", candidateIds: [mem.id], taskId: null });
  const context = await events.recordContext({
    retrievalEventId: retrieval.id, scope: globalScope(), taskId: null,
    includedMemoryIds: [mem.id], omittedMemoryIds: [], tokenCount: 5,
    memories: [{ memoryId: mem.id, included: true, rank: 1, tokenCount: 5 }],
    candidateCount: 1, candidateTokenCount: 5, retrievalMs: 1, rankingMs: 1, compileMs: 1, optimizeMs: 1,
  });
  await events.recordFeedback({ memoryId: mem.id, taskId: null, contextId: context.id, useful: false, reason: "irrelevant", notes: null });

  const [example] = await exportFromEvents(events, memories);
  assert.equal(example?.labels[mem.id], 0);
});

test("exportFromEvents: useful=false + redundant is excluded from labels entirely (not grade 0, not grade 2)", async () => {
  const { events, memories } = await scenario();
  const mem = await memories.create({ type: "rule", content: "x", scope: globalScope() });
  const retrieval = await events.recordRetrieval({ scope: globalScope(), queryText: "q", candidateIds: [mem.id], taskId: null });
  const context = await events.recordContext({
    retrievalEventId: retrieval.id, scope: globalScope(), taskId: null,
    includedMemoryIds: [mem.id], omittedMemoryIds: [], tokenCount: 5,
    memories: [{ memoryId: mem.id, included: true, rank: 1, tokenCount: 5 }],
    candidateCount: 1, candidateTokenCount: 5, retrievalMs: 1, rankingMs: 1, compileMs: 1, optimizeMs: 1,
  });
  await events.recordFeedback({ memoryId: mem.id, taskId: null, contextId: context.id, useful: false, reason: "redundant", notes: null });

  const [example] = await exportFromEvents(events, memories);
  assert.equal(mem.id in (example?.labels ?? {}), false);
  assert.deepEqual(example?.redundantWith, {}, "no structured target exists on FeedbackEvent -- documented limitation, not fabricated");
});

test("exportFromEvents: no feedback at all leaves the memory unlabeled, excluded from labels", async () => {
  const { events, memories } = await scenario();
  const mem = await memories.create({ type: "rule", content: "x", scope: globalScope() });
  const retrieval = await events.recordRetrieval({ scope: globalScope(), queryText: "q", candidateIds: [mem.id], taskId: null });
  await events.recordContext({
    retrievalEventId: retrieval.id, scope: globalScope(), taskId: null,
    includedMemoryIds: [mem.id], omittedMemoryIds: [], tokenCount: 5,
    memories: [{ memoryId: mem.id, included: true, rank: 1, tokenCount: 5 }],
    candidateCount: 1, candidateTokenCount: 5, retrievalMs: 1, rankingMs: 1, compileMs: 1, optimizeMs: 1,
  });

  const [example] = await exportFromEvents(events, memories);
  assert.equal(mem.id in (example?.labels ?? {}), false);
});

test("exportFromEvents: outcome is attached as metadata and does not create a label", async () => {
  const { events, memories } = await scenario();
  const mem = await memories.create({ type: "rule", content: "x", scope: globalScope() });
  const retrieval = await events.recordRetrieval({ scope: globalScope(), queryText: "q", candidateIds: [mem.id], taskId: "t1" });
  const context = await events.recordContext({
    retrievalEventId: retrieval.id, scope: globalScope(), taskId: "t1",
    includedMemoryIds: [mem.id], omittedMemoryIds: [], tokenCount: 5,
    memories: [{ memoryId: mem.id, included: true, rank: 1, tokenCount: 5 }],
    candidateCount: 1, candidateTokenCount: 5, retrievalMs: 1, rankingMs: 1, compileMs: 1, optimizeMs: 1,
  });
  await events.recordOutcome({ taskId: "t1", sessionId: null, contextId: context.id, outcome: "success", signal: null, notes: null });

  const [example] = await exportFromEvents(events, memories);
  assert.equal(example?.outcome, "success");
  assert.equal(mem.id in (example?.labels ?? {}), false);
});

test("exportFromEvents: a pre-migration context event (empty memories[]) is skipped, not fabricated", async () => {
  const { events, memories } = await scenario();
  const mem = await memories.create({ type: "rule", content: "x", scope: globalScope() });
  const retrieval = await events.recordRetrieval({ scope: globalScope(), queryText: "q", candidateIds: [mem.id], taskId: null });
  events.contextEvents.push({
    id: "aaaaaaaa-0000-0000-0000-000000000000", timestamp: new Date().toISOString(),
    retrievalEventId: retrieval.id, scope: globalScope(), taskId: null,
    includedMemoryIds: [mem.id], omittedMemoryIds: [], tokenCount: 5, memories: [],
    candidateCount: null, candidateTokenCount: null, retrievalMs: null, rankingMs: null, compileMs: null, optimizeMs: null,
  });
  assert.deepEqual(await exportFromEvents(events, memories), []);
});

test("exportFromEvents: a memory archived/purged since delivery is skipped rather than fabricated", async () => {
  const { events, memories } = await scenario();
  const mem = await memories.create({ type: "rule", content: "x", scope: globalScope() });
  await memories.purge(mem.id, globalScope());
  const retrieval = await events.recordRetrieval({ scope: globalScope(), queryText: "q", candidateIds: [mem.id], taskId: null });
  await events.recordContext({
    retrievalEventId: retrieval.id, scope: globalScope(), taskId: null,
    includedMemoryIds: [mem.id], omittedMemoryIds: [], tokenCount: 5,
    memories: [{ memoryId: mem.id, included: true, rank: 1, tokenCount: 5 }],
    candidateCount: 1, candidateTokenCount: 5, retrievalMs: 1, rankingMs: 1, compileMs: 1, optimizeMs: 1,
  });
  assert.deepEqual(await exportFromEvents(events, memories), []);
});

test("exportFromEvents: `since` excludes context events before the given timestamp", async () => {
  const { events, memories } = await scenario();
  const mem = await memories.create({ type: "rule", content: "x", scope: globalScope() });
  const retrieval = await events.recordRetrieval({ scope: globalScope(), queryText: "q", candidateIds: [mem.id], taskId: null });
  await events.recordContext({
    retrievalEventId: retrieval.id, scope: globalScope(), taskId: null,
    includedMemoryIds: [mem.id], omittedMemoryIds: [], tokenCount: 5,
    memories: [{ memoryId: mem.id, included: true, rank: 1, tokenCount: 5 }],
    candidateCount: 1, candidateTokenCount: 5, retrievalMs: 1, rankingMs: 1, compileMs: 1, optimizeMs: 1,
  });
  const future = new Date(Date.now() + 60_000).toISOString();
  assert.deepEqual(await exportFromEvents(events, memories, { since: future }), []);
});
```

Run: `npm run pretest` (in `packages/evaluation`) — expect a compile error (`./export.js` does not exist).

- [ ] **Step 3: Implement**

`packages/evaluation/src/export.ts`:

```ts
import type { RetrievalEvent, ContextEvent, FeedbackEvent, OutcomeEvent, MemoryRecord, ScopeRef } from "@brain/contracts";
import { EvalExampleSchema, type EvalExample, type EvalMemory } from "./types.js";

/**
 * 2C-002 (P2-016). Structurally satisfied by @brain/test-fixtures'
 * FakeEventStore directly (its four public readonly arrays match exactly) --
 * no wrapper needed. A SqliteEventStore-backed adapter for the real corpus is
 * a throwaway reporting script (Task 9), not committed production API surface
 * -- this package must not import @brain/storage.
 */
export interface EventTables {
  retrievalEvents: RetrievalEvent[];
  contextEvents: ContextEvent[];
  feedbackEvents: FeedbackEvent[];
  outcomeEvents: OutcomeEvent[];
}

/** Structurally satisfied by MemoryRepository/FakeMemoryRepository/SqliteMemoryRepository -- only the read method this needs. */
export interface MemoryLookup {
  get(memoryId: string, scope: ScopeRef): Promise<MemoryRecord | null>;
}

/**
 * Builds replayable EvalExample[] from real correlated events:
 *   RetrievalEvent -> ContextEvent -> ContextEventMemory[] -> FeedbackEvent[] -> OutcomeEvent?
 *
 * Grouped by ContextEvent.id (the precise delivery identifier, per E3/P2-005)
 * -- NOT by taskId, which is optional and was 0% populated before Phase 2B
 * (PHASE_2_FINDINGS.md 4.1). Historical context events without a resolvable
 * retrieval event, or with no per-item membership (pre-migration rows), are
 * skipped: this function never fabricates linkage that was not recorded.
 *
 * KNOWN LIMITATION: FeedbackEvent.reason === 'redundant' has no structured
 * field naming which OTHER memory it is redundant with (only free-text
 * `notes`). Exported examples therefore always carry redundantWith: {} --
 * this function cannot reconstruct redundancy edges from history. See
 * docs/PHASE_2C_FINDINGS.md.
 */
export async function exportFromEvents(
  events: EventTables,
  memories: MemoryLookup,
  options: { since?: string } = {},
): Promise<EvalExample[]> {
  const retrievalById = new Map(events.retrievalEvents.map((r) => [r.id, r]));
  const examples: EvalExample[] = [];

  for (const contextEvent of events.contextEvents) {
    if (options.since && contextEvent.timestamp < options.since) continue;
    if (contextEvent.memories.length === 0) continue; // pre-migration row: no per-item membership to export
    const retrievalEvent = retrievalById.get(contextEvent.retrievalEventId);
    if (!retrievalEvent) continue; // cannot recover task text without it -- skip rather than fabricate

    const feedbackForDelivery = events.feedbackEvents.filter((f) => f.contextId === contextEvent.id);
    const outcomeForDelivery = events.outcomeEvents.find((o) => o.contextId === contextEvent.id) ?? null;
    const feedbackByMemory = new Map(feedbackForDelivery.map((f) => [f.memoryId, f]));

    const includedIds = contextEvent.memories.filter((m) => m.included).map((m) => m.memoryId);
    if (includedIds.length === 0) continue;

    const evalMemories: EvalMemory[] = [];
    const labels: Record<string, 0 | 1 | 2> = {};

    for (const memoryId of includedIds) {
      const record = await memories.get(memoryId, contextEvent.scope);
      if (!record) continue; // archived/purged since delivery -- cannot replay its content

      evalMemories.push({ key: memoryId, type: record.type, content: record.content, scope: record.scope, confidence: record.confidence });

      const feedback = feedbackByMemory.get(memoryId);
      if (!feedback || feedback.useful === null) continue; // no judgement -> unlabeled
      if (feedback.useful === true) {
        labels[memoryId] = 2;
      } else if (feedback.reason !== "redundant") {
        // useful=false, reason irrelevant | incorrect | other | null -> tier-1 negative (PHASE_2_SPEC.md 2.3)
        labels[memoryId] = 0;
      }
      // reason === "redundant": redundancy relation, NOT evidence the memory is false -- neither grade applied.
    }

    if (evalMemories.length === 0) continue; // every included memory was archived/purged since delivery

    examples.push(
      EvalExampleSchema.parse({
        id: contextEvent.id,
        task: retrievalEvent.queryText,
        scope: contextEvent.scope,
        memories: evalMemories,
        labels,
        redundantWith: {},
        notes:
          `exported from contextEvent ${contextEvent.id}` +
          (contextEvent.taskId ? `, taskId ${contextEvent.taskId}` : ""),
        outcome: outcomeForDelivery?.outcome ?? null,
      }),
    );
  }

  return examples;
}
```

- [ ] **Step 4: Export from the package index**

`packages/evaluation/src/index.ts` — add `export * from "./export.js";`.

- [ ] **Step 5: Run the full suite**

Run: `npm run typecheck && npm run build && npm test` (in `packages/evaluation`, then full monorepo)
Expected: PASS. 8 new tests (340 total).

- [ ] **Step 6: Commit**

```bash
git add packages/evaluation/src/types.ts packages/evaluation/src/export.ts packages/evaluation/src/export.test.ts packages/evaluation/src/index.ts
git commit -m "feat(2C-002): exportFromEvents -- replayable examples from correlated real events"
```

---

### Task 8: Redundancy evaluation gate — threshold sweep + A′ vs C′ comparison (2C-004/2C-006)

**Files:**
- Modify: `packages/evaluation/package.json`
- Create: `packages/evaluation/src/redundancy-gate.test.ts`

**Interfaces:**
- Consumes: everything from Tasks 1-6 (`findSimilarPairs`, `getRedundancyPairs`, `compileContext` redundancy demotion, `computeEfficiencyMetrics`), plus `@brain/context` (`compileContext`) and `@brain/token` (`optimizeContext`, `estimateTokens`) as new test-only devDependencies.
- Produces: no new production exports — this is entirely a test/report file, matching the established `gate.test.ts` pattern (constructs the pipeline directly, bypasses `Gateway`, since evaluation cares about the ranking/context pipeline, not telemetry).

- [ ] **Step 1: Add devDependencies**

`packages/evaluation/package.json` — modify `devDependencies`:

```json
  "devDependencies": {
    "@brain/context": "0.1.0",
    "@brain/ranking": "0.1.0",
    "@brain/retrieval": "0.1.0",
    "@brain/storage": "0.1.0",
    "@brain/test-fixtures": "0.1.0",
    "@brain/token": "0.1.0",
    "@types/better-sqlite3": "^7.6.12",
    "better-sqlite3": "^13.0.3"
  }
```

Run: `npm install` at the repo root (workspaces re-link).

- [ ] **Step 2: Write the threshold-sweep / detection-accuracy tests**

`packages/evaluation/src/redundancy-gate.test.ts` — Part 1 (threshold sweep, addresses acceptance criteria 6-7):

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { Candidate, EvalExample, RankedResult, ScopeRef } from "@brain/contracts";
import { globalScope, projectScope } from "@brain/contracts";
import { rank } from "@brain/ranking";
import { RetrievalService } from "@brain/retrieval";
import { compileContext } from "@brain/context";
import { optimizeContext, estimateTokens } from "@brain/token";
import { openDatabase, SqliteMemoryRepository, SqliteRetrievalStore } from "@brain/storage";
import { FakeEmbeddingProvider } from "@brain/test-fixtures";
import { loadDataset } from "./dataset.js";
import { computeEfficiencyMetrics, type DeliveredItemMeasurement } from "./efficiency.js";

const DATASET = join(dirname(fileURLToPath(import.meta.url)), "..", "datasets", "phase1-realworld.jsonl");
const CANDIDATE_LIMIT = 50;

interface Seeded {
  db: ReturnType<typeof openDatabase>;
  retrievalService: RetrievalService;
  keyById: Map<string, string>;
  idByKey: Map<string, string>;
  close: () => void;
}

async function seed(example: EvalExample): Promise<Seeded> {
  const db = openDatabase(":memory:");
  const embeddings = new FakeEmbeddingProvider();
  const repo = new SqliteMemoryRepository(db.raw, embeddings);
  const store = new SqliteRetrievalStore(db.raw, embeddings, db.vectorSearchAvailable);
  const keyById = new Map<string, string>();
  const idByKey = new Map<string, string>();

  for (const memory of example.memories) {
    const record = await repo.create({ type: memory.type, content: memory.content, scope: memory.scope, confidence: memory.confidence });
    keyById.set(record.id, memory.key);
    idByKey.set(memory.key, record.id);
  }

  return { db, retrievalService: new RetrievalService(store), keyById, idByKey, close: () => db.close() };
}

async function rankedFor(seeded: Seeded, example: EvalExample): Promise<RankedResult[]> {
  const candidates: Candidate[] = await seeded.retrievalService.getCandidates({ text: example.task, scope: example.scope, limit: CANDIDATE_LIMIT });
  return rank({ candidates, task: example.task });
}

// --- Part 1: threshold sweep, using FakeEmbeddingProvider (deterministic,
// network-free -- the DEFAULT test suite). Real-model values (0.785/0.518)
// are validated separately, in packages/storage's integration-only suite
// (Task 9), since FakeEmbeddingProvider's trigram-hash similarity operates on
// a different numeric scale than the real model (spiked and confirmed: the
// known pair scores ~0.57 under the fake vs ~0.785 under the real model).

// Starts at 0.4, deliberately above the measured distinct-pair ceiling
// (notes-repo-constraint scores 0.3473-0.3506 against either plural rule
// under FakeEmbeddingProvider -- spiked and confirmed). A lower starting
// value would make the distinctPairFound assertion below fail by
// construction, not reveal a real defect.
const THRESHOLDS = [0.4, 0.45, 0.5, 0.55, 0.6, 0.7, 0.8];

test("threshold sweep: notes-api-db-refactor -- known redundant pair vs distinct repository/database knowledge", async () => {
  const example = loadDataset(DATASET).find((e) => e.id === "notes-api-db-refactor");
  assert.ok(example);
  const seeded = await seed(example);
  try {
    const rankedResults = await rankedFor(seeded, example);
    const redundantKey = "global-plural-rule";
    const subsumingKey = "notes-plural-rule";
    const distinctKey = "notes-repo-constraint";

    const report: { threshold: number; redundantPairFound: boolean; distinctPairFound: boolean }[] = [];
    for (const threshold of THRESHOLDS) {
      const pairs = await seeded.retrievalService.getRedundancyPairs(rankedResults, threshold);
      const named = pairs.map((p) => [seeded.keyById.get(p.a), seeded.keyById.get(p.b)]);
      report.push({
        threshold,
        redundantPairFound: named.some(([a, b]) => (a === subsumingKey && b === redundantKey) || (a === redundantKey && b === subsumingKey)),
        distinctPairFound: named.some(([a, b]) => [a, b].includes(distinctKey)),
      });
    }
    console.log("\nthreshold sweep (notes-api-db-refactor, FakeEmbeddingProvider):");
    for (const row of report) console.log(`  τ=${row.threshold}  redundantPairFound=${row.redundantPairFound}  distinctPairFalselyFlagged=${row.distinctPairFound}`);

    // The known pair must be detectable at SOME threshold in this range, and
    // the distinct memory must never be falsely collapsed into it at any
    // threshold in this range (acceptance criteria 6 and 7).
    assert.ok(report.some((r) => r.redundantPairFound), "no threshold in the sweep detected the known redundant pair");
    assert.ok(report.every((r) => !r.distinctPairFound), "a threshold in the sweep falsely flagged the distinct repository/database memory as redundant");
  } finally {
    seeded.close();
  }
});

test("threshold sweep: task-api-completed-filter -- the task-sqlite/task-express pair must not be falsely collapsed at the working threshold", async () => {
  // A tighter margin than notes-api-db-refactor (spiked: known pair ~0.60,
  // task-sqlite~task-express ~0.51 under FakeEmbeddingProvider) -- this
  // example specifically exercises acceptance criterion 7 at a realistic
  // margin, not just a wide one.
  const example = loadDataset(DATASET).find((e) => e.id === "task-api-completed-filter");
  assert.ok(example);
  const seeded = await seed(example);
  try {
    const rankedResults = await rankedFor(seeded, example);
    const pairs = await seeded.retrievalService.getRedundancyPairs(rankedResults, 0.55);
    const named = pairs.map((p) => [seeded.keyById.get(p.a), seeded.keyById.get(p.b)].sort());
    assert.ok(
      named.some(([a, b]) => a === "task-repo-constraint" && b === "task-repo-decision"),
      "the declared redundant pair (task-repo-decision -> task-repo-constraint) must be found at τ=0.55",
    );
    assert.ok(
      !named.some(([a, b]) => (a === "task-express" && b === "task-sqlite")),
      "task-sqlite/task-express are distinct memories (both graded 1, no redundantWith edge) and must not be flagged at τ=0.55",
    );
  } finally {
    seeded.close();
  }
});
```

Run: `npm run pretest` (in `packages/evaluation`) — expect this to fail (`RetrievalService.getRedundancyPairs` should already exist from Task 3, so this should actually PASS if Tasks 1-3 are correctly done — treat any failure here as a real regression to fix, not an expected red state, since this task builds on already-completed work).

Run: `npm test -- --test-name-pattern="threshold sweep"` (or the package's `test` script filtered) and inspect the printed sweep table to confirm the actual numbers before proceeding — this is empirical verification, not a placeholder assumption.

- [ ] **Step 3: Write the A′ vs C′ comparison + all remaining regressions**

`packages/evaluation/src/redundancy-gate.test.ts` — Part 2, appended to the same file:

```ts
// --- Part 2: A' vs C' -- ranking metrics unaffected, efficiency metrics compared.

const REDUNDANCY_THRESHOLD = 0.45; // mid-sweep value informed by Part 1 for THIS dataset/embedding provider; NOT the production default (see gateway.ts's DEFAULT_REDUNDANCY_THRESHOLD, tuned for the real model's scale).
const BUDGET = { maxTokens: 500 };

interface PipelineResult {
  rankedKeys: string[];
  delivered: DeliveredItemMeasurement[];
  candidateTokenCount: number | null;
}

async function runPipeline(seeded: Seeded, example: EvalExample, useRedundancy: boolean): Promise<PipelineResult> {
  const candidates = await seeded.retrievalService.getCandidates({ text: example.task, scope: example.scope, limit: CANDIDATE_LIMIT });
  const rankedResults = rank({ candidates, task: example.task });
  const redundancyPairs = useRedundancy ? await seeded.retrievalService.getRedundancyPairs(rankedResults, REDUNDANCY_THRESHOLD) : [];
  const compiled = compileContext({ task: example.task, scope: example.scope, rankedResults, redundancyPairs });
  const pack = optimizeContext(compiled, BUDGET);

  let candidateTokenCount: number | null = 0;
  for (const c of candidates) candidateTokenCount = candidateTokenCount === null ? null : candidateTokenCount + estimateTokens(c.record.content);

  const delivered: DeliveredItemMeasurement[] = pack.items.map((item) => {
    const key = seeded.keyById.get(item.memoryId) ?? item.memoryId;
    const grade = example.labels[key] ?? undefined;
    const label: DeliveredItemMeasurement["label"] =
      item.redundantWith !== undefined ? "redundant" : grade === undefined ? "unlabeled" : grade > 0 ? "useful" : "not_useful";
    return { memoryId: item.memoryId, tokenCount: estimateTokens(item.content), label };
  });

  return { rankedKeys: pack.items.map((i) => seeded.keyById.get(i.memoryId) ?? i.memoryId), delivered, candidateTokenCount };
}

test("C' ranking metrics do not materially regress vs A' -- same top-ranked key on every seed example", async () => {
  const examples = loadDataset(DATASET).filter((e) => !e.id.startsWith("isolation-"));
  for (const example of examples) {
    const seeded = await seed(example);
    try {
      const aPrime = await runPipeline(seeded, example, false);
      const cPrime = await runPipeline(seeded, example, true);
      assert.equal(cPrime.rankedKeys[0], aPrime.rankedKeys[0], `${example.id}: C' must not change the top-ranked item`);
    } finally {
      seeded.close();
    }
  }
});

test("no-redundancy regression: below-threshold candidate sets produce byte-identical delivered items between A' and C'", async () => {
  // A high enough threshold that nothing in this example is flagged -- proves
  // demoted-vs-not is the only degree of freedom redundancy adds, not a
  // general reordering.
  const example = loadDataset(DATASET).find((e) => e.id === "task-api-convention-check");
  assert.ok(example);
  const seeded = await seed(example);
  try {
    const candidates = await seeded.retrievalService.getCandidates({ text: example.task, scope: example.scope, limit: CANDIDATE_LIMIT });
    const rankedResults = rank({ candidates, task: example.task });
    const withoutPairs = compileContext({ task: example.task, scope: example.scope, rankedResults });
    const withEmptyPairs = compileContext({ task: example.task, scope: example.scope, rankedResults, redundancyPairs: [] });
    assert.deepEqual(withEmptyPairs, withoutPairs);
  } finally {
    seeded.close();
  }
});

test("global memory regression: task-api-convention-check still ranks the global rule first under C'", async () => {
  // Decision E9's forbidden rule ("project always beats global") would fail
  // this example under ANY redundancy configuration, since there is no
  // project rule to prefer over it.
  const example = loadDataset(DATASET).find((e) => e.id === "task-api-convention-check");
  assert.ok(example);
  const seeded = await seed(example);
  try {
    const cPrime = await runPipeline(seeded, example, true);
    assert.equal(cPrime.rankedKeys[0], "global-plural-rule");
  } finally {
    seeded.close();
  }
});

test("vector-degradation regression: findSimilarPairs unavailable degrades the whole pipeline to A', no error", async () => {
  const example = loadDataset(DATASET).find((e) => e.id === "notes-api-db-refactor");
  assert.ok(example);
  const db = openDatabase(":memory:");
  const embeddings = new FakeEmbeddingProvider();
  const repo = new SqliteMemoryRepository(db.raw, embeddings);
  const keyById = new Map<string, string>();
  for (const memory of example.memories) {
    const record = await repo.create({ type: memory.type, content: memory.content, scope: memory.scope, confidence: memory.confidence });
    keyById.set(record.id, memory.key);
  }
  // vectorSearchAvailable: false -- simulates sqlite-vec failing to load.
  const store = new SqliteRetrievalStore(db.raw, embeddings, false);
  const retrievalService = new RetrievalService(store);
  const candidates = await retrievalService.getCandidates({ text: example.task, scope: example.scope, limit: CANDIDATE_LIMIT });
  const rankedResults = rank({ candidates, task: example.task });
  const pairs = await retrievalService.getRedundancyPairs(rankedResults, REDUNDANCY_THRESHOLD);
  assert.deepEqual(pairs, []);
  const compiled = compileContext({ task: example.task, scope: example.scope, rankedResults, redundancyPairs: pairs });
  for (const item of compiled.items) assert.equal("redundantWith" in item, false);
  db.close();
});

test("CONSTRAINED BUDGET: the demoted member of the plural-rule pair is omitted under a tight budget, and reappears once budget is ample", async () => {
  // Deliberately does not assume WHICH of the two near-duplicate plural-rule
  // memories (project-scoped vs global) the corrected ranker places higher --
  // that depends on real lexical/semantic scores for this exact query text,
  // which this test does not hardcode a prediction for. It reads which one
  // toRedundancyPairs actually demoted from the compiler's own output, then
  // asserts the constrained-budget property on THAT outcome. Confirmed by
  // spike that a pair IS detected here at REDUNDANCY_THRESHOLD=0.45 (the two
  // plural-rule memories score 0.5745 under FakeEmbeddingProvider cosine vs
  // 0.35ish for either against the distinct constraint).
  const example = loadDataset(DATASET).find((e) => e.id === "notes-api-search-endpoint");
  assert.ok(example, "expects the 3-memory example: two near-duplicate plural-rule memories plus one distinct relevant memory");
  const seeded = await seed(example);
  try {
    const candidates = await seeded.retrievalService.getCandidates({ text: example.task, scope: example.scope, limit: CANDIDATE_LIMIT });
    const rankedResults = rank({ candidates, task: example.task });
    const redundancyPairs = await seeded.retrievalService.getRedundancyPairs(rankedResults, REDUNDANCY_THRESHOLD);
    const compiled = compileContext({ task: example.task, scope: example.scope, rankedResults, redundancyPairs });

    const distinctId = seeded.idByKey.get("notes-repo-constraint") as string;
    const demotedItem = compiled.items.find((i) => i.redundantWith !== undefined);
    assert.ok(demotedItem, "the two near-duplicate plural-rule memories must produce exactly one demotion at this threshold");
    const demotedId = demotedItem?.memoryId as string;
    const keptPluralRuleId = demotedItem?.redundantWith as string;
    assert.ok(
      [seeded.idByKey.get("notes-plural-rule"), seeded.idByKey.get("global-plural-rule")].includes(demotedId),
      "the demotion must be between the two plural-rule memories, not the distinct constraint",
    );

    const distinctCost = estimateTokens(compiled.items.find((i) => i.memoryId === distinctId)?.content ?? "");
    const keptCost = estimateTokens(compiled.items.find((i) => i.memoryId === keptPluralRuleId)?.content ?? "");
    const demotedCost = estimateTokens(demotedItem?.content ?? "");

    // Tight budget: fits exactly the two non-redundant items, not the third.
    const tight = optimizeContext(compiled, { maxTokens: distinctCost + keptCost });
    const tightIds = tight.items.map((i) => i.memoryId);
    assert.ok(tightIds.includes(distinctId), "distinct relevant memory must be included under a tight budget");
    assert.ok(tightIds.includes(keptPluralRuleId), "the higher-ranked plural-rule memory must be included under a tight budget");
    assert.ok(!tightIds.includes(demotedId), "the demoted plural-rule memory must be OMITTED before unique relevant context under a tight budget");

    // Ample budget: the demoted memory may appear again -- proving demoted != deleted.
    const ample = optimizeContext(compiled, { maxTokens: distinctCost + keptCost + demotedCost + 10 });
    assert.ok(ample.items.map((i) => i.memoryId).includes(demotedId), "the demoted memory must still be returned once budget is ample");
  } finally {
    seeded.close();
  }
});

/**
 * A' vs C' efficiency comparison. Deliberately does NOT hard-assert a
 * directional winner: P2-018 (PHASE_2_SPEC.md 20) treats "does C' actually
 * improve efficiency" as an empirical question whose answer decides whether
 * redundancy ships enabled -- "if B and C do not beat A', they ship
 * disabled... with the result recorded," not a property to bake into a
 * pass/fail gate before ever observing it. Two reasons a hard inequality
 * would be actively wrong here, not just unproven:
 *   1. Under A' (useRedundancy=false), no item is ever labeled "redundant"
 *      (item.redundantWith is never set) -- A' structurally always reports
 *      redundantRatio ~0/null, so "C' redundantRatio <= A' redundantRatio"
 *      does not test what it sounds like it tests.
 *   2. Under an AMPLE budget, both strategies deliver the same candidate SET
 *      (order/labels differ, membership does not), so contextEfficiency is
 *      often identical between them by construction -- any real effect is a
 *      CONSTRAINED-budget phenomenon (already isolated deterministically by
 *      the CONSTRAINED BUDGET test above).
 *
 * This test instead reports both budgets' real numbers (captured for
 * docs/PHASE_2C_FINDINGS.md, Task 9) and asserts only what is actually
 * guaranteed: the metrics are well-formed and the hand-labeled seed dataset
 * yields a near-complete labeledFraction.
 */
test("A' vs C' efficiency comparison over the seed dataset (ample and constrained budgets, reported)", async () => {
  const examples = loadDataset(DATASET).filter((e) => !e.id.startsWith("isolation-"));

  async function totals(budgetTokens: number, useRedundancy: boolean) {
    const delivered: DeliveredItemMeasurement[] = [];
    let candidateTokenTotal = 0;
    for (const example of examples) {
      const seeded = await seed(example);
      try {
        const candidates = await seeded.retrievalService.getCandidates({ text: example.task, scope: example.scope, limit: CANDIDATE_LIMIT });
        const rankedResults = rank({ candidates, task: example.task });
        const redundancyPairs = useRedundancy ? await seeded.retrievalService.getRedundancyPairs(rankedResults, REDUNDANCY_THRESHOLD) : [];
        const compiled = compileContext({ task: example.task, scope: example.scope, rankedResults, redundancyPairs });
        const pack = optimizeContext(compiled, { maxTokens: budgetTokens });
        for (const item of pack.items) {
          const key = seeded.keyById.get(item.memoryId) ?? item.memoryId;
          const grade = example.labels[key];
          const label: DeliveredItemMeasurement["label"] =
            item.redundantWith !== undefined ? "redundant" : grade === undefined ? "unlabeled" : grade > 0 ? "useful" : "not_useful";
          delivered.push({ memoryId: item.memoryId, tokenCount: estimateTokens(item.content), label });
        }
        for (const c of candidates) candidateTokenTotal += estimateTokens(c.record.content);
      } finally {
        seeded.close();
      }
    }
    return computeEfficiencyMetrics({ delivered, candidateTokenCount: candidateTokenTotal });
  }

  const ampleAPrime = await totals(2000, false);
  const ampleCPrime = await totals(2000, true);
  const constrainedAPrime = await totals(60, false); // 60: tight enough to force selection in every seed example
  const constrainedCPrime = await totals(60, true);

  console.log(`\nA' vs C' efficiency (seed dataset, τ=${REDUNDANCY_THRESHOLD}):`);
  console.log("  ample (2000 tok)      A'", JSON.stringify(ampleAPrime));
  console.log("  ample (2000 tok)      C'", JSON.stringify(ampleCPrime));
  console.log("  constrained (60 tok)  A'", JSON.stringify(constrainedAPrime));
  console.log("  constrained (60 tok)  C'", JSON.stringify(constrainedCPrime));

  for (const m of [ampleAPrime, ampleCPrime, constrainedAPrime, constrainedCPrime]) {
    assert.ok(m.labeledFraction !== null && m.labeledFraction > 0.9, "seed dataset is hand-labeled; labeledFraction should be near 1.0");
    if (m.contextEfficiency !== null) assert.ok(m.contextEfficiency >= 0 && m.contextEfficiency <= 1);
    if (m.redundantRatio !== null) assert.ok(m.redundantRatio >= 0 && m.redundantRatio <= 1);
    if (m.retrievalEfficiency !== null) assert.ok(m.retrievalEfficiency >= 0 && m.retrievalEfficiency <= 1);
  }
});
```

- [ ] **Step 4: Run and record the actual numbers**

Run: `npm run typecheck && npm run build && npm test` (in `packages/evaluation`, then full monorepo)
Expected: PASS. Capture the printed threshold-sweep table and the A′/C′ efficiency comparison — these real numbers go into `docs/PHASE_2C_FINDINGS.md` (Task 9), not fabricated or estimated.

Expected new test count: 8 (349 total in `packages/evaluation` + monorepo — exact count depends on how many examples the loops iterate; report the real number from the run, not this estimate).

- [ ] **Step 5: Commit**

```bash
git add packages/evaluation/package.json packages/evaluation/src/redundancy-gate.test.ts package-lock.json
git commit -m "test(2C-004/006): threshold sweep, A' vs C' comparison, constrained-budget and regression tests"
```

---

### Task 9: Real-model integration test, stopword audit, real-data report, final report

**Files:**
- Modify: `packages/storage/src/local-embedding-provider.test.ts`
- Create: `docs/PHASE_2C_FINDINGS.md`

**Interfaces:** none new — this task is verification, empirical write-up, and reporting.

- [ ] **Step 1: Real-model integration test for the empirical redundancy claim**

`packages/storage/src/local-embedding-provider.test.ts` — read the existing file first to match its exact current structure/imports, then append (this file is already excluded from the default `test` script and only runs via `npm run test:integration`, per the package's `package.json`):

```ts
test("integration: findSimilarPairs detects the known real-world redundant pair with the real embedding model", async () => {
  const db = openDatabase(":memory:");
  const embeddings = new LocalEmbeddingProvider();
  const repo = new SqliteMemoryRepository(db.raw, embeddings);
  const store = new SqliteRetrievalStore(db.raw, embeddings, db.vectorSearchAvailable);

  const constraint = await repo.create({
    type: "constraint",
    content: "notes-api: database access must go through the repository layer (NotesRepository interface); route handlers must never touch the database directly",
    scope: projectScope("notes-api"),
    confidence: 1,
  });
  const projectRule = await repo.create({
    type: "rule",
    content: "notes-api REST endpoints use plural resource names: /notes, /notes/:id (POST, GET, GET/:id)",
    scope: projectScope("notes-api"),
    confidence: 1,
  });
  const globalRule = await repo.create({
    type: "rule",
    content: "REST API resources should use plural nouns in endpoint paths, such as /tasks and /notes.",
    scope: globalScope(),
    confidence: 0.5,
  });

  const pairs = await store.findSimilarPairs([constraint.id, projectRule.id, globalRule.id], 0);
  const byPair = new Map(pairs.map((p) => [[p.a, p.b].sort().join(","), p.similarity]));
  const redundantSimilarity = byPair.get([projectRule.id, globalRule.id].sort().join(","));
  const distinctSimilarity1 = byPair.get([constraint.id, projectRule.id].sort().join(","));
  const distinctSimilarity2 = byPair.get([constraint.id, globalRule.id].sort().join(","));

  console.log(`\nreal-model similarity: project~global (known redundant) = ${redundantSimilarity}`);
  console.log(`real-model similarity: constraint~projectRule (distinct) = ${distinctSimilarity1}`);
  console.log(`real-model similarity: constraint~globalRule (distinct)  = ${distinctSimilarity2}`);

  assert.ok(redundantSimilarity !== undefined && redundantSimilarity > 0.7, `expected the known pair near PHASE_2_FINDINGS.md's 0.785, got ${redundantSimilarity}`);
  assert.ok((distinctSimilarity1 ?? 1) < (redundantSimilarity ?? 0), "the distinct constraint pair must score lower than the known redundant pair");
  assert.ok((distinctSimilarity2 ?? 1) < (redundantSimilarity ?? 0), "the distinct constraint pair must score lower than the known redundant pair");
  db.close();
});
```

Run: `npm run test:integration` (in `packages/storage`) — this downloads the ~90MB model on first run (network required, matching this file's existing documented exception to the local-first default). Record the ACTUAL similarity numbers printed — do not assume they exactly match 0.785/0.518 (the live corpus in `PHASE_2_FINDINGS.md` may have used slightly different content or a different corpus context); report what this run actually produces.

- [ ] **Step 2: Commit the integration test**

```bash
git add packages/storage/src/local-embedding-provider.test.ts
git commit -m "test(2C): integration test validating the real-model redundant-pair detection claim"
```

- [ ] **Step 3: Real-world data growth report**

Run a throwaway script (not committed) against the real `data/brain.db` if it exists at the repo root, adapting `SqliteEventStore`'s query results into the `EventTables`/`MemoryLookup` shapes `exportFromEvents` expects, then report the counts the spec requires. Example approach (adjust table/column names to match `packages/storage/migrations/0001_initial_schema.sql` / `0002_phase2_measurement.sql` exactly, and only run this if `data/brain.db` actually exists — check with `ls`/`Test-Path` first):

```bash
node -e "
const Database = require('better-sqlite3');
const db = new Database('data/brain.db', { readonly: true });
console.log('context_events (total):', db.prepare('SELECT COUNT(*) c FROM context_events').get().c);
console.log('context_events with feedback:', db.prepare(\`SELECT COUNT(DISTINCT c.id) c FROM context_events c JOIN feedback_events f ON f.context_id = c.id\`).get().c);
console.log('feedback useful=true:', db.prepare(\"SELECT COUNT(*) c FROM feedback_events WHERE useful = 1\").get().c);
console.log('feedback useful=false, reason=irrelevant:', db.prepare(\"SELECT COUNT(*) c FROM feedback_events WHERE useful = 0 AND reason = 'irrelevant'\").get().c);
console.log('feedback useful=false, reason=incorrect:', db.prepare(\"SELECT COUNT(*) c FROM feedback_events WHERE useful = 0 AND reason = 'incorrect'\").get().c);
console.log('feedback useful=false, reason=redundant:', db.prepare(\"SELECT COUNT(*) c FROM feedback_events WHERE useful = 0 AND reason = 'redundant'\").get().c);
console.log('outcomes by value:', db.prepare('SELECT outcome, COUNT(*) c FROM outcome_events GROUP BY outcome').all());
db.close();
"
```

Do NOT merge pre-Phase-2B context events (`task_id` populated but `context_id` never referenced by any feedback/outcome) into "correlated" counts — report them as a separate "historical/unlinked" figure. Record the real output in `docs/PHASE_2C_FINDINGS.md`.

- [ ] **Step 4: Stopword audit — write-up only, no fix**

Read `buildFtsQuery()` in `packages/storage/src/retrieval-store.ts` (unchanged by this plan) and confirm the behavior described in `PHASE_2_FINDINGS.md` §3.4: every whitespace-split token is OR'd into the FTS5 query unweighted, so near-universal terms (e.g. "the", "API") can pull weakly-related records into the candidate pool at a near-zero bm25 score. Write up:
- The exact mechanism (quote the function).
- Whether it affected any Task 8 threshold-sweep result (check: did any sweep example's candidate pool include a memory that only matched a stopword? Inspect the candidate lists captured in Task 8 if uncertain).
- A proposed `P2C-R1` task: stopword/near-universal-term filtering in `buildFtsQuery()`, scoped as a **separate, future, retrieval-quality task** — not implemented here, per the spec's explicit instruction to keep retrieval-candidate quality separate from context redundancy.

- [ ] **Step 5: Write `docs/PHASE_2C_FINDINGS.md`**

Use the exact section structure requested in `docs/PHASE_2C_SPEC.md`'s originating brief:

```
## PHASE 2C STATUS
## BASELINE
## FILES CHANGED
## EFFICIENCY METRICS
## EVENT EXPORT
## CURRENT CORRELATED DATASET SIZE
## E25 FINAL DECISION
## SIMILARITY INTERFACE
## VECTOR BOUNDARY
## REDUNDANCY DETECTION
## THRESHOLD EVALUATION
## REDUNDANCY CONTEXT BEHAVIOR
## CONSTRAINED-BUDGET RESULT
## GLOBAL MEMORY REGRESSION
## VECTOR-DEGRADATION RESULT
## A′ METRICS
## C′ METRICS
## TOKEN/CONTEXT EFFICIENCY COMPARISON
## LABELED FRACTION
## SCOPE REGRESSION
## STOPWORD RETRIEVAL FINDING
## TEST COUNTS
## COMMANDS
## RESULT
## RISKS
## LEARNING READINESS
## RECOMMENDED NEXT PHASE
```

Populate every section with REAL numbers/output from Steps 1-4 of this task and from Tasks 1-8's actual verification runs — never estimated or templated values. `LEARNING READINESS` answers "is there now empirical evidence historical usefulness should affect ranking?" against the actual correlated-corpus size found in Step 3 — "NO — still insufficient observations" is an acceptable, expected answer if the real corpus is still small (Phase 2A's audit found 5 feedback events total; Step 3 will show whether that has grown). `RECOMMENDED NEXT PHASE` proposes next steps (e.g., whether to enable redundancy by default given Task 8's comparison, whether `P2C-R1` is worth scheduling) without implementing any of them.

- [ ] **Step 6: Full final verification**

Run, in order, and capture exact output for the report:

```bash
npm run typecheck
npm run build
npm test
npm audit
```

Expected: all four PASS; test count is 292 (baseline) + all tests added across Tasks 1-8 (report the exact final number from the real run, not a projected sum). Confirm `npm audit` still reports 0 vulnerabilities (Task 8 added `@brain/context`/`@brain/token` as devDependencies — both are workspace-internal, so this should not change the audit result, but verify rather than assume).

Separately run `npm run test:integration` (in `packages/storage`) and report its result — this is the one network-requiring suite in this plan, reported separately per the spec's instruction.

- [ ] **Step 7: Commit the findings doc**

```bash
git add docs/PHASE_2C_FINDINGS.md
git commit -m "docs(2C): Phase 2C findings report -- efficiency, redundancy evaluation, stopword audit, learning readiness"
```

---

## Self-Review Notes

- **Spec coverage:** 2C-001 (Task 6), 2C-002 (Task 7), 2C-003/E25 (Task 1), 2C-004 (Task 3 + Task 8 Part 1), 2C-005 (Task 2 + Task 4), 2C-006 (Task 8 Part 2), stopword audit (Task 9 Step 4), real-data report (Task 9 Step 3), final report (Task 9 Step 5) — all covered.
- **Non-goal check:** no task touches `core/learning`, adds a usefulness store, or modifies `core/token`/`core/ranking`'s scoring formula. `Gateway`'s redundancy config defaults to disabled. Confirmed no task references `historicalUsefulness`/`RankingWeights.usefulness`.
- **Type consistency:** `SimilarityPair` (Task 1) is the one type threaded through `RetrievalStore.findSimilarPairs` (Task 1) → `toRedundancyPairs`/`getRedundancyPairs` (Task 3) → `CompileContextInput.redundancyPairs` (Task 2, consumed in Task 4) — same shape throughout, no renaming across tasks. `DeliveredItemMeasurement`/`EfficiencyMetrics` (Task 6) is consumed identically by Task 8's live-pipeline runner and is designed for Task 7's exported-data path even though this plan doesn't wire that second path together as a committed feature (left for the next phase, noted in the findings doc) — the pure function's shape doesn't presuppose either source.
- **No-placeholders check:** every step above has complete function bodies and real assertions; no "TODO"/"handle appropriately" remains.
