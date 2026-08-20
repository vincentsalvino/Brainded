# AEOS (Agent Knowledge Operating System) — Reference Audit

Audit root: `c:\Users\LENOVO V330\OneDrive\Desktop\ai-brain\references\AEOS`
Audit type: static, read-only. No code executed, no dependencies installed.
All paths below are relative to the audit root unless given in full.

---

## 1. Executive Summary

- AEOS is a **TypeScript MCP-server backend for a static, hand-authored YAML knowledge base** (98 pattern files) plus a **substantial but largely disconnected Python "services" layer**. The genuinely mature part of the system is small: `packages/core`, `packages/knowledge-db`, `packages/seed`, and 4 of the 10 MCP servers (design, backend, architecture, engineering).
- The hybrid search engine (`packages/knowledge-db/src/search/hybrid.ts`) is real, working code: FTS5 keyword search + a 3-tier vector-search fallback chain (sqlite-vec → turbovec sidecar → in-process cosine) + tag matching + a performance/usage boost + UCB exploration boost. The weights in code match the weights documented in `README.md` almost exactly.
- **turbovec** (github.com/RyanCodrai/turbovec) is a real third-party Rust/Python vector-index library, not an AEOS invention. `docs/AEOS_TURBOVEC_ROADMAP.md` pushes it hard as the primary vector-search strategy, but the actual code's own "Phase 11" (`packages/knowledge-db/src/sqlite-vec.ts`, `scripts/migrate-to-sqlite-vec.ts`) explicitly **supersedes and deprecates turbovec** in favor of in-process `sqlite-vec`. The docs and the code disagree about which vector backend is current.
- **Six of the ten MCP servers (memory, visual, contracts, knowledge-loop, codebase, docs) do not use `packages/knowledge-db` at all.** Each hand-rolls its own `better-sqlite3` connection and re-implements schema access locally, in contrast to the four original servers, which cleanly delegate to `hybridSearch()`. This is a clear architectural fault line between "old, disciplined" and "new, ad hoc" AEOS.
- **The Python `services/` directory largely duplicates the TypeScript MCP servers rather than powering them.** `services/memory-manager`, `services/knowledge_loop/*`, `services/parallel-orchestrator/*`, and `services/contract-generator` are complete, well-written Python libraries that are **never imported by anything except their own `scripts/test-*.py` files** — they are unit-tested in isolation and orphaned in production. The live, agent-facing logic is a separate, independently-written TypeScript re-implementation, and the two sometimes disagree (see Knowledge Loop, below).
- The exception is the **codebase/document/vector subsystem**, which is genuinely cross-language and connected: `services/codebase-indexer`, `services/document-indexer`, and `services/dependency-graph` write JSON/SQLite artifacts that `packages/mcp-codebase` and `packages/mcp-docs` read directly, and the `services/vector-search/main.py` FastAPI sidecar implements every HTTP endpoint the TypeScript clients call.
- **Documentation overstates what is wired up.** `README.md`'s "Quick Reference: All npm Scripts" and `docs/INSTALL_GUIDE.md`'s "npm Scripts Reference" list roughly 20 scripts (`seed:vectors`, `metrics`, `review-candidates`, `loop:run`, `memory:decay`, `test:memory`, etc.) that **do not exist in `package.json`**. The underlying Python scripts are real and runnable directly (`python scripts/metrics.py`), but the promised `npm run` interface for them was never built.
- **Zero automated tests exist for the TypeScript code that actually ships to agents.** The only tests in the repo are four hand-rolled Python scripts (`scripts/test-*.py`) using a custom `test(name, fn)` runner, not pytest/unittest, not wired into `npm test`, and not run in any CI (no CI config exists anywhere in the tree).
- The feedback loop that the documentation calls "learning" is real for the *retrieval-ranking* side (`getPerformanceScores`, `getExplorationScores`, `pattern_metrics`) but **structurally incomplete for the *reporting* side**: `logUsage`, `logSuccess`, and `logReview` exist in `knowledge-db` and are exported, but no MCP tool anywhere calls them — there is no way for an agent to actually tell AEOS "I used this pattern" or "it worked."
- Overall maturity: **the core retrieval engine (core + knowledge-db + seed + 4 servers) is production-quality craftsmanship** — defensive SQL, graceful degradation, real schema-drift repair code. **Everything added after that (Phases 7–11: memory, visual, contracts, knowledge-loop, sqlite-vec migration) is prototype-quality**: duplicated logic, disconnected Python, undocumented inconsistencies, and no tests.

---

## 2. Component Inventory

