# Phase 2C.6 Report — Borderline Near-Duplicate Corroboration

Evaluation-only. No new pair was authored — every content string and similarity value below is
transcribed verbatim from already-committed, already-frozen sources: `packages/evaluation/datasets/
redundancy-pairs.jsonl` (2C.2), `redundancy-pairs-boundary.jsonl` (2C.3), a fresh re-run of
`packages/evaluation`'s own `test:integration` (reproduces every 2C.2/2C.3 similarity to the value
already on record), and this session's own `docs/PHASE_2C5_REPORT.md` / `docs/PHASE_2C4_REPORT.md`.
No embedding was recomputed; no memory was read from or written to `data/brain.db` — this phase needed
neither, since every cosine similarity it uses was already measured in a prior phase. `DEFAULT_REDUNDANCY_THRESHOLD`
and `packages/mcp/src/bootstrap.ts`'s `{ enabled: false }` are unchanged, re-confirmed by direct read
after cleanup. No LLM classifier was introduced. Nothing was implemented in production code.

## PHASE 2C.6 STATUS

Complete. Built a small, deterministic, dependency-free lexical layer (token-set Jaccard and
containment, with and without a local stopword list, with and without literal project-prefix
stripping) over 99 already-labeled pairs (71 authored, 24 organic, 4 control), then swept the
brief's Rule H (`cosine ≥ 0.80 OR (cosine ≥ 0.75 AND lexical ≥ λ)`) against all four required hard
cases. Found an exact configuration — **containment coefficient, stopwords excluded, λ = 0.40** —
that satisfies all four hard cases simultaneously and produces **zero false positives across every
one of the 99 real pairs, in every group**, while recovering both of Phase 2C.5's organic near-duplicates
that plain 0.80 misses entirely. This is a strict improvement over both baselines within the pairs
tested, not a tradeoff.

## EVIDENCE USED

| source | pairs contributed | to group |
|---|---|---|
| `redundancy-pairs.jsonl` (2C.2), category A/C only | 21 | authored |
| `redundancy-pairs-boundary.jsonl` (2C.3), all rows (already A/C only) | 50 | authored |
| `docs/PHASE_2C5_REPORT.md`, frozen PRIMARY pairs (AMBIGUOUS excluded) | 24 | organic |
| `docs/PHASE_2C4_REPORT.md`, live pilot A/B/C pairwise | 3 | control |
| `docs/PHASE_2C5_REPORT.md`, `phase2c-pilot` A~B (measured fresh in that phase) | 1 | control |

**Category B (paraphrase) and D (unrelated) from 2C.2 were excluded**, for the same reason 2C.3
already excluded them: this phase's own `FEATURE DEFINITION` scopes redundancy to *structural*
near-duplicate suppression, explicitly not paraphrase detection, and D pairs (similarity ≤0.29 in
every case) carry no information about the 0.75–0.80 boundary this phase investigates. This is
continuity with 2C.3's own established scoping, not a new exclusion invented for this phase.

`rest-api-a1`/`rest-api-a2` (both already 2C.2 rows) are **not** repeated under "control" — they are
counted once, under `authored`, to avoid inflating either group's denominator. Every group is reported
separately below per instruction; nothing is silently merged.

## LEXICAL TOKENIZATION

Deterministic, no dependency, no stemming: lowercase → every non-alphanumeric character replaced with
a space (so `notes-api` splits into `notes`, `api`; `Zod.` splits into `zod`) → whitespace-collapsed
split → token set (Jaccard/containment operate on sets, not multisets). A second variant additionally
removes a small, locally-defined ~40-word stopword list (articles, `must`/`should`/`never`/`always`,
common prepositions/conjunctions, `e`/`g` from "e.g."). Both variants were computed for every pair;
results for both are reported where they differ.

## PREFIX NORMALIZATION ANALYSIS

Measured containment/Jaccard with vs. without literal project-identifier prefixes stripped
(`phase2c-threshold80-pilot`, `phase2c-pilot`, `phase2c-validation-pilot`, `task-api`, `notes-api`,
and the four 2C.3 perturbation-prefix strings), on real content, not modified in place:

