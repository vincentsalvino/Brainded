# Phase 3.1 Readiness

## Pre-flight summary

Inspected `BUILD_PLAN.md`, `BLUEPRINT.md`, `ARCHITECTURE.md` §18/§19, `ARCHITECTURE_REVIEW.md`, `DECISIONS.md` (D3 local-first, D7 diversity.ts precedent for "investigate before adopting", D8 phase-5/6 scoping-depth discipline), and the shipped `packages/storage`, `packages/core/contracts`, `packages/core/retrieval`, `packages/gateway`, `packages/mcp` trees.

## Architectural conflicts found

None. `packages/codebase` as a top-level package, depending only on `@brain/contracts` (+ `ignore`), matches the existing `@brain/gateway`/`@brain/retrieval` dependency shape exactly (business-logic package -> contracts only, never storage directly). `@brain/storage` implements the new `CodebaseRepository`, matching its existing role for `MemoryRepository`/`RetrievalStore`/`EventStore`. No existing contract, table, or package name collides once `RepositoryRecord` was renamed to `CodebaseRecord` (see `PHASE_3_SPEC.md` Part A) to avoid ambiguity with the codebase's established "`*Repository` = storage-access interface" convention.

## Reused vs. new

Reused as-is: `ScopeRef`/`scopeIncludes`/`projectScope()`, the Fake-in-test-fixtures/Sqlite-in-storage split, `better-sqlite3` transaction + scope-in-WHERE-clause discipline, the migration-ledger mechanism (a new `.sql` file is sufficient — no `db.ts` change needed), Node 24's native recursive `readdir` (already used in `packages/knowledge`). New: deterministic path-derived ids for files/chunks (required by the "repository can move between machines" and "identical content -> identical identity" invariants, which nothing existing already provides); the `ignore` npm dependency (new, small, single-purpose, justified in `PHASE_3_SPEC.md`).

## Blocking risks

None identified that would stop implementation. Two non-blocking, disclosed simplifications: (1) 0 chunk overlap by default — deferred tuning, not a correctness gap; (2) file-level (not whole-repository) transactional atomicity — deliberate, documented in `PHASE_3_SPEC.md`.

## Verdict

READY_FOR_PHASE_3_1_IMPLEMENTATION

## Post-implementation confirmation

Implemented as specified. `npm run typecheck && npm run build && npm test` all clean across every workspace (465/465 tests, up from the 395 baseline by exactly the 70 new tests added: +6 contracts, +11 storage, +3 test-fixtures, +50 `@brain/codebase`). `npm audit`: 0 vulnerabilities. `packages/storage` and `packages/evaluation` `test:integration`: 3/3 and 2/2, values unchanged from the pre-existing baseline. `packages/codebase` `test:integration` (self-index against this repository, read-only): 211 files discovered/indexed, 299 chunks, 0 skipped, a second pass reports all 211 unchanged with 0 chunks recreated. `git status` confirms no file outside `packages/codebase/`, `packages/core/contracts`, `packages/storage`, `packages/core/test-fixtures`, `docs/PHASE_3_*.md`, and the two root `package.json`/`package-lock.json` edits changed — `packages/mcp` and `packages/gateway` untouched, redundancy policy untouched.

---

# Phase 3.2 Readiness

## Pre-flight summary

Read `docs/PHASE_3_SPEC.md` (3.1's Part A, then wrote 3.2's own Part B), `docs/PHASE_3_TASKS.md`, `docs/PHASE_3_READINESS.md` (this file, 3.1 section above), `docs/BUILD_PLAN.md`, `docs/ARCHITECTURE.md` §18/§29, `docs/DECISIONS.md`. Then inspected the actual shipped code directly rather than assuming: `packages/core/contracts/src/{retrieval.ts, memory.ts, repositories.ts, scope.ts, signals.ts, codebase.ts}`, `packages/core/retrieval/src/{service.ts, merge.ts, lexical-containment.ts}`, `packages/core/ranking/src/{rank.ts, score.ts}`, `packages/storage/src/{db.ts, retrieval-store.ts, memory-repository.ts, codebase-repository.ts, local-embedding-provider.ts}`, `packages/storage/migrations/{0001,0002,0003}*.sql`, `packages/codebase/src/{indexer.ts, index.ts}`, `packages/evaluation/src/{metrics.ts, evaluate.ts, types.ts, efficiency.ts}`, `packages/core/test-fixtures/src/*`.

