# Phase 2C.7 Report — Hybrid Near-Duplicate Policy + Live Gateway Pilot

Two gated parts. **Part A**: Phase 2C.6's offline Rule H, implemented as real, unit-tested production
code behind the still-disabled redundancy feature. **Part B**: that exact implementation, run live
against the real `data/brain.db` through a temporary `{enabled:true}` script — never in production,
`packages/mcp/src/bootstrap.ts` unchanged. Part A wrote real source files (declared explicitly below,
via TDD — every test written and watched fail before the code that makes it pass). Part B, like every
prior live pilot, deleted its own scaffolding and touched no source file.

## PHASE 2C.7 STATUS

Complete. Part A green (386/386 tests, up from the 367 baseline; typecheck/build/audit clean; both
integration suites unchanged) — proceeded to Part B per the gate. Part B: all four required live
targets confirmed exactly as Phase 2C.6's offline evaluation predicted, using the actual built
`isNearDuplicate` — not a reimplementation. One genuinely new finding: this pilot is the first in the
whole 2C series to observe real compression (`wasCompressed: true`) firing under budget pressure —
every prior pilot's tight budgets happened to resolve via full omission instead.

## PART A IMPLEMENTATION

TDD throughout (per `superpowers:test-driven-development`): every new behavior below was a failing
test, watched fail for the stated reason, then the minimal code to pass it, for three cycles —
(1) the pure `lexical-containment.ts` functions in isolation, (2) `RetrievalService.getRedundancyPairs`
wired to call them, (3) the full 99-pair regression reproducing Phase 2C.6.

**New file** `packages/core/retrieval/src/lexical-containment.ts`:
- `tokenizeForContainment(content)` — lowercase → non-alphanumeric → space → split → unique set →
  fixed stopword list removed (~40 words, copied verbatim from Phase 2C.6's evaluated list — not
  user-configurable, per instruction).
- `containmentCoefficient(contentA, contentB)` — `|intersection| / min(|A|, |B|)`, `0` (never `NaN`)
  when either set is empty.
- `NearDuplicatePolicy` type + `DEFAULT_CANDIDATE_FLOOR` (0.75) / `DEFAULT_HIGH_CONFIDENCE_THRESHOLD`
  (0.80) / `DEFAULT_CONTAINMENT_THRESHOLD` (0.40) / `DEFAULT_NEAR_DUPLICATE_POLICY`.
- `isNearDuplicate({cosineSimilarity, contentA, contentB}, policy = DEFAULT_NEAR_DUPLICATE_POLICY)` —
  exactly Rule H: `cosine >= highConfidenceThreshold` (unconditional), else
  `cosine >= candidateFloor AND containment >= containmentThreshold`, else `false`. No Jaccard, no
  prefix-stripping, no stemming, no edit distance, no tags/type/outcomes, no LLM — none of it added.

## POLICY CONSTANTS

| constant | value | meaning |
|---|---|---|
| `candidateFloor` | 0.75 | minimum cosine for a pair to reach classification at all — passed to storage |
| `highConfidenceThreshold` | 0.80 | cosine at or above this is a duplicate on semantic evidence alone |
| `containmentThreshold` | 0.40 | in `[floor, highConfidence)`, containment at or above this corroborates |

`RedundancyConfig` (`packages/gateway/src/gateway.ts`) is now `{ enabled: boolean } & NearDuplicatePolicy`
— a single flat shape, replacing the old `{ enabled, threshold }` where `threshold` meant two different
things depending on which code path read it. `DEFAULT_REDUNDANCY_THRESHOLD` (the old single constant)
no longer exists; nothing outside this phase's own changed files referenced it as a real import (two
evaluation test files mentioned it only in prose comments, left as-is — still accurate as history).

## FILES CHANGED

