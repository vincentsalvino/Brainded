# Phase 4 — Learning: Readiness

## Checks performed this session

- **Typecheck/build/test:** `npm test --workspaces --if-present` — **685/685 passing, 0
  failures**, exit 0. Reconciled exactly against `PHASE_3_READINESS.md:149`'s documented 682
  baseline (`PHASE_4_FINDINGS.md` §1). Not re-typechecked/rebuilt separately this session since no
  source file changed — this was a documentation- and analysis-only scoping pass.
- **Security debt:** re-verified structurally (`package-lock.json` dependency chain +
  `packages/mcp/src/server.ts`'s transport construction), not re-run live over network this
  session — sufficient to confirm `PHASE_3_READINESS.md:150`'s classification still holds
  unchanged (`PHASE_4_FINDINGS.md` §12).
- **Live database audit:** direct, read-only SQL against `data/brain.db` (`{ readonly: true }`,
  no migrations re-run, no writes) — full results in `PHASE_4_FINDINGS.md`.
- **Code audit:** `packages/core/{ranking,retrieval,memory,contracts}`, `packages/gateway`,
  `packages/storage`, `packages/evaluation`, `packages/core/learning` inspected directly against
  running source, not assumed from prior docs.
- **No ranking behavior, memory lifecycle, or scheduler was modified.** `BUILD_PLAN.md`'s Phase 4
  section received a minimal, dated factual-correction addendum only (§13 in `PHASE_4_FINDINGS.md`)
  — no design content was rewritten there.

---

## Readiness questions

1. **Is the raw feedback/outcome data internally consistent?** Yes. `contexts_with_feedback` =
   `contexts_with_outcome` = `contexts_with_both` = 56, exactly; zero feedback references an
   undelivered memory; zero exact-duplicate `(memory_id, context_id)` pairs;
   `assertContextMembershipConsistent` is enforced at write time. Consistent as data — but see Q6/
   the provenance finding below for what it's evidence *of*.
2. **Is there enough repeated memory-level feedback to justify aggregation?** Yes, for a
   meaningful subset: 32 of 48 labeled memories have more than one observation, up to 50 on the
   single richest memory. No, for the remaining 16 (exactly one observation each) — and that's the
   correct outcome, not a gap: E13's continuous shrinkage keeps single-observation memories close
   to neutral by design.
3. **Is there enough contrast to justify ranking influence?** Yes, on feedback specifically: 70
   useful / 199 not-useful, with 18 memories showing genuine opposite-signal conflict across
   different tasks (real spread, not noise-free unanimity). No, on outcome (next question).
4. **Is outcome data too success-skewed to use strongly?** Yes — completely, not just heavily.
   60/60 `outcome:success`, 60/60 `signal.testsPassed:true`, zero exceptions. Two independent
   fields, both constant. Unusable as a primary or even lightly-weighted signal today.
5. **Should outcomes affect Phase 4.2 ranking at all initially?** No — not with a nonzero weight.
   `PHASE_4_DECISIONS.md` F4 wires Tier-2 outcome credit into the formula but defaults its weight
   to `0`, so it can be turned on later by a config change alone, against real variance, once it
   exists — never by re-architecting.
6. **Should learning be memory-only initially?** Yes, and not narrowly by choice: `FeedbackEvent`
   has no field to address a code chunk or dependency fact at all, and `context_event_sources` (the
   table that would record code/dependency delivery) has zero rows in production. Both the contract
   and the evidence force this scope, independent of each other (`PHASE_4_DECISIONS.md` F1).
7. **Should project-specific performance exist?** Not yet. A stark global-vs-project usefulness
   split exists in the data (8% vs. 54% useful), but it carries the signature of pilot test design
   (global "distractor" memories exercised against many synthetic projects) rather than
   demonstrated organic cross-project variance. Schema is shaped to add it later without a
   migration (F8); it is not populated now.
8. **Is markdown code-index contamination a blocker?** No.
   **NON_BLOCKING_DATA_QUALITY_RISK.** The specific claim in this task's brief could not be
   corroborated in `docs/` or in live telemetry (`context_event_sources` is empty — the capability
   has never been exercised against production data at all). Moot for a memory-only scope
   regardless, since code items aren't feedback-addressable today.
9. **Are known npm vulnerabilities a blocker?** No. **NON_BLOCKING_MAINTENANCE_DEBT.**
   `fast-uri@3.1.5`/`qs@6.15.3`, transitive via `@modelcontextprotocol/sdk`, unreachable under this
   application's stdio-only runtime, unchanged since `PHASE_3_READINESS.md:150,167`, carried
   forward again rather than fixed or re-litigated.
10. **Is Phase 4 ready for implementation?** **Conditionally, and the condition is the entire
    point of subdividing it (F14):**
    - **4.1 (Performance Aggregation): ready, unconditionally.** Pure additive plumbing — new
      table, rebuildable projection, event-ingestion wiring. No ranking change, fully reversible,
      observable before it does anything else. Nothing found in this audit weighs against building
      it now.
    - **4.2 (Bounded Ranking Learning): ready to *build*, shipped disabled by default.** The design
      (F1–F13, `PHASE_4_SPEC.md`) is concrete and directly buildable. It is **not** ready to
      *default-enable* — the entire evidence base behind it is pilot/evaluation-provenance, not
      organic usage (`PHASE_4_FINDINGS.md` §3), and outcome data carries no usable variance yet.
    - **4.3 (Learning Evaluation): the actual gate for 4.2's default**, not yet run — it can't be,
      until 4.2 exists to evaluate.
    - **4.4 (Lifecycle/Scheduled Evaluation): correctly not ready to scope at all.** No evidence
      gathered this session bears on it one way or another, which is itself the reason it stays
      last and conditional.

---

## Blocking risks

**None block Phase 4.1.** Carried-forward and adjacent items, disclosed rather than hidden:

1. `fast-uri`/`qs` transitive advisories — non-blocking, unreachable, unchanged (§9 above).
2. Markdown-as-code static risk — non-blocking, unverified as actually occurring, moot for
   memory-only scope (§8 above).
3. **The entire existing feedback/outcome corpus is pilot/evaluation-provenance, not organic
   dogfooding** (`PHASE_4_FINDINGS.md` §3). This is not a blocker for 4.1 (which doesn't need
   "true" evidence, only consistent raw events to aggregate correctly) and not a blocker for
   building 4.2 disabled. It is the specific, load-bearing reason 4.2 must not default-enable
   without Phase 4.3's replay-plus-live-pilot evidence first.
4. Outcome's complete success-skew (§4 above) — mitigated architecturally by defaulting Tier-2's
   weight to zero (F4), not by ignoring the finding.
5. **Adjacent, not a Phase 4 concern:** `PHASE_2_DECISIONS.md`'s E9 (scope-specificity ranking
   tie-break, project ≻ session ≻ global, **RESOLVED**) does not appear in the shipped
   `rank.ts:49-63` tie-break chain (score → confidence → memoryId only) — `rank.ts`'s own doc
   comment is still Phase-1-vintage language ("scope-specificity... reserved, not invented").
   This looks like an approved Phase 2 decision that was never implemented, discovered as a
   byproduct of this audit's direct source read. It is unrelated to feedback/outcome-driven
   learning and this document takes no position on fixing it — flagged for whoever next touches
   `packages/core/ranking`, not scoped into Phase 4.