| Component | Path | Purpose | Status | Key files |
|---|---|---|---|---|
| core | `packages/core` | Shared Zod schemas + TS types for `Pattern`, search I/O, Phase 4.5 metrics types | **Working** | `src/schema.ts`, `src/types.ts` |
| knowledge-db | `packages/knowledge-db` | SQLite access, hybrid search, ranking, embeddings, diversity, evaluation, OII, retrieval logging, sqlite-vec, turbovec client | **Working** | `src/db.ts`, `src/search/hybrid.ts`, `src/ranking.ts`, `src/repositories/patterns.ts` |
| seed | `packages/seed` | 98 YAML pattern files + import script (Zod-validate → embed → insert) | **Working** (with data-loss bug, see §Knowledge Model) | `src/import.ts` |
| mcp-design | `packages/mcp-design` | MCP server: design/UI pattern search, auto-prepends design principles | **Working** | `src/server.ts` |
| mcp-backend | `packages/mcp-backend` | MCP server: backend/API/auth/DB pattern search | **Working** | `src/server.ts` |
| mcp-architecture | `packages/mcp-architecture` | MCP server: architecture decisions, anti-patterns, requirement analysis | **Working** | `src/server.ts` |
| mcp-engineering | `packages/mcp-engineering` | MCP server: engineering principles, review checklists, implementation rules | **Working** | `src/server.ts` |
| mcp-memory | `packages/mcp-memory` | MCP server: agent memory store/recall (6 tools). Own DB connection, bypasses knowledge-db | **Working, but duplicated logic** (3 implementations exist, see §Duplicated Components) | `src/server.ts` |
| mcp-visual | `packages/mcp-visual` | MCP server: CLIP-based screenshot/wireframe search + design-vs-impl comparison | **Working if turbovec+CLIP sidecar running; else FTS5/LIKE fallback for text search, no fallback for image search** | `src/server.ts` |
| mcp-contracts | `packages/mcp-contracts` | MCP server: API contract generation, parallel-session/task tracking, merge recording | **Working, but simplified** (no state-machine validation, no conflict detection — those exist only in the orphaned Python version) | `src/server.ts` |
| mcp-knowledge-loop | `packages/mcp-knowledge-loop` | MCP server: candidate extraction, scoring, promotion/demotion, aging, YAML self-write-back, framework deprecation | **Working**, 1708-line monolith, uses a different SDK API style and a different scoring formula than the docs/Python version | `src/server.ts` |
| mcp-codebase | `packages/mcp-codebase` | MCP server: codebase search over pre-built chunk index | **Working if turbovec running + codebase indexed; zero fallback otherwise** | `src/server.ts` |
| mcp-docs | `packages/mcp-docs` | MCP server: doc search + dependency-graph queries (`what_breaks_if_changed`, etc.) | **Working**, dep-graph tools fully functional off SQLite alone; doc search needs turbovec | `src/server.ts` |
| scripts (migrations) | `scripts/migrate-*.sql`, `run-migration.js` | 7 SQL migrations + custom Node.js runner (no sqlite3 CLI needed) | **Working** | `run-migration.js` |
| scripts (Python CLIs) | `scripts/memory-decay.py`, `metrics.py`, `review-candidates.py`, `seed_vectors.py` | Memory lifecycle, retrieval metrics, candidate review, vector seeding | **Working when run directly with `python`; not wired to any `npm run` script despite docs claiming otherwise** | — |
| scripts (tests) | `scripts/test-*.py` | Ad-hoc integration tests for memory/visual/contracts/knowledge-loop | **Working but disconnected**: hand-rolled runner, tests the orphaned Python services, not the live TS servers | — |
| services/vector-search | `services/vector-search` | FastAPI turbovec sidecar: text/code/visual/memory embed+search+persist | **Working**, implements every endpoint the TS clients call; hard-crashes at import if `turbovec` pip package missing | `main.py`, `clip_embedder.py` |
| services/codebase-indexer | `services/codebase-indexer` | Regex-based (not AST) code chunker → `code.tvim` + JSON metadata | **Working**, genuinely consumed by `mcp-codebase` | `indexer.py` |
| services/document-indexer | `services/document-indexer` | Markdown/RST chunker → `text.tvim` + `artifacts` table rows | **Working**, genuinely consumed by `mcp-docs` | `indexer.py` |
| services/dependency-graph | `services/dependency-graph` | Regex import/export parser (JS/TS/Py/Go/Rust) → `dependencies`/`exports` tables | **Working**, genuinely consumed by `mcp-docs` | `extractor.py` |
| services/abstraction-validator | `services/abstraction-validator` | Regex (+ optional LLM) gate for candidate patterns before promotion | **Working, and actually used** by `scripts/review-candidates.py` | `validator.py` |
| services/knowledge_loop | `services/knowledge_loop` | Python re-implementation of extraction/scoring/promotion loop | **Complete but orphaned** — nothing calls it except its own test script | `loop_orchestrator.py`, `pattern_extractor.py`, `quality_scorer.py` |
| services/memory-manager | `services/memory-manager` | Python re-implementation of memory store/recall/decay/promote | **Complete but orphaned** | `memory_manager.py` |
| services/parallel-orchestrator | `services/parallel-orchestrator` | Session/task state machine + rule-based merge-conflict detector/resolver | **Complete but orphaned**; `conflict_resolver.py`'s logic has no TS equivalent at all | `orchestrator.py`, `conflict_resolver.py` |
| services/contract-generator | `services/contract-generator` | Python re-implementation of contract generation/validation | **Complete but orphaned** | `contract_generator.py` |
| services/visual-memory | `services/visual-memory` | Python re-implementation of visual store/search/compare | **Complete but orphaned relative to MCP** (does correctly call the turbovec sidecar) | `visual_manager.py` |
| data/ | `data/` | SQLite database directory | **Absent** — only `knowledge.db-shm` (32KB) and `knowledge.db-wal` (4.2MB) exist; no main `.db` file in this snapshot (`.gitignore` excludes `*.db`) | — |

---

## 3. Architecture

AEOS is a local-first, stdio-based MCP backend intended to be driven by **AiderDesk** (a third-party desktop agent tool), not by anything in this repository. The actual multi-agent orchestration (Architect → Frontend/Backend/DevOps → Review → Implementation, subagent delegation, tool permissions) is entirely **external configuration** documented in `docs/AGENT_CONFIG.md` for AiderDesk's own settings UI — there is no orchestration code in this repo. AEOS supplies retrieval infrastructure that AiderDesk's agents call into via MCP.

Actual code architecture, as built (not as roadmapped):

```
YAML seed files (98) → packages/seed/src/import.ts → SQLite (patterns table + FTS5)
                                                            │
packages/core (Zod schema/types) ──────────────────────────┤
                                                            │
packages/knowledge-db (hybridSearch, ranking, retrieval-log, sqlite-vec, turbovec-client)
                                                            │
        ┌─────────────────┬─────────────────┬──────────────┴───┐
   mcp-design         mcp-backend      mcp-architecture   mcp-engineering
   (thin adapters, all delegate to knowledge-db's hybridSearch())

   mcp-memory, mcp-visual, mcp-contracts, mcp-knowledge-loop, mcp-codebase, mcp-docs
   (each opens its own better-sqlite3 connection directly; does not use knowledge-db)
                                                            │
                                            services/vector-search/main.py (FastAPI, port 8100)
                                            — called over HTTP by TS clients and some Python services
```

