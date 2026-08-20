# Phase 2 Specification — Evaluation, Learning, Learning-Aware Ranking

Implementation-ready specification for Phase 2. Resolutions in `PHASE_2_DECISIONS.md` are treated as
settled; this document applies them rather than re-arguing them. Evidence for every empirical claim
is in `PHASE_2_FINDINGS.md`.

**Not authorized for implementation.** Five decisions marked **[HUMAN]** in `PHASE_2_DECISIONS.md`
gate the work — see `PHASE_2_READINESS.md`.

---

## Objective

Close the learning loop with a **measurable** improvement, not a plausible one:

```
Context -> Agent -> Task -> Feedback/Outcome -> Learning aggregation -> Ranking -> Better context
                                                        |
                                                        v
                                              Evaluation harness
                                        (proves each arrow earns its place)
```

Three capabilities, in strict order: **Evaluation → Learning → Better Ranking**. Nothing that
"learns" ships before something that can prove it improved.

## Scope

In scope: correction of the Phase 1 relevance-signal defects; context-delivery correlation
(`contextId`); event-shape normalization; a usefulness projection; learning-aware candidate
decoration; redundancy-aware context selection; scope-specificity tie-breaking; a pure evaluation
harness with a replayable dataset; observability columns.

## Non-Goals (explicitly not this phase)

- Memory consolidation / rewriting (E20 — Phase 5).
- Automatic/passive capture (E21 — Phase 5).
- UCB or any exploration bonus (E13 — Phase 5).
- Task classification and per-task-class learning (E15 — key recorded, unused).
- Counterfactual quality measurement (E17 — not measurable).
- A real tokenizer, LLM summarization, semantic compression (E22).
- Codebase intelligence (Phase 3), new scope kinds, hosted providers, SDK/CLI, any dashboard.
- Any destructive action driven by usefulness: no auto-archive, no auto-purge, no auto-confidence
  change (E14).

---

## 1. Preconditions — the two Phase 1 corrections

These are not enhancements. Phase 2's measurements are meaningless without them.

### 1.1 Lexical signal direction (E1)