6. **Adjacent:** `FeedbackEvent` has no actor/provenance field (agent vs. human, or which agent) —
   doesn't block F1–F13's design, which doesn't depend on it, but caps how sophisticated any future
   anti-gaming rule (F13) could ever be without a contract change.

---

## Verdict

**This verdict is scoped exactly to Phase 4.1** — new, additive, reversible aggregation
infrastructure with no ranking change — matching the brief's own instruction not to begin 4.1
itself as part of this scoping task. It is not a verdict on Phase 4.2's default configuration
(ships disabled, per F10, regardless), and not a verdict on Phase 4.3 or 4.4, which remain
explicitly ungated by this document.

READY_FOR_PHASE_4_1_IMPLEMENTATION

---

# Phase 4.1 — Implementation result (2026-09-04)

Test-first (TDD: red confirmed before every green, per `superpowers:test-driven-development`).
Scope held exactly to `PHASE_4_TASKS.md` tasks 1–5 — contracts, migration `0007`, the Sqlite store
and its transactional wiring, and the Fake/conformance pair. No ranking, Gateway, or memory
lifecycle code was touched, checked mechanically, not just asserted:

```
$ git diff --stat -- packages/core/ranking packages/gateway packages/core/memory
(empty)
```

**Regression:** `npm run typecheck` — 0 errors, all 15 workspaces. `npm run build` — clean.
`npm test --workspaces --if-present` — **738/738 passing, 0 failures**, up from this session's own
685-test baseline (`PHASE_4_FINDINGS.md` §1) by exactly **+53**, entirely inside the three packages
Phase 4.1 actually touched: `@brain/contracts` 86→98 (+12), `@brain/storage` 112→146 (+34),
`@brain/test-fixtures` 51→58 (+7). Every other workspace's count is byte-identical to its
pre-4.1 value — the same zero-diff proof `PHASE_3_READINESS.md` used, applied here. Two of
`@brain/storage`'s tests were added after an explicit gap check against the task brief's full
43-item TDD matrix: corrupted-then-`rebuildAll()`-recovers, and `purge()` cascading the
`memory_performance` row — both passed immediately (the underlying mechanisms, delete-then-replay
and `ON DELETE CASCADE`, already existed from tasks 2–3), which is the legitimate "add tests for
existing behavior" case, not a TDD violation.
`npm audit` — same 2 pre-existing advisories (`fast-uri@3.1.5` high, `qs@6.15.3` moderate),
unchanged, not touched (`PHASE_4_FINDINGS.md` §12 classification stands).