Two unrelated Python-side subsystems exist alongside this:
1. **Connected**: `services/{codebase-indexer,document-indexer,dependency-graph}` — offline indexers whose output files/rows are read directly by `mcp-codebase`/`mcp-docs`.
2. **Disconnected**: `services/{knowledge_loop,memory-manager,parallel-orchestrator,contract-generator}` — parallel re-implementations of what the TS MCP servers already do, invoked only by their own test scripts.

## 4. Repository Structure

Confirmed via full `find` against the audit root; the following corrects/extends the brief's "known shape":
- `packages/mcp-*` is **10 packages, not 9**: architecture, backend, codebase, contracts, design, docs, engineering, knowledge-loop, memory, visual.
- `data/` contains only `knowledge.db-shm` (32,768 bytes) and `knowledge.db-wal` (4,210,672 bytes) — no `knowledge.db` main file. The 4.2 MB WAL file is evidence the system was actually run and used during development; its absence here is consistent with `.gitignore:10-12` (`*.db`, `*.sqlite`, `*.sqlite3`).
- `package-lock.json` is a real, populated lockfile (3,319 lines) — `npm install` was genuinely run at some point.
- No `Dockerfile`, `docker-compose.yml`, or CI config (`.github/`, etc.) exists anywhere in the tree.
- `services/vector-search/` additionally contains `.env.example`, `README.md`, `start.sh`, `start.bat` (venv bootstrap + `uvicorn`/`python main.py` launch scripts) — a genuine, if manual, run harness for the one Python service that matters most.

## 5. Packages / Modules

See the Component Inventory (§2) for the full list. Structurally:
- `packages/core` and `packages/knowledge-db` are the only packages with `@agent-kb/*` internal dependencies consumed by other packages (`mcp-design`, `mcp-backend`, `mcp-architecture`, `mcp-engineering`, `seed`).
- The other 6 `mcp-*` packages declare **no** `@agent-kb/core` or `@agent-kb/knowledge-db` dependency in their `package.json` (verified: `packages/mcp-memory/package.json`, `mcp-knowledge-loop/package.json`, `mcp-codebase/package.json`, `mcp-docs/package.json`, `mcp-contracts/package.json`, `mcp-visual/package.json` all list only `@modelcontextprotocol/sdk`, `better-sqlite3`/`zod`/`yaml` as needed — never `@agent-kb/*`). This is a structural, not incidental, fact: they were built to not depend on the shared package.
- `packages/mcp-knowledge-loop/src/server.ts` additionally uses the **low-level** `Server` + `ListToolsRequestSchema`/`CallToolRequestSchema` API from `@modelcontextprotocol/sdk/server/index.js`, while all 9 other servers use the ergonomic `McpServer` + `server.tool(...)` API from `@modelcontextprotocol/sdk/server/mcp.js`. One server, out of ten, is written to a different SDK convention.

## 6. Core Abstractions

The only shared abstraction is `Pattern` (`packages/core/src/types.ts:28-58`) and its Zod counterpart `PatternSchema` (`packages/core/src/schema.ts:3-53`): id, category, domain, name, description, tags, complexity, code, usage_rules, version, status, plus Phase-11 schema-versioning fields (`schema_version`, `framework_version`, `superseded_by`, `deprecated_at`).

`docs/AEOS_TURBOVEC_ROADMAP.md` §5 proposes a unified `KnowledgeArtifact` TypeScript interface (id, type, domain, title, content, source, confidence, tags, project, timestamps) meant to replace the siloed pattern/memory/conversation model. **This interface was never added to `packages/core`.** The `artifacts` SQLite table that implements the idea (`scripts/migrate-to-artifacts.sql:12-64`) exists only as raw SQL; every consumer (`mcp-memory`, `mcp-visual`, `mcp-contracts`, `mcp-knowledge-loop`) hand-writes `INSERT INTO artifacts (...)` with its own column list and its own loosely-typed (`Record<string, unknown>` / `any`) row-mapping, with no shared type checking any of it. The "unified artifact model" is a database convention, not a code abstraction.

Phase 4.5 also defines standalone types with no consumers beyond their own module: `UcbExplorationConfig` (`core/src/types.ts:133-137`) is never read from — `ranking.ts:99` hardcodes `{ explorationConstant: 2.0, minRetrievalsForExploration: 5 }` as a literal instead of accepting a config object of this shape.

## 7. Memory Model

Phase 7 "agent memory" is implemented **three separate times**:
1. `packages/mcp-memory/src/server.ts` — the live MCP surface. Tools: `store_memory`, `search_agent_memories`, `get_memory`, `list_memories`, `mark_memory_useful`, `memory_stats`. No decay or promotion tool is exposed here.
2. `services/memory-manager/memory_manager.py` — a complete `MemoryManager` Python class with the same store/recall plus `run_decay_cycle()` and `promote_memory()`. Confirmed via repo-wide grep: imported by nothing except `scripts/test-memory.py`.
3. `scripts/memory-decay.py` — a standalone CLI that **re-implements** flag/promote/archive logic a third time, inline, rather than importing `MemoryManager` from (2).

Memories are stored as `artifacts` rows with `type='memory'`, `decay_status` (active/flagged/promoted/archived), `access_count`, `confidence`; lifecycle tables are `memory_sessions`, `memory_access_log`, `memory_decay_log` (`scripts/migrate-memory.sql:43-96`). Decay threshold defaults to 30 days unaccessed; promotion needs `access_count >= 5` and `confidence >= 0.8`, capped at 5 auto-promotions/week — these thresholds are duplicated (with matching values) across all three implementations. Recall falls back turbovec → FTS5 (`artifacts_fts`) → `LIKE` in both the TS and Python versions.

