# Build Plan

Phase numbering follows `BLUEPRINT.md`'s own Development Phases section (Phase 0 through Phase 6) so this plan stays traceable to the authoritative architecture rather than introducing a parallel scheme. Phase 1 ("Brain Core") is large enough on its own that it is split into four sequential sub-milestones (1.1–1.4) for real incrementality — each is independently testable and independently useful before the next begins.

Every phase below specifies: objective, dependencies, components, packages/files, interfaces/contracts, data models, migrations, reused AEOS components, reused AEOS-brain components, rewritten components, discarded components, tests, evaluation, acceptance criteria, risks, expected token/cost impact, and what is explicitly not implemented yet.

---

## Milestone Summary

| Phase | Name | Depends on | Produces |
|---|---|---|---|
| 0 | Architecture Audit | — | **Complete** — this document and its six companions |
| 1.1 | Contracts + Storage Foundation | 0 | Typed schema, SQLite/FTS5/sqlite-vec, local embeddings |
| 1.2 | Memory Layer | 1.1 | Typed, scoped, audited memory CRUD + lifecycle |
| 1.3 | Retrieval + Ranking | 1.2 | Multi-signal candidate generation, separate reranking stage |
| 1.4 | Context Compiler + Token Budgeting | 1.3 | Budget-enforced `brain_context`-equivalent, in-process |
| 2 | MCP | 1.1–1.4 | Brain Gateway + the 10 stable `brain_*` MCP tools |
| 3 | Coding Intelligence | 2 | Repository/doc/dependency indexing as a retrieval source |
| 4 | Learning | 2 (benefits from 3) | Working end-to-end outcome-feedback loop, scheduled evaluation |
| 5 | Advanced Efficiency | 4 | Predictive retrieval, caching, contradiction detection (scoped later) |
| 6 | Ecosystem | 1–2 minimum | SDK, CLI, dashboard, optional cloud sync (scoped later) |

