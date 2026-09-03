# Phase 2C.10 — Full-Corroboration Policy Implementation + Live Regression

## PHASE 2C.10 STATUS

Complete. Both gated parts finished: Part A (production implementation of
Strategy H2, TDD-first, full-repo verification green) and Part B (live
regression against the real `data/brain.db` via a temporary, in-process-only
Gateway). Redundancy remains **disabled by default** —
`packages/mcp/src/bootstrap.ts:40` is unchanged: `{ enabled: false,
...DEFAULT_NEAR_DUPLICATE_POLICY }`.

## POLICY CHANGE

**Before (Rule H, 2C.6/2C.7):**

```
cosine >= 0.80
OR
(cosine >= 0.75 AND containment >= 0.40)
```

**After (Strategy H2, this phase):**

```
cosine >= candidateFloor (0.75)
AND
containment >= containmentThreshold (0.40)
```

No unconditional cosine-only bypass at any cosine value. `highConfidenceThreshold`
(and its default, `DEFAULT_HIGH_CONFIDENCE_THRESHOLD = 0.8`) is removed
entirely from `NearDuplicatePolicy` — it was not kept as a dead field. Every
caller that constructed a policy literal naming it has been migrated to the
narrower two-field shape (`candidateFloor`, `containmentThreshold`); no
production or test code references it anymore (confirmed by a whole-repo
grep before and after this phase's changes).

`RedundancyConfig` (`packages/gateway/src/gateway.ts`) is `{ enabled: boolean
} & NearDuplicatePolicy` — an intersection type — so it followed the
`NearDuplicatePolicy` change automatically; only its docblock needed editing.

## FILES CHANGED

**Production:**
- `packages/core/retrieval/src/lexical-containment.ts` — `NearDuplicatePolicy`
  narrowed to `{ candidateFloor, containmentThreshold }`; `isNearDuplicate()`
  rewritten as the single H2 predicate; `DEFAULT_HIGH_CONFIDENCE_THRESHOLD`
  removed; docblock updated.

**Migrated callers/tests (narrowest safe change — drop the removed field,
nothing else):**
- `packages/core/retrieval/src/lexical-containment.test.ts`
- `packages/core/retrieval/src/service.test.ts`
- `packages/gateway/src/gateway.ts` (docblock only)
- `packages/gateway/src/gateway.test.ts`
- `packages/evaluation/src/redundancy-gate.test.ts`

**New H2 evaluation fixture:**
- `packages/evaluation/src/h2-full-corroboration.data.ts`
- `packages/evaluation/src/h2-full-corroboration-regression.test.ts`
- `packages/evaluation/package.json` (registered the new test file)

**This report:**
- `docs/PHASE_2C10_REPORT.md`

No ranking, token, context, scope-authorization, or learning code was
touched. `git status` after final cleanup shows exactly these files plus the
five pre-existing untracked 2C.4–2C.9 reports — nothing else.

## TDD EVIDENCE

Per the test-driven-development discipline: tests written and watched fail
*before* the production change.

**RED** (`npm test` in `packages/core/retrieval`, against the still-unmodified
Rule H): 6 of the newly written/modified tests failed, each `true !== false`
— the correct failure, for the correct reason (Rule H's unconditional
cosine bypass still firing):
- cosine 0.99 / zero overlap → expected `false`, got `true`
- cosine 0.80 / zero containment → expected `false`, got `true`
- cache-service FP (0.8813 / 0.3750) → expected `false`, got `true`
- job-worker FP (0.8380 / 0.3333) → expected `false`, got `true`
- file-api known-loss (0.8428 / 0.25) → expected `false`, got `true`
- cache-service known-loss (0.8016 / 0.3846) → expected `false`, got `true`

**GREEN** (after implementing H2): the same 6 tests pass; the retrieval
package's full suite passes at 50/50 (baseline was 45/45 — +5 net new
tests: 2 tests repurposed in place to assert the corrected H2 behavior, 1
existing test's boundary value tightened from 0.749 to the literal 0.7499,
5 new tests added for the mandatory real-evidence cases).

