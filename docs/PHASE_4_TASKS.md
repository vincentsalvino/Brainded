# Phase 4.1 Tasks — Performance Aggregation

**Status: DONE (2026-09-04).** Tasks 1–5 below implemented test-first; result, regression numbers,
and real-data validation in `PHASE_4_READINESS.md`'s "Phase 4.1 — Implementation result" section.
Tasks 6–7 (regression, readiness/report) folded into that same section rather than duplicated here.

Dependency-ordered, test-first, same discipline as Phase 3's task lists. **No ranking behavior
changes in this sub-milestone** — every task here is additive and observable-only.

1. **Contracts** — `packages/core/contracts/src/learning.ts`: `MemoryPerformanceRawSchema`,
   `LearningConfigSchema` + `DEFAULT_LEARNING_CONFIG` (`enabled: false`). Add
   `MemoryPerformanceStore` interface to `repositories.ts`. Export both from `index.ts`. Tests in
   `learning.test.ts` (schema round-trips, `DEFAULT_LEARNING_CONFIG.enabled === false` asserted
   explicitly as a regression guard on its own).
2. **Migration** — `packages/storage/migrations/0007_memory_performance.sql` per
   `PHASE_4_SPEC.md` §3. Update the two hardcoded migration-list assertions in
   `packages/storage/src/db.test.ts` (the same pair every prior migration task has updated).
3. **Storage implementation** — `packages/storage/src/memory-performance-store.ts`:
   `SqliteMemoryPerformanceStore` (`getPerformanceBatch`, `rebuildAll`) plus synchronous
   `applyFeedbackToPerformance`/`applyOutcomeToPerformance` helpers (`PHASE_4_SPEC.md` §4, §9).
   Tests in `memory-performance-store.test.ts` — this is where test-matrix items 1–10 (below)
   live.
4. **Event-store wiring** — `packages/storage/src/event-store.ts`: `recordFeedback`/
   `recordOutcome` wrapped in `db.transaction()` per §4, calling the new helpers. Test: a poisoned
   second write (simulated failure inside the transaction) leaves **no** partial
   `memory_performance` row — same atomicity-proof shape as `recordContext`'s existing P2-006 test.
5. **Fake + conformance** — `packages/core/test-fixtures/src/fake-memory-performance-store.ts`:
   `FakeMemoryPerformanceStore`, same semantics as the Sqlite implementation (in-memory Map).
   Conformance suite mirrors the existing `store-conformance.ts` pattern (one behavioral contract,
   both implementations agree).
6. **Full regression** — `npm run typecheck && npm run build && npm test && npm audit`; report
   total test count against this audit's freshly-verified 685-test baseline
   (`PHASE_4_FINDINGS.md` §1).
7. **Readiness/report** — `PHASE_4_READINESS.md` Phase 4.1 verdict, independent of 4.2.

---

# Phase 4.2 Tasks — Bounded Ranking Learning

**Status: DONE (2026-09-05).** Tasks 8–13 implemented test-first; result, regression numbers, and
the critical end-to-end/Layer-1-fixture outcomes in `PHASE_4_READINESS.md`'s "Phase 4.2 —
Implementation result" section. `DEFAULT_LEARNING_CONFIG.enabled` stays `false`; that default is
unchanged by this milestone and remains Phase 4.3's call (F14/F15).

Ships with `learningRanking.enabled = false` (F10). Dependency-ordered; depends on 4.1 being
complete and green.

8. **Contracts** — `CandidatePerformanceSchema` + `Candidate.performance` field
   (`retrieval.ts`, `PHASE_4_SPEC.md` §2.3); optional `learning` override on `RankingInput`
   mirroring the existing `weights` override pattern. Schema tests: `performance` defaults to
   `null`, existing `Candidate` fixtures still parse unmodified (non-breaking additive change).
9. **Pure aggregation formula** — `packages/core/learning/src/aggregation.ts`:
   `computeUsefulnessSignal()` (`PHASE_4_SPEC.md` §5). Tests reproduce E5's own worked table
   (`PHASE_2_DECISIONS.md:186-195`) as concrete cases: zero evidence → exactly 0.5; one negative →
   0.472; one positive → 0.528 (symmetric); heavy negative (0/5) → 0.321; high-mass convergence
   (18/2) → 0.791; diluted-only evidence stays nonzero and correctly signed. No I/O in this file —
   enforced by a structural "no storage dependency" guard test, same shape as `core/token`'s
   existing REGRESSION 2 guard.
