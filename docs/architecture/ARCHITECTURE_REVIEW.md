# Architecture Review

This document compares `AUDIT_AEOS.md`, `AUDIT_AEOS_BRAIN.md`, `AEOS_COMPARISON.md`, and `MERGE_MATRIX.md` against the authoritative `BLUEPRINT.md` and `ARCHITECTURE.md`. It does not modify either authoritative document. Every recommendation below is a **proposal** requiring explicit human approval before it changes anything.

---

## 1. Method

`BLUEPRINT.md` and `ARCHITECTURE.md` were read in full and treated as authoritative for the target system. The two audits and the comparison/merge-matrix documents were then checked against every stated invariant, non-goal, and architectural boundary in those two documents, looking specifically for: places where real, working code from either reference project contradicts a stated invariant; places where both reference projects independently needed something the target architecture doesn't address; places where the target architecture specifies more than either reference project's real usage ever required; and places where a stated principle exists in both reference projects but demonstrably failed to hold as each project grew.

---

## 2. Architectural Conflicts Found

### 2.1 MCP thin-adapter discipline failed to hold in both predecessor projects — the invariant exists but has no enforcement

`BLUEPRINT.md` ("The MCP layer must remain an adapter... must not contain retrieval, ranking, memory, or context-compilation logic") and `ARCHITECTURE.md §5` state this as a hard boundary. Both reference projects state something similar in their own documentation, and both failed to sustain it past their first iteration:

- AEOS: 4 of 10 MCP servers cleanly delegate to a shared core package; the other 6, built later, each hand-roll their own database connection and business logic (`AUDIT_AEOS.md §5, §37`).
- AEOS-brain: its single MCP server contains embedding generation and validation logic directly in tool handlers rather than delegating to a core service (`AUDIT_AEOS_BRAIN.md §9`).

**Finding:** this is not a one-off implementation mistake — it is the same drift happening independently in two unrelated codebases, both of which stated the same intention up front. A principle that fails twice under real feature-growth pressure without enforcement should not be trusted to hold a third time on documentation alone.

**Proposal:** `BUILD_PLAN.md`'s MCP phase should include a concrete, automated enforcement mechanism (e.g., an import-boundary/dependency-cruiser-style check wired into CI that fails the build if anything under the MCP adapter package imports something other than the core package's public API and the MCP SDK itself) rather than relying on code-review discipline alone. This is a process/tooling recommendation, not a change to the stated architecture — the architecture is already correct; what's missing is a mechanism that makes violating it hard instead of easy.

### 2.2 The outcome-reporting half of the learning loop is the single most consistently-broken piece across both predecessors

Both `logUsage`/`logSuccess`/`logReview` (AEOS) and `log_usage` (AEOS-brain) exist, are exported/exposed, and are called by nothing (`AEOS_COMPARISON.md §6`). This directly corresponds to `ARCHITECTURE.md §17`'s `brain_feedback`/`brain_record_outcome` operations and `BLUEPRINT.md`'s Learning Loop diagram.

**Finding:** the architecture already specifies these operations correctly. The risk is not a design gap — it's that a design being *correct* did not stop two independent implementations from shipping it dead. See `MERGE_MATRIX.md`'s `retrieval-log.ts` entry (marked REWRITE, not ADAPT, specifically because of this).

**Proposal:** treat end-to-end outcome reporting (an agent calls `brain_feedback`, and a later `brain_context`/`brain_recall` call measurably reflects it) as a first-milestone acceptance criterion, not a later-phase nice-to-have. Addressed concretely in `BUILD_PLAN.md` Phase 1 and `IMPLEMENTATION_READINESS.md`.

### 2.3 AEOS-brain's hardcoded agent personas — reviewed and found compatible, not a conflict

`personas.py`/`agent_team.py` hardcode six fixed agent roles with baked-in prompts and tool grants — on its face, this looks like exactly what `BLUEPRINT.md`'s Agent Independence section rules out ("Do not build the core around ArchitectAgent, FrontendAgent, BackendAgent, or ReviewerAgent"). Direct inspection (`AUDIT_AEOS_BRAIN.md §10`) establishes this hardcoding lives entirely inside a self-contained, optional package (`aeos-orchestrator`) that the Brain proper (`aeos-mcp-server`) has zero references to, zero imports from, and no runtime dependency on. The Brain functions identically with the orchestrator absent.

