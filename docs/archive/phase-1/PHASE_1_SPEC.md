# Phase 1 Specification — Brain Core

Implementation-ready specification for `BLUEPRINT.md`/`BUILD_PLAN.md` Phase 1 (sub-milestones 1.1–1.4: Contracts + Storage, Memory Layer, Retrieval + Ranking, Context Compiler + Token Budgeting) and Phase 2 (MCP), to the extent Phase 2's contracts must be fixed now (§MCP Boundary). Resolutions from `DECISIONS.md` are treated as settled; this document does not re-argue them, only applies them.

---

## Objective

Build the smallest set of packages that correctly establish: typed, scoped, audited memory storage; retrieval as a stage separate from ranking; a context compiler that never exceeds a token budget; and event provenance reliable enough for a future (Phase 4) learning loop to consume without redesign. Expose all of it through a stable, mechanically-thin MCP surface.

## Scope

In scope for this specification: `packages/core/{contracts,memory,retrieval,ranking,context,compression,token,learning}`, `packages/storage`, `packages/knowledge` (thin), `packages/mcp`, the Brain Gateway, and the CI boundary-enforcement design. Scopes `global`/`project`/`session` only (D5). Local SQLite + FTS5 + sqlite-vec + local embeddings only (no hosted provider wired up as default).

## Non-Goals (explicitly not this phase)

- Codebase intelligence (Phase 3).
- Outcome data actually influencing ranking (Phase 4) — Phase 1 records outcomes reliably; nothing reads them back yet.
- Promotion/demotion automation, evaluation scheduling (Phase 4).
- `user`/`organization`/`repository`/`workspace`/`agent` scopes (documented, not implemented — D5).
- Diversity-based reranking, exploration scoring (interface slot reserved, unimplemented — D7).
- Any quality-gate/validator before promotion (D7 — no promotion pipeline exists yet to gate).
- LLM-based summarization/compression (would violate the local-first invariant, `ARCHITECTURE.md` invariant 19) — Phase 1 compression is truncation-only.
- Passive capture/harvest adapters (D6).
- SDK, CLI, dashboard, cloud sync (Phase 6).
- Predictive retrieval, caching, contradiction detection (Phase 5).

## Final Decisions (summary — see `DECISIONS.md` for full reasoning)

D2: single `memories` table, `type` discriminator. D3: local-first is now `ARCHITECTURE.md` invariant 19. D4: MCP/Core and Core/Storage boundaries are CI-enforced by design from Phase 1 onward (tooling lands Phase 2). D5: `ScopeRef.kind ∈ {global, project, session}`. D6/D7/D8: deferred, no Phase 1 component built for any of them.

---

## Package Architecture

Dependency direction is a strict DAG. No package below may import a package to its right in the same row or below unless explicitly listed as an allowed dependency.

```
packages/core/contracts   (leaf — depends on nothing but zod)
        ^
        |
packages/core/{memory, retrieval, ranking, context, compression, learning}
   (each depends only on core/contracts + its own repository/store interface;
    context and compression are pure, no repository/store interface at all)
        ^
        |
packages/core/token   (depends on core/compression, in addition to core/contracts)
        ^
        |
packages/knowledge   (depends on core/memory; thin specialization, not a separate store)
        ^
        |
packages/mcp   (depends on core's public service exports only)
```

`packages/storage` implements the repository/store interfaces declared in `packages/core/contracts`. It is consumed via dependency injection at a single **composition root** (the `packages/mcp` server bootstrap file) — the only file in the system allowed to import both a concrete `packages/storage` implementation and a `packages/core` service constructor. No other file wires the two together.

### Per-package contracts

