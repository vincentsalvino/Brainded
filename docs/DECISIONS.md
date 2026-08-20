# Phase 0 → Phase 1 Decisions

The eight open decisions from `IMPLEMENTATION_READINESS.md §12`, resolved or explicitly deferred. Three of the eight (D4, D5, and partially D3) arrive pre-resolved by explicit directive in the Phase 1 task brief — noted honestly below rather than presented as independent derivation.

| ID | Decision | Recommendation | Consequence | Blocks Phase 1? | Status |
|----|----------|----------------|-------------|------------------|--------|
| D1 | Whether to proceed past the Phase 0 stop condition | Proceed with **specification**, not implementation | Unblocks all of Phase 1 planning; implementation remains gated behind a further approval | Precondition for everything below | **RESOLVED** — this task's brief is the approval, scoped to specification only |
| D2 | Single-table-with-type-discriminator vs. per-type tables for the memory schema | Single table (`memories`, `type` discriminator column) | Determines `MemoryRecord`'s physical shape and every repository method's signature | Yes — blocks Step 4 (memory contract) and Phase 1.1 | **RESOLVED** — adopted |
| D3 | Add a "zero required external network calls by default" invariant to `ARCHITECTURE.md`? | Yes, add it | Makes local embedding generation non-optional for the reference implementation; hosted providers become explicitly opt-in | Affects `ARCHITECTURE.md`'s edit scope; does not block starting Phase 1 code (local embeddings were already the plan) | **RESOLVED** — adopted, see `ARCHITECTURE.md` update |
| D4 | Build CI/import-boundary enforcement for the MCP↔Core boundary? How strict? | Yes; mechanical (dependency-graph) check, not lint-only | Package dependency rules must be drawn correctly from the start of Phase 1, even though the CI tooling itself is a Phase 2 deliverable | Yes — shapes package boundaries for all of Phase 1 | **RESOLVED by directive** (Phase 0 finding #6 in this task's brief) — matches this audit's own §2.1 recommendation exactly; adopted |
| D5 | Minimal Phase 1 scope-hierarchy subset | `global` / `project` / `session` | Determines `ScopeRef`'s shape | Yes — blocks Step 3/4 and Phase 1.1/1.2 | **RESOLVED by directive** (Step 3 of this task's brief) — matches this audit's own `ARCHITECTURE_REVIEW.md §4.1` recommendation exactly; adopted |
| D6 | Whether passive capture/harvest tooling (AEOS-brain's browser extension + file watcher pattern) is wanted, even deferred | Out of scope entirely | None for Phase 1 — no component touches this | No | **DEFERRED** — no new evidence since Phase 0; unresolved product question, not a technical one |
| D7 | `diversity.ts` and `services/abstraction-validator` — port, rewrite, or drop | Insufficient evidence to decide beyond "leave room, don't build" | Ranking signal interface reserves an optional diversity slot (unused in Phase 1); no promotion-quality-gate built yet | No — Phase 4 concern | **DEFERRED** — smallest safe behavior defined in Step 5/Step 10 below |
| D8 | How much detail to scope Phase 5/Advanced-Efficiency and Phase 6/Ecosystem now | Leave light, as `BUILD_PLAN.md` already does | None for Phase 1 | No | **DEFERRED** — re-scope only once Phase 4 produces real usage data, per this audit's own `ARCHITECTURE_REVIEW.md §4.2` reasoning |

---

## D1 — Proceed past the stop condition

**Decision:** Whether to move from specification-only to actively producing a Phase 1 specification.
**Audit recommendation:** `IMPLEMENTATION_READINESS.md` treated this as the master gating decision, deliberately not self-granted.
**Architectural consequence:** None by itself — specification work doesn't change the target architecture.
**Implementation consequence:** None yet — this task remains specification-only per its own stated stop condition (no TypeScript, no migrations, no MCP server code).
**Resolution:** Proceed with Steps 1–15 as specified. Implementation of actual Brain code remains gated behind a *further* explicit approval after `PHASE_1_READINESS.md` is reviewed.

## D2 — Memory schema shape

**Decision:** Physical schema for `MemoryRecord` storage — one table with a `type` discriminator, or twelve (or fewer, grouped) per-type tables.
**Audit recommendation:** `MERGE_MATRIX.md`'s `memories` unified table entry and `ARCHITECTURE_REVIEW.md §11` both point to AEOS-brain's validated unification principle (one memory surface, differentiated by field, not physically separate subsystems) as the pattern to carry forward — this is the clearest strong recommendation among the open decisions.
**Architectural consequence:** A single table keeps retrieval/ranking/context-compilation logic type-agnostic (they operate on `MemoryRecord` regardless of `type`); per-type tables would require type-specific query fan-out at every layer, which neither predecessor's evidence supports needing.
**Implementation consequence:** One `memories` table, one `MemoryRepository`, one FTS5 shadow table, one `vec0` table. Type-specific fields (e.g., a `pattern`'s `code_block`, a `constraint`'s severity) live as optional/nullable columns or a JSON `metadata` blob rather than separate tables — see the full field list in `PHASE_1_SPEC.md`.
**Resolution:** **RESOLVED — adopted.** Single table with a `type` discriminator.

## D3 — Local/offline default-operation invariant

**Decision:** Whether to formally add "the Brain's default configuration performs basic operations with zero required external network calls" to `ARCHITECTURE.md`.
**Audit recommendation:** `ARCHITECTURE_REVIEW.md §3.2` proposed this exact wording, grounded in AEOS-brain's worst architectural regression (a hard OpenAI/OpenRouter dependency for every embedding and every distillation, `AUDIT_AEOS_BRAIN.md §19`) versus AEOS's proof that a fully local default is achievable (`@xenova/transformers`, `AUDIT_AEOS.md §13`).
**Architectural consequence:** Elevates "avoid coupling to one embedding provider" (already stated) from a soft avoidance goal to a positive, testable requirement.
**Implementation consequence:** The default `EmbeddingProvider` implementation in Phase 1.1 must be the local transformer model; any hosted-provider implementation is additive/optional, never required for `packages/core` tests to pass.
**Resolution:** **RESOLVED — adopted.** See the `ARCHITECTURE.md` invariant addition.

## D4 — MCP/Core CI enforcement mechanism

**Decision:** Whether — and how strictly — to mechanically enforce the MCP-thinness boundary, rather than relying on code review.
**Audit recommendation:** `ARCHITECTURE_REVIEW.md §2.1` recommended a dependency-graph import-boundary check specifically because both predecessors stated the same principle and both drifted from it under real feature growth without any mechanical check.
**Architectural consequence:** The boundary becomes a build-time-verifiable property, not just documentation. This also implies the same mechanism should cover `packages/core` ↔ `packages/storage` (core must not import `better-sqlite3`/`sqlite-vec` directly either) — the risk pattern (stated principle, no enforcement, eventual drift) applies equally to that boundary and neither predecessor got that one right either.
**Implementation consequence:** Package boundaries in Step 10/`PHASE_1_SPEC.md` are drawn as a strict DAG from the start, with a single narrow "composition root" file identified as the only place allowed to import both a core service and a concrete storage implementation. The actual CI tooling (a dependency-cruiser-style config) is a Phase 2 task (`PHASE_1_TASKS.md`), but the package structure it will check is fixed now.
**Resolution:** **RESOLVED by directive** — Phase 0 finding #6 in this task's brief states this must happen; it independently matches this audit's own prior recommendation. Adopted at full strictness (mechanical, build-failing, not warning-only).

## D5 — Minimal scope-hierarchy subset

**Decision:** Which of the eight blueprint scope levels to implement in Phase 1.
**Audit recommendation:** `ARCHITECTURE_REVIEW.md §4.1` recommended `global`/`project`/`session` as sufficient to cover everything either reference project actually exercised, with the rest documented-but-deferred — and separately flagged that AEOS-brain's flat "scope" tag is actually a *content-domain* tag, not an access-isolation scope, and that conflation must not recur.
**Architectural consequence:** `ScopeRef` is a small closed enum for Phase 1 (`kind: 'global' | 'project' | 'session'`, `id: string | null`), extensible later without a breaking change (new `kind` values, not a new shape). A separate, unrelated `domain` field carries content-category information and is explicitly documented as **never** usable for authorization decisions.
**Implementation consequence:** Every `MemoryRepository`/`RetrievalStore` query takes a `ScopeRef` and enforces it at the storage layer (not just as an application-code filter — this is the exact failure AEOS-brain shipped with its unconditional-public-read RLS policies, `AUDIT_AEOS_BRAIN.md §11`).
**Resolution:** **RESOLVED by directive** — Step 3 of this task's brief states this exactly; independently matches this audit's own prior recommendation. Adopted.

## D6 — Passive capture/harvest tooling

**Decision:** Whether AEOS-brain's browser-extension/file-watcher capture pattern should be built, deferred-but-planned, or ruled out.
**Audit recommendation:** `ARCHITECTURE_REVIEW.md §3.1` recommended treating capture agents as ordinary adapter-side `brain_remember` callers (no new Brain-internal abstraction needed) but explicitly recommended *against* building this in Phase 1 given unaddressed consent/privacy/security weight and a live bug already observed in AEOS-brain's own watcher (recursive watching of protected OS folders, `AUDIT_AEOS_BRAIN.md §20`).
**Architectural consequence:** None — no Brain-core change is implied either way.
**Implementation consequence:** None for Phase 1 — no task in `PHASE_1_TASKS.md` touches capture/harvest.
**Resolution:** **DEFERRED.** Not addressed in this task's brief, and no new evidence has arrived since Phase 0. This remains a product decision for a human, not something this audit should resolve by default. Smallest safe Phase 1 behavior: build nothing; any external tool wanting to feed captured content into the Brain already can, via `brain_remember`, with no special-casing required.

## D7 — `diversity.ts` and `services/abstraction-validator`

**Decision:** Whether to port, rewrite, or drop these two AEOS components, both marked `INVESTIGATE` in `MERGE_MATRIX.md` because the audit didn't establish enough detail (whether `diversity.ts` is even wired into AEOS's live retrieval path; how load-bearing `abstraction-validator` is to a promotion pipeline that doesn't exist yet in the new Brain).
**Audit recommendation:** Read both directly before committing either way — explicitly not a Phase 1 blocker.
**Architectural consequence:** The Phase 1 ranking-signal contract (`PHASE_1_SPEC.md` Retrieval/Ranking Pipeline) reserves an optional, unused `diversity` signal slot so a future decision here doesn't require a contract change — structural compatibility without implementation, per Step 5's own instruction not to build future features just because an interface could support them.
**Implementation consequence:** No `abstraction-validator`-equivalent quality gate exists before Phase 4's promotion pipeline is designed.
**Resolution:** **DEFERRED.** Smallest safe Phase 1 behavior: reserve the interface slot (diversity signal field, present but always `null`/unused), build nothing else. Revisit both directly when Phase 1.3 (ranking) and Phase 4 (promotion) are actually implemented.

## D8 — Phase 5/6 scoping depth

**Decision:** Whether to flesh out Advanced Efficiency and Ecosystem phases in more detail now.
**Audit recommendation:** `ARCHITECTURE_REVIEW.md §4.2` argued against over-specifying phases the evidence doesn't yet support designing — Phase 5 in particular needs real Phase 4 usage data to design against.
**Architectural consequence / implementation consequence:** None for Phase 1 either way.
**Resolution:** **DEFERRED**, unchanged from `BUILD_PLAN.md`. Not addressed in this task's brief, no new evidence to act on.