## 8. Knowledge Model

Two coexisting models:
1. **Original** — `patterns` table (`packages/knowledge-db/src/db.ts:29-72`): the 98 YAML files in `packages/seed/`, validated by `PatternSchema`, embedded, and inserted via `packages/seed/src/import.ts:18-53`.
2. **Unified** — `artifacts` table (`scripts/migrate-to-artifacts.sql`), added later, superset of `patterns` plus `type`, `source`, `confidence`, `vec_id`, `project`, decay/promotion fields.

**Concrete bug found**: `PatternSchema` (`packages/core/src/schema.ts`) is a plain `z.object()`, which silently strips unrecognized keys on `.parse()` (`packages/seed/src/import.ts:34`). Three of the six files in `packages/seed/design/principles/` — `usability-first.yaml`, `frictionless-experience.yaml`, `intuitive-navigation.yaml` — use a schema shape (`priority`, `rules`, `avoid`, `principles`, `success_indicators`, `anti_patterns`) that does not exist anywhere in `PatternSchema`. On import, all of that content — the actual substance of these three principle files — is discarded; only `id/category/domain/name/description/tags/status/version` survive. The other three principle files in the same category (`purposeful-motion.yaml` in both `design/principles/` and `design/motion/principles/`, and `engineering/principles/simplicity-over-abstraction.yaml`) correctly use `usage_rules`/`avoid_when` and import cleanly. This is a localized, silent data-loss bug, not a systemic one — sampling across `architecture/decisions`, `architecture/anti-patterns`, `backend/auth`, `backend/database`, and `engineering/review` found no other instances.

98 YAML files matches `README.md`'s "Seed the knowledge base (98 patterns)" claim exactly (verified by `find ... -name "*.yaml" | wc -l`).

## 9. Storage

SQLite via `better-sqlite3`, WAL mode, single file at `data/knowledge.db`. Schema is provisioned through **two independent, unsynchronized mechanisms**:
- `packages/knowledge-db/src/db.ts:initSchema()` (lines 28–258) — creates `patterns`, `patterns_fts`, `deprecation_log`, `framework_registry`, `schema_versions`, `retrieval_log` (with a `task_id` column), `pattern_metrics`, `aging_actions`, `evaluation_results`, `diversity_metrics`, `oii_snapshots`, `trade_off_log`.
- Seven `scripts/migrate-*.sql` files, run manually via `scripts/run-migration.js` — create `artifacts`, `memory_*`, `visual_*`, `api_contracts`/`agent_tasks`/`merge_results`, `knowledge_candidates`/`quality_scores`/`promotion_log`, `dependencies`/`exports`, `framework_registry` (again), `schema_versions` (again).

**Concrete evidence of the drift this causes**: `scripts/migrate-to-artifacts.sql:107-117` creates its own `retrieval_log` with a `session_id` column, conflicting with `db.ts`'s `task_id` column. `db.ts` ships a dedicated repair function, `repairRetrievalLogSchema()` (lines 273-303), that detects and `ALTER TABLE ... RENAME COLUMN session_id TO task_id` at runtime specifically to reconcile this. This is strong, first-party evidence that the two schema-provisioning paths have genuinely diverged in practice, not just in theory.

## 10. Retrieval

`hybridSearch()` (`packages/knowledge-db/src/search/hybrid.ts:55-165`) is the single retrieval entry point used by all 4 original MCP servers. Pipeline: metadata pre-filter (SQL `WHERE`) → FTS5 keyword scoring → vector scoring (fallback chain) → tag-match scoring → performance-score lookup → UCB exploration-score lookup → weighted linear combination → top-N fetch → `logRetrieval()` (fire-and-forget). Every stage is wrapped in try/catch that degrades to an empty/zero result rather than throwing — confirmed a deliberate policy, documented explicitly in `packages/knowledge-db/src/contracts.ts:34-38` ("Never throws — returns empty array on error").

## 11. Hybrid Search

Weights (`hybrid.ts:96-104`):
```
useTurbovec: keyword 0.20, vector 0.50, tag 0.20, metadata 0.10
no turbovec:  keyword 0.25, vector 0.45, tag 0.20, metadata 0.10
+ performanceScore × 1.5   (additive, not part of the 1.0 budget)
+ explorationScore × 0.3   (additive, not part of the 1.0 budget)
```
This matches `README.md:241-267`'s documented formula field-for-field. Because the performance and exploration terms are *added* on top of an already-normalized 0–1 base score rather than blended into it, a pattern with a strong usage history can score well above 1.0 and dominate ranking regardless of query relevance — this is a real design property, not a bug, but it means "proven" patterns can outrank query-relevant ones.

## 12. FTS/BM25

SQLite FTS5 virtual tables (`patterns_fts`, `artifacts_fts`, `candidate_fts`, `visual_fts`), each with matching `content_rowid` triggers to stay in sync on insert/update/delete (`db.ts:74-106`; `scripts/migrate-to-artifacts.sql:77-104`). Query construction is naive: `fullTextSearch()` (`hybrid.ts:318-354`) splits on whitespace, drops words ≤2 chars, quotes each token, and joins with `OR` — no phrase queries, no stemming, no synonym handling. BM25-style relevance comes from FTS5's built-in `rank` column, normalized by dividing by the top result's rank magnitude.

## 13. Vector Search

Three-tier fallback, tried in order by `vectorSearchHybrid()` (`hybrid.ts:170-186`):
1. **sqlite-vec** (`packages/knowledge-db/src/sqlite-vec.ts`) — in-process `vec0` virtual table, 384-dim float, no sidecar process. Explicitly documented (file docblock, lines 1-19) as **replacing** turbovec as of "AEOS Phase 11."
2. **turbovec sidecar** (`packages/knowledge-db/src/turbovec-client.ts`) — HTTP client to `http://127.0.0.1:8100`, 5s timeout, 30s availability-check cache. Requires a separately-run Python/FastAPI process (`services/vector-search/main.py`).
3. **In-process cosine** over JSON-serialized embeddings stored in the `patterns.embedding` column — always available, the original fallback before either of the above existed.

