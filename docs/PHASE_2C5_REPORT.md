# Phase 2C.5 Report — Historical Real-Corpus Near-Duplicate Audit

Evaluation-only. `DEFAULT_REDUNDANCY_THRESHOLD` (0.75), `packages/mcp/src/bootstrap.ts`'s
`{ enabled: false }`, ranking, token optimization, and learning are all unchanged — confirmed by
direct re-read of both lines after cleanup and by `git status` reporting a clean tree (aside from the
still-uncommitted `docs/PHASE_2C4_REPORT.md` from the prior phase, untouched by this one) both before
this phase's scaffolding was created and after it was deleted. No memory was created, edited, or
archived by this phase — every finding below comes from reading `data/brain.db` as it already stood.

## PHASE 2C.5 STATUS

Complete. Audited the real, live `data/brain.db` for naturally occurring near-duplicate pairs — the
detection-side evidence Phase 2C.4 could not provide from a single authored pair. Found 4 real
near-duplicate pairs in the primary (non-pilot) corpus, froze human labels before any embedding call,
and measured all of them with the real model. Result is materially different from what 2C.2–2C.4
found on authored/benchmark content: **at 0.80, zero of the four real near-duplicates are detected**
— the closest is 0.001 below the line. At 0.75, two of the four are correctly detected with no false
positives. This is real, if small-sample, evidence that 0.80 may be too conservative for organically
accumulated Brain content specifically on the recall side, a dimension none of 2C.2–2C.4 could measure
because their content was authored to sit near the boundary on purpose.

## CORPUS INVENTORY

Read directly from `data/brain.db` (`memories` table, `status='active'`), no MCP tool involved (no
scope-listing tool exists to enumerate every project at once):

| | count |
|---|---|
| Total active memories | 19 |
| By type | rule 8, decision 5, constraint 5, (no other types present) |
| By scope kind | project 15, global 4, session 0 |
| By project id | task-api 6, phase2c-pilot 2, phase2c-validation-pilot 2, phase2c-threshold80-pilot 2, notes-api 2, brain-test 1 |
| Phase 2C pilot/test data (see below) | 9 |
| Remaining as primary historical/organic evidence | 10 |

No `archived` rows exist in the corpus (nothing to exclude on that basis). Nothing was mutated by this
inventory — a single read-only `SELECT`.

## PRIMARY VS CONTROL DATA

**Control (9)**, identified by `source_task_id` ending `-seed` with a `source_agent_id` of the form
`claude-code-phase2c*` — three complete pilot seed-triples, each following the same
project-rule/project-constraint/global-rule pattern:

| pilot | project memory | constraint memory | global memory |
|---|---|---|---|
| `phase2c-pilot` (original) | `60aba615-…` | `0416746e-…` | `a76fdf66-…` |
| `phase2c-validation-pilot` (2C.1 revalidation) | `44f9e604-…` | `ac2675ea-…` | `f8ba7735-…` |
| `phase2c-threshold80-pilot` (2C.4) | `ab232c09-…` | `d8f30a3f-…` | `05ad05de-…` |

**Primary (10)**: `brain-test` (1), `task-api` (6), `notes-api` (2), plus one global memory,
`cb18ede2-…`.

**Classification decision for `cb18ede2-…`** (documented per instruction): `source_origin: "system"`,
`source_agent_id: null`, `source_task_id: null` — the same provenance shape as every other clearly-organic
memory in this corpus (`03a323d3-…` through `267ce2e6-…`, all `system` origin, no agent/task id), and
the *opposite* shape from every pilot memory (`agent` origin, `claude-code-phase2c-*` agent id,
`*-seed` task id). Created `2026-08-18T16:12:31Z` — 5 days before the earliest Phase 2C pilot memory
(`2026-08-23T09:16:37Z`). Genuinely predates the pilot work and carries no pilot-authorship signal.
**Classified PRIMARY.**

## SCOPE-VALID PAIR POLICY

Only pairs that could actually co-occur in one retrieval candidate set: within a project, and
project↔global (global is visible from every scope, per `scopeIncludes`). Cross-project pairs (e.g.
`task-api`↔`notes-api`) are excluded — two different, non-global scopes can never both appear in the
same `getContext` call's candidate pool, so a similarity between them is not a real redundancy risk.
No session-scoped memories exist in this corpus, so no session pairs apply.

