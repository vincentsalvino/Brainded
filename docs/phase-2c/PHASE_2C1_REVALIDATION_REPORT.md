# Phase 2C.1 Real-Pilot Revalidation Report

Verification-only follow-up to `docs/phase-2c/PHASE_2C1_REPORT.md`. No production code changed except one
doc-comment clarification (noted below); every number here is copied verbatim from a real tool call,
a real SQL query, or a real command run in this session against the real `data/brain.db`.

## PHASE 2C.1 REAL PILOT STATUS

Complete. The exact defect `docs/phase-2c/PHASE_2C_PILOT_REPORT.md` found in production is now reproduced as
fixed, on the same real memories, in the same real database, using the fixed code. All 5 requested
tests ran; all PASS.

## PRE-FLIGHT

1. **Changes committed?** No. `git log --oneline -5` still shows `ce42318` (the `worktree-phase-2c-efficiency-redundancy` merge) at HEAD — same as before Phase 2C.1 started. The 6 files from `docs/phase-2c/PHASE_2C1_REPORT.md`'s `FILES CHANGED` are still sitting unstaged; `docs/phase-2c/PHASE_2C1_REPORT.md` and `docs/phase-2c/PHASE_2C_PILOT_REPORT.md` are still untracked. Not committed by this task either — only commit when explicitly asked. Flagging this plainly rather than assuming it; happy to commit on request.
2. **git status clean?** No, for the reason above — but the working tree contains exactly the expected 6 modified files + 2 untracked reports, nothing unexpected.
3. **Redundancy still disabled by default?** Yes — `packages/mcp/src/bootstrap.ts:39` still reads `{ enabled: false, threshold: DEFAULT_REDUNDANCY_THRESHOLD }`, absent from every diff in this task.
4. **typecheck / build / test / audit** — run fresh in this session (see `COMMANDS`/`FAILURES / ANOMALIES` below): all green.
5. **Real-model integration suite** — run fresh, separately: 3/3 green.

Nothing red. Proceeding per instruction.