**Real-data validation, not just synthetic fixtures.** Per the brief's live-database-safety
instruction, `data/brain.db` itself was never opened with a migrating connection this session —
only read via a separate readonly connection during scoping, and copied (`cp`, not `openDatabase`)
to an isolated scratch path for this check. Against that copy:

- Migration `0007` applies cleanly on top of the real historical schema; `memory_performance`
  starts empty (16.9ms to open+migrate) — confirms the "migration creates an empty projection,
  backfill is a separate explicit step" design.
- `rebuildAll()` against the real 269-feedback/60-outcome/62-memory history: **48 memories
  rebuilt in 95.7ms.** `getPerformanceBatch` for all 62 memory ids: **0.7ms.** Both trivial at this
  scale, as predicted.
- **Idempotency, on real data:** `rebuildAll()` run twice in succession produced byte-identical
  `memory_performance` rows both times.
- **Spot-checked against this session's own earlier audit numbers** (`PHASE_4_FINDINGS.md` §4,
  §7, §15) for the three memories previously flagged as likely pilot distractors: `f8ba7735-...`
  and `05ad05de-...` matched the audit's useful/not-useful counts exactly (3/42 and 7/43).
  `cb18ede2-...` showed `notUsefulCount: 32` against the audit's blunter `36` — reconciled exactly
  by `redundantReasonCount: 4` (32 + 4 = 36): the audit's ad hoc query didn't separate
  `reason='redundant'` from other not-useful reasons (E14/F5); the real aggregation correctly does.
  This is independent confirmation the reason-routing logic behaves correctly against real,
  previously-uninspected-at-this-granularity data, not only against hand-built unit fixtures.

**Design note surfaced during implementation, not anticipated in the original spec pass:** two
duplicate-handling rules had to be frozen before coding could start (`PHASE_4_DECISIONS.md` F16)
— first-observation-wins for feedback, keyed by SQLite `rowid` rather than timestamp; the same rule
for outcomes, scoped to *eligible* (`success`/`failure`) outcomes only, so an ineligible `partial`/
`unknown` outcome recorded first can never block a later real outcome from counting. Both are
covered by dedicated tests (`memory-performance-store.test.ts`), including the specific "a leading
partial outcome does not block a later success" case.

