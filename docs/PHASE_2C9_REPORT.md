# Phase 2C.9 Report — High-Cosine Corroboration Audit

Evaluation-only, retrospective. No new pair was authored. Every cosine similarity and human label below
is transcribed verbatim from already-committed, already-frozen sources: `packages/evaluation/src/
hybrid-classifier-regression.data.ts` (Phase 2C.6's frozen 99-pair corpus) and `docs/PHASE_2C8_REPORT.md`
(the 11 new organic pairs + 1 historical carryover). No embedding model was called and no new pair was
labeled. The only new computation this phase performed is **containment**, via the real, unmodified
production functions (`tokenizeForContainment`, `containmentCoefficient`, `isNearDuplicate`, imported
from `@brain/retrieval`, never reimplemented), and content lookups against `data/brain.db` (read-only)
to recover the exact production text for the 12 Phase 2C.8 pairs the report itself only paraphrased.
`packages/mcp/src/bootstrap.ts` (`{ enabled: false, ...DEFAULT_NEAR_DUPLICATE_POLICY }`), Rule H, ranking,
token optimization, and learning are all unchanged — confirmed by direct re-read after cleanup and by
`git status` reporting the same 5 pre-existing untracked docs (`PHASE_2C4_REPORT.md` through
`PHASE_2C8_REPORT.md`) both before this phase's `.pilot-tmp/` scratch scripts were created and after
they were deleted.

## PHASE 2C.9 STATUS

Complete. Combined the frozen 99-pair corpus with Phase 2C.8's 12 organic-era pairs (11 new + 1
historical carryover), recomputed real production containment for every pair at cosine ≥0.75 (48
pairs), and ran the real `isNearDuplicate()` against three policies: **Strategy A** (current
production Rule H), **Strategy H2** (full-range corroboration, no unconditional cosine branch), and
**Strategy H3** (0.95 unconditional bypass + corroboration below it, fixed before analysis).

**Headline finding:** both of Phase 2C.8's confirmed false positives have real production containment
below the existing 0.40 corroboration bar (`909d5511~f4ebe0ae` = 0.3750, `05fede4b~5b880968` = 0.3333)
— H2 and H3 both reject both, with **zero cost to any previously-established hard case** (T4~T6, N1~G,
the historical global/global pair, 2C.4 A~B, rest-api-c — all fully retained). The cost is real but
narrowly scoped: full corroboration also rejects 2 of 2C.8's own brand-new organic true positives
(`be174a56~ce0fa075` containment 0.2500, `e104c851~f4ebe0ae` containment 0.3846), both below 0.40.
H2 and H3 are **empirically identical** on every one of the 111 pairs inspected — no pair anywhere in
the evidence set has cosine ≥0.95 with containment <0.40, so the 0.95 bypass is never actually
exercised as a distinguishing mechanism on this evidence.

## EVIDENCE SET

| source | pairs | new to this phase? |
|---|---|---|
| `packages/evaluation/src/hybrid-classifier-regression.data.ts` (Phase 2C.6 frozen corpus, 71 authored + 24 organic-pre-2C8 + 4 control) | 99 | no — imported verbatim |
| `docs/PHASE_2C8_REPORT.md` cosine values + labels, content recovered from `data/brain.db` | 11 new organic (2 TP + 2 FP + 6 TN) + 1 AMBIGUOUS | labels/cosine: no (frozen 2026-08-29); content sourcing: yes, this phase |
| Historical carryover (`a76fdf66~cb18ede2`) | 1 | no — content-identical to authored/`rest-api-a2`, already in the 99 |

**Deduplication finding:** `a76fdf66~cb18ede2` (cosine 0.9996 per `docs/PHASE_2C8_REPORT.md`) is
**content-identical** to the already-frozen `rest-api-a2` pair (`contentA`/`contentB` compared
programmatically, exact string equality, both sides) — both are the real `a76fdf66`
("…such as /notes and /tasks.") / `cb18ede2` ("…such as /tasks and /notes.") global memories, first
captured as an authored benchmark pair in 2C.2 and independently rediscovered as a live historical pair
in 2C.8. This is the same evidence surfacing in two reports, not two pairs. It is therefore **excluded
from every combined/provenance metric below** (already counted once, under `authored`) and reported
only in the high-cosine table and hard-case retention check, explicitly marked as deduplicated. Net new
historical evidence from this phase, after dedup: **0 pairs**.