Text embeddings are generated **locally in Node** via `@xenova/transformers` (`all-MiniLM-L6-v2`, quantized) — no external API call needed (`packages/knowledge-db/src/embeddings.ts:1-20`). Image (CLIP, 512-dim) embeddings have **no JS equivalent at all** — `mcp-visual` and `services/visual-memory` both hard-depend on the Python sidecar's `/visual/*` endpoints for anything image-related; if the sidecar is down, image search returns nothing (text-only fallback via FTS5 still works for `search_visual_references`, but `search_similar_visuals` (image→image) has no fallback path whatsoever).

`services/vector-search/main.py:34-39` raises `ImportError` and refuses to start at all if the `turbovec` pip package is missing — there is no graceful degradation at the sidecar level, only at the TS-client level (which treats connection failure/timeout as "sidecar down" and falls through the chain above).

## 14. Ranking

`packages/knowledge-db/src/ranking.ts`, split out specifically to be a separate module from retrieval per the "Phase 4.5" architectural rule documented in `packages/knowledge-db/src/contracts.ts`. Two scores:
- `getPerformanceScores()` (lines 22-62): `successRate×0.5 + min(avgReviewScore/10,1)×0.3 + min(useRate,1)×0.2`, read from `pattern_metrics`.
- `getExplorationScores()` (lines 76-150): standard UCB1, `C×√(ln(N)/n)`, `C=2.0` hardcoded, unretrieved patterns get the max score (1.0), skipped entirely if total retrievals < 5.

Both are pure functions over SQLite aggregates, never throw, and both are unit-testable in isolation — but neither has an automated test.

## 15. Reranking

**Not present as a distinct stage.** There is no cross-encoder, no LLM-based reranker, and no second-pass re-scoring of the top-K. The "performance boost" and "UCB exploration" terms described under Ranking function as reranking signals but are folded into the same single weighted-sum pass as the primary retrieval scores (§11), not applied afterward to a shortlist.

## 16. Learning

Real, but split into a working half and a broken half:
- **Working**: `retrieval_log` → `pattern_metrics` (aggregated) → `getPerformanceScores()` → ranking boost. `logRetrieval()` is called automatically at the end of every `hybridSearch()` (`hybrid.ts:152-162`), so "was this pattern retrieved" is tracked with no extra effort from any caller.
- **Broken (structurally incomplete)**: `logUsage()`, `logSuccess()`, and `logReview()` (`packages/knowledge-db/src/retrieval-log.ts:76-188`) are exported from the package's public `index.ts` (lines 25-27) and formally documented as inter-module contracts in `contracts.ts:72-110` — but a repo-wide grep across every `packages/` file confirms **zero callers outside `knowledge-db` itself**. No MCP tool in any of the 10 servers exposes a way to call them. The learning loop that is supposed to close ("agent uses pattern → reports success → ranking improves") has no entry point for an agent to actually report back. Only the "was it retrieved" half of the loop runs in practice.

Candidate-pattern learning (extracting *new* knowledge from agent behavior) is the separate "Knowledge Loop" system — see §19.

## 17. Feedback

See §16. The `CONTEXT_BUDGET_SAFE_FIELDS` allowlist and `stripToContextBudget()`/`validateContextBudget()` functions (`retrieval-log.ts:203-248`), meant to guarantee agents never receive review logs or usage history, are likewise **defined but never called anywhere** outside their own file (confirmed by grep). `search/hybrid.ts`'s `SearchResult` construction (lines 128-149) happens to only assign safe-looking fields, but this is achieved by manual field-by-field object construction, not by calling the enforcement function that exists specifically for this purpose. The stated "hard rule" has no enforcement mechanism actually wired into the code path.

## 18. Knowledge Aging

Real and working, but duplicated within the TypeScript codebase itself:
- `packages/knowledge-db/src/repositories/patterns.ts:runKnowledgeAging()` (lines 318-514) — the "full" version, with `AGING_THRESHOLDS` (lines 275-305) covering promote/elevate/trust/decay/demote/archive, including the Phase-4.5 promotion tiers (standard/elevated/trusted).
- `packages/mcp-knowledge-loop/src/server.ts:runKnowledgeAging()` (lines 1079-1224) — a **second, independent implementation** of the same rules against the same tables, missing the elevated/trusted tier logic, reachable via the `run_knowledge_aging` MCP tool. This server cannot import the first version because it has no dependency on `@agent-kb/knowledge-db` (§5) — the duplication is a direct consequence of that architectural split.

Rules (both versions): use_count≥5 + success≥80% + use_rate≥60% → promote; <3 uses in 60+ days → decay; use_count≥3 + success<30% → demote (deprecate); <2 uses + success<20% + 90+ days stale → archive. Max 3 promotions / 10 demotions per run in both.

## 19. Promotion / Demotion

The candidate lifecycle (`pending → scored → promoted|staged|archived|rejected`) lives in `knowledge_candidates` (`scripts/migrate-knowledge-loop.sql:16-43`), with `promotion_log`/`demotion_log`/`pattern_versions`/`loop_runs`/`guardrail_state` tables alongside it. Guardrails: max 5 system-promotions/week, max 50 extractions/day (seeded in `migrate-knowledge-loop.sql:196-201`).