The 12 mandatory cases from the phase brief are covered as follows (10 as
direct unit tests in `lexical-containment.test.ts`, 2 already covered
unchanged by pre-existing tests whose expected values did not need to
change):

| # | Case | Status |
|---|---|---|
| 1 | cosine 0.99, containment <0.40 → DISTINCT | new test, GREEN |
| 2 | cache FP (0.8813/0.375) → DISTINCT | new test, GREEN |
| 3 | job-worker FP (0.8380/0.3333) → DISTINCT | new test, GREEN |
| 4 | T4~T6 (0.799007/1.0) → NEAR_DUPLICATE | pre-existing test, unchanged, still GREEN |
| 5 | N1~G (0.785122/0.50) → NEAR_DUPLICATE | pre-existing test, unchanged, still GREEN |
| 6 | historical global/global (0.999573/1.0) → NEAR_DUPLICATE | new test, GREEN |
| 7 | rest-api-c (0.772566/0.3333) → DISTINCT | pre-existing test, unchanged, still GREEN |
| 8 | 2C.4 A~B (0.762576/0.2857) → DISTINCT | pre-existing test, unchanged, still GREEN |
| 9 | file-api known loss (0.8428/0.25) → DISTINCT | new test, GREEN |
| 10 | cache-service known loss (0.8016/0.3846) → DISTINCT | new test, GREEN |
| 11 | 0.7499, containment 1.0 → DISTINCT | existing test, value tightened to the literal, GREEN |
| 12 | empty/stopword-only → deterministic, no NaN | 3 pre-existing tests, unchanged, still GREEN |

## 109-PAIR REGRESSION

`packages/evaluation/src/h2-full-corroboration-regression.test.ts` combines
the frozen 99-pair corpus (`hybrid-classifier-regression.data.ts`, unchanged)
with 10 new metrics-eligible `organic-2C8` pairs
(`h2-full-corroboration.data.ts`) and runs the real, compiled
`isNearDuplicate()` — never a reimplementation — against all 109.

The 10 organic-2C8 pairs' content was read **read-only** directly from the
live `data/brain.db` (all 14 underlying memories still exist there,
unmodified since 2C.8). Before writing them into the fixture, every pair's
`containmentCoefficient()` was computed against the real content and checked
against `docs/PHASE_2C9_REPORT.md`'s reported containment value — all 10
matched exactly (to 4 decimal places): 0.3750, 0.3333, 0.2500, 0.3846,
0.2174, 0.3077, 0.2000, 0.2105, 0.2667, 0.2105.

**Result — reproduces `docs/PHASE_2C9_REPORT.md`'s H2 numbers exactly:**

| | TP | FP | TN | FN | Precision | Recall |
|---|---|---|---|---|---|---|
| H2 (this phase, live production code) | 35 | 0 | 66 | 8 | 1.0000 | 0.8140 |
| H2 (2C.9, offline projection) | 35 | 0 | 66 | 8 | 1.0000 | 0.8140 |

Exact match. Per the phase's own gate, this means Part B was authorized to
proceed. A dedicated test also confirms the `authored`/`organic-pre-2C8`/
`control` groups are byte-identical to Strategy A under H2 (zero collateral
change to any previously-validated detection).

## TEST COUNTS

| | Before (2C.9 baseline) | After (2C.10) |
|---|---|---|
| `npm test` | 386/386 | **395/395** (+9: evaluation 64→68, retrieval 45→50) |
| `npm run typecheck` | clean | clean, all workspaces |
| `npm run build` | clean | clean, all workspaces |
| `npm audit` | 0 vulnerabilities | 0 vulnerabilities |
| `packages/storage` `test:integration` | 3/3 (0.8037/0.5423/0.3667) | 3/3, **identical** values (storage untouched) |
| `packages/evaluation` `test:integration` | 2/2 (rest-api-c 0.772566) | 2/2, **identical** (this suite never calls `isNearDuplicate`) |

