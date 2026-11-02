# Phase 2C Specification — Efficiency Measurement + Redundancy

Implementation-ready specification for Phase 2C. Phase 2A and Phase 2B are complete (see
`PHASE_2_READINESS.md` "Phase 2A Result" / "Phase 2B Result"). This document is the brief as given,
preserved verbatim for implementation reference — see `docs/archive/superpowers/plans/2026-08-20-phase-2c-efficiency-redundancy.md`
for the executable task breakdown.

## Purpose

> Measure real context efficiency, then determine whether redundancy-aware context selection improves
> context quality/token efficiency without changing relevance ranking or requiring adaptive learning.

**DO NOT implement historical-usefulness learning.**

---

## Current verified baseline

Phase 2A: P2-001, P2-002, P2-007, P2-008, P2-009 complete. Lexical relevance direction corrected;
lexical/semantic signals normalized. A′ fixed the observed Finding B failure without learning. Pure
evaluation harness exists.

Phase 2B: P2-003 (measurement contracts only), P2-004, P2-005, P2-006, P2-015 complete.
`ContextDelivery.contextId` implemented at Gateway level. `ContextPack` remains unchanged.
Feedback/outcomes may reference exact deliveries. Normalized context↔memory membership exists.
Per-item delivered token cost exists. Candidate-pool token cost exists.
Retrieval/ranking/compile/optimize timings exist. Migration loader supports multiple migrations.
Correlation verified over real MCP `InMemoryTransport`.

Verified at plan time (2026-08-20): 292 default tests, 292 pass, 0 fail. `npm run typecheck` PASS.
`npm run build` PASS. `npm audit` 0 vulnerabilities.

Phase 2A evaluation:

```
A:  MRR 0.889   NDCG@1 0.722
A': MRR 1.000   NDCG@1 1.000
```

Aggregate evaluation remains INDICATIVE due to small sample size.

## Critical non-goal

Do **not** implement: `UsefulnessStore`, `memory_usefulness_stats`, `historicalUsefulness`,
`usefulnessSampleCount`, `RankingWeights.usefulness`, `LearningSignalService`, adaptive ranking, UCB,
memory consolidation, automatic capture. P2-010, P2-011, P2-012 remain ON HOLD. Do not use "Phase 2 is
supposed to have learning" as justification.

## Read first

`BLUEPRINT.md`, `ARCHITECTURE.md`, `DECISIONS.md`, `PHASE_1_SPEC.md`, `PHASE_1_TASKS.md`,
`PHASE_2_FINDINGS.md`, `PHASE_2_DECISIONS.md`, `PHASE_2_SPEC.md`, `PHASE_2_TASKS.md`,
`PHASE_2_READINESS.md` — then the actual Phase 2A/2B implementation. **Actual code wins over stale
documentation.**

---

## Tasks in scope

1. Efficiency metrics in the evaluation harness.
2. P2-016 `exportFromEvents`.
3. Resolve and implement E25 (vector-access interface for redundancy).
4. P2-013 redundancy-pair detection.
5. P2-014 redundancy-aware context selection.
6. Evaluate A′ vs redundancy-aware strategy (C′).
7. Targeted acceptance/regression tests for the above.

Do **not** implement the full P2-019/P2-020 phase acceptance yet.

---

## 2C-001 — Efficiency metrics

Extend the pure evaluation harness to calculate:

```
contextEfficiency   = usefulDeliveredTokens / deliveredTokens
redundantRatio       = redundantDeliveredTokens / deliveredTokens
retrievalEfficiency  = deliveredTokens / candidateTokenCount
labeledFraction      = labeledDeliveredItems / deliveredItems
```

`labeledFraction` MUST accompany `contextEfficiency` and `redundantRatio`. Unlabeled memories are
UNKNOWN, not automatically useless. Never report "40% context efficiency means 60% waste" unless
`labeledFraction` is 1.0. If a denominator is zero or a measurement is unavailable, return an explicit
unavailable/null result rather than fabricating zero. Do not call `retrievalEfficiency` "tokens
saved" — it measures candidate-pool → delivered-context reduction only.

**Token semantics:** use Phase 2B's stored measurements; do not recompute with a different estimator.
Per-item token cost means delivered content. Candidate token cost means original candidate content
before compilation/token optimization. Keep these meanings distinct.

## 2C-002 — P2-016 `exportFromEvents`

Build evaluation examples from real correlated usage:

```
RetrievalEvent → ContextEvent → ContextEventMemory[] → FeedbackEvent[] → OutcomeEvent?
```

Produce evaluation examples without depending on a live production database — the evaluation package
may accept injected interfaces/data. Must NOT import storage, gateway, or MCP. No production package
may import evaluation.

**Label rules:**

```
useful=true                        → grade 2
useful=false + reason=irrelevant   → grade 0
useful=false + reason=incorrect    → grade 0
useful=false + reason=redundant    → redundancy relation, NOT evidence the memory is false
no feedback                        → unlabeled
```

Do not automatically infer labels from task success. Outcome may be attached as metadata; it does not
automatically label every included memory.

## 2C-003 — Resolve E25

Core must not receive raw embedding vectors. Expose a narrow semantic-similarity capability through
`RetrievalStore`:

```ts
type SimilarityPair = { a: string; b: string; similarity: number };
RetrievalStore.findSimilarPairs(memoryIds: string[], minSimilarity: number): Promise<SimilarityPair[]>;
```

Exact naming may change if repository conventions require it. Requirements: raw vectors remain inside
storage; core/retrieval receives only memory IDs + similarity; no sqlite-vec types leak into
contracts; no model-specific vector dimensions leak into contracts; local-first; vectors unavailable →
empty result, not a failed context request; deterministic ordering. Document the final decision.

