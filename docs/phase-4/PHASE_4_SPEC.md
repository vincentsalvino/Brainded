# Phase 4 — Learning: Specification

Implementation specification for Phase 4.1 (Performance Aggregation) and Phase 4.2 (Bounded
Ranking Learning), built directly on `PHASE_4_DECISIONS.md`'s F1–F15. **Specification only — no
code in this document has been written to disk as part of this task.** Phase 4.3/4.4 are sketched
at the end, not specified in implementation detail, per `PHASE_4_DECISIONS.md` F14.

---

## 1. Package and file layout

Extends existing packages along their existing seams — no new package, matching this
architecture's own established composition-root discipline (D4) and reuse pattern (E7/E8).

```
packages/core/contracts/src/
  learning.ts                  NEW  — MemoryPerformanceRaw, LearningConfig
  retrieval.ts                 MODIFIED — Candidate gains optional `performance`
  repositories.ts              MODIFIED — new MemoryPerformanceStore interface

packages/core/learning/src/
  aggregation.ts                NEW  — pure: computeUsefulnessSignal() (F4's formula)
  decorate.ts                   NEW  — LearningSignalService.decorate() (I/O via injected store)
  config.ts                     NEW  — DEFAULT_LEARNING_CONFIG (enabled: false)
  service.ts                    UNCHANGED — existing EventService pass-through
  index.ts                      MODIFIED — export the above

packages/core/ranking/src/
  rank.ts                       MODIFIED — reads candidate.performance, bounded multiplier
  score.ts                      UNCHANGED — computeScore stays pure relevance, no new signal

packages/storage/src/
  memory-performance-store.ts   NEW  — SqliteMemoryPerformanceStore, rebuildAll()
  event-store.ts                MODIFIED — recordFeedback/recordOutcome wrapped in a transaction
                                            that also applies the raw-count delta

packages/gateway/src/
  gateway.ts                    MODIFIED — inject store + config; call decorate() at both
                                            rank() call sites, gated by config.enabled

packages/mcp/src/
  bootstrap.ts                  MODIFIED — wire SqliteMemoryPerformanceStore + LearningConfig

packages/storage/migrations/
  0007_memory_performance.sql   NEW  — see §3 (proposed here, not created this session)
```

No new top-level package, no new abstraction beyond what E7 already specified two phases ago.

---

## 2. Contracts

### 2.1 `MemoryPerformanceRaw` (new, `packages/core/contracts/src/learning.ts`)

Raw counts only — per the brief's explicit instruction, evidence is never collapsed into one
opaque number at the storage layer. `usefulnessSignal`/`evidenceMass` are **derived on read**, not
stored, so a formula or `K` change (F4) never requires a migration or a stored-value rebuild —
only `rebuild()` of the raw counts themselves needs to ever run, and even that is for event-log
consistency, not formula changes.

```ts
export const MemoryPerformanceRawSchema = z.object({
  memoryId: z.string().uuid(),
  scopeKey: z.string().min(1),              // '*' only in 4.1/4.2 — see F8
  usefulCount: z.number().int().nonnegative(),
  notUsefulCount: z.number().int().nonnegative(),
  redundantReasonCount: z.number().int().nonnegative(),   // reason='redundant', excluded from both streams (F5)
  incorrectReasonCount: z.number().int().nonnegative(),   // subset of notUsefulCount; review-flag trigger (F5)
  dilutedSuccessEvidence: z.number().nonnegative(),        // sum of Tier-2 credit, success outcomes
  dilutedFailureEvidence: z.number().nonnegative(),        // sum of Tier-2 credit, failure/partial outcomes
  successContextCount: z.number().int().nonnegative(),     // raw, undiluted — observability only
  failureContextCount: z.number().int().nonnegative(),
  labeledContextCount: z.number().int().nonnegative(),     // distinct (memoryId, contextId) w/ Tier-1 feedback
  lastFeedbackAt: z.string().datetime().nullable(),
  lastOutcomeAt: z.string().datetime().nullable(),
}).strict();
export type MemoryPerformanceRaw = z.infer<typeof MemoryPerformanceRawSchema>;
```

### 2.2 `LearningConfig` (new, same file)

