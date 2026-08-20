# AEOS vs. AEOS-brain — Cross-Project Comparison

Source material: `AUDIT_AEOS.md`, `AUDIT_AEOS_BRAIN.md`. Section references below (`AUDIT_AEOS.md §N`) point back to the grounded, file:line-cited findings in those documents rather than re-deriving citations here.

---

## 1. Relationship

Established with primary-source evidence in `AUDIT_AEOS_BRAIN.md §4`: AEOS-brain is **not** "AEOS but newer." It is a from-scratch rewrite in a different stack (Postgres/Supabase/cloud vs. AEOS's SQLite/local) that performed a **one-time content migration** of AEOS's static YAML seed corpus (96 of 98 patterns, only 4 of AEOS's ~10 domain packages represented) and independently **reimplemented** the surrounding logic — hybrid search, knowledge aging, MCP surface — as new code. No AEOS source code is imported, vendored, or reused anywhere in AEOS-brain. The naming overlap and explicit "old local AEOS" self-description (`seed_importer.py`, `engine.py`) indicate continuity of authorship and intent, not continuity of codebase.

This matters for how the rest of this comparison should be read: differences below are largely **independent design decisions made twice by the same author(s)**, not a linear evolution. Where both projects converge on a similar idea (e.g., aging-tier thresholds), that convergence is stronger evidence the idea is sound than if only one project had tried it. Where they diverge, the divergence is a genuine design choice, not a bug fix.

---

## 2. Overlapping Functionality

Both projects independently implement:

| Concern | AEOS | AEOS-brain |
|---|---|---|
| Hybrid multi-signal search | `packages/knowledge-db/src/search/hybrid.ts` — FTS5 + 3-tier vector fallback + tags + performance + UCB exploration, weighted sum (`AUDIT_AEOS.md §10-13`) | Single Postgres RPC `match_memories` v2 — vector 40% / FTS 25% / tag 20% / performance 10% / quality 5% (`AUDIT_AEOS_BRAIN.md §7`) |
| Static pattern knowledge | `patterns` table from 98 YAML files (`AUDIT_AEOS.md §8`) | `memories` rows with `source='SEED'`, imported from the same YAML corpus (`AUDIT_AEOS_BRAIN.md §6`) |
| Knowledge aging / tier promotion | Two disagreeing TS implementations + one orphaned Python one (`AUDIT_AEOS.md §18`) | One implementation, structurally broken on 2 of 4 rules (`AUDIT_AEOS_BRAIN.md §5, §13`) |
| Retrieval telemetry | `retrieval_log` → `pattern_metrics`, logged automatically on every search (`AUDIT_AEOS.md §16`) | `retrieval_log` table, logged automatically on every `retrieve_memory` call (`AUDIT_AEOS_BRAIN.md §13`) |
| Outcome/feedback reporting | `logUsage`/`logSuccess`/`logReview` exist, exported, **zero callers** (`AUDIT_AEOS.md §16`) | `log_usage` MCP tool exists, but its own RPC is undefined and nothing calls the tool (`AUDIT_AEOS_BRAIN.md §13`) |
| MCP as the agent-facing surface | 10 servers, stdio | 2 servers (Brain + Orchestrator), StreamableHTTP + stdio |
| Local embedding generation | Yes — `@xenova/transformers`, in-process, no external API (`AUDIT_AEOS.md §13`) | No — OpenAI/OpenRouter API call required for every embedding (`AUDIT_AEOS_BRAIN.md §14`) |

## 3. Complementary Functionality

Each project has real, working capability the other has none of:

- **AEOS only:** an evaluation harness (Precision@K/Recall@K/NDCG/MRR, `AUDIT_AEOS.md §31`), a composite quality metric deliberately excluding raw volume (OII, `AUDIT_AEOS.md §32`), codebase/document/dependency-graph indexing genuinely wired end-to-end (`AUDIT_AEOS.md §22-23`), local embedding generation with no external dependency.
- **AEOS-brain only:** a capture/harvest layer (Chrome extension + file watcher → ingest queue → AI distillation, `AUDIT_AEOS_BRAIN.md §5`), a working interactive dashboard (`AUDIT_AEOS_BRAIN.md §19`), automatic scheduled background processing proven by a real execution log (`AUDIT_AEOS_BRAIN.md §3`), a unified single-table memory model spanning both curated and episodic knowledge (`AUDIT_AEOS_BRAIN.md §6`), a real (if partially broken) multi-tenant-capable cloud store.

Neither overlaps the other's unique strength — the two audits describe systems that are complementary in coverage almost by accident, since both were built by the same author(s) solving the same underlying problem twice with different priorities each time.

## 4. Conflicting Implementations

Cases where both projects solve the same problem with genuinely different, incompatible answers:

- **Vector backend philosophy.** AEOS's own later code (Phase 11, `sqlite-vec.ts`) explicitly deprecates external `turbovec` in favor of in-process `sqlite-vec` — but `docs/AEOS_TURBOVEC_ROADMAP.md` still argues for the sidecar approach, and several AEOS subsystems (visual search, codebase/doc search) still hard-depend on it (`AUDIT_AEOS.md §13`). AEOS-brain never adopted turbovec at all and uses pgvector natively. Net effect: **three** different vector strategies exist across the two projects' combined history (turbovec sidecar, in-process sqlite-vec, pgvector), and only one of the three (in-process, no sidecar) avoids an external dependency.
- **Aging-rule ownership.** AEOS-brain's `engine.py` explicitly states its aging rules were "ported from agent-knowledge-system" (`AUDIT_AEOS_BRAIN.md §4`), yet the actual threshold values and rule count differ from AEOS's own `patterns.ts` implementation in specifics (AEOS-brain: Elevated ≥10 uses/≥85%/≥7.0, Trusted ≥25/≥92%/≥8.5, 60-day stale-candidate demotion; AEOS: promote at use_count≥5/success≥80%/use_rate≥60%, 60+ day/<3-use decay). "Ported" here means concept-ported, not value-ported — a real, if minor, source of truth conflict if anyone assumed the numbers carried over exactly.
- **Quality/effectiveness scoring formulas.** AEOS has two disagreeing "Phase 10" formulas for the same concept (`AUDIT_AEOS.md §19`); AEOS-brain independently has two disagreeing "OII" formulas visible simultaneously in its own dashboard (`AUDIT_AEOS_BRAIN.md §17`). This is the same failure mode — parallel unreconciled scoring logic — occurring independently inside each project, not just between them.
- **MCP server granularity.** AEOS: many small domain-specific servers. AEOS-brain: one generic server with a scope parameter. These are not just different — they are opposite bets on the same design question, and §5 below judges each.

## 5. Better Implementations (component-by-component)

| Concern | Winner | Why |
|---|---|---|
| Retrieval signal sophistication | **AEOS** | UCB1 exploration term, dedicated diversity module, richer fallback chain — none of which AEOS-brain has any equivalent of (`AUDIT_AEOS_BRAIN.md §19`) |
| Unified single-surface retrieval | **AEOS-brain** | One query, one tool, server-side scoring, vs. AEOS's 10-servers-to-keep-in-sync (`AUDIT_AEOS_BRAIN.md §18`) |
| Memory/knowledge schema unification | **AEOS-brain** | One `memories` table spanning curated + episodic knowledge, actually implemented as a stated design goal; AEOS never unified its `patterns`/`artifacts`/`memory` silos (`AUDIT_AEOS_BRAIN.md §6` vs. `AUDIT_AEOS.md §8`) |
| Local-first / no external dependency | **AEOS** | Runs fully offline; AEOS-brain hard-fails without live Postgres + an LLM API key for basic operation (`AUDIT_AEOS_BRAIN.md §19`) |
| Automatic background scheduling | **AEOS-brain** | APScheduler-driven, proven running in production via `.ecosystem.log`; AEOS's equivalent Python scripts are real but manually-triggered only (`AUDIT_AEOS.md §32`) |
| Evaluation methodology | **AEOS** | Real Precision/Recall/NDCG/MRR harness; AEOS-brain has no evaluation harness at all, only two disagreeing OII numbers (`AUDIT_AEOS.md §31`, `AUDIT_AEOS_BRAIN.md §19`) |
| User-facing UI | **AEOS-brain** | AEOS has none; AEOS-brain's dashboard is real and feature-rich, if flawed (`AUDIT_AEOS_BRAIN.md §19`) |
| Capture/ingest mechanism | **AEOS-brain** | AEOS has none; relies entirely on an external tool (AiderDesk) for all interaction |
| Security posture | **Neither, but AEOS is safer by default** | AEOS's "local file, OS permissions" is a simpler boundary than AEOS-brain's broken RLS + browser-exposed service-role key (`AUDIT_AEOS_BRAIN.md §11, §19`) — not a design win, just a smaller blast radius |
| Testing discipline | **Neither** | AEOS: 4 ad-hoc Python scripts testing orphaned code, not CI-wired (`AUDIT_AEOS.md §30`). AEOS-brain: no automated test suite surfaced by the audit; its only CI gate is lint-only and non-blocking (`AUDIT_AEOS_BRAIN.md §20`) |
| Agent-role hardcoding discipline | **AEOS-brain (by demonstration, not by absence)** | AEOS has no orchestrator at all, so it "avoids" the problem by not attempting it. AEOS-brain *does* build a 6-persona orchestrator, hardcodes it thoroughly — and keeps it cleanly confined to a separate, swappable, non-load-bearing package the Brain has zero knowledge of (`AUDIT_AEOS_BRAIN.md §10`). This is a working proof that the Brain/Agent boundary holds under real implementation pressure, which is more valuable evidence than AEOS simply never building the failure case. |

## 6. Incomplete Implementations — Shared Failure Patterns

The most important comparison finding is not where the two projects differ, but where they **fail identically**:

1. **The outcome-reporting half of the learning loop is broken in both**, for related but distinct reasons. AEOS: the report-back functions exist in `knowledge-db` but no MCP tool exposes them (`AUDIT_AEOS.md §16`). AEOS-brain: the report-back MCP tool exists, but its database side-effect RPC was never defined, *and* no client ever calls it (`AUDIT_AEOS_BRAIN.md §13`). Both systems can tell you what was *retrieved*; neither can tell you what was *useful*. Two independent implementations, two independent failures, same missing piece.
2. **MCP thin-adapter discipline erodes under real feature growth in both.** AEOS's original 4 servers are clean thin adapters; the 6 built afterward each hand-roll their own DB connection (`AUDIT_AEOS.md §5, §37`). AEOS-brain's single server contains business logic (embedding generation, validation) directly in tool handlers rather than delegating to a core package (`AUDIT_AEOS_BRAIN.md §9`). Neither project sustained the "MCP is just an adapter" principle past its first iteration.
3. **Documentation drifts ahead of or away from implementation in both.** AEOS: ~20 documented `npm run` scripts that don't exist, tool names that don't match 6 of 10 servers, an "AST-based" chunker that is actually regex (`AUDIT_AEOS.md §34`). AEOS-brain: a claimed session-variable RLS mechanism that was never written, an entire scaling-plan document with zero corresponding code, an expanded tool roster (Aider/Cline/Continue.dev-derived tools) that was never built (`AUDIT_AEOS_BRAIN.md §16`).
4. **Duplicated-scoring-logic-that-disagrees appears inside each project independently**, not just across them (§4 above).
5. **Zero automated tests gate either project's core logic in CI** (§5 above).

## 7. Architectural Differences

| Dimension | AEOS | AEOS-brain |
|---|---|---|
| Deployment model | Local processes, stdio, spawned by an external tool (AiderDesk) | Distributed cloud services (Render + Netlify + Supabase), some local-only |
| Storage | SQLite, single file, WAL mode | Postgres + pgvector, managed cloud |
| Language | TypeScript core + orphaned Python services layer | JavaScript (MCP gateway) + Python (refinery/orchestrator) + TypeScript (visualizer), no orphaned layer — every language present is load-bearing for something |
| MCP topology | 10 domain-specific servers | 2 servers at different levels (Brain, Agent) |
| Agent orchestration | None in-repo (external tool's job) | A self-contained, swappable example orchestrator package |
| Knowledge ingestion | Manual: hand-authored YAML, imported once | Automated: passive capture (browser + file watcher) → AI distillation → store |
| Scope/isolation model | None (single local file, single user) | Flat 4-value domain tag, enforced only in application code |
| Embedding generation | Local, in-process, free, offline | Remote API call, per-write cost, requires network |

## 8. Duplicated Systems

- **Within AEOS:** agent memory implemented 3 times (MCP server, orphaned Python `MemoryManager`, a third inline re-implementation in `memory-decay.py`); knowledge aging implemented twice in TypeScript alone, plus a third orphaned Python version; DB-connection boilerplate copy-pasted across 6 servers (`AUDIT_AEOS.md §35`).
- **Within AEOS-brain:** two duplicate-detection passes where one fully subsumes the other but the expensive redundant one runs every 5 minutes anyway; two quality-scoring formulas producing different numbers for the same field; two OII calculations shown side-by-side in the same UI; `flag_for_deletion` defined identically in three different non-migration files; the same 12 demo rows hand-duplicated in two formats that have already drifted apart (`AUDIT_AEOS_BRAIN.md §17`).
- **Across both:** the seed-pattern corpus itself now exists in two places (AEOS's YAML files, AEOS-brain's one-time-imported copy in Postgres) with no synchronization mechanism between them — editing a pattern in one system has no effect on the other.

## 9. Missing Capabilities (gaps in both, relative to the target Brain)

Neither project has, and the new Brain needs (per `BLUEPRINT.md`/`ARCHITECTURE.md`):

- **A hierarchical scope model.** AEOS has no scope concept at all (single local file). AEOS-brain has a flat 4-value domain tag, not the blueprint's 8-level global→session hierarchy — and the one isolation mechanism it does have (RLS) doesn't actually work (`AUDIT_AEOS_BRAIN.md §11`).
- **A context compiler / token budgeter.** Confirmed absent in both (`AUDIT_AEOS.md §20-21`, `AUDIT_AEOS_BRAIN.md §14`). AEOS-brain's "keep what you store small" distillation discipline is a useful adjacent idea but operates at write time, not at retrieval/context-assembly time — it is not a substitute for a budget-enforcing context compiler.
- **The blueprint's 12-type memory model.** AEOS has `pattern` (with subtypes) and an undifferentiated `memory`, never unified. AEOS-brain has `SEED`/`REFINERY`, a 2-way split. Neither distinguishes decision/rule/procedure/error/constraint/project_state/task_state as first-class types — this is new design work informed by, but not extractable from, either codebase.
- **A stable, task-oriented `brain_context` operation.** Both projects expose CRUD/search-shaped tools (store/retrieve/search); neither has a single high-level "compile me a context pack for this task, within this budget" operation as the primary interface, which is `ARCHITECTURE.md §11`'s central concept.
- **A working, end-to-end outcome-feedback loop.** See §6 above — this is the single most consistently-missing piece across both predecessors and should be treated as the highest-priority thing to get right the first time.

## 10. Useful Concepts Worth Carrying Forward

(Concepts, not code — see `MERGE_MATRIX.md` for the code-level KEEP/ADAPT/REWRITE/DROP/INVESTIGATE decisions.)

- Multi-signal weighted retrieval scoring (FTS + vector + tags + performance + exploration) — AEOS's shape, validated by both projects independently arriving at a similar signal set.
- One unified memory/knowledge surface differentiated by type/source field, not physically separate subsystems — AEOS-brain's proven design goal.
- UCB1-style exploration boost so unproven-but-plausible knowledge still surfaces occasionally — AEOS only, genuinely absent from AEOS-brain and worth keeping.
- A composite quality metric that structurally cannot be gamed by adding volume (AEOS's OII design principle, not its exact formula).
- Threshold-based tier promotion/demotion (Candidate→Elevated→Trusted style), audit-logged — validated by independent convergence across both projects.
- Local, in-process, no-external-API embedding generation as the default — AEOS's approach, and the one the new Brain's local-first storage direction already implies.
- A cleanly separated, swappable example orchestrator that proves the Brain/Agent boundary holds — AEOS-brain's `aeos-orchestrator` as a pattern (ship an example consumer, not as part of the Brain itself).
- Offline indexer writes artifacts → MCP reads them, no live coupling required — AEOS's codebase/document/dependency-graph integration, the best-executed cross-language integration either project has.
- Force-directed graph visualization, an inspector panel, and a dark-mode CSS-custom-property token system — AEOS-brain's visualizer, valuable specifically as **design/UX reference**, addressed further in `ARCHITECTURE_REVIEW.md`.

## 11. Concepts That Should Be Abandoned

- **One MCP server per knowledge domain.** AEOS's 10-server split demonstrably could not stay synchronized with its own shared package as it grew (`AUDIT_AEOS.md §5, §37`). The blueprint's small, stable `brain_*` tool surface is both already the specified direction and the thing AEOS's own failure mode argues for independently.
- **Direct database access from a browser client, especially with a privileged key.** AEOS-brain's visualizer does this and it is a genuine security hole, not a style nit (`AUDIT_AEOS_BRAIN.md §11`). Any future dashboard must go through the Brain's own adapter layer like any other client.
- **Maintaining a second implementation "for completeness" without wiring it in.** AEOS's four orphaned Python services are complete, well-written, and entirely wasted effort because nothing calls them. One implementation, one language, for the core.
- **Hardcoded fixed-persona orchestration influencing the Brain's own design.** AEOS-brain's six personas are fine as an example *consumer* (§10 above) but their prompts/roster must not shape any Brain-side abstraction — the Brain must stay ignorant of "architect" or "reviewer" as concepts, which AEOS-brain itself already demonstrates is achievable.
- **External, single-author, early-stage vector-index dependencies.** `turbovec` — AEOS's own later code already moved away from this; no reason to pull it into a fresh design.
- **Schema provisioned from two unsynchronized sources.** AEOS's code-defined `initSchema()` vs. seven hand-maintained `.sql` files drifted in practice and needed a runtime repair function to paper over it (`AUDIT_AEOS.md §9`). One schema, one source of truth.
- **Silent failure swallowing on missing infrastructure.** AEOS-brain's `log_usage` handler catches its own broken RPC call and treats it as non-fatal (`AUDIT_AEOS_BRAIN.md §13`); AEOS's Zod schemas silently strip unrecognized fields, discarding data on import (`AUDIT_AEOS.md §8`). Both are instances of the same anti-pattern: errors that should be loud are made quiet, and the resulting gap goes unnoticed for the life of the project.
