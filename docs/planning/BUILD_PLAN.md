# Build Plan

Phase numbering follows `BLUEPRINT.md`'s own Development Phases section (Phase 0 through Phase 6) so this plan stays traceable to the authoritative architecture rather than introducing a parallel scheme. Phase 1 ("Brain Core") is large enough on its own that it is split into four sequential sub-milestones (1.1–1.4) for real incrementality — each is independently testable and independently useful before the next begins.

Every phase below specifies: objective, dependencies, components, packages/files, interfaces/contracts, data models, migrations, reused AEOS components, reused AEOS-brain components, rewritten components, discarded components, tests, evaluation, acceptance criteria, risks, expected token/cost impact, and what is explicitly not implemented yet.

Where later evidence corrected an original plan, the phase marks it inline as **Originally planned:** / **Shipped:** / **Reason:** — the plan is not rewritten as if it always predicted the final design.

**Package-boundary correction (applies throughout this document, not repeated per phase):** Phase 1's "Packages/files" lines below were originally written as `packages/core/src/<subsystem>/...`, implying one monolithic `packages/core` package with internal subsystem subfolders. **Shipped:** each Phase 1 subsystem is its own top-level npm package — `packages/core/<subsystem>/src/...` — with its own `package.json` (`@brain/contracts`, `@brain/memory`, `@brain/retrieval`, `@brain/ranking`, `@brain/context`, `@brain/compression`, `@brain/token`, `@brain/learning`, `@brain/test-fixtures`), matched by the root `package.json` workspaces glob `packages/core/*`. Reason: real per-package build/typecheck/test boundaries and independent versioning, not just cosmetic nesting — this is also what the Phase 2 CI import-boundary check enforces against. Individual file names below are otherwise as described except where a phase notes a specific correction.

---

## Milestone Summary

| Phase | Name | Status | Depends on | Produces |
|---|---|---|---|---|
| 0 | Architecture Audit | **COMPLETE** | — | This document and its six companions |
| 1.1 | Contracts + Storage Foundation | **COMPLETE** | 0 | Typed schema, SQLite/FTS5/sqlite-vec, local embeddings |
| 1.2 | Memory Layer | **COMPLETE** | 1.1 | Typed, scoped, audited memory CRUD + lifecycle |
| 1.3 | Retrieval + Ranking | **COMPLETE** | 1.2 | Multi-signal candidate generation, separate reranking stage |
| 1.4 | Context Compiler + Token Budgeting | **COMPLETE** | 1.3 | Budget-enforced `brain_context`-equivalent, in-process |
| 2 | MCP | **COMPLETE** | 1.1–1.4 | Brain Gateway + the 10 stable `brain_*` MCP tools |
| — | *Post-Phase-2 Hardening* (informal, not a Blueprint phase) | **COMPLETE** | 2 | Measurement/correlation infra, evaluation harness, redundancy research (shipped disabled) |
| 3 | Coding Intelligence | **NEXT / NOT STARTED** | 2 | Repository/doc/dependency indexing as a retrieval source |
| 4 | Learning | **NOT STARTED** — instrumentation prepared | 2 (benefits from 3) | Working end-to-end outcome-feedback loop, scheduled evaluation |
| 5 | Advanced Efficiency | **FUTURE** — some early research evidence exists | 4 | Predictive retrieval, caching, contradiction detection (scoped later) |
| 6 | Ecosystem | **FUTURE** | 1–2 minimum | SDK, CLI, dashboard, optional cloud sync (scoped later) |

The single highest-value milestone to watch closely is **Phase 4's end-to-end feedback test** (§Phase 4, Tests) — it directly targets the one failure mode both AEOS and AEOS-brain independently shipped.

---

## Current Roadmap Position

Official Phases 0–2 are complete and match `BLUEPRINT.md`'s Development Phases section exactly — this document does not introduce a competing numbering scheme.

The long **2A/2B/2C.x** sequence referenced in code comments, `PHASE_2_DECISIONS.md`, and `docs/phase-2c/PHASE_2C*_REPORT.md` is **post-Phase-2 hardening and evaluation work**, not a replacement phase-numbering system. It measured and corrected Phase 2's Gateway (retrieval normalization, event correlation, token accounting) and ran extensive redundancy/deduplication research. None of it is an official Blueprint phase; it is grouped below as "Post-Phase-2 Hardening."

- **Redundancy stays disabled.** `RedundancyConfig.enabled = false` in both `packages/gateway/src/gateway.ts`'s default and `packages/mcp/src/bootstrap.ts`'s composition root. Organic evaluation (2C.8, 2C.11) found confirmed, context-impacting false positives, most recently on fresh content. The detection infrastructure is preserved for future Phase 5 work, not deleted.
- **Phase 3 — Coding Intelligence is the active next milestone.** No `packages/codebase` (or equivalent) exists yet.
- **Phase 4 — Learning waits for richer real usage.** Feedback/outcome instrumentation exists and is exercised (see Phase 4, below), but no aggregation, promotion, or ranking-feedback code exists yet, and current outcomes are heavily success-skewed.

```
Phase 0          COMPLETE
Phase 1          COMPLETE
Phase 2          COMPLETE
Post-2 hardening COMPLETE
        |
        v
Phase 3          NEXT
        |
        v
Phase 4
        |
        v
Phase 5
        |
        v
Phase 6
```

---

## Phase 0 — Architecture Audit