Phase 4.1 is complete.

**2026-09-05 correction — two different questions were conflated here.** The line originally in
this spot read "`READY_FOR_PHASE_4_2_IMPLEMENTATION: NOT_READY...`", reasoning that 4.1 landing
doesn't supply Phase 4.3's replay/live-pilot evidence. That's true, but it answers the wrong
question. This document's own scoping verdict (F14, above) already establishes that Phase 4.2 is
**built disabled by default** specifically so it does not need to wait for that evidence — and
Phase 4.3 cannot evaluate anything until Phase 4.2 exists to be evaluated. There are two separate
axes here, and only one of them was gated on 4.3:

- **IMPLEMENTATION readiness** (may Phase 4.2 be built now?) — gated on Phase 4.1 shipping cleanly,
  which it has.
- **DEFAULT-ENABLE readiness** (may `learningRanking.enabled` ever become `true` in shipped
  configuration?) — gated on Phase 4.3's replay + organic live-pilot evidence, per F14/F15, and
  untouched by either 4.1 or 4.2 landing.

IS_PHASE_4_1_COMPLETE: YES
READY_FOR_PHASE_4_2_IMPLEMENTATION: READY_FOR_PHASE_4_2_IMPLEMENTATION
LEARNING_DEFAULT_ENABLEMENT: NOT_READY — unchanged, and not decided by this correction; still
Phase 4.3's call, per F14/F15.

---

# Phase 4.2 — Implementation result (2026-09-05)

Test-first throughout. Two pre-flight corrections landed before any implementation code, per this
phase's own brief: the IMPLEMENTATION-vs-DEFAULT-ENABLE readiness conflation above, and the bounded-
multiplier math (`PHASE_4_SPEC.md` §7, `PHASE_4_DECISIONS.md` F2, `PHASE_4_TASKS.md` item 15) — the
true worst-case non-reorder guarantee is `A/B > (1+maxBoost)/(1-maxBoost)` (≈1.3529 at the shipped
`maxBoost=0.15`), not "any gap bigger than `maxBoost`."

**Scope held exactly to Tasks 8–13**: `Candidate.performance`/`RankingInput.learning` contracts,
`computeUsefulnessSignal` (pure), `LearningSignalService.decorate()`, `rank()`'s bounded post-score
multiplier, Gateway/bootstrap wiring — all shipped with `DEFAULT_LEARNING_CONFIG.enabled` still
`false`. E9 (the pre-existing, separately-flagged scope-tie-break gap in `rank.ts`) was deliberately
**not** touched, per this phase's own instruction — `git diff` on `rank.ts` contains only the
Phase 4.2 addition, nothing else.

**Regression, mechanically verified, not asserted:**

```
$ git diff --stat -- packages/storage
(empty -- Phase 4.2 touches no storage code; the aggregate write path from 4.1 is untouched)
```

`npm run typecheck`/`npm run build` — 0 errors, all 15 workspaces. `npm test --workspaces
--if-present` — **789/789 passing**, up from Phase 4.1's 738 by exactly **+51**, entirely inside
the seven packages this phase actually touched: `@brain/contracts` +9, `@brain/learning` +20,
`@brain/ranking` +12, `@brain/test-fixtures` +2, `@brain/gateway` +5, `@brain/mcp` +2,
`@brain/evaluation` +1. Every other workspace — `@brain/storage` included — is byte-identical to
its Phase 4.1 count. Integration tiers: `packages/storage` 4/4, `packages/evaluation` 5/5, both
green. `npm audit`: same 2 pre-existing advisories, unchanged.

**Performance overhead, measured, not estimated** (30 seeded memories, real SQLite, real
`getContext`, 20 requests each): disabled — **0** calls to `getPerformanceBatch` across 20
requests, mean latency 4.0ms. Enabled — **exactly 1** call per request (20/20, confirmed by a live
call-count spy, not inferred), mean latency 3.1ms. No measurable overhead at this scale; no
optimization attempted, per the brief's own "don't fix what measurement doesn't show broken."

