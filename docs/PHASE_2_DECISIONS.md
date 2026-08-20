# Phase 2 Decisions

Every open question raised by the Phase 2 brief, resolved or explicitly deferred. Decisions marked
**HUMAN** are not self-granted by this audit — they change Phase 1 behaviour, the external protocol,
or the project's scope, and require approval before implementation.

Grounding for all evidence claims: `PHASE_2_FINDINGS.md`.

| ID | Decision | Resolution | Blocks implementation? |
|----|----------|-----------|------------------------|
| E1 | Fix the inverted lexical score before Phase 2 measures anything | Yes — correct it as a Phase 1 defect fix, first task | **APPROVED** — implemented in Phase 2A |
| E2 | Normalize retrieval signals to comparable scales | Yes — per-query min-max over the candidate set | RESOLVED |
| E3 | How context deliveries get correlated with feedback/outcome | Gateway-level `ContextDelivery = ContextPack + contextId`; accept it on feedback/outcome | **IMPLEMENTED (Phase 2B)** — `ContextDelivery` lives in `packages/gateway/src/types.ts`; `ContextPack` and `core/token` untouched |
| E4 | What "usefulness" is | Explicit per-memory feedback primary; task outcome weak/diluted secondary | RESOLVED |
| E5 | How usefulness is aggregated | Beta posterior mean with sample-count shrinkage | RESOLVED |
| E6 | Where learned usefulness lives | Materialized, fully-rebuildable projection table; events remain source of truth | RESOLVED |
| E7 | How ranking consumes it without doing I/O | Candidate decoration step between retrieval and `rank()`; `rank()` stays pure | RESOLVED |
| E8 | Evaluation before adaptive ranking | Yes — new pure `packages/evaluation`, harness lands before strategy B | RESOLVED |
| E9 | Scope specificity | Tie-break + redundancy-cluster preference only. Never a primary score term | RESOLVED |
| E10 | Semantic redundancy | Diversity-aware **context selection** (demote, never delete), using existing embeddings | RESOLVED |
| E11 | Confidence vs usefulness | Strictly separate; a test forbids the projection from writing to `memories` | RESOLVED |
| E12 | Outcome attribution | Three-tier hierarchy with credit dilution across the included set | RESOLVED |
| E13 | Cold start | Neutral Beta prior + continuous shrinkage. No hard sample threshold, no UCB | RESOLVED |
| E14 | Negative feedback | Damped by the shrinkage model; typed `reason` separates "redundant" from "wrong"; never auto-archives | **APPROVED** — `useful=false` may influence ranking, only via the damped reason-aware model. `reason='redundant'` is never negative usefulness |
| E15 | Task-conditional learning | Record the conditioning key, learn globally in Phase 2 | RESOLVED |
| E16 | Token-efficiency measurement | Store per-item token cost + candidate-pool cost; report `labeledFraction` with every ratio | RESOLVED |
| E17 | Counterfactual quality ("would more tokens have helped?") | **Not measurable.** Explicitly out of scope | RESOLVED (negative) |
| E18 | Agent-efficiency measurement | Derived from events only; no agent-specific instrumentation | RESOLVED |
| E19 | Observability | ~6 columns on the existing `context_events` row. No new subsystem | RESOLVED |
| E20 | Memory consolidation | **DEFERRED** to Phase 5 | RESOLVED (deferred) |
| E21 | Automatic capture | **DEFERRED** to Phase 5 | RESOLVED (deferred) |
| E22 | Tokenizer / compression redesign | No change. Ratios are comparable under a uniformly-wrong estimator | RESOLVED |
| E23 | Normalizing `context_events`' JSON arrays into a junction table | Yes — required for any indexable aggregation | **IMPLEMENTED (Phase 2B)** — `context_event_memories`, migration `0002_phase2_measurement.sql`. JSON arrays retained for one cycle; both forms written together and cross-checked |
| E24 | Applying the stale-doc corrections listed in `PHASE_2_FINDINGS.md` §8 | Applied to documentation only. **No code behaviour changed** — in particular `brain_search` keeps its current no-`filters` surface | **APPROVED (docs only)** — applied |
| E25 | Which interface exposes candidate vectors for redundancy detection | `RetrievalStore.findSimilarPairs(memoryIds, threshold)`; raw embeddings never reach `core/retrieval` | **APPROVED IN PRINCIPLE** for a future Phase 2C. NOT implemented in Phase 2B |