Total unique pairs used in this phase's confusion matrices: **109** (99 frozen + 10 metrics-eligible
2C.8 pairs). Plus 1 AMBIGUOUS (shown separately, excluded from all counts) and 1 deduplicated historical
pair (shown separately, excluded from counts). Grand total pairs inspected: 111.

## PROVENANCE

| provenance | count | source |
|---|---|---|
| `authored` | 71 | 2C.2/2C.3 benchmark pairs, frozen by 2C.6/2C.7 |
| `organic-pre-2C8` | 24 | 2C.5 real-corpus audit (`task-api`/`notes-api`, T1–T6/N1/N2/BT1/G), frozen by 2C.6/2C.7 |
| `control` | 4 | 2C.4 live-pilot A/B/C pairwise + `phase2c-pilot` A~B, frozen by 2C.6/2C.7 |
| `organic-2C8` | 11 (10 metrics-eligible + 1 AMBIGUOUS) | 2C.8 organic breadth pilot, 5 new projects, cosine/labels frozen 2026-08-29, content read from `data/brain.db` this phase |
| `historical` | 1, **deduplicated to 0 net-new** | carried forward from the 2C.4 pilot seed (`a76fdf66`) × pre-existing organic memory (`cb18ede2`); content-identical to `authored/rest-api-a2` |
| **Total (metrics)** | **109** | |

