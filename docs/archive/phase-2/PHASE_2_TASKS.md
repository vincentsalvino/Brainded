# Phase 2 Task Graph

20 dependency-aware tasks implementing `PHASE_2_SPEC.md`. Task IDs follow dependency order.

**Gate markers:** tasks tagged **[HUMAN]** cannot start until the corresponding decision in
`PHASE_2_DECISIONS.md` is approved. Tasks tagged **[GATE]** are checkpoints where a measured result
decides whether later tasks are still justified.

---

## Dependency Graph

```
P2-001 Store-conformance suite  (fails against current code -- that is the point)
   |
   +-- P2-002 Lexical direction + normalization      [HUMAN: E1]
   |        |
   |        v
   |   P2-009 Evaluate A vs A'                       [GATE]
   |
   +-- P2-003 Contract additions                     [HUMAN: E3]
   |        |
   |        +-- P2-004 Migration 0002                [HUMAN: E23]
   |        |        |
   |        |        +-- P2-005 contextId plumbing
   |        |        +-- P2-006 Junction-table writes
   |        |        +-- P2-015 Observability columns + timing
   |        |
   |        +-- P2-010 UsefulnessStore + projection
   |                 |
   |                 v
   |             P2-011 LearningSignalService.decorate
   |                 |
   |                 v
   |             P2-012 Ranking: usefulness term + scope tie-break
   |
   +-- P2-007 packages/evaluation (metrics core)
            |
            +-- P2-008 Seed dataset
                     |
                     v
                 P2-009 [GATE] -----------------------------+
                                                            |
   P2-013 Redundancy pairs (retrieval prep)                 |
        |                                                   |
        v                                                   |
   P2-014 Redundancy demotion (core/context)                |
        |                                                   |
        +--------------------+------------------------------+
                             v
                       P2-018 Evaluate B and C
                             |
                             v
   P2-016 exportFromEvents   |    P2-017 CI boundary rules 5-7
                             |
                             v
                       P2-019 Acceptance tests AT-1..AT-11
                             |
                             v
                       P2-020 Phase acceptance
```

**Maximum parallelism:** after P2-003 lands, four tracks run independently — storage (P2-004→006,
015), learning (P2-010→012), evaluation (P2-007→008), redundancy (P2-013→014). P2-001 and P2-007
have no `[HUMAN]` dependency at all and can start immediately.

---

### P2-001 — Store-conformance suite
- **Purpose:** One shared test body, run against both `FakeRetrievalStore` and
  `SqliteRetrievalStore`, asserting they agree on signal *semantics*: better match ⇒ strictly higher
  score; all signals ∈ [0,1]; all-equal ⇒ 1.0; single candidate ⇒ 1.0; scope isolation.
- **Dependencies:** none.
- **Files:** `packages/core/test-fixtures/src/store-conformance.ts` (shared body);
  invoked from `packages/storage/src/retrieval-store.test.ts` and
  `packages/core/test-fixtures/src/fakes.test.ts`.
- **Acceptance:** the suite **fails** against current `main` on the lexical case, and the failure
  message names the direction inversion. Do not fix the store in this task.
- **Tests required:** is the test.
- **Why first:** this is the mechanism whose absence let an inverted signal ship inside 218 green
  tests (`PHASE_2_FINDINGS.md` §3.6). Every future `Candidate` signal extends this suite.
- **Parallel:** yes — blocks nothing, unblocks confidence in everything.

### P2-002 — Lexical direction + per-query normalization  **[HUMAN: E1]**
- **Purpose:** Score from `-fts_rank` and `-distance`; normalize both per query over the returned
  candidate set to `[0,1]`, with the documented degenerate-case rule.
- **Dependencies:** P2-001 (so the fix is proven by a pre-existing failing test, not by a test
  written to match the fix).
- **Files:** `packages/storage/src/retrieval-store.ts`.
- **Acceptance:** P2-001 passes for both stores. On the live corpus, the query "Refactor the database
  layer without changing API behavior" under `project:notes-api` ranks the repository constraint
  first.
- **Tests required:** P2-001 plus a regression test pinning the three-memory ordering from
  `PHASE_2_FINDINGS.md` §3.2.