| file | change |
|---|---|
| `packages/core/retrieval/src/lexical-containment.ts` | **new** — the pure functions above |
| `packages/core/retrieval/src/lexical-containment.test.ts` | **new** — 13 unit tests |
| `packages/core/retrieval/src/service.ts` | `getRedundancyPairs(rankedResults, policy)` — calls `findSimilarPairs(ids, policy.candidateFloor)`, filters via `isNearDuplicate`, only accepted pairs reach `toRedundancyPairs` (untouched) |
| `packages/core/retrieval/src/service.test.ts` | 2 existing calls adapted to the new signature (same behavior, new shape) + 2 new integration-regression tests |
| `packages/core/retrieval/src/index.ts` | `export * from "./lexical-containment.js"` — the policy needs to cross the package boundary to Gateway |
| `packages/gateway/src/gateway.ts` | `RedundancyConfig` type; constructor default now `{enabled:false, ...DEFAULT_NEAR_DUPLICATE_POLICY}`; `getContext` passes `this.redundancy` straight through (structurally satisfies `NearDuplicatePolicy`, extra `enabled` field ignored) |
| `packages/gateway/src/gateway.test.ts` | 2 existing redundancy configs adapted to the new shape (one collapsed to a simple-threshold-equivalent policy, preserving exact prior calibration/intent) |
| `packages/mcp/src/bootstrap.ts` | imports `DEFAULT_NEAR_DUPLICATE_POLICY` from `@brain/retrieval` instead of the removed constant from `@brain/gateway`; **still `{ enabled: false, ... }`** |
| `packages/evaluation/src/redundancy-gate.test.ts` | added `simplePolicy(threshold)` helper (candidateFloor === highConfidenceThreshold collapses the hybrid rule to the exact plain-threshold check this pre-2C.7 file was already built around); 8 call sites updated, zero assertions changed |
| `packages/evaluation/src/hybrid-classifier-regression.data.ts` | **new** — Phase 2C.6's frozen 99 pairs, embedded verbatim (content + label + already-measured similarity, no re-embedding) |
| `packages/evaluation/src/hybrid-classifier-regression.test.ts` | **new** — 4 tests running the *real* `isNearDuplicate` against that frozen data |
| `packages/evaluation/package.json` | added the new regression test to the default (network-free) `test` script |

**No change** to `packages/core/retrieval/src/redundancy.ts` (`toRedundancyPairs`, scope-anchor
orientation), `packages/ranking`, `packages/core/token`, `packages/mcp/src/server.ts`, or any SQL
migration/schema file — confirmed by this exact file list, not by intent alone.

## STORAGE FLOOR INVARIANT