---

## E1 — Fix the inverted lexical score first  **[HUMAN]**

**Decision:** Correct `lexicalScore` production in
[retrieval-store.ts](../packages/storage/src/retrieval-store.ts) before any Phase 2 evaluation runs.

**Evidence:** `PHASE_2_FINDINGS.md` §3. `1/(1+|bm25|)` monotonically inverts relevance; the exact
Finding B failure order is reproduced deterministically from it.

**Why it needs human approval:** this pass is specification-only, and the change is to shipped
Phase 1 code, not Phase 2 code.

**Why it must come first, not "alongside":** Baseline A is supposed to be the control in every
strategy comparison (§25 of the brief). If A embeds an inverted signal, every measured "improvement"
from learning is really just the learning signal papering over a sign error. Phase 2 would then
ship an adaptive ranker tuned to compensate for a bug, and the compensation would break the moment
the bug was fixed.

**Consequence if deferred:** Phase 2 is still buildable, but the acceptance test in §26 of the brief
would be satisfiable *only* by a strong learning signal — i.e. the system would pass by learning
that a specific memory is useful rather than by ranking it as relevant. That is exactly the
overfitting the brief warns against.

**Corollary decision (no approval needed, it is a test):** add a **store-conformance suite** asserting
that `FakeRetrievalStore` and `SqliteRetrievalStore` agree on signal *semantics* — for any fixture
pair, the better lexical match receives the strictly higher `lexicalScore`. This is the test whose
absence let the defect ship inside 218 green tests.

---

## E2 — Signal normalization

**Decision:** Both `lexicalScore` and `semanticScore` are normalized **per query, over the returned
candidate set**, to `[0, 1]` before ranking, with a documented degenerate-case rule
(all-equal → all `1.0`, single candidate → `1.0`).

**Alternatives considered:**

| Option | Verdict |
|---|---|
| Leave raw, retune weights | Rejected — weights would have to be re-tuned per corpus; the 7.4:1 realized-influence gap (`PHASE_2_FINDINGS.md` §3.3) is a property of the *distributions*, not the weights |
| Global fixed normalization constants | Rejected — bm25 range depends on corpus size and term rarity; a constant goes stale on every write |
| Per-query min-max over the candidate set | **Adopted** — bounded, deterministic, no stored state, correct as the corpus grows |
| Reciprocal Rank Fusion instead of score fusion | Rejected for Phase 2 — discards score magnitude, which the evaluation harness needs to compare strategies. Reconsider in Phase 5 if score calibration proves unstable |

**Consequence:** the declared `RankingWeights` finally describe actual influence. This alone changes
Baseline A's behaviour, which is why strategy **A′** exists (see `PHASE_2_SPEC.md` §7).

---

## E3 — Context correlation via `contextId`  **[APPROVED IN INTENT — boundary revised]**

**Decision (CORRECTED):** a new **Gateway-level** type `ContextDelivery = ContextPack & { contextId:
string | null }`. `brain_context` returns `ContextDelivery`; `brain_feedback` and
`brain_record_outcome` accept an optional `contextId`. `taskId` remains optional and unchanged.

**`ContextPack` is NOT modified, and `core/token` is NOT touched.** The superseded version of this
decision put `contextId: string | null` on `ContextPack` and had the pure `optimizeContext()` emit
`null` — which forced a pure budget function to carry a field it can never populate and leaked an
event-store concept into the token layer. Delivery identity is a Gateway concern because the Gateway
is what creates the `ContextEvent`. See `PHASE_2_SPEC.md` §2.1.

**Implemented in Phase 2B.** `ContextDelivery` is defined in `packages/gateway/src/types.ts`, alongside the other Gateway-orchestration-specific request/response shapes -- not in `@brain/contracts`, because delivery identity is a Gateway concern and `ContextPack` had to stay exactly as `core/token` produces it.

**Evidence:** `PHASE_2_FINDINGS.md` §4 — 13 of 13 context events have `task_id = NULL`; the chain is
0% connected on real usage; `ContextPack` currently returns nothing quotable.

**Alternatives considered:**