```ts
export const LearningConfigSchema = z.object({
  enabled: z.boolean(),                 // F10 — default false
  k: z.number().positive(),             // E5's shrinkage constant — default 5
  outcomeWeight: z.number().min(0),     // E12 Tier-2 weight — default 0, see F4
  maxBoost: z.number().min(0).max(1),   // F2's post-score multiplier bound — default 0.15
}).strict();
export type LearningConfig = z.infer<typeof LearningConfigSchema>;

export const DEFAULT_LEARNING_CONFIG: LearningConfig = {
  enabled: false, k: 5, outcomeWeight: 0, maxBoost: 0.15,
};
```

### 2.3 `Candidate` extension (`retrieval.ts`, modified)

```ts
export const CandidatePerformanceSchema = z.object({
  usefulnessSignal: z.number().min(0).max(1),   // F4 output, exactly 0.5 at zero evidence
  evidenceMass: z.number().nonnegative(),
}).strict();
export type CandidatePerformance = z.infer<typeof CandidatePerformanceSchema>;

export const CandidateSchema = z.object({
  memoryId: z.string().uuid(),
  record: MemoryRecordSchema,
  signals: CandidateSignalsSchema,
  performance: CandidatePerformanceSchema.nullable().optional(),   // NEW, additive
}).strict();
```

This is E7's "`rank()` gains two new optional fields it reads off the Candidate" — as one nullable
object, not two loose fields, since they're always produced and consumed together. **2026-09-05
correction:** `.nullable().optional()`, not `.nullable().default(null)` — the field must be
genuinely omittable, not merely null-defaulting under `.parse()`, because nothing in the shipped
pipeline actually calls `CandidateSchema.parse()` on constructed candidates (`FakeRetrievalStore`,
`SqliteRetrievalStore`, `mergeCandidates`, and the code-candidate paths all build plain object
literals). A `.default()` only fills in a missing key when `.parse()` runs; it does nothing for a
hand-built object literal, and would have made `Candidate`'s inferred TS type require
`performance` on every existing construction site — exactly the backward-compatibility break the
brief's Task 8 explicitly forbids. `.optional()` keeps the field genuinely absent-or-present at the
type level, so every existing producer keeps compiling unchanged. `rank()` (§7) treats `undefined`
and `null` identically — both mean "no learning signal" — so "no data" and "neutral data
(`evidenceMass: 0`)" still can never be confused, which was this design's actual goal.

### 2.3a `RankingLearningConfig` (`retrieval.ts`, new)

```ts
export const RankingLearningConfigSchema = z.object({
  enabled: z.boolean(),
  maxBoost: z.number().min(0).max(1),
}).strict();
export type RankingLearningConfig = z.infer<typeof RankingLearningConfigSchema>;
```

Added as a new optional field on `RankingInputSchema` (`learning: RankingLearningConfigSchema
.optional()`), mirroring the existing `weights` override pattern exactly. This is `rank()`'s own,
independent activation gate (§7) — deliberately not inferred from whether any candidate happens to
carry a `performance` field, so ranking has one explicit, testable "is learning on" switch rather
than an implicit one a stray populated field could accidentally trip.

### 2.4 `MemoryPerformanceStore` interface (`repositories.ts`, new)

```ts
export interface MemoryPerformanceStore {
  getPerformanceBatch(memoryIds: string[]): Promise<Map<string, MemoryPerformanceRaw>>;
  rebuildAll(): Promise<{ memoriesRebuilt: number }>;
}
```

Deliberately minimal — read-batch plus rebuild. **No `record*` method on the public interface**:
per F12, the write path lives inside `SqliteEventStore.recordFeedback`/`recordOutcome`'s own
transaction (§4), the same way `insertMutationEventRow` is called synchronously inside
`SqliteMemoryRepository`'s transaction today (`db.ts` pattern) rather than being a separate
interface method callers must remember to invoke.

---

## 3. Proposed migration `0007_memory_performance.sql`

Proposed content only, per this task's scope — not created on disk this session.

