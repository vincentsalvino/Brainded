# Audit: AEOS-brain (Reference Project #2 of 2)

Audit root: `c:\Users\LENOVO V330\OneDrive\Desktop\ai-brain\references\AEOS-brain`
Method: static reading only (no execution, no installs). All claims below are grounded in file:line citations against the actual code, SQL, and one real execution log (`.ecosystem.log`) found in the repo. Paths below are relative to the audit root unless stated otherwise.

---

## 1. Executive Summary

- **It is a working, cloud-hosted "second brain,"** not just a concept doc: a Supabase/Postgres+pgvector store, a Node/Express MCP gateway, a Python distillation pipeline, two capture front-ends (Chrome extension + local file watcher), and a Next.js graph dashboard. Most of what the docs claim is actually implemented, and one real execution log (`.ecosystem.log`) proves the full stack has been run together at least once.
- **It is an explicit successor to "agent-knowledge-system"** — the project the sibling audit calls AEOS. `seed_importer.py:4-5` calls its source "the agent-knowledge-system (old local AEOS)," and `engine.py:127` says its aging rules are "ported from agent-knowledge-system." It is a rewrite in a different stack (cloud Postgres vs. local SQLite) that migrated AEOS's static seed-pattern *content* once via a one-time script; it did not reuse AEOS's code.
- **Hardcoded agent roles exist, but only in one clearly-bounded package.** `Memory/aeos-orchestrator/personas.py` and `agent_team.py` hardcode six fixed LangGraph personas (Architect, Frontend, Backend, DevOps, Implementation, Review) with baked-in system prompts, temperatures, and tool grants. The Brain proper (`aeos-mcp-server`) has no concept of these roles at all — only a generic 4-value `scope` tag used purely as a data-partition key.
- **The "learning loop" is broken end-to-end.** The `log_usage` MCP tool's own side-effect RPC (`upsert_pattern_metrics`) is never defined anywhere in the SQL schema, and nothing in the shipped orchestrator ever calls `log_usage` in the first place (`aeos_client.py` has no such method). Tier promotion and performance-score adjustment run every refinery cycle against tables that real usage never populates.
- **Scope isolation is enforced only in application code, not by the database.** The actual RLS policies grant unconditional public `SELECT` on `memories`/`refinery_runs`/`pending_reviews` (`initial_schema.sql:151,155`), and the visualizer ships the Postgres **service-role key** to the browser (`page.tsx:9-10`), which bypasses RLS by Postgres's own semantics regardless of policy content. The docs' claim of a session-variable-based per-scope RLS wall (`docs/blueprint.md:140-144`) was not found anywhere in the actual SQL.
- **The visualizer is a genuinely rich, working dashboard** — force-directed canvas graph, inspector panel, promote/demote/flag/delete, YAML export, OII trend chart, keyboard shortcuts, automatic dark mode via a clean CSS-custom-property token system — but it is one 949-line client component (`page.tsx`) with zero sub-component decomposition.
- **Two headline dashboard features are demonstrably non-functional as shipped.** The "Run refinery" button always displays a hardcoded fake result string regardless of outcome (`page.tsx:686`), and its backing API route shells out to a hardcoded Windows path on the original author's machine (`run-refinery/route.ts:6`) — incompatible with the documented Netlify deployment target.
- **Deployment reality is more fragmented than the root files suggest.** `render.yaml` covers only 2 of 6 runtime components (MCP gateway + refinery worker); the visualizer actually deploys to Netlify (`netlify.toml`); the orchestrator and harvesters are local-machine-only. `ecosystem.cjs` is a small hand-rolled dev-convenience process launcher, **not** a PM2 config, despite the filename.
- **Technical debt is concrete and mostly self-undocumented.** Zero TODO/FIXME/HACK markers exist anywhere in the codebase, yet static reading and one real execution log together turned up a live client re-instantiation bug, a dead query, a duplicated O(n²) full-table dedup pass, and doc/code parameter-name drift in the harvester's own `.env.example`.
- **Codebase/repo intelligence is entirely absent from the implementation.** Tooling like a repo map, AST-aware search, or dependency graphing exists only as aspirational prose in `docs/agents and tooling.md` (`aider_repo_map`, `cline_ripgrep_search`, etc.) — none of it appears in `tools.py`.

---

## 2. Component Inventory

