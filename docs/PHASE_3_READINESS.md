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

---

# Phase 3.4 Readiness

## Pre-flight summary

`PHASE_3_SPEC.md` Part D records the pre-implementation investigation: `BUILD_PLAN.md`, `ARCHITECTURE.md` §5/§6/§11/§12/§17, `ARCHITECTURE_REVIEW.md` (the MCP-thinness boundary discussion), `DECISIONS.md`, and this document's 3.1-3.3 sections, followed by direct inspection of shipped code (`context.ts`, `retrieval.ts`, `events.ts`, `code-search.ts`, `code-dependency.ts`, `signals.ts`, `gateway.ts`, `types.ts`, `schemas.ts`, `server.ts`, `bootstrap.ts`, `boundaries.test.ts`, `compiler.ts`, `optimize.ts`, `rank.ts`, `score.ts`, `service.ts`, `dependency-graph.ts`, `db.ts`, `event-store.ts`, `codebase-repository.ts`, `code-search-store.ts`, and every relevant `package.json`). Three findings changed the design from what the mission anticipated as open questions, all recorded in Part D: (1) `ContextPack`/`ContextItem` are `.strict()` zod, but nothing calls `.parse()` on the outbound side of `Gateway.getContext` — so additive `ContextDelivery` fields carry no `.strict()`-rejects-unknown-keys risk; (2) code search is already scope-native (`SqliteCodeSearchStore.scopeWhere()`), so no new "which repositories belong to this project" lookup method was needed; (3) a `CodingContextService` owned by `@brain/codebase` would require `@brain/codebase -> @brain/retrieval`, DAG-incompatible with the mission's own invariant 6 — resolved as Gateway orchestrating over abstract services already exported by `@brain/retrieval` and `@brain/codebase` instead.

## Architectural conflicts found

None, confirmed both at pre-flight (Part D: "No architectural conflict found beyond what's resolved above") and independently re-confirmed here against the merged diff. `packages/core/context`/`packages/core/token` gained new selection/budget code but no new package dependency — both files only import types from `@brain/contracts`, which they already depended on (`git diff --stat` across the full Task-1-through-12 range shows zero lines changed in `packages/core/ranking` or `packages/core/retrieval` — the "Memory Source unchanged" and "Code Source reuses `computeScore` unmodified" claims hold by omission, not just by inspection). `@brain/gateway` gained exactly one new production dependency (`@brain/codebase`) and `@brain/mcp` gained the same, both verified directly in `package.json`; `@brain/evaluation` gained `@brain/gateway`/`@brain/memory`/`@brain/learning` as devDependencies to construct a real `Gateway` for Tasks 10-12, matching the established "evaluation is the cross-package measurement package, nothing depends on it, so this adds no cycle" precedent from 3.2. Zero new external npm dependencies anywhere in this phase — every new edge is an internal `@brain/*` workspace link.

## Reused vs. new

Reused as-is: `computeScore`/`DEFAULT_RANKING_WEIGHTS` (Task 8's code-item scoring, byte-unmodified — proven by the zero-diff to `packages/core/ranking`), the Fake-in-test-fixtures/Sqlite-in-storage/`EventService`-delegates-to-store pattern (Task 3's two new `EventStore` methods), the migration-ledger mechanism (0006 is a new `.sql` file only — `db.ts` needed zero changes, only `db.test.ts`'s two hardcoded assertions), the optional-constructor-parameter graceful degradation shape `RetrievalService` already established for semantic-search failure (Task 8's `codeRetrieval`/`dependencyGraph` params), the plain-interface-not-`.strict()`-schema convention for internal/output shapes (`IndexResult`/`CodeSyncResult`/`DependencySyncResult` before them, now `CodeContextItem`/`DependencyContextItem`). New: `selectSources`' two-tier heterogeneous algorithm with its starvation safety net (`packages/core/context/src/source-selection.ts` — genuinely new, no prior cross-type budget-competition precedent existed anywhere in this codebase); `fillBudget` as a standalone generic core (`packages/core/token/src/fill.ts`, extracted rather than duplicated — `optimize.ts` shrank from a self-contained algorithm to a two-line wrapper); `context_event_sources`' FK-cascade-on-delete design, a deliberate departure from 3.2/3.3's intentionally-FK-less `code_embedding_state`/`code_dependency_state` (no later sync ever needs to detect an orphaned source row here, so cascading is correct rather than a hazard); the empirical score-calibration methodology itself (Task 11 — measure real distributions before choosing an interleaving strategy, rather than assume).

## Blocking risks

None that stopped implementation or block this verdict, but two are worth naming plainly rather than only in `PHASE_3_TASKS.md`'s task-by-task account:

