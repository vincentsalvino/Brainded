# Phase 1 Task Graph

19 dependency-aware tasks implementing `PHASE_1_SPEC.md`. Task IDs are ordered to roughly follow dependency order, not the package list order in the spec.

## Dependency Graph

```
P1-001 Contracts
   |
   +-- P1-002 Test infrastructure (fixtures + fakes)
   |
   +-- P1-003 Storage schema
   |      |
   |      v
   |   P1-004 Storage repositories
   |      |
   |      +---------------------------------+-------------------+
   |      v                                 v                   v
   |   P1-005 Memory service          P1-008 Candidate retrieval  P1-013 Learning event model
   |      |                                 |                        |
   |      v                                 |                        v
   |   P1-006 Scope enforcement             |                  P1-014 Outcome/feedback wiring
   |      |                                 |
   |      v                                 |
   |   P1-007 Knowledge/seed import         |
   |                                        |
   +-- P1-009 Ranking (needs P1-001 only)   |
   +-- P1-010 Token enforcement (needs P1-001 only)
   |      |
   |      v
   |   P1-011 Compression
   |
   |   [P1-008, P1-009, P1-010, P1-011 converge:]
   |      v
   |   P1-012 Context compiler
   |
   +-- P1-015 Gateway (needs P1-001 only)
          |
          v
   [P1-005, P1-007, P1-008, P1-009, P1-012, P1-014, P1-015 converge:]
   P1-016 MCP adapter
          |
          v
   P1-017 CI boundaries
          |
          v
   P1-018 Integration tests
          |
          v
   P1-019 Phase acceptance
```

**Maximum parallelism window:** once P1-001 and P1-002 land, six independent tracks can proceed simultaneously: storage (P1-003→004), ranking (P1-009), token (P1-010→011), gateway (P1-015), and — once P1-004 lands — memory (P1-005→006→007), retrieval (P1-008), and learning (P1-013→014) can all proceed in parallel too. P1-009 and P1-010 are the two tasks with the fewest dependencies in the whole plan (contracts only, no repository, no I/O) and should be scheduled first among the parallel tracks if minimizing time-to-first-integration matters.

---

### P1-001 — Contracts
- **Purpose:** Establish `MemoryRecord`, `ScopeRef`, `MemoryCreateInput`/`UpdateInput`/`Query`/`Result`, `Candidate`, `RankedResult`, `ContextPack`, the four event shapes, and every repository/store interface as Zod schemas + TS types. This is the leaf every other task depends on.
- **Dependencies:** None.
- **Files/packages:** `packages/core/contracts/src/*`.
- **Acceptance criteria:** Every type in `PHASE_1_SPEC.md` §Core Contracts and §Storage Boundary exists and is exported; all schemas use `.strict()`.
- **Tests required:** One valid + one invalid fixture per schema; a `.strict()` rejection test proving an unrecognized field fails validation rather than being silently dropped.
- **Parallel:** No — blocks everything.

### P1-002 — Test infrastructure
- **Purpose:** Shared fixtures (a small canonical dataset of memories across all 12 types and all three scope kinds) and in-memory fake implementations of `MemoryRepository`, `RetrievalStore`, `EventStore` so every downstream core package can be unit-tested without a real database.
- **Dependencies:** P1-001.
- **Files/packages:** `packages/core/test-fixtures/*` (or equivalent shared test-utility location).
- **Acceptance criteria:** Fakes satisfy the same interfaces as the real implementations; fixture dataset covers every memory type and scope kind at least once.
- **Tests required:** The fakes themselves are simple enough not to need their own tests, but must be exercised by at least one consumer task's suite to prove they're usable.
- **Parallel:** Yes, alongside P1-003 and onward — unlocks parallel work on every core package.

### P1-003 — Storage schema
- **Purpose:** SQLite initialization (WAL mode), the `memories` table (single table, `type` discriminator, per D2), the mutation audit trail (implemented as the `memory_mutation_events` table, not a separate `memory_audit_log` *(corrected post-Phase-1 per E24: documentation only, no code behaviour changed)*), FTS5 shadow table, `vec0` virtual table via sqlite-vec, the four event tables, versioned migration files as the single schema source of truth.
- **Dependencies:** P1-001.
- **Files/packages:** `packages/storage/src/{db.ts, schema.ts, migrations/}`.
- **Acceptance criteria:** Schema creates cleanly from empty; matches every field in `PHASE_1_SPEC.md`'s `MemoryRecord` table exactly.
- **Tests required:** Migration-apply-from-empty test; re-running migrations is idempotent.
- **Parallel:** No — blocks all storage-dependent work.