| Option | Verdict |
|---|---|
| Make `taskId` required on `brain_context` | Rejected — pushes correlation discipline onto every agent forever, and a caller-invented task id is still unverifiable. Would have prevented this instance, but not the class |
| Brain infers a task from session + query similarity | Rejected — violates the Brain/Agent boundary (`PHASE_1_SPEC.md`: the Brain never observes what an agent does) |
| Return `contextId`, accept it back | **Adopted** — the Brain already mints `ContextEvent.id` on every delivery; it just fails to return it. Zero new concepts |
| Improve the tool description only | Rejected as sufficient, adopted as an addition — prompt-level affordance is necessary but not a guarantee |

**Compatibility:** `contextId` is additive on the response and optional on the two inputs. No
existing caller breaks. The `.strict()` schemas must be updated.

**Why HUMAN:** it changes the externally-visible MCP contract that a real agent is already using.

---

## E4 — What "usefulness" is

**Decision:** usefulness is evidence *about a memory's contribution to task work*, assembled from,
in strict priority order:

1. `FeedbackEvent.useful` for that memory (explicit judgement) — **primary**
2. inclusion in a delivered context whose task recorded an outcome — **weak, diluted**
3. everything else — **recorded, not scored in Phase 2**

**Explicitly rejected as Phase 2 inputs**, with reasons:

- `reviewScore` — 0 of 4 outcomes supplied it. Building on an unpopulated field fabricates a signal.
- retrieval-frequency / repeated retrieval — confounded with one agent repeating itself in one
  session; the live corpus has the same query text twice in 13 events.
- "retrieved but omitted" — `omittedMemoryIds` is empty in all 13 events. Zero observations.
- `confidence` — author-asserted, not learned (see E11).
- `humanEdited` — reliable when present but no defensible Phase 2 policy; record only.

---

## E5 — Aggregation formula

**Decision (CORRECTED — see "Superseded model" below):**

```
positiveEvidence = usefulCount    + dilutedSuccessEvidence
negativeEvidence = notUsefulCount + dilutedFailureEvidence

posterior        = (positiveEvidence + 1) / (positiveEvidence + negativeEvidence + 2)   # Beta(1,1)
evidenceMass     = positiveEvidence + negativeEvidence
usefulnessSignal = 0.5 + (posterior - 0.5) * evidenceMass / (evidenceMass + K)          # K = 5, tunable
```

`reason = 'redundant'` contributes to **neither** side.

### Superseded model and why it was mathematically insufficient

The first version of this decision specified a single signed `outcomeEvidence` term folded into the
sample count:

```
n = usefulCount + notUsefulCount + outcomeEvidence          # WRONG -- do not implement
```

Three defects, in increasing severity:

1. **A failure could not move the posterior at all.** `outcomeEvidence` never entered the posterior's
   numerator or denominator, only the shrinkage term. A memory with no explicit feedback and one
   linked task failure computed `posterior = 1/2` exactly, and therefore `signal = 0.5` — a failure
   produced *literally zero* effect.
2. **A failure reduced sample mass instead of adding evidence.** Negative outcome evidence made the
   system act *less* certain rather than certain of something worse. That is backwards: a failure is
   information, not the removal of information.
3. **`n` could go negative, inverting the sign of the entire adjustment.** With `usefulCount = 5`
   and accumulated failure evidence of `−6`, `n = −1`, so `n/(n+K) = −0.25`, and a memory with five
   explicit `useful=true` votes scored `0.5 + 0.357 × (−0.25) = 0.411` — **below neutral**. The
   shrinkage factor is only meaningful as a value in `[0, 1)`; the superseded model did not
   guarantee that.

The corrected model has none of these properties: `evidenceMass ≥ 0` always, so the shrinkage factor
is always in `[0, 1)`; failure evidence enters the posterior's denominator, so it genuinely shifts
the estimate downward; and the two evidence streams cannot cancel each other into false certainty.

**Properties, all deliberate** (verified against the corrected model):