1. **Task 8's rank-collision bug — the most significant defect this plan produced, caught and fixed, not swept away.** The plan's own reference unwrap loop dropped `rank` on every delivered item, colliding ranks across memory/code/dependency and corrupting the pre-existing `context_event_memories.rank` telemetry for any mixed-source delivery — a regression of already-shipped behavior, not just a new-feature bug. It was caught by task review before merge (empirically: two items literally sharing `rank: 1`), root-caused to one shared cause, fixed with a three-line change (`rank: w.rank` in all three unwrap pushes), and closed with a dedicated regression test asserting non-colliding ranks in both the response and both telemetry tables. Re-verified directly in `gateway.ts` as part of this readiness check: the fix is present, and `gateway.test.ts`'s 43 tests (including the new regression test) are part of the 682 passing today.
2. **A recurring authorship gap, not a code defect: 3 of this plan's 8 fix commits were the same root cause** — a new cross-package import landing without its matching `package.json` manifest entry (masked locally by npm workspace hoisting). All 3 were caught before their task was signed off (one during plan review itself, before Task 1 began; Task 9's `mcp/package.json`; Task 10's `evaluation/package.json`). Disclosed here as a process finding about how this plan's code blocks were authored, worth watching for in Phase 4 planning, not as a residual defect in what shipped.

Two further findings, disclosed and already characterized rather than left as open questions: Task 11's memory-vs-code score-distribution skew (right-skewed vs. left-skewed, both bounded to the same [0,1] scale) is a real calibration imperfection in raw-score interleaving, but its blast radius is already bounded by Task 6's starvation safety net, which shipped before the skew was even measured — this is confirmed-mitigated, not open. Task 12's real pilot found the "scope isolation" task's code recall was the weakest of the 5 real tasks (the actual `scopeWhere()` implementation did not surface in top results) — a genuine, disclosed retrieval-quality limitation on one query shape, not a correctness defect, and not blocking (`codeItems` was still populated with relevant-if-imperfect results, exactly the "no padding, real degradation, not a crash" contract Failure Degradation requires).

## Verdict

READY_FOR_PHASE_3_4_IMPLEMENTATION

## Post-implementation confirmation

Re-run fresh this session, independent of every Task 1-12 implementation session, from the actual current working tree (`git status` confirms no Phase-3.4-relevant file outside the expected scope changed since; the only untracked files are pre-existing Phase-2C report `.md` files this task does not touch):