- **Objective:** Understand AEOS and AEOS-brain as built (not as documented), decide what's reusable, define the target architecture, produce a controlled implementation plan.
- **Status: COMPLETE.** This document and `AUDIT_AEOS.md`, `AUDIT_AEOS_BRAIN.md`, `AEOS_COMPARISON.md`, `MERGE_MATRIX.md`, `ARCHITECTURE_REVIEW.md`, `IMPLEMENTATION_READINESS.md` are its output.
- **Dependencies:** None.
- **Components / packages/files / interfaces / data models / migrations:** N/A — research phase, no code.
- **Reused AEOS / AEOS-brain components:** N/A.
- **Rewritten / discarded components:** N/A.
- **Tests:** N/A.
- **Evaluation:** Human review of the 7 produced documents.
- **Acceptance criteria:** Explicit human approval to begin Phase 1.
- **Risks:** The audits are static-reading-only (no code executed) — residual risk that some runtime behavior differs from what the source suggests. Carried forward as a general caveat, not a blocker.
- **Token/cost impact:** Already spent producing these documents; zero ongoing runtime cost.
- **Explicitly not implemented yet:** Everything. No Brain code exists.

---

## Phase 1.1 — Contracts + Storage Foundation

- **Objective:** Establish the typed data model and the local storage substrate every later phase builds on.
- **Status: COMPLETE.**
- **Dependencies:** Phase 0 approved.
- **Components:** `packages/core/contracts` (Zod schemas for the 12 memory types + scope model); `packages/storage` (SQLite init, WAL, FTS5 virtual tables, sqlite-vec extension, local embedding provider behind a swappable interface).
- **Packages/files:** `packages/core/src/contracts/{memory-types.ts, scope.ts, index.ts}`; `packages/storage/src/{db.ts, schema.ts, migrations/, embeddings/local-provider.ts, embeddings/provider-interface.ts}`.
- **Interfaces/contracts to freeze:** `MemoryRecord` (id, type [12-value enum], scope, scope_id, content, confidence, source, provenance, created_at, updated_at, status); `ScopeRef` (kind: `global`|`project`|`session` for Phase 1 — see `ARCHITECTURE_REVIEW.md §4.1`; value); `EmbeddingProvider.embed(text): number[]`.
- **Data models:** One `memories` table with a `type` discriminator column (following AEOS-brain's validated unification pattern rather than AEOS's split `patterns`/`artifacts`/`memory` tables); FTS5 shadow table; `vec0` virtual table via sqlite-vec.
- **Migrations:** `0001_initial_schema` — migration-first `.sql` files with a typed loader as the **single** source of schema truth (avoiding AEOS's two-unsynchronized-paths defect, `AUDIT_AEOS.md §9`).
- **Reused AEOS components:** `db.ts`/WAL/FTS5 setup pattern (ADAPT); `sqlite-vec.ts` (ADAPT); `embeddings.ts` local-transformer pattern (ADAPT); Zod-schema-as-contract pattern (ADAPT, fixed to `.strict()` to prevent AEOS's silent field-drop bug, `AUDIT_AEOS.md §8`).
- **Reused AEOS-brain components:** Unified single-table-with-type-discriminator design principle (ADAPT, conceptual only — the Postgres SQL itself is not portable).
- **Rewritten components:** Schema governance process (single source of truth, not two independently-maintained paths).
- **Discarded components:** turbovec; Postgres/Supabase-specific schema.
- **Tests:** Schema creation from empty DB; round-trip write/read for each of the 12 memory types; FTS5 query returns expected rows on a fixture; vector similarity search returns the expected nearest neighbor on a fixture; embedding-provider-interface swap test (a fake provider implementing the interface works end to end).
- **Evaluation:** N/A yet — no retrieval layer to measure. This phase is evaluated by test pass/fail only.
- **Acceptance criteria:** A memory record of each of the 12 types can be written and read back exactly via the contracts layer; FTS5 and vector search both return correct results against a fixture dataset; zero external network calls required for any of the above.
- **Risks:** `sqlite-vec`'s native extension can be platform-fragile across Windows/Mac/Linux. Mitigation: keep AEOS's tier-3 in-process-cosine fallback pattern so the system still functions if the extension fails to load.
- **Token/cost impact:** Zero runtime model-token cost. Local embedding model adds a one-time download (~90MB class) and CPU cost per write; no per-call API cost.
- **Explicitly not implemented yet:** Retrieval, ranking, context compilation, MCP surface, learning/feedback, codebase intelligence.

---

## Phase 1.2 — Memory Layer

- **Objective:** Typed, scoped memory CRUD with lifecycle management, on top of Phase 1.1's storage.
- **Status: COMPLETE.**
- **Dependencies:** Phase 1.1 complete.
- **Shipped correction:** `packages/knowledge` (`@brain/knowledge`) — an AEOS YAML seed-corpus importer sitting on top of `MemoryService`, per `PHASE_1_SPEC.md`'s dependency rules — was not called out as its own package in this document's original package list. It writes exclusively through `MemoryService` (never storage/SQL directly) and is idempotent (`seed-id:<id>` tag, upsert on changed content, skip on unchanged).
- **Components:** `packages/core/memory` — create/read/update/soft-delete, lifecycle state machine, per-write provenance/audit log.
- **Packages/files:** `packages/core/src/memory/{service.ts, lifecycle.ts, provenance.ts}`.
- **Interfaces/contracts:** `MemoryService.{create,get,update,archive,forget}(...)`; lifecycle states `Candidate → Validated → Active → {reused|strengthened|weakened|stale} → Archived` (per `ARCHITECTURE.md §19`).
- **Data models:** Adds lifecycle/status columns plus a `memory_audit_log` table — one row per mutation, fixing the "no audit trail for manual edits" gap found in AEOS-brain (`AUDIT_AEOS_BRAIN.md §5`, `MERGE_MATRIX.md`).
- **Migrations:** `0002_lifecycle_and_audit`.
- **Reused AEOS components:** Tiered-promotion threshold shape from `runKnowledgeAging` (ADAPT, made config-driven instead of hardcoded).
- **Reused AEOS-brain components:** Status-tier model + `aging_actions`-style audit log (ADAPT); the unify-into-one-surface principle (ADAPT).
- **Rewritten components:** Audit logging, extended to cover manual edits too (neither predecessor did this fully).
- **Discarded components:** None new in this phase.
- **Tests:** Lifecycle-transition tests (legal transitions succeed; illegal ones are rejected — addressing `mcp-contracts`'s unvalidated-transition weakness, `AUDIT_AEOS.md §26`); every mutation produces exactly one audit-log row; `forget()` removes retrievability while preserving the audit trail.
- **Evaluation:** N/A — no retrieval yet.
- **Acceptance criteria:** Every write/update/delete is attributable (who/what/when/why) via the audit log; illegal lifecycle transitions are rejected, not silently applied.
- **Risks:** Getting the lifecycle state machine wrong early is expensive to migrate later. Mitigation: keep the evidence-backed 3-tier-plus-archive shape both predecessors converged on, rather than over-designing beyond what either needed.
- **Token/cost impact:** None — no model calls in this phase.
- **Explicitly not implemented yet:** Retrieval, ranking, MCP surface, automated promotion/demotion (the state machine exists; nothing yet decides when to transition — that's Phase 4).

---

## Phase 1.3 — Retrieval + Ranking

- **Objective:** Multi-signal candidate generation, with reranking as an explicitly separate stage (addressing AEOS's "folded into one weighted-sum pass" weakness, `AUDIT_AEOS.md §11`).
- **Status: COMPLETE.**
- **Dependencies:** Phase 1.2 complete.
- **Components:** `packages/core/retrieval` (lexical/FTS5, semantic/vector, tag/metadata filters — candidate pool only); `packages/core/ranking` (relevance/usefulness/confidence/scope/freshness/diversity/exploration reranking, as a separate pass).
- **Packages/files:** `packages/core/src/retrieval/{candidates.ts, lexical.ts, semantic.ts}`; `packages/core/src/ranking/{rerank.ts, exploration.ts, diversity.ts}`.
- **Interfaces/contracts:** `RetrievalQuery{text, scope, filters, limit} → Candidate[]`; `RerankInput{candidates, task, weights} → RankedResult[]` — two separate function calls, never one pass.
- **Data models:** Adds the retrieval telemetry table — logged automatically, matching the one part of the learning loop both predecessors got right. *(Corrected per E24: shipped as `retrieval_events` (plus `context_events`), created inside `0001_initial_schema.sql`, not as a later standalone migration. Documentation only, no code behaviour changed.)*
- **Migrations:** none separate — the event tables ship in `0001_initial_schema.sql`.
- **Reused AEOS components:** `hybridSearch()`'s signal set and "never throws, degrades gracefully" discipline (ADAPT); `ranking.ts`'s UCB1 exploration formula (ADAPT, config-driven); `diversity.ts` (**INVESTIGATE** — read directly before deciding scope, per `MERGE_MATRIX.md`).
- **Reused AEOS-brain components:** `match_memories`'s weighting as a cross-check on AEOS's weights (ADAPT, conceptual only).
- **Rewritten components:** None — primarily ADAPT work.
- **Discarded components:** turbovec fallback tier (sqlite-vec is the only vector path, per `MERGE_MATRIX.md`).
- **Tests:** Fixture query with a known-correct expected result returns it in the top-K; degradation test (vector index unavailable → falls back to FTS5-only without throwing); reranking demonstrably changes order relative to raw retrieval on a fixture where confidence/freshness matter.
- **Evaluation:** AEOS's `evaluation.ts` (Precision@K/Recall@K/NDCG/MRR, ADAPT) is ported and run here for the first time, against a fixture dataset.
- **Acceptance criteria:** Retrieval meets a defined minimum Precision@5 on the fixture query set; reranking is demonstrably a separate, skippable stage (candidate generation alone still returns a usable, unranked result).
- **Risks:** No real usage history yet, so performance/exploration scoring has nothing to learn from. This is expected cold-start behavior — flag it so Phase 1.4/Phase 4 don't assume a warm ranking signal exists.
- **Token/cost impact:** Local/free — no LLM calls in retrieval itself.
- **Explicitly not implemented yet:** Context compilation, token budgeting, MCP surface, outcome feedback (retrieval is logged; nothing reads it back into ranking yet — that's Phase 4).

---

## Phase 1.4 — Context Compiler + Token Budgeting

- **Objective:** Turn ranked candidates into an agent-ready, budget-enforced context pack — the piece neither predecessor built at all.
- **Status: COMPLETE.**
- **Dependencies:** Phase 1.3 complete.
- **Components:** `packages/core/context` (dedup + assembly, budget-free); `packages/core/compression` (truncation only); `packages/core/token` (estimation + hard enforcement, the single budget-enforcement point). *(Corrected per E24: shipped as three separate packages, matching `ARCHITECTURE.md`/`BLUEPRINT.md`'s own suggested layout and the correction already recorded in `PHASE_1_SPEC.md`. Conflict detection/flagging was not built in Phase 1. Documentation only, no code behaviour changed.)*
- **Packages/files:** `packages/core/src/context/{compiler.ts, dedup.ts, conflicts.ts, compress.ts}`; `packages/core/src/token/{budget.ts, estimator.ts}`.
- **Interfaces/contracts:** `ContextRequest{task, scope, budget:{maxTokens}, agentCapabilities} → ContextPack{items, tokenCount, truncated}` — the actual implementation behind what Phase 2 will expose as `brain_context`.
- **Data models:** None new — operates on Phase 1.3's ranked output in memory.
- **Migrations:** None.
- **Reused AEOS components:** `CONTEXT_BUDGET_SAFE_FIELDS` allowlist concept (**REWRITE** — must be called on every exit path this time, not defined-and-unused as in AEOS, `AUDIT_AEOS.md §17`, `ARCHITECTURE_REVIEW.md §2.2`).
- **Reused AEOS-brain components:** "Keep what you store/return small" discipline as informing precedent, not code (AEOS-brain's own formatting is templated, not budget-aware, `AUDIT_AEOS_BRAIN.md §14`).
- **Rewritten components:** Token budget enforcement, built fresh as load-bearing code.
- **Discarded components:** None.
- **Tests:** A context request with a small budget is provably truncated to fit and never exceeds it; an impossible budget (smaller than one minimal item) fails predictably rather than silently over-returning; conflicting candidates are flagged, not silently both included; duplicates are merged.
- **Evaluation:** `ARCHITECTURE.md §22` token-efficiency metrics (context tokens, useful/total ratio) become measurable for the first time here, against the fixture set.
- **Acceptance criteria:** **No context pack returned by this layer ever exceeds its requested token budget** — proven by test, not asserted by convention. This is the hard boundary from `ARCHITECTURE.md §12`.
- **Risks:** Token estimation accuracy without a real tokenizer for every possible downstream model. Mitigation: conservative overestimate, never optimistic — exceeding budget is the failure mode that matters.
- **Token/cost impact:** This phase makes every later phase's token cost measurable and controllable; no direct model cost itself.
- **Explicitly not implemented yet:** MCP/SDK/CLI surface (Phase 2), outcome feedback wired to ranking (Phase 4), codebase intelligence (Phase 3).

---

## Phase 2 — MCP

- **Objective:** Expose Phase 1's Core services through the stable, thin `brain_*` MCP surface, in front of a real Brain Gateway.
- **Status: COMPLETE.**
- **Dependencies:** Phase 1.1–1.4 complete.
- **Components:** Brain Gateway (identity/session/scope/budget/permission resolution — **request-scoped, never module-scoped**, directly avoiding AEOS-brain's `currentAgentScope` race condition, `AUDIT_AEOS_BRAIN.md §20`); MCP Adapter (`brain_context`, `brain_recall`, `brain_search`, `brain_remember`, `brain_update`, `brain_forget`, `brain_feedback`, `brain_record_outcome`, `brain_status`, `brain_project`).
- **Packages/files — originally planned:** `packages/gateway/src/{session.ts, context-resolution.ts}`; `packages/mcp/src/{server.ts, tools/*.ts}`.
  **Shipped:** `packages/gateway/src/{gateway.ts, types.ts, errors.ts, index.ts}` — session/scope/budget resolution lives directly on the `Gateway` class rather than split into separate `session.ts`/`context-resolution.ts` files. `packages/mcp/src/{server.ts, schemas.ts, bootstrap.ts, index.ts}` — the 10 tool handlers are defined in `server.ts`/`schemas.ts` directly; there is no separate `tools/*.ts` split.
  **Reason:** the class stayed small enough end-to-end (request-scoped by construction, per the objective above) that the extra file split wasn't load-bearing; verified all 10 `brain_*` names are present and wired in `server.ts`.
- **Interfaces/contracts:** The 10 `brain_*` operations — request/response shapes **frozen here** (see `IMPLEMENTATION_READINESS.md §8`); MCP tool schema definitions.
- **Data models — originally planned:** a persisted `sessions` table.
  **Shipped:** no `sessions` table exists. Session/scope context is resolved per-request, in-memory, on the `Gateway` instance — consistent with "request-scoped, never module-scoped" above, and sufficient for the current single-process deployment.
- **Migrations — originally planned:** `0004_sessions` (if persisted).
  **Shipped:** not created — see Data models correction above. Only `0001_initial_schema.sql` and `0002_phase2_measurement.sql` exist in `packages/storage/migrations` as of this document (the latter is post-Phase-2 hardening, see below, not a Phase 2 deliverable itself).
- **Reused AEOS components:** The 4 clean thin-adapter servers as an internal pattern reference (ADAPT — pattern only, never code).
- **Reused AEOS-brain components:** The 5-tool surface as a naming/shape reference for `brain_remember`/`brain_recall`/`brain_feedback` (ADAPT — shape only; its implementation has a race condition and embedded business logic and must not be ported).
- **Rewritten components:** `aeos-mcp-server`'s handlers — logic moved into Gateway/Core, race condition eliminated by construction.
- **Discarded components:** AEOS's 10-server topology; AEOS's `mcp-config.json` format.
- **Tests:** The CI import-boundary check proposed in `ARCHITECTURE_REVIEW.md §2.1` (fails the build if `packages/mcp` imports anything beyond Core's public API + the MCP SDK); a concurrency test with overlapping requests under different scopes proving no cross-request bleed (directly targeting AEOS-brain's bug class); one end-to-end test per `brain_*` operation.
- **Evaluation:** Latency and tool-call-success-rate become measurable for the first time (`ARCHITECTURE.md §22` Efficiency metrics).
- **Acceptance criteria:** A real external MCP client can call all 10 operations against a running Brain instance and get correct, budget-respecting responses; concurrent requests from different scopes never cross-contaminate.
- **Risks:** First point where vendor-specific assumptions could creep in. Mitigation: test against at least two different MCP client shapes before considering the surface stable.
- **Token/cost impact:** MCP transport is free; this phase makes the Brain callable, so real usage-driven cost measurement becomes possible.
- **Explicitly not implemented yet:** Codebase intelligence, outcome-feedback-driving-ranking (`brain_feedback` is callable and logs, but ranking doesn't read it back yet — Phase 4), SDK/CLI adapters. See "Post-Phase-2 Hardening" below for the substantial measurement/evaluation work completed on top of this phase before Phase 3 began.

---

## Post-Phase-2 Hardening — COMPLETE (informal, not a Blueprint phase)

- **What this is:** after Phase 2 shipped, a long sequence of work — referred to in code comments, `PHASE_2_DECISIONS.md`, and reports as "Phase 2A/2B/2C.x" — measured, corrected, and stress-tested the Gateway, and separately researched semantic/lexical redundancy detection. **This is not an official Blueprint phase and does not get a number** — it sits between Phase 2 and Phase 3 in execution order only. Detail lives in `PHASE_2_DECISIONS.md` (decisions E1–E25) and `docs/phase-2c/PHASE_2C*_REPORT.md`; this section records the outcome, not the process.
- **Dependencies:** Phase 2 complete.
- **Shipped:**
  - **Retrieval normalization corrected** (scope-aware redundancy orientation, `packages/core/retrieval/src/service.ts`).
  - **Evaluation harness** — new `packages/evaluation` (`@brain/evaluation`) package: precision/recall/classification metrics, efficiency metrics, redundancy benchmark/boundary/gate tests, hand-labeled datasets (`redundancy-pairs-dataset.ts`, `h2-full-corroboration.data.ts`, `hybrid-classifier-regression.data.ts`).
  - **`ContextEvent`/`ContextEventMemory` correlation** — migration `0002_phase2_measurement.sql` adds the `context_event_memories` junction table (normalizing what were previously unindexable JSON arrays) plus `context_id` correlation columns on `feedback_events`/`outcome_events`.
  - **Feedback/outcome correlation** — `brain_feedback`/`brain_record_outcome` events now link back to the exact `ContextEvent` that delivered the memory (`context_id`), not just a loose `task_id`.
  - **Token accounting** — delivered (not just candidate-pool) token cost recorded per memory per context; verified exact (`sum(context_event_memories.token_count WHERE included=1) == context_events.token_count`) in live pilots.
  - **Efficiency metrics** — per-stage timings (`retrieval_ms`, `ranking_ms`, `compile_ms`, `optimize_ms`) on `context_events`.
  - **Redundancy/near-duplicate detection subsystem** — `packages/core/retrieval/src/{redundancy.ts, lexical-containment.ts}`: cosine-similarity candidate pairing, a lexical-containment layer, a hybrid policy, and the "H2 full-corroboration" classifier (`cosine ≥ candidateFloor(0.75) AND containment ≥ containmentThreshold(0.40)`, no unconditional cosine-only bypass). Wired into `Gateway.getContext` via `RetrievalService.getRedundancyPairs`, gated entirely behind `RedundancyConfig.enabled`.
- **Redundancy decision — DISABLED BY DEFAULT:**
  - `RedundancyConfig.enabled = false` at both `packages/gateway/src/gateway.ts`'s default constructor parameter and `packages/mcp/src/bootstrap.ts`'s composition root. With the flag off, `getContext` output is byte-identical to pre-redundancy behavior.
  - Across 11+ evaluation reports (`docs/phase-2c/PHASE_2C_PILOT_REPORT.md` through `docs/phase-2c/PHASE_2C11_REPORT.md`), every phase's verdict on "enable by default?" was **NO**. Detection quality improved steadily (scope-aware orientation → threshold characterization → boundary validation → lexical containment → hybrid policy → H2 full-corroboration), but organic (real, unengineered) evaluation kept finding confirmed, context-impacting false positives — most recently in `docs/phase-2c/PHASE_2C11_REPORT.md`, on fresh content H2 had never seen.
  - The infrastructure is **preserved, not deleted** — treat it as experimental/opt-in research pending Phase 5. No further Phase-2-hardening redundancy tuning is currently scheduled. See "Phase 5 — Advanced Efficiency" below for the evidence summary.
- **Tests:** `packages/evaluation` test suite (metrics, classification, redundancy gate/benchmark/boundary, H2 regression); live A/B pilots comparing redundancy-enabled vs. disabled `getContext` output at matched task/budget, recorded in the `docs/phase-2c/PHASE_2C*_REPORT.md` series.
- **Acceptance criteria:** measurement infrastructure (event correlation, token accounting, efficiency metrics) is exact and regression-tested; the redundancy default-enable question has a clearly evidenced NO, not an unresolved one.
- **Explicitly not implemented yet:** redundancy enabled by default; any learning/aggregation on top of the new measurement data (that's Phase 4).

---

## Phase 3 — Coding Intelligence

- **Objective:** Repository indexing, symbol/file context, documentation indexing, project state — as an additional retrieval *source*, not a separate system.
- **Status: NEXT / NOT STARTED.** No `packages/codebase` (or equivalent) exists in the repository as of this document.
- **Dependencies:** Phase 2 complete (satisfied).
- **Sub-milestones (implementation subdivision only — the official Blueprint phase remains Phase 3, not renumbered):**
  - **3.1 Repository Foundation** — repository/project registration; file inventory; language/path metadata; content hashing; incremental indexing; ignore rules; deterministic chunk storage.
  - **3.2 Code Retrieval** — code chunks become a retrieval source; lexical + semantic code retrieval; project-scope isolation; no separate agent-facing code-search architecture (reuses Phase 1.3's retrieval/ranking, not a parallel system).
  - **3.3 Dependency Intelligence** — initial static import/dependency graph; "what depends on this?"; "what could break if changed?"; regex/static parsing acceptable initially; AST precision explicitly deferred.
  - **3.4 Context Integration** — code candidates participate in normal Brain context generation; memory + knowledge + code share ranking/context/token budgeting; relevant files/chunks/dependencies fit within the existing `ContextPack` budget.
- **Non-goals (explicitly not required to start this phase):** full AST semantic understanding; architecture inference; automatic code rewriting; test-impact prediction; LSP implementation; remote repository crawling; cloud indexing; LLM-required indexing; a second, code-specific MCP architecture. Local-first, zero-required-network-calls remains invariant (`DECISIONS.md` D3).
- **Components:** `packages/codebase` — offline indexer + artifact store, read by Phase 1.3's retrieval layer.
- **Packages/files:** `packages/codebase/src/{indexer.ts, chunker.ts, dependency-graph.ts}`.
- **Interfaces/contracts:** `CodebaseIndex.query(scope, filters) → CodeCandidate[]`, feeding the same `Candidate[]` shape Phase 1.3 already defined.
- **Data models:** `code_chunks`, `file_metadata`, `dependency_edges`.
- **Migrations:** next available number after `0002_phase2_measurement.sql` (originally planned as `0005_codebase_intelligence`, back when Phase 2's session/learning migrations were expected to consume `0003`/`0004` first — see Phase 2/Phase 4 corrections above for why they didn't).
- **Reused AEOS components:** The offline-indexer-writes-artifacts/adapter-reads-them pipeline shape (ADAPT — the best cross-language integration either predecessor achieved, `AUDIT_AEOS.md §22-23`); dependency-graph regex extractor (ADAPT).
- **Reused AEOS-brain components:** None (AEOS-brain has no codebase intelligence, `AUDIT_AEOS_BRAIN.md §15`).
- **Rewritten components:** None required for this phase; regex-based chunking is accepted as a documented limitation, not blocking.
- **Discarded components:** AEOS's turbovec-dependent code-search fallback — replaced by sqlite-vec, which has no such gap.
- **Tests:** Indexing a fixture repository produces expected chunks/dependencies; dependency queries (`what_breaks_if_changed`-style) return correct results; re-indexing after a file change updates rather than duplicates.
- **Evaluation:** Retrieval precision on code-specific queries, measured the same way as Phase 1.3, on a code-focused fixture set.
- **Acceptance criteria:** A code-related task context request returns relevant file/symbol/dependency information within budget, sourced through the same Context Compiler as any other memory type.
- **Risks:** Regex-based chunking will misparse some language constructs. Mitigation: document known limitations rather than silently returning wrong results; AST-based chunking is an explicit future upgrade (`ARCHITECTURE_REVIEW.md §10`), not required here.
- **Token/cost impact:** Indexing runs locally, no model cost; may add meaningful one-time CPU/disk cost for large repositories.
- **Explicitly not implemented yet:** Everything — this phase has not started. Symbol-level (AST-precise) retrieval, change-aware/test-aware context, repository architecture inference remain *future* even once it does, per `ARCHITECTURE.md §18`.

---

## Phase 4 — Learning

- **Objective:** Close the loop both predecessors left broken. Retrieval telemetry already exists (Phase 1.3); this phase makes outcome feedback actually drive ranking, and schedules evaluation.
- **Status: NOT STARTED — instrumentation prepared.** Do not confuse the instrumentation below with Learning being complete.
- **Dependencies:** Phase 2 complete (needs `brain_feedback`/`brain_record_outcome` callable — satisfied). Benefits from Phase 3 but doesn't strictly require it.
- **Readiness notes (verified against the repository):**
  - Feedback/outcome instrumentation already exists and is exercised: `RetrievalEvent`, `ContextEvent`, `ContextEventMemory`, `FeedbackEvent`, `OutcomeEvent` (`packages/core/contracts/src/events.ts`) and the callable `brain_feedback`/`brain_record_outcome` MCP tools. **These are prerequisite instrumentation, not Learning itself.**
  - Exact `ContextEvent` correlation exists (post-Phase-2 hardening, above): every feedback/outcome event links to the precise `context_id` that delivered the memory.
  - `packages/core/learning`'s `EventService` (`service.ts`) is presently a thin pass-through to `EventStore` — record-only. Its own doc comment names this explicitly: Phase 4 "adds real aggregation logic (usefulness scores, promotion signals) ON TOP of this same class." No `performance_metrics`, `promotion_log`, or `demotion_log` table or code exists yet, and `packages/core/ranking` reads no performance/feedback signal today.
  - The real usage dataset has grown (post-Phase-2 hardening pilots, 2C.4/2C.7/2C.8/2C.11), but recorded outcomes are **heavily success-skewed** (e.g. 2C.11: 25/25 real task contexts `outcome: success`) — there is little failure signal yet to learn a contrast from.
  - Adaptive ranking remains **intentionally disabled**; Phase 3 should generate richer, more varied real coding-retrieval evidence (including some non-trivial failure/partial outcomes) before this phase is scoped in detail.
  - **2026-09-03 scoping-session correction:** the dataset has grown further (60 outcomes, still 100% `success`, zero variance — the precondition above remains unmet, not resolved by volume alone) and Phase 3.4 added a sixth event shape, `ContextEventSource`/`context_event_sources` (`packages/core/contracts/src/events.ts`), not listed above — any aggregation design must account for it even though it currently holds zero rows in production. Full audit: `PHASE_4_FINDINGS.md`. Detailed design supersedes this section's sketch without replacing it: `PHASE_4_DECISIONS.md`, `PHASE_4_SPEC.md`, `PHASE_4_TASKS.md`, `PHASE_4_READINESS.md`.
- **Components:** `packages/core/learning` — outcome ingestion, aggregation into performance scores, promotion/demotion automation, scheduled evaluation.
- **Packages/files — originally planned:** ~~`packages/core/src/learning/{outcomes.ts, aggregation.ts, promotion.ts, scheduler.ts}`~~ **[2026-09-03 correction: wrong path — the actual package root is `packages/core/learning/`, no nested `src/learning`; see `PHASE_4_SPEC.md` §1 for the corrected, current layout.]**
  **Shipped so far:** `packages/core/learning/src/{service.ts, index.ts}` only — the record-only `EventService` described above. The aggregation/promotion/scheduler files do not exist yet; they are this phase's actual work.
- **Interfaces/contracts:** `brain_feedback`/`brain_record_outcome` handlers (named in Phase 2's frozen surface) get their real implementation, writing to performance aggregates that Phase 1.3's ranking reads back.
- **Data models:** `performance_metrics` (use_count, success_count, review_sum — **this time actually populated**, directly targeting the exact failure both predecessors had); `promotion_log`/`demotion_log`. None of these exist yet.
- **Migrations:** ~~next available number (originally planned as `0006_learning`...)~~ **[2026-09-03 correction: 0006 was consumed by Phase 3.4's `context_sources.sql` (applied 2026-09-01). Next available is `0007` — see `PHASE_4_SPEC.md` §3 for the proposed `0007_memory_performance.sql` contents.]**
- **Reused AEOS components:** `runKnowledgeAging` threshold shape (ADAPT, config-driven); `oii.ts`'s anti-gaming composite-metric principle (ADAPT); `evaluation.ts` (ADAPT, now actually scheduled).
- **Reused AEOS-brain components:** Status-tier promotion thresholds as a cross-validation data point (ADAPT, conceptual); the scheduled-background-job discipline — proven to actually run in production via AEOS-brain's own execution log (ADAPT as a *pattern*: use a real scheduler, verify it fires, don't just write a script and hope someone runs it).
- **Rewritten components:** The entire outcome-ingestion-to-ranking-feedback path, built as new load-bearing code — this is the component marked REWRITE in `MERGE_MATRIX.md` and flagged as the top risk in `ARCHITECTURE_REVIEW.md §2.2`.
- **Discarded components:** AEOS's disagreeing duplicate scoring formulas; AEOS-brain's disagreeing duplicate OII calculations — one canonical formula this time.
- **Tests:** **End-to-end test: call `brain_feedback` for a specific memory, then call `brain_recall` for a query that memory matches, and assert its ranking measurably changed.** This directly targets the failure mode both predecessors shipped. Plus: promotion/demotion transition tests; scheduled evaluation actually runs on its configured interval (verified, not assumed).
- **Evaluation:** `ARCHITECTURE.md §22` Memory metrics (future reuse, false-memory rate, stale-memory rate, contradiction rate, correction rate) become measurable for the first time.
- **Acceptance criteria:** The end-to-end feedback test above passes; a scheduled evaluation run completes and persists results without manual triggering.
- **Risks:** Highest-risk phase — precisely the one both reference projects failed at independently. Mitigation: write the end-to-end feedback test *before* the implementation, not after.
- **Token/cost impact:** No new required LLM calls (aggregation is arithmetic over existing logs); scheduled evaluation runs are local/free.
- **Explicitly not implemented yet:** Predictive retrieval, adaptive per-agent budgets, contradiction detection beyond simple flagging — Phase 5 territory.

---

## Phase 5 — Advanced Efficiency

- **Objective:** Predictive retrieval, context caching, semantic deduplication, contradiction detection, adaptive token budgets, agent-specific retrieval policies (per `BLUEPRINT.md`'s own Phase 5 description).
- **Status: FUTURE — some early research evidence exists.** Not started as an official phase; substantial *evaluation* of one of its sub-areas (semantic/lexical redundancy) already happened as post-Phase-2 hardening (see above), but that is early research evidence, not Phase 5 implementation. Do not mark Phase 5 complete on the strength of it.
- **Dependencies:** Phase 4 complete — this phase needs real usage/outcome data to predict from or adapt to.
- **Early evidence note — semantic/lexical redundancy (from post-Phase-2 hardening, `docs/phase-2c/PHASE_2C_PILOT_REPORT.md`–`docs/phase-2c/PHASE_2C11_REPORT.md`):**
  - Cosine-only thresholding produced false positives.
  - A hybrid cosine + lexical-containment policy also produced organic false positives.
  - The subsequent "H2 full-corroboration" classifier (cosine ≥ 0.75 AND containment ≥ 0.40, no bypass) also produced confirmed, context-impacting false positives on fresh organic content (`docs/phase-2c/PHASE_2C11_REPORT.md`).
  - Structurally-parallel, same-vocabulary operations are a known hard case — e.g. inverse/parallel operations (reserve/release) and channel-swapped operations (email/SMS send).
  - **Conclusion: false-positive suppression of distinct knowledge is worse than carrying duplicate context.** Automatic redundancy therefore remains disabled by default (`RedundancyConfig.enabled = false`). This is an empirical design decision, not a project failure — the detection infrastructure and evaluation harness are preserved for exactly this future phase. See `docs/phase-2c/PHASE_2C10_REPORT.md` and `docs/phase-2c/PHASE_2C11_REPORT.md` for the full detail.
- **Components / packages/files / interfaces / data models / migrations:** Deliberately **not detailed yet** beyond the redundancy infrastructure that already exists (`packages/core/retrieval/src/{redundancy.ts, lexical-containment.ts}`, `packages/evaluation`). Consistent with `ARCHITECTURE_REVIEW.md §4.2`'s own finding (don't specify more than the evidence supports), the rest of this phase should be scoped in detail only once Phases 1–4 are running and real usage data exists to design against.
- **Reused AEOS components:** None identified — neither predecessor has predictive retrieval, caching, or contradiction detection.
- **Reused AEOS-brain components:** The vector-similarity-based duplicate-detection *concept* (>0.95 cosine = duplicate, 0.85–0.95 = flag for review) was a starting precedent for semantic deduplication (ADAPTED) — **with the fix that AEOS-brain's own redundant O(n²) full-table re-scan was not repeated** (`AUDIT_AEOS_BRAIN.md §17`); the efficient per-insert check was used instead. The organic-evaluation false-positive findings above go beyond what this precedent predicted.
- **Rewritten / discarded components:** TBD.
- **Tests / evaluation / acceptance criteria:** TBD — defined when this phase is scoped.
- **Risks:** Designing this phase too early, before real usage data exists, is itself the main risk.
- **Token/cost impact:** Likely net-positive (caching/dedup should reduce redundant retrieval/model cost) but unquantifiable until scoped.
- **Explicitly not implemented yet:** All of it — this entire phase is future work.

---

## Phase 6 — Ecosystem

- **Objective:** SDKs, CLI, cloud synchronization, UI, optional orchestration (per `BLUEPRINT.md`'s own Phase 6 description).
- **Status: FUTURE.** Not started; no `packages/sdk`, `packages/cli`, or dashboard exists in the repository.
- **Dependencies:** Phases 1–2 minimum (needs a stable adapter-callable Core — satisfied); realistically benefits from Phases 3–4 too.
- **Components:** `packages/sdk`, `packages/cli`, a dashboard, optional cloud sync.
- **Packages/files:** `packages/sdk`, `packages/cli` skeletons already implied by `BLUEPRINT.md`'s suggested layout; dashboard package TBD.
- **Interfaces/contracts:** SDK/CLI call the same Gateway/Core services as MCP — no new business logic, per the "no logic duplicated between adapters" rule (`ARCHITECTURE_REVIEW.md §11`).
- **Data models / migrations:** None beyond what cloud sync would require, itself undesigned yet.
- **Reused AEOS components:** None directly (AEOS has no SDK/CLI/UI in the relevant sense).
- **Reused AEOS-brain components:** `aeos-visualizer`'s interaction design — force-directed graph, inspector panel, dark-mode CSS-custom-property token system, promote/demote UI patterns (**ADAPT, design/UX only**, per `MERGE_MATRIX.md` — never its code, given the browser-exposed service-role key and monolithic 949-line component documented in `AUDIT_AEOS_BRAIN.md §11, §19`). This is the concrete answer to the project brief's request to consider reusing AEOS-brain's UI/UX.
- **Rewritten components:** A dashboard, if built, must be a fresh implementation talking to the Brain exclusively through the SDK/HTTP adapter, never directly to storage.
- **Discarded components:** AEOS-brain's direct-Supabase-client dashboard architecture; cloud/Postgres-specific deployment tooling, unless/until cloud sync is actually scoped.
- **Tests / evaluation / acceptance criteria:** TBD.
- **Risks:** Premature cloud/UI investment before the Core is proven. This phase should not start early.
- **Token/cost impact:** TBD.
- **Explicitly not implemented yet:** All of it, until Phases 1–4 (at minimum) are complete and stable.