| pair | label | containment WITH prefix | containment WITHOUT prefix | effect |
|---|---|---|---|---|
| 2C.4 A~B (required FP control) | DISTINCT | 0.300 | 0.176 | **prefix roughly doubles the overlap** |
| `phase2c-pilot` A~B | DISTINCT | 0.154 | **0.000** | **prefix is the entire overlap** — zero shared tokens once removed |
| 2C.4 A~C | NEAR_DUPLICATE | 0.762 | 0.762 | unchanged (only A carries the prefix; C never had it to match) |
| N1~G | NEAR_DUPLICATE | 0.385 | 0.333 | modest drop (N1 retains a bare "notes" token outside the prefix) |

**Answer: yes, project identifiers measurably inflate lexical near-duplicate evidence** for pairs where
*both* sides share the literal prefix — confirmed starkly by `phase2c-pilot` A~B, whose entire lexical
overlap vanishes once the prefix is removed. Where only one side carries a prefix the other lacks
(2C.4 A~C), stripping it has no effect, because those tokens were never part of the intersection to
begin with.

**Contrast, not counted toward this analysis but directly relevant:** 2C.3's five near-duplicate pairs
deliberately authored with *different* project prefixes on each side (`checkout-service` vs.
`billing-service`, `notes-service` vs. `billing-service`, `orders-service` vs. `invoices-service`)
score raw containment 0.92–1.00 despite sharing no prefix at all — their lexical overlap is genuine,
not prefix-driven. This is the reason the recommended rule uses containment *with the prefix strings
still present but stopwords removed*, rather than requiring prefix-stripping as part of the production
rule: the false-positive risk is specifically the *shared-prefix* case, which stopword removal alone
does not fix (2C.4 A~B's stopword-excluded, prefix-*intact* containment is still 0.286 — see next
section), but the containment λ=0.40 threshold rejects it regardless, without needing prefix-stripping
logic in the classifier at all. Prefix-stripping was evaluation-only analysis, per instruction; it is
not part of the recommended rule.

## JACCARD RESULTS

Swept over λ ∈ {0.30, 0.40, 0.50, 0.60, 0.70, 0.80, 0.90}, both variants. **No λ, in either variant,
satisfies all four hard cases.** Structural reason, not a tuning failure: Jaccard divides by the
*union*, which grows large whenever one side of a pair is much longer than the other — exactly the
shape of this domain's dominant near-duplicate pattern (a short rule and its more-elaborated,
project-specific restatement, e.g. T4's 7 tokens vs. T6's 17). T4~T6's raw Jaccard is only 0.412 even
though T4 is *entirely* contained in T6; N1~G's is 0.217. Jaccard systematically under-scores this
exact shape of near-duplicate, so raising λ to catch it also lets in unrelated distinct pairs with
smaller, roughly-equal-sized vocabularies, and lowering it loses the hard cases. Not recommended as the
borderline signal.

## CONTAINMENT RESULTS