- **Typecheck:** `npm run typecheck` clean, 0 errors, all 15 workspaces (`packages/*` × 6 + `packages/core/*` × 9).
- **Build:** `npm run build` clean, 0 errors.
- **Default test suite:** `npm test` — 682/682 passing, 0 failures. Up from the 638-test Phase-3.3 baseline by exactly +44, matching the sum of every individual package's delta (`@brain/codebase` 116 [+0], `@brain/evaluation` 72 [+2], `@brain/gateway` 43 [+10], `@brain/knowledge` 9 [+0], `@brain/mcp` 20 [+0], `@brain/storage` 112 [+2], `@brain/compression` 7 [+0], `@brain/context` 42 [+13], `@brain/contracts` 86 [+9], `@brain/learning` 3 [+1], `@brain/memory` 1 [+0], `@brain/ranking` 25 [+0], `@brain/retrieval` 63 [+0], `@brain/test-fixtures` 51 [+1], `@brain/token` 32 [+6]) — every untouched package's count is byte-identical to its Phase-3.3 value, exactly matching the zero-diff confirmed above for `ranking`/`retrieval`/`memory`/`knowledge`/`compression`.
- **`npm audit`: 2 vulnerabilities found (1 high, 1 moderate) — disclosed, characterized, non-blocking.** `fast-uri@3.1.5` (high: host-confusion/SSRF-adjacent URI-parsing advisories) via `ajv` via `@modelcontextprotocol/sdk`; `qs@6.15.3` (moderate: DoS via crafted input) via `express`/`body-parser` via the same SDK. Both traced with `npm ls`: transitive through `@modelcontextprotocol/sdk`, pinned since the Phase 2 baseline commit — `package-lock.json` has zero commits touching it anywhere in Phase 3.4's range (`git log` confirms), so this is not a dependency this phase added or drifted, and Phase 3.3's own "0 vulnerabilities" claim was accurate when it was checked; these advisories are newly reflected in npm's database since then. Exploitability is further bounded by this application's actual runtime: `packages/mcp/src/server.ts` only ever constructs a `StdioServerTransport` (confirmed by direct read) — the `express`-based HTTP transport that `qs`/`fast-uri` sit behind is present in `node_modules` as part of the SDK's installed dependency tree but is never instantiated, so the vulnerable code paths are not reachable through this application's actual usage. Not fixed as part of this task (documentation-only scope; a real fix would mean bumping `@modelcontextprotocol/sdk` and re-running the full regression, which is Phase 4 scoping's call, not a silent side effect of a docs task) — flagged here as a carry-forward item instead of hidden.
- **Integration tiers:** `packages/storage` 4/4 (unchanged from 3.3); `packages/codebase` 1/1 (self-index: 261 files, 371 chunks — up from 3.3's 246/340 as the repository has grown); `packages/evaluation` 5/5 (the two pre-existing Phase 2C redundancy suites, Phase 3.2's code-self-repository, Phase 3.3's dependency-self-repository, and Phase 3.4's real coding pilot, all green).
- **Formal evaluation** (frozen, hand-labeled, reproduced to the same values as implementation time): memory recall 1.000 (9/9 tasks with required memories), code recall 0.818 (11 tasks with required files), dependency delivered-when-useful 4/5, mean token utilization 0.308.
- **Score calibration** (reproduced to the same values): memory scores mean=0.409/median=0.155 (n=48), code scores mean=0.295/median=0.375 (n=50), both within `computeScore`'s [0,1] range.
- **Real coding pilot** (5 real tasks against this repository): all 5 returned a real, distinct `contextId` and round-tripped a real outcome (`outcome recorded: true` × 5). Token budget fully utilized (3000/3000, 100.0%) on every task — expected given this repository's real chunk volume exceeds any single task's budget, not a symptom of anything wrong. Latency this run: 53.6-92.4ms per `getContext` call (vs. 37-57ms at implementation time — cold-cache/machine-load variance on a test that re-indexes 261 files first, not a functional change).
- **`git diff --stat` against the pre-3.4 baseline** (39 files, +1647/-129): confined to `packages/core/{context,contracts,learning,test-fixtures,token}`, `packages/{evaluation,gateway,mcp,storage}`, and this document's own doc pair. `packages/core/ranking`, `packages/core/retrieval`, `packages/core/memory`, `packages/core/compression`, `packages/codebase`, and `packages/knowledge` show zero changed lines. `packages/mcp/src/schemas.ts` (the frozen `brain_feedback`/`brain_context` request shapes) is untouched — 0 lines. Redundancy policy untouched — the one line matching "redundan" in `gateway.ts`'s diff is an unrelated doc-comment context line, not a code change; `packages/core/learning/src/service.ts`'s +9 lines are two pure pass-through delegation methods, no behavior change to existing learning logic.

All findings above were checked against running code and fresh command output this session, not assumed from `PHASE_3_TASKS.md`'s own account of what happened during implementation.

---

# Phase 3 — Official Closeout

All four sub-milestones are complete: 3.1 Repository Foundation, 3.2 Code Retrieval, 3.3 Dependency Intelligence, 3.4 Context Integration. Checked against `BUILD_PLAN.md`'s own Phase 3 acceptance criterion (line 245): *"A code-related task context request returns relevant file/symbol/dependency information within budget, sourced through the same Context Compiler as any other memory type."* Confirmed true, not asserted: Task 12's real pilot issued 5 genuine coding-task requests against this actual repository through `Gateway.getContext`, and every one returned relevant code (and, for 4/5, dependency) items assembled by the same `fillBudget` core `optimizeContext` has always used, within a 3000-token budget, every time (the `HARD INVARIANT: final tokenCount never exceeds maxTokens` test — unmodified since Phase 1 — is still part of the 682 green tests). Every acceptance-criteria section of `PHASE_3_SPEC.md`'s Phase 3.4 spec (Heterogeneous Context Type, Backwards-Compatibility, Package/DAG, Memory Source, Code Source, Dependency Enrichment, Source Score Calibration, Mixed-Source Prioritization, Starvation Safety, Context Formatting, Token-Budget Integration, Telemetry Design, Feedback Semantics, Outcome Correlation, Failure Degradation, Project/Repository Resolution, Gateway Composition, MCP Compatibility) was independently re-checked this session against either running tests or direct source inspection, not re-asserted from the task brief's own claims — see the Post-implementation confirmation above for the checkable specifics.

Non-goals held: zero required network calls preserved (`StdioServerTransport`-only MCP runtime, structural no-network-import guards still passing in `@brain/codebase`/`@brain/retrieval`/`@brain/token`); redundancy stays disabled by default and its policy code is untouched by 3.4; `brain_feedback`'s frozen schema is untouched; the 10-tool MCP surface did not grow; no symbol/AST intelligence, no learning-behavior change, no second ranking or context system was introduced anywhere in Phase 3.

Two items carry forward as disclosed, non-blocking context for whoever scopes Phase 4, not as unresolved Phase 3 gaps: the `fast-uri`/`qs` transitive advisories via `@modelcontextprotocol/sdk` (real per `npm audit`, unreachable in this application's actual stdio-only runtime, fixable by an SDK version bump that this documentation-only task deliberately did not perform), and the memory-vs-code score-calibration skew characterized in Task 11 (already mitigated by Task 6's starvation safety net, but a candidate for revisiting if Phase 4 introduces per-source weighting or learned calibration).

PHASE_3_COMPLETE
READY_TO_SCOPE_PHASE_4
