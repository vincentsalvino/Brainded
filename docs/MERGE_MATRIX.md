# Merge Matrix — Component-Level Migration Decisions

Every significant component from `AUDIT_AEOS.md` and `AUDIT_AEOS_BRAIN.md`, classified against the target architecture in `BLUEPRINT.md`/`ARCHITECTURE.md`. Decisions: **KEEP** (use as-is), **ADAPT** (reuse the concept/design, modify the implementation), **REWRITE** (concept is right, implementation must be built fresh), **DROP** (do not carry forward), **INVESTIGATE** (insufficient evidence or an open design question — resolve before committing).

Target layers reference `BLUEPRINT.md`'s suggested package layout (`packages/core/{contracts,memory,retrieval,ranking,context,compression,learning,token}`, `packages/storage`, `packages/codebase`, `packages/knowledge`, `packages/mcp`, `packages/sdk`, `packages/cli`).

---

## Contracts / Core Types

#### Zod Pattern schema + TS types
- **Source:** AEOS — `packages/core/src/{schema,types}.ts`
- **Purpose:** Shared, validated shape for a knowledge pattern
- **Status:** Working, but non-strict — silently strips unrecognized fields (confirmed data loss on 3/98 seed files, `AUDIT_AEOS.md §8`)
- **Dependencies:** Zod
- **Strengths:** Single shared contract consumed by 4 of the project's cleanest packages; validated approach (schema-first, typed)
- **Weaknesses:** Non-strict parsing is a silent-data-loss bug; too narrow for the new 12-type memory model; the roadmapped unified `KnowledgeArtifact` type was never actually added here
- **Architectural compatibility:** High — schema-first contracts is exactly what `packages/core/contracts/` should be
- **Target Brain layer:** `packages/core/contracts`
- **Migration strategy:** Redesign the type taxonomy around the blueprint's 12 memory types + scope model from scratch; keep the "Zod schema is the single source of truth for shape + runtime validation" pattern; use `.strict()` (or a discriminated union) so unrecognized fields error instead of vanishing
- **Decision: ADAPT**
- **Reason:** The pattern (schema-first shared contracts) is sound and proven; the specific schema is too narrow and has a known correctness bug

---

## Memory