10. **Decoration service** — `packages/core/learning/src/decorate.ts`: `LearningSignalService`
    (`PHASE_4_SPEC.md` §6). Tests: `enabled: false` short-circuits *before* calling the store (a
    spy asserts `getPerformanceBatch` is never invoked — proves it's a true no-op, not
    computed-and-discarded); a memory with no aggregate row degrades to `performance: null`, not a
    thrown error or a fabricated zero-evidence object; batch lookup covers a mixed candidate set
    correctly.
11. **Ranking integration** — `packages/core/ranking/src/rank.ts`: bounded multiplier
    (`PHASE_4_SPEC.md` §7). This is where test-matrix items 11–18 (below) live.
12. **Gateway wiring** — `packages/gateway/src/gateway.ts`: inject `LearningSignalService`; call
    `decorate()` at both `rank()` call sites (`getContext`, `search`); `packages/mcp/src/
    bootstrap.ts` wires the concrete store + config. `Gateway.getCodeItems`'s separate
    `computeScore` path is explicitly left untouched (`PHASE_4_SPEC.md` §8). This is where
    end-to-end test-matrix items 19–22 live, including the full critical end-to-end test
    (`PHASE_4_SPEC.md` §10).
13. **Safety tests** — cross-cutting, exercised against the wired system: test-matrix items 23–26
    (malformed/missing aggregate, DB-unavailable degradation, cross-project isolation, rebuild
    recovery).
14. **Full regression** — `npm run typecheck && npm run build && npm test && npm audit`; assert
    the disabled-by-default suite (item 11) passes with **zero** diff against the pre-4.2 baseline;
    report total test count against 4.1's baseline.
15. **Readiness/report** — `PHASE_4_READINESS.md` Phase 4.2 verdict. This verdict governs whether
    4.2 merges with `enabled: false` (expected) — it does **not** by itself justify flipping the
    default; that is Phase 4.3's job (F14).

---

# Phase 4.3 Tasks — Learning Evaluation

**Status: DONE (2026-09-06).** Full protocol, results, and verdicts in `docs/PHASE_4_3_REPORT.md`
— 4.3A deterministic re-verification, 4.3B real time-causal historical replay (63/145 contexts
exactly replayable, 0 harmful/context-impacting reorders, 0 cold-start reorders), 4.3C organic
pilot design + harness (0 tasks run this session, by design — not manufactured). Verdict:
`NOT_ENOUGH_EVIDENCE` for default-enable, `NOT_READY_TO_SCOPE_PHASE_4_4`.
`DEFAULT_LEARNING_CONFIG.enabled` was never touched.

Below is the original placeholder sketch this phase actually executed against — preserved as
written, not rewritten after the fact:

16. Extend `packages/evaluation` with a `learning` strategy + a small frozen fixture dataset
    (Layer 1 — deterministic, known candidates and feedback histories, exact expected order).
17. Historical replay: run the candidate learning formula (F4) over `export.ts:
    exportFromEvents()`'s real 269-event/60-outcome corpus (Layer 2) without touching production
    ranking; report §11's safety metrics from `PHASE_4_SPEC.md`.
18. Live pilot: real coding tasks, `learning.enabled` true vs. false, controlled configuration
    (Layer 3), mirroring the Phase 2C/3.4 pilot format already proven in this repository.
19. Safety-metrics report and an explicit default-enable go/no-go recommendation — the actual gate
    for changing `learningRanking.enabled`'s shipped default.

---

# Phase 4.4 Tasks — Lifecycle / Scheduled Evaluation (placeholder)

Not scoped into tasks. Explicitly conditional on Phase 4.3's outcome (F14) — promotion/demotion
and a real scheduler are the highest-blast-radius work in this whole phase, and per the brief's own
instruction, the most dangerous behavior stays last and stays conditional rather than pre-committed.

---

# Test matrix

Every item the brief asked for, mapped to the task that owns it. All are **planned**, none are
implemented — this is a pre-registration, not a report of results.

## Aggregation