```sql
-- Phase 4.1. Materialized, rebuildable projection over feedback_events/outcome_events (F3/F11).
-- Raw counts only -- usefulnessSignal/evidenceMass are derived on read (packages/core/learning),
-- never stored, so a formula or K change never requires a migration or a data rebuild.

CREATE TABLE IF NOT EXISTS memory_performance (
  memory_id                TEXT NOT NULL REFERENCES memories(id) ON DELETE CASCADE,
  scope_key                TEXT NOT NULL DEFAULT '*',   -- '*' only in 4.1/4.2, see F8
  useful_count              INTEGER NOT NULL DEFAULT 0,
  not_useful_count          INTEGER NOT NULL DEFAULT 0,
  redundant_reason_count    INTEGER NOT NULL DEFAULT 0,
  incorrect_reason_count    INTEGER NOT NULL DEFAULT 0,
  diluted_success_evidence  REAL    NOT NULL DEFAULT 0,
  diluted_failure_evidence  REAL    NOT NULL DEFAULT 0,
  success_context_count     INTEGER NOT NULL DEFAULT 0,
  failure_context_count     INTEGER NOT NULL DEFAULT 0,
  labeled_context_count     INTEGER NOT NULL DEFAULT 0,
  last_feedback_at          TEXT    NULL,
  last_outcome_at           TEXT    NULL,
  PRIMARY KEY (memory_id, scope_key)
);

-- Batch read by candidate set is the only query shape MemoryPerformanceStore needs.
CREATE INDEX IF NOT EXISTS idx_memory_performance_memory ON memory_performance(memory_id);
```

Same `ON DELETE CASCADE` convention as `feedback_events`/`context_event_memories` — `purge()` must
remove a memory's performance row along with everything else about it. Rebuildable from raw events
by construction (F11) — dropping and recreating this table loses nothing `rebuildMemoryPerformance()`
can't regenerate exactly.

---

## 4. Event ingestion (F12)

`SqliteEventStore.recordFeedback`/`recordOutcome` (`packages/storage/src/event-store.ts:349-366`,
`330-347`) currently do a single `INSERT` each, no transaction. Both become two statements inside
one `db.transaction()`, mirroring `recordContext`'s existing atomicity pattern
(`event-store.ts:259-295`, P2-006):

```ts
async recordFeedback(event: Omit<FeedbackEvent, "id" | "timestamp">): Promise<FeedbackEvent> {
  const full: FeedbackEvent = { ...event, id: randomUUID(), timestamp: new Date().toISOString() };
  this.db.transaction(() => {
    insertFeedbackEventRow(this.db, full);                 // existing INSERT, extracted
    applyFeedbackToPerformance(this.db, full);              // NEW — upsert memory_performance deltas
  })();
  return full;
}
```

`applyFeedbackToPerformance`/`applyOutcomeToPerformance` are synchronous exported functions in
`memory-performance-store.ts`, the same shape as `insertMutationEventRow` — callable inside an
existing transaction, not a hidden side effect. `applyOutcomeToPerformance` must read the
outcome's `context_id`, look up `context_event_memories` for that context's `included=1` rows, and
apply **unweighted** dilution credit (`1 / includedCount`, F4) to each included memory's
`diluted_success_evidence`/`diluted_failure_evidence` — this is the one case where a single event
fans out to multiple `memory_performance` rows, still inside the same transaction.

**2026-09-04 correction — `outcomeWeight` is applied exactly once, on read, never at write time.**
An earlier draft of this section said the write path applied `outcomeWeight / includedCount`; §5
also applies `config.outcomeWeight` when computing `usefulnessSignal`, which would have applied the
weight twice whenever it's nonzero, and — worse — would have made the *default* `outcomeWeight: 0`
permanently discard the `1/includedCount` dilution mass at write time, so setting `outcomeWeight` to
something nonzero later would find nothing stored to weight. Storage persists dilution only
(`1/includedCount`, policy-free); `computeUsefulnessSignal` (§5) is the only place `outcomeWeight`
is ever read or applied. This is what makes F4's "changing `outcomeWeight` later needs no migration
or rebuild" claim actually true rather than aspirational.

**Recovery:** if this logic has a bug, F11's `rebuildAll()` recomputes every row from
`feedback_events`/`outcome_events`/`context_event_memories` from scratch and is defined to produce
identical output to a correct incremental path — ship the transactional write with confidence, not
because it's assumed bug-free, but because rebuild is the safety net either way.

---

## 5. `computeUsefulnessSignal` (pure, `packages/core/learning/src/aggregation.ts`)

Directly implements F4. No I/O, no DB — unit-testable in isolation like `computeScore`.