Primary corpus (10 memories: 1 global, 6 `task-api`, 2 `notes-api`, 1 `brain-test`) is small enough to
enumerate exhaustively rather than sample: `task-api` internal (C(6,2)=15) + `task-api`↔global (6) +
`notes-api` internal (1) + `notes-api`↔global (2) + `brain-test`↔global (1) = **25 pairs**, computed
fully, no sampling rule needed.

**Aside, not counted:** `brain-test`'s one memory ("…Database access is isolated behind repository
interfaces. Business logic must not directly access SQLite.") reads as content-near-duplicate of
`task-api`'s repository-pattern cluster (below) — but `brain-test` and `task-api` are different,
unrelated projects, so this pair is scope-invalid and correctly excluded from every count. Flagged as
exactly the kind of case the brief's scope-validity rule exists to prevent from inflating results.

## LABELING PROCESS

All 25 pairs' contents were read and a label (`NEAR_DUPLICATE` / `DISTINCT` / `AMBIGUOUS`) assigned
*before* any embedding call, written to a frozen artifact (`.pilot-tmp/frozen-labels.json`, deleted at
cleanup, content reproduced in full below) with a one-line rationale each. No label was changed after
seeing a similarity score. One clerical fix was made to the artifact's own summary tally (a
count-the-labels arithmetic error — 3/1/21 corrected to 4/1/20) before any embedding call was made;
no pair's label was touched.

Result: **4 NEAR_DUPLICATE, 1 AMBIGUOUS, 20 DISTINCT.**

## PRIMARY PAIRS

Memory key: T1=`3196c457` "task-api uses Express with TypeScript strict mode." T2=`6b254f6d`
"task-api uses SQLite." T3=`fd56b3b0` "Database access must go through repository interfaces." T4=
`be32099f` "Route handlers must never access SQLite directly." T5=`702b011f` "Tests use an in-memory
SQLite database." T6=`267ce2e6` "Task API route handlers must never directly access the SQLite
database. All persistence operations must go through TaskRepository." N1=`a0ae3295` "notes-api REST
endpoints use plural resource names: /notes, /notes/:id (…)." N2=`6ccf80c4` "notes-api: database
access must go through the repository layer (…). Route handlers … must never access the database
directly." BT1=`03a323d3` "This project uses TypeScript with strict mode enabled. Database access is
isolated behind repository interfaces. Business logic must not directly access SQLite." G=`cb18ede2`
"REST API resources should use plural nouns in endpoint paths, such as /tasks and /notes."

| pair | frozen label | rationale |
|---|---|---|
| T1~T2, T1~T3, T1~T4, T1~T5, T1~T6 | DISTINCT | framework choice vs. five unrelated facts/rules |
| T2~T3, T2~T4, T2~T6 | DISTINCT | DB-technology fact vs. repository/route rules |
| **T2~T5** | **AMBIGUOUS** | both are "this project's persistence is SQLite" in two contexts (prod stack vs. test setup) — reasonable reviewers could disagree whether that's elaboration or two independent facts |
| **T3~T4** | **NEAR_DUPLICATE** | same repository-pattern rule, positive framing vs. negative framing of the identical boundary |
| T3~T5, T4~T5, T5~T6 | DISTINCT | test-db setup vs. the repository/route cluster |
| **T3~T6** | **NEAR_DUPLICATE** | T6 is the project-specific elaboration of T3's generic decision, naming the concrete `TaskRepository` |
| **T4~T6** | **NEAR_DUPLICATE** | T6 is a near-verbatim elaboration of T4 — same subject, project-name prefix + one explanatory clause added |
| T1~G … T6~G | DISTINCT (6) | framework/DB/repository facts vs. REST naming rule — unrelated concerns |
| N1~N2 | DISTINCT | URL naming convention vs. data-access layering |
| **N1~G** | **NEAR_DUPLICATE** | N1 is `notes-api`'s project-specific instantiation of G's generic plural-noun rule |
| N2~G | DISTINCT | data-access layering vs. REST naming — unrelated |
| BT1~G | DISTINCT | repository/SQLite-isolation rule vs. REST naming rule |

## REAL-MODEL SIMILARITIES

Computed with the real `LocalEmbeddingProvider` after labels were frozen; content and labels unchanged
afterward.