| pos | neg | mass | signal | effect |
|---|---|---|---|---|
| 0 | 0 | 0 | **0.500** | exactly neutral — cold start is a no-op, not a penalty (E13) |
| 0 | 1 | 1 | 0.472 | one `useful=false` is a nudge, not a suppression (E14) |
| 1 | 0 | 1 | 0.528 | symmetric |
| 0 | 5 | 5 | 0.321 | meaningful, still recoverable |
| 18 | 2 | 20 | 0.791 | converges toward the true rate (posterior 0.864, shrunk by 20/25) |
| 0 | 0.021 | 0.021 | 0.49998 | one diluted failure in a 7-item pack — **nonzero and correctly signed**, where the superseded model gave exactly 0.500 |
| 0 | 0.43 | 0.43 | 0.493 | twenty such failures accumulate properly |
| 5 | 6 | 11 | 0.474 | heavy failure evidence against 5 explicit useful votes lands just below neutral — where the superseded model produced 0.411 via a **sign inversion** |

**Alternatives considered:**

| Option | Verdict |
|---|---|
| Raw rate `useful/(useful+notUseful)` | Rejected — undefined at n=0, and n=1 produces 0.0 or 1.0. AEOS's `getPerformanceScores` has exactly this shape |
| Wilson lower bound | Rejected — deliberately pessimistic, so an unrated memory scores *below* neutral and new knowledge is structurally buried. Wrong default for a system whose whole purpose is surfacing new project knowledge |
| Beta posterior + shrinkage | **Adopted** — neutral at zero, damped at low n, converges at high n, one formula covers cold start and negative-feedback damping |
| Hard minimum-sample threshold | Rejected — introduces a discontinuity at n=K; shrinkage achieves the same protection continuously |

`K = 5` is a tuning constant, set empirically by the harness, documented as adjustable. It is not
architecture.

---

## E6 — Where learned usefulness lives

**Decision:** **Option B — a materialized derived table**, `memory_usefulness_stats`, with the event
tables remaining the sole source of truth and a mandatory, tested `rebuild()`.

**Comparison against the brief's four options:**

| | A: on-demand from events | **B: materialized table** | C: field on `memories` | D: separate store |
|---|---|---|---|---|
| Purity | best | good — pure projection | poor — mixes authored + learned state | good |
| Performance | poor — O(all history) per request, and `included_memory_ids` is an unindexable JSON blob | good — indexed lookup for ~50 candidates | good | good |
| Auditability | perfect | good — every row traceable to events | poor — overwrites lose history | good |
| Consistency | perfect by construction | needs rebuild discipline | drift risk vs. events | two-system sync problem |
| Migration | none | one additive table | alters a Phase 1 table | large |
| Rebuildable | n/a | **yes, required and tested** | no | yes |
| Scaling | worst | fine | fine | over-built for local SQLite |

**Why not A**, despite it being the purest: `PHASE_2_FINDINGS.md` §4.4 — the inclusion data lives in
a JSON `TEXT` column that cannot be indexed or joined. On-demand computation is O(entire history)
per `brain_context` call. (E23 fixes the shape; even so, a per-request aggregate over all history
is the wrong default.)

**Why not C:** it would place a learned value on the same record as `confidence`, which is precisely
the conflation §11 of the brief forbids. One careless write and usefulness silently becomes
trustworthiness.

**Why not D:** violates "do not add a second competing memory store" (§24 of the brief).

**Binding rule:** A is the *definition*; B is a *cache of A*. Acceptance test AT-7 asserts
`rebuild()` output equals incremental output exactly. If they ever disagree, the events win and the
table is dropped and rebuilt.

**Failure behaviour:** if the projection is missing, empty, or stale, decoration returns candidates
unchanged. Ranking degrades to the non-learning strategy. It never errors and never blocks a
context request — the same discipline as the existing vector-search degradation.

---

## E7 — Ranking stays pure

**Decision:**

```
RetrievalService.getCandidates()        -> Candidate[]                    (I/O, via RetrievalStore)
LearningSignalService.decorate()        -> Candidate[] + derived signals  (I/O, via UsefulnessStore)
rank()                                  -> RankedResult[]                 (PURE — unchanged)
```

`rank()` gains two new *optional fields it reads off the Candidate*, and gains no dependency. The
decoration step is invoked by the Gateway, which already composes the pipeline. No new edge enters
`packages/core/ranking`.

**Rejected:** giving `core/ranking` a repository (AEOS's `ranking.ts` calls `getDb()` directly and
swallows every error in a bare `catch {}` — the pattern the Phase 1 architecture was specifically
built to avoid).

---

## E8 — Evaluation before adaptive ranking