| Component | Path | Purpose | Status | Key files |
|---|---|---|---|---|
| MCP Gateway (Brain) | `Memory/aeos-mcp-server` | Node/Express MCP server exposing memory CRUD/search tools + harvester ingest endpoint | **Working** (core tools function; `log_usage`'s metrics side-effect is broken) | `server.js`, `package.json` |
| Agent Orchestrator | `Memory/aeos-orchestrator` | Python/LangGraph 6-role agent team (plan → build → review loop); a *consumer* of the Brain | **Working** as a local stdio/HTTP MCP server; demo-quality | `agent_team.py`, `personas.py`, `tools.py`, `server.py`, `aeos_client.py` |
| Refinery Pipeline | `Memory/aeos-refinery` | Distillation, embedding backfill, quality scoring, dedup, knowledge aging | **Partial** — ingestion/distillation works; knowledge-aging promotion/performance logic runs against permanently-empty data | `engine.py`, `scheduler.py`, `seed_importer.py`, `Dockerfile` |
| Harvester — File Watcher | `Memory/aeos-harvesters` | Local daemon watching Aider/Cursor chat history, POSTs to `/ingest` | **Working**, with an over-broad recursive-watch bug observed live | `watcher.js` |
| Harvester — Chrome Extension | `Memory/aeos-harvesters/chrome-extension` | Manual "Save to Brain" capture from ChatGPT/Claude/Gemini | **Working** (manual save path); the "auto-save" toggle is a stub | `background.js`, `content.js`, `popup.js`, `manifest.json` |
| Visualizer Dashboard | `Memory/aeos-visualizer` | Next.js force-directed knowledge-graph UI, CRUD, refinery trigger | **Working** overall, with 2 stub/broken features and a real client-side perf bug | `src/app/page.tsx`, `layout.tsx`, `globals.css`, `api/*/route.ts` |
| Database Schema | `Memory/supabase` | Postgres schema, RPCs, seed/demo data | **Working** core schema; 1 RPC referenced by code is never defined; 1 RPC exists only outside versioned migrations | `migrations/*.sql`, `setup_db.mjs`, `create_rpc.mjs`, `seed_data.sql` |
| Deploy / process tooling | repo root | Cloud deploy descriptors + local dev launcher + CI pipeline | **Working** for what it covers, but partial coverage and a non-blocking CI gate | `render.yaml`, `ecosystem.cjs`, `.gitlab-ci.yml` |
| Documentation | root + `docs/` | Design intent, onboarding | **Mostly accurate**, but contains aspirational content presented as delivered, and some doc/code drift | `docs/blueprint.md`, `docs/agents and tooling.md`, `docs/scaling-plan.md` |

---

## 3. Architecture

AEOS-brain is a **distributed, cloud-first, multi-language system** — six independently-runnable components communicating over HTTP/MCP, not a monorepo of tightly-coupled packages:

```
Harvesters (browser ext. + local daemon) --POST /ingest--> MCP Gateway (Node) --> Supabase Postgres+pgvector
                                                                  ^                        |
                                                                  | store/retrieve_memory   | polls raw_ingest_queue
                                                                  |                         v
                                              Agent Orchestrator (Python/LangGraph)   Refinery (Python, APScheduler)
                                                                                             |
                                                                                             v
                                                                              Visualizer (Next.js) --direct Supabase client, service-role key--> same DB
```

Two things stand out structurally:

1. **There are two independent write/read paths into the same tables.** Agents write/read through the MCP gateway (`aeos-mcp-server`), which enforces `x-agent-scope` and generates embeddings server-side. The Visualizer talks **directly** to Supabase from the browser using `@supabase/supabase-js` (`page.tsx:7-11, 507, 517, 527-529, 544, 557, 569`), with no scope header, no embedding generation on writes it makes, and using the service-role key (see §11 Storage). These are two different code paths with two different security postures into one schema.
2. **The "Brain" and "Agent" halves are physically separate processes with a clean protocol boundary.** `aeos-mcp-server` (Brain) and `aeos-orchestrator` (Agent) never import each other; they only talk over HTTP+MCP via `aeos_client.py`. See §10 Agent Integration for why this matters.

Per-component runtime/deploy targets (confirmed from `render.yaml`, `netlify.toml`, `README.md`, `docs/deploy.md`, not inferred):

| Component | Runtime | Deploy target |
|---|---|---|
| `aeos-mcp-server` | Node 22 / Express | Render.com Web Service (`render.yaml:13-32`) |
| `aeos-refinery` | Python 3.14 | Render.com Background Worker (`render.yaml:37-53`), also Docker (`Dockerfile`) |
| `aeos-visualizer` | Next.js 16 / React 19 | **Netlify** (`netlify.toml:1-6`), not Render |
| `aeos-orchestrator` | Python 3 / LangGraph | Local machine only (`docs/agents and tooling.md:163-179` explicitly states this; no cloud deploy artifact exists for it) |
| `aeos-harvesters` (watcher) | Node 22 daemon | Local machine only |
| `aeos-harvesters` (extension) | Chrome MV3 | User's browser |
| `Memory/supabase` | Postgres | Supabase (managed) |

**Correction to the "known shape" assumption about `ecosystem.cjs`:** it is not a PM2 process-manager config. Reading it (`ecosystem.cjs:1-169`) shows a hand-rolled Node script using `child_process.spawn` directly, with its own `start`/`--status`/`--stop` CLI and its own health-check polling — it does not import or reference the `pm2` package, and there is no PM2 `apps:` array. A grep for `pm2`/`PM2` across the entire repo turns up exactly one hit, a passing mention in `docs/blueprint.md`'s deploy table as one *alternative* manual-deploy option ("Render/DigitalOcean/SSH + PM2") that is never actually wired up anywhere. `ecosystem.cjs` starts exactly 3 of the 6 components (MCP server, Visualizer via `npx next dev`, File Watcher — `ecosystem.cjs:23-51`) and is a local **dev convenience launcher**, unrelated to the real production deploy path (Render + Netlify + Supabase CLI, per `.gitlab-ci.yml`).

---

## 4. Relationship to AEOS

This is not "AEOS but newer," and it is not an independent project that happens to share naming. Based on direct, primary-source evidence inside AEOS-brain itself:

- `Memory/aeos-refinery/seed_importer.py:1-13` (module docstring): *"One-time migration script that reads the 98 YAML seed pattern files from the agent-knowledge-system (**old local AEOS**) and imports them into Supabase as `source='SEED'` memories..."*
- `Memory/aeos-refinery/seed_importer.py:30`: `DEFAULT_SEED_DIR = "C:/Users/newadmin/Documents/Vincent/agent-knowledge-system/packages/seed"` — a literal path into what is, by name and by `packages/seed` layout, the AEOS monorepo described in the sibling audit's brief (which reports a `packages/seed/` YAML corpus of ~150 files).
- `Memory/aeos-refinery/seed_importer.py:33-38`: `DOMAIN_TO_SCOPE = {"design": "frontend", "backend": "backend", "architecture": "architecture", "engineering": "general"}` — this is a direct mapping from (a subset of) AEOS's domain-specific package names (`mcp-design`, `mcp-backend`, `mcp-architecture`, `mcp-engineering`, per the sibling summary) onto AEOS-brain's 4-value scope taxonomy. Only 4 of AEOS's reported 9 `mcp-*` packages are represented — the importer does not attempt to carry over `mcp-codebase`, `mcp-contracts`, `mcp-docs`, `mcp-knowledge-loop`, or `mcp-visual` content.
- `Memory/aeos-refinery/engine.py:124-131` (`run_knowledge_aging` docstring): *"Aging rules (**ported from agent-knowledge-system**)"* — a second, independent code comment (not documentation) confirming the same lineage for the promotion/decay logic specifically.
- `docs/blueprint.md:268-360` (Section 10, "Seed Pattern Merge (agent-knowledge-system Integration)") states explicitly: *"The old local SQLite-based agent-knowledge-system (98 YAML seed patterns, hybrid search with FTS5+vector+tag+performance scoring, knowledge aging/promotion tiers, domain-specific MCP servers) has been fully merged into the cloud-based aeos-brain Second Brain architecture."* This independently corroborates AEOS's reported shape (SQLite, FTS5, multiple domain-specific MCP servers) using AEOS-brain's own words.
- A repo-wide grep for `agent-knowledge-system` returns 16 hits across 6 files (both code and docs: `seed_importer.py` x5, `engine.py` x1, `docs/blueprint.md` x5, `docs/tutorial.md` x3, `docs/deploy.md` x1, one SQL migration comment) — this is a pervasive, repeated acknowledgment, not a one-off mention.

**Conclusion:** AEOS-brain is a **from-scratch rewrite in a different stack** (Postgres/Supabase/cloud vs. AEOS's SQLite/local-first) that performed a **one-time content migration** of AEOS's static seed-pattern corpus (via `seed_importer.py`, run once from a hardcoded local path) and reimplemented (not ported) the surrounding logic — hybrid search, knowledge aging, MCP surface — as new code. None of AEOS's actual source (its 9 MCP server packages, its `knowledge-db` TypeScript package, its Python services) is imported, vendored, or reused anywhere in AEOS-brain; only the *pattern content* and some *design concepts* (domain scoring, hybrid search weighting, tier promotion) carried over. The naming overlap ("AEOS") together with the explicit "old local AEOS" self-description in `seed_importer.py` indicates continuity of authorship and intent, not continuity of codebase.

---

## 5. Memory Architecture

The unit of memory is a single `memories` row (`Memory/supabase/migrations/20240601000000_initial_schema.sql:10-22`, extended by `20240601000002_merge_seed_patterns.sql:13-38`). There is no separate "episode," "session," or "document" abstraction — everything, whether a static curated pattern or a distilled conversation snippet, is flattened into one table distinguished by a `source` column:

- `source = 'REFINERY'` — episodic memories distilled from captured conversations (2-sentence summaries only; raw conversation text is never persisted past the `raw_ingest_queue` staging table).
- `source = 'SEED'` — static curated patterns imported once from AEOS's YAML corpus (`seed_importer.py`).

**Lifecycle status** (`status` column, CHECK-constrained at `initial_schema.sql:15`): `Candidate → Elevated → Trusted`, with a separate `PendingDeletion` terminal state reached via `flag_for_deletion`. Promotion thresholds (`engine.py:257-262`): Elevated at ≥10 uses / ≥85% success / ≥7.0 avg review; Trusted at ≥25 uses / ≥92% success / ≥8.5 avg review. Demotion: a `REFINERY` memory still `Candidate` after 60 days with zero retrievals is auto-flagged for deletion (`engine.py:136-179`).

**Ingestion → memory pipeline** (the "harvest layer"):
1. Harvesters POST raw, unprocessed content to `/ingest` (`server.js:342-385`), which lands in `raw_ingest_queue` with `status='PENDING'`.
2. The Refinery polls up to 10 `PENDING` rows at a time (`engine.py:359-382`), triages (<50 words rejected, `engine.py:387-400`), and asks `gpt-4o-mini` to compress the conversation into a title + 2-sentence `content` + `scope` + `tags` + an `engineering_score` (`engine.py:340-357, 402-457`). Scores below 0.60, or an explicit `NO_SIGNAL` response, are rejected and the raw text is never promoted.
3. Surviving extractions are embedded and vector-deduped against existing memories before insert (`engine.py:486-525`; >0.95 cosine = reject as duplicate, 0.85–0.95 = flag existing near-match for human review).

This is a genuinely disciplined "keep memory dense" design — raw chat logs never reach the permanent store, only the (also never-guaranteed-perfect) 2-sentence distillation does.

**Weakness:** memory itself has no notion of provenance beyond a single `agent` free-text column (`memories.agent`, e.g. `"Refinery"`, `"BackendAgent"`) and no versioning/history — an `UPDATE` (e.g. from the visualizer's edit modal, `page.tsx:505-513`) silently overwrites `content`/`title`/`tags` with no audit trail (contrast with `aging_actions`, which *does* log every automated promotion/demotion decision, `merge_seed_patterns.sql:130-151` — manual edits get no equivalent log).

---

## 6. Knowledge Architecture

Two knowledge sources are unified into one schema and one search surface:

- **Static/curated knowledge ("SEED"):** 96 patterns (98 YAML files found, 2 deduplicated, per `docs/blueprint.md:276,318`) imported once from AEOS's `packages/seed/` corpus via `seed_importer.py`. Each carries rich structured metadata beyond plain text: `category` (14 categories enumerated in `server.js:317-332`, e.g. layout/component/api/database/auth/anti-pattern/rule), `use_when`/`avoid_when` arrays, `usage_rules`, `code_block`, `frameworks`, `complexity` (low/medium/high), and a `domain` tag (`design`/`backend`/`architecture`/`engineering`) that is distinct from — and sits alongside — the coarser `scope` used for access control.
- **Episodic knowledge ("REFINERY"):** loosely-structured 2-sentence distillations with only `title`/`content`/`tags`, no category/use_when/code_block richness.

Both are stored as rows in the same `memories` table and are retrievable through the same `match_memories` RPC and the same `retrieve_memory` MCP tool, with an optional `filter_source`/`filter_category` to separate them (`server.js:132-184`). The `list_categories` tool (`server.js:312-338`) exposes the 14-category taxonomy for discovery. This unification (one search surface over both static rules and past-experience facts) is a deliberate, stated design goal (`docs/blueprint.md:284-289`) and is actually implemented, not just aspirational.

**Gap:** the seed corpus import is narrower than AEOS's reported domain breadth — only 4 of AEOS's ~9 domain packages are mapped (`seed_importer.py:33-38`, see §4). Anything AEOS held under `mcp-codebase`, `mcp-contracts`, `mcp-docs`, `mcp-knowledge-loop`, or `mcp-visual` was not carried into AEOS-brain's knowledge base by this importer.

---

## 7. Retrieval

Retrieval is a single Postgres RPC, `match_memories`, called from the MCP gateway's `retrieve_memory` tool (`server.js:132-184`) and, separately, from the refinery's own duplicate check (`engine.py:497-501`, with a `match_count` of 3 there).

Two versions exist in the migrations, and only the second is live in the deployed schema (later `CREATE OR REPLACE` wins):

- **v1** (`initial_schema.sql:72-94`): pure vector cosine similarity, scope-filtered, no other signals.
- **v2 / hybrid** (`merge_seed_patterns.sql:160-270`): a single SQL query combining four signals into one weighted score, per the SQL comment at line 240: **Vector similarity 40%, full-text search 25% (`ts_rank_cd` over a generated `tsv` column), tag overlap 20% (substring match between query text and the memory's tag array), performance score 10%.** The code also folds in quality_score at 5% (`merge_seed_patterns.sql:251`), for 100% total — see §16 for a doc/code drift note on this exact breakdown.

Retrieval is scope-locked by construction: the RPC takes a `target_scope` parameter (`'all'` or one of the 4 scopes) sourced from the MCP gateway's per-request `currentAgentScope` (see §11 for the concurrency risk this creates), not from anything the caller can override directly through the tool's own arguments. Every non-empty retrieval result is logged to `retrieval_log` (`server.js:39-54, 158-160`) — this log is the intended input to the performance-scoring/knowledge-aging loop (see §13 Learning), though that loop is broken downstream.

No re-ranking, diversity, or MMR-style result-set shaping exists beyond the single weighted-sum ORDER BY in the RPC — this is materially simpler than the sibling AEOS project's reported dedicated `ranking`/`diversity` modules in `packages/knowledge-db`.

---

## 8. Context Generation

There is no separate "context compiler" component; context assembly is inlined in two places:

1. **MCP gateway formatting** (`server.js:58-78`, `formatMemoryResults`): turns retrieved rows into a compact, delimiter-separated text block (`---`, `Title:`, `Tags:`, `Content:`), optionally including seed-pattern-only fields (`use_when`, `avoid_when`, `usage_rules`, `code_block`) when `include_pattern_details` is requested. This is explicitly framed as "context budget safe" in a code comment (`server.js:56`) — the 2-sentence distillation constraint upstream (§5, §12) is what actually keeps this budget small, not any truncation/summarization logic in the formatter itself.
2. **Orchestrator prompt assembly** (`agent_team.py:110-125`, `_build_context`): concatenates task, architect plan, domain guidance, files-modified list, previous implementation summary, and review feedback into one growing markdown string passed as the LLM user message on every node call. There is no token budgeting, truncation, or summarization here at all — `_build_context` grows unboundedly across iterations within one `run_agent_team` call (bounded only indirectly by `max_iterations`, default 3).

Both mechanisms are static/templated, not adaptive — no component here dynamically decides *how much* context fits a target budget; the discipline is entirely upstream, in forcing memories themselves to stay short.

---

## 9. MCP

Two independent MCP servers exist, at different levels of the stack:

**`aeos-mcp-server` (the Brain's protocol surface)** — `Memory/aeos-mcp-server/server.js`, built on the official `@modelcontextprotocol/sdk` (`package.json:11`) with `StreamableHTTPServerTransport` over Express (`server.js:1-25, 389-410`). Exposes 5 tools:

| Tool | Lines | Purpose |
|---|---|---|
| `store_memory` | `server.js:82-128` | Write a new memory; rejects if payload `scope` ≠ header scope |
| `retrieve_memory` | `server.js:132-184` | Hybrid search (see §7) |
| `log_usage` | `server.js:188-248` | Report usage/success for a retrieved memory (feeds `pattern_metrics`) — **its own DB side-effect RPC is missing, see §13** |
| `get_pattern_details` | `server.js:252-308` | Fetch full seed-pattern metadata by title/ID |
| `list_categories` | `server.js:312-338` | Enumerate the 14 pattern categories |

Plus two plain REST endpoints outside the MCP tool surface: `POST /ingest` (harvester intake, key-authenticated, `server.js:342-385`) and `GET /health` (`server.js:413-415`).

This is **not a thin passthrough adapter** — it contains real business logic directly in the route/tool handlers: embedding generation (`generateEmbedding`, `server.js:29-35`), scope-vs-payload validation, retrieval logging, and category-list data. The only logic actually pushed down into Postgres is the hybrid-search scoring itself (the `match_memories` RPC) and the aging/promotion rules (in the Python refinery, not in SQL).

**`aeos-orchestrator` (the Agent's protocol surface)** — `Memory/aeos-orchestrator/server.py`, a **hand-rolled** minimal JSON-RPC implementation (no SDK dependency — `requirements.txt` lists only `openai`, `langgraph`, `python-dotenv`, `requests`), supporting stdio (primary, for IDE subprocess launch, `server.py:172-201`) and an HTTP mode for manual testing (`server.py:208-247`). Exposes exactly **one** tool, `run_agent_team(task, max_iterations)` (`server.py:71-100`), which internally drives the full LangGraph state machine described in §10 and returns a formatted markdown report (`server.py:129-165`).

The two MCP servers do not talk to each other directly; the orchestrator reaches the Brain only via plain HTTP+JSON (`aeos_client.py`), not MCP-to-MCP.

---

## 10. Agent Integration

**This is the most important finding in this audit, reported as directly and factually as the code supports.**

`Memory/aeos-orchestrator/personas.py:1-284` defines exactly six hardcoded agent personas as Python dataclass instances:

- `ARCHITECT` (`personas.py:30-55`) — scope `architecture`, temperature `0.0`, a fixed multi-paragraph system prompt instructing it to plan and output a structured JSON plan.
- `FRONTEND` (`personas.py:62-103`) — scope `frontend`, temperature `0.05`, a fixed system prompt that includes **literal hardcoded style bans baked into the prompt text itself**: *"❌ Purple gradients," "❌ Glassmorphism," "❌ Centered hero sections," "❌ Overly animated onboarding"* (`personas.py:75-79`, repeated structurally in the `hard_bans` field at `personas.py:91-96`).
- `BACKEND` (`personas.py:110-139`) — scope `backend`, temperature `0.0`, fixed rules ("parameterized queries only," "auth at middleware," "RLS enabled," Zod validation).
- `DEVOPS` (`personas.py:146-173`) — scope `general`, temperature `0.0`, fixed infra principles.
- `IMPLEMENTATION` (`personas.py:180-219`) — scope `general`, temperature `0.0`, "no redesigning," "no scope expansion," full file read/write/edit/exec tool access.
- `REVIEW` (`personas.py:226-272`) — scope `architecture`, temperature `0.0`, `read_only=True`, PASS/FAIL verdict with a fixed checklist.

`PERSONA_REGISTRY` (`personas.py:276-283`) is a plain dict fixing the roster to exactly these six keys — there is no registration API, no config file, no way to add or remove a role without editing this source file.

`Memory/aeos-orchestrator/agent_team.py` wires these into a **hardcoded LangGraph topology**: `build_agent_team()` (`agent_team.py:361-415`) adds exactly six named nodes (`architect`, `frontend`, `backend`, `devops`, `implementation`, `review`, lines 366-371) and hardcoded conditional-routing functions with the domain names as string literals baked directly into the control flow (`route_after_architect:312-321`, `route_after_frontend:324-333`, `route_after_backend:336-339`, `route_after_devops:342-343`, `route_after_review:346-354`). The cyclic PASS/FAIL loop (`implementation → review → implementation on FAIL`) is bounded by `max_iterations` (default 3, `agent_team.py:425,430,440`).

`Memory/aeos-orchestrator/tools.py:80-141` grants **different fixed tool subsets per hardcoded role name**: `IMPLEMENTATION_TOOLS` (full `read_file`/`write_file`/`edit_file`/`list_files`/`run_command`, lines 85-106), `REVIEW_TOOLS` (`read_file`/`list_files` only, lines 109-118), `PLANNER_TOOLS` (same read-only pair, used for architect/frontend/backend/devops, lines 121-130). `get_tools_for(persona_name)` (`tools.py:133-141`) dispatches on a string match against the persona's name.

**Where this sits relative to the Brain-vs-Agent boundary:** every piece of hardcoding described above — system prompts, temperatures, fixed graph topology, role-gated tool grants, planning/reasoning/coding/review logic — lives entirely inside `Memory/aeos-orchestrator/`, a self-contained Python package. It is architecturally a **consumer** of the Brain, not part of it:

- `Memory/aeos-orchestrator/aeos_client.py:14-19` (`AEOSClient.__init__`) takes an arbitrary `scope: str = "general"` constructor argument — the client class itself is generic, not hardcoded to any of the six persona names; the orchestrator's nodes happen to construct it with their persona's scope, but that binding happens in `agent_team.py`, not in the client.
- `Memory/aeos-mcp-server/server.js` (the Brain's only code) contains **zero** references to "architect," "reviewer," "implementation," or any persona concept. Its only fixed vocabulary is the 4-value `scope` string enum (`frontend`/`backend`/`architecture`/`general`, enforced at `server.js:88` and `server.js:392`, and at the schema level via a `CHECK` constraint at `initial_schema.sql:14`) — used purely as a data-partitioning/namespace key on rows and requests, with no prompt, temperature, or tool-permission logic attached to it anywhere in the Brain package.
- The Brain functions with `aeos-orchestrator` absent entirely — nothing in `aeos-mcp-server`, the refinery, the harvesters, or the visualizer imports or depends on anything in `aeos-orchestrator/`. The orchestrator is one optional, swappable client among (potentially) many; the repository just happens to ship one alongside the Brain.

**Aspirational overshoot beyond what's implemented:** `docs/agents and tooling.md` (read in full) describes a much more elaborate tool roster than what `tools.py` actually contains — tools "ported" from Aider (`aider_repo_map`, `aider_search_replace`), Cline (`cline_str_replace_editor`, `cline_ripgrep_search`, `cline_read_diagnostics`), Continue.dev (`continue_gather_context`), and Cursor (`cursor_multi_file_edit`), plus a `define_contract`/`validate_contract` cryptographic-hash contract-enforcement mechanism (`docs/agents and tooling.md:118`). **None of this exists in the actual code.** `tools.py` implements only five plain primitives (`read_file`, `write_file`, `edit_file` via simple string search/replace, `list_files`, `run_command` via `subprocess.run`) — no repo-map, no ripgrep wrapper, no LSP diagnostics hook, no contract hashing. This doc describes a considerably more sophisticated vision than what was built.

---

## 11. Storage

**Engine:** Supabase-managed Postgres with the `vector` (pgvector) and `uuid-ossp` extensions (`initial_schema.sql:6-7`).

**Tables** (7 total across 2 migrations):

| Table | Migration | Purpose | Key columns |
|---|---|---|---|
| `memories` | `initial_schema.sql:10-22`, extended `merge_seed_patterns.sql:13-38` | Core knowledge store (see §5) | `id UUID`, `title`, `content`, `scope` (CHECK-enum), `status` (CHECK-enum), `quality_score FLOAT`, `agent`, `tags TEXT[]`, `embedding VECTOR(1536)`, `source` (SEED/REFINERY), `category`, `use_when TEXT[]`, `avoid_when TEXT[]`, `code_block`, `usage_rules TEXT[]`, `style_traits TEXT[]`, `frameworks TEXT[]`, `complexity`, `performance_score FLOAT`, `domain`, `tsv tsvector` |
| `refinery_runs` | `initial_schema.sql:32-40` | Per-pipeline-run metrics history | `memories_in/out`, `duplicates_pruned`, `trusted_promotions`, `oii_score` |
| `pending_reviews` | `initial_schema.sql:45-51` | Human-in-the-loop deletion queue | `memory_id` FK, `reason`, `tags` |
| `raw_ingest_queue` | `20240601000001_raw_ingest_queue.sql:7-25` | Harvest staging buffer | `source` (CHECK-enum: aider/cursor/chrome-extension/manual/api), `raw_content`, `status` (6-state machine: PENDING→PROCESSING→TRIAGED/EXTRACTED→REJECTED/COMMITTED), `engineering_score`, `distilled_*` mirror columns |
| `retrieval_log` | `merge_seed_patterns.sql:83-95` | Every retrieval event, for scoring | `memory_id` FK, `query`, `used BOOLEAN`, `success BOOLEAN`, `review_score FLOAT` |
| `pattern_metrics` | `merge_seed_patterns.sql:108-120` | Aggregated per-memory usage stats | `use_count`, `success_count`, `review_sum`, `review_count` — **never populated by any working code path, see §13** |
| `aging_actions` | `merge_seed_patterns.sql:130-144` | Audit log of automated promote/demote/decay decisions | `action` (CHECK-enum), `previous/new_status`, `reason` |

**Views/functions:** `graph_edges` (SQL view, `initial_schema.sql:61-69`, dynamic tag-intersection join for the visualizer's edges — recomputed on every query, no materialization); `match_memories` (RPC, two versions, see §7); `insert_memory` (RPC, `initial_schema.sql:97-121`); `update_updated_at_column`/`memories_tsv_trigger` (triggers).

**Security model — this is where the implementation diverges most sharply from the stated design:**

- The actual RLS policies (`initial_schema.sql:151,155`) are `CREATE POLICY "Read access on memories" ON memories FOR SELECT TO public USING (true)` — **unconditional**, no scope predicate, applied identically to `refinery_runs` and `pending_reviews`. There is no `current_setting('app.current_scope')`-based policy anywhere in any of the three migration files, despite `docs/blueprint.md:140-144` explicitly describing exactly that mechanism ("the Postgres configuration variable `app.current_agent_scope`... the database physically drops any rows where the scope doesn't match"). Scope filtering that does happen (`match_memories`'s `WHERE scope = target_scope`) is a query-parameter filter passed in by trusted application code, not a database-enforced access boundary — anyone querying the `memories` table directly with the anon key sees every scope.
- `raw_ingest_queue`, `retrieval_log`, `pattern_metrics`, and `aging_actions` are correctly locked to `service_role`-only (no public policy) — these are properly protected.
- The Visualizer's browser-side Supabase client is constructed with the **service-role key**, not the anon key: `page.tsx:9-10`, `NEXT_PUBLIC_SUPABASE_SERVICE_KEY`, and this is confirmed as intentional design in `README.md` ("connects to Supabase using the Service Role key (bypassing RLS) so the human user can see the entire graph"). Any user who opens browser dev tools on a deployed instance of this dashboard can extract a key with full unrestricted read/write access to the entire database — independent of whatever the RLS policies say, since `service_role` bypasses RLS by Postgres's own default semantics. This compounds with the previous finding rather than being redundant with it.

**RPC completeness gap:** `flag_for_deletion` (used by both `engine.py:80-83,158-161,521-524` and `page.tsx:569`) is **not defined in any versioned migration file**. It exists only as an ad hoc `CREATE OR REPLACE FUNCTION` duplicated identically across three separate non-migration scripts: `create_rpc.mjs:8-17`, `seed_data.sql:1-11`, and `setup_db.mjs:6-17` (the last via an `exec_sql` RPC call that the script's own comment admits "might not exist," `setup_db.mjs:20`). The versioned `migrations/` folder is therefore not the actual source of truth for the schema — a real deployment following only `migrations/*.sql` (as `docs/deploy.md:74-80` instructs) would be missing this function entirely.

`upsert_pattern_metrics` (called by `server.js:226`) is referenced nowhere else in the entire repository except that one call site and one docs mention — it is **never defined** anywhere. See §13.

Two local-Supabase-CLI default credentials appear in plaintext (`setup_db.mjs:3`, `create_rpc.mjs:3`) — these are Supabase's well-known, publicly-documented default local-dev keys (same for every `supabase start` instance), not a real secret leak, but worth noting so they aren't mistaken for one during review.

---

## 12. APIs

| Surface | Protocol | Endpoint/Tool | Auth |
|---|---|---|---|
| MCP Gateway | MCP (Streamable HTTP) | `store_memory`, `retrieve_memory`, `log_usage`, `get_pattern_details`, `list_categories` | `x-agent-scope` header (403 if missing/invalid, `server.js:390-396`) |
| MCP Gateway | REST | `POST /ingest` | `x-harvester-key` header (`server.js:343-349`) |
| MCP Gateway | REST | `GET /health` | none |
| Orchestrator | MCP (stdio primary, HTTP secondary) | `run_agent_team(task, max_iterations)` | none (local trust boundary — stdio subprocess or unauthenticated `localhost:8100`) |
| Visualizer | Next.js Route Handler | `GET /api/ecosystem-status` | none |
| Visualizer | Next.js Route Handler | `POST /api/run-refinery` | none — and see §14 for why it can't work when deployed |
| Visualizer | Direct DB client | Supabase JS SDK straight to Postgres | service-role key embedded in the client bundle (see §11) |

No API versioning scheme exists anywhere (the MCP server's version bump to `2.0.0` is a display string in `server.js:24`, not a routable `/v2/` path or content-negotiated version).

---

## 13. Learning

The intended learning loop, as designed across `docs/blueprint.md` §8 and `engine.py`'s `run_knowledge_aging`, is: agents call `log_usage` after using a retrieved memory → `retrieval_log`/`pattern_metrics` accumulate → the refinery reads `pattern_metrics` each cycle to promote/demote/decay memories.

**This loop does not function with the code as shipped**, for two independent, compounding reasons:

1. **Nothing calls `log_usage`.** `Memory/aeos-orchestrator/aeos_client.py:14-84` (`AEOSClient`) exposes exactly three methods — `store_memory`, `retrieve_memory`, `health` — and no `log_usage` method exists. A repo-wide grep for `log_usage` returns only its own definition site (`server.js:188`) and one docs mention (`docs/blueprint.md`); no code anywhere in the orchestrator, refinery, harvesters, or visualizer ever invokes the tool.
2. **Even if called, its DB side-effect is broken.** `log_usage`'s handler (`server.js:225-236`) calls `supabase.rpc('upsert_pattern_metrics', ...)` to update the `pattern_metrics` table — but `upsert_pattern_metrics` is never defined anywhere in the schema (confirmed by a repo-wide grep: only this one call site and nothing else). The handler's own comment acknowledges this: *"RPC may not exist yet — this is non-fatal"* (`server.js:233-235`), i.e. the failure is silently swallowed.

Consequently, `run_knowledge_aging`'s Rule 2 (performance adjustment) and Rule 3 (tier promotion) (`engine.py:181-288`) query `pattern_metrics.use_count`/`success_count`/`review_sum` every 5-minute cycle against a table that real agent usage never writes to — these rules can only ever act on rows that were populated some other way (there is none). Rule 1 (stale-candidate demotion, based on `retrieval_log` presence) and Rule 4 (stale seed decay) are less affected since they only need a *retrieval event* to have happened (`retrieve_memory` does log to `retrieval_log` directly, `server.js:158-160`, independent of `log_usage`), so those two rules are the only parts of the aging pipeline actually reachable by real traffic.

A second dead-code observation in the same function: `engine.py:184-188` computes a `log_agg` query result via a `retrieval_log` aggregate select, but the variable is never referenced again anywhere in the function — the actual logic beneath it operates on the (also-broken) `metrics` variable from `pattern_metrics` instead. This looks like an abandoned earlier approach left in place.

**What does work as "learning":** the refinery's per-cycle heuristic quality scoring (`engine.py:39-55`, content-length/tag-count/code-block heuristics — distinct from, and redundant with, the AI-generated `engineering_score` set at distillation time, see §16) and its embedding-similarity-based duplicate flagging (both the efficient per-insert RPC check and the separate O(n²) full-table sweep, see §16) do run and do mutate the store on every cycle, independent of the broken `pattern_metrics` path.

---

## 14. Token Efficiency

Token/context discipline is real but narrow in scope — it applies to what gets **stored**, not to how retrieval results get **assembled or trimmed**:

- **Storage-side discipline:** the refinery's distillation step is hard-capped to a 2-sentence `content` field by prompt instruction (`DISTILL_SYSTEM_PROMPT`, `engine.py:340-357`) and a 40-character `title` cap (`engine.py:452`, also enforced client-side via `maxLength={40}` in the visualizer's add/edit forms, `page.tsx:909,926`). Raw conversation text is deliberately never persisted into `memories` — only `raw_ingest_queue` holds it, and even there `watcher.js:130` caps ingested content at 50,000 characters per POST.
- **Retrieval-side formatting** (`formatMemoryResults`, `server.js:58-78`) is a fixed compact text template, not a token-budget-aware truncator — it does not measure or cap total output size across a multi-result response; it just formats each row consistently. If `limit` (default 5, `server.js:137`) returns 5 large seed patterns with full `include_pattern_details` (code blocks, usage rules), the combined text can still be arbitrarily large — there is no token-count ceiling anywhere in the retrieval path.
- **Scope isolation itself is a token-efficiency mechanism by side effect** — restricting `match_memories` to one scope necessarily shrinks the candidate pool an agent ever has to receive, though this is a security/relevance mechanism first and a budgeting mechanism only incidentally.
- The orchestrator's own context assembly (`_build_context`, `agent_team.py:110-125`) has **no budgeting at all** — see §8.

There is no tokenizer-aware counting, no summarization-on-overflow, and no configurable per-agent token budget anywhere in the codebase — "token efficiency" here means "keep what you store small," not "adapt what you return to a budget."

---

## 15. Codebase Intelligence

**Not present.**

No AST parsing, repo-mapping, symbol indexing, dependency-graph construction, or code-embedding functionality exists anywhere in the implementation. `Memory/aeos-orchestrator/tools.py` — the only place such a thing could plausibly live — contains just five primitives: `read_file`, `write_file`, `edit_file` (naive single-occurrence string replace, `tools.py:35-47`), `list_files` (plain `glob`), and `run_command` (`subprocess.run` with a 60s timeout, no sandboxing beyond that).

`docs/agents and tooling.md` describes an intended `aider_repo_map` tool ("Uses Tree-sitter to extract a ranked, compressed map of the project's classes and functions," lines 216-218) and a `cline_ripgrep_search` tool wrapping `rg` (lines 232-233) — **neither is implemented**. This is purely aspirational documentation; see §10's closing note and §16 below.

---

## 16. Incomplete Work

Concrete gaps between what the docs/code claim and what actually functions, each independently verified:

1. **`log_usage` → `pattern_metrics` learning loop is non-functional end to end** (missing RPC + no caller). See §13.
2. **`flag_for_deletion` RPC is absent from versioned migrations**, defined only redundantly across three ad hoc scripts, one of which admits its own creation mechanism might not work (`setup_db.mjs:18-24`). See §11.
3. **The visualizer's "Run refinery" button shows a hardcoded fake result.** `page.tsx:686` sets the success toast to the literal string `"Refinery complete: 12 embedded, 0 duplicates"` regardless of what the pipeline actually did — the real per-line output returned by the API (`run-refinery/route.ts:19-25`, `data.output`) is fetched into `data` but never read in the success branch.
4. **The `/api/run-refinery` route cannot work in the documented deployment.** `run-refinery/route.ts:6-7` defaults to `execSync`-ing a hardcoded Windows path (`C:\Users\newadmin\Desktop\aeos-brain\Memory\aeos-refinery\venv\Scripts\python.exe`) on the original author's machine. Since the visualizer's actual deploy target is Netlify (serverless functions, no persistent local filesystem or pre-built Python venv — confirmed via `netlify.toml`), this endpoint is unreachable-by-design in production and only ever worked when running locally on that one machine.
5. **`/api/ecosystem-status` only really checks 2 of the 4 services it reports on.** `route.ts:10-15` lists `mcp`, `visualizer`, `watcher`, `db`, but `watcher` and `db` have `url: null` and unconditionally return `status: 'unknown'` (`route.ts:18-20`) — the sidebar's "File Watcher" and "Database" status dots (`page.tsx:711-718`) can never show anything but the neutral/unknown state.
6. **The Chrome extension's "Auto-save on page change" toggle is a stub.** The setting is defined, rendered (`popup.html:64-67`), and persisted to `chrome.storage.sync` (`popup.js:12,29,43,169`, `background.js:12,17,28`), but no code anywhere (content script, background script) ever reads `aeos_auto_save` back out to actually trigger an automatic save on page/content change.
7. **`docs/scaling-plan.md` is 100% aspirational.** Every code sample in it — a Lambda handler (`lambda_handler.py`), Terraform (`terraform/main.tf`, `terraform/cloudwatch.tf`), a deploy shell script (`deploy-lambda.sh`), Redis caching code — describes a *future* migration and does not correspond to any file that exists in the repository. This is appropriate for a plan document, but worth flagging since the mission explicitly asked how much stated intent is actually implemented: here, none of it is, by design.
8. **`docs/agents and tooling.md`'s expanded tool roster (Aider/Cline/Continue.dev/Cursor-derived tools) is entirely undelivered** — see §10, §15.
9. **Dead query in the aging pipeline:** `engine.py:184-188`'s `log_agg` result is computed and never used.

---

## 17. Duplicated Functionality

1. **Two duplicate-detection mechanisms, one of them redundant and much more expensive.** `store_distilled_memory` (`engine.py:496-518`) does an efficient, DB-side, top-3 nearest-neighbor check via the `match_memories` RPC at insert time. Separately, `find_duplicates_and_flag` (`engine.py:57-86`) re-scans **every** memory against **every other** memory in a Python nested loop (O(n²) pairwise cosine comparisons, pulled entirely into Python via `res = supabase.from_("memories").select(...).execute()` then compared with numpy) on **every single refinery cycle** (every 5 minutes in production). The second pass re-covers ground the first pass already checked at insertion time, and its cost grows quadratically as the store grows — directly at odds with the scaling ambitions in `docs/scaling-plan.md` (10K–1M+ memories).
2. **Two quality-scoring mechanisms that don't agree.** The AI-generated `engineering_score` (0–1, from `gpt-4o-mini` at distillation time, `engine.py:340-357`) becomes a `REFINERY` memory's `quality_score` at insert (`engine.py:537`). Separately, `score_memories()` (`engine.py:39-55`) re-derives `quality_score` from a simple non-AI heuristic (40% content length, 30% tag count, 30% code-block presence) for any memory whose score is still `0.0` — a different formula producing a different number for the same field, applied inconsistently depending on how a memory entered the system.
3. **Two "OII" metrics, same name, different formulas, different data sources.** The refinery computes a server-side OII per pipeline run (`engine.py:601-609`: `avg_quality*5 + trusted_ratio*3 + elevated_ratio*1.5 + mass_bonus`, stored in `refinery_runs.oii_score`, charted in the visualizer's Refinery panel, `page.tsx:630-670`). The visualizer's topbar separately computes and labels its own "OII" purely client-side (`page.tsx:673,679`: `avg(quality_score) * 10`, no trusted/elevated weighting at all) directly from the live `memories` table. A user sees "OII" in two places on the same screen with two different numbers and no indication they're different metrics.
4. **`flag_for_deletion` is defined three separate times** in three non-migration files with identical SQL (`create_rpc.mjs`, `seed_data.sql`, `setup_db.mjs` — see §11, §16).
5. **The same 12 demo memories are hand-duplicated in two formats** — `setup_db.mjs:32-45` (JS array) and `seed_data.sql:19-31` (raw SQL `INSERT`) — and have already drifted: one title reads "Force-Directed Graph Physics" in the JS version vs. "Force-Directed Graph Physics Parameters" in the SQL version, for what is otherwise the same row.
6. **Two independent write paths into `memories`/`pending_reviews`**: the MCP gateway (scope-checked, embeds on write) and the visualizer's direct Supabase client (unchecked, service-role, no embedding generated on manual add/edit — `addMemory`, `page.tsx:514-524`, inserts with no `embedding` field at all, meaning visualizer-created memories are invisible to vector search until a later `backfill_embeddings()` refinery pass picks them up).

---

## 18. Architectural Improvements (vs. AEOS)

Judged only against the sibling audit's reported shape of AEOS (SQLite+FTS5+sqlite-vec, local-first, 9 separate single-purpose MCP servers, ~150-file static YAML corpus, a parallel and loosely-integrated set of ~10 Python services):

- **A single unified hybrid-search surface instead of many single-purpose MCP servers.** Where AEOS reportedly split retrieval across 9 separate `mcp-*` packages by domain, AEOS-brain exposes one `retrieve_memory` tool with `filter_source`/`filter_category` parameters (`server.js:132-184`) backed by one `match_memories` RPC that already blends vector + FTS + tag + performance + quality signals server-side (`merge_seed_patterns.sql:160-270`) — a single query surface instead of nine services to keep in sync.
- **Multi-tenant/multi-agent capable by construction.** Postgres + RLS + an HTTP scope header is a real (if imperfectly enforced, see §11) attempt at a shared, concurrently-accessible cloud store; AEOS's local SQLite-per-machine design has no equivalent story for multiple agents/machines sharing one knowledge base simultaneously.
- **A genuinely closed-loop capture pipeline.** AEOS is reported to have no browser extension, no Chrome-based or file-watcher-based capture mechanism, and no Postgres-backed queue/distillation worker. AEOS-brain's harvest → queue → AI-distill → dedup → commit pipeline (`raw_ingest_queue` + `engine.py`) is a complete, running answer to "how does new knowledge get in without a human writing YAML by hand" — something the sibling summary does not describe AEOS as having.
- **A working, richly interactive dashboard.** AEOS is reported to have no Next.js UI, no visual knowledge graph at all. AEOS-brain's visualizer (§19 discusses its costs, but functionally: force-directed graph, live promotion/demotion, pending-review workflow, YAML export) is a capability gap AEOS does not appear to close.
- **Explicit memory-lifecycle/knowledge-aging semantics as first-class schema concepts** (`status` tier progression, `aging_actions` audit log, `pattern_metrics`) — even though the write side of this loop is broken (§13), the *schema and intent* for automated knowledge lifecycle management is more explicit here than what the sibling summary describes for AEOS.

---

## 19. Architectural Regressions (vs. AEOS)

- **Loss of local-first operation.** AEOS is reported to run entirely offline/local (SQLite, no cloud accounts required). AEOS-brain requires, at minimum, a live Supabase project and an OpenRouter API key just to distill or search anything — `engine.py` and `server.js` both hard-fail without network access to Postgres and to an LLM provider for every embedding and every distillation. This is a meaningful loss of the "runs anywhere, no external dependency" property for whatever fraction of users valued it.
- **A severe security regression relative to the RLS-isolation story the system itself claims to implement.** As detailed in §11, the actual RLS policies grant unconditional public read on the three main tables, and the dashboard ships a service-role key to the browser — meaning the "scope-locked cloud database" framing in `docs/blueprint.md` §5.2 does not hold up against the SQL that was actually written. A local SQLite file with OS-level file permissions (AEOS's reported model) has a simpler but arguably more honest security boundary than a cloud multi-tenant store whose isolation exists only in application code that a browser bundle openly bypasses.
- **God-component frontend vs. (per the sibling summary) a modular TypeScript package structure.** AEOS-brain's entire dashboard is one 949-line `page.tsx` client component with 30+ hooks and no sub-component extraction (§20); nothing in the sibling AEOS summary suggests its `knowledge-db`/`core` TypeScript packages are structured this way.
- **Consolidation from 9 domain MCP servers down to 1 generic one is a double-edged sword.** Presented as an improvement in §18 (less to keep in sync), it is simultaneously a regression in per-domain specialization: AEOS's reported per-domain servers (`mcp-frontend`/`mcp-backend`/etc. equivalents) could in principle expose domain-specific tools and validation; AEOS-brain's single `aeos-mcp-server` only varies behavior by a string-tag `scope` parameter, with identical tool shapes and identical logic regardless of domain.
- **Loss of a dedicated evaluation/ranking layer.** The sibling summary describes AEOS's `knowledge-db` package as including "ranking, diversity, retrieval-log, an evaluation harness." AEOS-brain's retrieval is a single fixed weighted-sum SQL query (§7) with no diversity mechanism, and while it does have a `retrieval_log` table, nothing reads it back into ranking (only into the broken performance-scoring loop, §13) — there is no evaluation harness anywhere in this repo.

---

## 20. Technical Debt

- **Global mutable request-scope variable creates a cross-request race condition.** `server.js:19,398` — `currentAgentScope` is a **module-level** variable set at the top of every `POST /mcp` handler and read later, asynchronously, inside tool handlers (`store_memory`, `retrieve_memory`). Under concurrent requests, Node's single-threaded-but-async execution model means Request B can overwrite `currentAgentScope` while Request A is still awaiting its own embedding/DB call, causing Request A's tool call to execute under Request B's scope. This directly undermines the scope-isolation guarantee the rest of the system is built around.
- **Supabase client re-instantiated on every React render — proven live, not just inferred from reading.** `page.tsx:23`: `const supabaseRef = useRef(getSupabaseClient());` — the argument expression is evaluated on *every* render (only the first result is kept by `useRef`), so a new `createClient(...)` (and therefore a new internal `GoTrueClient` auth instance) is constructed on every re-render even though it's discarded immediately. `.ecosystem.log` (a real captured run) shows this happening live: "Multiple GoTrueClient instances detected in the same browser context" warnings fire repeatedly, with an internal instance counter climbing past 60 within roughly 90 seconds of normal interaction (`.ecosystem.log:55-175`, e.g. lines 145,148,151...174 show the counter reaching `:60`,`:61`).
- **Hardcoded, machine-specific absolute paths in two files**, both apparently from the same original author's Windows machine (username `newadmin`): `seed_importer.py:30` (`DEFAULT_SEED_DIR`) and `run-refinery/route.ts:6-7` (`REFINERY_DIR`/`REFINERY_PYTHON` defaults). The second one is load-bearing for a shipped UI feature (§16, item 4); the first is a one-time migration script default.
- **Doc/code parameter-name drift in the harvester's own example file.** `Memory/aeos-harvesters/.env.example:11-15` documents `HARVESTER_AIDER_PATHS` and `HARVESTER_CURSOR_PATH`, but `watcher.js:40,43` actually reads `AIDER_HISTORY_PATHS` and `CURSOR_HISTORY_PATH` (no `HARVESTER_` prefix) — matching what `docs/configuration.md:324-325` documents instead. A user who copies `.env.example` to `.env` and fills in the (wrongly-named) variables will have them silently ignored in favor of defaults.
- **CI's frontend validation gate cannot actually fail the pipeline.** `.gitlab-ci.yml:65-76` (`validate-visualizer`) has `allow_failure: true` at the job level, and its own lint step is piped through `npx next lint --max-warnings 0 2>/dev/null || echo "  ⚠ ESLint skipped (no config)"` — the `||` swallows any nonzero exit code before it can even reach the `allow_failure` gate. In practice this validate stage can never block a merge.
- **Tailwind CSS v4 is installed and wired into the build but effectively unused.** `package.json` lists `tailwindcss`/`@tailwindcss/postcss` as dependencies and `postcss.config.mjs` activates the plugin, but `page.tsx`'s ~150+ `className` usages are all semantic/BEM-style names (`tree-item`, `insp-badge`, `modal-btn`, etc.) styled entirely through `globals.css`'s hand-written CSS-custom-property system — no Tailwind utility class (`flex`, `gap-2`, `text-sm`, etc.) appears anywhere in the file that was read in full.
- **Unnecessary `dangerouslySetInnerHTML` for toast messages.** `page.tsx:947` renders `toastMsg` (which sometimes embeds a raw `<i class=...>` icon tag constructed inline, e.g. `page.tsx:686`) via `dangerouslySetInnerHTML`. Low exploitability in the current code paths (no obviously attacker-controlled string reaches it), but it's a broader-than-needed escape hatch for what is otherwise fixed-shape content.
- **Recursive file watching over an entire home directory, observed live.** `watcher.js`'s glob-to-watch-path resolution (`startWatcher`, lines 249-280) turns a `./**/...` glob pattern into watching the glob's base directory recursively; in the captured run this resolved to the user's entire home directory, producing a stream of `EPERM`/`EACCES` errors from Windows-protected folders (`.ecosystem.log:24-29,43-48,76-77`: `Application Data`, `Cookies`, `Local Settings`, `My Documents`, `WindowsApps\*.exe`, etc.) — noisy, and a sign the watch-path resolution needs to be scoped more precisely than "the glob's root."
- **External CDN dependency for basic visual presentation.** `globals.css:1-2` `@import`s Google Fonts and a Tabler Icons webfont from `fonts.googleapis.com`/`cdn.jsdelivr.net` — the dashboard's icons and typography silently degrade in any network-restricted or offline environment.
- **Zero TODO/FIXME/HACK/XXX markers anywhere in the codebase** (confirmed by repo-wide grep — the only two substring hits are a checklist item's literal text in a review-persona prompt and an unrelated match inside a `package-lock.json` integrity hash). Given the volume of real, unflagged incompleteness documented in §16, this indicates gaps were not self-tracked by the author rather than that the code is unusually complete.