**Two independently-written scoring algorithms exist for "the same" Phase-10 loop**, and they disagree:
- `services/knowledge_loop/quality_scorer.py` — matches the documented design (`docs/INSTALL_GUIDE.md:171-179`) exactly: `frequency×0.20 + impact×0.25 + consistency×0.20 + novelty×0.20 + abstraction×0.15`, with novelty computed via turbovec cosine-similarity duplicate detection (>0.92 = duplicate, >0.75 = related).
- `packages/mcp-knowledge-loop/src/server.ts` (the live one, function `scoreCandidate()` around lines 465-603, comment-labeled "AEOS Phase 5: Effectiveness-based scoring") — a **different formula**: `taskUsageWeight×0.3 + successWeight×0.4 + reviewWeight×0.3`, gated by `usageCount≥3 && successRate≥0.7 && uniqueTaskCount≥2 && abstractionScore≥0.3`. No frequency/consistency/novelty dimensions at all; no turbovec duplicate check.

Since only the TS version is reachable via MCP, **the documented scoring design in `docs/INSTALL_GUIDE.md` does not describe what actually runs.**

A genuinely interesting, working feature: `promote_to_yaml` / `bulk_promote_to_yaml` (`mcp-knowledge-loop/src/server.ts:897-1068`) write approved candidates back out as new `.yaml` files into the correct `packages/seed/<domain>/<category>/` subdirectory — a real, if unidirectional, write-back path from the learned-knowledge loop into the hand-authored seed corpus.

## 20. Context Management