- **Parallel:** no — gates P2-009.

### P2-003 — Contract additions  **[DONE — Phase 2B]**
- **Scope actually implemented:** only what Phase 2B needs -- `ContextDelivery` (Gateway-level),
  `FeedbackEvent.contextId`/`.reason`, `OutcomeEvent.contextId`, and the `ContextEvent` measurement
  fields plus `ContextEventMemory`. The learning-side fields (`historicalUsefulness`,
  `usefulnessSampleCount`, `RankingWeights.usefulness`) and the redundancy fields
  (`redundancyPairs`, `redundantWith`) were deliberately NOT added -- they belong to phases whose
  justification has not been re-established.
- **Purpose:** The 12 changes in `PHASE_2_SPEC.md` §2.9. All optional except
  the new Gateway-level `ContextDelivery` type. **`ContextPack` is not modified and `core/token` is
  not touched** (`PHASE_2_SPEC.md` §2.1).
- **Dependencies:** none technically; approval-gated.
- **Files:** `packages/core/contracts/src/{context,events,retrieval,repositories}.ts`.
- **Acceptance:** every new field exists, `.strict()` throughout, and the existing 40 contract tests
  still pass unchanged.
- **Tests required:** valid + invalid fixture per new field; `.strict()` rejection for each; a test
  that omitting every optional field yields exactly Phase 1 shapes.
- **Parallel:** no — blocks three tracks.

### P2-004 — Migration `0002_phase2_measurement.sql`  **[DONE — Phase 2B]**
- **Renamed** from `0002_phase2_learning.sql`: it carries no learning schema. `memory_usefulness_stats`
  is explicitly not created.
- **Ledger:** `schema_migrations` + a filename-ordered loader, verified on a fresh DB, a Phase 1-style
  DB with no ledger, an already-migrated DB, and a copy of the real `data/brain.db`.
- **Purpose:** `context_event_memories`, `memory_usefulness_stats`, six `context_events` columns,
  `context_id`/`reason` on feedback/outcome, indexes.
- **Dependencies:** P2-003.
- **Files:** `packages/storage/migrations/0002_phase2_learning.sql`, `packages/storage/src/db.ts`
  (multi-migration loader — currently hardcoded to `0001`).
- **Acceptance:** applies cleanly to an empty DB **and** to a copy of the live `data/brain.db`
  without data loss; re-running is idempotent; all existing Phase 1 rows remain valid.
- **Tests required:** migrate-from-empty; migrate-from-Phase-1-snapshot; idempotency; rollback by
  dropping the two new tables leaves Phase 1 behaviour intact.
- **Note:** `db.ts` currently reads exactly one migration file by name. Generalizing the loader is
  part of this task, not a follow-up.
- **Parallel:** no.

### P2-005 — `contextId` plumbing  **[DONE — Phase 2B]**
- **Purpose:** Gateway records the `ContextEvent`, then wraps `core/token`'s `ContextPack` into a
  `ContextDelivery` carrying the recorded id; `brain_context` returns `ContextDelivery`;
  `brain_feedback`/`brain_record_outcome` accept `contextId` and `reason`.
- **Explicitly out of scope:** any change to `optimizeContext()` or to `ContextPack`. `core/token`
  stays byte-identical.
- **Dependencies:** P2-003, P2-004.
- **Files:** `packages/core/token/src/optimize.ts`, `packages/gateway/src/gateway.ts`,
  `packages/mcp/src/schemas.ts`, `packages/mcp/src/server.ts`.
- **Acceptance:** a live `brain_context` call returns a non-null `contextId`; feeding it back to
  `brain_feedback` produces a row whose `context_id` resolves. `null` appears only when telemetry
  recording actually failed.
- **Tests required:** AT-5 round-trip; telemetry-failure path yields `contextId: null` and still
  returns the delivery; an unknown `contextId` on feedback is rejected loudly; structural test that
  `core/token`'s public output type gained no field.
- **Also in scope:** add `taskId`/`contextId` guidance to the `brain_context` tool **description** —
  the affordance half of the fix (`PHASE_2_FINDINGS.md` §4.2).