| pair | label | similarity |
|---|---|---|
| T4~T6 | NEAR_DUPLICATE | **0.799007** |
| N1~G | NEAR_DUPLICATE | **0.785122** |
| T3~T6 | NEAR_DUPLICATE | 0.505642 |
| T3~T4 | NEAR_DUPLICATE | 0.395425 |
| T2~T6 | DISTINCT | 0.675873 |
| N1~N2 | DISTINCT | 0.517587 |
| T1~T2 | DISTINCT | 0.491076 |
| T2~T4 | DISTINCT | 0.490865 |
| T2~T5 | AMBIGUOUS | 0.487262 |
| T1~G | DISTINCT | 0.424070 |
| T2~G | DISTINCT | 0.342084 |
| N2~G | DISTINCT | 0.350545 |
| T5~T6 | DISTINCT | 0.335169 |
| T1~T6 | DISTINCT | 0.325267 |
| T2~T3 | DISTINCT | 0.284854 |
| T6~G | DISTINCT | 0.277261 |
| T4~T5 | DISTINCT | 0.266970 |
| T3~T5 | DISTINCT | 0.251819 |
| T1~T4 | DISTINCT | 0.184201 |
| T3~G | DISTINCT | 0.116425 |
| T4~G | DISTINCT | 0.111721 |
| T1~T5 | DISTINCT | 0.066009 |
| BT1~G | DISTINCT | 0.065973 |
| T1~T3 | DISTINCT | 0.056604 |
| T5~G | DISTINCT | 0.007248 |

## NATURAL NEAR-DUPLICATES