Verified two independent ways, per instruction ("add a regression proving a 0.785 pair reaches
classification"):

1. **Unit-level** (`service.test.ts`): a `FixedSimilarityStore` records the exact `minSimilarity`
   argument `findSimilarPairs` receives and enforces it as its own floor (mirroring real storage) — so
   a wrongly-passed `0.80` would silently swallow a `0.785` pair inside the test double itself, exactly
   as it would for real. Both regression tests assert `store.lastMinSimilarity === DEFAULT_CANDIDATE_FLOOR`
   (0.75) explicitly, not just the end-to-end pair outcome.
2. **Live** (Part B, below): the real N1~G pair, cosine 0.785122, was retrieved and correctly classified
   `NEAR_DUPLICATE` against the real `data/brain.db` and the real `SqliteRetrievalStore` — direct proof
   the invariant holds outside the test double too.

## UNIT TESTS

All 12 required cases from the brief, plus one dataset-shape guard (13 total in
`lexical-containment.test.ts`):

| # | case | result |
|---|---|---|
| 1 | cosine 0.81, zero lexical overlap | duplicate ✔ |
| 2 | cosine exactly 0.80 | duplicate ✔ (boundary inclusive) |
| 3 | real T4~T6 (cosine 0.799007, containment 1.0) | duplicate ✔ |
| 4 | real N1~G (cosine 0.785122, containment 0.50) | duplicate ✔ (containment boundary inclusive) |
| 5 | real 2C.4 A~B (cosine 0.762576, containment 0.286) | distinct ✔ |
| 6 | real rest-api-c (cosine 0.772566, containment 0.333) | distinct ✔ |
| 7 | cosine 0.79, containment ~0.375 (constructed, just under 0.40) | distinct ✔ |
| 8 | cosine 0.749, containment 1.0 (identical content) | distinct ✔ — below the floor, containment never even consulted |
| 9 | empty content, cosine above floor | distinct, no NaN/throw ✔ |
| 10 | stopwords excluded (`"the quick fox"` vs `"a slow fox"`: raw 1/3, destopped 1/2) | 0.5 ✔ — proves removal is real, not a no-op |
| 11 | project identifiers not specially stripped (shared `"phase2c-example-project"` prefix counts as 3 real tokens) | 0.8 ✔ — would be 0.2 if stripped |
| 12 | existing scope-aware orientation still works | ✔ — all 7 pre-existing `toRedundancyPairs` tests pass unchanged (file untouched) |

## FROZEN 99-PAIR REGRESSION

`hybrid-classifier-regression.test.ts`, 4 tests, running the real `isNearDuplicate` against Phase
2C.6's exact 99 pairs (71 authored + 24 organic + 4 control), embedded verbatim, no re-embedding:

- **Zero false positives, every group**: 0/71 authored, 0/24 organic, 0/4 control.
- **Exact detection counts match 2C.6's Hybrid C row**: authored 33/36, organic 2/4, control 0/1 —
  identical to the offline evaluation, not merely "similar."
- **All four hard cases retain their Phase 2C.6 verdict.**
- **Dataset shape** (71/24/4) asserted directly, so a future edit can't silently shrink the evidence
  base without the test itself failing.

This is the required gate: **the implementation reproduces Phase 2C.6 exactly.** Proceeded to Part B.

## LIVE ENVIRONMENT

| | |
|---|---|
| Repo | `c:\Users\LENOVO V330\OneDrive\Desktop\ai-brain`, branch `main` |
| Brain DB | `data/brain.db` (real, pre-existing, WAL mode) |
| Mechanism | temporary `.pilot-tmp/runner.mjs` (deleted at cleanup), same shape as every prior pilot — mirrors `createBrain()`, imports the real built `@brain/retrieval` (`isNearDuplicate`) and `@brain/gateway`, `{enabled:true}` only inside the script |
| MCP `brain_*` tools | disconnected this session (noted by the harness mid-conversation) — Part B used the script's own direct Gateway calls exclusively for everything, including feedback/outcome; still real production code, same as every prior pilot's non-MCP channel |
| Target memories | all 7 verified `status='active'` via read-only SQL before anything else ran: T4 (`be32099f`), T6 (`267ce2e6`), N1 (`a0ae3295`), G/`cb18ede2`, and 2C.4's A/B/C (`ab232c09`/`d8f30a3f`/`05ad05de`) — no synthetic substitute created |

## T4~T6 RESULT

Live cosine (real `SqliteRetrievalStore`, real `LocalEmbeddingProvider`): **0.7990071326494217** —
matches the frozen 0.799007 to the displayed precision. Real production classifier: `NEAR_DUPLICATE`.

Ample budget (task `"Can route handlers in this project query SQLite directly, or does data access
have to go through a repository?"`, `project:task-api`): T6 rank 1 (0.9), **T4 rank 2 (0.809,
`redundantWith: T6`)** — same scope specificity (both `project`) → rank-based anchor, T6 wins.

Constrained-budget probes (same task/scope):

| maxTokens | delivered | T4 present? |
|---|---|---|
| 50 | T6 (44 tok) | no |
| 61 | T6 + T5 (57 tok) | **no** — despite T6+T4 (61 tok) fitting exactly |
| 70 | T6 + T3 + T2 (69 tok) | no |
| 200 | T6 + **T4** + T3 + T5 + T2 + plural-rule + T1 + Zod-rule + **2C.4-C (compressed, 58→~28 tok)** | **yes** |

T4 is skipped at every budget from 50 through 70 — even at 61, where T6+T4 would fit with zero
tokens to spare under naive rank-order packing. This is the same "redundant items lose budget
priority regardless of original rank" mechanism 2C.4 found for a plain-cosine pair, now confirmed
live for a **hybrid-corroborated** one. T4 reappears at 200 once the budget covers every
non-redundant item plus itself — `redundant != deleted`, holds. **`wasCompressed: true` appears for
the first time in this project's pilot history** at this budget point (2C.4-C truncated from 58 to
~28 tokens rather than omitted) — every prior phase's constrained probes happened to land on budgets
that resolved via full omission instead; this one didn't.

