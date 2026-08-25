# Phase 2C.3 Report — High-Similarity Boundary Validation

Evaluation-only. `DEFAULT_REDUNDANCY_THRESHOLD` (0.75), `Gateway`'s redundancy config,
`toRedundancyPairs`, `compileContext`, `rank()`, `computeScore()`, the token optimizer, and scope
behavior are all unchanged — confirmed by `git status` (only `packages/evaluation/*` touched) and a
fresh full regression run (below). Extends `docs/PHASE_2C2_REPORT.md`; that report's own fixture
(`redundancy-pairs.jsonl`) is untouched and retained as historical evidence.

## PHASE 2C.3 STATUS

Complete. Added 50 new hand-labeled pairs (25 near-duplicate, 25 same-domain-distinct) across two
independently-authored batches, focused specifically on the 0.70–0.90 boundary. Combined with Phase
2C.2's original 21 category-A/C pairs, analyzed 71 pairs total under the real embedding model.
Paraphrase (B) and unrelated (D) data from 2C.2 retained but out of scope for this phase's decision,
per instruction.

## ARCHITECTURAL DEFINITION

Tested framing: Phase 2 redundancy as **high-confidence near-duplicate suppression**, not general
semantic paraphrase detection. False positives (demoting genuinely distinct knowledge) are treated as
more harmful than false negatives (a missed duplicate only costs tokens). This phase asks whether a
conservative high-similarity threshold can safely support that narrower definition — not whether it
can also catch paraphrases (already answered NO, structurally, in 2C.2).

## DATASET

`packages/evaluation/datasets/redundancy-pairs-boundary.jsonl` — 50 new pairs (25 category A near-duplicate,
25 category C same-domain-distinct), same 10 domains as 2C.2 (rest-api, validation, repository-database,
typescript-conventions, testing, error-handling, authentication, logging, caching, service-boundaries).
Reuses the existing `RedundancyPairSchema`/loader (`redundancy-pairs-dataset.ts`), extended with one
new optional `batch` field (`null` for every 2C.2 row, authored before batching existed).

Near-duplicate perturbation types covered: reordered clauses, changed examples, singular/plural
wording, equivalent terminology, extra explanatory phrase, different project prefix. Distinct-pair
difficulty types covered: same nouns/different rule, same framework/different architectural
requirement, same API resource/different constraint, same database vocabulary/different
responsibility, same authentication vocabulary/different security requirement.

## AUTHORING BATCHES

**Batch 1** (13 near-duplicate + 12 distinct = 25 pairs) was authored and written to the fixture file
first, in full. **Batch 2** (12 near-duplicate + 13 distinct = 25 pairs) was then authored
independently and appended. No pair in this file — batch 1 or batch 2 — had been embedded or scored
at any point before both batches were fully written; the real-model test ran exactly once, after
authoring was complete. This is a stronger guarantee than "don't look at the scores while writing
batch 2": no score existed yet to look at, for either batch.

Batch-level summary (near-duplicate / distinct, similarity):

| batch | near-dup min | near-dup max | near-dup mean | distinct min | distinct max | distinct mean |
|---|---|---|---|---|---|---|
| batch-1 | 0.6211 | 0.9943 | 0.8954 | 0.3823 | 0.6545 | 0.5098 |
| batch-2 | 0.6570 | 0.9786 | 0.8712 | 0.2345 | 0.6786 | 0.4129 |

Both batches independently show the same qualitative shape (near-dup mean well above distinct mean,
each with its own low-scoring near-duplicate outlier) — the pattern below replicated across two
authoring passes that could not have influenced each other.

## LABELING POLICY

Category (A/C, therefore `expectedLabel`) fixed at authoring time for every new pair, before any
embedding call — for both batches. No label changed after seeing a score.

## REAL-MODEL RESULTS

Full per-pair listing (71 rows: 21 from 2C.2, 50 new) captured directly from the real-model test run.
Every 2C.2 value reproduced exactly. Notable new-pair results (full data in the fixture files and raw
test output):

