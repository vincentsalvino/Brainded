# Phase 2C.2 Report — Redundancy Threshold Characterization

Evaluation-only. No production redundancy behavior, ranking, token optimization, or learning
changed. `DEFAULT_REDUNDANCY_THRESHOLD` (0.75), `Gateway`'s redundancy config, `toRedundancyPairs`,
`compileContext`, `rank()`, `computeScore()`, the token optimizer, and scope behavior are all
untouched — confirmed by `git status` (only `packages/evaluation/*` changed) and by a fresh full
regression run (below).

## PHASE 2C.2 STATUS

Complete. Built a 41-pair, hand-labeled, real-model redundancy benchmark
(`packages/evaluation/datasets/redundancy-pairs.jsonl`), a pure classification-metrics module with
its own unit tests (default suite), and a real-model integration test
(`packages/evaluation/src/redundancy-benchmark.test.ts`, `packages/evaluation` `test:integration`
only). All labels were fixed before any pair was embedded. Real embedding run complete; findings
below are direct measurements, not estimates.

## DATASET

`packages/evaluation/datasets/redundancy-pairs.jsonl`, 41 pairs, 10 domains (rest-api, validation,
repository-database, typescript-conventions, testing, error-handling, authentication, logging,
caching, service-boundaries), 4 categories (A/B/C/D). Includes the four required known
observations verbatim (`rest-api-a1`, `rest-api-a2`, `validation-b`, `validation-c`) plus 37
newly-authored pairs, one per domain per category except `rest-api`, which carries both known REST
pairs (5 pairs instead of 4). Schema + loader: `packages/evaluation/src/redundancy-pairs-dataset.ts`
(new file, not a reuse of `dataset.ts`'s `EvalExample` shape — a pair-benchmark is a different axis
from a task/ranked-memories example, same distinction `docs/archive/phase-2c/PHASE_2C_PILOT_REPORT.md` already drew
between A/B/C content pairs and A/A′/C′ ranking strategies).

## LABELING POLICY

Every pair's category (and therefore its derived `expectedLabel` — A/B → redundant, C/D → distinct,
computed by `expectedLabelForCategory()`, never stored twice) was fixed at authoring time, before any
embedding call. The benchmark was run exactly once end-to-end after authoring; no pair's category or
content was edited afterward. The four known real pairs use their original verbatim content from
Phase 2C.1 Pilots #1/#2, unedited.

## CATEGORY COUNTS

| Category | Meaning | Count | Expected label |
|---|---|---|---|
| A | near-verbatim redundant | 11 | redundant |
| B | paraphrase redundant | 10 | redundant |
| C | same-domain distinct | 10 | distinct |
| D | unrelated | 10 | distinct |
| **Total** | | **41** | 21 redundant / 20 distinct |

## REAL-MODEL RESULTS

Real `LocalEmbeddingProvider` (`Xenova/all-MiniLM-L6-v2`), embeddings cached by unique content string
(41 pairs → fewer unique embed calls, since several domains reuse one anchor sentence across their
own A/B/C/D pairs). Full content for every pair is in `redundancy-pairs.jsonl`; similarities below,
by category:

| id | domain | expected | similarity |
|---|---|---|---|
| rest-api-a1 (known) | rest-api | redundant | 0.805385 |
| rest-api-a2 (known) | rest-api | redundant | 0.999573 |
| validation-a | validation | redundant | 0.994061 |
| repository-database-a | repository-database | redundant | 0.973266 |
| typescript-conventions-a | typescript-conventions | redundant | 0.933651 |
| testing-a | testing | redundant | 0.973528 |
| error-handling-a | error-handling | redundant | 0.968905 |
| authentication-a | authentication | redundant | 0.985248 |
| logging-a | logging | redundant | 0.962503 |
| caching-a | caching | redundant | 0.974291 |
| service-boundaries-a | service-boundaries | redundant | 0.918418 |
| logging-b | logging | redundant | 0.641615 |
| validation-b (known) | validation | redundant | 0.634876 |
| authentication-b | authentication | redundant | 0.604862 |
| rest-api-b | rest-api | redundant | 0.592658 |
| testing-b | testing | redundant | 0.580712 |
| repository-database-b | repository-database | redundant | 0.566826 |
| caching-b | caching | redundant | 0.532239 |
| error-handling-b | error-handling | redundant | 0.493004 |
| service-boundaries-b | service-boundaries | redundant | 0.479351 |
| typescript-conventions-b | typescript-conventions | redundant | 0.405166 |
| rest-api-c | rest-api | distinct | **0.772566** |
| validation-c (known) | validation | distinct | 0.749969 |
| service-boundaries-c | service-boundaries | distinct | 0.563831 |
| logging-c | logging | distinct | 0.503722 |
| error-handling-c | error-handling | distinct | 0.443534 |
| caching-c | caching | distinct | 0.413637 |
| testing-c | testing | distinct | 0.297358 |
| typescript-conventions-c | typescript-conventions | distinct | 0.291959 |
| repository-database-c | repository-database | distinct | 0.282404 |
| authentication-c | authentication | distinct | 0.179838 |
| repository-database-d | repository-database | distinct | 0.291970 |
| logging-d | logging | distinct | 0.115639 |
| authentication-d | authentication | distinct | 0.088070 |
| service-boundaries-d | service-boundaries | distinct | 0.031892 |
| rest-api-d | rest-api | distinct | 0.079354 |
| error-handling-d | error-handling | distinct | 0.071734 |
| typescript-conventions-d | typescript-conventions | distinct | 0.068625 |
| testing-d | testing | distinct | 0.055253 |
| caching-d | caching | distinct | 0.038652 |
| validation-d | validation | distinct | 0.029963 |