- **Parallel:** yes, alongside P2-006/P2-015.

### P2-006 — Junction-table writes  **[DONE — Phase 2B]**
- **Purpose:** Write `context_event_memories` in the same transaction as the `ContextEvent`, one row
  per candidate, with `included`, `rank`, `token_count`, `redundant_with`.
- **Dependencies:** P2-004.
- **Files:** `packages/storage/src/event-store.ts`, `packages/gateway/src/gateway.ts`.
- **Acceptance:** for any `brain_context` call, junction rows exactly reconstruct
  `includedMemoryIds` + `omittedMemoryIds`; per-item token costs sum to `ContextPack.tokenCount`.
- **Tests required:** reconstruction equivalence against the retained JSON columns; transaction
  atomicity (junction failure rolls back the ContextEvent, Gateway still returns the pack).
- **Parallel:** yes.

### P2-007 — `packages/evaluation` core
- **Purpose:** The pure harness: `evaluate(dataset, strategy, opts) → EvalReport`. Precision@K,
  Recall@K, MRR, NDCG@K; the four efficiency ratios; `labeledFraction`; `exampleCount`,
  `labeledObservationCount`, `SIGNIFICANT`/`INDICATIVE` labelling.
- **Dependencies:** none (uses existing contract types).
- **Files:** `packages/evaluation/{package.json,tsconfig.json,src/{index,metrics,evaluate,dataset}.ts}`.
- **Acceptance:** metric functions match hand-computed values on a tiny synthetic fixture (a
  3-item ranking with known NDCG); the package imports nothing from storage/gateway/mcp.
- **Tests required:** one hand-verified fixture per metric; a report below the observation threshold
  is labelled `INDICATIVE`; structural test that `package.json` declares no I/O dependency.
- **Parallel:** yes — start immediately, no approval needed.

### P2-008 — Seed evaluation dataset
- **Purpose:** `datasets/phase1-realworld.jsonl` — the two Phase 1 real-world tasks with graded
  labels and the `redundantWith` edge, plus scope-isolation counterexamples.
- **Dependencies:** P2-007.
- **Files:** `packages/evaluation/datasets/phase1-realworld.jsonl`.
- **Acceptance:** loads under a `.strict()` schema; declares its own memories so no run touches a
  developer's live `brain.db`; a deliberately malformed line is rejected loudly.
- **Tests required:** load + validate; malformed-line rejection.
- **Constraint:** these strings must never appear in production ranking code.
- **Parallel:** yes.