## N1~G RESULT

Live cosine: **0.785121887922287** — matches frozen 0.785122. Real classifier: `NEAR_DUPLICATE`
(would **not** pass plain cosine ≥ 0.80 — confirmed directly in `DISABLED VS 0.80 VS HYBRID` below).

Ample budget (`"What naming convention should REST endpoints in this project follow?"`,
`project:notes-api`): global plural-rule memory (`a76fdf66`) rank 1 (0.9), `redundantWith: N1` — **N1
(project, rank 3, 0.702) is the anchor**, correctly winning over its global near-duplicate per Phase
2C.1's scope-specificity policy, now proven on a pair the hybrid classifier (not plain cosine) decided.

Constrained-budget probes:

| maxTokens | delivered | notes |
|---|---|---|
| 39 | **N1 only** (39 tok) | both global plural-rule duplicates skipped entirely |
| 97 | N1 + 2C.4's global C (97 tok) | same |

Clean: the project-specific memory wins the tight budget over both of its global near-duplicates,
exactly as 2C.1's anchor policy intends, on a pair only the hybrid rule (not plain 0.80) detects at all.

## FALSE-POSITIVE CONTROL

Live cosine (2C.4 A~B): **0.762575775384903** — matches frozen 0.762576. Real classifier: `DISTINCT`.
**No false positive.**

Ample-budget delivery (`project:phase2c-threshold80-pilot`, the same task 2C.4 used): C (rank 1, 0.9),
A (rank 2, 0.630, no `redundantWith`), **B (rank 3, 0.552, no `redundantWith`)** — B is fully
independent, exactly as required. This is the same real content that produced a live false positive
under plain cosine ≥ 0.75 in Phase 2C.4; the hybrid rule gets it right without needing the stricter
0.80 floor that also would have missed the two organic pairs above.

## REST-API-C CONTROL

`rest-api-c` exists only as a frozen `packages/evaluation` benchmark fixture, never a real Brain
memory — per instruction, no memory was seeded to manufacture a live call for it. It is instead proven
twice against the real production classifier without re-authoring anything: `lexical-containment.test.ts`'s
dedicated unit test (cosine 0.772566, containment 0.333 → `DISTINCT`) and inside the 99-pair frozen
regression (0/71 authored false positives includes this exact id). Both use the real `isNearDuplicate`,
not a hand check.

## CONSTRAINED CONTEXT

Same candidates, same task, same `maxTokens: 70`, `project:task-api`, three strategies:

| strategy | config | delivered | tokenCount | omitted |
|---|---|---|---|---|
| A. disabled | `enabled:false` | T6, **T4**, T2 | 68 | 7 |
| B. plain ≥ 0.80 | `candidateFloor=highConfidenceThreshold=0.80` | T6, **T4**, T2 | 68 | 7 |
| C. Hybrid Rule H | `{0.75, 0.80, 0.40}` | T6, **T3**, T2 | 69 | 7 |

**A and B are byte-identical** — plain 0.80 never flags T4~T6 (0.799 < 0.80), so it behaves exactly
like redundancy being off for this real scenario, delivering T4's redundant duplicate of T6 both
times. **C alone replaces T4 with T3** ("Database access must go through repository interfaces.") —
genuinely distinct guidance (T3~T6 cosine 0.506, T3~T4 cosine 0.395, neither anywhere near either
threshold), not previously delivered by either baseline, at the cost of 1 additional token.