All four known pairs reproduced within 0.001 of their originally-measured values (0.805/0.9996/0.634876/0.749969) — confirms `LocalEmbeddingProvider` is deterministic across independent runs, not just within one session.

## SIMILARITY DISTRIBUTIONS

| category | count | min | max | mean | median |
|---|---|---|---|---|---|
| A (near-verbatim redundant) | 11 | 0.8054 | 0.9996 | 0.9535 | 0.9733 |
| B (paraphrase redundant) | 10 | 0.4052 | 0.6416 | 0.5531 | 0.5738 |
| C (same-domain distinct) | 10 | 0.1798 | 0.7726 | 0.4499 | 0.4286 |
| D (unrelated) | 10 | 0.0300 | 0.2920 | 0.0871 | 0.0702 |

**A and B do not overlap at all** (A's floor 0.805 is above B's ceiling 0.642). **B and C overlap
substantially** (B spans 0.405–0.642; C spans 0.180–0.773 — C's ceiling exceeds B's ceiling). This is
the central, structural finding of this phase.

## THRESHOLD SWEEP

Positive class = "redundant." All 9 required thresholds:

| τ | TP | FP | TN | FN | precision | recall | F1 | FPR | FNR |
|---|---|---|---|---|---|---|---|---|---|
| 0.50 | 18 | 4 | 16 | 3 | 0.818 | 0.857 | 0.837 | 0.200 | 0.143 |
| 0.55 | 17 | 3 | 17 | 4 | 0.850 | 0.810 | 0.829 | 0.150 | 0.190 |
| 0.60 | 14 | 2 | 18 | 7 | 0.875 | 0.667 | 0.757 | 0.100 | 0.333 |
| 0.65 | 11 | 2 | 18 | 10 | 0.846 | 0.524 | 0.647 | 0.100 | 0.476 |
| 0.70 | 11 | 2 | 18 | 10 | 0.846 | 0.524 | 0.647 | 0.100 | 0.476 |
| **0.75** | **11** | **1** | **19** | **10** | **0.917** | **0.524** | **0.667** | **0.050** | **0.476** |
| 0.80 | 11 | 0 | 20 | 10 | 1.000 | 0.524 | 0.688 | 0.000 | 0.476 |
| 0.85 | 10 | 0 | 20 | 11 | 1.000 | 0.476 | 0.645 | 0.000 | 0.524 |
| 0.90 | 10 | 0 | 20 | 11 | 1.000 | 0.476 | 0.645 | 0.000 | 0.524 |

Per the brief, precision is the primary safety metric — no threshold was chosen by maximum F1 (that
would favor 0.50, the worst threshold for false-positive risk).

## 0.75 ANALYSIS