**Decision:** `packages/evaluation` is a **pure** package, built and passing on the Phase 1
baseline, *before* any learning signal reaches `rank()`. Nothing in production imports it.

**Rationale:** the brief's §7 is right, and the audit strengthens it — with E1 outstanding, the only
way to know whether Phase 2's ranking got better is to measure A vs A′ vs B vs C on a fixed dataset.
Without the harness, "better" is an opinion.

**Metrics adopted** (only those whose inputs exist or are created by this phase): Precision@K,
Recall@K, MRR, NDCG@K, context efficiency, redundant-context ratio, retrieval efficiency.

**Metrics rejected:** anything requiring `reviewScore`; anything requiring counterfactual re-runs
(E17); AEOS's composite OII — it mixes retrieval quality with human-edit counts and completion time
into one number, which hides exactly the regressions this harness exists to catch.

---

## E9 — Scope specificity

**Decision:** scope specificity is used in exactly two places, both non-scoring:

1. **Ranking tie-break, inserted above the confidence tie-break:** when combined scores are equal,
   `project` ≻ `session` ≻ `global`. Zero effect when scores differ.
2. **Redundancy-cluster preference:** within a detected near-duplicate cluster, the more specific
   scope is kept at full rank and the others are demoted.

**Explicitly NOT adopted:** "project always beats global", and scope as a weighted score term.

**Evidence for the limit:** the same real-world test that produced the redundancy case *also* shows
the global plural rule being correctly retrieved and correctly used for `task-api`, where no project
equivalent existed. A scope-specificity score term would penalize global knowledge in cases where it
is the only knowledge. One observation is not enough to justify a score term; it is enough to
justify a tie-break.

---

## E10 — Semantic redundancy

**Decision:** **Option C — diversity-aware context selection**, with **Option B (scope-aware
subsumption) used only as the within-cluster preference rule**. Options A (semantic deduplication as
a deletion) and D (defer entirely) are rejected.

**Mechanism (minimal):** during retrieval preparation — which already has store access — compute
pairwise cosine similarity over the candidate set's stored vectors. Candidate pairs above a
threshold τ are emitted as `redundancyPairs`. `compileContext()` (still pure, still no embeddings,
still no I/O) marks the lower-ranked member of each pair `redundantWith: <id>` and moves it after
all non-redundant items. Token optimization then drops it first under pressure, and keeps it when
budget is ample.

**Nothing is deleted, archived, merged, or rewritten.** A redundant memory is still returned when
budget allows — it is only *last in line*.

**Cost:** 50 candidates → 1225 dot products of 384 floats. Negligible, local, no network.

**τ:** a tuned parameter, not a constant. The one real datapoint (`PHASE_2_FINDINGS.md` §5) puts the
redundant pair at cosine 0.785 with the next-nearest at 0.518 — a usable window, but a single
example. The harness sets τ; the code documents it as adjustable.

**Rejected — destructive consolidation:** merging or archiving semantically-overlapping memories.
The brief forbids it, and the audit agrees: the redundancy is *contextual* (the global rule was
redundant **for that task**, not wrong), so a destructive action would discard knowledge that is
valuable in another project's scope.

---

## E11 — Confidence vs usefulness stay separate

**Decision:**

- `confidence` = how trustworthy the claim is. Author/import-assigned. Mutable only through
  `brain_update`. Ranking use: **tie-break only**, unchanged from Phase 1.
- `historicalUsefulness` = how helpful the memory has been. Derived, never persisted onto the
  memory record.

**Enforcement, not convention:** an acceptance test asserts the learning projection issues no
`UPDATE` against `memories`. The projection's storage implementation is given a read-only handle to
the memory table in the test harness so a violation fails rather than silently succeeding.

**Note on evidence:** in the live corpus `confidence` takes only the values 0.5 (the schema default)
and 1.0. It is close to zero-information today. This is a further reason to keep it as a tie-break
rather than promote it to a scored signal.

---

## E12 — Outcome attribution hierarchy

**Decision:**

