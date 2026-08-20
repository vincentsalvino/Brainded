# Phase 2C Findings — Efficiency Measurement + Redundancy-Aware Context Selection

Companion to `docs/PHASE_2C_SPEC.md`. Reports what Tasks 1-9 actually built and actually measured.
Every number below is either copied verbatim from a task's report/the controller's ledger
(`.superpowers/sdd/2026-08-20-phase-2c-efficiency-redundancy/progress.md`, `task-1-report.md`
through `task-8-report.md`) or produced by a command this task (Task 9) ran itself and is reported
here exactly as printed — nothing is estimated, templated, or projected.

---

## PHASE 2C STATUS

All 9 tasks complete. Final commit on this branch: `e059610` (Task 9 Step 2's integration-test
commit; this findings doc is committed separately, after this point, per Step 7). Full commit range
from baseline:

```
af8f881 Initial commit: Brain Phase 1 + Phase 2A + Phase 2B baseline
a4e0180 feat(2C): resolve E25 -- RetrievalStore.findSimilarPairs on both implementations
04a00f6 feat(2C): add CompileContextInput.redundancyPairs and ContextItem.redundantWith
190b8d2 feat(2C): P2-013 -- redundancy-pair computation in core/retrieval
4c7afca feat(2C): P2-014 -- redundancy demotion in core/context, core/token untouched
c1082d4 fix(2C-4): clarify keptMemoryIds check in comment, remove dual-signature overload in rankedResult helper
124e547 feat(2C): wire redundancy pairs into Gateway.getContext, disabled by default
57a98f2 fix(2C-5): topological build order in root package.json, gateway/mcp now build correctly
6402074 feat(2C-001): pure efficiency metrics -- contextEfficiency, redundantRatio, retrievalEfficiency, labeledFraction
0297782 feat(2C-002): exportFromEvents -- replayable examples from correlated real events
2f23a46 test(2C-002): clarify purge vs archive in exportFromEvents tests, add explicit archive-is-included assertion
c0262f5 test(2C-004/006): threshold sweep, A' vs C' comparison, constrained-budget and regression tests
e349563 test(2C-004/006): fix review findings -- de-tautologize no-redundancy regression, add A' control to constrained-budget test, tighten demotion assertions
e059610 test(2C): integration test validating the real-model redundant-pair detection claim
```

(Verified with `git log --oneline` at the time of writing; 14 commits including baseline.)