#### `memories` unified table (SEED + REFINERY via `source` column)
- **Source:** AEOS-brain — `Memory/supabase/migrations/*.sql`
- **Purpose:** One table, one retrieval surface, for both curated and episodic knowledge
- **Status:** Working
- **Dependencies:** Postgres
- **Strengths:** Proves the "one memory surface, differentiated by field" design goal is achievable and was actually shipped, not just proposed (`AUDIT_AEOS_BRAIN.md §6`)
- **Weaknesses:** Only a 2-way type split (SEED/REFINERY) where the new Brain needs 12 explicit types; no provenance/versioning beyond a free-text `agent` column and no audit trail for manual edits (`AUDIT_AEOS_BRAIN.md §5`)
- **Architectural compatibility:** High as a design principle; the physical schema is Postgres-specific and not directly portable to the blueprint's SQLite-first direction
- **Target Brain layer:** `packages/core/memory`
- **Migration strategy:** Treat as a proof-of-concept for unification, not a schema to port. Design the actual 12-type schema fresh, on SQLite, with per-edit provenance/audit logging from day one (AEOS-brain's own audit flags the missing-audit-trail-on-manual-edit gap explicitly)
- **Decision: ADAPT**
- **Reason:** Validates the unification principle the blueprint already wants; implementation is the wrong storage engine and too coarse-grained to reuse directly

#### Status tier lifecycle (Candidate → Elevated → Trusted) + `aging_actions` audit log
- **Source:** AEOS-brain — `engine.py`, `merge_seed_patterns.sql`
- **Purpose:** Automated memory lifecycle with an audit trail of every automated decision
- **Status:** Schema working; the promotion logic that drives it is broken (depends on the dead `pattern_metrics` path, see Learning section)
- **Dependencies:** `pattern_metrics` (broken upstream)
- **Strengths:** Matches `ARCHITECTURE.md §19`'s Memory Lifecycle diagram closely; the audit-log-for-automated-decisions pattern is good practice
- **Weaknesses:** Currently unreachable by real data; no equivalent audit trail for manual edits
- **Architectural compatibility:** High
- **Target Brain layer:** `packages/core/memory` (lifecycle) + `packages/core/learning` (the signals that drive transitions)
- **Migration strategy:** Reuse the tier concept and the audit-log-every-transition practice; fix by construction — the promotion signal source must be load-bearing and tested, not aspirational
- **Decision: ADAPT**
- **Reason:** Good schema-level design; must not repeat the "logic exists but nothing feeds it" failure

#### `runKnowledgeAging()` (tiered promote/decay/demote/archive)
- **Source:** AEOS — `packages/knowledge-db/src/repositories/patterns.ts` (full version, with elevated/trusted tiers)
- **Purpose:** Threshold-based automated knowledge lifecycle management
- **Status:** Working, but duplicated by a second, weaker in-repo implementation (`AUDIT_AEOS.md §18`)
- **Dependencies:** `pattern_metrics`-equivalent aggregates
- **Strengths:** Thresholds cross-validated by AEOS-brain's independent "ported" implementation — two independent authors' attempts converge on a similar rule shape
- **Weaknesses:** Hardcoded thresholds, not configuration-driven; duplicated within the same codebase
- **Architectural compatibility:** High
- **Target Brain layer:** `packages/core/learning`
- **Migration strategy:** Single implementation, config-driven thresholds, reachable via the stable `brain_*` protocol (not only internal)
- **Decision: ADAPT**
- **Reason:** Rule shape is validated by independent convergence; needs one canonical implementation instead of three

---

## Retrieval

#### `hybridSearch()` — FTS5 + vector fallback chain + tags + performance + UCB exploration
- **Source:** AEOS — `packages/knowledge-db/src/search/hybrid.ts`
- **Purpose:** Single retrieval entry point combining multiple relevance signals
- **Status:** Working, matches its own documentation almost exactly (`AUDIT_AEOS.md §10-11`)
- **Dependencies:** `packages/knowledge-db` internals, sqlite-vec/turbovec/in-process-cosine fallback chain
- **Strengths:** Genuinely the most mature code in either codebase; defensive (never throws); signal set maps closely to `ARCHITECTURE.md §9-10`'s retrieval pipeline (lexical + semantic + tags + performance + exploration)
- **Weaknesses:** Reranking signals are folded additively into the same weighted-sum pass as primary scoring rather than applied as a distinct stage afterward, which the blueprint's pipeline treats as separate steps; performance/exploration terms are added on top of a normalized base score without re-normalizing, so heavily-used patterns can dominate ranking regardless of query relevance (a real, documented design property, not a bug — but worth a deliberate decision either way in the new design)
- **Architectural compatibility:** High in spirit, needs restructuring to match the blueprint's explicit stage separation (candidate generation → reranking → dedup/conflict → compile, `ARCHITECTURE.md §9-11`)
- **Target Brain layer:** `packages/core/retrieval` (candidate generation) + `packages/core/ranking` (reranking, split out)
- **Migration strategy:** Port the signal set and the "never throws, degrades gracefully" discipline; restructure into the blueprint's explicit multi-stage pipeline rather than one weighted-sum pass
- **Decision: ADAPT**
- **Reason:** Best-proven retrieval logic available in either codebase; needs restructuring, not reinvention

#### `match_memories` RPC — single-query weighted hybrid scoring
- **Source:** AEOS-brain — `Memory/supabase/migrations/20240601000002_merge_seed_patterns.sql`
- **Purpose:** Server-side (Postgres) combined vector + FTS + tag + performance + quality scoring in one query
- **Status:** Working (v2 is live; v1 superseded)
- **Dependencies:** Postgres, pgvector
- **Strengths:** Clean single-query design; simpler operationally than AEOS's multi-stage TS pipeline
- **Weaknesses:** Postgres-specific SQL, not portable to a SQLite-first storage layer; simpler signal set than AEOS's (no exploration term, no diversity)
- **Architectural compatibility:** Medium — the *shape* (one weighted combination, computed close to the data) is reasonable but the storage engine mismatch means the SQL itself cannot move
- **Target Brain layer:** `packages/core/retrieval`
- **Migration strategy:** Port the weighting concept as one input into the redesigned retrieval pipeline (above); do not port the SQL
- **Decision: ADAPT**
- **Reason:** Concept is useful corroboration of AEOS's weighting approach; implementation is storage-engine-specific and cannot be reused directly

---

## Ranking / Learning

#### `ranking.ts` — performance score + UCB1 exploration score
- **Source:** AEOS — `packages/knowledge-db/src/ranking.ts`
- **Purpose:** Separate, pure-function ranking signals decoupled from retrieval
- **Status:** Working, untested
- **Dependencies:** `pattern_metrics`-equivalent aggregates
- **Strengths:** Genuinely unique — AEOS-brain has no exploration mechanism at all; already structurally separated from retrieval per AEOS's own "Phase 4.5" architectural rule, which matches the blueprint's explicit retrieval/ranking separation
- **Weaknesses:** `explorationConstant` hardcoded rather than reading the config type already defined for it (`UcbExplorationConfig`, itself unused); no automated tests
- **Architectural compatibility:** High
- **Target Brain layer:** `packages/core/ranking`
- **Migration strategy:** Port both formulas; wire the exploration constant to actual configuration this time; add tests
- **Decision: ADAPT**
- **Reason:** Only exploration mechanism found in either codebase; already shaped correctly as a separate module

#### `diversity.ts`
- **Source:** AEOS — `packages/knowledge-db/src/diversity.ts`
- **Purpose:** Presumed diversity-aware result selection (named in `ARCHITECTURE.md §9`'s reranking signal list)
- **Status:** Unclear — exists, but the audit's own documented hybrid-search formula (`AUDIT_AEOS.md §11`) does not include a diversity term, so this module's actual call path is not established
- **Dependencies:** Unknown without deeper reading
- **Strengths:** N/A pending investigation
- **Weaknesses:** Possibly unwired, like `evaluation.ts` and the budget-enforcement functions elsewhere in the same package
- **Architectural compatibility:** Diversity is an explicit blueprint reranking signal, so the concept is wanted regardless
- **Target Brain layer:** `packages/core/ranking`
- **Migration strategy:** Read the module directly before deciding; if unwired, treat as a design reference only
- **Decision: INVESTIGATE**
- **Reason:** Audit did not establish whether this is live code or another disconnected module; needs a direct read before a KEEP/ADAPT/DROP call

#### `oii.ts` — Overall Improvement Index
- **Source:** AEOS — `packages/knowledge-db/src/oii.ts`
- **Purpose:** Composite quality metric that deliberately excludes raw pattern count so volume can't masquerade as improvement
- **Status:** Working, complete, well-designed; never runs automatically, not MCP-exposed (`AUDIT_AEOS.md §32`)
- **Dependencies:** `pattern_metrics`, review/edit-rate/completion-time data
- **Strengths:** A specific, documented anti-gaming design decision — directly useful given `ARCHITECTURE.md §22`'s quality metrics list
- **Weaknesses:** Inert; AEOS-brain's parallel attempt at the same concept produced two disagreeing numbers shown in the same UI, a cautionary tale for the same idea, not just a critique of AEOS's version
- **Architectural compatibility:** High
- **Target Brain layer:** `packages/core/learning` / `evaluation/`
- **Migration strategy:** Reuse the anti-gaming design principle as one input signal among the several `ARCHITECTURE.md §22` already lists (tests passing, review score, human edits); wire it into an actual scheduled evaluation run this time
- **Decision: ADAPT**
- **Reason:** Sound methodology, needs to actually run; the composite-metric idea is validated precisely by AEOS-brain's failure to keep two versions of it in sync

#### `evaluation.ts` — Precision@K/Recall@K/NDCG/MRR harness
- **Source:** AEOS — `packages/knowledge-db/src/evaluation.ts`
- **Purpose:** Retrieval quality evaluation against pseudo-relevance judgments derived from usage logs
- **Status:** Working, complete; not MCP-exposed, nothing schedules it (`AUDIT_AEOS.md §31`)
- **Dependencies:** `retrieval_log` with `used=1` rows
- **Strengths:** Matches `ARCHITECTURE.md §22`'s Retrieval quality metrics almost exactly; AEOS-brain has no equivalent at all
- **Weaknesses:** Dead code in practice — only callable by writing new TS against the package
- **Architectural compatibility:** High
- **Target Brain layer:** `evaluation/` (top-level, per blueprint's suggested layout)
- **Migration strategy:** Port the formulas; expose via CLI and/or a scheduled job from day one, not as an opt-in library call
- **Decision: ADAPT**
- **Reason:** The only real evaluation methodology either project has; must not repeat the "correct but unreachable" failure

#### `retrieval-log.ts` — `logUsage`/`logSuccess`/`logReview` + `CONTEXT_BUDGET_SAFE_FIELDS`/`stripToContextBudget`
- **Source:** AEOS — `packages/knowledge-db/src/retrieval-log.ts`
- **Purpose:** Outcome-reporting API and a context-budget-safety allowlist
- **Status:** Defined, exported, formally documented as a contract — zero callers anywhere in the repo (`AUDIT_AEOS.md §16-17`)
- **Dependencies:** `retrieval_log`/`pattern_metrics` tables
- **Strengths:** The function signatures and intent are reasonable and map directly to the blueprint's `brain_feedback`/`brain_record_outcome` operations
- **Weaknesses:** This is the single most important shared failure identified across both audits (`AEOS_COMPARISON.md §6`) — the design exists in both projects and is wired to nothing in either
- **Architectural compatibility:** High as a target, currently dead as an implementation
- **Target Brain layer:** `packages/core/learning` (logging) + `packages/core/context` (budget enforcement)
- **Migration strategy:** Do not "adapt" this passively — rebuild as **load-bearing** infrastructure: every context-compiler exit path must call the budget enforcement function (not just define it), and `brain_feedback`/`brain_record_outcome` must be real, tested, callable MCP operations from the first working version of the Brain, with an end-to-end test proving an agent can report an outcome and see it affect a later ranking
- **Decision: REWRITE**
- **Reason:** Both predecessor projects independently built this and independently failed to wire it in; treating it as a simple port would risk the same failure a third time

---

## Storage

#### SQLite + `better-sqlite3` + WAL + FTS5
- **Source:** AEOS — `packages/knowledge-db/src/db.ts`
- **Purpose:** Local-first primary storage
- **Status:** Working
- **Dependencies:** `better-sqlite3`
- **Strengths:** Directly matches `ARCHITECTURE.md §25`'s storage direction (SQLite, FTS5, local-first); WAL mode and defensive schema-drift repair code show real production experience
- **Weaknesses:** Schema provisioned from two unsynchronized sources (code-defined `initSchema()` vs. seven hand-maintained `.sql` files) that have demonstrably drifted in practice (`AUDIT_AEOS.md §9`)
- **Architectural compatibility:** High
- **Target Brain layer:** `packages/storage`
- **Migration strategy:** Reuse the engine choice and WAL configuration; enforce a **single** schema source of truth this time (either code-first with generated migrations, or migration-first with generated types — not both independently maintained)
- **Decision: ADAPT**
- **Reason:** Right engine, right configuration, wrong schema-governance process

#### `sqlite-vec.ts` — in-process vector search
- **Source:** AEOS — `packages/knowledge-db/src/sqlite-vec.ts`
- **Purpose:** Vector similarity search with no external sidecar process
- **Status:** Working; AEOS's own later code already treats this as superseding `turbovec`
- **Dependencies:** `sqlite-vec` extension
- **Strengths:** No external dependency, no network hop, matches `ARCHITECTURE.md §25` exactly ("sqlite-vec / local vector search")
- **Weaknesses:** None material identified
- **Architectural compatibility:** High
- **Target Brain layer:** `packages/storage`
- **Migration strategy:** Adopt directly as the default vector backend
- **Decision: ADAPT**
- **Reason:** Already the direction both AEOS's own evolution and the target architecture converge on

#### Local embedding generation (`@xenova/transformers`, in-process)
- **Source:** AEOS — `packages/knowledge-db/src/embeddings.ts`
- **Purpose:** Text embeddings with no external API call
- **Status:** Working
- **Dependencies:** `@xenova/transformers`, a quantized `all-MiniLM-L6-v2` model
- **Strengths:** No cost, no network dependency, no external LLM-provider coupling — directly avoids the exact regression AEOS-brain suffered (`AEOS_COMPARISON.md §5, §9`)
- **Weaknesses:** Smaller/lower-quality embeddings than a hosted large model; no image-embedding equivalent
- **Architectural compatibility:** High — matches `ARCHITECTURE.md §25`'s "avoid prematurely coupling to one embedding provider" by not requiring *any* external provider for the default path
- **Target Brain layer:** `packages/storage` (behind a replaceable interface, per the architectural invariant)
- **Migration strategy:** Adopt as the default; define a pluggable embedding-provider interface so a hosted model can be swapped in later without touching callers
- **Decision: ADAPT**
- **Reason:** Directly supports the "storage/embedding implementations hidden behind replaceable interfaces" invariant, and prevents AEOS-brain's worst architectural regression from recurring

#### `turbovec-client.ts` + `services/vector-search` FastAPI sidecar + `AEOS_TURBOVEC_ROADMAP.md`
- **Source:** AEOS
- **Purpose:** External vector-index sidecar (turbovec) for text/code/visual embeddings
- **Status:** Working when the sidecar is manually started; hard-crashes at import if the pip package is missing, no graceful degradation at the sidecar level (`AUDIT_AEOS.md §13`)
- **Dependencies:** `turbovec` (single-author, early-stage, v0.x, PyPI)
- **Strengths:** Real, functional; the only path to image (CLIP) embeddings in either codebase
- **Weaknesses:** External dependency risk the target architecture explicitly warns against (`ARCHITECTURE.md §25`); already superseded by AEOS's own in-process `sqlite-vec` work for the text case
- **Architectural compatibility:** Low
- **Target Brain layer:** N/A
- **Migration strategy:** None for the initial Brain. Revisit only if/when image/visual memory becomes an explicit scope decision.
- **Decision: DROP**
- **Reason:** Superseded by AEOS's own later work; conflicts with the "avoid one vector-db/one embedding provider" invariant

---

## Knowledge

#### 98-file YAML seed corpus + `import.ts`
- **Source:** AEOS — `packages/seed/`
- **Purpose:** Hand-authored, categorized architecture/backend/design/engineering pattern library
- **Status:** Working; validated useful enough that AEOS-brain independently chose to import a copy of it
- **Dependencies:** `PatternSchema` (non-strict, see Contracts section)
- **Strengths:** Real, substantial, portable, framework-agnostic content — the actual "knowledge," not code; cross-validated by both projects wanting it
- **Weaknesses:** Import silently drops fields for 3 files due to the non-strict schema bug (`AUDIT_AEOS.md §8`)
- **Architectural compatibility:** High — this is exactly the kind of reusable "knowledge" (vs. "experience") the blueprint distinguishes
- **Target Brain layer:** `packages/knowledge` / `seed/`
- **Migration strategy:** Carry the content forward as-is; fix the import path to use strict parsing so a schema mismatch fails loudly instead of silently discarding data; re-validate all 98 files against the new schema before import
- **Decision: KEEP** (content) / **ADAPT** (import mechanism)
- **Reason:** Real, valuable, already twice-validated content; the only defect is in the loader, not the data

---

## Codebase Intelligence

#### `services/{codebase-indexer,document-indexer,dependency-graph}` + `mcp-codebase`/`mcp-docs`
- **Source:** AEOS
- **Purpose:** Offline chunking/indexing of code and docs, read directly by MCP tools; import/export dependency graph
- **Status:** Working, genuinely wired end-to-end — the best-integrated cross-language part of either codebase (`AUDIT_AEOS.md §22-23`)
- **Dependencies:** Regex-based chunking (not AST/tree-sitter, despite roadmap claims), `sentence-transformers` for code embeddings
- **Strengths:** Real, working, dependency-light (the dependency-graph tools need no vector backend at all); a clean "offline indexer writes artifacts, adapter reads them" pattern
- **Weaknesses:** Regex chunking, not AST-based, despite documentation claiming otherwise — a real gap if symbol-level retrieval (an `ARCHITECTURE.md §18` future capability) is ever needed; no fallback if the vector sidecar is down
- **Architectural compatibility:** High as a pattern
- **Target Brain layer:** `packages/codebase`
- **Migration strategy:** Reuse the "offline indexer → artifact → adapter reads it" architecture; treat regex chunking as an acceptable starting point but plan for AST-based chunking before symbol-level retrieval is attempted; remove the hard vector-sidecar dependency in favor of `sqlite-vec`
- **Decision: ADAPT**
- **Reason:** Best cross-language integration either project has; chunking strategy specifically needs future rework, not the overall pipeline shape

---

## Capture / Ingest (open question — see `ARCHITECTURE_REVIEW.md`)

#### Harvesters (Chrome extension + file watcher) → `raw_ingest_queue` → AI distillation (`engine.py`)
- **Source:** AEOS-brain — `Memory/aeos-harvesters/`, `Memory/aeos-refinery/engine.py`
- **Purpose:** Passive capture of agent/browser activity, staged and AI-distilled into short memory entries before permanent storage
- **Status:** Working (watcher has an over-broad recursive-watch bug observed live; extension's auto-save toggle is a stub, manual save works)
- **Dependencies:** An LLM API (`gpt-4o-mini`) for distillation — a hard external dependency for this specific pipeline
- **Strengths:** A complete, running answer to "how does new knowledge get in without a human writing YAML by hand"; the "distill before you store, never persist raw text permanently" discipline is a genuinely good token-efficiency pattern
- **Weaknesses:** Not accounted for anywhere in the current `BLUEPRINT.md`/`ARCHITECTURE.md`, both of which model memory-writing as agent-initiated (`brain_remember`), not passively captured; requires an external LLM API for the distillation step, in tension with the local-first direction
- **Architectural compatibility:** Unclear — this is a scope question, not a technical one
- **Target Brain layer:** Undecided — possibly a new adapter category alongside MCP/SDK/CLI, possibly out of scope entirely for the initial Brain
- **Migration strategy:** Do not build in Phase 1. Flag as an explicit open question for `ARCHITECTURE_REVIEW.md` / human decision.
- **Decision: INVESTIGATE**
- **Reason:** Genuinely valuable, proven-working capability that the current target architecture simply does not address either way — needs a deliberate scope decision, not a default

---

## MCP Adapter

#### `mcp-{design,backend,architecture,engineering}` — 4 clean thin adapters
- **Source:** AEOS
- **Purpose:** MCP servers that delegate entirely to `hybridSearch()`, no local business logic
- **Status:** Working, tool names match documentation exactly (`AUDIT_AEOS.md §24`)
- **Dependencies:** `packages/core`, `packages/knowledge-db`
- **Strengths:** The single clearest example of the "thin adapter" principle actually holding, in either codebase
- **Weaknesses:** Domain-per-server granularity does not match the blueprint's small stable tool surface
- **Architectural compatibility:** High as a pattern, low as a literal tool surface
- **Target Brain layer:** `packages/mcp`
- **Migration strategy:** Keep as the internal reference example of "what a correct thin adapter looks like" during implementation; rebuild the actual tool surface around the blueprint's named operations (`brain_context`, `brain_recall`, etc.), not per-domain servers
- **Decision: ADAPT** (pattern) / **REWRITE** (actual tool surface)
- **Reason:** Best-executed adapter discipline available, but the wrong granularity for the target protocol

#### `mcp-{memory,visual,contracts,knowledge-loop,codebase,docs}` — 6 servers with their own DB connections
- **Source:** AEOS
- **Purpose:** Various — memory, visual search, contracts/orchestration, knowledge-loop, codebase/docs search
- **Status:** Working individually, but structurally the antipattern this project's own architecture warns against (`AUDIT_AEOS.md §5, §37`)
- **Dependencies:** Each its own `better-sqlite3` connection, bypassing the shared package
- **Strengths:** The underlying *feature concepts* (memory store/recall, codebase/doc search) are valid and separately assessed above
- **Weaknesses:** Direct evidence that "just add another MCP server" does not stay maintainable without enforced delegation to a shared core
- **Architectural compatibility:** Low, as implementations
- **Target Brain layer:** N/A as code; feature concepts already routed to their proper layers elsewhere in this matrix
- **Migration strategy:** None for these six implementations specifically
- **Decision: DROP**
- **Reason:** The features they provide are captured elsewhere in this matrix under their proper target layer; these specific implementations are the demonstrated antipattern

#### `aeos-mcp-server` (5 tools: store/retrieve/log_usage/get_pattern_details/list_categories)
- **Source:** AEOS-brain — `Memory/aeos-mcp-server/server.js`
- **Purpose:** The Brain-side MCP surface
- **Status:** Working for store/retrieve; `log_usage` broken (see Learning section)
- **Dependencies:** Supabase client, OpenAI API (embeddings)
- **Strengths:** Closest existing analog to the blueprint's `brain_remember`/`brain_recall`/`brain_feedback`/`brain_search` — a reasonable reference for what a small, stable surface looks like in practice
- **Weaknesses:** Contains real business logic directly in tool handlers (embedding generation, scope validation) rather than delegating to a core service — violates the "MCP must not contain retrieval/ranking/memory logic" invariant (`AUDIT_AEOS_BRAIN.md §9`); a module-level mutable `currentAgentScope` variable creates a real cross-request race condition under concurrent access (`AUDIT_AEOS_BRAIN.md §20`)
- **Architectural compatibility:** Medium — right tool count and shape, wrong internal structure
- **Target Brain layer:** `packages/mcp`
- **Migration strategy:** Use the 5-tool surface as a starting reference point for naming/shape against the blueprint's operation list; move all business logic into `packages/core` services the adapter calls into; the race condition must not survive into new code under any circumstances — request-scoped state, not module-scoped
- **Decision: ADAPT** (surface concept) / **REWRITE** (implementation)
- **Reason:** Good reference for scope/shape; the implementation has a real concurrency bug and violates the adapter-thinness invariant directly

---

## Orchestration / Agent-side (out of Brain scope)

#### `aeos-orchestrator` (6 hardcoded personas, LangGraph topology)
- **Source:** AEOS-brain — `Memory/aeos-orchestrator/`
- **Purpose:** An example multi-agent orchestrator consuming the Brain
- **Status:** Working, demo-quality
- **Dependencies:** LangGraph, OpenAI API, the Brain's HTTP surface (via `aeos_client.py`)
- **Strengths:** Empirically proves the Brain/Agent boundary holds under real implementation — the Brain has zero knowledge of any persona concept (`AUDIT_AEOS_BRAIN.md §10`)
- **Weaknesses:** Everything about it — fixed roster, fixed prompts, fixed topology — is precisely what the blueprint's non-goals section rules out for the Brain itself
- **Architectural compatibility:** N/A — this is Agent-side, not Brain-side, by the project's own explicit boundary
- **Target Brain layer:** None. Not part of the Brain's package tree.
- **Migration strategy:** Do not build anything like this into the Brain. Consider keeping a simplified version in `examples/` (a slot the blueprint's suggested layout already reserves) purely as an integration-test fixture that exercises the Brain's adapter surface end-to-end with a real, if simple, external agent.
- **Decision: DROP** (from Brain core) / **INVESTIGATE** (value as an `examples/` integration-test fixture)
- **Reason:** Valuable as proof-of-boundary and as a test consumer; actively harmful if any of its specifics leak into Brain-side design

#### `services/parallel-orchestrator` (`orchestrator.py` state machine + `conflict_resolver.py`)
- **Source:** AEOS
- **Purpose:** Multi-agent session/task tracking and merge-conflict resolution
- **Status:** Complete, orphaned; strictly more capable than its live TS counterpart (`mcp-contracts`), which has no conflict-resolution logic at all
- **Dependencies:** None external; pure Python logic
- **Strengths:** `conflict_resolver.py`'s file-ownership rules, JSON deep-merge, and interface-drift detection have no equivalent anywhere else in either codebase
- **Weaknesses:** Orchestration/multi-agent-coordination is explicitly Agent-side territory per the blueprint's boundary, not a Brain concern
- **Architectural compatibility:** Low for the Brain specifically
- **Target Brain layer:** None
- **Migration strategy:** Not part of the Brain. If multi-agent coordination becomes a separate future project, this logic is worth revisiting then.
- **Decision: DROP**
- **Reason:** Real capability, wrong side of the Brain/Agent boundary entirely — this is orchestration, which the blueprint explicitly excludes from the Brain

---

## Dropped Outright

#### `services/{knowledge_loop,memory-manager,contract-generator}` (orphaned Python duplicates)
- **Source:** AEOS
- **Status:** Complete, well-written, called by nothing except their own test scripts
- **Target Brain layer:** N/A
- **Decision: DROP**
- **Reason:** Pure duplication of logic already assessed under its live TypeScript counterparts elsewhere in this matrix; reusing orphaned code would just re-import the "two implementations, one dead" antipattern

#### `services/visual-memory` + `mcp-visual` (CLIP-based visual search)
- **Source:** AEOS
- **Status:** Working if the turbovec sidecar is running; no fallback for image-to-image search
- **Target Brain layer:** None for the initial Brain
- **Decision: DROP** (for now)
- **Reason:** Depends on the already-dropped turbovec sidecar; visual/image memory is not mentioned anywhere in the current blueprint — out of scope until a deliberate decision reopens it

#### `services/abstraction-validator`
- **Source:** AEOS — real, actually used by `scripts/review-candidates.py`
- **Status:** Working, regex-based (+ optional LLM) quality gate before promotion
- **Target Brain layer:** `packages/core/learning` (promotion pipeline), possibly
- **Decision: INVESTIGATE**
- **Reason:** A legitimate "gate before promotion" concept aligned with the blueprint's promotion/validation flow, but whether to adapt or rewrite depends on promotion-pipeline decisions not yet made — small enough to defer without risk

#### `scripts/migrate-*.sql` + `run-migration.js`
- **Source:** AEOS
- **Status:** Working, but one of two unsynchronized schema-provisioning paths
- **Target Brain layer:** N/A (literal SQL); the *practice* → `packages/storage`
- **Decision: DROP** (literal SQL) / **ADAPT** (practice — versioned migration files with a runner script, as the single source of schema truth this time)
- **Reason:** Schema will be redesigned from scratch for the new memory model; the general practice of versioned, runnable migrations is worth keeping

#### `scripts/{memory-decay,metrics,review-candidates,seed_vectors}.py`
- **Source:** AEOS
- **Status:** Working CLI utilities, invoked only via direct `python` execution, never wired to `npm run` despite documentation claiming otherwise
- **Target Brain layer:** `packages/cli` (concept only)
- **Decision: INVESTIGATE**
- **Reason:** Useful lifecycle/observability CLI concepts, but Python-vs-the-rest-of-a-TypeScript/Node blueprint is a language mismatch; worth porting the *concepts* to the TS CLI adapter, not the Python directly

#### `mcp-config.json`
- **Source:** AEOS
- **Decision: DROP**
- **Reason:** Registration format specific to AEOS's own 10-server topology, moot once the MCP surface is redesigned around the blueprint's small tool set

#### `aeos-visualizer` (Next.js dashboard)
- **Source:** AEOS-brain — `Memory/aeos-visualizer/`
- **Purpose:** Force-directed knowledge-graph dashboard
- **Status:** Working overall; 2 stub/broken features (fake refinery-run result, hardcoded-path API route unreachable on its own deploy target); a live, proven client-side performance bug (unbounded `GoTrueClient` re-instantiation); ships a privileged database key to the browser
- **Dependencies:** Next.js 16/React 19, direct Supabase client with a service-role key
- **Strengths:** Genuinely rich, working interaction design — force-directed graph, inspector panel, promote/demote/flag/delete, YAML export, a clean CSS-custom-property dark-mode token system (`AUDIT_AEOS_BRAIN.md §19`). This is the UI/UX asset the project brief specifically asked to consider reusing.
- **Weaknesses:** One 949-line monolithic client component, no sub-component decomposition; a real security hole (service-role key in the browser bundle); two demonstrably non-functional features; unused-but-installed Tailwind alongside a hand-written CSS system
- **Architectural compatibility:** The blueprint has no UI package at all yet (dashboards are implicitly Phase 6 "Ecosystem") — not a near-term architectural concern either way
- **Target Brain layer:** Outside `brain/`'s package tree; a future, separate dashboard consumer of the Brain's adapter layer
- **Migration strategy:** When a dashboard is eventually built, use this as the **design/UX reference** (graph view, inspector panel, dark-mode token system, promote/demote interactions) — not as a code base. Any new dashboard must talk to the Brain exclusively through its adapter layer (HTTP/SDK), never directly to the database, and must be componentized from the start.
- **Decision: ADAPT** (design/UX only) / **REWRITE** (implementation, when this phase is reached)
- **Reason:** Directly addresses the project brief's request to consider reusing AEOS-brain's UI/UX — the visual/interaction design is worth carrying forward; the code has a real security defect and cannot be reused as-is regardless

#### Supabase-specific tooling (`setup_db.mjs`, `create_rpc.mjs`, `seed_data.sql`, RLS policies)
- **Source:** AEOS-brain
- **Status:** Working for what it does; RLS policies confirmed not to actually enforce the isolation the documentation claims (`AUDIT_AEOS_BRAIN.md §11`)
- **Target Brain layer:** N/A
- **Decision: DROP**
- **Reason:** Postgres/Supabase-specific; storage direction is SQLite-first. The security lesson (do not ship privileged keys to untrusted clients; enforce scope at the data layer, not only in application code) carries forward into `ARCHITECTURE_REVIEW.md` as a hardening requirement, independent of dropping this code.

#### Deploy tooling (`render.yaml`, `ecosystem.cjs`, `.gitlab-ci.yml`)
- **Source:** AEOS-brain
- **Decision: DROP**
- **Reason:** Cloud-deployment-specific; out of scope while the Brain remains local-first (blueprint Phase 6 territory at the earliest)

#### `docs/scaling-plan.md` (Lambda/Terraform/Redis)
- **Source:** AEOS-brain
- **Decision: DROP**
- **Reason:** 100% aspirational per its own audit — no corresponding code exists anywhere in the repository; nothing to migrate
