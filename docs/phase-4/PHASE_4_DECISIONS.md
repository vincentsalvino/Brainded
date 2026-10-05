# Phase 4 — Learning: Decisions

`F`-numbered, continuing the project's `D` (Phase 0→1) / `E` (Phase 2) convention — a new
letter per phase-decisions document, not a renumbering of prior ones.

**Grounding for every evidence claim below:** `PHASE_4_FINDINGS.md`. Most of the hard design work
here already happened once, during Phase 2 scoping, in `PHASE_2_DECISIONS.md` (E4–E15) — resolved
and approved, then deliberately shelved ("Learning is not implemented in Phase 2A; this decision
governs P2-010 when it is authorized," E14) pending exactly the kind of readiness check this phase
is. Where fresh evidence (a corpus 15–50× larger, Phase 3.4's mixed-source telemetry, the
100%-success/zero-variance outcome finding holding steady) doesn't change an E-decision's
conclusion, this document **ratifies it by reference** rather than re-deriving it. Where fresh
evidence *does* change something, that is called out explicitly as a refinement, not silently
folded in.

| ID | Decision | Resolution |
|----|----------|-----------|
| F1 | Learning target for Phase 4.1/4.2 | **Memory performance only.** Structural + empirical, not a preference — see below |
| F2 | How ranking consumes a learned signal without doing I/O | Ratify E7 unchanged: a decoration step between retrieval and `rank()`; `rank()` stays pure, gains two new optional fields read off `Candidate` |
| F3 | Where the aggregate lives | Ratify E6 unchanged: materialized table (`memory_performance`), event tables remain sole source of truth, mandatory tested `rebuild()` |
| F4 | Aggregation formula | Ratify E5 unchanged (Beta(1,1) posterior + shrinkage). **Refine E12's tier weighting: Tier-2 outcome credit ships wired but weighted 0 by default** until non-degenerate outcome data exists |
| F5 | `reason`-aware feedback semantics | Ratify E14 unchanged, with a documented re-validation trigger (see below) |
| F6 | Cold start | Ratify E13 unchanged: neutral prior, continuous shrinkage, no UCB, no hard threshold |
| F7 | Confidence vs. usefulness | Ratify E11 unchanged: strictly separate, enforced by a test forbidding writes to `memories` |
| F8 | Global vs. project-specific performance | Global bucket only in 4.1/4.2 (extends E15's pattern); schema shaped for a per-project bucket later with no migration; **not implemented now, no evidence yet clean enough to justify it** |
| F9 | Per-memory-type normalization | Rejected for 4.1/4.2 — insufficient, confounded evidence (only 3/12 types populated at all) |
| F10 | Fail-safe default | `learningRanking.enabled = false`. When disabled, ranking output is byte-identical to current Phase 3 behavior |
| F11 | Recomputation vs. materialization | Both: materialized + incrementally updated, but always fully rebuildable from raw events; rebuild is ground truth |
| F12 | Event ingestion: sync or async aggregate update | Synchronous, same DB transaction as the raw event write |
| F13 | Anti-gaming / dedup | Minimum rules only (see below); no reputation system |
| F14 | Phase 4 sub-milestones | 4.1 Aggregation → 4.2 Bounded Ranking (disabled by default) → 4.3 Evaluation → 4.4 Lifecycle (conditional) |
| F15 | Evaluation layers | Fixture + historical replay + live pilot, **extending** `packages/evaluation`'s existing harness, not building a new one |

---

## F1 — Learning target: memory performance only

**Decision:** Phase 4.1/4.2 aggregates and learns from `FeedbackEvent`/`OutcomeEvent` evidence
about **memories only.** Code chunks and dependency facts are explicitly out of scope.

**Why — two independent reasons, either one sufficient alone:**

1. **Structural.** `FeedbackEventSchema` (`packages/core/contracts/src/events.ts:147-159`) has a
   `memoryId` field and nothing else addressable — no `chunkId`, no `sourceId`. There is no way to
   attach feedback to a code or dependency item under the current contract, full stop.
2. **Empirical.** `context_event_sources` — the Phase 3.4 table that would record code/dependency
   *delivery* in the first place — has zero rows in the live database
   (`PHASE_4_FINDINGS.md` §2, §11). There is no delivery evidence to learn from even if the
   contract allowed labeling it.

**Rejected — treating this as a preference to weigh against alternatives.** It isn't one. Extending
learning to code/dependency would require a contract change (a new feedback-target field) and would
still have zero real observations to bootstrap from. That is a Phase 5+-or-later question, not a
Phase 4.1 one, and nothing here should be read as ruling it out permanently — only as out of scope
until both conditions change.

---

## F2 — Ranking integration mechanism

**Decision:** Adopt `PHASE_2_DECISIONS.md` E7 exactly, unchanged:

```
RetrievalService.getCandidates()   -> Candidate[]                    (I/O, via RetrievalStore)
LearningSignalService.decorate()   -> Candidate[] + derived signals  (I/O, via a performance store)
rank()                              -> RankedResult[]                 (PURE — unchanged)
```

`rank()` gains **no new dependency.** It gains two new *optional* fields it reads directly off
`Candidate` (not folded into `CandidateSignals`' weighted sum — see below for why). The decoration
step is invoked by `Gateway`, which already composes exactly this kind of pipeline stage
(`getContext()` already fetches redundancy pairs conditionally right before compilation,
`gateway.ts:121-128` — decoration would slot in the same way, right after
`this.retrieval.getCandidates(...)` and before `rank({ candidates, task })`, at both of `rank()`'s
two call sites, `gateway.ts:115` and `gateway.ts:498`).

**Why not fold a performance term into `computeScore`'s weighted sum (rejected mission option A,
unweighted):** `CandidateSignalsSchema` is `.strict()` (`retrieval.ts:27-34`) and feeds a flat
weighted sum (`score.ts:29-35`) with no bound other than each raw signal's own range. A learned
signal mixed in at that level competes on equal footing with relevance from turn one, with no
mechanism to keep it subordinate — exactly what the brief's "Existing Ranking Weights" section
warns against, and exactly the AEOS failure `rank.ts:14-20`'s own doc comment already names
("a performance boost additively stacked onto an already-normalized relevance score, letting
'proven' patterns dominate regardless of query relevance").

**Adopted mechanism — a bounded post-score multiplier (mission option B), itself gated by minimum
evidence (mission option D), with tie-break (mission option C) as what it degrades to at zero
evidence:**

```
adjustedScore = score * (1 + boost)
boost         = clamp(maxBoost * (usefulnessSignal - 0.5) * 2, -maxBoost, +maxBoost)
```

`usefulnessSignal` is E5's output (§F4): exactly `0.5` at zero evidence, so `boost = 0` and
`adjustedScore === score` — a true no-op, not an approximation of one, for every candidate with no
performance history. `maxBoost` is a small, config-driven constant (candidate default: `0.15`,
i.e. ±15% — a tuning number for `PHASE_4_SPEC.md`/replay to set, not fixed here as architecture,
matching E5's own treatment of its `K` constant).

**2026-09-05 correction — the actual non-reorder guarantee, not the originally-claimed one.** This
section previously claimed "a clearly-more-relevant candidate (large `score` gap) cannot be
leapfrogged... on a less relevant one" without stating how large "large" needs to be, and an earlier
`PHASE_4_SPEC.md` draft understated it as "any gap bigger than `maxBoost`." The real worst case
moves *both* candidates at once — the higher-scored one penalized to its floor, the lower-scored one
boosted to its ceiling — so candidate A (higher base score) is guaranteed to stay above B only when
`A * (1 - maxBoost) > B * (1 + maxBoost)`, i.e. `A / B > (1 + maxBoost) / (1 - maxBoost)`. At the
shipped `maxBoost = 0.15` that ratio is **≈1.3529**, not "any positive gap." A base-score gap
between roughly 15% and 35% is *not* structurally protected. The brief's constraint (an irrelevant
memory can't leapfrog a relevant one on usefulness alone) is satisfied by ensuring the candidates
this matters for — clearly-irrelevant ones — clear the *real* ratio by a comfortable margin, not by
relying on the smaller, incorrect bound. This changes the documented guarantee, not `maxBoost`
itself, which stays `0.15` (§F4).

While a well-supported memory among close-scoring candidates still gets a real, visible nudge —
which is exactly the shape of the critical end-to-end test (`PHASE_4_SPEC.md`) — applied *after*
`computeScore`, so relevance is computed identically to today and the learned adjustment is a
separate, auditable, independently-disableable step (F10).

**Rejected:** giving `core/ranking` a repository or any DB handle (same reasoning as E7 —
`getDb()`-in-`ranking.ts` is the named AEOS anti-pattern this architecture exists to avoid).
**Deferred, not rejected:** tie-break-only (option C) as the *sole* mechanism — it is strictly
weaker than the bounded multiplier (it can never move a candidate ahead of a higher-scored one, only
among exact ties, which `PHASE_4_FINDINGS.md` §7's evidence is rich enough to do better than) and
is already what the multiplier degrades to whenever scores are otherwise equal.

---

## F3 — Materialized, rebuildable aggregate table

**Decision:** Adopt E6 unchanged. A new table, named `memory_performance` (this task's own
proposed name; functionally identical to E6's `memory_usefulness_stats` — same design, new label
only), holding **raw counts only** — no derived score — with `feedback_events`/`outcome_events`
remaining the sole source of truth and a mandatory `rebuild()` whose output must equal
incrementally-updated output exactly (E6's own acceptance test, AT-7, is the direct model for a
Phase 4.1 test).

**2026-09-04 correction:** an earlier draft of this line said the table holds "raw counts and a
derived score." It does not, and per `PHASE_4_SPEC.md` §2.1 never has — `usefulnessSignal`/
`evidenceMass` are computed on read by `computeUsefulnessSignal` (§F4, `PHASE_4_SPEC.md` §5), not
stored, specifically so a formula or `K`/`outcomeWeight` change never requires a migration or a
rebuild. This correction makes F3's own text agree with F4/F11 and `PHASE_4_SPEC.md`, which already
said this correctly — F3's wording was the one place it drifted.

**Why not the other three options E6 already compared (A: on-demand from events, C: a field on
`memories`, D: a separate store):** unchanged from E6's own reasoning
(`PHASE_2_DECISIONS.md:216-237`) — on-demand is O(history) per request over an unindexable join at
today's scale-up trajectory; a field on `memories` reintroduces exactly the confidence/usefulness
conflation F7 forbids; a wholly separate store duplicates SQLite for no benefit on a local,
single-file database.

**Failure behavior, unchanged from E6:** if the aggregate is missing, empty, or stale, decoration
returns candidates unchanged and ranking degrades to the non-learning strategy — never an error,
never a blocked request. Same discipline as existing vector-search degradation
(`db.ts:15-21`).

---

## F4 — Aggregation formula, and outcome's weight

**Decision:** Adopt E5's formula unchanged:

```
positiveEvidence = usefulCount    + dilutedSuccessEvidence
negativeEvidence = notUsefulCount + dilutedFailureEvidence
posterior         = (positiveEvidence + 1) / (positiveEvidence + negativeEvidence + 2)
evidenceMass      = positiveEvidence + negativeEvidence
usefulnessSignal  = 0.5 + (posterior - 0.5) * evidenceMass / (evidenceMass + K)     # K = 5
```

`positiveEvidence`/`negativeEvidence` combine two streams, per E12's three-tier attribution
hierarchy (`PHASE_2_DECISIONS.md:354-376`):

- **Tier 1 — explicit `FeedbackEvent.useful` for `(memoryId, contextId)`, weight 1.0.**
- **Tier 2 — memory included in a context whose task recorded an outcome, weight
  `w₂ / |includedMemoryIds|`** (credit dilution — a 5-item success is not 5 proofs).
- Tier 3 — retrieved but omitted: weight 0, recorded for efficiency metrics only.

**Refinement of E12, required by fresh evidence:** E12 set `w₂ = 0.15` against a 4-outcome corpus
and flagged its negative branch as uncalibrated. `PHASE_4_FINDINGS.md` §5–6 confirms, at 60
outcomes (15× the corpus), the negative branch is now not just uncalibrated but **structurally
untestable** — `outcome` is 100% `success` and `signal.testsPassed` is 100% `true`, with zero
exceptions across every task. A formula weight tuned against zero-variance data isn't tuned at
all. **`w₂` defaults to `0` in Phase 4.1/4.2's shipped configuration** — Tier 2 is fully
implemented and wired (so no migration or code change is needed to turn it on), but contributes
nothing until real failure/partial outcome data exists to set `w₂ > 0` against. This keeps E12's
architecture intact while refusing to fabricate a calibration Phase 4.2's own evidence cannot
support — the same discipline E4 already applied to `reviewScore` ("0 of 4 outcomes supplied it.
Building on an unpopulated field fabricates a signal") applies here to Tier 2's weight.

`reason='redundant'` contributes to neither stream (§F5). `K=5` is retained as E5's own tuning
constant, revisited only if `PHASE_4_SPEC.md`'s historical replay (Layer 2) shows it miscalibrated
against the now-larger corpus.

---

## F5 — `reason`-aware feedback semantics

**Decision:** Ratify E14 unchanged (`PHASE_2_DECISIONS.md:396-416`, **RESOLVED — APPROVED**):
`reason='redundant'` feeds neither evidence stream (routes to the redundancy model instead);
`reason='irrelevant'` feeds the usefulness score at full Tier-1 weight; `reason='incorrect'` feeds
the usefulness score **and** raises a human review flag; `useful=false` never triggers archiving,
purging, or a confidence change, automatically, under any circumstance.

**Re-validation trigger, not an override:** `PHASE_4_FINDINGS.md` §8.2 found that 97% of
not-useful feedback in the current corpus carries `reason='irrelevant'`, and the highest-count
memories under it have task-id patterns consistent with deliberately-seeded precision-pilot
distractors, not organically-discovered low-value memories — a distinction E14's authors could not
have seen, since no real corpus existed yet when E14 was written. E14's call (irrelevant counts as
real negative evidence) is kept as-is for Phase 4.1/4.2, because overturning an approved,
reasoned decision on a plausibility argument rather than contrary evidence would repeat exactly the
mistake this whole audit exists to prevent. **Trigger for revisiting:** once feedback volume from
non-pilot (organic) usage is large enough to compare `irrelevant`-reason distributions between the
two provenances (see F14's Phase 4.3), re-run this specific check.

---

## F6 — Cold start

**Decision:** Ratify E13 unchanged. `evidenceMass = 0` → `usefulnessSignal = 0.5` exactly →
`boost = 0` exactly (F2) → ranking identical to the non-learning strategy for any candidate with no
performance history. No UCB1/exploration bonus (rejected explicitly by E13 for the same reason the
brief rejects it: boosting unproven items to buy information is correct for a bandit with an
exploration budget and thousands of arms, wrong for a corpus where 16 of 48 labeled memories have
exactly one observation each — `PHASE_4_FINDINGS.md` §7). No hard minimum-sample threshold —
shrinkage is the continuous version of the same protection, without a discontinuity at `n=K`.

---

## F7 — Confidence and usefulness stay separate

**Decision:** Ratify E11 unchanged. `confidence` (author/import-asserted, `memories.confidence`)
and the learned `usefulnessSignal` (derived on read from `memory_performance`'s raw counts, never
itself stored — F3) are never combined, and the learning projection must never issue a write against `memories`. **Enforcement,
not convention:** carry E11's own acceptance-test shape forward — give the projection's storage
implementation a read-only handle to the memory table in tests, so a violation fails loudly rather
than silently succeeding (test matrix item, `PHASE_4_TASKS.md`).

---

## F8 — Global vs. project-specific performance

**Decision:** Ship **one global bucket per memory** in Phase 4.1/4.2 — extending E15's
already-approved pattern (`PHASE_2_DECISIONS.md:420-435`: record a conditioning key now, learn only
the wildcard `'*'` bucket first, activate per-key buckets later with no migration) from
`task_class` to also cover scope. Concretely: `memory_performance` is keyed so that a
project-specific column/bucket can be added later without a schema migration, but only the
`scope='*'` (global) bucket is populated and read in 4.1/4.2.

**Why not build the per-project bucket now, given `PHASE_4_FINDINGS.md` §4's stark split (global
memories 8% useful vs. project memories 54% useful)?** That split is exactly E15's own argument
against premature conditioning, restated: *"there are 5 feedback events total [in E15's corpus].
Splitting... across task classes yields buckets of size 0 and 1, where the shrinkage term drives
every signal back to 0.5 anyway. Building the classifier now would be pure overhead with no
measurable effect."* The scope-split numbers here are bigger (166 vs. 103 events) but the
underlying risk is the same one `PHASE_4_FINDINGS.md` §4 and §8.2 already flag: this specific split
looks like a pilot-design artifact (global "distractor" memories tested against many different
synthetic projects, each correctly marking it irrelevant to that project) rather than a general
property of global memories. Building a per-project bucket now would risk **learning the pilot's
test design**, not real cross-project variance. Shape the schema to make this cheap later; don't
populate it on a hunch now.

---

## F9 — No per-memory-type normalization

**Decision:** Rejected for Phase 4.1/4.2, per the brief's own instruction to report distribution
first and normalize only if evidence shows a problem. `PHASE_4_FINDINGS.md` §4/§2: only 3 of 12
`MEMORY_TYPES` have any memories at all in this database, and the most heavily-represented type
(`rule`, 188 of 269 feedback events) is also the most negatively skewed (14% useful) — indistinguishable, on this evidence, from the type itself being disfavored versus this pilot series
simply having typed most of its distractor memories as `rule`. Insufficient, confounded evidence.
Revisit once memory types beyond decision/constraint/rule are actually populated.

---

## F10 — Fail-safe default

**Decision:** `learningRanking.enabled = false` in shipped default configuration for the whole of
Phase 4.1 and the initial release of Phase 4.2. When disabled, `Gateway` must skip the decoration
step entirely (not compute-and-discard it) — ranking output is required to be **byte-identical**
to current Phase 3 behavior, verified by a regression test that runs the same fixture through both
"learning code merged" and "Phase 3 baseline" paths and diffs the result
(`PHASE_4_TASKS.md` test matrix item 11). This is the same discipline the brief applies throughout:
observable, reversible, bounded — flipping one config value must be sufficient to return to
exactly today's behavior, not approximately today's behavior.

---

## F11 — Materialized and always rebuildable

**Decision:** Both, not a choice between them (adopts E6's own framing directly). `memory_performance`
is incrementally updated as events arrive (F12) for normal-path performance, but raw
`feedback_events`/`outcome_events` remain the authoritative source, and a `rebuildMemoryPerformance()`
operation must exist that recomputes every row from raw events and produce output identical to the
incrementally-maintained table. If they ever disagree, raw events win and the table is dropped and
rebuilt — E6's own binding rule, unchanged, because it is the mechanism that protects against bugs
in the incremental path without requiring the incremental path to be proven bug-free first.

---

## F12 — Synchronous aggregate update

**Decision:** `EventService.recordFeedback`/`recordOutcome` update `memory_performance` in the same
SQLite transaction as the raw event insert, not via a separate async job or queue.

**Why:** `data/brain.db` is a single local SQLite file with no network hop — the cost this
decision is trading away (a slightly slower `recordFeedback` call) doesn't exist at any scale this
system currently operates at, and inventing an async pipeline (a queue, a worker, retry logic) is
exactly the kind of scaffolding-for-later the brief's own "no scheduler in 4.1/4.2" instruction
argues against building yet. The precedent already exists in this codebase:
`SqliteEventStore.recordContext` (`event-store.ts:259-295`) already writes `context_events` and
`context_event_memories` atomically inside one `db.transaction()` for exactly this reason (P2-006
atomicity). `recordFeedback`/`recordOutcome` updating `memory_performance` in the same transaction
is the same pattern, one table further.

**Safety net, not a requirement to get this right the first time:** F11's rebuild guarantee means a
bug in the incremental-update path is recoverable, not catastrophic — this is what makes the
synchronous choice safe to make now rather than deferring to a more complex design.

---

## F13 — Anti-gaming and deduplication (minimum rules)

**Decision, deliberately minimal — no reputation or identity system:**

1. **Dedup at aggregation time, not just at the schema level.** Count at most one Tier-1
   observation per distinct `(memory_id, context_id)` pair, even if the raw event log ever contains
   more than one `FeedbackEvent` for the same pair (`PHASE_4_FINDINGS.md` §4/§8.4: this doesn't
   happen today, but nothing in the schema prevents it — defense in depth, computed at read/rebuild
   time rather than by adding a `UNIQUE` constraint that would reject legitimate event log entries
   the Brain must still keep, per its append-only design).
2. **Tier-2 credit dilution (`/|includedMemoryIds|`, E12) is itself the large-pack anti-inflation
   rule** — already adopted in F4, not a separate mechanism.
3. **No per-agent or per-session reputation weighting.** Rejected as over-engineering relative to
   current evidence — there is no actor/provenance field on `FeedbackEvent` at all
   (`PHASE_4_FINDINGS.md` §8.6), so there is nothing to weight by even if this were wanted.
4. **One project dominating a global memory's aggregate is a known, unmitigated limitation, not a
   solved problem**, in the global-bucket-only design (F8). Flagged here rather than silently
   accepted: if a future audit shows one project's feedback volume drowning out every other
   project's signal on a shared global memory, that is the evidence needed to justify F8's deferred
   per-project bucket — not a reason to block 4.1/4.2 today.

---

## F14 — Phase 4 sub-milestones

**Decision:** Subdivide, per the brief's own strong suggestion, refined against this audit's
findings:

- **4.1 — Performance Aggregation.** `memory_performance` schema (migration `0007`), event-audit
  tooling, `rebuildMemoryPerformance()`, F4's formula computed and stored. **No ranking change of
  any kind** — `rank()`/`Gateway` untouched. Safe to build immediately: reversible, additive-only,
  observable, no behavior change.
- **4.2 — Bounded Ranking Learning.** F2's decoration step + bounded multiplier, `learningRanking`
  config, `Candidate`/`RankingInput` contract extension. **Shipped disabled by default (F10).**
  Gated on 4.1's `rebuild()` test passing and Layer 1 (fixture) evaluation, per F15 — not gated on
  live data quality improving, since the whole point of shipping it disabled is to decouple "build
  it" from "trust it enough to turn it on."
- **4.3 — Learning Evaluation.** Extend `packages/evaluation` (F15) with a learning-aware replay
  strategy over the real event corpus (Layer 2), then a live pilot with learning enabled vs.
  disabled under controlled configuration (Layer 3). **This is the gate for changing `enabled`'s
  default**, not 4.2's merge.
- **4.4 — Lifecycle / Scheduled Evaluation.** Promotion/demotion and a real scheduler, **explicitly
  conditional** on 4.2/4.3 producing evidence that bounded ranking learning is empirically safe.
  May be further deferred past whatever comes after Phase 4 if that evidence doesn't materialize —
  this is a decision to make with 4.3's results in hand, not one to pre-commit here.

**Why this order, not e.g. lifecycle alongside ranking:** the brief's own framing is adopted
directly — promotion/demotion is destructive-adjacent (archiving, status changes) where bounded
ranking learning is not (a multiplier that defaults to a no-op). Keeping the higher-blast-radius
work last, and explicitly conditional, matches "the most dangerous behavior last."

---

## F15 — Evaluation layers extend, don't replace, the existing harness

**Decision:** `packages/evaluation` already ships a real offline harness, not scaffolding
(`metrics.ts`: `precisionAtK`/`recallAtK`/`reciprocalRank`/`dcgAtK`/`ndcgAtK`; `evaluate.ts`: full
MRR/P@K/R@K/NDCG@K aggregation with a SIGNIFICANT/INDICATIVE gate at `SIGNIFICANCE_MIN_EXAMPLES=20`/
`SIGNIFICANCE_MIN_OBSERVATIONS=100`; `export.ts:exportFromEvents()` already replays real
`RetrievalEvent → ContextEvent → FeedbackEvent → OutcomeEvent` chains into the eval format). Phase
4.3 extends this — a new strategy/dataset plugged into the existing `evaluate()`/`formatComparison()`
machinery — rather than building parallel replay infrastructure. This is a direct application of
the reuse-before-build principle this whole task operates under, and it is possible only because
Phase 3's evaluation package happened to be built generally rather than redundancy-specific.

Layer 1 (deterministic fixture) and Layer 2 (historical replay against this audit's real 269-event/
60-outcome corpus) are both buildable immediately as analysis, per the brief's own instruction that
this scoping phase "should implement only analysis scripts/tests if needed, not production
learning." Layer 3 (live pilot, learning enabled vs. disabled) is deferred to 4.3 proper, after 4.2
ships disabled-by-default — matching the redundancy feature's own already-proven discipline
(implemented → replay-validated → live-piloted → default decision, `PHASE_2C_PILOT_REPORT.md`).

---

## F16 — Duplicate-event dedup mechanism, frozen for Phase 4.1 implementation

Three implementation-blocking questions raised at Phase 4.1 kickoff, resolved here before any code
was written, extending F13's principle rather than inventing new ones.

**16a — Feedback dedup rule: first observation wins, by insertion order.** For Tier-1 evidence,
at most one `FeedbackEvent` per distinct `(memory_id, context_id)` pair contributes to
`memory_performance`; later duplicates for the same pair stay in `feedback_events` (append-only,
untouched) but add zero further delta. "First" is defined by SQLite `rowid` — the table's implicit,
strictly insertion-ordered column — not by `timestamp` (a client-supplied ISO string with
millisecond resolution that two rapid submissions could tie on, and which is not guaranteed
monotonic across any future non-local writer). **`feedback_events` rows with `context_id IS NULL`
are never deduplicated against each other** — there is no pair to dedupe on, and collapsing them
would fabricate a "these are duplicates" judgement `PHASE_4_FINDINGS.md` §8.6 already noted this
system cannot make (no actor/provenance field to tell two independent null-context observations
apart from a resubmission). Each null-context row counts as its own independent observation, always.

**16b — Outcome dedup rule: same mechanism, applied to `(context_id)` instead of a pair.**
`outcome_events` has no `UNIQUE` constraint on `context_id` or `task_id` (migrations 0001/0002 —
verified by direct read before writing this decision, not assumed) — duplicate outcomes for the same
context are structurally possible. Rather than invent correction semantics (detecting which of two
differently-valued outcomes for one context is "the real one" — explicitly out of scope per this
phase's own instruction), Phase 4.1 applies F16a's identical rule one level up: **the first
`OutcomeEvent` (by `rowid`) linked to a given `context_id` contributes Tier-2 dilution evidence;
later outcome events for the same `context_id` are recorded but contribute no further delta.**
Chosen over "every raw outcome counts" for symmetry with 16a and because it's the more
conservative, anti-gaming-consistent option (`PHASE_4_DECISIONS.md` F13) — a retried/replayed
outcome submission (the realistic duplicate case, given this system's own append-only write path)
should not be able to multiply its evidence just by being sent twice. An outcome with
`context_id: null`, or whose context has zero `included=1` `context_event_memories` rows, always
contributes zero Tier-2 evidence — there is nothing to fan out to, checked structurally (never a
division, no zero-guard needed as a separate branch).

**16c — Outcome classification mapping, per E12/E5 exactly (not extended by guesswork).**
`PHASE_2_DECISIONS.md` E12 (`:354-376`) defines exactly two buckets — success (positive dilution)
and, "implemented symmetrically," failure (negative dilution) — and is **silent on `partial` and
`unknown`**, both real values in `OUTCOME_VALUES` (`events.ts:110`). Per this phase's own
instruction not to treat `partial` as negative evidence unless E12 explicitly establishes that, and
it does not:

| `outcome` value | `successContextCount` / `dilutedSuccessEvidence` | `failureContextCount` / `dilutedFailureEvidence` |
|---|---|---|
| `success` | **+1 / +1/N** | — |
| `failure` | — | **+1 / +1/N** |
| `partial` | — | — |
| `unknown` | — | — |

`partial` and `unknown` update `lastOutcomeAt` (pure observability — "an outcome touching this
memory's context was recorded," not a claim about its value) and are visible for any future audit
via `outcome_events` directly (already the source of truth — no `partialContextCount`/
`unknownContextCount` column is added to `memory_performance`, since `PHASE_4_SPEC.md`'s frozen
raw-count field list, unchanged by this decision, doesn't include one and nothing in this phase's
evidence justifies widening it). This is a genuine gap in E12, not resolved by inference — flagged
as a real open question if Phase 4.2/4.3 ever wants `partial` to carry directional weight; Phase 4.1
does not need that answer to ship correctly, since Tier-2's own weight is `0` by default (F4)
regardless of which bucket any outcome lands in.

---

**2026-09-06 — Phase 4.3 note.** None of F1–F16 changed. Phase 4.3's own mission explicitly froze
this policy for evaluation (`enabled=true` in the evaluation arm only, `k`/`outcomeWeight`/
`maxBoost` untouched) and forbade tuning regardless of results. Results and the resulting
default-enable verdict (`NOT_ENOUGH_EVIDENCE`) live in `docs/phase-4/PHASE_4_3_REPORT.md`, not here — this
document records design decisions, and none were made or revised this phase.