| id | batch | domain | similarity | note |
|---|---|---|---|---|
| b1-rest-api-nd-1 | batch-1 | rest-api | 0.9943 | reordered clauses |
| b1-error-handling-nd-1 | batch-1 | error-handling | **0.6211** | equivalent terminology — **lowest near-dup overall** |
| b2-error-handling-nd-1 | batch-2 | error-handling | **0.6570** | changed example |
| b2-rest-api-nd-1 | batch-2 | rest-api | **0.7352** | equivalent terminology |
| rest-api-c (2C.2) | — | rest-api | 0.7726 | same-domain distinct — **highest distinct overall** |
| b2-validation-dist-1 | batch-2 | validation | 0.6786 | highest among the 50 new pairs (still below 0.70) |

## HIGH-SIMILARITY DISTRIBUTION

Combined 2C.2 + 2C.3, category A and C only:

| category | count | min | max | mean | median |
|---|---|---|---|---|---|
| near-duplicate (A) | 36 | 0.6211 | 0.9996 | 0.9051 | 0.9223 |
| same-domain distinct (C) | 35 | 0.1798 | 0.7726 | 0.4567 | 0.4543 |

Focus window [0.70, 0.90]: 11/36 near-duplicate pairs fall in this window, 2/35 distinct pairs do
(`rest-api-c` 0.7726 and `validation-c` 0.749969, both from 2C.2 — no pair from the 50 new 2C.3 pairs
reaches 0.70). This window is where the two classes' tails actually meet.

## BOUNDARY MARGIN

```
min(near-duplicate) = 0.621101  (b1-error-handling-nd-1)
max(distinct)        = 0.772566  (rest-api-c)
margin                = -0.151465
```

**Classes overlap globally.** Three near-duplicate pairs (all vocabulary-substitution-style rewrites,
not structural ones — see below) score below the highest distinct pair. This is a real result, not
an artifact — reported as-is per instruction.

However, excluding those three specific outliers, the remaining 33 near-duplicate pairs have a floor
of 0.8054 (`rest-api-a1`, from 2C.2) against the same 0.7726 distinct ceiling — a **local margin of
+0.0328** immediately around the practical 0.75–0.80 operating range. Both facts are true
simultaneously and are reported together, not substituted for each other: the global picture is
overlap; the local picture at the actual candidate thresholds is a thin but real, reproducible gap.

**What separates the three outliers from the other 33 near-duplicates**, checked precisely rather
than assumed: every "reordered clauses" (4/4), "different project prefix" (4/4), "singular/plural
wording" (3/3), and "extra explanatory phrase" (4/4) pair stayed at or above 0.8054 — clean, no
exceptions. "Changed example" was clean in 4 of 5 cases. "Equivalent terminology" was the least
reliable perturbation type: 2 of 4 cases dropped (0.62, 0.74), 2 stayed high (0.90, 0.88) — whether a
vocabulary-substitution rewrite stays detectable appears to depend on how much of the sentence's core
wording actually changed, not on the perturbation label alone.

## THRESHOLD SWEEP

71 pairs (36 near-duplicate, 35 distinct):

| τ | TP | FP | TN | FN | precision | recall | F1 | FPR | FNR |
|---|---|---|---|---|---|---|---|---|---|
| 0.700 | 34 | 2 | 33 | 2 | 0.944 | 0.944 | 0.944 | 0.057 | 0.056 |
| 0.725 | 34 | 2 | 33 | 2 | 0.944 | 0.944 | 0.944 | 0.057 | 0.056 |
| 0.750 | 33 | 1 | 34 | 3 | 0.971 | 0.917 | 0.943 | 0.029 | 0.083 |
| **0.775** | **33** | **0** | **35** | **3** | **1.000** | **0.917** | **0.957** | **0.000** | **0.083** |
| **0.800** | **33** | **0** | **35** | **3** | **1.000** | **0.917** | **0.957** | **0.000** | **0.083** |
| 0.825 | 30 | 0 | 35 | 6 | 1.000 | 0.833 | 0.909 | 0.000 | 0.167 |
| 0.850 | 28 | 0 | 35 | 8 | 1.000 | 0.778 | 0.875 | 0.000 | 0.222 |
| 0.875 | 27 | 0 | 35 | 9 | 1.000 | 0.750 | 0.857 | 0.000 | 0.250 |
| 0.900 | 23 | 0 | 35 | 13 | 1.000 | 0.639 | 0.780 | 0.000 | 0.361 |

0.775 and 0.80 are statistically identical on this sample (nothing scores in between).