Current, [retrieval-store.ts:135](../packages/storage/src/retrieval-store.ts#L135):

```ts
signals: { lexicalScore: 1 / (1 + Math.abs(row.fts_rank)) }   // INVERTED
```

FTS5's `rank` is `bm25()`: negative, more negative = better. `Math.abs()` makes the transform
monotonically decreasing in match quality.

Required behaviour: `lexicalScore` is **monotonically non-decreasing in match quality** for every
candidate set. Combined with §1.2, the concrete rule is: score from `-rank` (so better matches are
larger), then normalize per query.

### 1.2 Per-query signal normalization (E2)

Both signals are normalized to `[0, 1]` over the returned candidate set, at the point of production:

```
normalized(x) = (x - min) / (max - min)      when max > min
normalized(x) = 1.0                          when max == min, or a single candidate
```

Rules:
- `lexicalScore` normalizes over `-fts_rank`.
- `semanticScore` normalizes over `-distance` (nearer is better).
- Normalization is **per query**, over the candidates that query returned. No stored constants, no
  corpus-wide statistics, nothing that goes stale on write.
- The degenerate all-equal case yields `1.0` for every candidate, never `NaN` and never `0`.
- Normalization happens in `packages/storage` (where the raw backend numbers are), not in ranking.
  Ranking must remain able to assume its inputs are comparable.

**Consequence, stated plainly:** this changes Baseline A's output. Strategy **A′** (§7) exists
specifically to measure how much of Finding B was this bug versus a ranking-model problem.

### 1.3 Store-conformance suite (mandatory, no approval needed)

`FakeRetrievalStore` and `SqliteRetrievalStore` must satisfy one shared behavioural contract,
exercised by one shared test body run against both:

1. For any fixture pair where record A is a strictly better match than record B, `signal(A) >
   signal(B)` — for both lexical and semantic.
2. All produced signals lie in `[0, 1]`.
3. A single-candidate result scores `1.0`, not `0`.
4. Scope isolation holds (existing behaviour, re-asserted here so the shared suite is the single
   place both stores are checked).

This is the test whose absence let an inverted signal ship inside 218 green tests
(`PHASE_2_FINDINGS.md` §3.6). Every future signal added to `Candidate` extends this suite.

---

## 2. Contract Changes

Proposed only. Nothing in `packages/core/contracts` is modified by this document. Full
producer/consumer/compatibility detail per change is in the table at §2.9.

### 2.1 `ContextDelivery` — NEW Gateway-level type (CORRECTED)

**`ContextPack` is not modified.** It remains the pure output of `core/token`: items, token count,
truncation, omissions. It has no identity field, because a pure budget-enforcement function has no
business manufacturing one.

Delivery identity is a *Gateway* concern, expressed as a distinct type -- defined in
`packages/gateway/src/types.ts` alongside the other Gateway-orchestration-specific shapes, not in
`@brain/contracts`:

```ts
ContextDelivery = ContextPack & {
  contextId: string | null      // the ContextEvent id for this delivery
}
```

- `core/token` returns `ContextPack`. Unchanged. It never sees, sets, or nulls a `contextId`.
- The Gateway owns `ContextEvent` creation, and wraps the pack into a `ContextDelivery` with the
  recorded id.
- `brain_context` returns `ContextDelivery`.
- `brain_feedback` / `brain_record_outcome` may reference `contextId`.
- `contextId: null` means telemetry recording failed — the existing non-blocking degradation path —
  and is honestly distinguishable from a real id.

**Superseded:** an earlier version of this section put `contextId: string | null` directly on
`ContextPack` and had `optimizeContext()` emit `null`. That forced a pure function to carry a field
it can never populate, and leaked an event-store concept into the token-budget layer. Do not
implement it.

### 2.2 `FeedbackEvent.contextId` — NEW, optional

Lets feedback name the exact delivery it refers to, instead of relying on a caller-invented
`taskId`. `taskId` is unchanged and remains valid.

### 2.3 `FeedbackEvent.reason` — NEW, optional

```ts
reason: 'redundant' | 'irrelevant' | 'incorrect' | 'other' | null
```

Routing is not cosmetic (E14):
- `redundant` → redundancy model **only**; does **not** decrement usefulness.
- `irrelevant` → usefulness, tier 1.
- `incorrect` → usefulness, tier 1, **and** sets a review flag for a human. Never auto-archives.
- `other` / `null` → usefulness, tier 1.

Without this field, the one real negative datapoint in the corpus (a globally-correct memory
rejected for being a duplicate) would be scored identically to a false memory.

### 2.4 `OutcomeEvent.contextId` — NEW, optional

Direct linkage, avoiding the `taskId` join that is empirically 0% populated.

### 2.5 `CandidateSignals` / `RankedResultSignals` — two NEW optional fields

```ts
historicalUsefulness?: number      // [0,1], 0.5 == neutral
usefulnessSampleCount?: number     // integer >= 0, for transparency and harness diagnostics
```

Absent = no learning data = ranking behaves exactly as Phase 1. This is what makes strategies A′ and
B the same code path with different inputs.

### 2.6 `RankingWeights.usefulness` — NEW, optional, default `0`

Defaulting to `0` makes strategy A′ the literal default and strategy B an explicit opt-in. No
existing caller changes behaviour.

### 2.7 `CompileContextInput.redundancyPairs` — NEW, optional

```ts
redundancyPairs?: { a: string, b: string, similarity: number }[]
```

Produced by retrieval preparation (which has store access); consumed by the still-pure
`compileContext()`. Absent → Phase 1 behaviour exactly.

### 2.8 `ContextItem.redundantWith` — NEW, optional

```ts
redundantWith?: string | null      // memoryId of the higher-ranked item this duplicates
```

Marks a demoted item. Set by `compileContext()`, read by the evaluation harness and by any agent
that wants to know why an item is last.

### 2.9 New interface: `UsefulnessStore`

Declared in `core/contracts`, implemented in `packages/storage`, injected into
`LearningSignalService`. Keeps the I/O behind an interface exactly as Phase 1 does for
`MemoryRepository` / `RetrievalStore` / `EventStore`.

```ts
interface UsefulnessStore {
  getStats(memoryIds: string[], taskClass?: string): Promise<Map<string, UsefulnessStats>>;
  applyFeedback(event: FeedbackEvent): Promise<void>;
  applyOutcome(event: OutcomeEvent, includedMemoryIds: string[]): Promise<void>;
  rebuild(): Promise<{ rowsRebuilt: number }>;
}

type UsefulnessStats = {
  memoryId: string;
  taskClass: string;          // '*' in Phase 2
  timesRetrieved: number;
  timesIncluded: number;
  usefulCount: number;
  notUsefulCount: number;
  outcomeEvidence: number;    // accumulated diluted tier-2 weight
  lastUsedAt: string | null;
};
```

### Change table

| # | Contract | Field / type | Why | Producer | Consumer | Optional | Compatibility |
|---|---|---|---|---|---|---|---|
| 1 | *(new)* `ContextDelivery` | `ContextPack & { contextId: string \| null }` | Correlation is impossible today (`FINDINGS` §4.3). Keeps `ContextPack` pure — see §2.1 | Gateway | agent, feedback, outcome | n/a — new type | Additive. **`ContextPack` unchanged**; `core/token` untouched |
| 2 | `FeedbackEvent` | `contextId?: string \| null` | Per-delivery attribution | agent | learning projection | yes | Additive |
| 3 | `FeedbackEvent` | `reason?: enum \| null` | Separate "redundant" from "wrong" (`FINDINGS` §5) | agent | projection, redundancy model | yes | Additive |
| 4 | `OutcomeEvent` | `contextId?: string \| null` | Direct linkage | agent | projection | yes | Additive |
| 5 | `CandidateSignals` | `historicalUsefulness?: number` | Learning signal into pure ranking | `LearningSignalService` | `rank()` | yes | Additive |
| 6 | `CandidateSignals` | `usefulnessSampleCount?: number` | Transparency; harness diagnostics | `LearningSignalService` | `rank()`, harness | yes | Additive |
| 7 | `RankedResultSignals` | mirrors 5 and 6 | Pass-through | `rank()` | harness, agent | yes | Additive |
| 8 | `RankingWeights` | `usefulness?: number` (default 0) | Strategy toggle | caller | `computeScore()` | yes | Additive, default preserves Phase 1 |
| 9 | `CompileContextInput` | `redundancyPairs?: {a,b,similarity}[]` | Redundancy without breaking `core/context` purity | retrieval prep | `compileContext()` | yes | Additive |
| 10 | `ContextItem` | `redundantWith?: string \| null` | Marks demotion | `compileContext()` | harness, agent | yes | Additive |
| 11 | `ContextEvent` | `candidateTokenCount`, `retrievalMs`, `rankingMs`, `compileMs`, `optimizeMs`, `candidateCount` | Efficiency + observability (E16, E19) | Gateway | harness, ops query | yes | Additive |
| 12 | *(new)* | `UsefulnessStore`, `UsefulnessStats` | Learning I/O behind an interface | — | `LearningSignalService` | n/a | New interface |

**Explicitly NOT added**, having been considered:
- `Candidate.scopeSpecificity` — scope is already on `record.scope`; ranking reads it directly for
  the tie-break. Adding a derived field would be a field added "because it might be useful."
- `Candidate.freshness` — no Phase 2 policy for it; timestamps are already present.
- `MemoryRecord.usefulness` — forbidden by E11.
- Any `agentId`-conditioned signal — agent-specific behaviour does not belong in the core.

---

## 3. Package Architecture

### Actual Phase 2 DAG

```
                       @brain/contracts                     PURE (leaf; zod only)
                              |
     +----------+-------------+-------------+------------+-----------+
     |          |             |             |            |           |
 @brain/     @brain/      @brain/       @brain/      @brain/     @brain/
 ranking     context    compression    memory      retrieval   learning
  PURE        PURE      PURE(no deps)   IFACE-I/O   IFACE-I/O   IFACE-I/O
     |          |             |          (MemoryRepo) (RetrStore) (EventStore,
     |          |             |                                    UsefulnessStore)  <- EXTENDED
     |          |             v
     |          |        @brain/token   PURE  (-> compression)
     |          |             |
     +----------+-------------+---------------+
                              |
                        @brain/gateway        COMPOSITION (no direct storage import)
                              |
                        @brain/mcp            ADAPTER (storage only in bootstrap.ts)

  @brain/storage   I/O  ->  implements contracts' interfaces. Imported ONLY by mcp/bootstrap.ts.
  @brain/knowledge IFACE-I/O -> core/memory. Unchanged.

  @brain/evaluation  PURE  ->  contracts, ranking, context, token, test-fixtures     [NEW]
                              NOTHING IMPORTS IT. Not a production dependency.
```

### Purity classification

| Package | Class | I/O | Change in Phase 2 |
|---|---|---|---|
| `core/contracts` | **pure** | none | +8 optional fields, +1 interface, +1 type |
| `core/ranking` | **pure** | none | + usefulness term, + scope tie-break. **Still zero dependencies beyond contracts** |
| `core/context` | **pure** | none | + optional `redundancyPairs` handling |
| `core/compression` | **pure** | none | none |
| `core/token` | **pure** | none | **none at all** — `ContextPack` is unchanged; `ContextDelivery` is a Gateway type (§2.1) |
| `core/memory` | interface-mediated | via `MemoryRepository` | none |
| `core/retrieval` | interface-mediated | via `RetrievalStore` | + redundancy-pair computation in preparation |
| `core/learning` | interface-mediated | via `EventStore`, `UsefulnessStore` | **+ `LearningSignalService`, + projection maintenance** |
| `storage` | **I/O** | SQLite, embeddings | + 2 tables, + 6 columns, + normalization fix, + `SqliteUsefulnessStore` |
| `gateway` | composition | none directly | + decoration step, + timing, + `contextId` attach |
| `mcp` | adapter | none except bootstrap | + `contextId`/`reason` on two tool schemas |
| **`evaluation`** | **pure** *(new)* | reads dataset files at the harness edge only | new |

### Why only one new package

`core/learning` already owns event I/O behind an injected interface and already exists as the seam
`PHASE_1_SPEC.md` reserved for exactly this. Adding `packages/learning-projection` would split one
concern across two packages for no dependency benefit.

`packages/evaluation` is genuinely new and must be separate: it is the only package that may depend
on ranking *and* context *and* token simultaneously, and nothing in production may depend on it. A
CI boundary rule enforces the second half.

### New CI boundary rules (extending the four from `PHASE_1_SPEC.md`)

5. `packages/core/ranking/**` must import nothing but `@brain/contracts`. *(Re-asserted, because the
   usefulness signal is the first change that could plausibly tempt a repository import.)*
6. No package other than `packages/evaluation/**` and test files may import `@brain/evaluation`.
7. `packages/evaluation/**` must not import `@brain/storage`, `@brain/gateway`, or `@brain/mcp`.

---

## 4. Storage Changes

Migration `0002_phase2_measurement.sql` (renamed from `..._learning.sql` when Phase 2B shipped it:
it carries no learning schema). Additive and reversible; no Phase 1 table is dropped or rewritten.

Applied by a filename-ordered loader backed by a `schema_migrations` ledger. A pre-ledger database
re-applies `0001` (a no-op, since every statement in it is `CREATE ... IF NOT EXISTS`), records it,
then applies `0002`. Later migrations need not be self-idempotent -- the ledger guarantees
exactly-once, and a per-migration transaction guarantees nothing is left half-applied.

### 4.1 `context_event_memories` — junction (E23)

```sql
CREATE TABLE IF NOT EXISTS context_event_memories (
  context_event_id TEXT    NOT NULL REFERENCES context_events(id) ON DELETE CASCADE,
  memory_id        TEXT    NOT NULL REFERENCES memories(id)       ON DELETE CASCADE,
  included         INTEGER NOT NULL CHECK (included IN (0,1)),
  rank             INTEGER NULL,
  token_count      INTEGER NULL,
  redundant_with   TEXT    NULL REFERENCES memories(id),
  PRIMARY KEY (context_event_id, memory_id)
);
CREATE INDEX IF NOT EXISTS idx_cem_memory   ON context_event_memories(memory_id, included);
CREATE INDEX IF NOT EXISTS idx_cem_context  ON context_event_memories(context_event_id);
```

- **Purpose:** make "which contexts included this memory", per-item token cost, and rank position
  indexable. Today all three require a full scan plus JSON parse (`FINDINGS` §4.4).
- **Source of truth:** written in the same transaction as its `ContextEvent`.
- **Rebuildability:** derivable from `context_events`' existing JSON columns, which are retained and
  kept in sync for one migration cycle. Reversible by dropping the table.
- **Failure behaviour:** the junction write is inside the ContextEvent transaction, so a failure
  fails telemetry as a unit — which the Gateway already catches, logs loudly, and does not let block
  the agent's context.

### 4.2 `memory_usefulness_stats` — derived projection (E6) — **NOT BUILT**

**Deferred with the rest of the learning track.** Migration `0002` deliberately omits it. The shape
below stands as the design for whenever P2-010 is re-justified.

```sql
CREATE TABLE IF NOT EXISTS memory_usefulness_stats (
  memory_id        TEXT NOT NULL REFERENCES memories(id) ON DELETE CASCADE,
  task_class       TEXT NOT NULL DEFAULT '*',
  times_retrieved  INTEGER NOT NULL DEFAULT 0,
  times_included   INTEGER NOT NULL DEFAULT 0,
  useful_count     INTEGER NOT NULL DEFAULT 0,
  not_useful_count INTEGER NOT NULL DEFAULT 0,
  outcome_evidence REAL    NOT NULL DEFAULT 0,
  review_flagged   INTEGER NOT NULL DEFAULT 0 CHECK (review_flagged IN (0,1)),
  last_used_at     TEXT NULL,
  rebuilt_at       TEXT NOT NULL,
  PRIMARY KEY (memory_id, task_class)
);
```

- **Purpose:** O(candidates) lookup of learned signals during a request.
- **Source of truth: the event tables, not this table.** This is a cache.
- **Rebuildability: mandatory and tested.** `rebuild()` truncates and recomputes from
  `feedback_events`, `outcome_events`, `context_event_memories`. AT-7 asserts rebuild output equals
  incremental output exactly. On disagreement, events win.
- **Migration strategy:** created empty; `rebuild()` populates it from existing Phase 1 events on
  first run (the live DB's 5 feedback + 4 outcome events survive the transition).
- **Failure behaviour:** missing / empty / stale → decoration returns candidates unchanged →
  ranking degrades to strategy A′ → **no error, no blocked request**. Same discipline as
  `sqlite-vec` unavailability.
- `review_flagged` is set by `reason = 'incorrect'` and is **read-only advice for a human**. Nothing
  in the Brain acts on it.

### 4.3 Columns on `context_events`

```sql
ALTER TABLE context_events ADD COLUMN candidate_count       INTEGER NULL;
ALTER TABLE context_events ADD COLUMN candidate_token_count INTEGER NULL;
ALTER TABLE context_events ADD COLUMN retrieval_ms          INTEGER NULL;
ALTER TABLE context_events ADD COLUMN ranking_ms            INTEGER NULL;
ALTER TABLE context_events ADD COLUMN compile_ms            INTEGER NULL;
ALTER TABLE context_events ADD COLUMN optimize_ms           INTEGER NULL;
```

All nullable — existing rows stay valid.

### 4.4 Columns on `feedback_events` / `outcome_events`

```sql
ALTER TABLE feedback_events ADD COLUMN context_id TEXT NULL REFERENCES context_events(id);
ALTER TABLE feedback_events ADD COLUMN reason     TEXT NULL
      CHECK (reason IN ('redundant','irrelevant','incorrect','other'));
ALTER TABLE outcome_events  ADD COLUMN context_id TEXT NULL REFERENCES context_events(id);
CREATE INDEX IF NOT EXISTS idx_feedback_events_context ON feedback_events(context_id);
CREATE INDEX IF NOT EXISTS idx_outcome_events_context  ON outcome_events(context_id);
```

**No second memory store is introduced.** No evaluation results are stored in the Brain database —
harness output is a file/CI artifact (§6).

---

## 5. Learning Model

### 5.1 Flow

```
brain_feedback / brain_record_outcome
          |
          v
   EventService.record*()          append-only, unchanged, still the source of truth
          |
          +--> UsefulnessStore.applyFeedback / applyOutcome     incremental projection update
          |
          v
   memory_usefulness_stats         derived, rebuildable, droppable
          |
          v
   LearningSignalService.decorate(candidates)      <- the ONLY read path into ranking
          |
          v
   Candidate.signals.historicalUsefulness / usefulnessSampleCount
          |
          v
   rank()   PURE
```

### 5.2 Usefulness formula (E5 — CORRECTED)

Two evidence streams, never one signed value:

```
positiveEvidence = usefulCount    + dilutedSuccessEvidence
negativeEvidence = notUsefulCount + dilutedFailureEvidence

posterior    = (positiveEvidence + 1) / (positiveEvidence + negativeEvidence + 2)
evidenceMass = positiveEvidence + negativeEvidence
signal       = 0.5 + (posterior - 0.5) * evidenceMass / (evidenceMass + K)      K = 5
```

`reason = 'redundant'` contributes to **neither** stream.

Reference values (verified arithmetic):

| pos | neg | mass | signal |
|---|---|---|---|
| 0 | 0 | 0 | **0.500** |
| 0 | 1 | 1 | 0.472 |
| 1 | 0 | 1 | 0.528 |
| 0 | 5 | 5 | 0.321 |
| 18 | 2 | 20 | 0.791 |
| 0 | 0.021 | 0.021 | 0.49998 |
| 0 | 0.43 | 0.43 | 0.493 |
| 5 | 6 | 11 | 0.474 |

**The superseded single-signed-`outcomeEvidence` model must not be implemented.** It folded outcome
evidence into the sample count rather than the posterior, with three consequences: a failure could
not move the estimate at all (`posterior` stayed exactly `1/2`); a failure reduced sample mass
instead of adding evidence; and `n` could go negative, making the shrinkage factor negative and
**inverting the sign of the whole adjustment** — a memory with five explicit `useful=true` votes
could score below neutral. Full derivation in `PHASE_2_DECISIONS.md` E5.

Invariants the corrected model guarantees, each to be asserted by test:
- `evidenceMass ≥ 0` always, so `evidenceMass/(evidenceMass+K) ∈ [0, 1)` always.
- `signal ∈ (0, 1)` always.
- `signal = 0.5` exactly when `evidenceMass = 0`.
- Adding failure evidence never increases `signal`; adding success evidence never decreases it.

`K` is a tuning constant set by the harness, documented as adjustable. Not architecture.

### 5.3 Attribution (E12)

| Tier | Evidence | Contribution |
|---|---|---|
| 1 | `FeedbackEvent.useful = true` | `positiveEvidence += 1` |
| 1 | `FeedbackEvent.useful = false` | `negativeEvidence += 1` |
| 1* | `reason = 'redundant'` | **neither** stream moves; feeds the redundancy model only |
| 2 | included, linked outcome `success` | `positiveEvidence += 0.15 / \|includedMemoryIds\|` |
| 2 | included, linked outcome `failure` | `negativeEvidence += 0.15 / \|includedMemoryIds\|` |
| 3 | retrieved but not included | `timesRetrieved += 1` only. Zero score contribution |

Outcome evidence routes to a **stream**, never to a signed scalar. This is what makes a failure real
evidence rather than a reduction in sample mass (§5.2).

Credit dilution is mandatory: without it, large context packs inflate every member simultaneously
and the ranker learns "memories in big packs are good."

`outcome = 'partial' | 'unknown'` contribute **nothing**. Only `success` and `failure` move
`outcomeEvidence`.

**Uncalibrated path, flagged:** the live corpus contains **zero** `failure` outcomes. Tier 2's
negative branch is implemented symmetrically and is untested against real data.

### 5.4 Task-conditional key (E15)

All Phase 2 writes and reads use `task_class = '*'`. The column exists so per-class buckets need no
migration later. No classifier is built.

### 5.5 Confidence isolation (E11)

The projection **never** writes to `memories`. Enforced by AT-9, which gives the projection a
read-only handle to the memory table so a violation fails loudly rather than succeeding silently.

---

## 6. Evaluation Model

### 6.1 `packages/evaluation` — pure

```ts
evaluate(
  dataset: EvalExample[],
  strategy: (candidates: Candidate[]) => RankedResult[],
  opts?: { k?: number[]; budget?: TokenBudget }
): EvalReport
```

No database, no network, no MCP, no Gateway. Candidates come from the dataset or from an injected
provider, so a run never depends on a developer's live `brain.db`.

### 6.2 Dataset format — replayable, versioned, additive

`packages/evaluation/datasets/*.jsonl`, one example per line:

```json
{
  "id": "notes-api-db-refactor",
  "task": "Refactor the database layer without changing API behavior.",
  "scope": { "kind": "project", "id": "notes-api" },
  "memories": [
    { "key": "notes-repo-constraint", "type": "constraint", "confidence": 1.0,
      "scope": { "kind": "project", "id": "notes-api" },
      "content": "notes-api: database access must go through the repository layer..." },
    { "key": "notes-plural-rule", "type": "rule", "confidence": 1.0,
      "scope": { "kind": "project", "id": "notes-api" },
      "content": "notes-api REST endpoints use plural resource names: /notes, /notes/:id..." },
    { "key": "global-plural-rule", "type": "rule", "confidence": 0.5,
      "scope": { "kind": "global", "id": null },
      "content": "REST API resources should use plural nouns in endpoint paths..." }
  ],
  "labels": { "notes-repo-constraint": 2, "notes-plural-rule": 1, "global-plural-rule": 0 },
  "redundantWith": { "global-plural-rule": "notes-plural-rule" },
  "outcome": null
}
```

- **Graded labels** `0 | 1 | 2` — required for NDCG; binary labels cannot express "relevant but less
  useful than the other relevant one," which is exactly the Finding B distinction.
- **Memories declared in the dataset**, loaded into a throwaway in-memory Brain. Production ranking
  never sees these strings; they are regression fixtures, not tuning targets.
- **`redundantWith`** encodes Finding C's structure so redundancy handling is measurable.

Seed dataset = the two Phase 1 real-world tasks (§8 of the brief), plus their scope-isolation
counterparts.

### 6.3 Growth path — export from real events

```ts
exportFromEvents(store: EventStore, since?: string): EvalExample[]
```

Builds examples from `(ContextEvent, its FeedbackEvents)` pairs: task text from the linked
`RetrievalEvent.queryText`, labels from `useful` (true → 2, false → 0, absent → unlabeled and
excluded from precision), redundancy edges from `reason = 'redundant'`.

This is how future real examples enter the dataset without hand-authoring and without hardcoding
evaluation logic into production ranking. It only works after `contextId` linkage lands (E3) — which
is itself the reason `contextId` ranks above every learning feature in the task order.

### 6.4 Metrics

**Ranking quality** (needs labels): `Precision@K`, `Recall@K`, `MRR`, `NDCG@K` for
`K ∈ {1, 3, 5, 10}`.

**Token efficiency** (needs §4.1 + §4.3):

```
contextEfficiency   = usefulTokens     / deliveredTokens
redundantRatio      = redundantTokens  / deliveredTokens
retrievalEfficiency = deliveredTokens  / candidateTokens
labeledFraction     = labeledItems     / deliveredItems
```

**`labeledFraction` must be reported alongside every ratio above.** Unlabeled included items are
*unknown*, not useless. `contextEfficiency = 0.4` at `labeledFraction = 0.4` means "everything we
know about was useful," not "60% waste." Omitting it produces a confidently wrong number — the same
failure as AEOS's two disagreeing OII values.

**Agent efficiency** (E18): calls per task; repeated-identical-request rate; candidate-set Jaccard
between consecutive requests in a session; one-shot success rate.

**Not measured, by decision:** counterfactual quality (E17); "unnecessary tool calls" (invisible to
the Brain); any composite single-number index.

### 6.5 Statistical honesty requirement

Every `EvalReport` carries `exampleCount` and `labeledObservationCount`. With 2 seed examples and 5
real feedback observations, no metric difference is statistically meaningful. The harness must state
this rather than let a 0.02 NDCG delta read as progress. A report below a configured minimum
observation count is labelled `INDICATIVE`, not `SIGNIFICANT`.

---

## 7. Ranking Strategies

All four run against the same dataset through the same harness. **The harness decides which wins.**

| | Strategy | Definition |
|---|---|---|
| **A** | Phase 1, unchanged | Current shipped behaviour, inverted lexical signal included. The *actual* control |
| **A′** | A + §1.1 + §1.2 | Corrected direction and normalization. **No learning.** Isolates bug from model |
| **B** | A′ + usefulness | `weights.usefulness > 0`, `historicalUsefulness` decorated onto candidates |
| **C** | B + scope + redundancy | Scope-specificity tie-break, redundancy demotion in context selection |

### Scoring formula under B/C

```ts
computeScore(signals, weights) =
    weights.lexical   * (signals.lexicalScore   ?? 0)
  + weights.semantic  * (signals.semanticScore  ?? 0)
  + weights.tag       * (signals.tagScore       ?? 0)
  + weights.usefulness * ((signals.historicalUsefulness ?? 0.5) - 0.5) * 2
```

Note the shape: usefulness enters as a **centred, signed adjustment**, not an additive bonus. A
neutral memory (0.5) contributes exactly `0`. This is deliberate — AEOS additively stacked a
performance boost on top of an already-normalized relevance score, which let "proven" patterns
dominate regardless of query relevance (`AUDIT_AEOS.md §11`). Centring makes that structurally
impossible: usefulness can only move a candidate relative to a *neutral* one, never lift it on its
own.

### Tie-break order under C

1. combined score (descending)
2. **scope specificity: `project` ≻ `session` ≻ `global`** *(new)*
3. `record.confidence` (descending) *(Phase 1, unchanged)*
4. `memoryId` lexicographic *(Phase 1, total order)*

### Prediction to test, not assume

**A′ alone may fully satisfy the §26 acceptance test.** The Finding B failure is fully explained by
the inverted signal. If A′ passes AT-1, then B and C must justify themselves on *other* metrics —
context efficiency, redundant ratio, NDCG across the wider dataset — rather than on the fixture that
motivated them. Shipping B or C because "learning is the Phase 2 goal," when A′ already passes, is
exactly the unjustified complexity this project's architecture review keeps warning about.

**Weight tuning rule:** weights are fit on the harness dataset and reported with their fit. Tuning
weights by hand against the two Phase 1 projects is explicitly forbidden — that is overfitting to
n=2.

---

## 8. Redundancy Strategy

### Detection — retrieval preparation

Over the candidate set, compute pairwise cosine similarity from stored vectors. Emit
`{ a, b, similarity }` for pairs where `similarity ≥ τ`, `a` being the higher-ranked member.

Cost: 50 candidates → 1225 dot products of 384 floats. Local, no network, negligible.

Degradation: vectors unavailable → emit no pairs → Phase 1 behaviour. Never an error.

#### Vector-access interface — OPEN DECISION (E25), must be resolved before P2-013

The original spec said "retrieval preparation, which already has store access" and **never named the
interface that returns candidate vectors**. It does not exist. `RetrievalStore` exposes only
`lexicalSearch` / `semanticSearch`, and `MemoryRecord` deliberately excludes the raw embedding
(`PHASE_1_SPEC.md` Storage Boundary: *"never includes the raw embedding vector; that stays inside
`packages/storage`"*). P2-013 is **not implementable** as written.

Four options:

| | Shape | Verdict |
|---|---|---|
| **A** | `RetrievalStore.getVectors(memoryIds): Promise<Map<string, number[]>>` | Workable, but ships 384 floats × 50 candidates across the storage boundary on every request and puts raw vectors into `core/retrieval` — the exact thing Phase 1 kept inside storage |
| **B** | `RetrievalStore.findSimilarPairs(memoryIds, threshold): Promise<RedundancyPair[]>` | **Recommended.** Vectors never leave `packages/storage`; `core/retrieval` receives pairs, not floats; sqlite-vec does the work; the threshold is a caller-supplied parameter, so no similarity *policy* moves into storage |
| **C** | Carry `embedding` on `Candidate` | Rejected — contradicts the Phase 1 boundary, and inflates every retrieval response whether or not redundancy is wanted |
| **D** | A separate `VectorStore` interface | Rejected — considered and rejected once already in `PHASE_1_SPEC.md` for the same reason: it adds a layer `packages/storage` does not need internally |

**Recommendation: B.** It is the smaller interface, it preserves the vector-containment rule, and it
keeps `core/retrieval` free of numeric similarity code.

**Open sub-question for the same decision:** whether the pure `compileContext()` should receive
`redundancyPairs` (current spec) or whether demotion belongs in the Gateway. The spec's answer is
`compileContext()`, because ordering is a compilation concern and the pairs are already computed —
but this was never explicitly weighed against a Gateway-side alternative and should be, at the same
time as the interface choice.

Do not implement P2-013 until E25 is resolved.

### Selection — `compileContext()`, still pure

For each `redundancyPairs` entry where both members survived dedup and `a` outranks `b`:
set `b.redundantWith = a.memoryId` and move `b` after all non-redundant items, preserving relative
order among demoted items.

**Within-cluster preference (E9):** if `a` and `b` tie on score, the more scope-specific one is
treated as `a`.

### What this deliberately does NOT do

- No deletion, archiving, merging, or rewriting. A redundant memory is **last in line, not gone**,
  and is still returned when budget allows.
- No new dependency for `core/context`: no embeddings, no I/O, no similarity computation. It
  consumes pre-computed pairs.
- No cross-request state.

### τ

Harness-tuned. The single real datapoint puts the redundant pair at cosine **0.785** with the
next-nearest candidate at **0.518** (`FINDINGS` §5) — a usable window, and one example. τ is a
documented, adjustable parameter; it is not a design constant, and it is not fit by hand.

---

## 9. Scope-Specificity Strategy

Two uses, both non-scoring (E9):

1. Ranking tie-break, level 2 (above confidence). Zero effect when scores differ.
2. Within-redundancy-cluster preference.

**Not adopted:** "project always beats global"; scope as a weighted score term. The same real-world
test that produced the redundancy case also shows the global plural rule being correctly retrieved
and used for `task-api`, where no project equivalent existed. A scope score term would penalize
global knowledge exactly where it is the only knowledge available.

---

## 10. Observability

Six nullable columns on the existing `context_events` row (§4.3). One row already exists per
`brain_context` call — right grain, right lifetime, no new subsystem.

Timing is measured in the Gateway around the four existing stage calls. Exposed by SQL aggregate or
an extension to `brain_status`; **no new MCP tool**.

Explicitly rejected: a metrics package, a time-series store, OpenTelemetry, any network exporter.

---

## 11. Security / Isolation — unchanged, re-asserted

- Scope isolation stays enforced at the storage query. Nothing in §7–§9 filters or authorizes.
- `domain` remains never an authorization input.
- Learning data stays internal: `historicalUsefulness` and `usefulnessSampleCount` appear on
  `RankedResult` (which `brain_search` already returns) but **never** on `ContextItem`. The agent
  receives useful knowledge, not the Brain's internal state (`ARCHITECTURE.md §12`).
- `review_flagged` is human-facing advice; nothing acts on it automatically.
- No usefulness evidence may cause an archive, purge, or confidence change.

---

## 12. Error Handling

Follows the Phase 1 asymmetry exactly:

| Failure | Behaviour |
|---|---|
| `memory_usefulness_stats` missing / empty / stale | Decoration returns candidates unchanged. Ranking degrades to A′. **No error** |
| Vectors unavailable for redundancy | No `redundancyPairs`. Compilation degrades to Phase 1. **No error** |
| Junction-table write fails | Fails with its `ContextEvent` transaction; Gateway logs loudly, still returns the context |
| Projection update fails after a feedback write | **Loud error.** The event is durable; the cache is stale; `rebuild()` fixes it. A silently discarded *write* is never acceptable |
| `contextId` references an unknown context | Validation error at the boundary. Do not silently accept an unlinkable event |
| Harness dataset malformed | `.strict()` rejection, loud. Never silently skipped |

---

## 13. Testing Strategy

| Area | Test |
|---|---|
| Signal direction | **Store conformance (§1.3): better match ⇒ strictly higher score, run against BOTH the fake and the real store** |
| Signal range | Every produced signal ∈ [0,1]; all-equal set ⇒ 1.0; single candidate ⇒ 1.0 |
| Cold start | New memory with zero events ranks identically under A′ and B |
| Negative damping | One `useful=false` moves the signal < 0.05 |
| Redundant routing | `reason='redundant'` moves neither usefulness counter |
| Attribution dilution | A 7-item successful context adds 0.15/7 per memory, not 0.15 |
| Rebuild equivalence | `rebuild()` output ≡ incremental output, byte-for-byte |
| Confidence isolation | Projection issues no write to `memories` (read-only handle proves it) |
| Correlation round-trip | `brain_context` → `contextId` → `brain_feedback(contextId)` → stats delta ≠ 0 |
| Redundancy purity | `core/context` package.json declares no embedding/storage dependency (structural) |
| Ranking purity | `core/ranking` package.json still declares only `@brain/contracts` (structural) |
| Evaluation isolation | No production package imports `@brain/evaluation` (CI rule 6) |
| Budget | Existing property test still passes unchanged |
| Scope isolation | Existing suite still passes unchanged |
| Degradation | Missing projection, missing vectors, failed junction write — each degrades, none throws past the Gateway |

---

## 14. Acceptance Criteria (Phase 2 as a whole)

1. **AT-1** — Task "Refactor the database layer without changing API behavior." under
   `project:notes-api`: the repository/database constraint ranks **above** both endpoint-naming
   memories. Scope isolation intact. Result under budget.
2. **AT-2** — Task "Implement GET /notes/search?q=…": both project rules present; under a
   constrained budget the redundant global rule is omitted or marked `redundantWith`, and the
   project rule is retained.
3. **AT-3** — A `notes-api` query never returns a `task-api` record (unchanged from Phase 1).
4. **AT-4** — `ContextPack.tokenCount ≤ maxTokens` for any candidate set and any budget (unchanged).
5. **AT-5** — Full correlation cycle: `brain_context` returns a `contextId`; `brain_feedback` and
   `brain_record_outcome` accept it; `getEventsForTask`/stats show the linkage. *This is the test
   whose absence produced 13-of-13 NULL task ids.*
6. **AT-6** — A zero-history memory ranks identically under A′ and B (neutral-prior proof).
7. **AT-7** — `rebuild()` reproduces the incremental projection exactly.
8. **AT-8** — Store-conformance suite passes for both `FakeRetrievalStore` and
   `SqliteRetrievalStore`. *This is the test whose absence let an inverted signal ship green.*
9. **AT-9** — The learning projection performs no write against `memories`.
10. **AT-10** — The harness runs A, A′, B, C over the seed dataset and emits a comparison report
    carrying `exampleCount`, `labeledObservationCount`, and a `SIGNIFICANT`/`INDICATIVE` label.
11. All Phase 1 acceptance criteria still pass, including zero external network calls in the default
    configuration.

Fixtures live in `packages/evaluation/datasets/`. **No production ranking code may reference these
strings.**