**Answer to the primary question: yes.** Hybrid C delivers real, unique, useful context (T3) that
plain 0.80 misses, and it does so by correctly demoting a genuine duplicate (T4), not by demoting
anything distinct — T3's own near-duplicate scores (with T4 and T6) are nowhere close to either
threshold, so its inclusion is not a side effect of the redundancy machinery misfiring on it.

## DISABLED VS 0.80 VS HYBRID

(Same table as above, token-level.) Framed the other way: **redundancy disabled and redundancy
enabled-at-plain-0.80 are indistinguishable on this real content** — the entire value Phase 2C.6
identified lives specifically in the `[0.75, 0.80)` corroboration band, which only the hybrid rule
reaches at all.

## REAL CODING TASK

`.pilot-tmp/notes-api/` (deleted at cleanup, full source below): `GET /notes/search?q=<query>`, a
`NotesRepository` holding the only reference to note data, a route handler that calls only repository
methods. Matches N1 (plural resource path, `/notes/search`) and N2 (route handlers never touch data
directly) — the same real notes-api memories Phase 2C.4/2C.5 already established, reused, not
recreated.

```
node --test
✔ searchNotes: matches title or body, case-insensitively
✔ searchNotes: empty query returns no results
✔ route handler never touches note data directly -- only calls repository methods
✔ GET /notes/search?q=... returns matching notes over HTTP
✔ GET /notes/search with no match returns an empty results array
tests 5, pass 5, fail 0
```

## CONTEXT ID

Before any code: `getContext`, `project:notes-api`, `maxTokens: 120`, Hybrid Rule H, task verbatim
*"Implement GET /notes/search?q=<query>: a new REST endpoint for searching notes. Must follow this
project's endpoint naming convention, and route handlers must not access the database directly."*

contextId **`19ec69dc-64ca-47e8-bc84-b75d25e22f4c`**, `tokenCount: 119`, `truncated: true`,
`omittedCount: 4`. Delivered exactly N1 (rank 3, 39 tok) and N2 (rank 4, 80 tok) — both global
plural-rule duplicates and the two unrelated globals correctly omitted for this task.

## FEEDBACK

Both delivered memories were genuinely useful (N1 drove the endpoint path, N2 drove the
repository-only data access) — no redundant item was actually delivered in this contextId, so there
was nothing to mark `useful=false/reason=redundant` against (same honest-disclosure pattern every
prior phase used rather than force-fitting the brief's illustrative shape onto a delivery that didn't
match it):

| memoryId | useful | contextId | FeedbackEvent id |
|---|---|---|---|
| N1 (`a0ae3295-…`) | true | `19ec69dc-…` | `e65b39f8-6264-4b13-8654-fb70b57259ab` |
| N2 (`6ccf80c4-…`) | true | `19ec69dc-…` | `dfd9706f-0cf5-449b-a77e-1b73cc001cd2` |

## OUTCOME

| taskId | outcome | contextId | signal | OutcomeEvent id |
|---|---|---|---|---|
| `phase2c7-notes-search-endpoint` | success | `19ec69dc-…` | `{testsPassed:true, humanEdited:false}` | `2d3eb580-41fb-48c0-80a0-b5f4315100e1` |

## EVENT TRACE

Read-only query against `data/brain.db` for `contextId = 19ec69dc-64ca-47e8-bc84-b75d25e22f4c`:
`candidateCount: 6`, `candidateTokenCount: 263`, `tokenCount: 119`. Membership rows: N1 (included,
rank 3, 39 tok), N2 (included, rank 4, 80 tok); both global plural duplicates, 2C.4's global C, and the
Zod rule (omitted, rank/tokenCount null — all 4). 2 FeedbackEvents and 1 OutcomeEvent, both correct
`context_id`.

## TOKEN ACCOUNTING

`sum(tokenCount for included=true) = 39 + 80 = 119`. `ContextEvent.tokenCount = 119`. **Exact match**,
verified by direct SQL.

## EFFICIENCY