| Tier | Evidence | Weight | Rationale |
|---|---|---|---|
| 1 | explicit `FeedbackEvent.useful` for `(memoryId, contextId)` | **1.0** | someone looked at this memory and judged it for this delivery |
| 2 | memory included in a context whose task recorded an outcome | **0.15 / \|includedMemoryIds\|** | a 10-memory success is not 10 proofs; credit is diluted across the set |
| 3 | retrieved but not included | **0.0** | recorded for efficiency metrics; zero observations exist to calibrate it (`PHASE_2_FINDINGS.md` §4.5) |

**Credit dilution is the load-bearing part.** Without it, a large context pack inflates every
memory's stats simultaneously and the ranker learns "memories that appear in big packs are good."
With it, a 7-item success contributes 0.021 of evidence per memory — real, but overwhelmed by a
single explicit judgement, as it should be.

Weights are harness-tuned. `0.15` is a starting point chosen so that **seven successes at
`|included| = 1`** are worth roughly one explicit `useful=true`. Under the live corpus's typical
7-item pack the per-memory contribution is 0.021 — about 1/47th of an explicit judgement, which is
the intended ratio: task outcome is corroboration, never testimony.

**Note:** the live corpus contains **zero failure outcomes**. Tier 2's negative branch is therefore
completely uncalibrated. It is implemented symmetrically and flagged in the readiness doc as an
untested path.

---

## E13 — Cold start

**Decision:** the neutral Beta prior in E5 *is* the cold-start policy. n=0 → signal exactly 0.5 →
identical ranking to the non-learning strategy. Proven by acceptance test AT-6.