#### `packages/core/contracts`
- **Responsibility:** All shared types/Zod schemas — `MemoryRecord`, `ScopeRef`, `MemoryCreateInput`/`UpdateInput`/`Query`/`Result`, `Candidate`, `RankedResult`, `ContextPack`, the five event shapes *(corrected post-Phase-1 per E24: documentation only, no code behaviour changed)* — `MemoryMutationEvent` joins the original four — all repository/store *interfaces* (types only, no implementation).
- **Public interfaces:** The types/schemas themselves.
- **Dependencies allowed:** `zod`.
- **Dependencies forbidden:** everything else in the repo.
- **Test requirements:** Schema validation — one valid and at least one invalid fixture per type; `.strict()` rejection test (a payload with an unrecognized field must fail validation, not silently drop it — directly targeting `AUDIT_AEOS.md §8`'s bug class).

#### `packages/core/memory`
- **Responsibility:** Memory CRUD + lifecycle transitions + provenance/audit logging.
- **Public interfaces:** `MemoryService.{create, get, update, archive, query}`.
- **Dependencies allowed:** `core/contracts`, the `MemoryRepository` interface (implementation injected).
- **Dependencies forbidden:** `packages/storage` (concrete), `packages/mcp`, any DB driver.
- **Test requirements:** CRUD round-trip against an in-memory fake `MemoryRepository`; lifecycle-transition validity (illegal transitions rejected); every mutation produces exactly one audit-log entry.

#### `packages/core/retrieval`
- **Responsibility:** Candidate generation only — lexical, semantic, tag/metadata filtering. Never ranks, never compiles context.
- **Public interfaces:** `RetrievalService.getCandidates(RetrievalQuery): Candidate[]`.
- **Dependencies allowed:** `core/contracts`, the `RetrievalStore` interface.
- **Dependencies forbidden:** `core/ranking` (one-directional — ranking depends on retrieval's output type, not the reverse), `packages/mcp`, concrete storage.
- **Test requirements:** Fixture-based candidate generation; degradation test (vector index unavailable → falls back to lexical-only without throwing).

#### `packages/core/ranking`
- **Responsibility:** Reranking only — a pure function over `Candidate[]`.
- **Public interfaces:** `RankingService.rank(candidates: Candidate[], weights?: RankingWeights): RankedResult[]`.
- **Dependencies allowed:** `core/contracts` only. **No I/O, no repository dependency** — every signal ranking needs must already be present on the `Candidate` objects passed in.
- **Dependencies forbidden:** everything except contracts.
- **Test requirements:** Pure unit tests — fixed input candidates, assert expected order and scores. The easiest package in the system to test exhaustively; there is no excuse for this package shipping without full coverage.

#### `packages/core/context`
- **Responsibility:** Deduplication (exact-content-match only) and final assembly of ranked candidates into a budget-free `CompiledContext`, at full source fidelity. Does **not** invoke compression and does **not** enforce a token budget — those belong to `core/token`, as a distinct, later stage. (Corrected: the original wording here bundled compression-invocation and budget-enforcement into this package's own responsibility. `ARCHITECTURE.md`/`BLUEPRINT.md`'s own suggested layout already lists `context/`, `compression/`, and `token/` as three separate directories; this text now matches that and matches the actual two-stage implementation — P1-010 produces `CompiledContext`, P1-011 consumes it and produces the budget-enforced `ContextPack`.)
- **Public interfaces:** `compileContext(CompileContextInput): CompiledContext`.
- **Dependencies allowed:** `core/contracts` only.
- **Dependencies forbidden:** `core/retrieval`, `core/ranking`, `core/token`, `core/compression`, `packages/mcp`, concrete storage.
- **Test requirements:** Dedup test (exact-content-match only); ordering-preservation test; provenance-preservation test.

#### `packages/core/compression`
- **Responsibility:** Truncation-based content shrinking. **Non-LLM in Phase 1** — see Token Budgeting below.
- **Public interfaces:** `compress(content: string, targetTokens: number, estimate: (text: string) => number): {content: string, wasCompressed: boolean}`. The estimator is a parameter, not a package import — this package has no dependency on `core/token` at all, avoiding what would otherwise be a circular dependency (`core/token` calls `core/compression`, which would need `core/token`'s estimator back).
- **Dependencies allowed:** none beyond the language/test runtime.
- **Dependencies forbidden:** everything else, including `core/token`.
- **Test requirements:** Truncated output never exceeds `targetTokens` per the passed-in estimator; truncation marker is present when truncation occurred; below a documented minimum floor, the function signals "cannot fit" rather than producing a useless fragment.

#### `packages/core/token`
- **Responsibility:** The token-budget stage as a whole: token estimation, invoking `core/compression` when an item doesn't fit as-is, quality-aware greedy selection under budget (skip a non-fitting item and continue trying subsequent — still rank-ordered — items, rather than stopping at the first miss), and final assembly into the budget-enforced `ContextPack`. Consumes `core/context`'s `CompiledContext` output; does not call `core/context`, `core/retrieval`, or `core/ranking` itself.
- **Public interfaces:** `optimizeContext(CompiledContext, TokenBudget): ContextPack`. The default token estimator is exported separately and is replaceable.
- **Dependencies allowed:** `core/contracts`, `core/compression`.
- **Dependencies forbidden:** `core/context`, `core/retrieval`, `core/ranking`, `packages/mcp`, concrete storage, network, filesystem.
- **Test requirements:** The budget-never-exceeded property test (the most important test in the package, across zero-budget and single-huge-item edge cases); a single oversized top-ranked item does not starve smaller lower-ranked items out of an otherwise-fittable budget.

#### `packages/core/learning`
- **Responsibility (Phase 1 scope only):** Record the five event types *(corrected post-Phase-1 per E24: documentation only, no code behaviour changed)* faithfully, with correct linkage. **Not** aggregation, **not** promotion/demotion, **not** anything that reads events back into ranking — that is Phase 4.
- **Public interfaces:** `EventService.{recordRetrieval, recordContext, recordOutcome, recordFeedback, getEventsForTask, getEventsForMemory}`.
- **Dependencies allowed:** `core/contracts`, the `EventStore` interface.
- **Dependencies forbidden:** concrete storage, `packages/mcp`.
- **Test requirements:** Every event type round-trips; `ContextEvent.retrievalEventId` and `OutcomeEvent.taskId` linkage is queryable and correct.

#### `packages/storage`
- **Responsibility:** Concrete SQLite/WAL/FTS5/sqlite-vec implementation of every repository/store interface declared in `core/contracts`; the default local `EmbeddingProvider`; schema and migrations.
- **Public interfaces:** Concrete classes implementing `MemoryRepository`, `RetrievalStore`, `EventStore`, `EmbeddingProvider`.
- **Dependencies allowed:** `better-sqlite3`, `sqlite-vec`, `@huggingface/transformers` *(corrected post-Phase-1 per E24: documentation only, no code behaviour changed)*, `core/contracts`.
- **Dependencies forbidden:** any other `core/*` submodule, `packages/mcp`.
- **Test requirements:** Schema creation from empty DB; 12-type round-trip; FTS5/vector fixture correctness; migration-apply-from-empty test.

#### `packages/knowledge`
- **Responsibility:** Seed-corpus import and knowledge-vs-experience helper queries. A thin specialization over `core/memory`, **not** a separate physical store (per D2's unification principle).
- **Public interfaces:** `KnowledgeImporter.importSeed(patterns): ImportResult`; `KnowledgeQuery.listByDomain(domain): MemoryRecord[]`.
- **Dependencies allowed:** `core/contracts`, `core/memory` (calls `MemoryService.create` — never bypasses it).
- **Dependencies forbidden:** `packages/storage` directly, `packages/mcp`.
- **Test requirements:** Seed import produces valid records; a malformed seed file is **rejected loudly** by the `.strict()` schema (not silently stripped — directly fixing `AUDIT_AEOS.md §8`).

#### `packages/mcp`
- **Responsibility:** The Brain Gateway (request-scoped identity/session/scope/budget/permission resolution) and the ten `brain_*` tool handlers. See §MCP Boundary.
- **Public interfaces:** N/A (this is the outermost layer; nothing depends on it).
- **Dependencies allowed:** `@modelcontextprotocol/sdk`, `core/contracts`, and the public service exports of `core/memory`, `core/retrieval`, `core/ranking`, `core/context`, `core/learning`. *(Corrected per E24: the package is `packages/knowledge`, not `core/knowledge`, and `packages/mcp` does not import it at all. Documentation only.)* The composition-root bootstrap file additionally imports `packages/storage`'s concrete implementations — no other file in this package may.
- **Dependencies forbidden:** `better-sqlite3`, `sqlite-vec`, any `packages/storage` internal path from any file other than the bootstrap.
- **Test requirements:** One integration test per `brain_*` operation; the cross-scope concurrency test (below); the import-boundary check itself, run as a CI step.

---

## Core Contracts

### Memory Model

**Type taxonomy (unchanged from `ARCHITECTURE.md`):** `fact | decision | pattern | rule | procedure | experience | error | constraint | project_state | task_state | agent_experience | preference`.

**`MemoryRecord`** (as returned to callers — never includes the raw embedding vector; that stays inside `packages/storage`):

| Field | Type | Required | Notes |
|---|---|---|---|
| `id` | string (uuid) | yes | |
| `type` | enum (12 values above) | yes | Immutable after creation — see below |
| `content` | string | yes | |
| `domain` | string \| null | no | Content-category tag. **Never used for authorization** (`ARCHITECTURE.md` §8 addition) |
| `scope` | `ScopeRef` | yes | Immutable after creation |
| `source` | `Provenance` | yes | `{ origin: 'agent'\|'system'\|'import'\|'derived', agentId?, sessionId?, taskId? }` |
| `confidence` | number (0–1) | yes | Defaults to `0.5` if omitted on create — a stated, deliberate default rather than forcing every caller to guess |
| `status` | `'active' \| 'archived'` | yes | Phase 1 minimal set. Richer lifecycle values (`candidate`, `elevated`, `trusted`, `stale`) are a Phase 4 *addition to this same enum*, not a schema change |
| `tags` | string[] | no | Free-form, filterable |
| `supersedes` | string (memory id) \| null | no | The one narrow relationship evidenced by the audit (AEOS's `superseded_by`, `AUDIT_AEOS.md §6`). No general relationship graph in Phase 1 — insufficient evidence either predecessor needed one |
| `createdAt`, `updatedAt` | ISO timestamp | yes | |

**`MemoryCreateInput`:** `type`, `content`, `scope` (required); `domain?`, `source?` (Gateway fills what it can from request context; caller may supply the rest), `confidence?` (defaults 0.5), `tags?`, `supersedes?`.

**`MemoryUpdateInput`:** `id` (required); `content?`, `domain?`, `tags?`, `confidence?`, `status?` (only `active → archived` is a legal transition via update — see Lifecycle below). **`type` and `scope` are not updatable fields.** Getting the type wrong means creating a replacement and archiving the original (via `supersedes`); moving scope is security-relevant enough to deserve its own explicit future operation if ever needed, not silent inclusion in a generic update.

**`MemoryQuery`:** `scope` (required — every query is scope-bound, no unscoped query exists), `type?`, `tags?`, `status?`, `limit`, `cursor?`. This is the plain filtered-list operation, distinct from ranked search (§Retrieval Pipeline below) — it lives in `core/memory`, not `core/retrieval`.

**`MemoryResult`:** `{ items: MemoryRecord[], nextCursor?: string }`.

**Lifecycle (Phase 1 minimal):** `active → archived` only, via `archive(id)`. No `archived → active` restore operation in Phase 1. The full `Candidate → Validated → Active → {reused|strengthened|weakened|stale} → Archived` lifecycle from `ARCHITECTURE.md §19` is the target end state; Phase 1 implements only the two states it can actually drive without a promotion pipeline (Phase 4), and the `status` field's enum is designed to grow, not be replaced, when Phase 4 lands.

**Provenance/audit:** every `create`/`update`/`archive` call appends one row to the mutation audit trail — implemented as `memory_mutation_events`, routed through the same append-only `EventStore` abstraction rather than a separate audit mechanism *(corrected post-Phase-1 per E24: documentation only, no code behaviour changed)* — (mutation type, actor, before/after summary, timestamp) — closing the gap `AUDIT_AEOS_BRAIN.md §5` found (automated decisions were logged, manual edits were not).

### Scope Model

```ts
type ScopeRef = {
  kind: 'global' | 'project' | 'session';
  id: string | null; // null only when kind === 'global'
};
```

Every repository and store method that touches memory data takes a `ScopeRef` and enforces it **at the storage query itself** (`WHERE scope_kind = ? AND scope_id = ?` or `scope_kind = 'global'`), not as a post-query application-code filter — this is the exact class of failure `AUDIT_AEOS_BRAIN.md §11` documented (RLS policies that existed but didn't actually restrict anything). `user`/`organization`/`repository`/`workspace`/`agent` remain documented in `ARCHITECTURE.md`/`BLUEPRINT.md` as future `kind` values; adding one later is an enum extension, not a schema migration of existing data.

`domain` (content taxonomy) is a completely separate, optional, non-enforced field. A query may filter by `domain` for relevance; it never substitutes for a `scope` check.

---

## Retrieval Pipeline

Three separate stages, three separate function calls — never combined into one pass (the mistake both predecessors made, `AUDIT_AEOS.md §11`, `AUDIT_AEOS_BRAIN.md §7`).

### 1. Candidate Generation (`core/retrieval`)

```ts
RetrievalQuery = { text: string, scope: ScopeRef, filters?: { type?, domain?, tags? }, limit: number }
→ Candidate[]

Candidate = {
  memoryId: string,
  record: MemoryRecord,        // embedding excluded
  signals: { lexicalScore?: number, semanticScore?: number, tagScore?: number }
}
```

Candidates carry **raw, individual, visible per-signal scores** — not yet combined. Never throws; degrades (e.g. vector index unavailable → lexical-only) rather than failing the whole call, following AEOS's proven discipline (`AUDIT_AEOS.md §10`).

### 2. Ranking (`core/ranking`)

```ts
RankingInput = { candidates: Candidate[], task?: string, weights?: RankingWeights }
→ RankedResult[]

RankedResult = {
  memoryId: string,
  record: MemoryRecord,
  score: number,                          // final combined score
  signals: Candidate['signals'] & { diversity?: null }, // slot reserved per D7, unused in Phase 1
  rank: number
}
```

Phase 1 combines `lexicalScore`/`semanticScore`/`tagScore` via a weighted sum (default weights adapted from AEOS's `hybridSearch()`, `AUDIT_AEOS.md §11`, re-derived rather than hardcoded so Phase 4 can extend with performance/exploration signals as new optional weight keys — not a function-signature change). No performance or exploration signal in Phase 1: there is no usage history yet to compute one from (cold start, as flagged in `BUILD_PLAN.md` Phase 1.3 Risks). `record.confidence` (a property of the memory) is passed through unchanged and must never be conflated with `score` (a property of this query's relevance) — both predecessors blur analogous distinctions (e.g. AEOS additively stacks a performance boost on top of an already-normalized relevance score, `AUDIT_AEOS.md §11`).

### 3. Context Compilation (`core/context`) — budget-free

```ts
CompileContextInput = { task: string, scope: ScopeRef, rankedResults: RankedResult[], agentCapabilities?: string[] }
→ CompiledContext = {
    items: { memoryId, content, type, domain, scope, source, confidence, score, rank, wasCompressed: false }[],
    duplicatesRemoved: number
  }
```

This stage deduplicates (exact content-string match only) and assembles ranked candidates at full source fidelity, preserving `rankedResults`' order exactly. It does not know about token budgets and cannot accept one (`CompileContextInput` has no `budget` field). Every `ContextItem` carries full provenance (`memoryId`, `type`, `domain`, `scope`, `source`, `confidence`), which is what makes outcome attribution possible later (§Learning/Outcome Telemetry) — this provenance link is the one both predecessors were missing.

### 4. Token Optimization (`core/token`) — budget enforcement

```ts
optimizeContext(CompiledContext, TokenBudget) → ContextPack = {
    items: ContextItem[],   // same shape as above; wasCompressed may now be true
    tokenCount: number,
    truncated: boolean,     // true if anything was omitted OR any item was compressed
    omittedCount: number
  }
```

This stage is the only one whose output ever reaches an agent. It estimates each item's token cost, invokes `core/compression` when an item doesn't fit as-is, and assembles the final `ContextPack` — the only stage that touches token counts at all.

Structural compatibility, not implementation: the `Candidate`/`RankedResult` shapes already accommodate future lexical/semantic/code/episodic retrieval sources and future learning-derived signals as additional optional fields. None of those sources beyond lexical+semantic-over-memories are built in Phase 1 — code retrieval is Phase 3, learning signals are Phase 4.

---

## Token Budgeting

- **Specification:** caller sets `TokenBudget.maxTokens`, passed to `optimizeContext()` alongside a `CompiledContext`.
- **Estimation:** a pluggable `(text: string) => number` function; the Phase 1 default implementation is a deliberately conservative (over-, never under-) character-based heuristic, swappable later for a real per-model tokenizer without changing any caller.
- **Enforcement point:** exactly one — inside `optimizeContext()`. No other layer may claim budget compliance; `core/context` cannot, structurally (its output type has no token fields to be wrong about).
- **Policy when candidates exceed budget:** greedy fill in rank order (highest-ranked first), but an item that doesn't fit is *skipped, not a stopping point* — the algorithm keeps trying subsequent (lower-ranked, possibly smaller) items rather than halting. (Corrected from the original "stop at first miss" wording: that policy lets a single oversized top-ranked item silently zero out an entire context pack even when many smaller, genuinely useful lower-ranked items would easily have fit — the opposite of "optimize quality/cost, not token count alone," `ARCHITECTURE.md §22`.) Still deliberately not knapsack-optimal packing — unjustified complexity for Phase 1, a documented future upgrade only if evidence ever shows it matters.
- **Compression interaction:** if an item doesn't fit at full size but a truncated form would, `core/compression` truncates it (never below a documented minimum floor size — a fragment too small to be useful is worse than omitting the item). Compression is **truncation-only in Phase 1, never LLM-based summarization** — an LLM call here would silently violate `ARCHITECTURE.md` invariant 19 (zero-required-network-calls) for what is supposed to be a core, always-available operation.
- **Single memory too large for the entire budget:** skipped (after a compression attempt fails to bring it under budget, or the remaining budget is below the compression floor), counted in `omittedCount`, and the greedy pass continues to the next item. Never partially included below the truncation floor.
- **Can the returned context ever exceed `maxTokens`?** **No — absolute, hard, and testable.** This is `ARCHITECTURE.md §12`'s stated boundary; Phase 1's job is to make it structurally true, not merely intended.

---

## Learning / Outcome Telemetry (Phase 1 scope: event provenance only)

Per Step 7's explicit instruction: no aggregation, no algorithms — only a reliable, correctly-linked event chain, because both predecessors failed *before* reaching the algorithm stage (their report-back mechanisms were dead or broken, `AEOS_COMPARISON.md §6`).

```
RetrievalEvent  { id, timestamp, scope, queryText, candidateIds[], taskId? }
      |  (retrievalEventId)
      v
ContextEvent    { id, timestamp, retrievalEventId, scope, taskId?, includedMemoryIds[], omittedMemoryIds[], tokenCount }
      |  (taskId, caller-supplied and opaque to the Brain)
      v
OutcomeEvent    { id, timestamp, taskId, sessionId?, outcome: 'success'|'failure'|'partial'|'unknown', signal?: {...}, notes? }

FeedbackEvent   { id, timestamp, memoryId, taskId?, useful: boolean|null, notes? }   -- independent, memory-specific
```

**Design notes:**
- `RetrievalEvent` and `ContextEvent` are distinct records — the missing distinction identified in `ARCHITECTURE.md §17`'s Phase-0 addition. `ContextEvent.includedMemoryIds` is the *subset* of `RetrievalEvent.candidateIds` that survived ranking and budget; only that subset can be correctly credited or blamed for whatever happens next.
- `taskId`/`sessionId` are **caller-supplied, opaque identifiers**, never independently inferred by the Brain. The Brain does not observe what an agent does with a context pack (that is squarely Agent-side per the Brain/Agent boundary) — it only threads an opaque handle through, and trusts the caller to report back via `brain_record_outcome`/`brain_feedback`. This reporting-based shape is *not* the design flaw either predecessor had; the flaw was that the report-back path was unwired or broken. Phase 1's obligation is narrower and stricter: **the write side of `brain_feedback`/`brain_record_outcome` must actually work, be tested, and produce a queryable, correctly-linked record — even though nothing reads that data back into ranking until Phase 4.**
- `EventService.getEventsForTask(taskId)` / `getEventsForMemory(memoryId)` are the only read operations Phase 1 needs — sufficient for Phase 4's aggregation to be built as a pure query over this data, with zero changes to how events are recorded.

---

## Storage Boundary

Interfaces (declared in `core/contracts`, implemented in `packages/storage`):

- **`MemoryRepository`** — `create`, `get`, `update`, `archive`, `query`, `purge` (hard delete; interface-only in Phase 1, not exposed via any `brain_*` operation — `brain_forget` maps to `archive`, not `purge`).
- **`RetrievalStore`** — `lexicalSearch(text, scope, filters)`, `semanticSearch(embedding, scope, filters)`. Both FTS5 and sqlite-vec calls live here; nothing above this interface touches SQL or the vector extension directly. **No separate `VectorStore` interface** — considered and rejected: the embedding *provider* (text → vector) is already a distinct `EmbeddingProvider` interface; a further `VectorStore` split adds a layer `packages/storage` doesn't need internally, and Step 8 of the brief explicitly flagged this as "if actually required" — it is not (D-equivalent minimalism call, consistent with "don't invent unnecessary infrastructure").
- **`EventStore`** — append-only `record*` methods for the five event types *(corrected post-Phase-1 per E24: documentation only, no code behaviour changed)* (§Learning above, plus `recordMutation`) and three read methods (`getEventsForTask`, `getEventsForMemory`, `getMutationsForMemory`).
- **`EmbeddingProvider`** — `embed(text): number[]`. Default implementation: local, in-process (`@huggingface/transformers` *(corrected post-Phase-1 per E24: documentation only, no code behaviour changed)*, `Xenova/all-MiniLM-L6-v2`), per `ARCHITECTURE.md` invariant 19. Swappable for a hosted provider as an explicit opt-in, never a default.

**SQLite vs. filesystem:** everything in Phase 1 — memory records, FTS5 index, vector index, all five event types *(corrected post-Phase-1 per E24: documentation only, no code behaviour changed)* — lives in SQLite (single file, WAL mode). No filesystem artifact store is needed yet; that becomes relevant starting Phase 3 (codebase chunks) and is out of scope here.

**Schema governance:** a single source of truth — versioned, migration-first `.sql` files with a typed loader — fixing AEOS's two-independently-maintained-paths defect (`AUDIT_AEOS.md §9`).

---

## MCP Boundary

Every handler follows the same shape, with zero exceptions: **validate input → resolve request context via the Gateway → call exactly one Core service method → return its result.** No handler contains branching business logic, no handler queries a database, no handler generates an embedding directly.

| Operation | Resolves via Gateway | Calls | Responsibility |
|---|---|---|---|
| `brain_context` | scope, budget, capabilities | `ContextService.compile()` | The full pipeline (retrieval→ranking→context), as one composed Core call — the composition lives in `ContextService`, not in the MCP handler |
| `brain_recall` | scope | `MemoryService.query()` / `.get()` | Direct id/filter lookup, no ranking |
| `brain_search` | scope | `RetrievalService.getCandidates()` + `RankingService.rank()` | Ranked results, no budget enforcement, no context compilation — for an agent that wants to reason over candidates itself. *(Corrected per E24: the shipped MCP `searchShape` exposes `text`/`scope`/`limit` only — **no `filters`** — even though `Gateway.search()` accepts them. This is recorded as a known surface gap; **`brain_search` behaviour is deliberately left unchanged** in Phase 2A. Fixing it is a separate, explicitly-authorized change, not a silent doc-driven edit.)* |
| `brain_remember` | scope, source | `MemoryService.create()` | |
| `brain_update` | scope | `MemoryService.update()` | |
| `brain_forget` | scope | `MemoryService.archive()` | |
| `brain_feedback` | — | `EventService.recordFeedback()` | |
| `brain_record_outcome` | — | `EventService.recordOutcome()` | |
| `brain_status` | none needed | health check (DB reachable, embedding provider reachable) | The one operation that may skip full Gateway resolution |
| `brain_project` | — | `ProjectRegistry.ensure()` / `.get()` | Minimal: ensures/returns a `project` scope's existence and basic metadata — not a project-management system |

**Gateway:** resolves identity/session/scope/budget/permissions **per request, into a request-scoped object passed explicitly down the call chain** — never a module-level or otherwise shared-mutable variable. This directly targets `AUDIT_AEOS_BRAIN.md §20`'s `currentAgentScope` race condition; that class of bug is ruled out by construction, not by discipline.

**Illustrative handler shape** (non-normative — no implementation code is produced by this specification):
```
handler(rawInput):
  input = validate(rawInput)               // schema check only
  ctx   = gateway.resolve(requestMeta)      // request-scoped, never shared
  result = coreService.method(input, ctx)   // exactly one call
  return result
```

### CI Import-Boundary Design

A dependency-graph rule (e.g. dependency-cruiser or equivalent), run in CI, enforcing:
1. `packages/mcp/**` may import only `@modelcontextprotocol/sdk` and the declared public exports of `packages/core/*` — never `better-sqlite3`, `sqlite-vec`, or any `packages/storage` path, except the single named composition-root bootstrap file.
2. `packages/core/**` may never import `packages/mcp` (one-directional — makes "the Brain core works without MCP," `ARCHITECTURE.md` invariant 4, a checked fact).
3. `packages/core/**` may never import `better-sqlite3`/`sqlite-vec`/`packages/storage` internals directly — only the interfaces re-exported from `core/contracts`.
4. `packages/core/ranking` may never import `packages/core/retrieval` (one-directional within core, per §Package Architecture).

A build with any violation of the above **fails**, not warns. This is the mechanism named in D4/`ARCHITECTURE.md` invariant 21; building it is a Phase 2 task (`PHASE_1_TASKS.md`), but the package structure above is drawn now specifically so that task has something correct to enforce.

---

## Security / Isolation

- Every scope-bearing query is enforced at the storage layer, not application code (§Scope Model).
- `domain` is never an authorization input (§Scope Model, `ARCHITECTURE.md §8` addition).
- No credential of any kind is ever returned in a `MemoryRecord`, `ContextPack`, or any MCP response — Phase 1 has no multi-tenant cloud credential to leak (local SQLite only), but the principle (never ship a privileged secret to a less-trusted caller) is stated now because it's exactly what AEOS-brain's visualizer got wrong (`AUDIT_AEOS_BRAIN.md §11`) and Phase 6 will need it.
- `brain_forget` (archive) never physically deletes the audit trail — only `purge` does, and `purge` is not exposed via MCP in Phase 1.

## Error Handling

- Storage/retrieval-layer failures degrade gracefully per AEOS's proven pattern (`AUDIT_AEOS.md §10`): a failed vector search falls back to lexical; a failed lexical search returns an empty candidate set, never throws past `RetrievalService`.
- Validation failures (bad input shape, unknown field under `.strict()`) **do** throw, loudly, at the MCP boundary — the opposite of AEOS-brain's `log_usage` handler, which caught its own broken database call and treated it as non-fatal (`AUDIT_AEOS_BRAIN.md §13`). Infrastructure failures that silently degrade a *result* are acceptable (better a smaller context than a crashed agent); infrastructure failures that silently discard a *write* or a *reported outcome* are not, and must surface as errors.
- Budget-impossible requests (§Token Budgeting) fail predictably with a clear reason, never by silently exceeding budget.

## Testing Strategy

Mandatory Phase 1 test gates (per-package detail already listed under §Package Architecture; consolidated view):

| Area | Test |
|---|---|
| Memory creation | 12-type round-trip; `.strict()` rejects unrecognized fields |
| Memory retrieval | `MemoryQuery` filter correctness; scope-bound by construction |
| Scope isolation | A query under scope A never returns scope B's records, proven at the storage layer, not application code |
| Lexical retrieval | FTS5 fixture correctness |
| Ranking | Pure fixture tests, fixed input → expected order/scores |
| Deduplication | Duplicate candidates merged in `core/context` |
| Context compilation | Provenance (`memoryId`) present on every `ContextPack` item |
| Token-budget enforcement | **Property test: for any candidate set and any `maxTokens`, `ContextPack.tokenCount` never exceeds `maxTokens`** |
| Provenance | Every mutation → exactly one audit-log row; every `ContextEvent` correctly references its `RetrievalEvent` |
| Outcome recording | `brain_record_outcome` write path is real and tested end to end |
| Feedback association | `brain_feedback` write path is real and tested end to end, correctly linked to `memoryId` |
| MCP/core boundary | CI import-boundary check passes; concurrency test — overlapping requests under different scopes never cross-contaminate (directly targeting `AUDIT_AEOS_BRAIN.md §20`'s bug class) |
| Storage consistency | Migration-from-empty test; schema is the single source of truth (no drift-repair function needed because there is only one schema path, unlike `AUDIT_AEOS.md §9`) |
| Failure/degradation paths | Vector index down → lexical fallback; embedding provider down → clear error, not silent wrong data |

`ARCHITECTURE.md` invariant 20 (added this phase): core packages are not considered complete without this coverage, including the degradation paths specifically — both predecessors' worst bugs lived exactly in untested degradation/failure branches.

---

## Acceptance Criteria (Phase 1 as a whole)

1. A memory of each of the 12 types can be created, retrieved, updated (within the allowed field set), and archived, with full audit provenance.
2. A query under one scope never returns another scope's data, verified by test, not by inspection.
3. `brain_context` returns a `ContextPack` that never exceeds its requested `maxTokens`, across a fixture set including adversarial (impossible-budget, single-huge-item) cases.
4. `brain_feedback` and `brain_record_outcome` are real, callable, tested, and produce correctly-linked event records — even though nothing yet reads them back into ranking.
5. The CI import-boundary check exists and fails the build on a deliberately-introduced violation (tested by inverting the rule once, confirming it catches the planted violation, then reverting).
6. Zero external network calls occur in the default configuration, across the full test suite.
7. All Testing Strategy gates above pass.

## Explicitly Deferred Work

Everything under Non-Goals above, plus: performance/exploration/diversity ranking signals (interface reserved, D7), promotion/demotion automation, scheduled evaluation, aggregation of events into usefulness scores, `user`/`organization`/`repository`/`workspace`/`agent` scopes, hosted embedding/LLM provider implementations, any dashboard, any SDK/CLI adapter, passive capture tooling (D6).