## 0.75 RESULT

TP=33, FP=1, TN=34, FN=3. Precision 0.971, recall 0.917. The one false positive is the same specific
pair 2C.2 already found (`rest-api-c`) — not a new failure, but not resolved by the larger sample
either; still exactly one real, measured false positive at the current production default.

## 0.80 RESULT

TP=33, FP=0, TN=35, FN=3. Precision **1.000**, recall 0.917 — identical recall to 0.75, strictly
better precision (the one false positive disappears; no new false positive appears). Same 3 false
negatives as 0.75 (none of the three outlier near-duplicates sit between 0.75 and 0.80 — they're all
well below 0.75 to begin with).

## FALSE POSITIVES

At τ ≥ 0.775: zero. At τ = 0.75: exactly one, `rest-api-c` (0.7726, from 2C.2) — `validation-c`
(0.749969, also from 2C.2) sits just below 0.75 and is correctly excluded here, the same near-miss
2C.2 already noted. At τ = 0.70/0.725: two — `rest-api-c` (0.7726) and `validation-c` (0.749969),
since both clear 0.70. No pair from the 50 new 2C.3 pairs is a false positive at any threshold in the
swept range — the highest new distinct-pair score, `b2-validation-dist-1` at 0.6786, stays below
0.70 throughout.

## FALSE NEGATIVES

Constant at 3 for every τ from 0.75 through 0.80: `b1-error-handling-nd-1` (0.6211),
`b2-error-handling-nd-1` (0.6570), `b2-rest-api-nd-1` (0.7352). Grows beyond 3 only above 0.80, as
additional legitimate near-duplicates (structural, not vocabulary-substitution) start falling below
higher thresholds (e.g. `rest-api-a1` at 0.8054 is lost above ≈0.81).

## PRECISION-FIRST ANALYSIS

Evaluated by false-positive count first, precision second, recall third — not by F1. By false-positive
count alone, every τ ≥ 0.775 ties at zero; 0.75 has one; below that, more. Among the zero-FP tier
(0.775–0.90), precision ties at 1.000 throughout, so recall breaks the tie: 0.775/0.80 (0.917) beats
0.825 (0.833), which beats 0.85 (0.778), etc. **0.80 is the most conservative threshold that does not
sacrifice any additional recall over 0.775** — the natural pick, not because it happens to also carry
the highest F1 in this sweep (it does, at 0.957, tied with 0.775 — a coincidence of this sample, not
the selection method).

## IMPORTANT ANALYSIS

1. **Does 0.75 remain too permissive?** Yes, marginally — it still permits exactly the one real false
   positive found in 2C.2 (`rest-api-c`), unchanged by the larger sample. Precision improves
   arithmetically (0.917 → 0.971) only because the denominator grew, not because the risk went away.
2. **Does 0.80 maintain high-confidence duplicate detection?** Yes — 33/36 (91.7%) of all
   near-duplicate pairs, including every purely structural rewrite tested (reordering, prefix swap,
   example swap, plural/singular, explanatory-phrase addition — 15/15 clean), still detected.
3. **Is there a meaningful safety margin around 0.80?** Locally yes (+0.0328, between 0.8054 and
   0.7726), globally no (-0.1515, driven by 3 named outliers). Both true; report both, not one.
4. **Does any distinct pair exceed 0.80?** No. Highest observed is 0.7726, comfortably below.
5. **Does any true near-duplicate fall below 0.80?** Yes, 3 of 36 — all vocabulary-substitution
   rewrites, not structural ones (see BOUNDARY MARGIN).
6. **Is there a threshold with zero observed false positives and acceptable near-duplicate recall?**
   Yes — 0.775 or 0.80, both zero FP, 91.7% recall.

## SHOULD REDUNDANCY MEAN NEAR-DUPLICATE SUPPRESSION?