One documentation-only change made in this task, flagged as its own item since the brief asked for
verification only: `packages/core/retrieval/src/redundancy.ts`'s comment clarified that `project <
session` in `SCOPE_SPECIFICITY` is not a general hierarchy claim — `scopeIncludes()` means a
project-scoped query and a session-scoped query never share a candidate pool, so this function can
never actually compare a project memory against a session memory; the ordering only ever resolves
global-vs-project or global-vs-session in practice. Comment only — `SCOPE_SPECIFICITY`'s values,
`toRedundancyPairs()`'s logic, and every test's expected output are unchanged (confirmed: same
357/357 pass count before and after this edit).

## REAL MODEL / DATABASE

`data/brain.db`, same file the live MCP connection uses. `LocalEmbeddingProvider` (real model, no
mock). Same temporary mechanism as `docs/phase-2c/PHASE_2C_PILOT_REPORT.md`: a script mirroring
`bootstrap.ts`'s exact `Gateway` wiring with `{enabled:true}`, deleted at cleanup, zero repository
files modified to build it. `git status` before and after this task's scaffolding: identical.

## MEMORIES USED

Resolved from the live database via `brain_recall`, not re-seeded (all four already existed, all
`status:"active"`):

| Label | id | scope | content |
|---|---|---|---|
| A | `60aba615-1cd9-44be-a768-c9dde4b1aecd` | project:phase2c-pilot | "phase2c-pilot REST endpoints use plural resource paths such as /notes and /tasks." |
| B | `0416746e-256e-4cda-a77e-0426617f0ba5` | project:phase2c-pilot | "phase2c-pilot database access must go through repository interfaces..." |
| C | `a76fdf66-4d80-4773-843a-53a2d4435a53` | global | "REST API resources should use plural nouns in endpoint paths, such as /notes and /tasks." |
| C-pre (pre-existing, not this pilot's) | `cb18ede2-7913-45b1-b55d-0a9b640b6cda` | global | "REST API resources should use plural nouns in endpoint paths, such as /tasks and /notes." |

## RAW RANKING

Task: *"Implement a new REST endpoint that must follow this project's endpoint naming convention and
database architecture."* (verbatim, same as the original pilot). Scope `project:phase2c-pilot`.
Candidate pool: all 4, unchanged from the original pilot (ranking itself untouched by 2C.1):

| rank | memory | score | scope |
|---|---|---|---|
| 1 | C | 0.9 | global |
| 2 | C-pre | 0.897 | global |
| 3 | A | 0.478 | project |
| 4 | B | 0 | project |

Same raw scores as `docs/phase-2c/PHASE_2C_PILOT_REPORT.md` reported (confirms `rank()`/`computeScore()`
genuinely untouched). **A still ranks below both global copies on raw relevance** — this is the exact
condition that triggered the original bug, still present, deliberately unchanged.

## REDUNDANCY ORIENTATION

`findSimilarPairs` over these 4 (real embedding model): C~C-pre similarity 0.9996, A~C 0.805,
A~C-pre 0.805 — all three pairs above the 0.75 production threshold, a genuine 3-way redundant
cluster. Oriented pairs (`toRedundancyPairs`, fixed code):

| a (anchor) | b (demoted) | similarity | why |
|---|---|---|---|
| C | C-pre | 0.9996 | same specificity (both global) → rank decides, C outranks C-pre |
| **A** | **C** | 0.805 | different specificity → **project anchors despite ranking worse** |
| **A** | **C-pre** | 0.805 | different specificity → **project anchors despite ranking worse** |

Compiled: **A → non-redundant** (no `redundantWith`). **B → non-redundant.** **C → redundant, anchored
to A.** **C-pre → redundant, anchored to C** (first-write-wins on the highest-similarity pair, per
existing `compiler.ts` design — the transitive chain C-pre→C→A still correctly leaves only A and B as
non-redundant). This is the complete reversal of the original bug: **A is now the root of the whole
cluster**, despite having the worst raw rank of the three plural-rule memories.

## CONSTRAINED-BUDGET RESULT

Same task, `maxTokens: 90` (identical to the original pilot's chosen boundary). contextId
`3cc9dd64-5281-4ad9-8be8-8b5e26df9867`, `tokenCount: 90`, `omittedCount: 1`.

Delivered: **A** (rank 3, non-redundant), **B** (rank 4, non-redundant), **C** (rank 1, redundant,
compressed to fit the leftover budget). Omitted: **C-pre** only.

Both PROJECT memories (A, B) are included — the core fix's success, reproduced on real data. One
nuance worth stating precisely rather than glossing: of the two redundant global copies, only C-pre
is fully **omitted**; C survives via **compression** (it still costs 21 of the 90 tokens) because
`optimizeContext`'s two-pass design gives every item a compression attempt before counting it omitted,
and C's better raw rank means it reaches that attempt with more budget left than C-pre does. This is
pre-existing token-optimizer behavior, not a 2C.1 change, and not something this verification-only
task touches — noted under `FAILURES / ANOMALIES`, not treated as a fail. PASS on the substance the
brief asked for (both project memories included; the previously-lost one, A, is now present and is
the non-redundant anchor).

## AMPLE-BUDGET RESULT

Same task, `maxTokens: 500`. contextId `3eb9ab71-2afc-4ffd-83df-6730faed3d8d`, `tokenCount: 129`,
`omittedCount: 0` — all 4 delivered. A available, B available, both global copies reappear (C
`redundantWith: A`, C-pre `redundantWith: C`), nothing archived or deleted. PASS.

## GLOBAL FALLBACK

Scope `project:phase2c-global-pilot` (no project-specific equivalent there — A and B are structurally
invisible to this scope, not merely unranked). Task: *"Which REST resource-path naming convention
should this project follow?"* contextId `2e98d16a-ef5a-4b7f-b1b3-cc6d319cad6b`, `tokenCount: 60`,
`omittedCount: 0`. Delivered: C (rank 1, no `redundantWith` — only a global-vs-global comparison is
possible here, same-specificity, rank decides exactly as before) and C-pre (rank 2, `redundantWith:
C`). Global knowledge remains fully usable with no project equivalent to prefer. PASS.

## PROJECT ISOLATION

Same scope, task: *"What database architecture does phase2c-pilot use?"* — names the other project
directly. contextId `6c63b263-5dd9-4591-884f-0531ce8cc199`. Identical delivery to `GLOBAL FALLBACK`
(C, C-pre). **Memory B never appears.** PASS, unambiguous.

## REAL CODING TASK

Task: *"Implement GET /notes/search?q=<query>: a new REST endpoint for searching notes. Must follow
this project's endpoint naming convention and database architecture, and route handlers must not
access the database directly."* Scope `project:phase2c-pilot`, `maxTokens: 90`, `taskId:
"phase2c-pilot-notes-search-revalidation"`.

contextId **`d63321ac-2842-484a-a3c5-9ca82476190c`**, `tokenCount: 90`, `omittedCount: 1`.

| rank | memory | delivered? |
|---|---|---|
| 1 | C-pre (`redundantWith: A`, compressed) | yes |
| — | C | **no** (omitted) |
| 3 | **A** (non-redundant) | **yes** |
| 4 | B (non-redundant) | yes |

Same qualitative result as `CONSTRAINED-BUDGET RESULT` above, on a second, independently-phrased task
— A included as the non-redundant anchor, B included, one of the two global copies fully omitted, the
other compressed in. Reproduces cleanly; not a one-off.

Then implemented the identical tiny test project (`routes/notes.js` → `repositories/notes-repository.js`,
`node:http`, zero new dependencies) and ran its tests:

```
✔ searchNotes: matches title or body, case-insensitively
✔ searchNotes: empty query returns no results
✔ GET /notes/search?q=... returns matching notes over HTTP
✔ GET /notes/search with no match returns empty results array
tests 4, pass 4, fail 0
```

Removed along with the rest of `.pilot-tmp/` at cleanup (source is identical, byte-for-byte, to the
version already preserved in `docs/phase-2c/PHASE_2C_PILOT_REPORT.md`'s `IMPLEMENTATION RESULT`).

## CONTEXT ID

`d63321ac-2842-484a-a3c5-9ca82476190c`. Non-null, real UUID, used unmodified for every feedback/outcome
call below and every row in `EVENT TRACE`.

## FEEDBACK / OUTCOME

This time the brief's anticipated delivery shape and the real delivery shape **match** (unlike the
original pilot) — all three feedback judgments are against memories genuinely present in this exact
delivery, nothing fabricated:

| memoryId | useful | reason | FeedbackEvent id |
|---|---|---|---|
| A (`60aba615-…`) | true | — | `d36e48ed-f2e1-48d1-bf9c-3bcba30ee2e0` |
| B (`0416746e-…`) | true | — | `3cf38ad3-a273-4108-9d9d-cfee3201a087` |
| C-pre (`cb18ede2-…`) | false | redundant | `69a6b6a1-104b-4f39-94b9-53a73242ad5e` |

Outcome: `taskId: phase2c-pilot-notes-search-revalidation`, `outcome: success`,
`signal: {testsPassed:true, humanEdited:false}`, `OutcomeEvent id: 25b85b45-88e0-4945-8fac-66d2564dc38d`.

## EVENT TRACE

Read-only SQL, `contextId = d63321ac-2842-484a-a3c5-9ca82476190c`:

**ContextEvent:** `candidateCount: 4`, `candidateTokenCount: 129`, `tokenCount: 90`, `retrievalMs: 22`,
`rankingMs: 0`, `compileMs: 1`, `optimizeMs: 0`.

**ContextEventMemory (4 rows):** C-pre (included, rank 1, 21 tok), A (included, rank 3, 27 tok), B
(included, rank 4, 42 tok), C (included=false, rank null, tokenCount null).

**FeedbackEvents (3)** and **OutcomeEvent (1)**: all `context_id = d63321ac-…`, matching the table
above exactly.

## TOKEN ACCOUNTING

`21 + 27 + 42 = 90`. `ContextEvent.tokenCount = 90`. **Exact match**, verified by direct SQL.

## BEFORE VS AFTER

Same task phrasing, same budget (90), same real memories, same real embedding model, in each pair:

| | contextId | Delivered | Omitted |
|---|---|---|---|
| **BEFORE** (Step 4, `docs/phase-2c/PHASE_2C_PILOT_REPORT.md`) | `934ded47-fc66-45ab-94ae-92b720eeddcb` | C, B | **A**, C-pre |
| **AFTER** (this task) | `3cc9dd64-5281-4ad9-8be8-8b5e26df9867` | C (compressed), **A**, B | C-pre |

| | contextId | Delivered | Omitted |
|---|---|---|---|
| **BEFORE** (Step 8, real coding task) | `95ab0078-47ee-4f1f-8555-0b668550a539` | C-pre, B | **A**, C |
| **AFTER** (this task, real coding task) | `d63321ac-2842-484a-a3c5-9ca82476190c` | C-pre (compressed), **A**, B | C |

In both real, independently-phrased tasks: **A went from always-demoted-and-omitted to
always-anchor-and-included.** That is the entire defect `docs/phase-2c/PHASE_2C1_REPORT.md` set out to fix,
confirmed against the exact memories and exact task phrasings that originally exposed it.

## TEST COUNTS

357/357 — unchanged from `docs/phase-2c/PHASE_2C1_REPORT.md`'s own count. This task is verification-only and
added no test surface (the redundancy.ts edit was comment-only).

## COMMANDS

```
npm run typecheck
npm run build
npm test
npm audit
```
Then, separately: `cd packages/storage && npm run test:integration`.

Run twice in this session: once as `PRE-FLIGHT`, once as `FAILURES / ANOMALIES`'s fresh final run
(after the comment edit) — both times identical results.

## FAILURES / ANOMALIES

No technical failure. Two items worth naming precisely, neither a fail:

1. **Not committed** (`PRE-FLIGHT` #1) — factual state, not an error; not committed by this task either, absent explicit instruction to do so.
2. **Compression-before-omission at the 90-token boundary** (`CONSTRAINED-BUDGET RESULT`) — the redundant item that loses is not always cleanly excluded; the two-pass optimizer gives it a compression attempt first, so it can still spend part of the budget. Pre-existing `packages/core/token` behavior, unrelated to and untouched by 2C.1, out of scope for this verification task.

Fresh full-suite run, this session: `npm run typecheck` PASS · `npm run build` PASS · `npm test`
**357/357** · `npm audit` **0 vulnerabilities** · `packages/storage`'s `test:integration` **3/3**,
real-model values (0.804 / 0.542 / 0.367) identical to every prior run.

## SHOULD REDUNDANCY BE ENABLED BY DEFAULT?

`NOT ENOUGH EVIDENCE`

Genuinely closer than `docs/phase-2c/PHASE_2C1_REPORT.md`'s answer, and every one of the ticket's stated YES
prerequisites is now met: the exact prior real failure now passes (twice, two phrasings), global
fallback passes, isolation passes, the real coding task passes end-to-end with correct
feedback/outcome correlation, no ranking/token regression (357/357, `ranking` and `token` suites
byte-identical), and real-model redundancy detection still works (3/3, unchanged values). Holding the
line at NOT ENOUGH EVIDENCE anyway, consistent with how every phase document in this project has
treated its own N: this is still one real project, one real database, the same underlying real-model
corpus point measured for a fourth time rather than a new independent one, and the compression-vs-
omission nuance above shows the token-optimizer interaction still has corners this task didn't
exercise (a redundant item can still cost real budget even when it loses). What would tip this to YES:
a second, unrelated real project's redundant pair (not a re-run of the same one), and a decision on
whether "redundant but still partially costs budget via compression" is acceptable as shipped or needs
its own follow-up.

## LEARNING READINESS

`NOT READY` — unchanged. Small, real, genuinely new events were added to `data/brain.db` in this task
(1 ContextEvent, 3 FeedbackEvents, 1 OutcomeEvent, plus the 9 ContextEvents/2 FeedbackEvents/1
OutcomeEvent from the original pilot) — still nowhere near a sample supporting any statistically
meaningful ranking adjustment. No learning mechanism implemented or proposed.

## NEXT STEP

Verification-only task, complete. Handing back for a human decision:

1. Whether to commit `docs/phase-2c/PHASE_2C1_REPORT.md`'s 6 file changes plus both `docs/phase-2c/PHASE_2C*.md` reports
   (currently all uncommitted/untracked — will not commit without being asked).
2. Whether the case above is sufficient to schedule a second, independent real-project pilot before
   revisiting the default-enable decision, per `SHOULD REDUNDANCY BE ENABLED BY DEFAULT?`.

---

STOP. No further Brain architecture changes made after this task, per instructions.