**Rejected — UCB1 exploration** (AEOS's `getExplorationScores`): it deliberately *boosts* unproven
items to buy information. That is correct for a bandit with an exploration budget and thousands of
arms; it is wrong for a 10-memory corpus where an unproven memory boosted above a proven one
directly degrades a real coding task with no compensating learning rate. Revisit in Phase 5 with a
larger corpus and an explicit exploration budget.

**Rejected — minimum sample threshold:** creates a cliff at n=K where a memory's signal jumps
discontinuously. Shrinkage is the continuous version of the same idea.

---

## E14 — Negative feedback  **[PARTIAL — HUMAN]**

**Resolved parts:**

- One `useful=false` moves the signal by 0.028 (E5). It cannot suppress a memory.
- `useful=false` **never** triggers archiving, purging, or a confidence change. No automatic
  destructive action on any usefulness evidence, ever.
- A typed `FeedbackEvent.reason` (`redundant | irrelevant | incorrect | other | null`) separates the
  three cases the current free-text `notes` field conflates:
  - `redundant` → feeds the redundancy model (E10), **not** the usefulness score. This is the
    correct handling of the one real negative datapoint: the global plural rule is not a bad
    memory, it was a duplicate *in that context*.
  - `irrelevant` → feeds the usefulness score at full tier-1 weight.
  - `incorrect` → feeds the usefulness score **and** raises a review flag surfaced through an ops
    query. A human decides whether to correct or archive. The Brain does not.

**RESOLVED — APPROVED.** `useful=false` may influence future ranking, but **only** through the
damped, reason-aware model above: one negative event moves the signal by 0.028, `reason='redundant'`
contributes to neither evidence stream, and no usefulness evidence may ever trigger an archive,
purge, or confidence change. Learning is not implemented in Phase 2A; this decision governs P2-010
when it is authorized.

---

## E15 — Task-conditional learning

**Decision:** **record the conditioning key now, learn globally in Phase 2.**

`memory_usefulness_stats` is keyed `(memory_id, task_class)`. Phase 2 writes and reads only the
`task_class = '*'` bucket. Per-class buckets activate later with no schema migration.

**Rationale:** the brief's example is real and is visible in the corpus — the repository constraint
is useful for a DB refactor and irrelevant for endpoint naming. But there are **5 feedback events
total**. Splitting 5 observations across task classes yields buckets of size 0 and 1, where the
shrinkage term drives every signal back to 0.5 anyway. Building the classifier now would be pure
overhead with no measurable effect.

**Task classification itself is deferred.** No embedding-cluster task taxonomy, no `task_type` enum,
no heuristic. When the harness shows the global bucket is losing information, that is the trigger to
build it.

---

## E16 / E17 — Token efficiency, and its honest limit

**Adopted (computable once E3 and E23 land):**

```
contextEfficiency   = usefulTokens / deliveredTokens
redundantRatio      = redundantTokens / deliveredTokens
retrievalEfficiency = deliveredTokens / candidateTokens
labeledFraction     = labeledItems / deliveredItems        <- MUST accompany every ratio above
```

`labeledFraction` is not optional decoration. Unlabeled included items are *unknown*, not useless.
A `contextEfficiency` of 0.4 with `labeledFraction` 0.4 means "everything we know about was useful",
not "60% waste". Reporting the first number without the second produces a confidently wrong metric —
the same failure as AEOS's two disagreeing OII values.

**Rejected — E17, counterfactual quality.** "Would another 500 tokens have improved the result?" and
"did removing this memory hurt the outcome?" require running the same task twice under different
budgets with an agent the Brain does not control. No amount of event logging makes this observable.
Phase 2 states the limit rather than approximating it. A future A/B harness that *replays* tasks
against a scripted agent could address it; that is Phase 5 and needs an agent-side contract that
does not exist.

---

## E18 — Agent efficiency

**Decision:** measure only what the event tables can support, protocol-independently:

| Metric | Derivation | Available |
|---|---|---|
| Brain calls per task | `COUNT(retrieval_events)` grouped by task | after E3 |
| Repeated identical requests | group by `(normalized queryText, scope)` | today |
| Repeated retrieval of the same memories | Jaccard of consecutive candidate sets in a session | after E23 |
| One-shot success rate | tasks with exactly one context event and `outcome = 'success'` | after E3 |
| Context-reuse potential | fraction of a request's candidate set already delivered for the same task | after E23 |

**Explicitly not measurable:** "unnecessary tool calls." The Brain cannot see the agent's other
tools. Claiming otherwise would require agent-specific instrumentation, which the architecture
forbids.

---

## E19 — Observability

**Decision:** six additional columns on the existing `context_events` row —
`retrieval_ms`, `ranking_ms`, `compile_ms`, `optimize_ms`, `candidate_count`,
`candidate_token_count`. One row already exists per `brain_context` call; it is already the right
grain and the right lifetime.

**Rejected:** a metrics package, a separate time-series store, OpenTelemetry, any network exporter.
Local-first still applies, and none of these is needed to answer the Phase 2 evaluation questions.

Read access is a small SQL aggregate, exposed through the existing `brain_status` shape or an ops
query — not a new MCP tool.

---

## E20 — Memory consolidation: **DEFERRED**

Learning-aware ranking does not require consolidation, and the two must not be coupled.
Consolidation *rewrites* memories; ranking *selects* them. Coupling them means a low-confidence
usefulness estimate silently edits the corpus, and the evidence that produced the estimate is
destroyed along with the original text. Phase 5, gated on the evaluation harness being able to
detect a consolidation regression.

## E21 — Automatic capture: **DEFERRED**

Directly follows the brief's own reasoning, and the audit strengthens it: with the relevance signal
inverted (E1) and no evaluation harness (E8), adding passive capture multiplies the corpus against a
selector that is currently mis-ordering a 10-item corpus. Revisit once the harness can measure
precision at ~10× volume. Unchanged from `DECISIONS.md` D6.

## E22 — Tokenizer / compression: **NO CHANGE**

The char-based estimator is wrong in absolute terms but uniformly so, which leaves all Phase 2
ratios valid for *comparing strategies* — the only use Phase 2 makes of them. Truncation-only
compression stays. LLM summarization stays out (invariant 19).

---

## E23 — Normalize the context/memory relation  **[HUMAN]**

**Decision:** add `context_event_memories(context_event_id, memory_id, included, rank, token_count)`
and write it in the same transaction as the `ContextEvent`.

**Why required:** without it, every aggregation is a full scan + JSON parse
(`PHASE_2_FINDINGS.md` §4.4), per-item token cost has nowhere to live (E16), and
`getEventsForMemory` cannot answer "which contexts included this."

**Why HUMAN:** it is a migration against Phase 1 storage. The existing JSON columns are retained and
kept in sync for one migration cycle, so the change is additive and reversible.

---

## E24 — Stale Phase 1 documentation  **[HUMAN, non-blocking]**

Eight stale statements identified in `PHASE_2_FINDINGS.md` §8. None applied, per the brief's §27.
Only one has behavioural consequence (`brain_search` cannot pass `filters` through MCP even though
the Gateway supports it); the rest are naming drift.
