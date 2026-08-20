# Implementation Readiness

Direct answers to the twelve readiness questions, grounded in `AUDIT_AEOS.md`, `AUDIT_AEOS_BRAIN.md`, `AEOS_COMPARISON.md`, `MERGE_MATRIX.md`, `ARCHITECTURE_REVIEW.md`, and `BUILD_PLAN.md`. This document does not authorize implementation — see §12 and the Stop Condition at the end.

---

### 1. What is the smallest viable Brain?

Everything in `BUILD_PLAN.md` Phases 1.1 through 2, and no further: typed/scoped memory storage (SQLite + FTS5 + sqlite-vec + local embeddings), multi-signal retrieval with a separate reranking stage, a budget-enforced context compiler, and the 10 `brain_*` operations callable over MCP through a request-scoped Gateway.

This is genuinely usable — an external agent can store memories, recall them, and get a token-budget-respecting context pack for a task. It is **not yet learning**: `brain_feedback`/`brain_record_outcome` are callable and log data, but nothing reads that data back into ranking until Phase 4. It also has no codebase intelligence until Phase 3. Calling this "viable" rather than "complete" is deliberate — both predecessor projects shipped far more surface area than this and still failed to close the feedback loop; a smaller Brain that is honest about what it doesn't do yet is preferable to a larger one with silently-dead functionality, which is exactly the failure pattern documented in both audits.

### 2. What must be built first?

Phase 1.1 (Contracts + Storage Foundation). Every other phase depends on it directly or transitively — the `MemoryRecord`/`ScopeRef` contracts and the SQLite/FTS5/sqlite-vec substrate are load-bearing for the entire rest of the plan. There is no useful parallel starting point; `BUILD_PLAN.md`'s dependency column is a strict chain from 1.1 through Phase 2.

### 3. What AEOS code should be reused immediately?

None of it is directly copy-pasteable — the memory schema is being redesigned around the blueprint's 12 types, which doesn't exist in AEOS's `Pattern` model. What transfers immediately, as **ported logic and formulas re-implemented against the new schema**, not as literal files:
- `db.ts`'s WAL/FTS5 initialization approach and defensive-degradation style
- `sqlite-vec.ts`'s in-process vector search integration
- `embeddings.ts`'s local-transformer embedding approach (no external API)
- The Zod-schema-as-runtime-contract pattern (with `.strict()` added)
- `hybridSearch()`'s signal set and its "never throws" discipline (Phase 1.3)
- `ranking.ts`'s UCB1 exploration formula (Phase 1.3)
- `evaluation.ts`'s Precision@K/Recall@K/NDCG/MRR formulas (Phase 1.3, Phase 4)

See `MERGE_MATRIX.md` for the full component-by-component list; every entry above is marked ADAPT, not KEEP, for exactly this reason.

### 4. What AEOS-brain code should be reused immediately?

Even less than AEOS's, at the code level — AEOS-brain is Postgres/Supabase-specific and the new Brain starts SQLite-first, so essentially none of its SQL or JavaScript is directly portable. What carries forward immediately is **design reference, not code**:
- The unified single-table, type/source-discriminated memory schema *shape* (translated to SQLite DDL from scratch)
- The tier-threshold values (Elevated/Trusted at specific use-count/success-rate cutoffs) as a cross-validation data point when choosing Phase 1.2's default configuration
- The "use a real scheduler, verify it actually fires" discipline for Phase 4's evaluation job (proven in production via AEOS-brain's own execution log, not proven in AEOS at all)

Be explicit with stakeholders that "reusing AEOS-brain" means reusing validated *decisions*, not code — the honest answer to this question is closer to zero than the answer to question 3.

### 5. What should remain reference-only?

- `aeos-orchestrator` — never part of the Brain; a candidate `examples/` integration-test fixture only (`ARCHITECTURE_REVIEW.md §2.3, §7`).
- AEOS's four clean thin-adapter MCP servers — the internal "what correct looks like" reference during Phase 2, not literal code (their granularity is wrong for the target surface).
- `aeos-visualizer` — design/UX reference for a Phase 6 dashboard (graph view, inspector panel, dark-mode token system), never its implementation, which has a disqualifying security defect.

### 6. What requires rewriting?

Three things, in priority order:
1. **The outcome-feedback/learning-loop path** (`packages/core/learning`, Phase 4) — both predecessors defined this and both shipped it dead. Highest priority to get right the first time; see §9's end-to-end test requirement.
2. **The MCP handler layer** (Phase 2) — AEOS-brain's `server.js` embeds business logic directly in tool handlers and has a module-scoped race condition; both must be eliminated by construction, not patched.
3. **Token budget enforcement** (Phase 1.4) — AEOS defines this and never calls it; it must be load-bearing on every context-compiler exit path from the first version that ships.

### 7. What should be dropped?

18 components, detailed in `MERGE_MATRIX.md`. The largest categories: the turbovec/CLIP external-vector-sidecar dependency chain; AEOS's four orphaned Python services (`knowledge_loop`, `memory-manager`, `parallel-orchestrator`, `contract-generator`); all Supabase/Postgres-specific tooling including the RLS policies (which don't actually enforce isolation as documented); cloud deployment configuration (`render.yaml`, `ecosystem.cjs`, `.gitlab-ci.yml`); and AEOS's 10-server MCP topology and its registration format.

### 8. Which contracts must be frozen?