### P1-004 — Storage repositories
- **Purpose:** Concrete implementations of `MemoryRepository`, `RetrievalStore`, `EventStore`, and the default local `EmbeddingProvider`.
- **Dependencies:** P1-003.
- **Files/packages:** `packages/storage/src/{memory-repository.ts, retrieval-store.ts, event-store.ts, embeddings/local-provider.ts}`.
- **Acceptance criteria:** 12-type round-trip write/read; FTS5 query returns expected fixture rows; vector similarity search returns the expected nearest neighbor; zero external network calls during any of it.
- **Tests required:** All of the above, plus the `sqlite-vec` extension-load fallback path. *(Corrected per E24: the implemented behaviour is **throw-and-let-the-caller-degrade** — `SqliteRetrievalStore.semanticSearch()` raises a clear error and `RetrievalService` falls back to lexical-only. There is no in-process cosine fallback, and a second vector implementation was deliberately not built; see `db.ts`. Documentation only, no code behaviour changed.)*
- **Parallel:** No — the single biggest convergence-unblocking task; everything storage-backed waits on it.

### P1-005 — Memory service
- **Purpose:** `MemoryService.{create,get,update,archive,query}` plus lifecycle transition validity and per-mutation audit logging.
- **Dependencies:** P1-001 (can begin against P1-002's fake repository); P1-004 for final integration.
- **Files/packages:** `packages/core/memory/src/{service.ts, lifecycle.ts, provenance.ts}`.
- **Acceptance criteria:** `active → archived` is the only legal update-driven transition; every mutation produces exactly one audit-log row; `type` and `scope` are rejected as update fields.
- **Tests required:** CRUD round-trip against the fake (early) and the real repository (after P1-004); illegal-transition rejection test.
- **Parallel:** Yes, alongside P1-008/009/010/013/015 once P1-001/002 land; needs P1-004 only for final integration, not to start.

### P1-006 — Scope enforcement
- **Purpose:** Verify and lock in that every repository query enforces `ScopeRef` at the SQL level, not as a post-query filter — the specific class of failure `AUDIT_AEOS_BRAIN.md §11` documented.
- **Dependencies:** P1-004, P1-005.
- **Files/packages:** Cross-cutting — touches `packages/storage`'s query construction and adds the dedicated isolation test suite.
- **Acceptance criteria:** A query issued under scope A structurally cannot return scope B's rows, proven by test.
- **Tests required:** Cross-scope isolation test with adversarial fixtures (near-identical content in two different scopes; confirm no leakage either direction, including `global`-scope visibility rules).
- **Parallel:** No — must follow P1-004/005 directly, is itself a near-immediate prerequisite for trusting anything built on top.

### P1-007 — Knowledge/seed import
- **Purpose:** `KnowledgeImporter.importSeed()` and `KnowledgeQuery.listByDomain()`, calling `MemoryService.create()` — never bypassing it, per D2's unification principle.
- **Dependencies:** P1-005.
- **Files/packages:** `packages/knowledge/src/*`.
- **Acceptance criteria:** AEOS's 98-file seed corpus imports cleanly under the new strict schema; any file that would have silently lost data under AEOS's non-strict parser (`AUDIT_AEOS.md §8`) now fails the import loudly with a clear error, not silently.
- **Tests required:** Full-corpus import test; a deliberately malformed fixture file is rejected, not silently truncated.
- **Parallel:** Yes, alongside P1-008 onward.

### P1-008 — Candidate retrieval
- **Purpose:** `RetrievalService.getCandidates()` — lexical (FTS5), semantic (vector), tag/metadata filtering, returning `Candidate[]` with visible per-signal scores.
- **Dependencies:** P1-001 (can begin against fakes); P1-004 for final integration.
- **Files/packages:** `packages/core/retrieval/src/{candidates.ts, lexical.ts, semantic.ts}`.
- **Acceptance criteria:** Never throws — vector-unavailable degrades to lexical-only; a known-relevant fixture query returns the expected candidate.
- **Tests required:** Fixture precision check; degradation-path test (explicitly simulating vector-index failure).
- **Parallel:** Yes, alongside P1-005/009/010/013/015.

### P1-009 — Ranking
- **Purpose:** `RankingService.rank()` — a pure function combining `lexicalScore`/`semanticScore`/`tagScore` into a final `score`, with a reserved-but-unused `diversity` signal slot (D7).
- **Dependencies:** P1-001 only. **No repository, no I/O.**
- **Files/packages:** `packages/core/ranking/src/{rerank.ts, exploration.ts, diversity.ts}`.
- **Acceptance criteria:** Deterministic given fixed input; `record.confidence` passes through unmodified and is never combined into `score`.
- **Tests required:** Pure unit tests on fixed candidate sets — full coverage is achievable and required, this package has no excuse not to have it.
- **Parallel:** Yes — one of the two most independent tasks in the plan; can start immediately after P1-001.

### P1-010 — Token enforcement
- **Purpose:** `TokenEstimator.estimate()` and `BudgetEnforcer.fit()` — the actual budget-fit primitive.
- **Dependencies:** P1-001 only. **No repository, no I/O.**
- **Files/packages:** `packages/core/token/src/{budget.ts, estimator.ts}`.
- **Acceptance criteria:** `fit()` never returns an included set whose estimated size exceeds `maxTokens`, across a fixture range including zero-budget and single-huge-item edge cases.
- **Tests required:** Property-style test across many `(items, maxTokens)` combinations; estimator is conservative (never underestimates on the fixture set).
- **Parallel:** Yes — the other most-independent task; can start immediately after P1-001.

### P1-011 — Compression
- **Purpose:** `Compressor.compress()` — truncation-based content shrinking, never LLM-based (would violate `ARCHITECTURE.md` invariant 19).
- **Dependencies:** P1-010.
- **Files/packages:** `packages/core/compression/src/*`.
- **Acceptance criteria:** Truncated output never exceeds its target per the same estimator P1-010 uses; a truncation marker is present when truncation occurred; never truncates below the documented minimum-useful floor (skips instead).
- **Tests required:** Truncation-fits-target test; below-floor-skips-instead-of-mangling test.
- **Parallel:** No — short, direct follow-on to P1-010, but blocks P1-012.

### P1-012 — Context compiler
- **Purpose:** `ContextService.compile()` — dedup, conflict flagging, invoking compression, applying the token budget, final `ContextPack` assembly. The busiest convergence point in Phase 1.
- **Dependencies:** P1-008, P1-009, P1-010, P1-011.
- **Files/packages:** `packages/core/context/src/{compiler.ts, dedup.ts, conflicts.ts, compress.ts}`.
- **Acceptance criteria:** **No `ContextPack` ever exceeds its requested `maxTokens`** (the single hardest acceptance bar in Phase 1); every item carries its source `memoryId`; conflicting candidates are flagged, not silently both included; duplicates are merged.
- **Tests required:** The budget-never-exceeded property test (the most important test in the package); dedup test; conflict-flagging test; omitted-item accounting test.
- **Parallel:** No — cannot meaningfully start until its four inputs exist, though internal dedup/conflict logic can be prototyped against fakes earlier.

### P1-013 — Learning event model
- **Purpose:** `EventService.{recordRetrieval, recordContext, recordOutcome, recordFeedback, getEventsForTask, getEventsForMemory}` — Phase 1 scope is faithful recording and correct linkage only, no aggregation.
- **Dependencies:** P1-001 (can begin against fakes); P1-004 for final integration (needs `EventStore`).
- **Files/packages:** `packages/core/learning/src/{outcomes.ts, aggregation.ts (stubbed, unused in Phase 1), scheduler.ts (stubbed, unused in Phase 1)}`. Note: `aggregation.ts`/`scheduler.ts` files may be scaffolded with clear "Phase 4" markers but must contain no logic yet — do not build ahead of the phase that needs them.
- **Acceptance criteria:** `ContextEvent.retrievalEventId` correctly links back; `OutcomeEvent.taskId` and `FeedbackEvent.memoryId` are queryable.
- **Tests required:** Round-trip for all four event types; linkage-correctness test (create a `RetrievalEvent` → a `ContextEvent` referencing it → confirm the link resolves).
- **Parallel:** Yes, alongside P1-005/008/009/010/015.

### P1-014 — Outcome/feedback wiring
- **Purpose:** Confirm and test, specifically, that the write paths for `brain_feedback`/`brain_record_outcome` will be real and complete once MCP exists — this is the task that exists *because* both predecessor projects failed exactly here (`AEOS_COMPARISON.md §6`). Not a new component; a dedicated verification pass on P1-013's two most important methods.
- **Dependencies:** P1-013.
- **Files/packages:** Test-only task — no new production files beyond what P1-013 already created.
- **Acceptance criteria:** A simulated caller can invoke `recordFeedback`/`recordOutcome` and later retrieve exactly what was recorded via `getEventsForTask`/`getEventsForMemory`, with no step in between that could silently swallow a failure (directly ruling out `AUDIT_AEOS_BRAIN.md §13`'s "RPC may not exist yet — this is non-fatal" class of bug).
- **Tests required:** The linkage test from P1-013, re-run as an explicit named acceptance test for this specific risk, not just incidentally covered.
- **Parallel:** No — short, direct follow-on to P1-013, but conceptually important enough to track as its own task rather than being buried inside P1-013's generic test list.

### P1-015 — Gateway
- **Purpose:** Request-scoped identity/session/scope/budget/permission resolution — explicitly **not** a module-level or otherwise shared-mutable variable, ruling out `AUDIT_AEOS_BRAIN.md §20`'s race condition by construction.
- **Dependencies:** P1-001 only.
- **Files/packages:** `packages/gateway/src/{session.ts, context-resolution.ts}`.
- **Acceptance criteria:** Two concurrent resolutions under different request contexts never share or leak state.
- **Tests required:** The concurrency test — overlapping resolutions under different scopes, asserted independent (this is also re-verified at the full MCP level in P1-018, but must pass in isolation here first).
- **Parallel:** Yes, alongside P1-005/008/009/010/013.

### P1-016 — MCP adapter
- **Purpose:** The ten `brain_*` tool handlers, each: validate input → resolve via Gateway → call exactly one Core service method → return. The largest single convergence point in Phase 1.
- **Dependencies:** P1-005, P1-007, P1-008, P1-009 (via P1-012), P1-012, P1-014, P1-015.
- **Files/packages:** `packages/mcp/src/{server.ts, tools/*.ts}` — including the single composition-root bootstrap file that is the only place in the codebase allowed to import both a `packages/core` service and a `packages/storage` concrete implementation.
- **Acceptance criteria:** All ten operations are callable and match `PHASE_1_SPEC.md`'s §MCP Boundary table exactly; no handler contains branching business logic, a database call, or an embedding call.
- **Tests required:** One integration test per operation.
- **Parallel:** No — genuinely the convergence point; nothing after it can start until it's functional.

### P1-017 — CI boundaries
- **Purpose:** The dependency-graph import-boundary check (D4) — the mechanism that makes `ARCHITECTURE.md` invariants 4 and 21 checked facts, not stated intentions.
- **Dependencies:** P1-016 (needs the full package structure in place to check against meaningfully, though the rule config itself can be drafted earlier).
- **Files/packages:** A dependency-cruiser config (or equivalent) wired into CI.
- **Acceptance criteria:** All four rules from `PHASE_1_SPEC.md`'s §CI Import-Boundary Design are encoded; the build fails on violation, does not merely warn.
- **Tests required:** A deliberately-introduced violation (e.g., a throwaway import of `better-sqlite3` inside `packages/mcp`) is planted, confirmed to fail the check, then reverted — proving the check actually catches what it claims to.
- **Parallel:** No — depends on the full structure existing to be meaningful.

### P1-018 — Integration tests
- **Purpose:** End-to-end tests spanning multiple packages through the real MCP surface — the cross-scope concurrency test at full system scope, and the property-based token-budget test re-run against the real (not faked) storage and context pipeline.
- **Dependencies:** P1-016, P1-017.
- **Files/packages:** A dedicated integration-test suite, separate from each package's own unit tests.
- **Acceptance criteria:** Overlapping requests under different scopes, issued through real MCP handlers, never cross-contaminate; the budget-never-exceeded property holds end-to-end, not just at the `core/context` unit level.
- **Tests required:** As above — both are must-pass, not advisory.
- **Parallel:** No.

### P1-019 — Phase acceptance
- **Purpose:** Run every criterion in `PHASE_1_SPEC.md`'s §Acceptance Criteria and confirm all seven pass together, as a single gate.
- **Dependencies:** All prior tasks.
- **Files/packages:** None new — a checklist pass, not a code task.
- **Acceptance criteria:** All seven of `PHASE_1_SPEC.md`'s acceptance criteria pass simultaneously against one running instance.
- **Tests required:** N/A beyond what's already been run — this task is the confirmation, not new test-writing.
- **Parallel:** No — the final task.