Limited to the (unenforced) `CONTEXT_BUDGET_SAFE_FIELDS` allowlist described in §17. There is no broader context-window management, no prompt-assembly logic, and no context-compilation layer anywhere in this codebase — AEOS returns raw JSON search results over MCP; assembling them into an agent's context/prompt is entirely the calling agent's (AiderDesk's) responsibility.

## 21. Token Optimization

**Not present.** No token-counting library (no `tiktoken` or equivalent), no truncation-by-token-budget logic, no summarization step before returning results. Result size is controlled only by the `limit` parameter on search queries and by ad hoc string slicing in a few places (e.g., `content.slice(0, 500)` when embedding text). The "token budget" language in the docs (`README.md`, "Context Budget Protection") refers to *field selection* (excluding metadata), not token counting.

## 22. Codebase Intelligence

`services/codebase-indexer/indexer.py` walks a target project, chunks files, embeds via `sentence-transformers`, and writes `code.tvim` + `code_chunks.json` + `code_id_map.json`. `packages/mcp-codebase/src/server.ts` reads those two JSON files directly and calls the turbovec sidecar's `/code/search` endpoint for the vector half — this is a real, working cross-language integration (unlike most of the Python services). One documentation/implementation gap: `docs/AEOS_TURBOVEC_ROADMAP.md` §8 explicitly claims chunking is "AST-Based, Not Naive" via tree-sitter; the actual chunker (`indexer.py:145-249`) uses **regex pattern matching** against function/class signatures with brace-counting to find boundaries — no `tree-sitter` dependency exists anywhere in the repository (confirmed by grep). It is a reasonable regex chunker, but it is not the AST-based approach the roadmap describes. `mcp-codebase` has **no fallback** if the turbovec sidecar is unreachable — `search_codebase` returns a "not indexed / sidecar not running" message rather than degrading to keyword search.

## 23. Documentation Intelligence

`services/document-indexer/indexer.py` chunks Markdown/RST/plain-text by heading (falling back to paragraph splitting), writes `doc_chunks.json`, and inserts rows into the `artifacts` table directly via `sqlite3`. `packages/mcp-docs/src/server.ts` reads the JSON for doc search (turbovec-only, filtered to a `vec_id >= 100_000` offset range to distinguish docs from other embedding types — a real if fragile ID-partitioning scheme) and opens its own **read-only** SQLite connection for the dependency-graph tools (`what_breaks_if_changed`, `get_dependencies`, `get_exports`, `dependency_stats`), which work off `services/dependency-graph/extractor.py`'s regex-parsed import/export tables and function with **no turbovec dependency at all**. This is the most self-contained, dependency-light tool group in the whole MCP surface.

## 24. MCP

10 MCP servers total (README's own table lists all 10; the mission brief's count of "nine" is an undercount — verified directly against the file tree). Wiring is **inconsistent across the repo's own documentation**:
- `mcp-config.json` (root) registers only 4 servers: design, backend, architecture, engineering.
- `docs/AGENT_CONFIG.md:40-92` registers 6: the same 4, plus `codebase-knowledge` and `docs-dependencies`.
- `README.md`'s "Quick Start" section instructs adding all 10, including `memory-knowledge`, `visual-knowledge`, `contracts-knowledge`, `knowledge-loop`.

No single file in the repo reflects the full, current set of 10 servers consistently. Tool-name accuracy against `README.md`'s top-level "MCP Servers" table is also inconsistent: the original 4 servers' tool names match the README **exactly**; all 6 later servers have tool names in code that **do not match** the README's summary (e.g., README lists `mcp-memory` tools as `store_memory, recall_memory, list_memories, delete_memory`; actual tools are `store_memory, search_agent_memories, get_memory, list_memories, mark_memory_useful, memory_stats` — `recall_memory` and `delete_memory` don't exist, and two real tools aren't listed). Transport is stdio-only for every server; the roadmap's planned HTTP/SSE remote-transport option (`docs/AEOS_TURBOVEC_ROADMAP.md` §12) has zero implementation (grep for `SSEServerTransport`/`MCP_TRANSPORT`/`express()` across `packages/` returns nothing).

## 25. Agent Integration

AEOS does not integrate with agents directly; it exposes MCP tools for **AiderDesk** to call. `docs/AGENT_CONFIG.md` documents AiderDesk's own per-agent settings (model, temperature, iteration limits, tool allow/deny lists, which MCP servers each of the 6 agents — Architect/Frontend/Backend/DevOps/Review/Implementation — may call) as external product configuration, not as code in this repository. There is no agent-routing, prompt-construction, or subagent-spawning code anywhere in AEOS itself.

## 26. Orchestration

Two layers, both partial:
- `packages/mcp-contracts/src/server.ts` — live, MCP-reachable session/task/merge tracking (`create_parallel_session`, `manage_parallel_task`, `merge_parallel_session`, `review_parallel_session`). Status transitions are applied directly via `UPDATE` with **no validation** that the transition is legal.
- `services/parallel-orchestrator/orchestrator.py` + `conflict_resolver.py` — orphaned (§Duplicated Components), but strictly more capable: `orchestrator.py` enforces a `SESSION_TRANSITIONS`/`TASK_TRANSITIONS` state machine (`orchestrator.py:57-73`) that raises on illegal transitions; `conflict_resolver.py` implements actual conflict detection and resolution (file-ownership rules by path pattern, JSON deep-merge, difflib line-merge, "interface drift" detection by regex-matching `fetch()`/`axios()` calls against Express-style route declarations) that **has no TypeScript equivalent at all** — this logic is unreachable from any MCP tool.

Neither layer spawns, schedules, or executes agents concurrently; "parallel" here means two conceptually-simultaneous agent workstreams tracked as rows in SQLite, not actual concurrent process/thread execution within this codebase.

## 27. APIs

No public REST/GraphQL API for the knowledge base itself — MCP (stdio) is the only external interface by design. The one HTTP API in the system is `services/vector-search/main.py`'s FastAPI sidecar, bound to `127.0.0.1:8100` only, intended purely as an internal implementation detail for vector operations, not a public API.

## 28. CLI

Real, functional, argparse-based Python CLIs exist for nearly every maintenance task: `scripts/memory-decay.py` (stats/flag/promote/archive/interactive review), `scripts/metrics.py` (retrieval quality, dead-weight detection, prune suggestions), `scripts/review-candidates.py` (interactive/auto candidate approval, correctly imports `services/abstraction-validator`), `scripts/seed_vectors.py` (turbovec indexing from SQLite), plus each `services/*-indexer`'s own CLI. **All are invoked only via `python scripts/x.py` directly** — none are wired into `package.json` (§30), so the `npm run` interface documented for them does not exist.

## 29. Configuration

No central configuration module. Every server/script reads its own environment variables independently, with **inconsistent defaults and inconsistent path-resolution strategies**:
- `packages/mcp-memory/src/server.ts:32`, `mcp-visual/src/server.ts:34` — resolve `AEOS_DB_PATH` relative to `__dirname` (the compiled file's own location) via `resolve(__dirname, "../../../data/knowledge.db")`.
- `packages/mcp-docs/src/server.ts:37-43` — resolves relative to a computed `REPO_ROOT` (also `__dirname`-anchored).
- `packages/mcp-knowledge-loop/src/server.ts:35` — `const DB_PATH = process.env.KNOWLEDGE_DB_PATH || path.resolve("data/knowledge.db");` — resolves **relative to `process.cwd()`**, not the script location. If this server is spawned with a different working directory than the repo root (a realistic scenario for an MCP server launched by an external tool like AiderDesk with args pointing at an absolute `dist/server.js` path but no fixed cwd), it will silently create or open a different database file than every other server. This is a concrete, citable latent bug.

## 30. Testing

**No automated tests exist for any TypeScript code** — no `*.test.ts` files, no `jest`/`vitest`/`mocha` dependency in any `package.json` across the 12 TS packages inspected. The only tests in the repository are four Python scripts (`scripts/test-contracts.py`, `test-knowledge-loop.py`, `test-memory.py`, `test-visual.py`), each using a hand-rolled `test(name, fn)` helper with global `PASSED`/`FAILED` counters (confirmed pattern, e.g. `test-memory.py:45-56`) — not pytest, not unittest. Each spins up a fresh temp SQLite DB via `tempfile.mkdtemp()` and applies the relevant `.sql` migrations directly, then exercises the **orphaned Python service classes** (`sys.path.insert` hacks to import `services/memory-manager`, etc.) — meaning these tests validate code that the live MCP servers never call, not the live servers themselves. None of the four are wired into `package.json`, and no CI configuration exists anywhere in the tree to run them automatically.

## 31. Evaluation

`packages/knowledge-db/src/evaluation.ts` is real and complete: `evaluateRetrieval()` computes Precision@K/Recall@K/NDCG@K (K = 1,3,5,10) and MRR against pseudo-relevance judgments derived from `retrieval_log` rows where `used=1` (`buildEvaluationQueries()`, lines 134-176), persisting results to `evaluation_results`. It is exported from the package's public API but, like the feedback functions in §16-17, **is not exposed as an MCP tool anywhere** — it is only callable by writing new TypeScript code against the package directly. `getLatestEvaluations()` exists for trend comparison but nothing schedules evaluations to run periodically.

## 32. Observability

The richest part of the schema: `retrieval_log`, `pattern_metrics`, `aging_actions`, `evaluation_results`, `diversity_metrics`, `oii_snapshots`, `trade_off_log` (`db.ts:135-244`) form a genuinely thoughtful telemetry model, including a composite "Overall Improvement Index" (`oii.ts:63-72`: weighted review-score/edit-rate/precision/success-rate/completion-time, deliberately excluding raw pattern count from the formula so that "adding more YAML files" cannot masquerade as "the system getting better" — a specific, documented design decision, `oii.ts:15-17`). `scripts/metrics.py` provides a human-readable CLI view (top patterns, dead-weight detection, auto-prune suggestions) over the same tables. All of this is genuinely useful and correctly implemented — but nothing in the system runs it automatically; every metric is computed only when a human (or an agent, if it had a tool for it — it doesn't, see §31) explicitly triggers it.

## 33. Deployment

**Not present.** No `Dockerfile`, no `docker-compose.yml`, no CI/CD pipeline, no cloud deployment config of any kind, despite `docs/AGENT_CONFIG.md`'s DevOps-agent rules elsewhere mandating "Containerize everything (Docker)" as a rule *for code that agent should write in other projects* — the rule is not applied reflexively to AEOS's own packaging. The system's actual deployment model is: local processes, spawned via stdio by AiderDesk, reading a local SQLite file, optionally alongside a manually-started local Python sidecar (`start.sh`/`start.bat`). `docs/AEOS_TURBOVEC_ROADMAP.md` §12 describes a Tailscale/Cloudflare-Tunnel remote-access plan in detail; it is narrative only — no code implements it (§24).

## 34. Incomplete Components

- HTTP/SSE MCP transport (planned, zero code, §24).
- Feedback reporting tools (`logUsage`/`logSuccess`/`logReview` have no MCP tool, §16-17).
- Context-budget enforcement function exists but is never called (§17).
- `mcp-config.json` registers 4 of 10 servers; no file registers all 10 (§24).
- `KnowledgeArtifact` unified type was roadmapped but never added to `packages/core` (§6).
- `UcbExplorationConfig` type defined but not wired to any actual configuration surface (§6).
- npm script surface: ~20 documented scripts across `README.md`/`docs/INSTALL_GUIDE.md` do not exist in `package.json` (§28, §35).
- Codebase indexer chunking is regex-based, not the AST/tree-sitter approach the roadmap specifies (§22).

## 35. Duplicated Components

This is the dominant pattern in the newer half of the codebase:

| Concern | TypeScript (live, MCP-reachable) | Python (orphaned except own tests) | Notes |
|---|---|---|---|
| Agent memory | `packages/mcp-memory/src/server.ts` | `services/memory-manager/memory_manager.py` **and** `scripts/memory-decay.py` (a 3rd, independent re-implementation) | 3 implementations of store/recall/decay/promote |
| Knowledge loop scoring | `packages/mcp-knowledge-loop/src/server.ts` (effectiveness formula) | `services/knowledge_loop/quality_scorer.py` (frequency/impact/consistency/novelty/abstraction formula) | Different algorithms, both labeled "Phase 10" |
| Knowledge aging | `packages/knowledge-db/src/repositories/patterns.ts` (full, with tiers) | `packages/mcp-knowledge-loop/src/server.ts`'s own copy (no tiers) | Duplicated **within** TS itself, not just TS-vs-Python |
| Parallel-session state machine | `packages/mcp-contracts/src/server.ts` (no transition validation) | `services/parallel-orchestrator/orchestrator.py` (validated transitions) | |
| Merge-conflict resolution | **none** | `services/parallel-orchestrator/conflict_resolver.py` | Only exists in the orphaned half |
| Contract generation | `packages/mcp-contracts/src/server.ts` | `services/contract-generator/contract_generator.py` | Near-identical schema-subset validation logic |
| DB connection boilerplate | `packages/knowledge-db/src/db.ts:getDb()` — reimplemented independently (near-identical `new Database(); pragma WAL; pragma foreign_keys`) in `mcp-memory`, `mcp-visual`, `mcp-contracts`, `mcp-knowledge-loop`, `mcp-docs` | — | 6 copies of the same ~8 lines |

## 36. Technical Debt

- Two unsynchronized schema-provisioning paths (code-defined `initSchema()` vs. 7 hand-maintained `.sql` files) with a demonstrated real-world drift and a dedicated runtime repair function (`repairRetrievalLogSchema()`) to paper over it (§9).
- Silent data loss on import for 3 of 98 seed YAML files due to a schema mismatch that Zod's default (non-strict) parsing swallows without warning (§8).
- `mcp-knowledge-loop/server.ts`'s CWD-relative (not `__dirname`-relative) database path resolution — inconsistent with every other server and a plausible source of "wrong database opened" bugs (§29).
- `services/vector-search/main.py` hard-crashes at process start if `turbovec` isn't installed, despite the surrounding documentation's "graceful fallback" framing (§13).
- Documentation actively describes capabilities/interfaces that don't exist: ~20 phantom `npm run` scripts (§28), tool names that don't match 6 of 10 servers (§24), an "AST-based" chunker that is actually regex (§22), a "frequency/impact/consistency/novelty/abstraction" scoring formula that the live server doesn't use (§19).
- Unpinned Python dependencies: every `requirements.txt` uses `>=` only, no lockfile equivalent (`pip freeze`/`poetry.lock`) anywhere in the Python side, in contrast to the disciplined `package-lock.json` on the TS side.
- Inconsistent MCP SDK usage: 1 of 10 servers uses the low-level `Server` API while the other 9 use `McpServer` (§5).
- `turbovec` itself is a dependency risk: a single-author, early-stage (`v0.x`), narrowly-adopted open-source project that multiple "load-bearing per the docs" subsystems (visual search entirely, codebase/doc search partially) still hard-depend on for anything beyond the sqlite-vec-covered text-pattern case.

## 37. Architectural Coupling

Two clearly different coupling styles coexist in the same repo:
- **Loose/clean** (the original 4 servers + `knowledge-db`): a single shared package owns all DB/business logic; MCP servers are genuinely thin adapters (`server.tool(...) → hybridSearch(...) → JSON.stringify`). This is the intended, documented architecture (`contracts.ts`'s "Module Contracts" registry exists specifically to keep this boundary explicit).
- **Tight/duplicated** (everything from Phase 7 onward): each new MCP server was built as a standalone unit with its own DB connection and its own copy of business logic, rather than extending `knowledge-db`. The Python `services/` layer compounds this by re-implementing the same logic a third time for several concerns. The only real integration contract between the TS and Python halves, for the disconnected components, is an informal one: matching column names in hand-written SQL against the same SQLite file — there is no shared schema-definition language, so any schema change must be manually kept in sync across TS `initSchema()`, the relevant `.sql` migration, and every Python file's raw `INSERT`/`SELECT` statements. The `task_id`/`session_id` drift documented in §9 is the concrete, already-realized cost of this coupling style.