**Redundant pairs detected**: 11 — all 11 of category A, zero of category B. **Redundant pairs
missed**: 10 — all 10 of category B. **Distinct pairs incorrectly flagged**: 1 —
`rest-api-c` ("REST endpoints must use plural nouns..." vs "...must version their path with a
leading /v1, /v2 segment...", similarity 0.7726) — a real, same-domain, genuinely different rule
pushed over the line by shared REST vocabulary. **Precision 0.917, recall 0.524.**

0.75 behaves as **near-duplicate detection, not semantic redundancy detection**. It catches
near-verbatim rewording with high reliability (11/11) and catches essentially no paraphrase-level
redundancy (0/10) — the two categories don't overlap in similarity space at all, so this isn't a
borderline effect, it's a clean floor. Not overclaiming precision either: 0.917 is good but not
perfect, and the one miss is a same-domain pair, exactly the class of content most likely to appear
beside genuinely redundant memories in practice.

## PARAPHRASE VS DISTINCT COLLISION

At what threshold would `validation-b` (the paraphrase, similarity 0.634876) be detected? Any
τ ≤ 0.634876. At that same threshold, what happens to `validation-c` (the intentionally distinct
pair, similarity 0.749969)? It is **also** flagged redundant, since 0.749969 ≥ any τ ≤ 0.634876.

**No single threshold classifies both correctly.** The redundant pair scores lower than the distinct
one (0.634876 < 0.749969) — the two required conditions (τ ≤ 0.634876 for the paraphrase, τ > 0.749969
for the distinct pair) are mutually exclusive. This is not an isolated coincidence: the same inversion
holds at the category level (B's max 0.6416 < C's max 0.7726).

## FALSE POSITIVES

At τ = 0.75: exactly one, `rest-api-c` (0.7726). Distinct rule, same domain, shares "REST",
"endpoints"/"resource" vocabulary with its counterpart despite governing an unrelated concern
(pluralization vs. versioning). At lower thresholds more category-C pairs cross: `validation-c`
(0.7500) joins at τ ≤ 0.70 (fp=2), `service-boundaries-c` (0.5638) at τ ≤ 0.55 (fp=3), `logging-c`
(0.5037) at τ = 0.50 (fp=4).

## FALSE NEGATIVES

At τ = 0.75: exactly ten — every category-B pair, all missed. Recall does not exceed 0.857 anywhere
in the swept range (τ = 0.50), and even there, 3 of 21 redundant pairs are still missed
(the three lowest-scoring category-B pairs: `typescript-conventions-b` 0.405,
`service-boundaries-b` 0.479, `error-handling-b` 0.493).

## IS A SINGLE COSINE THRESHOLD SUFFICIENT?

**NO.**

Category B (paraphrase redundant) and category C (same-domain distinct) distributions overlap
substantially and C's ceiling exceeds B's ceiling. No threshold ordering can prioritize "catch B"
ahead of "reject C" — every value tested either sacrifices most-to-all paraphrase recall (≥0.65) or
accepts real same-domain false positives (≤0.70, worsening as τ drops). This is a structural
limitation of cosine similarity on this benchmark, not a tuning problem solvable by picking a
different constant.

## SHOULD 0.75 REMAIN?

**INCONCLUSIVE.**

On this specific sample, τ = 0.80 strictly dominates 0.75: identical recall (0.524, no near-verbatim
pair sits in [0.75, 0.80)) and strictly better precision (1.000 vs 0.917 — the one false positive at
0.75 disappears). Taken alone that favors moving up. But the margins on both sides are thin: the
known calibration pair `rest-api-a1` sits at 0.8054, only 0.005 above 0.80 — a threshold pushed much
further would start losing the very pair 0.75 was originally calibrated against. This 41-pair,
mostly-one-sample-per-cell benchmark is not dense enough near the 0.75–0.80 boundary to confidently
generalize a specific replacement value beyond this exact sample. Not a recommendation either way —
`DEFAULT_REDUNDANCY_THRESHOLD` was not changed, per instruction.

## IMPLICATION FOR REDUNDANCY DEFAULT ENABLEMENT

This phase does not itself answer "enable redundancy by default" (Phase 2C.1's question, unchanged).
It adds one new, concrete data point to that question: 0.75 carries a **real, measured precision
risk** against same-domain-distinct content, not only the previously-known paraphrase-recall gap
(Phase 2C.1 Pilot #2's inconclusive A/C result). Both findings point the same direction — toward
continued caution, not toward it. Nothing here changes Phase 2C.1's `NOT ENOUGH EVIDENCE` verdict;
it reinforces the reasoning behind it with a second, independent kind of evidence.

## POSSIBLE FUTURE SIGNALS

Not implemented — conceptual only, evaluated against what this benchmark actually showed:

- **Cosine similarity (baseline, measured here).** Reliable for category A, structurally insufficient
  alone for B vs. C (see above).
- **Lexical overlap** (shared-token/BM25-style). Motivation: category A pairs share nearly all
  tokens; category B pairs by construction do not (that's what makes them paraphrases), so lexical
  overlap would likely track cosine's A/B split rather than resolve it. Testable directly against the
  committed fixture without new data collection — not attempted here, out of scope for this phase.
- **Memory type compatibility.** Motivation: a `rule` and a `constraint` describing overlapping
  territory may not be true duplicates even at high cosine (they serve different roles in this
  system's own 12-type taxonomy). Untested by this benchmark — every pair here is content-only, no
  `type` metadata was varied. A real candidate, but no evidence for or against from this phase.
- **Scope relationship.** Already implemented, but for a *different* sub-problem: 2C.1's
  scope-specificity anchor preference decides which side of an *already-detected* pair anchors, not
  whether a pair is redundant in the first place. Not a detection signal; noted for precision, not
  proposed as new.
- **Shared domain/tags.** Motivation: this benchmark's own `domain` field cleanly separates category
  D (unrelated, similarity ≤0.29) from everything same-domain — a strong signal for filtering
  *unrelated* content out early. Does **not** resolve the harder B-vs-C ambiguity: `rest-api-c`, the
  one real false positive, is same-domain by construction and still crossed 0.75.
- **Normalized token/content overlap** (edit distance / LCS ratio). Same fundamental limit as lexical
  overlap: both B (paraphrase) and C (same-domain distinct) were authored with low surface-text
  overlap against their anchor, so a syntactic-overlap signal would likely be low for both and not
  discriminate between them either.

Net observation across all of the above: the syntactic signals mostly corroborate what cosine
already gets right (category A) or filter what cosine already gets right for free (category D). None
of them has direct evidence, from this benchmark, of resolving the actual open problem — B vs. C is a
*semantic* distinction (does the underlying rule differ), and every cheap heuristic considered here is
fundamentally lexical/structural. Per instruction, historical usefulness and agent outcome data were
not considered as candidate signals.

## TEST COUNTS

| | count |
|---|---|
| New pure unit tests (`classification-metrics.test.ts`, default suite) | 10/10 pass |
| New real-model integration test (`redundancy-benchmark.test.ts`) | 1/1 pass, 41 pairs measured |
| Full repo regression (`npm test`) | **367/367** (357 baseline + 10 new, purely additive) |
| `packages/storage` `test:integration` | 3/3 pass, unchanged (0.804/0.542/0.367) |
| `packages/evaluation` `test:integration` (new) | 1/1 pass |

## COMMANDS

```
npm run typecheck
npm run build
npm test
npm audit
```
Then, separately: `packages/storage`'s `npm run test:integration` and (new)
`packages/evaluation`'s `npm run test:integration`.

## RESULT

`npm run typecheck` — PASS, 0 errors, all workspaces. `npm run build` — PASS. `npm test` —
**367/367 passing, 0 failing**. `npm audit` — **0 vulnerabilities**. `packages/storage`
`test:integration` — 3/3, real-model values unchanged. `packages/evaluation` `test:integration` —
1/1, real-model benchmark green (all structural assertions and all four known-pair tolerance checks
passed). `git status`: only `packages/evaluation/*` changed (one script edit in `package.json`, four
new files, one new dataset) — no other package touched, confirmed by fresh diff inspection, not just
by not having edited anything else on purpose.

## RISKS

- **Thin sample.** 41 pairs, essentially one sample per domain-per-category cell. Real-world memory
  content will vary far more than 10 hand-authored domains can represent — treat every number above
  as directional for this benchmark, not a population estimate.
- **Real, not hypothetical, false positive already observed** (`rest-api-c` at 0.75) — the precision
  risk this phase set out to characterize is not speculative.
- **Author bias.** All 41 pairs were authored by the same agent (me) in one sitting; category
  boundaries reflect one author's judgment of "meaningfully different rule" vs. "same rule,
  reworded" — a second author might draw some C/B boundaries slightly differently. Labels were fixed
  before scoring specifically to prevent post-hoc adjustment, but authoring bias in the boundary
  itself is a different, unmitigated risk.
- **0.02 known-pair tolerance** in the integration test is a regression guard, not a precision claim
  — a future model/library upgrade that shifts real similarities by a few thousandths would still
  pass silently; larger drift would correctly fail the test and should be investigated, not loosened
  reflexively.

## RECOMMENDED NEXT STEP

Human decision on whether the newly-measured precision risk (a real same-domain-distinct false
positive at the current default) changes the risk calculus from Phase 2C.1's `NOT ENOUGH EVIDENCE`.
If paraphrase-level detection remains a goal, the next investigative step — not built in this phase —
would be prototyping exactly one of the candidate signals above (lexical overlap is the cheapest to
try first) against this same committed, replayable fixture, so any future result is directly
comparable to the cosine-only baseline measured here.

---

STOP. No production behavior modified. `DEFAULT_REDUNDANCY_THRESHOLD` unchanged at 0.75. Redundancy
still ships disabled by default.