### P2-009 — Evaluate A vs A′  **[GATE]**
- **Purpose:** Run strategies A (unchanged Phase 1) and A′ (P2-002's corrections, no learning) over
  the seed dataset. Publish the comparison.
- **Dependencies:** P2-002, P2-008.
- **Files:** `packages/evaluation/src/strategies.ts`, a CI-runnable script.
- **Acceptance:** a report exists showing A's failure on AT-1 numerically and A′'s result.
- **GATE RESULT (recorded):** **A' passed on its own.** MRR 0.889 -> 1.000, P@1 0.833 -> 1.000,
  NDCG@1 0.722 -> 1.000, NDCG@10 0.876 -> 0.987; the Finding B example flips from a grade-0 to a
  grade-2 top hit. `rank()` unchanged, no weights tuned, no learning. See `PHASE_2_READINESS.md`
  "Phase 2A Result". P2-010..P2-014 therefore proceed only on a *fresh* justification.
- **GATE decision:** if A′ already satisfies AT-1 and AT-2, then **P2-010..P2-014 must justify
  themselves on other metrics** (context efficiency, redundant ratio, NDCG over the wider dataset)
  before proceeding. Shipping learning because "Phase 2 is about learning," when the bug fix already
  passed the acceptance test, is unjustified complexity. Record the decision either way.
- **Parallel:** no — this is the checkpoint.

### P2-010 — `UsefulnessStore` + projection
- **Purpose:** `SqliteUsefulnessStore` implementing `getStats`/`applyFeedback`/`applyOutcome`/
  `rebuild`; the Beta-posterior-with-shrinkage formula; tier-1/2/3 attribution with credit dilution;
  `reason='redundant'` routing that moves neither usefulness counter.
- **Dependencies:** P2-003, P2-004, P2-006.
- **Files:** `packages/storage/src/usefulness-store.ts`,
  `packages/core/learning/src/usefulness.ts` (pure formula), `packages/core/learning/src/service.ts`.
- **Acceptance:** the five reference values in `PHASE_2_SPEC.md` §5.2 reproduce exactly; `rebuild()`
  populates from the live DB's existing 5 feedback + 4 outcome events.
- **Tests required:** each reference value; AT-7 rebuild equivalence; AT-9 no-write-to-`memories`
  (read-only handle); dilution test (7-item success ⇒ 0.15/7 each); `partial`/`unknown` contribute
  zero; `redundant` moves neither counter.
- **Note:** the `failure` branch is uncalibrated — zero failure outcomes exist. Implement
  symmetrically, mark it in the code as untested against real data.
- **Parallel:** yes, alongside the evaluation track.

### P2-011 — `LearningSignalService.decorate()`
- **Purpose:** Between retrieval and ranking, decorate candidates with `historicalUsefulness` and
  `usefulnessSampleCount`. The **only** read path from learning into ranking.
- **Dependencies:** P2-010.
- **Files:** `packages/core/learning/src/signals.ts`, `packages/gateway/src/gateway.ts`.
- **Acceptance:** `core/ranking` gains no dependency; missing/empty/stale projection returns
  candidates unchanged with no error.
- **Tests required:** decoration correctness; the three degradation paths; structural test that
  `packages/core/ranking/package.json` still declares only `@brain/contracts`.
- **Parallel:** no.

### P2-012 — Ranking: usefulness term + scope tie-break
- **Purpose:** Add the **centred** usefulness term (`(u − 0.5) × 2`, default weight `0`) and the
  scope-specificity tie-break at level 2.
- **Dependencies:** P2-011.
- **Files:** `packages/core/ranking/src/{score.ts,rank.ts}`.
- **Acceptance:** with `weights.usefulness = 0` the output is byte-identical to A′; a neutral memory
  (0.5) contributes exactly `0`; determinism preserved.
- **Tests required:** AT-6 cold start; centring test (neutral ⇒ zero contribution); tie-break order;
  the existing 23 ranking tests still pass; **negative test — a highly-useful but irrelevant memory
  does not outrank a relevant one** (the AEOS `AUDIT_AEOS.md §11` failure mode).
- **Parallel:** no.

### P2-013 — Redundancy-pair computation
- **Purpose:** Pairwise cosine over the candidate set's stored vectors in retrieval preparation;
  emit `{a, b, similarity}` above τ, `a` = higher-ranked.
- **Dependencies:** P2-003.
- **Files:** `packages/core/retrieval/src/redundancy.ts`, `packages/storage/src/retrieval-store.ts`
  (vector fetch for a candidate set).
- **Acceptance:** on the live corpus, the project/global plural-rule pair is emitted at
  cosine ≈ 0.785 and the repository constraint (0.518) is not. Vectors unavailable ⇒ empty pairs,
  no error.
- **Tests required:** the real pair is detected; a genuinely different pair is not; degradation path;
  τ is read from config, not hardcoded at a call site.
- **Parallel:** yes.

### P2-014 — Redundancy demotion in `core/context`
- **Purpose:** Consume `redundancyPairs`; set `redundantWith`; move demoted items after all
  non-redundant items, preserving relative order.
- **Dependencies:** P2-013.
- **Files:** `packages/core/context/src/compiler.ts`.
- **Acceptance:** absent `redundancyPairs` ⇒ byte-identical Phase 1 output; `core/context` still
  declares no embedding/storage dependency.
- **Tests required:** demotion ordering; nothing is deleted (demoted item still present when budget
  allows); structural purity test; existing 23 context tests pass.
- **Parallel:** no.

### P2-015 — Observability columns + timing  **[DONE — Phase 2B]**
- **Purpose:** Populate `candidate_count`, `candidate_token_count`, and the four stage timings on
  every `ContextEvent`.
- **Dependencies:** P2-004.
- **Files:** `packages/gateway/src/gateway.ts`.
- **Acceptance:** every new `brain_context` call records six non-null values; timing overhead is
  measurably negligible.
- **Tests required:** columns populated; a failure in timing collection never fails the request.
- **Parallel:** yes.

### P2-016 — `exportFromEvents()`
- **Purpose:** Build `EvalExample[]` from `(ContextEvent, its FeedbackEvents)` pairs so future real
  examples enter the dataset without hand-authoring.
- **Dependencies:** P2-005, P2-007.
- **Files:** `packages/evaluation/src/export.ts` (takes an `EventStore`, injected — the package stays
  free of a storage dependency).
- **Acceptance:** produces valid examples from a fixture event store; unlabeled items are excluded
  from precision rather than counted as irrelevant.
- **Tests required:** round-trip against a fake event store; the unlabeled-exclusion rule.
- **Parallel:** yes.

### P2-017 — CI boundary rules 5–7
- **Purpose:** Extend the mechanical boundary checks: ranking imports only contracts; nothing in
  production imports `@brain/evaluation`; evaluation imports no storage/gateway/mcp.
- **Dependencies:** P2-007, P2-012.
- **Files:** `packages/mcp/src/boundaries.test.ts` (or a repo-level equivalent).
- **Acceptance:** each rule catches a deliberately planted violation, then the plant is reverted —
  the same plant-and-revert technique P1-017 used.
- **Tests required:** is the test.
- **Parallel:** yes.

### P2-018 — Evaluate B and C
- **Purpose:** Run all four strategies over the seed dataset; publish the comparison with
  `exampleCount`, `labeledObservationCount`, and the significance label.
- **Dependencies:** P2-009 (gate passed), P2-012, P2-014.
- **Acceptance:** a report exists. **A strategy is adopted only if it wins on a stated metric.** If B
  and C do not beat A′, they ship disabled (`weights.usefulness = 0`, redundancy off) with the
  machinery in place and the result recorded.
- **Tests required:** report reproducibility — same dataset + same weights ⇒ same numbers.
- **Constraint:** weights are fit by the harness and reported with their fit. Hand-tuning against the
  two Phase 1 projects is forbidden (n=2 overfitting).
- **Parallel:** no.

### P2-019 — Acceptance tests AT-1 … AT-11
- **Purpose:** The eleven criteria in `PHASE_2_SPEC.md` §14 as an executable suite.
- **Dependencies:** P2-018, P2-016, P2-017.
- **Files:** `packages/evaluation/src/acceptance.test.ts` plus per-package tests where a criterion is
  package-local.
- **Acceptance:** all eleven pass; every Phase 1 acceptance criterion still passes; zero external
  network calls across the full suite.
- **Parallel:** no.

### P2-020 — Phase acceptance
- **Purpose:** Full `npm run typecheck && npm run build && npm test`; a re-run of the Phase 1
  real-world scenario against a real external MCP agent, verifying (a) AT-1's ordering in a live
  call, (b) a non-null `contextId` round-tripping through `brain_feedback`, (c) `getEventsForTask`
  returning a **connected** chain.
- **Dependencies:** P2-019.
- **Acceptance:** the three live checks pass. Item (c) is the direct refutation of
  `PHASE_2_FINDINGS.md` §4.1.
- **Parallel:** no.

---

## Task-to-decision map

| Decision | Gates |
|---|---|
| E1 (lexical fix) | P2-002, and therefore P2-009, P2-018, P2-019, P2-020 |
| E3 (`contextId` protocol) | P2-003, and therefore P2-004/005/006/010/011/012/016 |
| E23 (junction migration) | P2-004, and therefore P2-006, P2-010, P2-015 |
| E14 (may `useful=false` rank?) | P2-010's negative branch only — a `record-only` answer leaves the task shippable with `notUsefulCount` recorded but excluded from the formula |
| E24 (doc corrections) | none — cosmetic, non-blocking |

**Unblocked today, no approval needed:** P2-001, P2-007, P2-008.