All 4 PRIMARY near-duplicate pairs (≥2 required by the brief's own bar — met):

| pair | ids | scopes | similarity | detected@0.75? | detected@0.80? | anchor under 2C.1 policy |
|---|---|---|---|---|---|---|
| T4~T6 | `be32099f-…` / `267ce2e6-…` | project:task-api ↔ project:task-api | 0.799007 | **YES** | no (0.001 short) | same specificity → rank tie-break; **empirically observed: T6 anchors** (rank 1, score 0.9, vs. T4 rank 2, score 0.809, for a real "can route handlers touch SQLite" task — see `OPERATIONAL SIMULATION`) |
| N1~G | `a0ae3295-…` / `cb18ede2-…` | project:notes-api ↔ global | 0.785122 | **YES** | no (0.015 short) | project more specific than global → **N1 should anchor**; not directly observed for this exact pair (see `OPERATIONAL SIMULATION`'s disclosed limitation), but the closely analogous N1↔`a76fdf66` pair (0.779, same rule, different global copy) was directly observed and N1 correctly anchored |
| T3~T6 | `fd56b3b0-…` / `267ce2e6-…` | project:task-api ↔ project:task-api | 0.505642 | no | no | same specificity → rank tie-break (never fires at either operating threshold, so not exercised) |
| T3~T4 | `fd56b3b0-…` / `be32099f-…` | project:task-api ↔ project:task-api | 0.395425 | no | no | same specificity → rank tie-break (never fires) |

`T3`, `T4`, `T6` form a natural 3-member near-duplicate cluster (the same repository-pattern rule
expressed at three levels of specificity/framing) entirely organically — none of it was authored for
any Phase 2C pilot.

## DISTINCT HIGH-SIMILARITY PAIRS

Highest-scoring DISTINCT-labeled pair: **T2~T6 at 0.675873** ("task-api uses SQLite." vs. "Task API
route handlers must never directly access the SQLite database. All persistence operations must go
through TaskRepository.") — well below both 0.75 and 0.80. No DISTINCT pair reaches either operating
threshold. See `FALSE POSITIVES`.

## 0.75 RESULT

Positive class = "near-duplicate," AMBIGUOUS pair (T2~T5) excluded from all counts per instruction.

TP=2 (T4~T6, N1~G) · FP=0 · TN=20 · FN=2 (T3~T4, T3~T6) · **precision = 1.000** · **recall = 0.500**

## 0.80 RESULT

TP=0 · FP=0 · TN=20 · FN=4 · **precision = N/A (zero positive predictions — no pair scored ≥0.80 at
all)** · **recall = 0.000**

## 0.75 VS 0.80

Same frozen 25-pair corpus, same labels, both thresholds run against it.

0.75 additionally flags exactly 2 pairs beyond 0.80's zero — **both are the pilot's own frozen
NEAR_DUPLICATE label, not false positives**:

| pair | contents | label | scope relationship | similarity |
|---|---|---|---|---|
| T4~T6 | "Route handlers must never access SQLite directly." / "Task API route handlers must never directly access the SQLite database. All persistence operations must go through TaskRepository." | NEAR_DUPLICATE | project↔project (same project) | 0.799007 |
| N1~G | "notes-api REST endpoints use plural resource names: …" / "REST API resources should use plural nouns in endpoint paths, such as /tasks and /notes." | NEAR_DUPLICATE | project↔global | 0.785122 |

**This is the opposite pattern from Phase 2C.4.** There, 0.75's extra sensitivity caught a real
false positive (a genuinely distinct memory wrongly flagged). Here, on real organic content, 0.75's
extra sensitivity catches two *genuine* near-duplicates that 0.80 misses entirely, with zero
additional false positives on this corpus (`0.80 RESULT` / `0.75 RESULT` both report FP=0). Phase
2C.4's "0.75 is too permissive" finding does **not** generalize to this corpus — on this specific,
small, real-content sample, 0.75 is strictly better (higher recall, identical precision) with no
observed downside.

## FALSE POSITIVES

**Zero PRIMARY pairs, DISTINCT or otherwise, reach 0.80.** Nothing to review under `STEP 7`'s literal
scope (">=0.80" among distinct-labeled pairs) — there is no PRIMARY pair at all at that threshold, so
this section reports **N/A by construction**, not an unreviewed gap. At 0.75, the highest DISTINCT
pair (N1~N2, 0.5176) is also nowhere close — zero false positives at 0.75 either, on this corpus.

## FALSE NEGATIVES

At 0.80: all 4 NEAR_DUPLICATE pairs (T3~T4 0.395, T3~T6 0.506, N1~G 0.785, T4~T6 0.799). At 0.75: 2
remain missed (T3~T4, T3~T6) — both well below 0.75 regardless, so this is not a near-miss the way
T4~T6/N1~G were for 0.80.

**The single most consequential number in this report is T4~T6's 0.799007** — 0.000993 below 0.80.
Given `LocalEmbeddingProvider`'s established determinism (reproduced to <0.001 across every phase back
through Phase 2C.2), this is not measurement noise; it is a genuine, stable near-miss. A rule stated
positively ("go through repository interfaces") vs. the identical rule stated as a specific,
project-named negative constraint, with one explanatory clause added, sits close enough to the 0.80
line that this specific, real, organically-written pair falls on the wrong side of it by under a tenth
of one percent.

## OPERATIONAL SIMULATION

**Literal `STEP 9` scope is empty**: zero PRIMARY pairs were detected at 0.80, so there is nothing that
qualifies for "every PRIMARY pair detected at 0.80." Rather than report nothing, the two pairs detected
at 0.75 (T4~T6, N1~G) were run through the real Gateway (`{enabled:true, threshold:0.75}`, same
mechanism as 2C.4 — a temporary script mirroring `createBrain()`, deleted at cleanup) as an explicitly
supplementary illustration of what 0.80 is failing to catch operationally. No task was fabricated
beyond what a real user of these projects would plausibly ask.

**T4~T6, `project:task-api`**, task *"Can route handlers in this project query SQLite directly, or does
data access have to go through a repository?"*:

- Ample budget (500): 10-item pool (6 project + 4 global) all delivered, 260 tokens. T6 rank 1
  (score 0.9), **T4 rank 2 (score 0.809, `redundantWith: T6`)**. T3 (rank 3, 0.698), T5, T2, T1 — none
  flagged. Scope authorization: both project-scoped, legitimately co-retrieved. Anchor: same
  specificity (both `project`) → rank tie-break → **T6 anchors**, matching 2C.1's documented rule.
  Neighboring distinct memories (T3, T5, T2, T1) correctly remain non-redundant.
- Constrained budget (90 tokens): T6, T3, T5, T2 delivered (82 tokens); **T4 fully omitted** (not
  compressed — no compression was observed anywhere in this simulation, consistent with every prior
  phase); 6 omitted total (T4, T1, and all 4 global memories, all lower-priority for this task).
  **Sensible outcome, unlike 2C.4's B-case**: T6's content ("route handlers must never directly access
  SQLite… All persistence through TaskRepository") fully subsumes T4's ("route handlers must never
  access SQLite directly") — nothing of substance is lost by T4's omission here. This is redundancy
  suppression working as intended, not a false-positive loss.

**N1~G, `project:notes-api`**, task *"What naming convention should REST endpoints in this project
follow?"*:

- Ample budget (500): 6-item pool (2 project + 4 global) all delivered, 263 tokens. **N1 rank 3
  (score 0.702, no `redundantWith`) — correctly the anchor.** `a76fdf66` (a *different* global copy of
  the same plural-noun rule, similarity to N1 = 0.779, directly re-measured) sits at rank 1 (0.9) with
  `redundantWith: N1` — **project correctly anchors over global**, confirming 2C.1's scope-specificity
  policy operating on real content. `cb18ede2` (rank 2, 0.897) shows `redundantWith: a76fdf66`, not
  `redundantWith: N1` — a real, disclosed limitation of this one observation: `a76fdf66` is
  near-duplicate with *both* `cb18ede2` (0.9996) and N1 (0.779), but `redundantWith` holds one value
  per item (last-write-wins, per commit `45e6793`), so this run does not independently confirm N1↔`cb18ede2`'s
  own orientation — only N1↔`a76fdf66`'s. N2 (rank 5, 0.053) correctly remains non-redundant.
- Constrained budget (40 tokens): **only N1 delivered** (39 tokens); both global plural-rule
  duplicates and N2 omitted. Clean, sensible demonstration of the project-anchor policy winning a
  tight budget over its global near-duplicates.

## REAL-CORPUS DETECTION EVIDENCE

**CONCERNING.**

Not `INSUFFICIENT` — the corpus does contain natural near-duplicate pairs (4, exceeding the brief's
own ≥2 bar), and they were found without manufacturing anything. But the detection result itself is a
real concern: 0.80 catches **none** of them, and the nearest miss is a stable 0.001 short. This is
qualitatively different from 2C.4's "no evidence yet" — this phase produced real evidence, and what it
shows is that 0.80's benchmark-measured 91.7% recall (Phase 2C.3, on 36 authored pairs) does not carry
over to this small sample of real, organically-written Brain content at all.

## IS 0.80 SAFER?

**YES, but the "yes" is close to hollow here — read the caveat.**

By this project's own stipulated primary safety metric (false-positive count / precision): 0.80 ties
0.75 at 0 false positives on this corpus, so 0.80 is not *less* safe. Technically YES holds.

But unlike Phase 2C.4 — where 0.80's safety margin came from actively avoiding a real false positive
0.75 committed — **0.80's tie here comes from detecting nothing at all**, not from doing useful
precision work 0.75 fails at. A threshold that never fires cannot be unsafe, but it also cannot be
useful. On this corpus, 0.75 is strictly better: identical precision (1.000 vs. undefined-because-empty),
double the recall (0.500 vs. 0.000), zero additional false positives. If "safer" is read as "safer
*and at least as useful*," the honest answer on this specific evidence is closer to **NO** for 0.80
over 0.75. Both readings are reported because the brief's own metric definition supports the first and
the practical evidence supports the second.

## SHOULD REDUNDANCY BE ENABLED BY DEFAULT?

**NOT ENOUGH EVIDENCE — but a materially more negative "not enough" than Phase 2C.4's.**

The brief's explicit YES-bar requires "at least 2 independent naturally occurring near-duplicate cases
correctly detected at 0.80." This phase found 4 naturally occurring cases and 0.80 detected **0** of
them. YES is definitively ruled out by the brief's own stated criteria — not a borderline call.

Not answering a flat NO either: N=4 pairs from one 10-memory corpus is too small to conclude "0.80
will always under-detect real content" with confidence, and the closest miss (T4~T6, 0.001 short) is
close enough that a different, larger organic corpus could plausibly tip the other way. But this phase
does not leave the question where 2C.4 left it (silent, no real-content signal either way) — it now
has real, if thin, evidence pointing specifically toward 0.80 under-detecting real Brain content on the
recall side, a risk none of 2C.2–2C.4 could see because their content was authored specifically to
probe the 0.70–0.90 boundary rather than accumulated organically. Production configuration was not
changed.

## LEARNING READINESS

**NOT READY.** Unchanged from every prior phase report. This phase added no new correlated
telemetry beyond the 4 `getContext` calls in `OPERATIONAL SIMULATION` (no feedback, no outcome —
none were called for by this evaluation-only brief) — far short of anything learning could use.

## TEST COUNTS

| | count |
|---|---|
| `npm run typecheck` | PASS, 0 errors, all 14 workspaces |
| `npm run build` | PASS |
| `npm test` | **367/367 passing, 0 failing** (evaluation 60, gateway 33, knowledge 9, mcp 20, storage 51, compression 7, context 29, contracts 53, learning 2, memory 1, ranking 23, retrieval 30, test-fixtures 23, token 26) |
| `npm audit` | 0 vulnerabilities |
| `packages/storage` `test:integration` | 3/3 (0.8037/0.5423/0.3667, unchanged) |
| `packages/evaluation` `test:integration` | 2/2 (71-pair boundary run reproduces 2C.3 exactly) |

## RISKS

- **N=4 primary pairs, one corpus, one embedding model.** Real infrastructure and real content, but
  still a small sample from a single small corpus (10 primary memories total) — the same
  not-a-population-estimate caveat every phase report has carried, now applied to the detection side
  specifically.
- **T4~T6's 0.001 margin is fragile evidence in either direction.** A minor rewording of either memory,
  a different embedding model, or a library version bump could move it across 0.80 either way. Treat
  the *existence* of a near-miss this close as the finding, not the exact fourth decimal.
- **`redundantWith`'s one-slot-per-item limitation is real, not hypothetical.** `a76fdf66` genuinely
  participates in two near-duplicate relationships at once (with `cb18ede2` at 0.9996, with N1 at
  0.779) and only one is ever visible on its own record at a time. This did not cause a wrong decision
  in this pilot's observations, but it means a memory sitting at the center of more than two mutual
  near-duplicates would have some of those relationships silently invisible in any single delivery —
  worth a future look, out of scope for this evaluation-only phase to fix.
- **The background text's "~0.804 historical duplicate pair" needed correction.** It refers to
  `rest-api-a1` (`60aba615`↔`a76fdf66`, both Control) — not to the primary memory `cb18ede2`, whose own
  near-duplicate partner (`a76fdf66` again) actually measures 0.9996 (`rest-api-a2`), a different known
  pair. Both re-confirmed directly in `PRIMARY VS CONTROL DATA` / this report's control step. Recorded
  here so the correction is not lost.
- **Operational simulation's N1~G row has a disclosed gap**: the live run confirms N1 anchors over
  `a76fdf66`, not independently over `cb18ede2` (its actual frozen-pair partner) — see
  `OPERATIONAL SIMULATION`.

## RECOMMENDED NEXT STEP

The detection-side question Phase 2C.4 could not answer now has a real, if small and concerning,
answer: 0.80 misses real organic near-duplicates that 0.75 catches without cost, on this corpus. Before
any default-enable decision:

1. **Widen the real-corpus sample.** This phase's entire primary corpus is 10 memories from 3 small
   projects. A larger, more representative organic corpus (more projects, more time, more authors) would
   tell whether T4~T6's 0.001 near-miss is typical or a one-off — the single highest-value follow-up.
2. **If a default-enable is revisited before that, this phase's evidence argues for testing 0.75, not
   0.80**, on real content specifically — the opposite recommendation from 2C.2–2C.4's benchmark-only
   conclusion, and worth reconciling explicitly rather than silently picking one. 2C.4's real false
   positive at 0.75 and 2C.5's real recall gap at 0.80 are both genuine findings from real content;
   neither cancels the other out, and a future decision needs to weigh both rather than average them
   away.

STOP. No production behavior changed.

---

## FINAL VERIFICATION

`.pilot-tmp/` (runner script + frozen-labels artifact) deleted at cleanup.

```
npm run typecheck    PASS, 0 errors, all 14 workspaces
npm run build        PASS
npm test              367/367 passing, 0 failing
npm audit             0 vulnerabilities
packages/storage      test:integration -- 3/3, unchanged
packages/evaluation   test:integration -- 2/2, unchanged
```

`DEFAULT_REDUNDANCY_THRESHOLD` re-read directly from `gateway.ts:44`: still `0.75`.
`packages/mcp/src/bootstrap.ts:39` re-read directly: still `{ enabled: false, threshold:
DEFAULT_REDUNDANCY_THRESHOLD }`. `git status`: clean before this phase's scaffolding was created,
clean after it was deleted, clean again after this final verification run — the only untracked file at
every check is `docs/PHASE_2C4_REPORT.md`, carried over from the prior phase and still awaiting a
commit decision, untouched by this one. No memory in `data/brain.db` was created, edited, or archived
at any point in this phase.