Coding-task delivery (real `computeEfficiencyMetrics()`, real feedback labels):

| metric | value |
|---|---|
| candidateTokens | 263 |
| deliveredTokens | 119 |
| usefulDeliveredTokens | 119 |
| redundantDeliveredTokens | 0 |
| contextEfficiency | 1.0 |
| redundantRatio | 0 |
| retrievalEfficiency | 0.4525 (119/263) |
| labeledFraction | 1.0 (2/2) |

**Constrained-scenario comparison** (`CONSTRAINED CONTEXT`'s task-api example, budget 70; A and B
identical, so reported once; labels here are this report's own honest judgment of the delivered
content, not system-recorded feedback, since no feedback call was made against those three
comparison-only contextIds):

| | A / B (disabled / plain 0.80) | C (Hybrid) |
|---|---|---|
| deliveredTokens | 68 | 69 |
| contextEfficiency | 0.75 | **1.0** |
| redundantRatio | **0.25** | **0** |
| retrievalEfficiency | 0.262 (68/260) | 0.265 (69/260) |

`retrievalEfficiency` reported as candidate-pool→delivered-context reduction only, never as "tokens
saved," per instruction.

## PASS/FAIL MATRIX

| Requirement | Result |
|---|---|
| Production classifier reproduces frozen Hybrid C results | PASS — exact TP counts (33/2/0), zero FP, all 4 hard cases |
| 0.785 pair actually retrieved and classified | PASS — unit regression (floor asserted `=0.75`) + live |
| T4~T6 detected | PASS — unit + live |
| N1~G detected | PASS — unit + live |
| 2C.4 A~B rejected | PASS — unit + live, B independent |
| rest-api-c rejected | PASS — unit + frozen regression (correctly not seeded live) |
| No scope regression | PASS — all pre-existing scope-isolation tests unchanged; live B stays independent; `toRedundancyPairs` untouched, its 7 tests pass |
| No ranking regression | PASS — `packages/ranking` untouched by this phase; `RankedResult.score` never read/written by new code |
| Constrained context improves or remains safe | PASS — Hybrid strictly improves (T3 delivered, 0% vs 25% redundant), never regresses |
| Coding task passes | PASS — 5/5 |
| Correlation exact | PASS — feedback/outcome `context_id` verified by direct SQL |
| Token accounting exact | PASS — 39+80=119 exact |
| Repo fully green | PASS — 386/386, typecheck/build/audit clean, both integration suites unchanged |
| Bootstrap remains disabled | PASS — re-confirmed by direct read after cleanup |

No immediate-FAIL condition triggered: no known DISTINCT hard case classified redundant; the storage
floor never blocked a `[0.75,0.80)` pair (proven twice); no project-isolation regression observed
anywhere in Part B.

## IS HYBRID RULE H LIVE-VALIDATED?

**YES.** Every required live target reproduced its offline prediction exactly, using the real,
committed, unit-tested production code — not a script-local reimplementation — against the real
database, across three different real project scopes and both relevant orientation cases
(project-vs-project same-specificity, project-vs-global). The one new finding (live compression) is an
addition to, not a contradiction of, everything measured so far.

## SHOULD HYBRID REDUNDANCY BE ENABLED BY DEFAULT?

**NOT ENOUGH EVIDENCE** — but this is the strongest "not enough" of the whole 2C series, and it's
worth being precise about what's actually still missing. Unlike Phase 2C.4 (found a real precision
bug) or Phase 2C.5/2C.6 (found and then closed a real recall gap), **this phase surfaced zero new
problems** — every prediction held. What remains thin is breadth, not confidence: the entire
real-world positive evidence base is still exactly the two organic near-duplicate pairs Phase 2C.5
found in a single 10-memory, 3-project corpus (now confirmed live, not newly expanded), one real
coding task, and one real constrained-budget comparison. That is a genuine result, not a weak one, but
it is still too narrow a sample to justify a default that would apply to arbitrary future content this
specific rule has never seen. Production configuration was not changed.