```ts
export function computeUsefulnessSignal(
  raw: MemoryPerformanceRaw,
  config: LearningConfig,
): CandidatePerformance {
  const positiveEvidence = raw.usefulCount + config.outcomeWeight * raw.dilutedSuccessEvidence;
  const negativeEvidence = raw.notUsefulCount + config.outcomeWeight * raw.dilutedFailureEvidence;
  const posterior = (positiveEvidence + 1) / (positiveEvidence + negativeEvidence + 2);
  const evidenceMass = positiveEvidence + negativeEvidence;
  const usefulnessSignal = 0.5 + (posterior - 0.5) * (evidenceMass / (evidenceMass + config.k));
  return { usefulnessSignal, evidenceMass };
}
```

Note `dilutedSuccessEvidence`/`dilutedFailureEvidence` are stored **already diluted** (§4 applies
`/includedCount` at write time, since that's when `includedCount` is known); `config.outcomeWeight`
is applied here, on read, so changing it from its shipped default of `0` (F4) never requires
touching stored data — only a config change and, per F10, an explicit decision to do so.

---

## 6. `LearningSignalService.decorate()` (I/O, `packages/core/learning/src/decorate.ts`)

```ts
export class LearningSignalService {
  // `config` is public/readonly so Gateway can read `enabled`/`maxBoost` off this one instance
  // to build rank()'s own `learning` field (§7) -- one source of truth, not a second copy of
  // LearningConfig threaded separately into Gateway's constructor.
  constructor(
    private readonly store: MemoryPerformanceStore,
    readonly config: LearningConfig,
  ) {}

  async decorate(candidates: Candidate[]): Promise<Candidate[]> {
    if (!this.config.enabled) return candidates;   // F10 -- true no-op, no store call at all

    let raw: Map<string, MemoryPerformanceRaw>;
    try {
      raw = await this.store.getPerformanceBatch(candidates.map((c) => c.memoryId));
    } catch (error) {
      // 2026-09-05: learning is optional retrieval enrichment, never a reason brain_context
      // fails. A performance-store read failure degrades to "no learning this call" --
      // logged, not thrown, not silently retried.
      console.warn("learning: performance store read failed, continuing without it:", error);
      return candidates;
    }

    return candidates.map((c) => {
      const row = raw.get(c.memoryId);
      if (!row) return c;   // no aggregate row -- cold start, performance stays absent
      return { ...c, performance: computeUsefulnessSignal(row, this.config) };
    });
  }
}
```

Matches E7's diagram exactly: I/O via the injected `MemoryPerformanceStore` interface (never a
concrete driver — D4), invoked by `Gateway`, never by `core/ranking`. Degradation matches this
pipeline's existing discipline everywhere else (vector search, redundancy detection, code/
dependency retrieval): a failure in an enrichment stage never fails the whole request.

---

## 7. `rank()` changes (`packages/core/ranking/src/rank.ts`)

`computeScore` (relevance) is **untouched** — no fourth weighted term, per F2's rejection of
mission option A. `rank()` gains its own explicit, independent activation gate (`input.learning`,
§2.3a) — **not** inferred from whether any candidate happens to carry a `performance` field, so
disabling learning is a single, testable boolean rather than "hope no one populates `performance`
by mistake":

```ts
const learningEnabled = input.learning?.enabled === true;
const maxBoost = input.learning?.maxBoost ?? DEFAULT_MAX_BOOST;

const scored = input.candidates.map((candidate) => {
  const base = computeScore(candidate.signals, weights);
  const perf = candidate.performance;
  const boost = learningEnabled && perf != null
    ? clamp(maxBoost * (perf.usefulnessSignal - 0.5) * 2, -maxBoost, maxBoost)
    : 0;
  return { candidate, score: base * (1 + boost) };
});
```

`input.learning` omitted entirely (every existing `rank({candidates, task})` call site, untouched)
behaves exactly as `{enabled: false}` — `learningEnabled` is `false`, `boost` is `0` for every
candidate, unconditionally, regardless of whether any candidate happens to carry a `performance`
field. This is the second of the design's two independent fail-safe layers (F10): Gateway not
decorating means no candidate ever *has* `performance`; `rank()` ignoring it when `learning` is
absent/disabled means even a stray populated field changes nothing. Either layer alone is
sufficient; both existing together is defense in depth, not redundant work.

`perf != null` deliberately catches both `undefined` and `null` in one check (loose equality against
`null`) — Task 8's contract makes both mean the same thing ("no learning signal"), and this is the
one place in the file that needs to say so.