**Critical end-to-end test** (`packages/mcp/src/integration.test.ts`, through the real MCP wire,
real SQLite, real `recordFeedback` transactional path — never a direct `memory_performance` edit):
two comparably-relevant memories A/B, one clearly-irrelevant C. Baseline (disabled): captured
order. Real `brain_feedback` calls across 8 distinct contexts push B positive, A negative. Enabled:
**B measurably outranks A**; C stays last (its base relevance was constructed to clear the *true*
worst-case bound, asserted as an explicit fixture precondition rather than assumed). Disabled
again, same durable data: order reverts **exactly** to baseline. Passed on the first run — the
fixture's own precondition assertion (A/B baseline ratio inside the reorder-possible bound) held
without retuning.

**Layer 1 deterministic fixture** (`packages/evaluation/src/learning-ranking-fixture.test.ts`, F14/
F15): one frozen scenario covering all six required cases — positive-supported, negative-supported,
cold-start, clearly-irrelevant, close-relevance reorder-possible pair, and large-gap pair that
extreme opposite evidence still cannot reorder. The one bug caught while building it was in the
test's own bucket-categorization assertion, not in `computeUsefulnessSignal`/`rank()` — consistent
with "the fixture validates the policy, it does not choose it."

**Confidence/lifecycle isolation**: a dedicated MCP-path test confirms `confidence`, `status`, and
`content` are byte-identical before and after five rounds of `brain_feedback` with learning enabled
— the learning projection writes only `memory_performance`, never `memories`.

Phase 4.2 is implementation-complete. This does not, by itself, make any claim about whether Phase
4.3 has run, passed, or would justify a default-enable — it has not been attempted, and this
document does not claim otherwise.

IS_PHASE_4_2_IMPLEMENTATION_COMPLETE: YES
LEARNING_DEFAULT_ENABLEMENT: NOT_EVALUATED — Phase 4.3 required, unchanged from Phase 4.1's closeout.
READY_TO_SCOPE_PHASE_4_3

---

# Phase 4.3 — Evaluation result (2026-09-06)

Full protocol, methodology, and results: `docs/PHASE_4_3_REPORT.md`. Summary: no policy tuning
(`k=5`, `outcomeWeight=0`, `maxBoost=0.15`, `DEFAULT_LEARNING_CONFIG.enabled` untouched throughout).
4.3A re-confirmed every Phase 4.2 safety guarantee, plus a new randomized cold-start sweep. 4.3B
ran a real, time-causal (no-future-leakage) replay over the actual 145-context historical corpus —
63 exactly replayable, 0 harmful reorders, 0 context-impacting reorders, 0 cold-start reorders. 4.3C
designed and built the organic-pilot protocol and its mechanics (DB snapshot, deterministic arm
assignment, cohort tagging), all tested, but ran **zero** real tasks this session — deliberately,
not from a gap, because the brief explicitly forbids manufacturing tasks to fill the evidence floor
and this repository had no independent backlog of ≥20 genuine unrelated tasks immediately after its
own Phase 4.1–4.3 build-out. `npm test`: 808/808 (+19 over Phase 4.2, entirely inside
`@brain/evaluation`).

**The pre-registered default-enable gate is unmet on breadth/utility, not on correctness or
safety** — every correctness/safety check that could run, passed; the organic-evidence floor
(≥20 tasks, ≥2 projects, ≥5 learning-active contexts, ≥3 distinct memories, ≥3 task categories)
was never attempted, so `NOT_ENOUGH_EVIDENCE` is the only verdict the pre-registered rule permits,
not `NO`.

IS_PHASE_4_3_COMPLETE: YES
DEFAULT_ENABLE_VERDICT: NOT_ENOUGH_EVIDENCE
OUTCOME_WEIGHT_STILL_UNCALIBRATABLE
INSUFFICIENT_PROJECT_SPECIFIC_EVIDENCE
NOT_READY_TO_SCOPE_PHASE_4_4 — not because evidence points to harm, but because no default-enable
decision has been reached at all; lifecycle automation (higher blast radius than a ranking nudge)
should not be scoped ahead of that decision.