| # | Test | Task |
|---|---|---|
| 1 | One useful feedback → `usefulCount=1`, `usefulnessSignal=0.528` | 3 |
| 2 | One not-useful feedback → `notUsefulCount=1`, `usefulnessSignal=0.472` | 3 |
| 3 | Repeated contexts (same memory, many distinct `contextId`s) accumulate correctly | 3 |
| 4 | Opposite feedback across tasks (both `useful=true` and `useful=false` recorded) nets correctly, doesn't cancel to a false-neutral | 3 |
| 5 | Duplicate feedback dedup — a repeated `(memory_id, context_id)` pair counts once (F13) | 3 |
| 6 | Outcome correlation — Tier-2 credit applied and diluted by `includedMemoryIds` size | 3 |
| 7 | No-outcome context — a context with feedback but no linked outcome aggregates on Tier-1 alone | 3 |
| 8 | Success/failure counts recorded as raw, undiluted observability fields independent of the diluted evidence streams | 3 |
| 9 | Aggregate rebuild exact — `rebuildAll()` output byte-identical to incrementally-maintained state | 9 (via `PHASE_4_SPEC.md` §9's AT-7-style test) |
| 10 | Project isolation — two memories with identical ids-shaped evidence in different `scopeKey` buckets never merge (relevant once F8's per-project bucket activates; asserted as "not yet populated, doesn't crash" for 4.1/4.2) | 3 |

## Ranking

| # | Test | Task |
|---|---|---|
| 11 | `learning.enabled = false` ⇒ output byte-identical to pre-4.2 `rank()` on a fixed fixture | 11, 14 |
| 12 | Cold-start candidate (`evidenceMass=0`) unchanged — `boost === 0` exactly | 11 |
| 13 | Positively-supported memory gets a bounded boost, capped at `maxBoost` | 11 |
| 14 | Negative feedback gets a bounded penalty, capped at `-maxBoost` | 11 |
| 15 | Relevance remains dominant — two candidates whose base-score ratio exceeds `(1+maxBoost)/(1-maxBoost)` (≈1.3529 at `maxBoost=0.15`, not merely `maxBoost` itself — 2026-09-05 correction, `PHASE_4_SPEC.md` §7) never reorder | 11 |
| 16 | Unrelated (low-relevance) memory cannot leapfrog a relevant one on usefulness alone | 11, and critical E2E step 2 (`PHASE_4_SPEC.md` §10) |
| 17 | Deterministic tie behavior — identical `usefulnessSignal` ties resolve via the existing confidence/memoryId chain, unchanged | 11 |
| 18 | Pure ranking / no I/O — structural guard, `@brain/ranking` gains no new dependency | 11 |

## End-to-end

| # | Test | Task |
|---|---|---|
| 19 | `brain_feedback` (real MCP call path) changes the stored aggregate | 12 |
| 20 | A subsequent `brain_recall`/`brain_context` call sees the learned aggregate via `decorate()` | 12 |
| 21 | Ranking measurably changes for the same query (critical E2E test, `PHASE_4_SPEC.md` §10, step "Enabled run") | 12 |
| 22 | Disabling learning restores the exact old order (critical E2E test, step 3) | 12 |

## Safety

| # | Test | Task |
|---|---|---|
| 23 | Malformed/missing aggregate degrades to no-learning for that candidate, not an error | 13 |
| 24 | Aggregate DB row/table unavailable does not break retrieval — same degradation discipline as vector search | 13 |
| 25 | Cross-project feedback does not leak improperly (global-bucket-only in 4.1/4.2, per F8 — asserted as "no project-keyed leakage because no project key is read yet," revisited when F8's bucket activates) | 13 |
| 26 | Rebuild from raw events recovers state after a simulated corrupted/cleared `memory_performance` table | 13 |

## Regression

| # | Test | Task |
|---|---|---|
| 27 | All existing Phase-3 tests (685/685, `PHASE_4_FINDINGS.md` §1) stay green throughout 4.1 and 4.2 | 6, 14 |
| 28 | Mixed-source telemetry rank regression (Phase 3.4's fix) stays green | 6, 14 |
| 29 | Zero-network invariant remains true — no new package introduces a network-capable dependency | 6, 14 |
| 30 | Redundancy remains disabled by default — Phase 4 touches no redundancy config | 6, 14 |