The single highest-value milestone to watch closely is **Phase 4's end-to-end feedback test** (§Phase 4, Tests) — it directly targets the one failure mode both AEOS and AEOS-brain independently shipped.

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
- **Dependencies:** Phase 1.1 complete.
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
- **Dependencies:** Phase 1.1–1.4 complete.
- **Components:** Brain Gateway (identity/session/scope/budget/permission resolution — **request-scoped, never module-scoped**, directly avoiding AEOS-brain's `currentAgentScope` race condition, `AUDIT_AEOS_BRAIN.md §20`); MCP Adapter (`brain_context`, `brain_recall`, `brain_search`, `brain_remember`, `brain_update`, `brain_forget`, `brain_feedback`, `brain_record_outcome`, `brain_status`, `brain_project`).
- **Packages/files:** `packages/gateway/src/{session.ts, context-resolution.ts}`; `packages/mcp/src/{server.ts, tools/*.ts}`.
- **Interfaces/contracts:** The 10 `brain_*` operations — request/response shapes **frozen here** (see `IMPLEMENTATION_READINESS.md §8`); MCP tool schema definitions.
- **Data models:** `sessions` table (ephemeral/in-memory acceptable for this phase).
- **Migrations:** `0004_sessions` (if persisted).
- **Reused AEOS components:** The 4 clean thin-adapter servers as an internal pattern reference (ADAPT — pattern only, never code).
- **Reused AEOS-brain components:** The 5-tool surface as a naming/shape reference for `brain_remember`/`brain_recall`/`brain_feedback` (ADAPT — shape only; its implementation has a race condition and embedded business logic and must not be ported).
- **Rewritten components:** `aeos-mcp-server`'s handlers — logic moved into Gateway/Core, race condition eliminated by construction.
- **Discarded components:** AEOS's 10-server topology; AEOS's `mcp-config.json` format.
- **Tests:** The CI import-boundary check proposed in `ARCHITECTURE_REVIEW.md §2.1` (fails the build if `packages/mcp` imports anything beyond Core's public API + the MCP SDK); a concurrency test with overlapping requests under different scopes proving no cross-request bleed (directly targeting AEOS-brain's bug class); one end-to-end test per `brain_*` operation.
- **Evaluation:** Latency and tool-call-success-rate become measurable for the first time (`ARCHITECTURE.md §22` Efficiency metrics).
- **Acceptance criteria:** A real external MCP client can call all 10 operations against a running Brain instance and get correct, budget-respecting responses; concurrent requests from different scopes never cross-contaminate.
- **Risks:** First point where vendor-specific assumptions could creep in. Mitigation: test against at least two different MCP client shapes before considering the surface stable.
- **Token/cost impact:** MCP transport is free; this phase makes the Brain callable, so real usage-driven cost measurement becomes possible.
- **Explicitly not implemented yet:** Codebase intelligence, outcome-feedback-driving-ranking (`brain_feedback` is callable and logs, but ranking doesn't read it back yet — Phase 4), SDK/CLI adapters.

---

## Phase 3 — Coding Intelligence

- **Objective:** Repository indexing, symbol/file context, documentation indexing, project state — as an additional retrieval *source*, not a separate system.
- **Dependencies:** Phase 2 complete.
- **Components:** `packages/codebase` — offline indexer + artifact store, read by Phase 1.3's retrieval layer.
- **Packages/files:** `packages/codebase/src/{indexer.ts, chunker.ts, dependency-graph.ts}`.
- **Interfaces/contracts:** `CodebaseIndex.query(scope, filters) → CodeCandidate[]`, feeding the same `Candidate[]` shape Phase 1.3 already defined.
- **Data models:** `code_chunks`, `file_metadata`, `dependency_edges`.
- **Migrations:** `0005_codebase_intelligence`.
- **Reused AEOS components:** The offline-indexer-writes-artifacts/adapter-reads-them pipeline shape (ADAPT — the best cross-language integration either predecessor achieved, `AUDIT_AEOS.md §22-23`); dependency-graph regex extractor (ADAPT).
- **Reused AEOS-brain components:** None (AEOS-brain has no codebase intelligence, `AUDIT_AEOS_BRAIN.md §15`).
- **Rewritten components:** None required for this phase; regex-based chunking is accepted as a documented limitation, not blocking.
- **Discarded components:** AEOS's turbovec-dependent code-search fallback — replaced by sqlite-vec, which has no such gap.
- **Tests:** Indexing a fixture repository produces expected chunks/dependencies; dependency queries (`what_breaks_if_changed`-style) return correct results; re-indexing after a file change updates rather than duplicates.
- **Evaluation:** Retrieval precision on code-specific queries, measured the same way as Phase 1.3, on a code-focused fixture set.
- **Acceptance criteria:** A code-related task context request returns relevant file/symbol/dependency information within budget, sourced through the same Context Compiler as any other memory type.
- **Risks:** Regex-based chunking will misparse some language constructs. Mitigation: document known limitations rather than silently returning wrong results; AST-based chunking is an explicit future upgrade (`ARCHITECTURE_REVIEW.md §10`), not required here.
- **Token/cost impact:** Indexing runs locally, no model cost; may add meaningful one-time CPU/disk cost for large repositories.
- **Explicitly not implemented yet:** Symbol-level (AST-precise) retrieval, change-aware/test-aware context, repository architecture inference — all explicitly named as *future* in `ARCHITECTURE.md §18`.

---

## Phase 4 — Learning

- **Objective:** Close the loop both predecessors left broken. Retrieval telemetry already exists (Phase 1.3); this phase makes outcome feedback actually drive ranking, and schedules evaluation.
- **Dependencies:** Phase 2 complete (needs `brain_feedback`/`brain_record_outcome` callable); benefits from Phase 3 but doesn't strictly require it.
- **Components:** `packages/core/learning` — outcome ingestion, aggregation into performance scores, promotion/demotion automation, scheduled evaluation.
- **Packages/files:** `packages/core/src/learning/{outcomes.ts, aggregation.ts, promotion.ts, scheduler.ts}`.
- **Interfaces/contracts:** `brain_feedback`/`brain_record_outcome` handlers (named in Phase 2's frozen surface) get their real implementation, writing to performance aggregates that Phase 1.3's ranking reads back.
- **Data models:** `performance_metrics` (use_count, success_count, review_sum — **this time actually populated**, directly targeting the exact failure both predecessors had); `promotion_log`/`demotion_log`.
- **Migrations:** `0006_learning`.
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
- **Dependencies:** Phase 4 complete — this phase needs real usage/outcome data to predict from or adapt to.
- **Components / packages/files / interfaces / data models / migrations:** Deliberately **not detailed yet**. Consistent with `ARCHITECTURE_REVIEW.md §4.2`'s own finding (don't specify more than the evidence supports), this phase should be scoped in detail only once Phases 1–4 are running and real usage data exists to design against.
- **Reused AEOS components:** None identified — neither predecessor has predictive retrieval, caching, or contradiction detection.
- **Reused AEOS-brain components:** The vector-similarity-based duplicate-detection *concept* (>0.95 cosine = duplicate, 0.85–0.95 = flag for review) is a real, working precedent for semantic deduplication (ADAPT, when scoped) — **with the fix that AEOS-brain's own redundant O(n²) full-table re-scan must not be repeated** (`AUDIT_AEOS_BRAIN.md §17`); the efficient per-insert check alone is sufficient.
- **Rewritten / discarded components:** TBD.
- **Tests / evaluation / acceptance criteria:** TBD — defined when this phase is scoped.
- **Risks:** Designing this phase too early, before real usage data exists, is itself the main risk.
- **Token/cost impact:** Likely net-positive (caching/dedup should reduce redundant retrieval/model cost) but unquantifiable until scoped.
- **Explicitly not implemented yet:** All of it — this entire phase is future work.

---

## Phase 6 — Ecosystem

- **Objective:** SDKs, CLI, cloud synchronization, UI, optional orchestration (per `BLUEPRINT.md`'s own Phase 6 description).
- **Dependencies:** Phases 1–2 minimum (needs a stable adapter-callable Core); realistically benefits from Phases 3–4 too.
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
