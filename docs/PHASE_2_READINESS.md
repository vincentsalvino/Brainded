# Phase 2 Readiness Check

Same format as `PHASE_1_READINESS.md`. Answers are grounded in the live implementation and the live
`data/brain.db`, not in the Phase 1 documents' description of them.

---

### Is the Phase 1 baseline sound enough to build learning on top of?

**No — two corrections are required first, and both are Phase 1 defects, not Phase 2 gaps.**

1. `lexicalScore = 1/(1+|bm25|)` monotonically **inverts** relevance
   ([retrieval-store.ts:135](../packages/storage/src/retrieval-store.ts#L135)). The observed
   Finding B ordering is reproduced deterministically from this one line
   (`PHASE_2_FINDINGS.md` §3.2).
2. Lexical and semantic scores occupy incomparable ranges (realized spreads 0.709 vs 0.121), so the
   declared weights `0.5/0.4` produce a ~7.4:1 actual influence ratio.

Everything else in the Phase 1 baseline held up under audit: boundaries, purity, scope isolation,
budget enforcement, degradation discipline, the composition root. **Do not redesign Phase 1
boundaries** — Phase 2 fits inside them unchanged.

### Is the empirical evidence sufficient to design against?

**Yes to design, no to tune.** The corpus contains 10 memories, 13 retrieval/context events, 4
outcomes, and 5 feedback observations — with **zero failure outcomes** and **zero non-empty omission
sets**.

That is enough to identify what is broken and to choose a model that is correct at small n. It is
not enough to fit weights, set thresholds, or claim a statistically meaningful improvement. The spec
handles this by requiring `exampleCount` / `labeledObservationCount` on every report and an explicit
`INDICATIVE` label below a minimum observation count.

### Is "usefulness" defined precisely enough to implement?

**Yes.** `PHASE_2_DECISIONS.md` E4/E5 define it as a Beta posterior with sample-count shrinkage, with
five hand-verified reference values in `PHASE_2_SPEC.md` §5.2. Every candidate input signal was
audited against what is actually populated (`PHASE_2_FINDINGS.md` §7); `reviewScore` and the
omission signal are explicitly excluded because they have zero and zero observations respectively.

No signal in the formula is fabricated.

### Is outcome attribution defined?

**Yes** — a three-tier hierarchy with mandatory credit dilution (E12). Explicit per-memory feedback
outweighs task-level outcome by roughly 47:1 under the live corpus's typical 7-item pack, which is
the intended ratio: outcome is corroboration, never testimony.

**One path is uncalibrated and flagged:** the `failure` branch of tier 2. Zero failure outcomes
exist. It is specified symmetrically and marked untested against real data.

### Can outcome attribution actually run today?

**No — and this is the single biggest gap the audit found.** 13 of 13 `context_events` have
`task_id = NULL`. `getEventsForTask("notes-api-search-endpoint")` returns
`{retrieval: [], context: [], outcome: [1], feedback: [3]}`. The chain is **0% connected on real
usage**.

The cause is an affordance defect, not a schema defect: `taskId` is optional, undocumented in the
tool description, and `ContextPack` returns no identifier a cooperative agent could quote back
(`PHASE_2_FINDINGS.md` §4). E3 fixes it structurally by returning the `ContextEvent.id` the Brain
already mints.

**Consequence:** `contextId` is a prerequisite for the learning read side, for `exportFromEvents()`,
and for every token- and agent-efficiency metric. It ranks above every learning feature in the task
order.

### Is the storage shape adequate for aggregation?

**Not today.** `context_events.included_memory_ids` and `retrieval_events.candidate_ids` are JSON
`TEXT` — unindexable, unjoinable, requiring a full scan plus parse for "how many times was memory X
included." There is no API at all for "which contexts included this memory"
(`getEventsForMemory` returns only `FeedbackEvent[]`).

E23's junction table fixes this additively and reversibly, retaining the JSON columns for one
migration cycle. Per-item token cost — required for every efficiency ratio — has nowhere else to
live.

### Does the design keep `core/ranking` pure?

**Yes, structurally.** Learning enters through a decoration step between retrieval and ranking;
`rank()` reads two new optional fields already present on its input and gains no dependency. CI rule
5 re-asserts that `packages/core/ranking` imports nothing but `@brain/contracts`, and a structural
test checks `package.json` directly.

This is the brief's §6 requirement, satisfied without a new abstraction.

### Does the design keep `core/context` pure?

**Yes.** Redundancy *detection* happens in retrieval preparation, which already has store access;
`compileContext()` consumes pre-computed `redundancyPairs` and never sees an embedding, a database,
or a similarity function. Absent the optional field, its output is byte-identical to Phase 1.

### Is evaluation defined before adaptive ranking?

**Yes, and it is enforced by the task graph**, not just recommended. `packages/evaluation` (P2-007)
and the seed dataset (P2-008) have no `[HUMAN]` dependency and can start immediately. P2-009 is a
hard **[GATE]**: A vs A′ must be measured and published before any learning task proceeds, and if A′
alone satisfies the acceptance tests, the learning tasks must justify themselves on other metrics or
ship disabled.

That gate exists because the audit's own prediction is that **A′ may fully fix Finding B**. Shipping
a learning ranker that a bug fix already made unnecessary is exactly the failure this project's
architecture review keeps warning about.

### Is the evaluation dataset replayable and extensible?

**Yes.** JSONL, versioned in-repo, with graded 0/1/2 labels (required for NDCG — binary labels
cannot express "relevant but less useful than the other relevant one," which *is* the Finding B
distinction). Each example declares its own memories, so a run never touches a developer's live
database. `exportFromEvents()` (P2-016) is the growth path for real examples.

Production ranking may not reference these strings. They are regression fixtures, not tuning targets.

### Is cold start handled?

**Yes, by construction.** The neutral Beta prior makes an unrated memory score exactly `0.500`, and
the usefulness term is centred so `0.5` contributes exactly `0`. A zero-history memory ranks
identically under A′ and B — proven by AT-6, not asserted.

No UCB, no exploration bonus, no minimum-sample cliff. Each was considered and rejected with a
stated reason (E13).

### Is negative feedback safe?

**Mostly, with one open question.** One `useful=false` moves the signal 0.028 — a nudge, not a
suppression. No usefulness evidence may ever trigger an archive, purge, or confidence change. The
typed `reason` field routes `redundant` away from the usefulness counters entirely, which is the
correct handling of the only real negative datapoint in the corpus (a globally-correct memory
rejected as a duplicate, not as wrong).

**Open (E14):** whether `useful=false` may influence ranking *at all* in Phase 2, or should be
record-only until Phase 5. The audit recommends "yes, damped" — refusing negatives discards 20% of
the total evidence available. It is a product-risk call, and P2-010 remains shippable either way.

### Are confidence and usefulness kept separate?

**Yes, and enforced.** They live in different tables, participate in ranking at different levels
(usefulness = weighted centred term; confidence = tie-break only, unchanged), and AT-9 gives the
projection a read-only handle to `memories` so a write attempt fails loudly.

Supporting evidence for keeping confidence a tie-break: in the live corpus it takes only the values
0.5 (schema default) and 1.0 — close to zero information today.

### Is token efficiency measurable?

**The ratios, yes — after E3 and E23. The quality question, no.**

`contextEfficiency`, `redundantRatio`, `retrievalEfficiency` become computable once per-item token
cost and candidate-pool cost are stored. **`labeledFraction` must accompany every one of them** —
unlabeled included items are *unknown*, not useless, and reporting the ratio alone produces a
confidently wrong number.

"Would another 500 tokens have improved the result?" is **not measurable** (E17) and Phase 2 says so
rather than approximating it. It requires re-running a task under a different budget with an agent
the Brain does not control.

### Is agent efficiency measurable without agent-specific instrumentation?

**Yes for four metrics** (calls per task, repeated identical requests, candidate-set overlap between
consecutive requests, one-shot success rate) — all derived from event tables after the linkage fix.

**No for "unnecessary tool calls"** — the Brain cannot see the agent's other tools. Stated as a
limit, not approximated.

### Is observability sufficient without a new subsystem?

**Yes.** Six nullable columns on the existing `context_events` row, which is already written exactly
once per `brain_context` call. No metrics package, no time-series store, no exporter, no new MCP
tool. Local-first preserved.

### Are the package boundaries a strict DAG?

**Yes.** Exactly one new package (`packages/evaluation`, pure, imported by nothing in production);
`core/learning` extended rather than split. `PHASE_2_SPEC.md` §3 gives the full DAG and a
purity classification per package. Three new CI rules extend Phase 1's four, each verified by the
plant-a-violation technique.

### Are contract changes enumerated separately, not applied?

**Yes.** Twelve changes in `PHASE_2_SPEC.md` §2.9 with producer, consumer, optionality, and
compatibility for each. All additive; every optional field absent ⇒ exact Phase 1 shapes. **Nothing
in `packages/core/contracts` was modified by this audit.**

Four fields were considered and explicitly **rejected** to avoid adding capacity "because it might
be useful": `Candidate.scopeSpecificity`, `Candidate.freshness`, `MemoryRecord.usefulness`, and any
`agentId`-conditioned signal.

### Are storage changes reversible?

**Yes.** One additive migration. No table dropped, no column removed, no data rewritten. The JSON
columns are retained and kept in sync for one cycle, so the junction table is derivable and the
change is rollback-safe. `memory_usefulness_stats` is a cache whose source of truth is the event
tables, with a mandatory tested `rebuild()`.

No second memory store. Evaluation results are files/CI artifacts, never rows in the Brain database.

### Are the acceptance tests derived from the observed failures?

**Yes — all eleven, and two of them target the *test gaps* rather than the defects:**

- **AT-8** (store conformance) is the test whose absence let an inverted signal ship inside 218
  green tests.
- **AT-5** (correlation round-trip) is the test whose absence produced 13-of-13 NULL task ids.

Fixing a defect without adding the test that would have caught it leaves the mechanism intact.

### Can implementation begin without architectural guessing?

**Yes, for the three unblocked tasks** (P2-001 store conformance, P2-007 evaluation core, P2-008
seed dataset) — none needs approval and none depends on an unresolved decision.

**No, for everything else.** Three blocking approvals are outstanding (below).

Four tuning constants are deliberately left unpinned, each with a stated constraint that determines
correctness without fixing a value now: shrinkage `K` (≈5), redundancy threshold `τ` (one real
datapoint at 0.785 vs 0.518), tier-2 outcome weight (≈0.15), and the significance-label observation
threshold. All are harness-fit, all are documented as adjustable, none is architecture. Hand-tuning
any of them against the two Phase 1 projects is explicitly forbidden.

---

## Unresolved decisions blocking implementation

| # | Decision | Blocks | Recommendation |
|---|---|---|---|
| **E1** | Authorize correcting the inverted lexical signal in shipped Phase 1 code | P2-002 → P2-009 → everything downstream | **Approve.** Without it, Baseline A embeds a sign error and every measured "learning improvement" is compensation for a bug |
| **E3** | Authorize the MCP protocol change: a Gateway-level `ContextDelivery = ContextPack + contextId`, accepted on feedback/outcome | P2-003 → the entire learning and metrics track | **Approve.** The Brain already mints the id; it just fails to return it. Attribution is impossible without it |
| **E23** | Authorize migration `0002` normalizing the context↔memory relation | P2-004 → P2-006/010/015 | **Approve.** Additive and reversible; aggregation is O(all history) and unindexable without it |
| **E14** | May `useful=false` affect ranking in Phase 2, or record-only until Phase 5? | P2-010's negative branch only | Audit recommends **yes, damped** (0.028 per event). Product-risk call. Task ships either way |
| **E24** | Authorize the eight stale-documentation corrections in `PHASE_2_FINDINGS.md` §8 | nothing | Approve at convenience. Only the `brain_search` `filters` gap has behavioural consequence |

---

## Phase 2A Result — P2-009 GATE: PASSED, and it changes what comes next

Implemented in Phase 2A: P2-001, P2-002, P2-007, P2-008, P2-009. Nothing else.

**A' fixed the observed Finding B failure on its own.** Strategy A' is the P2-002 signal correction
only: direction plus per-query normalization, at the point of production. `rank()` was not touched,
no weight was tuned, no learning signal exists.

```
examples: 6   graded observations: 18   significance: INDICATIVE

strategy        MRR    P@1   NDCG@1   NDCG@3   NDCG@5  NDCG@10
A             0.889  0.833    0.722    0.872    0.876    0.876
A-prime       1.000  1.000    1.000    0.987    0.987    0.987
```

On the `notes-api-db-refactor` example — the exact task from the Phase 1 real-world test — strategy A
top-ranks a grade-0 endpoint-naming memory and A' top-ranks the grade-2 repository constraint.
Verified again on the live `data/brain.db` corpus outside the harness.

**Consequence for the rest of Phase 2: the learning track loses the justification it was assumed to
have.** Finding B was the headline evidence that ranking needed to learn usefulness. It did not. It
needed a sign fixed. P2-010 onward must now be justified against the problems that genuinely remain
(redundancy, measurement, attribution), not against this one.

Significance is `INDICATIVE`, not `SIGNIFICANT` — 6 examples and 18 graded observations are below the
reporting threshold. The Finding B flip is a categorical before/after on a reproduced real failure,
which is stronger evidence than the aggregate deltas; the aggregate numbers are directional only.

---

## Phase 2B Result — CORRELATION CLOSED

Implemented in Phase 2B: P2-003, P2-004, P2-005, P2-006, P2-015. Nothing else. Learning stays on
hold (P2-010/011/012), redundancy stays on hold (P2-013/014, and E25 is now decided in principle).

**The Phase 2 audit's worst finding is refuted, end to end.** `brain_context` now returns a
`contextId` naming the delivery it just recorded; `brain_feedback` and `brain_record_outcome` accept
it and reject an id that names nothing. An MCP acceptance test drives the whole loop over the real
wire protocol against real SQLite and asserts the chain closes:

```
brain_context -> contextId -> brain_feedback(contextId) + brain_record_outcome(contextId)
              -> getEventsForTask returns retrieval 1 / context 1 / feedback 1 / outcome 1
              -> normalized rows reconstruct includedMemoryIds and omittedMemoryIds exactly
              -> sum(delivered per-item tokens) == ContextPack.tokenCount
```

Compare Phase 1, where `getEventsForTask` returned `{retrieval: [], context: [], ...}` for every
real task because 13 of 13 context events had `task_id = NULL` and the Brain never returned the id
it had already minted.

**Measurement is now computable.** `context_event_memories` makes "which contexts included this
memory" an indexed join instead of a full scan plus JSON parse, and gives per-item delivered token
cost somewhere to live. `context_events` carries `candidate_count`, `candidate_token_count`, and
four stage timings. `deliveredTokens / candidateTokens` has both of its terms for the first time.

**Nothing about ranking changed.** `rank.ts`, `score.ts`, `optimize.ts`, `compiler.ts`, `scope.ts`,
`0001_initial_schema.sql`, and `mcp/schemas.ts` are byte-identical to their Phase 2A hashes. The A
vs A' evaluation report is numerically unchanged.

Migration `0002_phase2_measurement.sql` was verified against a copy of the real `data/brain.db`: all
10 memories, 13 retrieval events, 13 context events, 4 outcomes, and 5 feedback events survive; the
new columns are NULL on pre-existing rows, which honestly means "recorded before measurement
existed"; reopening applies nothing.

---

## Verdict

**READY_WITH_REQUIRED_DECISIONS**

The Phase 2 design is complete, grounded in reproduced evidence, and fits inside the Phase 1
architecture without redesigning any boundary. Three approvals (**E1**, **E3**, **E23**) gate
implementation; one (**E14**) narrows a single task's scope; one (**E24**) is cosmetic.

Three tasks — P2-001, P2-007, P2-008 — are unblocked today and are the correct starting point
regardless of how the approvals resolve.

Implementation of any Phase 2 code remains gated behind explicit approval. This specification pass
does not itself authorize writing TypeScript, migrations, or contract changes, per the brief's own
stop condition.