`containment(A,B) = |A∩B| / min(|A|,|B|)` — normalizes by the *smaller* set, which is exactly the
right shape for "is this short rule wholly subsumed by that longer one": T4~T6 scores a clean **1.00**
(T4's every token appears in T6). Swept the same λ grid, both variants:

| variant | λ | organic TP | organic FP | authored FP | control FP | satisfies all 4 hard cases? |
|---|---|---|---|---|---|---|
| raw | 0.30 | 2 | 0 | 0 | **1** | no (2C.4 A~B's raw containment is exactly 0.300) |
| raw | 0.40–0.90 | 1 | 0 | 0 | 0 | no (loses N1~G at 0.40: raw containment 0.385 < 0.40) |
| **nostop** | **0.30** | 2 | 0 | **1** | 0 | no (rest-api-c's stopword-excluded containment is 0.333 ≥ 0.30) |
| **nostop** | **0.40** | **2** | **0** | **0** | **0** | **YES** |
| **nostop** | **0.50** | 2 | 0 | 0 | 0 | **YES** (N1~G sits exactly at 0.500 — zero margin) |
| nostop | 0.60–0.90 | 1 | 0 | 0 | 0 | no (loses N1~G: nostop containment 0.500 < 0.60) |

The window that works is narrow but real: **[0.40, 0.50]** on the required grid. 0.40 is preferred over
0.50 for margin (N1~G clears it by 0.10, not by exactly 0). Below 0.30 was not swept per instruction
(cosine floor stays at 0.75; the lexical floor's own lower bound was the brief's stated grid).

## COSINE 0.75 BASELINE

| group | TP | FP | TN | FN | precision | recall |
|---|---|---|---|---|---|---|
| authored (71) | 33 | 1 | 34 | 3 | 0.971 | 0.917 |
| organic (24) | 2 | 0 | 20 | 2 | 1.000 | 0.500 |
| control (4) | 0 | **1** | 2 | 1 | 0.000 | 0.000 |
| combined (99) | 35 | 2 | 56 | 6 | 0.946 | 0.854 |

Control's one false positive **is 2C.4's own A~B pair, reproduced exactly** — the same real
false-positive this evaluation-only re-analysis would be expected to reproduce, since it's the same
data.

## COSINE 0.80 BASELINE

| group | TP | FP | TN | FN | precision | recall |
|---|---|---|---|---|---|---|
| authored (71) | 33 | 0 | 35 | 3 | 1.000 | 0.917 |
| organic (24) | **0** | 0 | 20 | **4** | N/A (no positive predictions) | **0.000** |
| control (4) | 0 | 0 | 3 | 1 | N/A | 0.000 |
| combined (99) | 33 | 0 | 58 | 8 | 1.000 | 0.805 |

Organic's 0% recall reproduces 2C.5's finding exactly, as expected from the same underlying numbers.

## HYBRID STRATEGIES

**HYBRID C — the recommended rule** (`cosine ≥ 0.80 OR (cosine ≥ 0.75 AND containment_nostop ≥ 0.40)`):

| group | TP | FP | TN | FN | precision | recall | vs. baseline B |
|---|---|---|---|---|---|---|---|
| authored (71) | 33 | 0 | 35 | 3 | 1.000 | 0.917 | **identical** |
| organic (24) | **2** | 0 | 20 | 2 | 1.000 | **0.500** | **recall doubled (0%→50%), FP unchanged (0)** |
| control (4) | 0 | 0 | 3 | 1 | N/A | 0.000 | **identical, and correctly rejects what 0.75 alone gets wrong** |
| combined (99) | 35 | 0 | 58 | 6 | 1.000 | **0.854** | **recall +4.9pp, FP unchanged (0)** |

**HYBRID J** (Jaccard, either variant): no λ in the required grid satisfies all four hard cases (see
`JACCARD RESULTS`); not adopted.

This is a strict Pareto improvement over Baseline B within the 99 pairs tested: identical
(zero) false positives in every group, strictly better recall in organic and combined, unchanged
elsewhere. It also strictly dominates Baseline A: same or better recall everywhere Baseline A wins,
while eliminating Baseline A's one real false positive.

## AUTHORED BENCHMARK RESULT

Hybrid C is **numerically identical to Baseline B** on the authored 71-pair set (33/0/35/3 both).
This is not a coincidence: 2C.3's own threshold sweep already established "0.775 and 0.80 are
statistically identical on this sample (nothing scores in between)" — there is no authored
near-duplicate sitting in the [0.75, 0.80) gap the hybrid's second clause exists to rescue. The
hybrid adds nothing here because there was nothing here to add — all of its benefit is concentrated
in the organic group, which is exactly where 2C.5 found the actual gap.

## ORGANIC CORPUS RESULT

| strategy | TP | FP | recall |
|---|---|---|---|
| cosine ≥ 0.75 | 2 | 0 | 0.500 |
| cosine ≥ 0.80 | 0 | 0 | 0.000 |
| **Hybrid C (containment, nostop, λ=0.40)** | **2** | **0** | **0.500** |

Zero organic false positives at every strategy tested (the corpus's only DISTINCT-labeled pair that
comes close, T2~T6, sits at cosine 0.676 — below the 0.75 floor regardless of lexical score, so it was
never at risk). Hybrid C recovers exactly T3/T4's constrained-context blind spot from 2C.5 (T4~T6,
N1~G) without recovering — and per instruction, without needing to recover — the two low-similarity
organic pairs (T3~T4 0.395, T3~T6 0.506), which stay excluded by the unmoved 0.75 cosine floor.

## CONTROL RESULT

| strategy | TP | FP | recall | precision |
|---|---|---|---|---|
| cosine ≥ 0.75 | 0 | **1** (2C.4 A~B) | 0.000 | 0.000 |
| cosine ≥ 0.80 | 0 | 0 | 0.000 | N/A |
| **Hybrid C** | **0** | **0** | 0.000 | N/A |

Hybrid C matches Baseline B here (correctly silent) rather than reproducing Baseline A's real error.
The one NEAR_DUPLICATE-labeled control pair (2C.4 A~C, cosine 0.669) is missed by every strategy,
correctly — its cosine never reaches 0.75, so it's outside every tested rule's reachable range, same
status as the organic 0.395/0.506 pairs.

## HARD CASES

| case | requirement | cosine | Hybrid C verdict | met? |
|---|---|---|---|---|
| T4~T6 | DETECT | 0.799007 | containment(nostop) = 1.000 ≥ 0.40 → **NEAR_DUPLICATE** | ✔ |
| N1~G | DETECT | 0.785122 | containment(nostop) = 0.500 ≥ 0.40 → **NEAR_DUPLICATE** | ✔ |
| 2C.4 A~B | REJECT | 0.762576 | containment(nostop) = 0.286 < 0.40 → **DISTINCT** | ✔ |
| rest-api-c | REJECT | 0.772566 | containment(nostop) = 0.333 < 0.40 → **DISTINCT** | ✔ |

**All four satisfied simultaneously.** Not cherry-picked to this exact combination: the same λ=0.40
(and λ=0.50) also produced zero false positives across every *other* pair in all three groups, not
only these four — see `COSINE 0.75/0.80 BASELINE` and `HYBRID STRATEGIES` tables above.

## FALSE POSITIVES

Zero, in every group, at Hybrid C (containment, nostop, λ=0.40). The two near-misses that *would* have
been false positives under a looser λ: rest-api-c (nostop containment 0.333, would trigger at λ≤0.33)
and 2C.4 A~B (nostop containment 0.286, would trigger at λ≤0.29) — both comfortably below 0.40, not
borderline at this specific λ. N1~G's true-positive margin (0.500) is the tighter constraint in the
system: raising λ past 0.50 loses it; there is no room to raise λ further as a safety margin without
losing a required detection, which is why 0.40 (not 0.50, and not higher) is the recommended point —
it keeps distance from *both* the false-positive risks below and the true-positive requirement above.

## FALSE NEGATIVES

Unchanged from Baseline B in authored (3, all cosine <0.75 — the known "vocabulary-heavy rewrite"
misses from 2C.3, `b1`/`b2-error-handling-nd-1` and `b2-rest-api-nd-1`) and in control (1, 2C.4 A~C,
cosine 0.669). In organic, reduced from 4 (Baseline B) to 2 (T3~T4 0.395, T3~T6 0.506) — both correctly
left unrecovered, per instruction not to chase pairs below the 0.75 floor.

## DOES LEXICAL CORROBORATION HELP?

**YES.** Concretely: it recovers both of 2C.5's real organic near-duplicates (doubling organic recall,
0%→50%) and correctly rejects the real false positive 2C.4 found (control precision restored from 0 to
undefined-because-no-false-predictions), simultaneously, at zero measured cost — no new false positive
appears anywhere across 99 real pairs spanning three independently-sourced groups.

## PREFERRED BORDERLINE SIGNAL

**CONTAINMENT.** Jaccard never satisfies all four hard cases at any swept λ, for the structural reason
given in `JACCARD RESULTS`. Containment (specifically stopword-excluded) does, with real margin at two
of the four required grid points.

## EXACT CANDIDATE RULE

```
classify(A, B, cosineSimilarity):
  if cosineSimilarity >= 0.80:
    return NEAR_DUPLICATE

  if cosineSimilarity >= 0.75:
    tokensA = tokenize(A)  // lowercase, non-alphanumeric -> space, split, drop stopwords
    tokensB = tokenize(B)
    containment = |tokensA ∩ tokensB| / min(|tokensA|, |tokensB|)
    if containment >= 0.40:
      return NEAR_DUPLICATE

  return DISTINCT
```

Stopword list: the ~40-word set defined in `LEXICAL TOKENIZATION` above (articles, modal/deontic verbs
common to rule-writing prose, common prepositions/conjunctions). **Not implemented in production** —
evaluation-only, per instruction.

## READY FOR HYBRID REAL PILOT?

**YES**, with the same scope qualifier the brief itself states: this means implementing Rule H behind
the existing disabled redundancy configuration for a further real, live pilot (2C.4/2C.5-style,
`{enabled:true}` only inside a temporary script against real `data/brain.db`) — not enabling redundancy
by default. Justification: the rule is simple (two pure functions, no dependency, no LLM), the
evidence spans three independently-sourced groups (not just the authored benchmark it was partly
derived from), it strictly dominates both existing baselines on every pair tested, and it passes all
four hard cases with real, non-zero margin except one (N1~G, margin 0.10 above λ, 0 above the "loses
detection" line at λ=0.60 — a real but not razor-thin margin). What it has **not** yet had is a live
operational run — no `getContext` call in this phase's evaluation exercised the actual retrieval →
ranking → redundancy-pair → compile pipeline with this rule; every number here is offline pair
classification. That gap is exactly what a further pilot would close.

## SHOULD REDUNDANCY BE ENABLED BY DEFAULT?

**NOT ENOUGH EVIDENCE.** The brief's own default-remains-disabled framing applies directly: strong
retrospective evidence is not the same as live operational evidence, and no phase to date — including
this one — has run a hybrid or corroborated rule through the real Gateway pipeline. Production
configuration was not changed.

## PROPOSED IMPLEMENTATION BOUNDARY

Not implemented now — location only, if a future pilot's result later justifies building it:

| layer | responsibility | change, if approved |
|---|---|---|
| **Storage** (`packages/storage`) | semantic similarity only | **none** — `SqliteRetrievalStore.findSimilarPairs` keeps computing pure cosine; no lexical code, no SQL change |
| **Core retrieval** (`packages/core/retrieval`) | pure near-duplicate classification policy | new pure function alongside `toRedundancyPairs` (`redundancy.ts`) — takes the already-computed `SimilarityPair`s plus the two candidates' already-loaded content, applies the two-stage cosine/containment rule, before scope-anchor orientation runs |
| **Context** (`packages/core/context`) | anchor/demotion only | **none** — `compileContext` keeps consuming the final `redundancyPairs` list exactly as today; it has no idea how a pair was decided |
| **Ranking** (`packages/ranking`) | untouched | **none** — `rank()` has never seen redundancy and wouldn't start now |
| **Gateway** (`packages/gateway`) | configuration/wiring only | extend the existing `{enabled, threshold}` constructor param with an optional corroboration config (`{metric, lambda, stopwords}`); Gateway itself adds no logic, only passes the config through, same as it does today for `threshold` |

No lexical policy in storage SQL, confirmed by design (containment/Jaccard operate on content strings
already resident in `Candidate`/`RankedResult` objects post-retrieval — no new query needed). No
ranking-score manipulation, confirmed (the classifier only feeds the existing boolean
`redundantWith`-orientation step; `RankedResult.score` is never read or written by it).

## TEST COUNTS

| | count |
|---|---|
| `npm run typecheck` | PASS, 0 errors, all 14 workspaces |
| `npm run build` | PASS |
| `npm test` | **367/367 passing, 0 failing** — unchanged from every prior phase, since no source file changed |
| `npm audit` | 0 vulnerabilities |
| `packages/storage` `test:integration` | 3/3, unchanged (0.8037/0.5423/0.3667) |
| `packages/evaluation` `test:integration` | 2/2, unchanged (re-run fresh this phase specifically to source this report's authored-pair similarities — reproduced every value already on record) |

Default test suite remains network-free — this phase added no test file and no dependency; its own
analysis script (`.pilot-tmp/analyze.mjs`, pure JS, zero imports beyond its own local data module) was
deleted at cleanup along with the rest of `.pilot-tmp/`.

## RISKS

- **N=4 hard cases, one embedding model, one deterministic tokenizer.** The result is real and the
  margins are non-trivial (N1~G clears λ=0.40 by 0.10), but this remains a small, specific evidence
  base — the same caveat every phase back through 2C.2 has carried, now applied to a two-stage rule
  instead of a single threshold.
- **N1~G's margin is the tightest constraint in the whole system.** It sets the upper bound on λ
  (0.40–0.50 window); a slightly different notes-api-style pair with weaker lexical overlap than N1~G
  happened to have would not necessarily clear even λ=0.40. The rule's safety margin is real but not
  large.
- **The stopword list is hand-picked for this evaluation, not validated against a larger corpus.**
  Reasonable and standard (articles, modals, common prepositions), but its exact composition was not
  swept or ablated beyond the raw/nostop binary the brief asked for.
- **Retrospective evidence only — see `READY FOR HYBRID REAL PILOT?`.** Every number in this report is
  offline pair classification against already-known similarities; nothing here exercised the live
  Gateway, budget optimizer, or scope-anchor orientation with this specific rule.
- **The two hard-to-recover organic pairs (T3~T4, T3~T6) remain genuinely unrecoverable** by design
  (per instruction) — this phase does not claim to have solved the paraphrase/vocabulary-substitution
  problem 2C.2 already showed cosine alone cannot solve; it narrows the specific 0.75–0.80 structural
  gap 2C.4/2C.5 identified, nothing broader.

## RECOMMENDED NEXT STEP

Run a Phase 2C.7-style live pilot, structurally identical to 2C.4/2C.5's operational-simulation
mechanism (temporary script, real Gateway, `{enabled:true}`, deleted at cleanup), but wired with
**Rule H exactly as specified in `EXACT CANDIDATE RULE`** instead of a plain threshold — specifically
targeting real `getContext` calls against `task-api`'s and `notes-api`'s actual candidate pools (the
same organic memories this phase already has frozen labels for), to close the one gap this phase
could not: whether the rule's classification-time correctness survives contact with the real
retrieval → ranking → redundancy-pair → compile → budget pipeline, not just an offline pair-by-pair
check. Still behind the disabled production flag; still not a default-enable.

STOP. No production behavior changed.

---

## FINAL VERIFICATION

`.pilot-tmp/` (`data.mjs`, `analyze.mjs`, `out.log`) deleted at cleanup.

```
npm run typecheck    PASS, 0 errors, all 14 workspaces
npm run build        PASS
npm test              367/367 passing, 0 failing
npm audit             0 vulnerabilities
packages/storage      test:integration -- 3/3, unchanged
packages/evaluation   test:integration -- 2/2, unchanged (re-run fresh, sourced this report's data)
```

`DEFAULT_REDUNDANCY_THRESHOLD` re-read directly from `gateway.ts:44`: still `0.75`.
`packages/mcp/src/bootstrap.ts:39` re-read directly: still `{ enabled: false, threshold:
DEFAULT_REDUNDANCY_THRESHOLD }`. `git status`: clean before this phase's scratch files were created,
clean after they were deleted — the only untracked files at every check are `docs/PHASE_2C4_REPORT.md`
and `docs/PHASE_2C5_REPORT.md`, both carried over from prior phases and still awaiting a commit
decision, both untouched by this one. No memory in `data/brain.db` was read or written at any point —
this phase needed neither.