## LEARNING READINESS

**NOT READY.** This phase added a small number of new real, correlated events (a handful of
`getContext` calls, 2 FeedbackEvents, 1 OutcomeEvent) — nowhere near a sample large enough for any
statistically meaningful ranking adjustment. No learning mechanism was implemented or proposed.

## RISKS

- **Real-world positive evidence is still exactly 2 pairs.** Live-confirming the same two organic
  near-duplicates Phase 2C.5 found is real, valuable evidence, but it is not new breadth — the
  question "does this rule generalize beyond `task-api` and `notes-api`'s specific content" remains
  open.
- **`FixedSimilarityStore`'s floor-mirroring is a modeling choice, not a certainty about real
  storage.** It was built to mirror `SqliteRetrievalStore`'s own floor-filtering behavior, and the live
  N1~G result independently confirms the same conclusion — but the unit test's guarantee is only as
  good as that mirror being accurate to the real implementation it wasn't literally reading from.
- **Compression's first-ever appearance in this project's pilot history was incidental**, discovered
  while probing a budget for an unrelated reason (T4's reappearance point), not deliberately
  characterized. `2C.4-C` compressing from 58 to ~28 tokens is one data point on how compression
  interacts with redundancy-deprioritized items, not a general finding.
- **The constrained-context efficiency comparison's A/B/C labels are this report's own judgment**, not
  system-recorded feedback (no `brain_feedback` call was made against those three contextIds) — a
  deliberate choice to avoid manufacturing feedback events for a scenario that existed purely to
  compare token allocation, disclosed rather than presented as measured user feedback.
- **MCP `brain_*` tools were unavailable this session** (server disconnected mid-conversation) — Part B
  used the script's own direct Gateway calls for every operation, including feedback/outcome, rather
  than the live-MCP/temp-script channel split every prior pilot used. Still real production code
  against the real database; the only difference is which process made the call.

## RECOMMENDED NEXT STEP

The implementation question is closed — Part A is real, tested, and live-validated. What's left is
breadth of real-world evidence, not another round of validating the same content again:

1. **Widen the organic corpus** (2C.5's own recommended next step, still the right one): more projects,
   more accumulated time, more authors, so the "2 known real near-duplicates" sample actually grows
   rather than being re-confirmed.
2. **If a default-enable is revisited before that**, this phase's evidence is now strong enough that
   the remaining question is specifically "how much real-world breadth is enough," not "does the rule
   work" — a narrower, more tractable question than any prior phase left behind.

STOP.

---

## FINAL VERIFICATION

`.pilot-tmp/` (runner script + temp `notes-api/` app) deleted at cleanup. Fresh full run after deletion:

```
npm run typecheck    PASS, 0 errors, all 14 workspaces
npm run build         PASS
npm test               386/386 passing, 0 failing (367 baseline + 19 new: 15 retrieval, 4 evaluation)
npm audit               0 vulnerabilities
packages/storage        test:integration -- 3/3, unchanged (0.8037/0.5423/0.3667)
packages/evaluation      test:integration -- 2/2, unchanged (71-pair boundary run reproduces 2C.3 exactly)
```

`packages/mcp/src/bootstrap.ts:40` re-read directly after cleanup: still
`{ enabled: false, ...DEFAULT_NEAR_DUPLICATE_POLICY }`.

`git status`: exactly the intentional Part A footprint — 8 modified files, 6 new files (2 code, 2
test, 2 data) — plus `docs/archive/phase-2c/PHASE_2C4_REPORT.md`, `docs/archive/phase-2c/PHASE_2C5_REPORT.md`, and
`docs/archive/phase-2c/PHASE_2C6_REPORT.md`, carried over from prior phases and still awaiting a commit decision,
untouched by this one. No `.pilot-tmp/` artifact remains. No memory in `data/brain.db` was created,
edited, or archived by Part B — only real `getContext`/`feedback`/`recordOutcome` calls against
already-existing memories, the same category of write every prior live pilot made.