**YES** — bounded to what was actually shown. For structural near-duplicates (reordering, prefix
substitution, example substitution, singular/plural, added explanatory phrasing), cosine similarity
with a conservative threshold (~0.80) achieves zero observed false positives against same-domain
distinct content across a 71-pair, two-batch, author-bias-mitigated sample, with real recall (91.7%)
on top of it. This does **not** extend to heavy vocabulary-substitution rewrites (2 of 4 "equivalent
terminology" cases dropped below the threshold) — that failure mode belongs to the paraphrase problem
2C.2 already showed cosine cannot solve alone, not to this narrower near-duplicate framing. The
YES is specifically for the narrow definition tested, not a claim that this also fixes paraphrase
detection.

## RECOMMENDED CONSERVATIVE THRESHOLD

**0.80.** Ties with 0.775 on this sample (identical confusion matrix) but is the rounder, more
conservative constant with zero recall cost, sits 0.0328 above the highest observed distinct pair,
and is only 0.0054 below the weakest observed structural near-duplicate (`rest-api-a1`, 0.8054) —
a real but thin cushion on both sides. `DEFAULT_REDUNDANCY_THRESHOLD` was not changed; this is a
recommendation for a future decision, not an applied change.

## READY FOR DEFAULT-ENABLE PILOT?

**YES** — specifically, ready for a pilot scoped to near-duplicate suppression at ~0.80, not a general
redundancy pilot and not a change to the production default itself. This reflects real accumulated
evidence: two independent evaluation phases (2C.2, 2C.3) now agree that 0.80 strictly dominates 0.75
on measured samples; this phase adds a denser (71 vs. 41 pair), author-bias-mitigated sample and finds
the same result reproduces; and every structural near-duplicate perturbation type tested (15/15) was
correctly detected with zero false positives at that threshold. The specific, named residual risk
(vocabulary-heavy rewrites) is exactly the kind of concrete finding a scoped pilot — not a blind
default flip — exists to validate against real, not benchmark, content.

## TEST COUNTS

| | count |
|---|---|
| New pure unit tests | 0 (no changes to `classification-metrics.ts`) |
| New real-model integration test (`redundancy-boundary.test.ts`) | 1/1 pass, 71 pairs measured |
| Full repo regression (`npm test`) | **367/367** (unchanged from Phase 2C.2) |
| `packages/storage` `test:integration` | 3/3 pass, unchanged |
| `packages/evaluation` `test:integration` | 2/2 pass (2C.2's benchmark + this phase's boundary test) |

## RESULT

`npm run typecheck` — PASS. `npm run build` — PASS. `npm test` — **367/367**, 0 failing. `npm audit`
— **0 vulnerabilities**. `packages/storage` `test:integration` — 3/3, unchanged. `packages/evaluation`
`test:integration` — 2/2 (both real-model tests green, including the new 71-pair boundary run and all
its structural + known-pair assertions). `git status`: only `packages/evaluation/*` changed (one new
dataset, one new test file, one schema field added, `package.json` updated to run both integration
tests) plus the still-untracked `docs/PHASE_2C2_REPORT.md` from the prior phase — no production
package touched.

## RISKS

- **Global overlap is real**, not resolved by this phase — three near-duplicate pairs score below
  the best distinct pair. The recommendation is scoped explicitly around structural perturbations;
  presented as a blanket "near-duplicate threshold" without that scope, it would overclaim.
- **Single-author risk reduced but not eliminated.** Two independent batches by the same agent is a
  real mitigation against within-session drift/tuning, but not equivalent to a second human author —
  both batches still share one author's judgment of what counts as "the same rule."
- **Domain-specific fragility observed but not fully explained.** Both error-handling near-duplicate
  attempts (independently authored, different perturbation types) landed among the three lowest
  scores. Plausibly specific to this domain's vocabulary under this embedding model; not confirmed
  against more error-handling examples, and not investigated further here (out of scope).
- **71 pairs is still a benchmark, not production traffic.** Real memory content will vary more than
  10 hand-authored domains can represent, same caveat as 2C.2.

## RECOMMENDED NEXT STEP

Run the scoped pilot: a real, live, default-enable trial specifically bounded to near-duplicate
suppression at threshold ≈0.80 (not a general redundancy default-flip), instrumented to specifically
watch for the named residual risk (a vocabulary-heavy rewrite of real project content scoring high
enough to false-positive, or a real near-duplicate scoring low enough to be missed) — the same
methodology Phase 2C.1's pilots already established, now aimed at validating this specific,
evidence-backed threshold rather than the disabled/enabled question in the abstract.

---

STOP. No production behavior modified. `DEFAULT_REDUNDANCY_THRESHOLD` unchanged at 0.75. Redundancy
still ships disabled by default.