In order of when they become externally depended-upon:
- **End of Phase 1.1:** `MemoryRecord` shape (including the 12-type enum) and `ScopeRef` shape. Changing the type taxonomy after real data exists is a migration, not an edit.
- **End of Phase 1.1:** The `EmbeddingProvider` interface. Swapping embedding strategies after data has been embedded means re-embedding everything — freeze the interface shape even if the default implementation later changes.
- **Start of Phase 2, before implementation:** The 10 `brain_*` operation request/response shapes. Once any external agent integration begins against these, they become de facto public API.

### 9. What tests must exist?

The non-negotiable set, pulled from `BUILD_PLAN.md`'s per-phase test requirements:
- Round-trip write/read for each of the 12 memory types (Phase 1.1)
- FTS5 and vector-search correctness against a fixture dataset (Phase 1.1)
- Lifecycle-transition validity — illegal transitions rejected, not silently applied (Phase 1.2)
- Retrieval degradation test — vector index unavailable falls back without throwing (Phase 1.3)
- Context-budget-never-exceeded test (Phase 1.4) — this is the proof for `ARCHITECTURE.md §12`'s hard boundary
- MCP concurrency test — overlapping requests under different scopes never cross-contaminate (Phase 2), directly targeting AEOS-brain's specific bug class
- **The Phase 4 end-to-end feedback test: call `brain_feedback`, then call `brain_recall`, assert the ranking measurably changed.** This is the single most important test in the entire plan — it is the one thing that would have caught both predecessor projects' shared failure before shipping.

### 10. What is the first implementation milestone?

Phase 1.1 complete, per its `BUILD_PLAN.md` acceptance criteria: a memory record of each of the 12 types can be written and read back exactly via the contracts layer; FTS5 and vector search both return correct results against a fixture dataset; zero external network calls are required for any of it.

### 11. What are the biggest architectural risks?

1. **Repeating the outcome-feedback dead-code failure a third time.** Both predecessors built this independently and both failed the same way. Mitigation: test-first (§9), treated as a first-milestone-tier concern in `BUILD_PLAN.md` Phase 4, not deferred.
2. **MCP-thinness eroding again without enforcement.** Both predecessors stated the principle and both drifted from it under real feature growth. Mitigation: the CI import-boundary check proposed in `ARCHITECTURE_REVIEW.md §2.1`.
3. **`sqlite-vec` native-extension fragility across platforms.** Mitigation: retain AEOS's in-process-cosine fallback tier.
4. **Token-estimation accuracy without a real tokenizer for every downstream model.** Mitigation: conservative overestimation, never optimistic.
5. **Over-building the scope hierarchy before any deployment needs it.** Mitigation: the minimal `global`/`project`/`session` subset proposed in `ARCHITECTURE_REVIEW.md §4.1`, with the rest documented-but-deferred.
6. **Starting Phase 6 (UI/cloud) before the Core is proven.** Mitigation: explicit dependency gating in `BUILD_PLAN.md` — Phase 6 has no urgency and should not be pulled forward.

### 12. What decisions require human approval?

These are open questions or proposals raised across the audit that this document does not — and should not — resolve unilaterally:

- **Whether to proceed past this Stop Condition at all.** The master decision; everything below is moot until this is granted.
- **The single-table-with-type-discriminator schema decision for Phase 1.1** (recommended, following AEOS-brain's validated pattern) vs. per-type tables. Costly to change once real data exists — worth explicit sign-off before Phase 1.1 begins, not just tacit acceptance of this document's recommendation.
- **Whether the proposed new architectural invariant** — "the Brain's default configuration must perform basic operations with zero required external network calls" (`ARCHITECTURE_REVIEW.md §3.2`) — should actually be added to `ARCHITECTURE.md`. This document deliberately did not modify that file; only the human can.
- **Whether to build any CI enforcement mechanism for MCP-thinness** (`ARCHITECTURE_REVIEW.md §2.1`), and if so, how strict — a real engineering-time cost being traded against a risk both predecessors demonstrated is real.
- **The minimal scope-hierarchy subset for Phase 1** (`global`/`project`/`session` recommended) — confirm this is sufficient for the intended initial use case before it's built.
- **Whether passive capture/harvest tooling (AEOS-brain's browser extension + file watcher pattern) is wanted at any point**, even deferred — currently recommended out of scope entirely (`ARCHITECTURE_REVIEW.md §3.1`) due to unaddressed consent/privacy/security weight, but this is a product decision, not a technical one.
- **`diversity.ts` and `services/abstraction-validator`** — both marked INVESTIGATE in `MERGE_MATRIX.md` because the audits didn't establish enough detail to classify them confidently. Worth a direct read before Phase 1.3 (diversity) and before Phase 4 (abstraction-validator) if either capability is wanted.
- **How much detail to scope for Phase 5 (Advanced Efficiency) and Phase 6 (Ecosystem) now versus later.** This document deliberately left both light, consistent with not over-specifying ahead of evidence (`ARCHITECTURE_REVIEW.md §4.2`) — confirm that deferral is acceptable rather than wanted in more detail up front.

---

## Stop Condition

Per the governing instructions for this audit: implementation has not begun. `AUDIT_AEOS.md`, `AUDIT_AEOS_BRAIN.md`, `AEOS_COMPARISON.md`, `MERGE_MATRIX.md`, `ARCHITECTURE_REVIEW.md`, `BUILD_PLAN.md`, and this document are the complete Phase 0 deliverable. `BLUEPRINT.md` and `ARCHITECTURE.md` were read in full and treated as authoritative; neither was modified — all proposed changes and additions are contained in `ARCHITECTURE_REVIEW.md` and flagged for approval in §12 above. Waiting for explicit approval before any Brain code is written.