Redundancy-aware context selection is fully implemented and wired into `Gateway.getContext()`, but
**ships disabled by default** (`{ enabled: false, threshold: DEFAULT_REDUNDANCY_THRESHOLD }`, both
in `Gateway`'s constructor default and explicitly in `packages/mcp/src/bootstrap.ts`). See
`RECOMMENDED NEXT PHASE` for the enable/disable decision this doc informs but does not make.

## BASELINE

Verified at plan time (`docs/PHASE_2C_SPEC.md`), commit `af8f881`: 292 default tests, 292 pass, 0
fail. `npm run typecheck` PASS. `npm run build` PASS. `npm audit` 0 vulnerabilities.

Phase 2A evaluation (retained as historical control, `docs/PHASE_2C_SPEC.md`):

```
A:  MRR 0.889   NDCG@1 0.722
A': MRR 1.000   NDCG@1 1.000
```

Aggregate evaluation remains INDICATIVE due to small sample size (unchanged characterization
throughout Phase 2C -- the sample did not grow; see `CURRENT CORRELATED DATASET SIZE`).

## FILES CHANGED

`git diff --stat af8f881 HEAD` (run for this doc, includes Task 9's Step 1/2 integration-test
commit; does not yet include this findings doc itself, committed in Step 7):

```
 package-lock.json                                  |   2 +
 package.json                                       |   4 +-
 packages/core/context/src/compiler.test.ts         |  66 ++++
 packages/core/context/src/compiler.ts              |  40 ++-
 packages/core/contracts/src/context.ts             |   9 +
 packages/core/contracts/src/repositories.ts        |   8 +
 packages/core/contracts/src/shapes.test.ts         |  59 ++++
 packages/core/contracts/src/signals.ts             |  26 ++
 packages/core/retrieval/src/redundancy.test.ts     |  43 +++
 packages/core/retrieval/src/redundancy.ts          |  30 ++
 packages/core/retrieval/src/service.test.ts        |  24 +-
 packages/core/retrieval/src/service.ts             |  15 +-
 packages/core/test-fixtures/src/fake-retrieval-store.ts |  30 +-
 packages/core/test-fixtures/src/store-conformance.ts    | 108 +++++++
 packages/evaluation/package.json                   |   2 +
 packages/evaluation/src/efficiency.test.ts         |  71 +++++
 packages/evaluation/src/efficiency.ts              |  80 +++++
 packages/evaluation/src/export.test.ts             | 162 ++++++++++
 packages/evaluation/src/export.ts                  |  99 ++++++
 packages/evaluation/src/index.ts                   |   2 +
 packages/evaluation/src/redundancy-gate.test.ts    | 345 +++++++++++++++++++++
 packages/evaluation/src/types.ts                   |   9 +-
 packages/gateway/src/gateway.test.ts               |  71 ++++-
 packages/gateway/src/gateway.ts                    |  32 +-
 packages/mcp/src/bootstrap.ts                       |   4 +-
 packages/storage/src/local-embedding-provider.test.ts |  46 ++-
 packages/storage/src/retrieval-store.test.ts        |  11 +
 packages/storage/src/retrieval-store.ts             |  30 ++
 28 files changed, 1409 insertions(+), 19 deletions(-)
```

Two root-`package.json` build-order fixes are folded into this diff (Task 1: prepend
`@brain/contracts`; Task 5: full topological tier ordering) -- both were latent pre-existing bugs
in the workspace glob-order build scripts, surfaced by Phase 2C being the first work to introduce
new cross-package dependency edges from a genuinely clean build state. Neither changes production
behavior; both are build-orchestration only. `docs/PHASE_2C_FINDINGS.md` (this file) is the only
file this task creates.

## EFFICIENCY METRICS

2C-001, implemented in `packages/evaluation/src/efficiency.ts` (Task 6):

```
contextEfficiency   = usefulDeliveredTokens / deliveredTokens
redundantRatio       = redundantDeliveredTokens / deliveredTokens
retrievalEfficiency  = deliveredTokens / candidateTokenCount
labeledFraction      = labeledDeliveredItems / deliveredItems
```

`labeledFraction` is returned alongside `contextEfficiency`/`redundantRatio` on every call, never
separately. Any zero/unavailable denominator (zero delivered items, missing/zero
`candidateTokenCount`, any single delivered item with a null `tokenCount`) returns an explicit
`null` for the affected ratio(s) rather than a fabricated zero -- verified by 8 tests in
`efficiency.test.ts`, including the specific case "any delivered item with tokenCount null makes
deliveredTokens/contextEfficiency/redundantRatio unavailable, `labeledFraction` unaffected."
`redundantRatio` is accumulated from a distinct `"redundant"` label, never folded into
`"not_useful"` -- this distinction becomes directly relevant in `TOKEN/CONTEXT EFFICIENCY
COMPARISON` below. Package suite after Task 6: 31 tests (23 existing + 8 new); full monorepo: 333.

## EVENT EXPORT

2C-002, implemented in `packages/evaluation/src/export.ts` (Task 7):
`exportFromEvents(events, memories, options?)` reconstructs replayable `EvalExample[]` from real
correlated events, grouped by `ContextEvent.id` (never `taskId` -- verified by a test that
deliberately sets matching `taskId`s on two different context deliveries to prove `contextId` is
what's actually used):

```
RetrievalEvent → ContextEvent → ContextEventMemory[] → FeedbackEvent[] → OutcomeEvent?
```

Label rules (implemented exactly per spec):

```
useful=true                        → grade 2
useful=false + reason=irrelevant   → grade 0
useful=false + reason=incorrect    → grade 0
useful=false + reason=redundant    → excluded entirely (not grade 0, not grade 2)
no feedback                        → unlabeled, excluded from labels
```

Outcome is attached as example metadata only; it never labels an individual included memory. A
purged (hard-deleted) memory is skipped (content genuinely gone, cannot be replayed); an
**archived** (soft-deleted) memory is deliberately still exported with its label intact -- a fix
round (Task 7) added an explicit test proving this is intentional policy (a memory's current
archive status is orthogonal to whether the historical feedback judgment about its content was
genuine), not an accidental gap, after review found the original test's title overclaimed
"archived/purged" while only exercising purge.

**Known, documented, un-worked-around limitation:** `FeedbackEvent.reason === "redundant"` has no
structured field naming *which other memory* it was redundant with -- only free-text `notes`.
`exportFromEvents` therefore always produces `redundantWith: {}` on every exported example. Real
redundancy edges cannot be reconstructed from event history today; a structured
`FeedbackEvent.redundantWith` field would be required, and is out of scope for Phase 2C.

Package suite after Task 7's fix round: 40 tests (9 `exportFromEvents` tests + 31 pre-existing);
full monorepo: 342.

## CURRENT CORRELATED DATASET SIZE

**`data/brain.db` does not exist in this worktree** (confirmed: no `data/` directory at all --
`Test-Path`/`ls`/`Glob` all agree). This is a fresh/empty local-first install, not a data-loss
condition. Per this task's explicit instructions, the SQL report script in the brief's Step 3 was
**not run** against a nonexistent file, and no substitute/fake database was created -- the absence
itself is the finding.

There is therefore no "current" correlated dataset to report a live count for. The only available
reference point is historical, from **before** this worktree existed, measured against a copy of
the real `data/brain.db` at Phase 2A/2B audit time. Cross-checked across three independent sources
(all three agree):

- `docs/PHASE_2_FINDINGS.md` §4.1: `feedback_events 5 rows (task_id NOT NULL: 3)`, alongside
  `retrieval_events 13 rows`, `context_events 13 rows`, `outcome_events 4 rows`,
  `memory_mutation_events 10 rows`.
- `docs/PHASE_2_DECISIONS.md`: "there are **5 feedback events total**."
- `docs/PHASE_2_READINESS.md`: "10 memories, 13 retrieval events, 13 context events, 4 outcomes,
  and 5 feedback events survive" the Phase 2 measurement migration.

This is a **pre-Phase-2C, pre-worktree** data point cited for context only -- it is explicitly not
being reported as this install's current correlated dataset size, which is zero (no database file
exists to query). It also predates Phase 2B's `ContextEvent.contextId` correlation work becoming
fully load-bearing in production use, so even that historical 5-event figure would need re-querying
with the "historical/unlinked" split (pre-Phase-2B `task_id`-only rows vs. genuinely
`context_id`-correlated rows) the brief's Step 3 script is designed to compute, once a real
`data/brain.db` exists to run it against.

## E25 FINAL DECISION

Resolved (Task 1) exactly per `docs/PHASE_2C_SPEC.md` 2C-003's proposed shape, no naming changes
needed. Current interface (`packages/core/contracts/src/repositories.ts`):

```ts
/**
 * E25: pairwise similarity over an ALREADY scope-authorized set of memory
 * ids. Never returns a pair naming an id outside `memoryIds` -- this
 * function must not be able to widen scope, because it never receives one.
 * Vectors unavailable -> empty array, never a thrown error.
 */
findSimilarPairs(memoryIds: string[], minSimilarity: number): Promise<SimilarityPair[]>;
```

Implemented on both `RetrievalStore` implementations: `SqliteRetrievalStore` (cosine similarity via
`sqlite-vec`'s `vec_distance_cosine`, self-join over `memory_vectors`, `x.memory_id < y.memory_id`
to avoid duplicate pairs) and `FakeRetrievalStore` (Jaccard word-overlap over content strings --
fixture-quality, not a cosine stand-in, matching the existing `semanticSearch` fixture philosophy).

One real design decision was made during review (fix round 1, Task 1): the original implementation
wrapped the SQL query in a broad `try/catch` that swallowed **any** SQL error (not just the
"vectors unavailable" case) and returned `[]`. The reviewer found this contradicted the file's own
pre-existing doc comment ("Neither method catches its own failures -- degradation policy [...]
belongs to the caller") and the codebase's stated philosophy of propagating unexpected errors
loudly. The
`try/catch` was removed; the existing `!this.vectorSearchAvailable` guard clause alone satisfies
E25's actual requirement. Any other error (a genuine SQL/schema bug) now propagates uncaught,
matching `semanticSearch`'s pattern in the same file exactly.

## SIMILARITY INTERFACE

`packages/core/contracts/src/signals.ts`:

```ts
export const SimilarityPairSchema = z
  .object({
    a: z.string().uuid(),
    b: z.string().uuid(),
    similarity: z.number().min(-1).max(1),
  })
  .strict();
export type SimilarityPair = z.infer<typeof SimilarityPairSchema>;
```

`sortSimilarityPairs()` provides deterministic ordering (similarity descending, then `a` ascending,
then `b` ascending) so neither caller nor test ever has to re-sort. Both `RetrievalStore`
implementations are required to (and, per conformance tests, do) return output in this order.

## VECTOR BOUNDARY

Verified directly from source, not assumed: `SimilarityPair` carries only two UUIDs and a bounded
number. No `sqlite-vec` type, no raw embedding, and no model-specific dimension count appears
anywhere in `@brain/contracts`. Raw vectors stay inside `packages/storage`; `core/retrieval` (and
everything above it) receives only memory IDs and a similarity scalar. `findSimilarPairs` is
deterministic (sorted output, conformance-tested), local-first (no network call; `sqlite-vec` runs
in-process), and degrades to an empty array -- never a failed request -- when vectors are
unavailable (`vectorSearchAvailable = false` guard, exercised by both a dedicated storage
degradation test and Task 8's end-to-end vector-degradation regression test).

## REDUNDANCY DETECTION

P2-013 (spec §2C-004), implemented in `packages/core/retrieval/src/redundancy.ts` + `service.ts`
(Task 3), split pure/IO:

- `toRedundancyPairs()` (pure): re-orients raw `{a, b, similarity}` triples from
  `RetrievalStore.findSimilarPairs` so `a` is always the higher-ranked (lower `.rank` number)
  member; drops any pair naming a memoryId absent from the current `rankedResults`; returns sorted
  output. This orientation guarantee (the higher-ranked member is never the demoted side) is later
  relied on architecturally by `core/context`'s demotion logic and is not a coincidence -- confirmed
  by both the controller's and Task 4's reviewer's independent hand-traces.
- `RetrievalService.getRedundancyPairs(rankedResults, minSimilarity)` (IO boundary): early-returns
  `[]` for fewer than 2 ranked results (no store call at all in that case -- this early exit later
  mattered for a real test-validity bug found in Task 5, see `VECTOR-DEGRADATION RESULT`); otherwise
  calls `store.findSimilarPairs()` and delegates re-orientation to `toRedundancyPairs()`. Does no
  vector math itself.

## THRESHOLD EVALUATION

2C-004 requires testing candidate thresholds over a reasonable range rather than hardcoding the
spec's one historical datapoint (cosine 0.785 for the known redundant pair, 0.518 for the
next-nearest distinct memory). Task 8's sweep, run against the seed dataset's
`notes-api-db-refactor` example under `FakeEmbeddingProvider` (the default, network-free test
provider -- real-model numbers are reported separately below):

```
threshold sweep (notes-api-db-refactor, FakeEmbeddingProvider):
  τ=0.4  redundantPairFound=true  distinctPairFalselyFlagged=false
  τ=0.45  redundantPairFound=true  distinctPairFalselyFlagged=false
  τ=0.5  redundantPairFound=true  distinctPairFalselyFlagged=false
  τ=0.55  redundantPairFound=true  distinctPairFalselyFlagged=false
  τ=0.6  redundantPairFound=false  distinctPairFalselyFlagged=false
  τ=0.7  redundantPairFound=false  distinctPairFalselyFlagged=false
  τ=0.8  redundantPairFound=false  distinctPairFalselyFlagged=false
```

Under the fake provider's similarity scale, the known pair scores in **[0.55, 0.6)**; the distinct
memory (repository/database constraint) is never falsely flagged at any swept threshold (0.4-0.8),
consistent with it scoring below 0.4 (never independently re-derived to a specific value above that
floor -- only confirmed `< 0.4`, per Task 8's own self-correction of an earlier overclaimed "~0.35"
comment). A second sweep example (`task-api-completed-filter`, single threshold τ=0.55) confirmed
the declared pair is found and the two genuinely-distinct stack-decision memories are not falsely
flagged. No threshold value the brief guessed needed adjustment against the real pipeline output.

**Production default vs. test threshold, reconciled here for the first time:** the fake-provider
sweep and the production `DEFAULT_REDUNDANCY_THRESHOLD = 0.75` (`gateway.ts`) are calibrated on
different similarity scales and must not be compared directly -- `redundancy-gate.test.ts` uses its
own `REDUNDANCY_THRESHOLD = 0.45` for the fake provider, explicitly commented "NOT the production
default." The production default of 0.75 was chosen from the spec's one real-model datapoint
(0.785 known-pair / 0.518 distinct-pair) with margin on both sides. **This task's Step 1 real-model
integration test (see below) is the first independent re-measurement of that datapoint on
different content**, and confirms 0.75 still separates the known pair from both distinct pairs
measured: known-redundant 0.804 (above 0.75, correctly detected), distinct pairs 0.542 and 0.367
(both below 0.75, correctly not flagged). Still one corpus (now two independent examples across
Phase 2 and Phase 2C) -- not a basis for claiming a statistically optimal threshold, per the spec's
explicit caveat.

## REDUNDANCY CONTEXT BEHAVIOR

2C-005, implemented in `packages/core/context/src/compiler.ts` (Task 4). `compileContext()` remains
pure (no storage/vector/model access); it receives precomputed `redundancyPairs` and separates
output into `nonRedundant` then `redundant` groups, preserving relative rank order within each
group, returning `[...nonRedundant, ...redundant]`. Absent `redundancyPairs` produces byte-identical
output to pre-Phase-2C behavior (explicitly tested).

A real bug in the **plan's own given code** (not the implementer's) was found and independently
fixed during Task 4: the brief's literal code marked an item `redundantWith` whenever
`redundantWithById.get(memoryId)` was defined, without checking whether the referenced (`a`-side)
memory itself survived exact-content dedup. For a pair naming a dedup-dropped memory as the `a`
side, this would incorrectly mark the `b`-side item as "redundant with a vanished id," failing the
brief's own test assertion. Fixed with a `keptMemoryIds` set gating the lookup
(`keptMemoryIds.has(redundantWith)`), verified correct by both the controller and Task 4's reviewer,
whose correctness precondition (`a` is always visited before `b`) is the architectural guarantee
from `toRedundancyPairs`'s re-orientation, confirmed above under `REDUNDANCY DETECTION`. A
subsequent fix round corrected a stale comment that (before the fix) still denied this special case
existed, directly above the code implementing it -- a real regression hazard for a future reader,
now corrected to explain why the guard is necessary.

## CONSTRAINED-BUDGET RESULT

2C-006's constrained-budget acceptance test (Task 8, `notes-api-search-endpoint` example: two
near-duplicate plural-rule memories + one distinct relevant memory). Result: under a tight budget
sized to fit exactly the two non-redundant items, the demoted plural-rule memory is omitted and the
distinct + higher-ranked plural-rule memories are both included; under an ample budget (tight budget
+ the demoted item's own cost + margin), the demoted memory reappears -- proving demoted is not
deleted.

A fix round added an **A′ control**, run without any redundancy logic at the identical tight budget,
to isolate whether the omission is actually *caused* by demotion or merely coincidental with natural
rank order. Empirical result across independent runs (memory UUIDs differ per run;
`FakeEmbeddingProvider`'s pairing itself is deterministic): A′'s tight-budget set and C′'s tight-
budget set **share the same first (rank-1) item but diverge on the second slot, in both recorded
runs** (e.g. one run: `A' tight: 42dce3a5...,3738c0d5...` vs `C' tight: 42dce3a5...,bd137485...`).
This confirms
demotion does real causal work in this example, not just reproducing what natural rank order would
already have produced.

## GLOBAL MEMORY REGRESSION

2C-005's explicit non-goal ("no rule equivalent to 'project always beats global'") is checked at two
independent points, both currently passing:

- Pre-existing, Phase-2C-untouched `packages/evaluation/src/gate.test.ts`: `"P2-009: A' does not win
  by demoting global knowledge"` -- `task-api-convention-check` (no project-level naming rule
  exists, so the global rule is the only correct answer) still ranks the global rule first under A′.
- Task 8's own `"global memory regression: task-api-convention-check still ranks the global rule
  first under C'"` -- the same example, run through the full redundancy-aware C′ pipeline, confirms
  `compileContext`'s output still ranks `global-plural-rule` first even with redundancy enabled at
  the test threshold.

Both are real per-item assertions (not `.some(...)`-style existence checks), and both are part of
the 350-test suite this task independently re-ran in `TEST COUNTS`/`COMMANDS` below.

## VECTOR-DEGRADATION RESULT

2C-006's vector-degradation regression is verified at two layers:

- **Store layer** (Task 1): a dedicated `SqliteRetrievalStore` degradation test asserts
  `findSimilarPairs` returns `[]`, not an error, when `vectorSearchAvailable = false`.
- **Full pipeline** (Task 8): `"vector-degradation regression: findSimilarPairs unavailable degrades
  the whole pipeline to A', no error"` -- constructs a store with `vectorSearchAvailable = false`,
  confirms `getRedundancyPairs` returns `[]`, and confirms every compiled item has no
  `redundantWith` key set (guarded against a vacuous pass by asserting the example's 3 memories
  actually reach the compiler).
- **Gateway layer** (Task 5): a *different* failure mode -- `findSimilarPairs` throwing rather than
  degrading structurally -- is caught by `Gateway.getContext`'s own try/catch around
  `getRedundancyPairs`, logging a warning and continuing without redundancy data rather than failing
  the request. This test required a real fix during Task 5: the brief's original single-record seed
  data never actually reached the throwing store, because `getRedundancyPairs`'s
  `rankedResults.length < 2` early exit (see `REDUNDANCY DETECTION`) fired first, making the test
  vacuously pass regardless of whether the catch worked. Fixed by seeding a second matching record;
  the resulting stack trace (`ThrowingRetrievalStore.findSimilarPairs -> RetrievalService.
  getRedundancyPairs -> Gateway.getContext`) confirms the catch path is genuinely exercised.

## A′ METRICS

From Task 8's A′ vs C′ efficiency comparison (seed dataset, real numbers, `packages/evaluation/src/
redundancy-gate.test.ts`, unchanged across both the initial run and the post-fix-round re-run):

```
ample (2000 tok)      A' {"contextEfficiency":0.6572104018912529,"redundantRatio":0,"retrievalEfficiency":1,"labeledFraction":1,"deliveredItems":14,"labeledDeliveredItems":14,"deliveredTokens":423}
constrained (60 tok)  A' {"contextEfficiency":0.7366071428571429,"redundantRatio":0,"retrievalEfficiency":0.5295508274231678,"labeledFraction":1,"deliveredItems":9,"labeledDeliveredItems":9,"deliveredTokens":224}
```

`redundantRatio` is structurally 0 under A′ at every budget -- no item is ever labeled `"redundant"`
without redundancy detection running.

## C′ METRICS

Same run, same dataset, same budgets, redundancy enabled at τ=0.45 (the fake-provider test
threshold, not the production default -- see `THRESHOLD EVALUATION`):

```
ample (2000 tok)      C' {"contextEfficiency":0.5295508274231678,"redundantRatio":0.2718676122931442,"retrievalEfficiency":1,"labeledFraction":1,"deliveredItems":14,"labeledDeliveredItems":14,"deliveredTokens":423}
constrained (60 tok)  C' {"contextEfficiency":0.8348214285714286,"redundantRatio":0.03125,"retrievalEfficiency":0.5295508274231678,"labeledFraction":1,"deliveredItems":9,"labeledDeliveredItems":9,"deliveredTokens":224}
```

`labeledFraction` is 1.0 in all four A′/C′ cells -- the seed dataset is fully hand-labeled, so this
figure describes the synthetic evaluation corpus, not the real production corpus (which has no
labeled data available at all right now -- see `CURRENT CORRELATED DATASET SIZE` and
`LEARNING READINESS`).

## TOKEN/CONTEXT EFFICIENCY COMPARISON

The directional effect **flips between budgets** -- a real, reported (not hard-asserted) empirical
result, exactly the kind of structural possibility the implementation's own docstring anticipated
before the numbers were known:

- **Ample budget (2000 tok):** C′ delivers the identical token count (423) and identical candidate
  *membership* as A′ (`retrievalEfficiency` both 1.0) -- but `contextEfficiency` is *lower* for C′
  (0.530 vs 0.657) with `redundantRatio` 0.272. This is an accounting artifact, not evidence C′ is
  worse: a demoted item that is otherwise useful (grade > 0) gets relabeled `"redundant"` instead of
  `"useful"`, so its tokens stop counting toward `contextEfficiency`'s numerator even though nothing
  was actually omitted from delivery. `redundantRatio` being tracked as its own label (not folded
  into "not useful") is deliberate per `efficiency.ts`'s own design -- see `EFFICIENCY METRICS`.
- **Constrained budget (60 tok):** the case where demotion actually changes *membership*, not just
  labels. C′ **wins**: `contextEfficiency` 0.835 vs A′'s 0.737 (~10-point real improvement) --
  the demoted (lower-value, redundant) item loses its budget slot to something else that fits.
  `redundantRatio` drops to 0.031 (most redundant content is not delivered under this budget at
  all, unlike the ample case).
- `retrievalEfficiency` is identical between A′/C′ within each budget level in this run -- a
  property of this dataset's token-cost distribution, not a general guarantee.

**Ranking-side check performed (2C-006's other required comparison):** Task 8 verified a narrower,
real proxy rather than recomputing full Precision@K/Recall@K/MRR/NDCG@K for C′ --
`"C' ranking metrics do not materially regress vs A' -- same top-ranked key on every seed
example"`, run across every non-isolation seed example, plus the two per-example regression tests
above (`no-redundancy regression`, `global memory regression`). Full formal IR-metric recomputation
for C′ (beyond the Phase 2A A/A′ baseline already on record) was not performed in Phase 2C and would
be a reasonable, explicitly-scoped follow-up if redundancy ships enabled.

## LABELED FRACTION

Two separate populations, not to be conflated:

- **Seed evaluation dataset** (hand-labeled, synthetic, used for all of Task 8's sweep/comparison
  numbers above): `labeledFraction = 1.0` in every measured cell.
- **Real production corpus:** cannot currently be computed at all -- `data/brain.db` does not exist
  in this worktree (`CURRENT CORRELATED DATASET SIZE`). The last real measurement on record (pre-
  Phase-2C, pre-worktree) was 5 feedback events against 13 context events, i.e. a small fraction of
  deliveries carrying any explicit label even before considering per-item (rather than per-context)
  granularity.

## SCOPE REGRESSION

2C-003's scope constraint ("similarity comparison operates ONLY on already-authorized candidates...
redundancy logic must never widen scope") and acceptance criterion 5 ("scope isolation remains
unchanged") are checked at three independent points, all currently passing (see `TEST COUNTS`):

- `findSimilarPairs`'s own conformance test, run against both store implementations (Task 1):
  `"never returns a pair naming an id outside the requested set"`.
- Pre-existing, Phase-2C-untouched `gate.test.ts`: `"P2-009: scope isolation holds under both
  strategies"`, run against the two `isolation-*` dataset examples (`isolation-notes-vs-task`,
  `isolation-task-vs-notes`) -- another scope's record is never returned by either strategy A or A′.
- Structural: `getRedundancyPairs` only ever receives `rankedResults`, which is itself already the
  output of scope-filtered retrieval + ranking -- redundancy computation has no path to introduce a
  candidate that scope authorization did not already admit.

No task in Phase 2C modified `gate.test.ts` or the scope-authorization code path
(`scopeWhere()`/`whereClauses()` in `retrieval-store.ts`); this section reports that the
pre-existing regression continues to hold, not a new test.

## STOPWORD RETRIEVAL FINDING

Audit only, per the spec's explicit instruction ("do NOT silently solve this inside redundancy
work"). No production code was touched for this section.

**Mechanism** -- `buildFtsQuery()`, `packages/storage/src/retrieval-store.ts:72-78`, quoted verbatim
and confirmed unchanged by this entire plan:

```ts
function buildFtsQuery(text: string): string {
  const terms = text
    .split(/\s+/)
    .map((t) => t.replace(/"/g, '""'))
    .filter((t) => t.length > 0);
  return terms.length === 0 ? '""' : terms.map((t) => `"${t}"`).join(" OR ");
}
```

Every whitespace-split token is OR'd into the FTS5 MATCH query, unweighted -- no stopword list, no
term-frequency/near-universal-term down-weighting. This is exactly the behavior
`PHASE_2_FINDINGS.md` §3.4 described and confirmed still present.

**Does it affect any Task 8 threshold-sweep or A′/C′ result?** Checked directly, not assumed. Task
8's `notes-api-db-refactor` example uses the task text `"Refactor the database layer without
changing API behavior."` -- the identical string `PHASE_2_FINDINGS.md` §3.4 used as its own worked
example, so the same near-universal terms ("the", "API") appear in the FTS query here too. Tracing
each seeded memory's content: the two plural-rule memories (`notes-plural-rule`, `global-plural-
rule` -- the exact pair this entire spec's central redundancy example is built around) contain
neither `"database"` nor `"the"`; their *only* lexical-channel match is the substring token `"api"`
(from `"notes-api"` and `"REST API"`), i.e. exactly the stopword-pollution pattern being audited,
not a genuine relevance signal.

However, this did **not** change Task 8's actual candidate pool or reported numbers, for a
structural reason specific to these tests: `RetrievalService.getCandidates` unions lexical and
semantic results (`mergeCandidates`, pure union on `memoryId`), and `SqliteRetrievalStore.
semanticSearch` performs a pure top-K nearest-neighbor query with `overFetch = max(limit * 5, 50)`
(here, `limit=50` → `overFetch=250`) and **no similarity floor** -- every memory in these small,
hand-seeded per-example test databases (3-5 memories each) is returned by the semantic channel
regardless of lexical relevance, since 250 comfortably exceeds the entire corpus size. The union
therefore already contained every seeded memory before the lexical channel's stopword match was
even considered. **At production scale (a real corpus larger than the semantic overFetch limit),
this would not hold** -- the lexical channel's contribution to candidate-pool composition becomes
load-bearing once the semantic channel can no longer trivially return everything, and the stopword
pollution would then have a real, not merely theoretical, effect on which memories reach the
ranker/redundancy stage at all. This is a genuine, currently-latent risk, not a non-issue.

**Proposed follow-up task, `P2C-R1`** (not implemented here, per the spec's explicit instruction to
keep retrieval-candidate quality separate from context redundancy): filter or down-weight stopword/
near-universal-term matches in `buildFtsQuery()` (or equivalently, treat a bm25 score near zero as
"matched a near-universal term," not "relevant," at the `lexicalSearch` consumption site) --
scoped as a standalone retrieval-quality task, evaluated against a corpus large enough for the
lexical channel's candidate-pool contribution to actually matter (see above), not against these
Phase 2C seed examples where the effect is currently masked.

## TEST COUNTS

| Point | Suite | Tests | Source |
|---|---|---|---|
| Baseline (`af8f881`) | full monorepo | 292 | `docs/PHASE_2C_SPEC.md`; ledger header |
| Task 1 (E25) | full monorepo | 308 | `task-1-report.md` (post-fix-round) |
| Task 2 (context contracts) | full monorepo | 311 | `progress.md` |
| Task 3 (redundancy-pair computation) | full monorepo | 317 | `progress.md`; `task-3-report.md` |
| Task 4 (redundancy demotion) | full monorepo | 322 | `progress.md`; `task-4-report.md` |
| Task 5 (Gateway wiring) | full monorepo | 325 | `task-5-report.md` |
| Task 6 (efficiency metrics) | full monorepo | 333 | `task-6-report.md` |
| Task 7 (`exportFromEvents`, post-fix-round) | full monorepo | 342 | `task-7-report.md` |
| Task 8 (threshold sweep / A′-C′, post-fix-round) | full monorepo | 350 | `task-8-report.md`; `progress.md` |
| **Task 9 (this task), fresh `npm test` run** | full monorepo | **350** | this task, Step 6, real run |
| **Task 9, fresh `npm run test:integration` run** | storage-only, network | **3** | this task, Steps 1 and 6, real runs |

The default `npm test` count is unchanged at 350 between Task 8 and Task 9: the new real-model
integration test lives in `local-embedding-provider.test.ts`, which `packages/storage/package.json`
deliberately excludes from its default `"test"` script (only `"test:integration"` runs it) -- so it
adds 1 test to the network-requiring suite, 0 to the default suite, exactly as designed.

## COMMANDS

Run from the repo root, in order, for this task's Step 6 (a fresh verification, independent of
Tasks 1-8's own per-task verifications):

```
npm run typecheck
npm run build
npm test
npm audit
```

Then, separately, from `packages/storage`:

```
npm run test:integration
```

## RESULT

All commands PASS, real exit code 0 for every one, captured directly (not inferred) by this task:

- `npm run typecheck` -- PASS, 0 errors, all 14 workspaces.
- `npm run build` -- PASS, 0 errors, all workspaces built.
- `npm test` -- **350/350 passing, 0 failing**, across 14 workspace test suites (evaluation 48,
  gateway 33, knowledge 9, mcp 20, storage 51, compression 7, context 28, contracts 53, learning 2,
  memory 1, ranking 23, retrieval 26, test-fixtures 23, token 26).
- `npm audit` -- **0 vulnerabilities**. `@brain/context`/`@brain/token` were added as test-only
  `devDependencies` of `@brain/evaluation` in Task 8; both are workspace-internal packages, and the
  audit result is unchanged, confirmed rather than assumed.
- `npm run test:integration` (packages/storage) -- **3/3 passing, 0 failing**. Includes this task's
  new real-model redundant-pair test; see `THRESHOLD EVALUATION` for the printed similarity values
  (0.804 known-redundant, 0.542 and 0.367 distinct) and their reconciliation against the production
  `DEFAULT_REDUNDANCY_THRESHOLD = 0.75`.

Acceptance criteria 1-13 (`docs/PHASE_2C_SPEC.md`) are each addressed by a specific section above:
efficiency metrics (`EFFICIENCY METRICS`), `labeledFraction` accompaniment (same), event export
(`EVENT EXPORT`), vector-boundary non-leakage (`VECTOR BOUNDARY`), scope isolation (`SCOPE
REGRESSION`), known-pair detectability (`THRESHOLD EVALUATION`), distinct-pair non-collapse (same),
constrained-budget demotion (`CONSTRAINED-BUDGET RESULT`), demoted-not-deleted (same), vector-
degradation-equals-A′ (`VECTOR-DEGRADATION RESULT`), A′ metrics non-regression
(`TOKEN/CONTEXT EFFICIENCY COMPARISON`), zero-network default config (redundancy ships disabled;
the one network-requiring test is integration-only, excluded from the default suite), and all
Phase 2A/2B tests remaining green (350/350, this section).

## RISKS

- **Stopword/near-universal-term pollution in `buildFtsQuery()`** (see `STOPWORD RETRIEVAL
  FINDING`): currently masked by Task 8's small seed corpora, where semantic KNN already returns
  every candidate regardless. Would become load-bearing at real production corpus scale. Proposed
  follow-up `P2C-R1`, not scheduled.
- **Root `package.json` build-order fragility**: the topological batch fix (Task 5) is empirically
  verified correct but relies on an unpinned implementation detail (npm's actual multi-`--workspace`
  execution order within one tier) rather than a structural guarantee (e.g. `tsc -b` project
  references). Disclosed, accepted as Minor by Task 5's reviewer, not re-litigated here. A future
  task introducing a new cross-package dependency edge could resurface the same bug class a third
  time.
- **`exportFromEvents`'s `redundantWith: {}` is always empty**: real redundancy edges cannot be
  reconstructed from historical `FeedbackEvent`s (no structured target field). Any future analysis
  wanting real historical redundancy-feedback correlation would need a schema change first.
  Out of scope for Phase 2C by design.
- **`exportFromEvents` output cannot feed `computeEfficiencyMetrics`**: `ContextEventMemory.tokenCount`
  and `ContextEvent.candidateTokenCount` (both written by `gateway.ts` at delivery time) are never
  carried onto `EvalExample`/`EvalMemory` by `exportFromEvents`, so `redundantRatio`/
  `contextEfficiency` can currently only be measured from a live in-process pipeline run (Task 8's
  path), never reconstructed from historical event data (Task 7's path) -- the two halves of
  2C-001's acceptance criterion have not been joined. Carrying those fields through is the
  prerequisite for ever doing so, and is out of scope for this phase.
- **Small-N threshold calibration**: `DEFAULT_REDUNDANCY_THRESHOLD = 0.75` is now informed by two
  independent real-model corpus points (original `PHASE_2_FINDINGS.md` example, and this task's
  Step 1 integration test) rather than one -- still not a statistically fit value. Per spec, this is
  an accepted, explicit limitation, not a defect to fix here.
- **The one real-model test is network-dependent** (downloads ~90MB from Hugging Face Hub on first
  run, cached after): correctly excluded from the default `npm test` suite and from CI unless a
  separate network-enabled job runs `test:integration` explicitly. A sandboxed/offline CI run will
  simply never exercise this test, which is by design, but means the real-model claim is not
  continuously re-verified without a deliberate second job.
- **Redundancy ships disabled**: no risk to current production behavior -- confirmed by
  `compiler.test.ts`'s `"redundancy: absent redundancyPairs produces byte-identical output to Phase
  2B (no reordering, no redundantWith)"`, `gateway.test.ts`'s `"redundancy disabled by default:
  getContext output carries no redundantWith marks"`, and `redundancy-gate.test.ts`'s
  `"no-redundancy regression: a below-threshold example produces byte-identical compiled output
  between A' and C'"` -- but the C′ efficiency win (`TOKEN/CONTEXT EFFICIENCY COMPARISON`) is
  therefore not yet realized in production either, pending the decision in `RECOMMENDED NEXT PHASE`.

## LEARNING READINESS

**NO — still insufficient observations.** The real correlated corpus this question must be
evaluated against (`CURRENT CORRELATED DATASET SIZE`) does not currently exist in this install
(`data/brain.db` absent), and the last real measurement on record before this worktree existed was
5 feedback events total. Five observations cannot support any statistically meaningful ranking
adjustment -- this was already the explicit conclusion at Phase 2 spec time
(`docs/PHASE_2_DECISIONS.md`: "Splitting 5 observations across task classes yields buckets of size 0
and 1, where the shrinkage term drives every signal back to 0.5 anyway"), and nothing in Phase 2C
changed the size of that real corpus, because Phase 2C's own evaluation work deliberately used a
synthetic hand-labeled seed dataset rather than live production data. Per the spec, "NO — still
insufficient observations" is an explicitly acceptable answer, and no learning mechanism
(`UsefulnessStore`, `historicalUsefulness`, adaptive ranking, or any of the other explicitly
out-of-scope items in `docs/PHASE_2C_SPEC.md`'s Critical non-goal section) was implemented anywhere
in Phase 2C, consistent with this answer.

## RECOMMENDED NEXT PHASE

Proposed only -- nothing below is implemented by this task:

1. **Whether to enable redundancy by default.** `TOKEN/CONTEXT EFFICIENCY COMPARISON` shows a real
   ~10-point `contextEfficiency` improvement under a constrained budget with no observed ranking
   regression on the seed dataset (`GLOBAL MEMORY REGRESSION`, `CONSTRAINED-BUDGET RESULT`'s A′
   control). This is evidence in favor, but is still a single synthetic dataset, not a production
   measurement -- a decision-maker should weigh this against the fact that the ample-budget
   `contextEfficiency` numbers look directionally worse for C′ for the accounting reason explained
   in that section (not a real quality loss). Recommend treating this as ready for a scoped decision,
   not as a default-flip bundled silently into a future unrelated task.
2. **Whether `P2C-R1` (stopword/near-universal-term filtering in `buildFtsQuery()`) is worth
   scheduling.** Currently latent at test scale, real at production scale (`STOPWORD RETRIEVAL
   FINDING`). Recommend scheduling once a real corpus exists to measure the effect against, rather
   than pre-emptively.
3. **Grow the real correlated dataset before revisiting `LEARNING READINESS`.** This requires
   production usage with `data/brain.db` populated under the Phase 2B correlation model, not
   further evaluation-harness work. No action available in this phase.
4. **Consider wiring `exportFromEvents` (Task 7) into an actual reporting path or CLI** once a real
   `data/brain.db` exists, so `CURRENT CORRELATED DATASET SIZE` can be answered on demand instead of
   only via a throwaway script. Currently exists only as a pure function consumed by tests.
5. **Reconsider `DEFAULT_REDUNDANCY_THRESHOLD` once real-model data spans more than two corpus
   examples.** This task's Step 1 integration test is a second independent real-model datapoint
   (`THRESHOLD EVALUATION`); a decision to enable redundancy by default should ideally follow a
   third-plus datapoint or real production data, not ship on N=2.