Per-package breakdown after 2C.10: evaluation 68, gateway 33, knowledge 9,
mcp 20, storage 51, compression 7, context 29, contracts 53, learning 2,
memory 1, ranking 23, retrieval 50, test-fixtures 23, token 26.

## LIVE ENVIRONMENT

A temporary script wired its own `Gateway` in-process against the real
`data/brain.db`, `LocalEmbeddingProvider`, `SqliteMemoryRepository`,
`SqliteRetrievalStore`, and `SqliteEventStore` — with redundancy explicitly
enabled (`{ enabled: true, candidateFloor: 0.75, containmentThreshold: 0.4
}`) **only in that one script's own Gateway instance**.
`packages/mcp/src/bootstrap.ts` was never opened for writing this phase.
15 real `getContext` calls were made (14 audit probes + 1 real coding-task
context), each producing a real, durable `ContextEvent` (and its
`RetrievalEvent`) in `data/brain.db`. All temporary scripts and the
recreated throwaway pilot service (`.pilot-tmp/`) were deleted at cleanup.

## CACHE FP RESULT

Pair: `909d5511` ("cache backend throws on read or write → degrade to a
direct repository fetch") ~ `f4ebe0ae` ("cache is never the source of truth;
populate it from the repository on a miss"). Real cosine 0.8813, real
containment 0.3750.

| Probe | Budget | contextId | Result |
|---|---|---|---|
| Ample | 1000 tok | `8a10d3f3-…` | Both delivered, rank 1/2, **`redundantWith: null`** for both |
| Tight (matches 2C.8's own probe) | 50 tok | `9b288ea7-…` | Neither half of the pair fits (55/69 tok each > 50); the one item that fits is `e104c851` (50 tok, a third, genuinely distinct memory) |
| Coexistence (= 55+69 exactly) | 124 tok | `cdde08fc-…` | **Both delivered, `tokenCount: 124` exactly, `redundantWith: null` for both** |

No probe at any budget shows a `redundantWith` edge between this pair.

## JOB-WORKER FP RESULT

Pair: `05fede4b` ("retry up to 3 attempts, no backoff") ~ `5b880968`
("exhausted-retry jobs go to a dead-letter queue, never silently dropped").
Real cosine 0.8380, real containment 0.3333.

| Probe | Budget | contextId | Result |
|---|---|---|---|
| Ample | 1000 tok | `ab037763-…` | Both delivered, rank 1/2, **`redundantWith: null`** for both |
| Tight (matches 2C.8's own probe) | 80 tok | `f43cdab0-…` | Only `5b880968` fits (70 tok); `05fede4b` (61 tok) omitted |
| Coexistence (= 70+61 exactly) | 131 tok | `9f5ebfc2-…` | **Both delivered, `tokenCount: 131` exactly, `redundantWith: null` for both** |

## T4~T6 RETENTION

`267ce2e6` (T6, "Task API route handlers must never directly access the
SQLite database… must go through TaskRepository") ~ `be32099f` (T4, "Route
handlers must never access SQLite directly"). Cosine 0.799007, containment
1.0. Live probe (scope `task-api`, contextId `a8b24ac7-…`): still
**NEAR_DUPLICATE** — T6 ranked 1 (anchor), T4 ranked 2 with
`redundantWith: <T6's id>`. Correctly oriented: the shorter, subsumed fact
demotes behind the more elaborated one.

## N1~G RETENTION

`a0ae3295` (N1, project-scoped notes-api plural-resource rule) ~ `cb18ede2`
(G, the global plural-resource rule). Cosine 0.785122, containment 0.50.
Live probe (scope `notes-api`, contextId `35531d83-…`): still
**NEAR_DUPLICATE** — N1 (project) ranked 1, anchor; G (global) ranked 2,
`redundantWith: <N1's id>`. Scope-aware orientation intact: the project
memory anchors over the global one, exactly the pre-existing "project always
beats global" invariant, untouched by this phase.

## HISTORICAL DUPLICATE RETENTION

`a76fdf66` ~ `cb18ede2` (both global; content-identical to the frozen
`rest-api-a2` pair per 2C.9's own dedup finding). Cosine 0.999573,
containment 1.0. Live probe (scope global, contextId `f3ece303-…`): still
**NEAR_DUPLICATE** — confirms removing the unconditional cosine bypass does
not break obvious near-exact duplication.

## KNOWN RECALL LOSSES

Both are ground-truth `NEAR_DUPLICATE` in the 109-pair fixture and were left
that way — not relabeled to flatter H2's precision.

- **file-api**: `be174a56` (stream-abort backstop) ~ `ce0fa075` (pre-body
  header check). Cosine 0.8428, containment 0.25.
- **cache-service**: `e104c851` (route handlers only call the service) ~
  `f4ebe0ae` (cache never the source of truth). Cosine 0.8016, containment
  0.3846.

Both live-confirmed **DISTINCT** (`redundantWith: null`) in every probe this
phase ran, including the dedicated "both fit" budget probes below.

## CONTEXT IMPACT OF MISSED DUPLICATES

**Classification loss:** confirmed, live, for both pairs (above).

**Context impact — budget-dependent, quantified, not theoretical:**

| Project | Budget | contextId | Observed |
|---|---|---|---|
| file-api | 40 tok (tight) | `601a4b73-…` | Neither half fits alone (62/75 tok each); a small, genuinely distinct 26-tok fact fills the slot instead. **No harm at this budget.** |
| file-api | 137 tok (= 62+75 exactly) | `d33f9142-…` | **Both near-duplicate halves delivered together**, `tokenCount: 137` |
| cache-service | 119 tok (= 50+69 exactly) | `af012f0f-…` | **Both near-duplicate halves delivered together**, `tokenCount: 119` |

At the "both fit" budgets, the recall loss is real: two substantially
overlapping facts consume a combined 137/119 tokens that a correctly
classified system would have spent on one of the pair plus at least one
more genuinely distinct fact (for file-api at 137 tok, a 55-token distinct
upload-rejection rule sits in the omitted set that a demoted duplicate would
have made room for). Outside that budget window — either too tight for
either half, or ample enough that nothing is omitted anyway — the loss is
invisible in delivered context.

This is a real, disclosed cost. It is also structurally narrower than the
two false positives it replaces: 2C.8 found the false positives
context-impacting at **every** budget it tested (both tight probes showed
demotion or truncating compression); this phase's recall-loss probing found
harm only inside a specific mid-size budget window, and no harm at all at a
realistically tight one.

## REAL CODING TASK

**Project:** `pilot-cache-service`. The original 2C.8 pilot source was
already deleted at that phase's own cleanup (only its memories persist in
`data/brain.db`, which is the durable artifact); a minimal throwaway
service was recreated under `.pilot-tmp/` for this one task and deleted
again at this phase's cleanup.

**Task:** implement `CacheAsideItemService.getItem(id)`, chosen because it
genuinely requires both formerly-conflicting facts at once — degrade to a
direct repository fetch if the cache backend throws on read or write
(`909d5511`), and populate the cache from the repository on a genuine miss
because the cache is never the source of truth (`f4ebe0ae`).

**Context retrieved before implementation** (H2 enabled): contextId
`8afc541c-ae99-4326-a56e-d27b1b16ba1d`, 8 candidates, ample 2000-tok budget,
375 tok delivered, 0 omitted. `909d5511` rank 1, `f4ebe0ae` rank 2, **both
`redundantWith: null`** — genuinely coexisting, not redundancy-demoted.

**TDD:** 4 tests written first. RED confirmed (`ERR_MODULE_NOT_FOUND` — the
implementation did not exist yet, the correct failure reason). Implemented
`CacheAsideItemService`; all 4 GREEN:
1. cache hit returns the cached value without touching the repository
2. cache miss fetches from the repository and populates the cache
3. cache backend throwing on read degrades to a direct repository fetch, never throws
4. cache backend throwing on write after a miss still returns the repository value, never throws

## CONTEXT ID

`8afc541c-ae99-4326-a56e-d27b1b16ba1d`

## FEEDBACK

8 feedback events recorded against that exact contextId:

| Memory | useful | reason |
|---|---|---|
| `909d5511` | true | — directly implemented (degrade-on-throw) |
| `f4ebe0ae` | true | — directly implemented (populate-on-miss) |
| `e7c58ac7` | false | irrelevant — eviction policy, not exercised by `getItem` |
| `e104c851` | false | irrelevant — constrains callers, not this layer |
| `05ad05de` | false | irrelevant — HTTP-boundary rule, no route touched |
| `cb18ede2` | false | irrelevant — REST naming, no endpoint touched |
| `a76fdf66` | false | irrelevant — REST naming, no endpoint touched |
| `f8ba7735` | false | irrelevant — request validation, no request handled |

## OUTCOME

1 outcome event: contextId `8afc541c-…`, taskId
`phase2c10-real-task-cache-getitem`, `outcome: success`, `signal:
{"testsPassed":true}`.

## EVENT TRACE

Verified by direct SQL against `data/brain.db` for all 15 contextIds this
phase produced (14 audit probes + the 1 real task):
- Every `ContextEvent` has a matching `RetrievalEvent` via `retrieval_event_id`.
- The real task's contextId has exactly **8** `FeedbackEvent`s and exactly
  **1** `OutcomeEvent`.
- All **14** audit-only probes have **0** `OutcomeEvent`s — matching 2C.8's
  own convention that measurement probes are not task completions.

## TOKEN ACCOUNTING

`sum(context_event_memories.token_count WHERE included=1) ==
context_events.token_count`, verified **exact for all 15 contextIds**: 375,
50, 467, 70, 260, 263, 144, 419, 26, 375, 124, 131, 137, 119, 375. Zero
drift anywhere.

## CURRENT H VS H2

**Cache pair, ~50-tok budget:**

| | Redundancy pair detected? | Delivered | Omitted/compressed |
|---|---|---|---|
| Current H (2C.8, frozen historical, contextId `cdbc4571-…`) | Yes — `909d5511 redundantWith f4ebe0ae` | `f4ebe0ae` only, **compressed 69→20 tok**, truncated mid-sentence, lost a clause | `909d5511` (55 tok) fully omitted |
| H2 (this phase, live, contextId `9b288ea7-…`) | **No** | `e104c851` only (50 tok, uncompressed) — a different, genuinely distinct memory | `909d5511`/`f4ebe0ae` both omitted **on size alone**, no redundancy flag on either |

**Job-worker pair, ~80-tok budget:**

| | Redundancy pair detected? | Delivered | Omitted |
|---|---|---|---|
| Current H (2C.8, frozen historical, contextId `2575fee5-…`) | Yes — `05fede4b redundantWith 5b880968` | `5b880968` only (70 tok) | `05fede4b` (61 tok) omitted, **flagged redundant** |
| H2 (this phase, live, contextId `f43cdab0-…`) | **No** | `5b880968` only (70 tok) — same delivered set | `05fede4b` omitted on **rank/size**, `redundantWith: null` confirmed in the ample run |

The job-worker pair's delivered set happens to look the same at this one
budget under both policies — but the *mechanism* is different, and that
difference matters: under Current H, a consuming agent's metadata falsely
asserts `05fede4b` is a duplicate of `5b880968`. Under H2, no such claim
exists; its absence here is ordinary budget arithmetic, and the coexistence
probe (131 tok) proves it is not actually suppressed.

## PASS/FAIL MATRIX

| Criterion | Result |
|---|---|
| Production H2 reproduces 35/0/66/8 exactly | **PASS** |
| Cache FP rejected live | **PASS** |
| Job-worker FP rejected live | **PASS** |
| T4~T6 retained | **PASS** |
| N1~G retained | **PASS** |
| Historical obvious duplicate retained | **PASS** |
| Scope isolation intact | **PASS** (full regression suite's isolation tests unchanged and green; no cross-project leakage observed in any of the 15 live probes) |
| Ranking untouched | **PASS** (no file under `packages/core/ranking` in this phase's diff) |
| Coding task succeeds | **PASS** (4/4 tests green, TDD-first) |
| Event correlation exact | **PASS** |
| Token accounting exact | **PASS** |
| Repo fully green | **PASS** (395/395 tests, clean typecheck/build, 0 audit vulnerabilities, both integration suites green) |
| Bootstrap remains disabled | **PASS** |

## IS H2 IMPLEMENTED CORRECTLY?

**YES.**

## IS H2 LIVE-VALIDATED?

**YES.**

## DOES H2 REMOVE THE FALSE POSITIVES?

**YES.**

## IS THE RECALL LOSS ACCEPTABLE?

**YES.** It is real and disclosed (see CONTEXT IMPACT above), but it is
narrower than the harm it replaces — the two false positives were
context-impacting at every budget 2C.8 tested; the two recall losses are
context-impacting only inside a specific mid-size budget window and are
invisible at a realistically tight one. This is consistent with the
project's own stated policy for this feature: redundancy suppression is
meant to be high-precision, and false-positive demotion of distinct
knowledge is considered more harmful than failing to suppress an actual
duplicate.

## SHOULD REDUNDANCY BE ENABLED BY DEFAULT?

**NOT ENOUGH EVIDENCE.** H2 fixes the two known, context-impacting false
positives and live-validates cleanly against every hard case this project
has accumulated — but this phase deliberately ran no fresh organic breadth
pilot (new projects, new organic pairs). 2C.9 flagged an "interleaved
TP/FP containment ordering" at the `organic-2C8` ≥0.80 band that a
larger, differently-distributed sample could in principle reproduce or
contradict; that question is still open for H2 specifically. A fresh
organic breadth phase (2C.8-style methodology, new projects) is required
before any default-enable decision, per the phase's own instruction.

## LEARNING READINESS

**NOT READY.** Unchanged from every prior phase. This phase's one real task
adds one more correlated feedback+outcome sample, but volume remains small
and no learning mechanism was implemented, prototyped, or scaffolded (per
instruction, none was attempted).

## RISKS

- **No fresh organic breadth evidence for H2 itself.** Every pair this
  phase live-validated (the 2 FPs, the 2 known losses, T4~T6, N1~G, the
  historical duplicate) was already characterized offline in 2C.8/2C.9;
  Part B confirmed the production code reproduces those characterizations
  live, but did not generate new organic evidence the way 2C.8 did for
  Rule H.
- **containmentThreshold (0.40) was not re-tuned**, per explicit
  instruction. 2C.9's "interleaved TP/FP" caveat at the `organic-2C8` band
  still stands as an open question for any future, larger organic sample.
- **The recall-loss context impact is budget-window-dependent**, not
  universal — real inside roughly `[max(a,b), a+b)` tokens for a given
  pair, invisible outside it. Reported precisely above; do not generalize
  it to "always harmful" or "never harmful."
- **The real-task pilot service is throwaway** (`.pilot-tmp/`, deleted at
  cleanup), matching 2C.7/2C.8/2C.9 precedent — the code artifact does not
  persist; only its event trail in `data/brain.db` does.
- This phase wrote 15 new real event rows (retrieval/context/feedback/
  outcome, append-only) to the production `data/brain.db`, consistent with
  every prior 2C phase's live-validation methodology.

## RECOMMENDED NEXT STEP

Do not enable by default. Run a fresh organic breadth pilot against H2
specifically — new projects, new real coding tasks, 2C.8's own methodology
— watching in particular whether the interleaved TP/FP containment
ordering 2C.9 found at the `organic-2C8` ≥0.80 band recurs at scale. Do not
tune `containmentThreshold` inside that pilot; if retuning is ever
warranted, it should go through its own dedicated offline-characterization
phase first, per the sequence this project has used throughout (offline
corroboration → production implementation → live pilot → organic breadth,
each kept as a separate, separately-gated phase).

STOP. Redundancy is not enabled by default.