## Candidate ownership: CASE B

Confirmed by reading the schemas, not assumed. `Candidate.memoryId` is `z.string().uuid()` (chunk ids are sha256 hex — fails validation); `Candidate.record` is a full `.strict()` `MemoryRecordSchema` with a closed 12-value `type` enum that has no "code" member, plus `confidence`/`source`/`status`/`domain` a code chunk has no honest value for. `CandidateSignalsSchema` is the one generic part — reused unmodified as `CodeSearchResult.signals`. Full reasoning in `PHASE_3_SPEC.md` Part B.

## Architectural conflicts found

None. New contracts (`code-search.ts`, `CodeSearchStore`) sit beside, not inside, `Candidate`/`RetrievalStore` — no existing type was moved, renamed, or overloaded. `SqliteCodeSearchStore` (new file) implements `CodeSearchStore` the same way `SqliteRetrievalStore` implements `RetrievalStore`; no shared base class was forced between them. `syncEmbeddings` needed a decision (fold into `@brain/codebase`'s indexer, or keep separate) — resolved as separate (own method on `SqliteCodeSearchStore`, invoked as an explicit second step after `indexRepository`), because embedding sync needs direct SQL and only `@brain/storage` may hold that; `CodebaseRepository`'s already-shipped 3.1 interface is untouched. `@brain/evaluation` gained a new devDependency on `@brain/codebase` (for the self-repository integration test) — allowed because evaluation is the established cross-package measurement package (already depended on `@brain/storage`/`@brain/retrieval`/`@brain/ranking`/`@brain/context`/`@brain/token`) and nothing depends on evaluation, so this adds no cycle.

## Reused vs. new

Reused as-is: `normalizeScores` (identical function, both bm25 and distance orientation), `scopeIncludes`/`ScopeRef`, the bm25/distance negate-before-normalize pattern from `SqliteRetrievalStore`, the Fake-in-test-fixtures/Sqlite-in-storage split and its shared conformance-suite pattern, `mergeCandidates`' identity-merge semantics (copied to `chunkId`), `RetrievalService.getCandidates`' Promise.allSettled degradation shape, `computeScore`/`DEFAULT_RANKING_WEIGHTS` (unmodified, proof test only), `precisionAtK`/`recallAtK`/`ndcgAtK`/`reciprocalRank`/`mean` (unmodified — these take only `(ranked, labels)`, no `MemoryRecord` coupling, so no adapter was needed), the migration-ledger mechanism, `SqliteMemoryRepository.indexVector`'s select-then-branch vec0 upsert pattern (vec0 has no `ON CONFLICT`). New: `CodeSearchQuery`/`CodeSearchResult`/`CodeSyncResult`/`CodeSearchStore` (Case B), the `code_embedding_state` tracking table (no existing mechanism answers "what was last embedded with what hash" for a non-memory content type), a code-specific eval fixture (`code-retrieval.data.ts`, since `EvalExample` is memory-shaped). Zero new npm dependencies.

## Blocking risks

None identified that stopped implementation. Two disclosed, non-blocking findings from the self-repository demonstration (see below): (1) two of five practical queries' top lexical hit was this phase's own new test file, because its source contains near-verbatim phrasings of the query list itself — a self-referential artifact of indexing the repository while its own evaluation harness lives inside it, not a retrieval defect; (2) sequential (non-batched) embedding of ~319 real chunks took ~54s cold — acceptable at this repository's current scale (`EXPECTED SCALE` explicitly rules out building batching infrastructure for it), flagged as a scaling limit if repositories grow much larger.

## Verdict

READY_FOR_PHASE_3_2_IMPLEMENTATION

## Post-implementation confirmation

See the Final Report for full detail (test counts, self-repository results, performance baseline). Summary: `npm run typecheck && npm run build && npm test` clean across every workspace; `npm audit` 0 vulnerabilities; `packages/storage` and `packages/evaluation` `test:integration` green, including two new real-`LocalEmbeddingProvider` tests; self-repository demonstration indexed 319 chunks, cold-synced all 319 embeddings in ~54s, unchanged re-sync embedded 0 in 4ms; `git status`/`git diff --stat` confirm `packages/mcp`, `packages/gateway`, and `packages/codebase`'s indexing code are untouched, redundancy policy untouched.

---

# Phase 3.3 Readiness

## Pre-flight summary

Read `docs/BUILD_PLAN.md`, `docs/ARCHITECTURE.md`, `docs/DECISIONS.md`, `docs/PHASE_3_SPEC.md` (3.1 Part A, 3.2 Part B), `docs/PHASE_3_TASKS.md`, this file's 3.1/3.2 sections. Then inspected shipped code directly: `packages/core/contracts/src/{codebase.ts, code-search.ts, repositories.ts}`, `packages/storage/src/{codebase-repository.ts, code-search-store.ts, db.ts}`, `packages/storage/migrations/{0003,0004}*.sql`, `packages/codebase/src/{indexer.ts, hash.ts, discovery.ts, classify.ts, index.ts}`. Also read `references/AEOS/services/dependency-graph/extractor.py` (the Build-Plan-cited regex-extraction precedent) directly before designing the extractor, per the Migration Principle (audit before reusing a shape).

## Ownership decision

Matches the mission's own diagram (contracts -> storage -> codebase, `@brain/codebase` never depending on `@brain/storage`) without modification. The one real pre-flight question — how extraction gets a file's source text, since `CodeFileRecord` carries no `content` field — resolved as: re-read from disk via `rootPath` + `relativePath`, the same mechanism `CodebaseIndexer` itself already uses (rejected reconstructing content from `code_chunks`, which is only safe when chunking used zero overlap — today's default, not a `ChunkPolicy` guarantee). Full reasoning: `PHASE_3_SPEC.md` Part C.

## Architectural conflicts found

None. `CodeDependencyStore` sits beside `CodebaseRepository`/`CodeSearchStore`, not inside either. No SQL entered `@brain/codebase` (verified by a new structural guard test, mirroring the package's existing zero-network guard). `@brain/evaluation`'s existing `@brain/codebase` devDependency (added in 3.2) was reused as-is, no new package edges required for the dependency work itself.

## Reused vs. new

Reused as-is: the deterministic-hash id convention (`deriveEdgeId` alongside `deriveFileId`/`deriveChunkId`), the Fake-in-test-fixtures/Sqlite-in-storage conformance-suite pattern (now covering three stores, not two), the two-explicit-step sync pattern (`indexRepository` then a separate sync call — `syncDependencies` mirrors 3.2's `syncEmbeddings` exactly), per-file failure isolation, `CodebaseIndexer`'s tmp-dir real-fixture-repo test style. New: the mask-then-regex extraction strategy (comment/string awareness AEOS's own extractor never had); the two-phase parse/re-resolve synchronization split (nothing existing needed this — 3.2's sync is single-phase because embedding invalidation has no analogous "the target moved" case); reverse-BFS graph traversal with pre-visited-origin cycle safety.

## Blocking risks

None that stopped implementation. One real, disclosed **defect found and fixed during this phase** (not merely a risk carried forward): `resolveSpecifier` initially failed to resolve any of this repository's own relative imports, because every one of them uses an explicit `.js` extension referencing a `.ts` source file (standard TS/ESM convention) and the original candidate list only ever *appended* extensions rather than *swapping* a recognized one first. Caught by the self-repository integration run (0 internal edges out of 640 was an unmissable signal), fixed with a test-first red/green cycle, verified against both the unit suite and a second self-repository run (218/247 relative imports now resolve correctly). Documented in `PHASE_3_TASKS.md` step 8 rather than quietly folded into the diff.

Two disclosed, non-blocking limitations, consistent with `PHASE_3_SPEC.md`'s Known Unsupported Syntax: workspace-package specifiers (`@brain/contracts` etc.) classify as `external`, identically to a true npm package — this means the self-repository demo's `dependenciesOf`/`dependentsOf`/`impactOf` results are necessarily scoped to *within-package* relative-import structure only, not cross-package `@brain/*` relationships. A string literal whose contents happen to spell out valid import syntax verbatim is not distinguished from real code (out of scope; would need real tokenization).

## Verdict

READY_FOR_PHASE_3_3_IMPLEMENTATION

## Post-implementation confirmation

`npm run typecheck && npm run build && npm test` clean across every workspace: 638/638 (up from the 533-test Phase-3.2 baseline; all growth confined to `@brain/contracts`, `@brain/storage`, `@brain/codebase`, `@brain/core/test-fixtures`, `@brain/evaluation` — every untouched package's count is byte-identical to its Phase-3.2 value). `npm audit`: 0 vulnerabilities. `packages/storage` `test:integration`: 4/4 (unchanged from 3.2). `packages/codebase` `test:integration`: 1/1 (self-index, now 246 files/340 chunks as the repository has grown). `packages/evaluation` `test:integration`: the two pre-existing redundancy tests plus two new dependency/code self-repository tests, all green. Self-repository dependency demonstration: 149 eligible files, 640 total edges (218 internal / 393 external / 29 unresolved), cold sync ~0.9-1.2s, warm sync ~6-10ms. `git diff --stat` confirms `packages/mcp` and `packages/gateway` remain fully untouched by this phase; redundancy/learning code paths untouched.

---

## Phase 3.3 — Independent Re-Verification (2026-09-01)

Re-run from a fresh session, independent of the implementation session recorded above — every command below was executed directly this session, not assumed from this document.

- **Typecheck:** `npm run typecheck` clean, 0 errors, all 19 workspaces.
- **Default test suite:** `npm test` — 638/638 passing, 0 failures (`@brain/codebase` 116, `@brain/evaluation` 70, `@brain/gateway` 33, `@brain/knowledge` 9, `@brain/mcp` 20, `@brain/storage` 110, `@brain/compression` 7, `@brain/context` 29, `@brain/contracts` 77, `@brain/learning` 2, `@brain/memory` 1, `@brain/ranking` 25, `@brain/retrieval` 63, `@brain/test-fixtures` 50, `@brain/token` 26).
- **`npm audit`:** 0 vulnerabilities.
- **Integration tiers:** `packages/storage` 4/4, `packages/codebase` 1/1 (self-index: 246 files, 340 chunks), `packages/evaluation` 4/4 (redundancy benchmark/boundary + code-self-repository + dependency-self-repository).
- **Fixture evaluation** (frozen, hand-labeled, 9 ground-truth edges / 7 internal): precision 1.000, recall 1.000, resolution accuracy 1.000 (9/9). Cycle demo `impactOf(src/cyclic-a.ts)` = `src/cyclic-b.ts@1`, origin correctly excluded.
- **Self-repository dependency graph** (this repository, current size): 150 eligible files, 647 total edges (221 internal / 397 external / 29 unresolved), cold sync 423ms, warm sync 9ms. Slightly higher than this section's 149/640/218/393/29 snapshot above — expected organic growth (more docs/tests accumulated later in the original session), not drift or regression; both were measured the same way.
- **`git diff --stat` against the last commit:** touches only `packages/gateway/src/gateway.ts` + `.test.ts` (a doc-comment-only edit updating a 2C.7→2C.10 comment describing `RedundancyConfig`'s shape, zero functional change — confirmed by reading the diff directly, not inferred) — `packages/mcp` does not appear in the diff at all. Gateway/MCP business logic is untouched by Phase 3.3.
- **Known minor nit (non-blocking):** `dependency-graph.data.ts`'s header comment claims fixture coverage of "dynamic import"; the current 9-edge fixture contains no `require(...)`/`import(...)` literal (dynamic-import/require extraction is instead covered by dedicated, passing unit tests in `dependency-extract.test.ts`). Documentation wording mismatch only, no functional gap.

### Phase 3.3 Completion Verdict

All 19 acceptance criteria in the Phase 3.3 mission brief were checked against running code and real command output, not against this document's own prior claims. No blocking defect found. Gateway/MCP/context untouched. Redundancy stays disabled by default (`enabled: false`). Zero required network calls preserved (structural guard tests pass in `@brain/codebase`, `@brain/retrieval`, `@brain/token`). All Phase 3.1/3.2/3.3 work remains **uncommitted** in the working tree as of this verification — a repository-management question for the user, not a code-readiness gap.

READY_FOR_PHASE_3_4