**Scope:** similarity comparison operates ONLY on candidates that have already passed scope
authorization. Redundancy logic must never widen scope. A candidate from another project must never
become visible merely because it is similar. Scope remains an upstream authorization concern.

## 2C-004 — P2-013 redundancy detection

Use the E25 capability over the authorized candidate set. Known empirical example (real embedding
model, `PHASE_2_FINDINGS.md` §5): notes-api plural rule vs global plural rule ≈ cosine 0.785;
next-nearest genuinely different memory (repository/database constraint) ≈ 0.518. This is ONE
datapoint — do not hardcode 0.785, do not claim a statistically optimal threshold. Threshold must be
configurable. The evaluation harness should test candidate thresholds over a reasonable range and
report results.

**No destructive deduplication.** Redundancy means "this item adds little additional context here," not
"this memory should be deleted." No memory deletion, archive, merge, rewriting, or confidence changes.
Redundancy is a context-selection concern only.

## 2C-005 — P2-014 context redundancy

Keep `core/context` pure:

```
retrieval → ranked candidates → similarity/redundancy metadata → compileContext()
```

`compileContext()` receives precomputed redundancy information. It must NOT load vectors, access
storage, calculate embeddings, call sqlite, or call a model.

Behavior: non-redundant items retain normal ranking order; redundant items are demoted behind
non-redundant items; relative ordering within each group remains deterministic; redundant memories are
NOT deleted; under a large enough budget they may still appear; under pressure, redundant items should
be omitted before unique relevant context.

**Project vs global redundancy:** when two sufficiently similar memories represent substantially the
same information (one project-specific, one global), prefer the project-specific memory within that
redundancy cluster. Do NOT globally penalize global memories. This regression must continue to pass:
task-api has no project-specific naming rule, so the global REST naming rule is relevant and must
remain retrievable/usable when it is the only appropriate knowledge. No rule equivalent to "project
always beats global."

**Redundancy representation:** add only the minimum contract required now. If `ContextItem.redundantWith`
is added: optional; absent means normal/non-marked; points only to another memory in the same
authorized candidate context; never used as authorization; never persisted onto `MemoryRecord`. Update
strict contract tests.

## 2C-006 — Evaluate A′ vs redundancy strategy

Primary comparison: **A′** (correct relevance) vs **C′** (A′ + redundancy-aware context selection). A
may be retained as historical control. Compare ranking (Precision@K, Recall@K, MRR, NDCG@K) and
context (contextEfficiency, redundantRatio, retrievalEfficiency, labeledFraction). Redundancy selection
should ideally improve `redundantRatio` ↓ and `contextEfficiency` ↑ without materially degrading
Recall/MRR/NDCG. Do not adopt redundancy merely because it reduces tokens — quality preservation
matters.

**Constrained-budget test:** candidate set = [project-specific relevant memory, semantically redundant
global memory, another distinct relevant memory]; budget fits only two reasonably sized items. Expect:
project-specific and distinct relevant memories included, redundant global memory omitted. Then
increase the budget: the redundant memory may appear again. This proves demoted ≠ deleted.

**No-redundancy regression:** when candidate similarities are below threshold, Phase 2C context output
must be byte-equivalent to A′ behavior except for newly optional metadata fields. Do not reorder
ordinary candidate sets.

**Vector-degradation regression:** simulate unavailable vectors. Expect `findSimilarPairs → []`, then
the context pipeline behaves as A′. No agent-facing error, no request failure, no network fallback.

## Stopword issue — audit only

`buildFtsQuery()` ORs whitespace tokens including terms such as "the"/"API", which can pollute the
candidate pool. Do NOT silently solve this inside redundancy work. Audit it and produce a
recommendation; if clearly safe as a separate retrieval-quality task, propose `P2C-R1`. Do not
implement it unless absolutely required for the redundancy evaluation. Keep retrieval-candidate
quality separate from context redundancy.

## Real-world data growth

After `exportFromEvents` exists, report: how many correlated contexts currently exist; how many have
explicit feedback; how many useful/irrelevant/redundant/incorrect labels; how many outcomes
(success/failure/partial/unknown). Do NOT merge old uncorrelated Phase 1 events into attributed data —
historical events without `contextId` remain historical/unlinked. Do not fabricate linkage.

## Learning readiness check

At the end of Phase 2C, answer: "Is there now empirical evidence that historical usefulness should
affect ranking?", evaluated against the actual correlated corpus. "NO — still insufficient
observations" is a completely acceptable answer. Do not implement learning regardless of the answer.

---

## Acceptance

1. Efficiency metrics are computable from correlated events.
2. Every metric reports `labeledFraction` where required.
3. Real events can be exported into replayable evaluation examples.
4. Similarity computation does not leak raw vectors across the storage boundary.
5. Scope isolation remains unchanged.
6. The known project/global redundant pair is detectable under a harness-selected/configurable
   threshold.
7. Distinct repository/database knowledge is not falsely collapsed with the naming rule.
8. Under a constrained budget, redundant context loses before unique relevant context.
9. Redundant memories remain available with sufficient budget.
10. Missing vectors degrade exactly to A′.
11. A′ ranking metrics do not materially regress.
12. Default configuration requires zero network calls.
13. All Phase 2A and Phase 2B tests remain green.

## Verify

```bash
npm run typecheck
npm run build
npm test
npm audit
```

Report default vs network-requiring integration tests separately. Verify hashes or semantic
non-change for ranking scoring behavior, token budgeting, scope authorization, and the MCP
thin-adapter rule, unless an authorized Phase 2C contract addition necessarily changes an adjacent
file.