`DEFAULT_MAX_BOOST = 0.15` lives in `score.ts` alongside `DEFAULT_RANKING_WEIGHTS`, the same
override pattern `weights` already uses. `core/ranking` gains a config *value*, never a config
*source* (no env read, no DB read; matches E7's "no new dependency" exactly). Tie-break logic
(`rank.ts:49-63`) is untouched — it already operates on the final `score`, which is now the boosted
one where applicable, so cold-start candidates (`boost === 0`) sort identically to today and the
existing confidence/memoryId tie-break chain needs no new tier.

**The actual worst-case non-reorder bound (2026-09-05 correction).** An earlier draft of this
section claimed "a base-score gap larger than `maxBoost`" is sufficient to prevent reordering. That
undercounts the worst case: it only moves the *lower*-scored candidate up, when the true worst case
moves both candidates in opposite directions at once — the higher-scored one penalized to its
floor, the lower-scored one boosted to its ceiling. With `maxBoost = m`, candidate A (higher base
score) is guaranteed to stay above candidate B (lower base score) under every possible pair of
`usefulnessSignal` values only when:

```
A * (1 - m) > B * (1 + m)      i.e.      A / B > (1 + m) / (1 - m)
```

For the shipped default `m = 0.15`, that ratio is `1.15 / 0.85 ≈ 1.3529` — **not** "any gap bigger
than 15%." A base-score gap between 15% and ~35% is *not* structurally protected and can be
reordered by a large enough opposite-signed `usefulnessSignal` pair; `PHASE_4_TASKS.md`'s test
matrix (items 15/34) covers both the guaranteed-safe case and the reorder-possible case explicitly,
rather than asserting a bound that doesn't hold. This is the actual worst-case guarantee — the
brief's own constraint ("cannot allow an unrelated low-relevance memory to outrank strongly
relevant results") is satisfied by choosing fixture/test relevance gaps that clear the *real*
`1.3529` ratio, not the originally-claimed, looser one.

---

## 8. `Gateway` wiring (`packages/gateway/src/gateway.ts`)

Two call sites, both already identified precisely by direct inspection:

- `getContext()`: between `const candidates = await this.retrieval.getCandidates(...)`
  (`gateway.ts:108`) and `rank({ candidates, task })` (`gateway.ts:115`) — insert
  `candidates = await this.learning.decorate(candidates)`.
- `search()`: same shape, `gateway.ts:489-498`.

Constructor gains `learning: LearningSignalService` alongside the existing `MemoryService`/
`RetrievalService`/`EventService` dependencies (`gateway.ts:18-24`) — same DI shape as everything
else Gateway already composes. **`Gateway.getCodeItems`'s separate `computeScore`-direct call path
(`gateway.ts:243-269`) is explicitly not touched** — code items have no performance data to attach
(F1), so this path is correctly left exactly as it is, not extended to a no-op branch it doesn't
need.

`packages/mcp/src/bootstrap.ts` wires `SqliteMemoryPerformanceStore` and `DEFAULT_LEARNING_CONFIG`
alongside the rest of the composition root's existing wiring — the one file allowed to import both
a core service and a concrete storage implementation (D4).

---

## 9. `rebuildMemoryPerformance()` (F11)

```ts
async rebuildAll(): Promise<{ memoriesRebuilt: number }> {
  // Inside one transaction: DELETE FROM memory_performance, then recompute every row from
  // feedback_events (grouped by memory_id, reason) + outcome_events JOIN context_event_memories
  // (grouped by memory_id, outcome), from scratch. No incremental state is read or trusted.
}
```

Acceptance test (mirrors E6's AT-7 exactly, directly reusable as a Phase 4.1 test): seed a set of
feedback/outcome events through the normal `recordFeedback`/`recordOutcome` path (incremental
update, §4), snapshot `memory_performance`, call `rebuildAll()`, assert the table is byte-identical
to the snapshot. This is the test that makes shipping a synchronous incremental writer (F12) safe.

---

## 10. Critical end-to-end test

Planned before any implementation, per the brief's explicit instruction and `BUILD_PLAN.md:276`'s
own standing risk mitigation ("write the end-to-end feedback test *before* the implementation, not
after"):

**Setup:** two memories, A and B, both genuinely relevant to one query (comparable
`lexicalScore`/`semanticScore`, so `computeScore(A) ≈ computeScore(B)` and baseline ranking is
determined by the existing tie-break, not a relevance gap). A third memory, C, clearly *not*
relevant to the query (large score gap below A/B).

**Baseline (`learning.enabled = false`):** run the query. Assert A/B/C order matches
`rank()`'s Phase-3 behavior exactly — this is also test item 11 in `PHASE_4_TASKS.md`'s matrix,
reused here as the control.

**Evidence phase:** record enough `FeedbackEvent`s (via the real `recordFeedback` path, not a
direct DB write) that B accumulates strong positive evidence (e.g. 10× `useful=true` across 10
distinct `contextId`s) and A accumulates strong negative evidence (10× `useful=false`,
`reason='irrelevant'`) — chosen to sit well past `K=5` on E5's own worked table so the effect is
not a rounding artifact.

**Enabled run (`learning.enabled = true`):** same query, same candidate pool. Required assertions:

1. B now ranks above A (the learned signal measurably changed the order).
2. C still ranks below both A and B — the bounded multiplier (§7) cannot lift an irrelevant
   candidate over a relevant one, verified concretely, not just argued from the bound.
3. Re-run with `learning.enabled = false` again (same process, same data): order reverts to
   exactly the baseline from step 1 — disabling is a true toggle, not a one-way migration.

This is the literal acceptance test `BUILD_PLAN.md:273` specified two phases ago, made concrete
against this repository's actual contracts and the F1–F15 design, plus the two extra assertions
(item 2, item 3) this audit's own risk analysis (bounded relevance, fail-safe toggle) requires
beyond the original one-line description.

---

## 11. Learning safety metrics (for Phase 4.3, defined now so 4.2 isn't built blind to them)

Reuses `packages/evaluation`'s existing `metrics.ts` (MRR/NDCG/P@K/R@K, already implemented, F15)
directly. New, learning-specific metrics, each defined so it needs no ground truth this system
doesn't already have:

- **Useful-memory precision/recall.** Over the historical corpus (`PHASE_4_FINDINGS.md`'s 269
  events): of memories `rank()` places above their baseline position after enabling learning, what
  fraction have positive net evidence (precision)? Of memories with strong positive evidence, what
  fraction moved up (recall)?
- **Harmful reorder count.** Defined narrowly, per the brief's own instruction not to invent a
  metric requiring causal ground truth this system doesn't have: a reorder is **harmful** only when
  a memory with `usefulnessSignal < 0.5` and `evidenceMass` above the corpus median outranks a
  memory with `usefulnessSignal > 0.5` and comparable baseline relevance (`computeScore` within
  `maxBoost`'s own bound of each other) after enabling learning. This is checkable mechanically
  against replay data — no outcome/causal claim required.
- **Cold-start reorder count.** Any reorder involving a candidate with `evidenceMass = 0`. Per F6
  this must always be exactly zero — a non-zero count is a correctness bug, not a tuning signal,
  and should fail CI, not just get reported.
- **False-promotion rate.** Fraction of enabled-vs-disabled reorders where the promoted memory's
  `reason` history (when `useful=false`) is dominated by `redundant` rather than `irrelevant`/
  `incorrect` — since F5/E14 route `redundant` to the redundancy model, not usefulness, a memory
  promoted mainly on the back of redundant-labeled evidence would indicate a wiring bug, not signal.

---

## 12. Phase 4.3/4.4 sketch (not specified in implementation detail — F14)

**4.3** extends `packages/evaluation` with a `learning` strategy alongside the existing
redundancy/code/dependency ones, runs it over `export.ts:exportFromEvents()`'s replay of the real
corpus (Layer 2), then a live pilot mirroring the Phase 2C/3.4 pilot format already proven in this
repository (Layer 3) — enabled vs. disabled, controlled configuration, comparing §11's metrics.
This is the gate for changing `learningRanking.enabled`'s default away from `false`, not 4.2's
merge.

**4.4** (promotion/demotion, real scheduler) is not designed here. `PHASE_4_TASKS.md` records it as
a placeholder milestone, explicitly conditional on 4.3's outcome, per F14.

**2026-09-06 — Phase 4.3 ran.** No design in this document changed — `docs/phase-4/PHASE_4_3_REPORT.md`
evaluated the policy specified here exactly as shipped, with no tuning. Verdict:
`NOT_ENOUGH_EVIDENCE` for default-enable (breadth/utility unmet, not correctness/safety); 4.4
remains not ready to scope.