AMBIGUOUS pairs in this evidence set: 1 (`7bf3c5d9~be174a56`, cosine 0.8496, organic-2C8) — excluded
from every TP/FP/TN/FN count, shown in its own table below. (2C.5's own `T2~T5`, cosine 0.487262, is
also AMBIGUOUS but sits well below the 0.75 candidate floor and was already excluded from the frozen
99-pair corpus by design; noted for completeness, not part of this phase's high-cosine evidence.)

## HIGH-COSINE PAIRS

**Central artifact of this phase.** Every labeled pair with cosine ≥0.80 (38 rows — 37 unique pairs;
row 2 is the deduplicated historical pair, marked). ND = NEAR_DUPLICATE, DIS = DISTINCT. "Label" is the
frozen human ground truth. A/H2/H3 are the real `isNearDuplicate()` verdict under each policy.

| Pair | Provenance | Cosine | Containment | Label | A (current) | H2 | H3 |
|---|---|---|---|---|---|---|---|
| rest-api-a2 | authored | 0.999573 | 1.0000 | ND | ND | ND | ND |
| a76fdf66~cb18ede2 *(dedup = rest-api-a2)* | historical | 0.999573 | 1.0000 | ND | ND | ND | ND |
| b1-rest-api-nd-1 | authored | 0.994332 | 1.0000 | ND | ND | ND | ND |
| b1-validation-nd-2 | authored | 0.994151 | 0.7778 | ND | ND | ND | ND |
| validation-a | authored | 0.994061 | 0.8889 | ND | ND | ND | ND |
| b1-typescript-conventions-nd-1 | authored | 0.985273 | 1.0000 | ND | ND | ND | ND |
| authentication-a | authored | 0.985248 | 1.0000 | ND | ND | ND | ND |
| b1-logging-nd-1 | authored | 0.978911 | 0.7500 | ND | ND | ND | ND |
| b2-validation-nd-1 | authored | 0.978601 | 1.0000 | ND | ND | ND | ND |
| caching-a | authored | 0.974291 | 0.8571 | ND | ND | ND | ND |
| testing-a | authored | 0.973528 | 0.8000 | ND | ND | ND | ND |
| repository-database-a | authored | 0.973266 | 0.8889 | ND | ND | ND | ND |
| error-handling-a | authored | 0.968905 | 1.0000 | ND | ND | ND | ND |
| b2-service-boundaries-nd-1 | authored | 0.967125 | 0.7778 | ND | ND | ND | ND |
| logging-a | authored | 0.962503 | 0.7778 | ND | ND | ND | ND |
| b2-authentication-nd-1 | authored | 0.954123 | 0.7500 | ND | ND | ND | ND |
| b2-caching-nd-1 | authored | 0.953947 | 0.6667 | ND | ND | ND | ND |
| typescript-conventions-a | authored | 0.933651 | 0.7778 | ND | ND | ND | ND |
| b1-caching-nd-1 | authored | 0.925936 | 1.0000 | ND | ND | ND | ND |
| b2-caching-nd-2 | authored | 0.918642 | 0.9286 | ND | ND | ND | ND |
| service-boundaries-a | authored | 0.918418 | 1.0000 | ND | ND | ND | ND |
| b2-rest-api-nd-2 | authored | 0.911629 | 1.0000 | ND | ND | ND | ND |
| b1-authentication-nd-1 | authored | 0.903321 | 0.7143 | ND | ND | ND | ND |
| b1-validation-nd-1 | authored | 0.901839 | 0.9091 | ND | ND | ND | ND |
| b1-rest-api-nd-2 | authored | 0.898436 | 1.0000 | ND | ND | ND | ND |
| b1-testing-nd-1 | authored | 0.896164 | 0.8750 | ND | ND | ND | ND |
| b1-authentication-nd-2 | authored | 0.885960 | 0.9000 | ND | ND | ND | ND |
| **909d5511~f4ebe0ae** | **organic-2C8 — FP** | 0.881300 | **0.3750** | **DISTINCT** | **ND (wrong)** | **DISTINCT (fixed)** | **DISTINCT (fixed)** |
| b2-typescript-conventions-nd-1 | authored | 0.876986 | 0.6667 | ND | ND | ND | ND |
| b2-testing-nd-1 | authored | 0.863245 | 0.8000 | ND | ND | ND | ND |
| **be174a56~ce0fa075** | **organic-2C8 — TP** | 0.842800 | **0.2500** | **ND** | **ND (correct)** | **DISTINCT (lost)** | **DISTINCT (lost)** |
| **05fede4b~5b880968** | **organic-2C8 — FP** | 0.838000 | **0.3333** | **DISTINCT** | **ND (wrong)** | **DISTINCT (fixed)** | **DISTINCT (fixed)** |
| b1-service-boundaries-nd-1 | authored | 0.829367 | 1.0000 | ND | ND | ND | ND |
| b1-repository-database-nd-1 | authored | 0.825900 | 0.9091 | ND | ND | ND | ND |
| b2-repository-database-nd-1 | authored | 0.822642 | 0.9091 | ND | ND | ND | ND |
| b2-logging-nd-1 | authored | 0.814870 | 0.9000 | ND | ND | ND | ND |
| rest-api-a1 | authored | 0.805385 | 0.6000 | ND | ND | ND | ND |
| **e104c851~f4ebe0ae** | **organic-2C8 — TP** | 0.801600 | **0.3846** | **ND** | **ND (correct)** | **DISTINCT (lost)** | **DISTINCT (lost)** |

## CONTAINMENT VALUES

Every labeled pair at cosine ≥0.75 (the [0.75, 0.80) band adds 10 rows to the 38 above, 48 total). Same
columns as required by the brief (cosine, containment, label, provenance); A/H2/H3 columns kept for
continuity since they were computed identically.

| Pair | Provenance | Cosine | Containment | Label | A | H2 | H3 |
|---|---|---|---|---|---|---|---|
| T4~T6 *(hard case)* | organic-pre-2C8 | 0.799007 | 1.0000 | ND | ND | ND | ND |
| 2f7e5e5e~44d5253f | organic-2C8 — TN | 0.790300 | 0.2174 | DISTINCT | DIS | DIS | DIS |
| N1~G *(hard case)* | organic-pre-2C8 | 0.785122 | 0.5000 | ND | ND | ND | ND |
| 909d5511~e104c851 | organic-2C8 — TN | 0.777500 | 0.3077 | DISTINCT | DIS | DIS | DIS |
| rest-api-c *(hard case)* | authored | 0.772566 | 0.3333 | DISTINCT | DIS | DIS | DIS |
| 4a455e8d~a05fb864 | organic-2C8 — TN | 0.767900 | 0.2000 | DISTINCT | DIS | DIS | DIS |
| 5b880968~babb1073 | organic-2C8 — TN | 0.764600 | 0.2105 | DISTINCT | DIS | DIS | DIS |
| 0062a433~a05fb864 | organic-2C8 — TN | 0.764200 | 0.2667 | DISTINCT | DIS | DIS | DIS |
| 2C.4-A~B *(hard case)* | control | 0.762576 | 0.2857 | DISTINCT | DIS | DIS | DIS |
| 7bf3c5d9~ce0fa075 | organic-2C8 — TN | 0.758800 | 0.2105 | DISTINCT | DIS | DIS | DIS |

(38 rows ≥0.80 from `HIGH-COSINE PAIRS` + these 10 = 48 total ≥0.75, matching `109` metrics pairs minus
the 61 authored/organic-pre-2C8/control pairs that sit below 0.75 and are therefore never classified
NEAR_DUPLICATE by any of the three strategies — all such pairs are DISTINCT-labeled TN, except the 6
below-floor FN pairs covered in `TRUE-POSITIVE RETENTION`.)

**AMBIGUOUS pair** (excluded from all counts, shown separately per instruction):

| Pair | Provenance | Cosine | Containment | A | H2 | H3 |
|---|---|---|---|---|---|---|
| 7bf3c5d9~be174a56 | organic-2C8 | 0.8496 | 0.2105 | ND | DISTINCT | DISTINCT |

Rule H's plain-cosine branch calls this one NEAR_DUPLICATE unconditionally (≥0.80); both corroboration
strategies would reject it (containment 0.2105 « 0.40). Consistent with the RISKS 2C.8 itself already
flagged: a content-review-uncertain case defaulting to "duplicate" under Strategy A is a soft risk
signal in the same direction as the two confirmed FPs.

## CURRENT RULE H (Strategy A)

Unchanged production formula (`packages/core/retrieval/src/lexical-containment.ts`):
`cosine ≥ 0.80 → NEAR_DUPLICATE`, else `cosine ≥ 0.75 AND containment ≥ 0.40 → NEAR_DUPLICATE`, else
`DISTINCT`. Combined: TP 37 / FP **2** / TN 64 / FN 6, precision **0.9487**, recall 0.8605. Both false
positives are `organic-2C8` pairs that clear 0.80 on cosine alone — containment is never consulted for
either, by construction (see `HIGH-COSINE PAIRS`). Every other provenance group (authored, organic-
pre-2C8, control) has 0 false positives under Strategy A, reproducing 2C.6/2C.7's own recorded numbers
exactly (sanity-checked programmatically against this phase's own combined-from-groups sum).

## H2 FULL CORROBORATION

`cosine ≥ 0.75 AND containment ≥ 0.40` — no unconditional branch at any cosine. Combined: TP 35 / FP
**0** / TN 66 / FN 8, precision **1.0000**, recall 0.8140. Eliminates both Strategy-A false positives
(`909d5511~f4ebe0ae` containment 0.3750 < 0.40; `05fede4b~5b880968` containment 0.3333 < 0.40 — both
now DISTINCT). Every `authored`, `organic-pre-2C8`, and `control` cell is **byte-identical** to Strategy
A (see `METRICS BY PROVENANCE`) — the entire effect of removing the unconditional branch, on this
evidence, is confined to `organic-2C8`, where TP drops 2→0 and FN rises 0→2 alongside FP dropping 2→0
(see `TRUE-POSITIVE RETENTION`).

## H3 EXTREME-COSINE BYPASS

`cosine ≥ 0.95 OR (cosine ≥ 0.75 AND containment ≥ 0.40)`, 0.95 fixed before analysis, not tuned to
this data. Combined: TP 35 / FP **0** / TN 66 / FN 8 — **identical to H2 in every cell, every
provenance group, every individual pair verdict.** Reason, verified directly from `HIGH-COSINE PAIRS`:
every pair in the entire 111-pair evidence set that reaches cosine ≥0.95 (18 pairs, all `authored` or
the deduplicated `historical` pair) **already has containment ≥0.40 independently** — the lowest
containment among them is `b2-caching-nd-1` at 0.6667, comfortably clear. The 0.95 bypass therefore
never fires on a pair that corroboration would have rejected, and no pair anywhere in [0.95, 1.0) is
DISTINCT-labeled, so it never admits a false positive either. On this evidence, H3 is safe but
**observationally indistinguishable from pure corroboration** — it neither rescues anything H2 misses
nor blocks anything H2 lets through.

## HARD CASES

Required set, current-H/H2/H3 verdict for each, using real production containment:

**True positives (must remain NEAR_DUPLICATE):**

| Case | Cosine | Containment | A | H2 | H3 |
|---|---|---|---|---|---|
| T4~T6 | 0.799007 | 1.0000 | ND ✔ | ND ✔ | ND ✔ |
| N1~G | 0.785122 | 0.5000 | ND ✔ | ND ✔ | ND ✔ |
| be174a56~ce0fa075 (2C.8 file-api duplicate) | 0.842800 | 0.2500 | ND ✔ | **DISTINCT ✘** | **DISTINCT ✘** |
| e104c851~f4ebe0ae (2C.8 cache-service duplicate) | 0.801600 | 0.3846 | ND ✔ | **DISTINCT ✘** | **DISTINCT ✘** |
| a76fdf66~cb18ede2 (historical global/global, = rest-api-a2) | 0.999573 | 1.0000 | ND ✔ | ND ✔ | ND ✔ |

**False-positive controls (must remain DISTINCT):**

| Case | Cosine | Containment | A | H2 | H3 |
|---|---|---|---|---|---|
| 2C.4-A~B | 0.762576 | 0.2857 | DISTINCT ✔ | DISTINCT ✔ | DISTINCT ✔ |
| rest-api-c | 0.772566 | 0.3333 | DISTINCT ✔ | DISTINCT ✔ | DISTINCT ✔ |
| 909d5511~f4ebe0ae (2C.8 cache-service FP) | 0.881300 | 0.3750 | **ND ✘** | DISTINCT ✔ | DISTINCT ✔ |
| 05fede4b~5b880968 (2C.8 job-worker FP) | 0.838000 | 0.3333 | **ND ✘** | DISTINCT ✔ | DISTINCT ✔ |

3/5 required true positives pass under every strategy; 2/5 (both from 2C.8, both brand-new this audit
cycle) pass only under Strategy A. 2/4 false-positive controls pass only under H2/H3; the other 2
(pre-existing, from 2C.4/2C.2) pass under all three.

## FALSE-POSITIVE RECOVERY

**Primary question, answered directly:**

| FP | Real production containment | H2 rejects it? | H3 rejects it? |
|---|---|---|---|
| `909d5511~f4ebe0ae` (cache-service, cosine 0.8813) | **0.3750** | **YES** | **YES** |
| `05fede4b~5b880968` (job-worker, cosine 0.8380) | **0.3333** | **YES** | **YES** |

Both containment values sit below the existing 0.40 threshold — the same threshold 2C.6 already
calibrated and 2C.7 already shipped as unit-tested production code, just never consulted above 0.80 by
Strategy A's design. Removing the unconditional branch (H2), or narrowing it to 0.95 (H3), both recover
full precision on this pair without any new threshold, tokenizer, or stopword-list change.

## TRUE-POSITIVE RETENTION

Every known true near-duplicate at cosine ≥0.75 (38 across all provenance groups), by whether each
strategy detects it:

| Provenance | Known TPs | Detected by A | Detected by H2 | Detected by H3 |
|---|---|---|---|---|
| authored | 33 | 33 | 33 | 33 |
| organic-pre-2C8 | 2 (T4~T6, N1~G) | 2 | 2 | 2 |
| historical (=rest-api-a2, dedup) | 1 | 1 | 1 | 1 |
| organic-2C8 | 2 (file-api, cache-service) | 2 | **0** | **0** |
| **Total** | **38** | **38** | **36** | **36** |

**Zero previously-validated detections are lost.** Every hard case and every detection established
before this audit cycle (all 33 authored pairs, T4~T6, N1~G, the historical global/global pair) survives
under H2 and H3 unchanged. The 2 detections that are lost were both discovered *in the same 2C.8 audit
that also produced the 2 false positives being fixed* — neither had been relied on by any prior gate or
decision (2C.8's own gate already returned NO). This is a real, disclosed cost, not a hidden one, but it
does not violate the constraint against destroying previously-validated evidence to buy the false-positive
fix.

**The uncomfortable part, stated plainly:** within the `organic-2C8` ≥0.80 slice specifically, containment
does **not** cleanly separate true from false positives. Sorted by containment: `be174a56~ce0fa075`
(TP, 0.2500) < `05fede4b~5b880968` (FP, 0.3333) < `909d5511~f4ebe0ae` (FP, 0.3750) < `e104c851~f4ebe0ae`
(TP, 0.3846) — TP/FP/FP/TP, interleaved. No single threshold could separate these four pairs correctly
using containment alone. The global λ=0.40 (calibrated in 2C.6 against a much larger, mostly-authored
corpus) happens to reject all four uniformly, which is why it still nets a full precision win in
aggregate — but that is a property of 0.40 sitting above all four values, not evidence that containment
tracks "genuine duplicate" cleanly at this specific band on organic content. 2C.6's own N1~G margin
(0.10 above λ) was already flagged as the tightest constraint in the system; this phase's organic-2C8
evidence shows a real near-duplicate can also sit *below* λ, not just close above it.

## METRICS BY PROVENANCE

**Strategy A (current Rule H):**

| Group | TP | FP | TN | FN | Precision | Recall | FPR | FNR |
|---|---|---|---|---|---|---|---|---|
| authored (71) | 33 | 0 | 35 | 3 | 1.0000 | 0.9167 | 0.0000 | 0.0833 |
| organic-pre-2C8 (24) | 2 | 0 | 20 | 2 | 1.0000 | 0.5000 | 0.0000 | 0.5000 |
| control (4) | 0 | 0 | 3 | 1 | N/A | 0.0000 | 0.0000 | 1.0000 |
| organic-2C8 (10) | 2 | **2** | 6 | 0 | 0.5000 | 1.0000 | **0.2500** | 0.0000 |

**Strategy H2 (full corroboration):**

| Group | TP | FP | TN | FN | Precision | Recall | FPR | FNR |
|---|---|---|---|---|---|---|---|---|
| authored (71) | 33 | 0 | 35 | 3 | 1.0000 | 0.9167 | 0.0000 | 0.0833 |
| organic-pre-2C8 (24) | 2 | 0 | 20 | 2 | 1.0000 | 0.5000 | 0.0000 | 0.5000 |
| control (4) | 0 | 0 | 3 | 1 | N/A | 0.0000 | 0.0000 | 1.0000 |
| organic-2C8 (10) | **0** | **0** | 8 | **2** | N/A | **0.0000** | 0.0000 | **1.0000** |

**Strategy H3 (0.95 bypass):** identical to H2 in every cell (see `H3 EXTREME-COSINE BYPASS`).

## COMBINED METRICS

| Strategy | TP | FP | TN | FN | Precision | Recall | FPR | FNR |
|---|---|---|---|---|---|---|---|---|
| A — current Rule H | 37 | **2** | 64 | 6 | 0.9487 | 0.8605 | 0.0303 | 0.1395 |
| H2 — full corroboration | 35 | **0** | 66 | 8 | **1.0000** | 0.8140 | **0.0000** | 0.1860 |
| H3 — 0.95 bypass | 35 | **0** | 66 | 8 | **1.0000** | 0.8140 | **0.0000** | 0.1860 |

N=109 for all three (dedup'd historical and AMBIGUOUS excluded throughout, per instruction).

## 2C.8 CONTEXT-IMPACT IMPLICATION

No live Gateway call was made this phase (classification substitution only, per instruction). Using
2C.8's own already-recorded classifications and delivery data:

**Job-worker.** Only 2 pairs ≥0.75 exist in this project's candidate set: `5b880968~babb1073` (TN under
every strategy) and `05fede4b~5b880968` (the FP, → DISTINCT under H2/H3). Under H2, **neither** pair is
flagged redundant, so `getRedundancyPairs`/`toRedundancyPairs` never produces a redundancy edge for this
project at all — mechanically identical to redundancy being disabled for this candidate set, regardless
of exact token numbers. 2C.8 already ran and recorded exactly that comparison for this pair ("Under a
disabled policy at the same budget, `05fede4b` is a genuinely distinct, useful fact with no redundancy
demotion and would compete for the slot on rank alone") — **yes**, the job-worker FP's previously
observed context-impacting demotion would not have been caused by redundancy under H2.

**Cache-service.** Three pairs ≥0.75 exist: `e104c851~f4ebe0ae` (TP under A, → DISTINCT under H2),
`909d5511~e104c851` (TN under every strategy), `909d5511~f4ebe0ae` (the FP, → DISTINCT under H2). Under
H2, **all three** reclassify DISTINCT — no pair among `909d5511`/`e104c851`/`f4ebe0ae` is flagged
redundant, so no demotion occurs for any of the three under H2, for the same structural reason as
job-worker: a pair that never enters `redundancyPairs` cannot cause `compileContext` to demote either
side. **Yes**, the cache-service FP's previously observed context-impacting demotion (`909d5511` fully
omitted, `f4ebe0ae` compressed 69→20 at the 50-tok probe) would not have been caused by redundancy under
H2. **Caveat, disclosed rather than glossed over:** this also means `e104c851~f4ebe0ae` — one of the two
2C.8 true positives H2 loses — would *also* stop being suppressed in this same candidate set; the exact
resulting token-level delivery composition under H2 was **not** re-run live (no `getContext` call was
made this phase), so only the classification-level, structurally-certain claim ("no demotion occurs")
is made here, not a specific reconstructed delivery.

## SHOULD 0.80 REMAIN UNCONDITIONAL?

**NO.**

Empirically, 2 of 37 unique pairs ≥0.80 in the full evidence set (5.4%) are false positives under the
unconditional branch, and both are concentrated in the one subgroup that matters most for a production
default: real, organically-created content from new projects. Restricted to `organic-2C8`'s own
non-ambiguous ≥0.80 pairs specifically, the false-positive rate is 2 of 4 (50%) — vs. 0 of 33 on every
authored/historical ≥0.80 pair. Both known false positives have real production containment (0.3750,
0.3333) below the already-shipped 0.40 corroboration bar, and rejecting them via H2 costs zero
previously-established hard case or detection (`TRUE-POSITIVE RETENTION`). The unconditional branch's
only demonstrated value on this evidence is convenience (skip the containment call above 0.80), not
correctness — every genuinely-duplicate pair ≥0.80 in `authored`/`historical` also independently clears
containment ≥0.40, so corroboration would have caught them too (see `H3 EXTREME-COSINE BYPASS`).

## DOES FULL CORROBORATION HELP?

**YES, on the project's own stated primary safety metric, at a disclosed and narrowly-scoped cost.**

Combined precision rises 0.9487 → 1.0000 (FPR 0.0303 → 0.0000), with **zero** previously-validated
detection lost. The cost is combined recall 0.8605 → 0.8140 (FNR 0.1395 → 0.1860), entirely concentrated
in 2 pairs — both newly discovered in the same audit that found the false positives, neither previously
relied upon by any decision gate. `TRUE-POSITIVE RETENTION`'s interleaved containment ordering
(TP 0.25 < FP 0.33 < FP 0.375 < TP 0.385) is the honest caveat: full corroboration's win here is a net
aggregate improvement, not proof that containment ≥0.40 cleanly separates duplicate from distinct at
high cosine on organic content in general. It separated *this* evidence correctly in aggregate; a
different real organic pair could in principle land on the wrong side of 0.40 in either direction.

## PREFERRED OFFLINE POLICY

**H2_FULL_CORROBORATION**, with the tie to H3 stated plainly rather than papered over: H2 and H3 are
byte-identical on all 111 pairs inspected (`H3 EXTREME-COSINE BYPASS`) — the evidence itself does not
prefer one over the other on precision or recall. The preference for H2 is a parsimony tiebreak, not a
performance distinction: H3's 0.95 bypass is a free parameter that no pair in this evidence set — 111
pairs, spanning five independently-sourced provenances — has ever exercised as a distinguishing
mechanism. Absent a real pair that actually needs the bypass, the simpler rule (one fewer threshold, no
branch that has never fired differently from pure corroboration) is preferred. This is a recommendation
for future consideration only; neither policy is implemented in production code by this phase.

## SHOULD REDUNDANCY BE ENABLED BY DEFAULT?

**NO.**

This phase's evidence does not invalidate 2C.8's context-impacting false-positive finding — it confirms
and sharpens it: both false positives have real, measured containment below the existing corroboration
bar, exactly the mechanism 2C.8's own `RECOMMENDED NEXT STEP` predicted would explain them. This remains
a retrospective evaluation of a candidate offline policy change, not a new breadth pilot, and per
instruction does not itself justify a default-enable regardless of outcome. `packages/mcp/src/
bootstrap.ts:40` re-read directly this phase: still `{ enabled: false, ...DEFAULT_NEAR_DUPLICATE_POLICY }`.

## LEARNING READINESS

**NOT READY.** Unchanged from every prior phase. This phase made zero `getContext`, `feedback`, or
`recordOutcome` calls — it is pure offline reclassification of already-recorded evidence. No learning
mechanism was implemented, prototyped, or scaffolded.

## RISKS

- **Small sample at the band that matters most.** The entire case for and against full corroboration at
  ≥0.80 rests on exactly 4 `organic-2C8` pairs (2 TP, 2 FP) — real, but still a small sample from one
  phase's 5-project pilot. The interleaved TP/FP containment ordering found here (`TRUE-POSITIVE
  RETENTION`) means a slightly different real pair could plausibly land on either side of 0.40 in either
  direction; this is not a stable, population-level separation, the same caveat every phase back through
  2C.2 has carried.
- **H3's 0.95 value remains completely untested.** Fixed before analysis per instruction, and correctly
  not tuned afterward — but no pair anywhere in 111 inspected ever sits in the region that would actually
  exercise it (cosine ≥0.95 with containment <0.40, or cosine <0.95 duplicate that 0.95 could have
  rescued). This phase leaves 0.95 exactly as validated (not at all) as it was before.
- **Ten of Phase 2C.8's twelve pairs had no verbatim content in `docs/PHASE_2C8_REPORT.md` itself** (it
  paraphrased 5, gave none for the other 7). This phase recovered exact production content from
  `data/brain.db` directly and cross-checked two containment values by hand (`be174a56~ce0fa075` = 0.25,
  `909d5511~f4ebe0ae` = 0.375, both reproduced exactly from first principles) — high confidence, but this
  is evidence pulled from a different location than the fully-frozen markdown corpus the brief's `DATA`
  section names, disclosed rather than silently treated as identical in kind.
- **The "historical carryover" bucket contributes zero net-new evidence** after dedup against
  `authored/rest-api-a2`. Correct per instruction, but means this phase's true independent evidence base
  beyond the frozen 99 is exactly the 10 metrics-eligible `organic-2C8` pairs, not 11.
- **No live re-run.** `2C.8 CONTEXT-IMPACT IMPLICATION`'s conclusions are structurally certain
  (a pair that never enters `redundancyPairs` cannot cause a demotion) but the exact resulting delivery
  composition under H2 was not confirmed by a fresh `getContext` call, per instruction.

## RECOMMENDED NEXT STEP

Not implemented here, per instruction. If H2 (or H3) is pursued further, follow the same sequence every
prior 2C phase has used before any default-enable: implement as unit-tested production code behind the
disabled flag (2C.7 Part A-style) → live single-pilot validation against real `data/brain.db` confirming
both former false positives now classify DISTINCT and every hard case still classifies correctly (2C.7
Part B-style) → a **fresh** organic breadth pilot across new projects (2C.8-style), specifically watching
whether new real ≥0.80 organic pairs continue to show the interleaved TP/FP containment ordering found
here — that pattern, if it recurs at scale, would mean λ=0.40 is a net-favorable but not a structurally
reliable separator, worth knowing before any wider rollout. Not scheduled by this phase.

STOP. No production changes.

---

## FINAL VERIFICATION

`.pilot-tmp/` (`query-2c8-memories.mjs`, `analyze.mjs`, `out.json`, `err.log`, `test-output.log`)
deleted at cleanup.

```
npm run typecheck     PASS, 0 errors, all 14 workspaces
npm run build          PASS, 0 errors, all workspaces built
npm test                386/386 passing, 0 failing (evaluation 64, gateway 33, knowledge 9, mcp 20,
                         storage 51, compression 7, context 29, contracts 53, learning 2, memory 1,
                         ranking 23, retrieval 45, test-fixtures 23, token 26)
npm audit                0 vulnerabilities
packages/storage         test:integration -- 3/3 (0.8037/0.5423/0.3667, unchanged)
packages/evaluation       test:integration -- 2/2 (71-pair boundary run reproduces 2C.3 exactly,
                          including rest-api-c at 0.772566 -- independent real-model cross-check of the
                          same cosine value this report's containment analysis used)
```

No test was added, removed, or modified this phase. No production source file was touched — confirmed
by `git status` showing only the same 5 pre-existing untracked docs (`PHASE_2C4_REPORT.md` through
`PHASE_2C8_REPORT.md`) both before and after this phase's scratch scripts existed.
`packages/mcp/src/bootstrap.ts:40` re-read directly: still `{ enabled: false,
...DEFAULT_NEAR_DUPLICATE_POLICY }`. Rule H (`packages/core/retrieval/src/lexical-containment.ts`) is
byte-for-byte unchanged from 2C.7/2C.8.