**Finding:** no conflict. This is a real, running demonstration that the Brain/Agent boundary the target architecture specifies is achievable in practice, not just on paper — the orchestrator is exactly the kind of "external agent" the architecture already says the Brain must remain agnostic to. See `MERGE_MATRIX.md`'s `aeos-orchestrator` entry for the resulting recommendation (useful as an `examples/` integration-test fixture, never as an influence on Brain-side design).

### 2.4 AEOS-brain's hard dependency on external LLM/embedding APIs conflicts with the local-first storage direction

`ARCHITECTURE.md §25` says "avoid prematurely coupling the architecture to... one embedding provider... one LLM provider" and both `BLUEPRINT.md`/`ARCHITECTURE.md` specify a local-first initial direction. AEOS-brain requires a live OpenAI/OpenRouter API key for every embedding and every distillation — it hard-fails offline (`AUDIT_AEOS_BRAIN.md §19`).

**Finding:** the target architecture already states the right general principle but doesn't say concretely enough what "avoid coupling" requires in practice. AEOS's own local-embedding approach (`@xenova/transformers`, in-process, no API call) proves a no-external-dependency default is achievable without sacrificing real functionality — see §4 below for the specific proposed strengthening.

---

## 3. Missing Abstractions (things the audits show are needed that the current docs don't address)

### 3.1 Capture/ingest as a category of adapter-side consumer

AEOS-brain's harvester layer (Chrome extension + file watcher → staging queue → AI distillation → store) is real, working, and genuinely useful (`AUDIT_AEOS_BRAIN.md §5`), but neither `BLUEPRINT.md` nor `ARCHITECTURE.md` mentions passive/automated capture anywhere — both documents model memory-writing as agent-initiated (`brain_remember` called by an external agent).

**Finding:** on reflection, this does not require a new Brain-internal layer. `BLUEPRINT.md`'s existing "Adapter" category already owns "MCP, SDK, HTTP, CLI, IDE integrations" — a capture tool (browser extension, file watcher) is architecturally just another external, adapter-side consumer that happens to call `brain_remember` on its own trigger rather than an agent's. No Brain-core change is implied.

**Proposal:** no architectural change needed. Recommend a one-line clarification wherever adapters are enumerated, noting that adapter-side consumers include both interactive agents and automated capture agents, both bound by the same `brain_remember`/scope/permission rules — purely a documentation clarity improvement, not a new capability. Explicitly **not recommended for Phase 1 implementation** — passive capture (especially browser-based) carries consent/privacy/security weight (AEOS-brain's own watcher had a live over-broad-recursive-watch bug touching protected OS folders, `AUDIT_AEOS_BRAIN.md §20`) that deserves its own deliberate design pass later, not silent inclusion now.

### 3.2 No concrete requirement that core packages function fully offline by default

Related to §2.4. `ARCHITECTURE.md §25` states the *avoidance* goal (don't prematurely couple to one provider) but not a *positive* requirement (the default path must work with zero external network calls). AEOS-brain's worst architectural regression relative to AEOS was losing exactly this property (`AUDIT_AEOS_BRAIN.md §19`).

**Proposal:** add an explicit invariant (candidate wording, for human review, not applied to `ARCHITECTURE.md` directly): *"The Brain's default/reference configuration must perform basic memory and knowledge write/retrieval operations with zero required external network calls. Hosted embedding or LLM providers may be configured as optional enhancements but must never be load-bearing for core operation."* This is directly evidenced by both audits: AEOS proves it's achievable (local transformer-based embeddings, `AUDIT_AEOS.md §13`), AEOS-brain proves what happens when it's skipped.

### 3.3 No enforcement mechanism named for the MCP-thinness invariant

Covered in §2.1. The invariant itself is already correctly stated in both `BLUEPRINT.md` and `ARCHITECTURE.md`; what's missing is any named mechanism for keeping it true over time. Proposal is procedural (CI check), not a change to the stated architecture — see §2.1 and `BUILD_PLAN.md`.

### 3.4 No explicit testing requirement as an architectural gate

Neither `BLUEPRINT.md` nor `ARCHITECTURE.md` states that core packages require automated tests before being considered complete. Both reference projects shipped a combined ~35 components with effectively zero automated test coverage on their core logic (`AEOS_COMPARISON.md §5-6`), and both accumulated exactly the class of bug automated tests exist to catch: a schema that silently drops fields, a broken RPC call whose failure is silently swallowed, a race condition on shared mutable state, a dead code path nobody noticed for the life of the project.

**Proposal:** add a lightweight process invariant — core packages (`packages/core/*`) require unit tests as a merge gate; any code path with a "never throws, degrades gracefully" contract (a pattern both reference projects use extensively) requires a test proving the degradation path actually degrades, not just the happy path. Enforced concretely in `BUILD_PLAN.md`'s per-phase acceptance criteria.

---

## 4. Unnecessary Abstractions (things the current docs specify that the evidence doesn't support building up front)

### 4.1 The eight-level scope hierarchy is more elaborate than either reference project's real usage required

`BLUEPRINT.md`/`ARCHITECTURE.md` specify `global → user → organization → project → repository → workspace → agent → session`. Neither reference project implements or needed anything close to this: AEOS has no scope concept at all (single local file, single user); AEOS-brain has one flat 4-value tag.

**Important clarifying finding, not just a simplification note:** AEOS-brain's "scope" (`frontend`/`backend`/`architecture`/`general`) and AEOS's "domain" (`design`/`backend`/`architecture`/`engineering`) are both **content-category tags**, not access-isolation scopes in the blueprint's sense — they answer "what kind of knowledge is this," not "who is allowed to see this." Both reference projects partially conflate these two different axes (AEOS-brain additionally tries to use its content-category tag as a security boundary via RLS, and that enforcement doesn't actually work — `AUDIT_AEOS_BRAIN.md §11`). **The new Brain must keep these as two clearly separate concepts** (a content/domain taxonomy vs. a hierarchical access-scope), not reuse one field for both purposes as both predecessors did.

**Proposal:** `BLUEPRINT.md` already hedges this correctly ("Not every deployment needs every scope"). Recommend Phase 1 implement a minimal working subset — `global`, `project`, `session` are sufficient to cover everything either reference project actually exercised — and treat `user`/`organization`/`repository`/`workspace`/`agent` as documented-but-deferred until real multi-user/multi-repo demand appears. This is confirmation of an already-stated hedge, not a proposed change to the architecture.

### 4.2 No other over-specification found

The rest of `BLUEPRINT.md`/`ARCHITECTURE.md` was checked against the audits component-by-component; no other section specifies meaningfully more than the evidence supports. The 12-type memory model, the multi-stage retrieval pipeline, and the token-budgeting-as-hard-boundary requirement are all *less* than what would be needed to fix problems the audits actually found (both predecessors' memory models were coarser than 12 types, not finer; both skipped token budgeting entirely rather than over-building it).

---

## 5. Reusable Components

Full detail in `MERGE_MATRIX.md`. Summary: 13 components marked **KEEP/ADAPT**, concentrated in three areas — retrieval/ranking signal design (AEOS's `hybridSearch`/`ranking.ts`/evaluation harness), storage (SQLite/WAL/FTS5/sqlite-vec/local embeddings), and the memory-unification design principle (AEOS-brain's single-table, source-differentiated schema, as a concept). The seed knowledge corpus itself (98 YAML files) is a straightforward **KEEP** as content.

## 6. Components Requiring Redesign

3 components marked **REWRITE** in `MERGE_MATRIX.md`, all converging on the same theme: the outcome-feedback/learning-loop machinery (§2.2 above), and the `aeos-mcp-server`/dashboard implementations specifically because their *concepts* are sound but their code has concrete, disqualifying defects (a race condition; a browser-exposed privileged database key) that must not be carried forward under any "adapt" framing.

## 7. Components That Should Remain Reference-Only

- `aeos-orchestrator` — never part of the Brain; valuable only as a possible `examples/` integration-test fixture (§2.3).
- AEOS's 4 clean thin-adapter MCP servers (`mcp-design`/`backend`/`architecture`/`engineering`) — valuable as an internal "this is what correct looks like" reference during implementation, not as literal code to ship (the tool surface itself must change to match the blueprint's small stable operation set).
- `aeos-visualizer` — valuable as a design/UX reference for a future dashboard (directly responsive to the project brief's request to consider reusing AEOS-brain's UI/UX), not as a code base, given its security defect and monolithic structure.

## 8. Components That Should Be Removed

18 components marked **DROP** in `MERGE_MATRIX.md`. Concentrated in: orphaned Python duplicates (AEOS), the turbovec/CLIP vector-sidecar dependency chain, cloud/Postgres-specific tooling (AEOS-brain), and deployment configuration for a cloud topology the Brain isn't targeting yet. None of these removals are controversial — each is either fully superseded by an ADAPT/KEEP decision elsewhere in the matrix, or was already orphaned/non-functional in its source project.

---

## 9. Architectural Assumptions That Should Not Survive

- **"One MCP server per knowledge domain scales."** Disproven directly by AEOS's own 10-server drift. The blueprint's small stable surface is correct and should not be second-guessed toward AEOS's original topology.
- **"Orchestration and the Brain can reasonably share a codebase/package."** AEOS-brain's own successful separation disproves the need for this even as a convenience; keep them physically separate from the start.
- **"A cloud-hosted, API-dependent default is acceptable for core operation."** AEOS-brain's experience argues strongly against this as a *default* (optional, opt-in cloud/hosted providers are fine — see §3.2).
- **"Content-domain tagging and access-scope isolation can share one field."** Both predecessors partially made this assumption; §4.1 explains why the new Brain must not.
- **"A stated principle holds without an enforcement mechanism."** The single clearest lesson from comparing both predecessors: every major architectural erosion in both projects (MCP thinness, schema-single-source-of-truth, outcome-reporting wiring) was a principle that was written down correctly and then not enforced by anything other than intent. Wherever `BUILD_PLAN.md` implements an invariant from `BLUEPRINT.md`/`ARCHITECTURE.md`, prefer pairing it with something that fails loudly (a test, a lint rule, a type constraint) over documentation alone.

## 10. Capabilities Missing From the Target Architecture

- Passive capture/harvest tooling — addressed in §3.1 as a documentation clarification, explicitly deferred rather than built.
- A dashboard/visualizer — the blueprint already correctly defers this to Phase 6 ("Ecosystem... UI"); no change needed, but `aeos-visualizer` is now the concrete starting reference when that phase arrives (§7).
- An explicit "quality gate before promotion" validation step distinct from scoring — AEOS's `abstraction-validator` concept (marked INVESTIGATE in `MERGE_MATRIX.md`); worth a deliberate decision during the Learning phase design, not required for the initial milestone.

---

## 11. Target System Definition (Phase 4)

Layer boundaries for the new Brain, informed by the audits and the conflict/gap analysis above. This section defines *what each layer owns and does not own*; `BUILD_PLAN.md` sequences how they get built.

### Brain Core (`packages/core/*`)
Pure logic. No HTTP framework, no MCP SDK, no database driver specifics beyond an injected storage interface. Must be unit-testable with no network and no filesystem beyond an in-memory or temp SQLite instance. Sub-modules, each independently testable:
- **`contracts/`** — Zod-validated types for the 12 memory types, scope model, task/context-request/context-pack shapes. Informed by AEOS's `packages/core` (ADAPT), redesigned for the full type taxonomy and strict parsing.
- **`memory/`** — CRUD + lifecycle (Candidate→Validated→Active→[reused/weakened/stale]→Archived) for typed, scoped memory records, with per-write provenance/audit logging from day one. Informed by AEOS-brain's unification principle (ADAPT) and its missing-audit-trail gap (fixed, not repeated).
- **`retrieval/`** — Candidate generation only: lexical (FTS5/BM25), semantic (vector), tag/metadata, code/symbol, episodic. Returns an unranked candidate pool. Informed by AEOS's `hybridSearch()` (ADAPT), split so this stage does *not* also rerank (addressing the "folded into one pass" weakness noted in `MERGE_MATRIX.md`).
- **`ranking/`** — A distinct second stage: relevance, usefulness, confidence, scope, freshness, diversity, exploration. Informed by AEOS's `ranking.ts`/`diversity.ts` (ADAPT/INVESTIGATE).
- **`context/`** — Deduplication, conflict detection/flagging, compression, and the Context Compiler itself. Neither reference project has this layer at all — new design work, using both projects' "keep what you store/return small" discipline as informing precedent, not code.
- **`token/`** — Token budget estimation and **hard enforcement** on every context-pack exit path. Informed by AEOS's dead `stripToContextBudget` (REWRITE — must be load-bearing this time, per §2.2).
- **`learning/`** — Retrieval telemetry (proven pattern in both predecessors), outcome feedback (`brain_feedback`/`brain_record_outcome` — REWRITE, §2.2), promotion/demotion (ADAPT from both predecessors' converging threshold design), and evaluation (ADAPT from AEOS's Precision/Recall/NDCG harness, this time actually scheduled/reachable).
- **`compression/`** — Summarization/trimming logic feeding the Context Compiler. New design work; neither predecessor has anything beyond fixed-format templating.

### Storage (`packages/storage`)
SQLite + WAL + FTS5 + sqlite-vec, local-first, single schema source of truth (fixing AEOS's two-unsynchronized-paths defect). Local embedding generation (AEOS's `@xenova/transformers` approach) as the zero-dependency default, behind a replaceable provider interface so a hosted model can be swapped in as an opt-in enhancement (§3.2). Owns nothing about ranking, retrieval logic, or memory typing — purely persistence and similarity search primitives.

### Codebase (`packages/codebase`)
Offline indexer(s) writing artifacts that the core `retrieval/` layer can query directly — no live coupling to an indexing process at query time. Informed by AEOS's codebase/document/dependency-graph subsystem (ADAPT), the best cross-language integration either predecessor achieved. Regex-based chunking is an acceptable starting point; AST-based chunking is a known future upgrade, not a Phase 1 requirement.

### Knowledge (`packages/knowledge`)
The seed corpus (98 YAML patterns, KEEP as content) plus whatever reusable-knowledge-vs-experience distinction the blueprint's "Knowledge vs. Experience" section requires. Distinct from Memory: knowledge is broadly reusable; memory/experience is interaction-derived and only promotable into knowledge through the `learning/` promotion pipeline, never automatically.

### Brain Gateway
Establishes request context — identity, session, project/repository, requested scope, token budget, capabilities/permissions — before anything reaches Core. Neither reference project has a distinct component like this (AEOS-brain's closest analog, the module-level `currentAgentScope` variable, is exactly the race-condition antipattern this layer must avoid — request-scoped, never module-scoped). New design work, directly specified already by `ARCHITECTURE.md §6`.

### MCP Adapter (`packages/mcp`)
Thin, stable, small: `brain_context`, `brain_recall`, `brain_search`, `brain_remember`, `brain_update`, `brain_forget`, `brain_feedback`, `brain_record_outcome`, `brain_status`, `brain_project` — the operation set `BLUEPRINT.md`/`ARCHITECTURE.md` already name. Every handler does argument validation and Gateway-context resolution only, then calls one Core/Gateway service method and returns its result — no branching business logic in the adapter itself. Enforced by the CI import-boundary check proposed in §2.1. Informed by AEOS's 4 clean servers as a pattern reference (ADAPT) and AEOS-brain's 5-tool surface as a naming/shape reference (ADAPT), explicitly not their granularity (10 servers) or their implementation (business logic in handlers).

### SDK / CLI Adapters (`packages/sdk`, `packages/cli`)
Same Gateway/Core services as the MCP adapter, different transport. No logic duplicated between adapters — if the MCP adapter and the CLI adapter ever disagree on behavior for the same operation, that is a bug by definition, since both must be thin callers of the same Core service.

### Explicitly out of the Brain's package tree
Orchestration/multi-agent coordination (`aeos-orchestrator`, `services/parallel-orchestrator` — both DROP from Brain scope, §2.3 and `MERGE_MATRIX.md`), any dashboard/visualizer (deferred to Phase 6, `aeos-visualizer` as design reference only), and passive capture tooling (§3.1, deferred).
