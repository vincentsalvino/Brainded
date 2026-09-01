# Phase 3 Spec — Coding Intelligence

Official Blueprint phase: **Phase 3**. Implementation subdivision (not a renumbering):

- **3.1 Repository Foundation** — this document details 3.1 only.
- **3.2 Code Retrieval** — code chunks become a retrieval source (lexical + semantic), project-scope isolated. No separate agent-facing search architecture; reuses `packages/core/retrieval`/`ranking`.
- **3.3 Dependency Intelligence** — static import/dependency graph; "what depends on this / what breaks if changed"; regex/static parsing; AST precision deferred.
- **3.4 Context Integration** — code candidates flow through the existing Context Compiler/token budget alongside memory and knowledge; no parallel context/ranking system.

Non-goals for all of Phase 3 (not just 3.1): full AST semantic understanding, architecture inference, automatic code rewriting, test-impact prediction, LSP implementation, remote repository crawling, cloud indexing, LLM-required indexing, a second code-specific MCP architecture. Local-first, zero-required-network-calls is invariant (`DECISIONS.md` D3).

---

## Part A — Package Reconciliation (pre-flight findings)

`packages/codebase` (top-level, `@brain/codebase`) remains the correct location — sibling to `knowledge`, `evaluation`, `gateway`, `mcp`, `storage` under the `packages/*` workspace glob, not nested under `packages/core/*`. `knowledge` is the closest existing precedent: a top-level package holding real orchestration logic on top of a Core service, not a thin pass-through.

**Dependency DAG (verified against existing packages, e.g. `@brain/gateway`'s and `@brain/retrieval`'s `package.json`, which depend only on `@brain/contracts` + sibling domain packages, never on `@brain/storage`):**

```
@brain/contracts  <-- interfaces + record types only
      ^
      |
@brain/codebase   -- indexer/chunker/discovery business logic, DI over CodebaseRepository
      ^
      |  (implements the interface; consumed only by the future composition root)
@brain/storage    -- SqliteCodebaseRepository + migration
```

`@brain/codebase` depends on `@brain/contracts` and the `ignore` npm package only (runtime), `@brain/test-fixtures` (dev/test only, for `FakeCodebaseRepository`). It does **not** depend on `@brain/storage`, `@brain/gateway`, `@brain/mcp`, `@brain/context`, or `@brain/ranking` — matching the instruction and the existing pattern exactly. `@brain/storage` implements `CodebaseRepository`; nothing wires the concrete implementation into the Gateway/MCP composition root yet (`packages/mcp/src/bootstrap.ts` is not touched this phase — there is no `brain_*` tool calling any of this yet, so wiring it would be dead code).

**Existing concepts reused, not duplicated (from `packages/core/contracts/src/repositories.ts` and `scope.ts`):**
- The `*Repository`/`*Store` naming convention (`MemoryRepository`, `RetrievalStore`, `EventStore` are behavioral interfaces implemented in `packages/storage`) is followed exactly: `CodebaseRepository` interface in `@brain/contracts`, `SqliteCodebaseRepository` in `@brain/storage`.
- **Naming collision avoided:** the user-suggested contract name `RepositoryRecord` collides in spirit with the codebase's existing use of "Repository" to mean a storage-access interface (`MemoryRepository` et al.), not a registered git/code repository. The registered-repository entity is named **`CodebaseRecord`** instead; the storage-access interface is **`CodebaseRepository`** — consistent with existing naming, not ambiguous.
- `ScopeRef`/`scopeIncludes`/`projectScope()` (from `scope.ts`) are reused as-is for repository/file/chunk scoping — no new scope concept invented. A registered repository carries a full `ScopeRef` (in practice always `project`, but the column shape matches `memories` exactly rather than inventing a project-only field).
- The Fake-in-`@brain/test-fixtures` + Sqlite-in-`@brain/storage` pattern (`FakeMemoryRepository` / `SqliteMemoryRepository`) is followed for the same reason it exists today: business-logic packages test against fakes, never against real SQLite directly (see `@brain/retrieval`'s and `@brain/gateway`'s `package.json`, whose `devDependencies` name only `@brain/test-fixtures`).
- `node:crypto.randomUUID()` for the repository entity id (mirrors `memory-repository.ts`); deterministic `sha256` hex for file/chunk ids (new — required by invariant 6, see below).
- Node 24's native recursive `fs.readdir(dir, { recursive: true, withFileTypes: true })` (already used in `packages/knowledge/src/importer.ts`) is reused for directory walking — no new walker dependency.
- `better-sqlite3` transactions (`db.transaction(fn)()`), scope-in-WHERE-clause enforcement, and `CREATE TABLE IF NOT EXISTS` + a new zero-padded sequential migration file are all the existing `packages/storage` conventions, unchanged.

**No conflict found.** Nothing in `ARCHITECTURE.md`, `ARCHITECTURE_REVIEW.md`, or `DECISIONS.md` blocks this design; §18 ("the codebase index is a knowledge source, it is not identical to memory") is honored by never writing code content into the `memories` table.

---

## Repository Model (contracts, `packages/core/contracts/src/codebase.ts`)

```
CodebaseRecord {           -- a registered, indexed root
  id: uuid                 -- random, assigned at first registration
  scope: ScopeRef
  rootPath: string         -- as given by the caller; never used inside a deterministic id
  createdAt, updatedAt: ISO datetime
  lastIndexedAt: ISO datetime | null
}

CodeFileRecord {
  id: string                -- sha256("<repositoryId>\n<relativePath>"), NOT a uuid: stable
                             -- per (repository, path), independent of content, independent
                             -- of the machine the repo lives on (invariant 6 + repository-
                             -- movement requirement)
  repositoryId: string
  scope: ScopeRef
  relativePath: string       -- POSIX-style, relative to rootPath; never absolute
  language: string | null
  sizeBytes: number
  contentHash: string        -- sha256 of file content; drives incremental diffing
  indexedAt: ISO datetime
}

CodeChunkRecord {
  id: string                 -- sha256("<fileId>\n<chunkIndex>"): deterministic, and does not
                              -- need to survive a content change because a changed file's
                              -- chunks are wholesale replaced, never diffed chunk-by-chunk
  fileId: string
  repositoryId: string
  scope: ScopeRef
  relativePath: string
  chunkIndex: number         -- 0-based, stable ordering
  startLine, endLine: number -- 1-based, inclusive
  content: string
  contentHash: string
}
```

Why file/chunk ids are content-independent (path-derived) rather than content-derived: a file's identity must persist across edits so an update is an *update*, not a delete+create pair the diff logic has to reconstruct. Content-addressing only the *chunk replacement operation* (via `contentHash` comparison, not via the id) is what invariant 6 ("same content -> same identity") actually requires, and this satisfies it: identical repository content on two machines produces identical `rootPath`-independent ids for every file and chunk.

## Storage (`CodebaseRepository`, `packages/core/contracts/src/repositories.ts`)

```
interface CodebaseRepository {
  findRepository(scope: ScopeRef, rootPath: string): Promise<CodebaseRecord | null>;
  createRepository(scope: ScopeRef, rootPath: string): Promise<CodebaseRecord>;
  markIndexed(repositoryId: string): Promise<void>;
  listFiles(repositoryId: string): Promise<CodeFileRecord[]>;
  replaceFile(file: CodeFileRecord, chunks: CodeChunkRecord[]): Promise<{ chunksCreated: number; chunksRemoved: number }>;
  removeFile(fileId: string): Promise<{ chunksRemoved: number }>;
}
```

`replaceFile` is the one atomic write primitive: upsert the file row (id is deterministic, so this is a natural `ON CONFLICT DO UPDATE`), delete that file's existing chunks, insert the new ones — one `better-sqlite3` transaction, matching `writeMutationAtomically` in `memory-repository.ts`. This single primitive covers both "new file" (no prior row) and "changed file" (prior row exists) without a separate insert/update branch in the interface.

## Migration

New file `packages/storage/migrations/0003_codebase_index.sql`. Tables: `repositories`, `code_files`, `code_chunks`. Same `scope_kind`/`scope_id` CHECK pattern as `memories`; `ON DELETE CASCADE` from `code_chunks.file_id` -> `code_files.id` and from `code_files.repository_id`/`code_chunks.repository_id` -> `repositories.id` (mirrors `feedback_events`' existing cascade-on-purge reasoning). Unique index on `code_files(repository_id, relative_path)` — the DB itself forbids the duplicate-file-per-run bug, not just application logic. No `dependency_edges` table (deferred to 3.3, per instruction).

Two existing tests hardcode the applied-migration list and must be updated to include `0003_codebase_index.sql`: `packages/storage/src/db.test.ts` lines asserting `appliedMigrations(...)` equals a 2-element array. This is expected migration-count drift, not a design change — flagged here so it isn't mistaken for scope creep during review.

## Path / Ignore Policy

- `rootPath` is stored once per `CodebaseRecord`; every `relativePath` is POSIX-relative to it (`/`-separated regardless of host OS, via `path.relative(...).split(sep).join('/')`).
- Every discovered entry's real path is resolved (`fs.realpath`) and checked for containment inside the resolved root before being processed; anything that resolves outside root (symlink escape) is skipped with reason `"path-escape"`, never read.
- Default ignore: `.git`, `node_modules`, `dist`, `build`, `coverage`, `.tmp`/`*.tmp`, common binary extensions as a binary-content fallback (not solely by extension — see below). `.gitignore` at the repository root is respected via the `ignore` npm package (the standard, dependency-free, correctness-tested library used by ESLint/Prettier/VS Code for this exact grammar) rather than a hand-rolled parser, per instruction. An optional caller-supplied list of extra patterns is unioned in.
- Binary detection is content-based, not extension-based: the first 8000 bytes are checked for a NUL byte (git's own heuristic). An unknown *text* extension is never rejected solely for being unrecognized — only actual binary content is skipped.
- Language detection is a static extension map (`.ts`->`typescript`, `.py`->`python`, etc.); unmapped extensions get `language: null`, not an error.

## Chunking

Line-window, deterministic: fixed `maxLines` per chunk (default 200), 0 overlap by default. `ChunkPolicy = { maxLines: number; overlapLines: number }` is a plain options object, not a strategy interface with multiple implementations — the instruction explicitly warns against building an unused strategy framework, and nothing today needs more than one policy. Overlap defaults to 0 as the documented, deliberately simple starting point (`ponytail`: window chunking with 0 overlap; add overlap only if 3.2's retrieval-quality evaluation shows boundary-split context loss).

## Indexer Contract (`packages/codebase/src/indexer.ts`)

```
class CodebaseIndexer {
  constructor(repository: CodebaseRepository)
  indexRepository(options: { scope: ScopeRef; rootPath: string; extraIgnorePatterns?: string[]; chunkPolicy?: ChunkPolicy }): Promise<IndexResult>
}

IndexResult {
  repositoryId, filesDiscovered, filesIndexed, filesUnchanged, filesUpdated,
  filesRemoved, filesSkipped, chunksCreated, chunksRemoved, durationMs: number
  skipped: { relativePath: string; reason: string }[]
}
```

Field semantics: `filesDiscovered` counts post-ignore-filter candidates. `filesIndexed` = brand-new files persisted this run. `filesUpdated` = previously-known files whose `contentHash` changed. `filesUnchanged` = previously-known files whose hash matched (never re-chunked, never re-hit `replaceFile`). `filesRemoved` = previously-known files no longer discovered (stale cleanup). `filesSkipped` = discovered files not processed (binary, path-escape, or a thrown error while hashing/chunking/persisting that file specifically) — each with a reason in `skipped`.

**Failure isolation:** one file's read/hash/chunk/persist failure is caught per-file, recorded in `skipped`, and does not abort the run or touch that file's previously-stored row — so it is retried automatically on the next `indexRepository()` call (same discipline as `packages/knowledge/src/importer.ts`'s per-file `ImportFailure` handling).

**Repository-level atomicity is per-file, not whole-repository:** a crash mid-run leaves already-processed files correctly updated and not-yet-processed files untouched (they'll be picked up, unchanged or not, next run). A single giant transaction across a large repository was rejected as unnecessary lock contention for no correctness gain — no requirement here needs cross-file atomicity.

## Explicitly Not Implemented in 3.1

Dependency graph, code candidate retrieval/reranking, AST parsing, call graph, test-impact analysis, architecture inference, LLM-based summarization, code generation, code-specific MCP tools, dashboard, cloud indexing, a repository-watching daemon, learning, any redundancy-policy change. `brain_context` does not see code chunks after this phase — that is 3.2.

---

# Phase 3.2 Spec — Code Retrieval

Makes the chunks 3.1 persists lexical- and semantic-searchable. A retrieval SOURCE, same discipline as `ARCHITECTURE.md` 18: not a second Brain, not a second ranking system, no `brain_context` integration (3.4), no dependency graph (3.3).

## Part B — Candidate Ownership Decision (pre-flight finding)

**CASE B.** `Candidate` (`packages/core/contracts/src/retrieval.ts`) is memory-specific, verified by reading the actual schemas, not assumed:

- `Candidate.memoryId` is `z.string().uuid()`. Chunk/file ids are deterministic sha256 hex (3.1, `packages/codebase/src/hash.ts`) — not uuids, would fail `CandidateSchema.parse()`.
- `Candidate.record` is a full `.strict()` `MemoryRecordSchema`: a closed 12-value `type` enum with no "code" member, plus `confidence`/`source`/`status`/`domain`/`tags`/`supersedes` a code chunk has no honest value for. Satisfying it would mean either extending a frozen, mature enum for one caller's convenience, or fabricating fields (a fake `confidence`, a guessed `source.origin`) — both ruled out by the instruction ("do not force the architecture", "do not move a mature existing type solely to satisfy this phase").
- `SimilarityPairSchema.a`/`.b` are also `z.string().uuid()` — same mismatch, not that this phase needs `SimilarityPair` (hybrid dedup here is identity-merge by `chunkId`, see below, not pairwise similarity).
- `CandidateSignalsSchema` (`{lexicalScore?, semanticScore?, tagScore?}`) is the one part of `Candidate` that is already generic — nothing about it is memory-specific. **Reused directly, unmodified**, as `CodeSearchResult.signals`.

**Fallback taken (per instruction's own CASE B guidance):** a new, small `CodeSearchQuery`/`CodeSearchResult` pair in `@brain/contracts` (`code-search.ts`), a parallel `CodeSearchStore` interface in `repositories.ts` — not a rename or restructuring of `Candidate`/`RetrievalStore`. "Ranking-compatible candidate data" (acceptance criterion 10) is proven at the *signals* level: `computeScore(codeResult.signals, weights)` — the actual, unmodified `@brain/ranking` scoring function — runs correctly on code signals, proven by an isolated test added to `packages/core/ranking/src/score.test.ts`, constructing plain `CandidateSignals`-shaped objects. This needs no new package dependency (the test only imports the already-shared `CandidateSignals` type) and does not require `@brain/ranking` to know `@brain/codebase` or `code-search.ts` exist. No fabricated `MemoryRecord` is ever constructed anywhere in this phase.

No architecture conflict found. Proceeding.

## Target Shape

```
CodeSearchFilters { repositoryId?, pathPrefix?, language? }
CodeSearchQuery   { text, scope, filters?, limit }
CodeSearchResult  { chunkId, fileId, repositoryId, scope, relativePath, language,
                     startLine, endLine, content, signals: CandidateSignals }
CodeSyncResult    { chunksEmbedded, chunksUnchanged, chunksRemoved, available }
```

`CodeSyncResult` is a plain interface, not a zod schema — same convention as 3.1's `IndexResult` (an internal summary type, not a validated boundary input).

```
interface CodeSearchStore {
  lexicalSearch(query: CodeSearchQuery): Promise<CodeSearchResult[]>;
  semanticSearch(query: CodeSearchQuery): Promise<CodeSearchResult[]>;
  syncEmbeddings(repositoryId: string): Promise<CodeSyncResult>;
}
```

## Migration `0004_codebase_search.sql`

- `code_chunks_fts`: external-content FTS5 over `code_chunks.content` + insert/update/delete triggers — byte-for-byte the same pattern `memories_fts` uses in `0001`. `replaceFile`'s delete-then-insert of a file's chunks (3.1) fires these triggers correctly inside the same transaction; no new write path needed.
- `code_embedding_state(chunk_id TEXT PRIMARY KEY, repository_id TEXT NOT NULL REFERENCES repositories(id) ON DELETE CASCADE, content_hash TEXT NOT NULL, embedded_at TEXT NOT NULL)`: tracks which content hash was last embedded per chunk. **Deliberately no FK on `chunk_id`** — a tracking row must be able to outlive its `code_chunks` row so the next `syncEmbeddings()` can detect "existed before, gone now" and remove the corresponding vector. `repository_id` cascades on whole-repository deletion, matching `code_chunks`/`code_files`.
- `code_chunk_vectors` (vec0, `chunk_id TEXT PRIMARY KEY, embedding float[384]`) is created conditionally in `db.ts`, not in this migration file — same reason `memory_vectors` isn't: vec0 DDL needs the extension already loaded, and migrations must not abort when `vectorSearchAvailable` is false.

Two hardcoded `appliedMigrations(...)` assertions in `packages/storage/src/db.test.ts` gain `"0004_codebase_search.sql"` — same expected drift 3.1 flagged for `0003`, not scope creep.

## Search-Index Synchronization — Ownership

`syncEmbeddings(repositoryId)` lives on `SqliteCodeSearchStore` (`@brain/storage`), as its own method, called as an explicit, separate step after `CodebaseIndexer.indexRepository(...)` — **not** folded into 3.1's indexer or into `CodebaseRepository.replaceFile`. Two reasons: (1) embedding sync needs direct SQL comparison against `code_chunks`/`code_embedding_state`, and invariant 5 confines SQL to `@brain/storage` — `@brain/codebase` structurally cannot do this itself; (2) `CodebaseRepository`'s interface is 3.1's frozen, already-shipped, already-tested contract — extending it with embedding concerns would blur "codebase owns indexing" into "codebase owns search", which the mission explicitly rules out. This is the instruction's own preferred fallback ("prefer keeping this separate... unless combining is demonstrably cleaner" — it is not, here).

Algorithm (per repository): read current `(chunkId, contentHash)` from `code_chunks`; read previously-tracked `(chunkId, contentHash)` from `code_embedding_state`; a tracked id absent from current chunks is removed from both `code_chunk_vectors` and `code_embedding_state` (`chunksRemoved`); a current chunk whose hash matches its tracked hash is skipped (`chunksUnchanged`, zero embedding calls); everything else is embedded and upserted into both tables (`chunksEmbedded`). One chunk's embedding failure is caught and logged, not fatal to the run — same discipline as 3.1's per-file failure isolation and `SqliteMemoryRepository.indexVector`. `vectorSearchAvailable = false` short-circuits to `{0, 0, 0, available: false}`, mirroring `findSimilarPairs`'s existing degradation shape, not a throw.

## Hybrid Dedup

`mergeCodeCandidates(lexical, semantic)` in `@brain/retrieval` (`code-merge.ts`) is `merge.ts`'s `mergeCandidates` verbatim, keyed by `chunkId` instead of `memoryId`: identity-merge, not score fusion. When both channels return the same chunk, the **lexical channel's copy wins** for non-signal fields (content/path/etc.), with both signal scores merged onto it — this is `mergeCandidates`' existing, already-shipped rule (lexical inserted first, semantic only overlays `signals`), reused unchanged, not a new policy invented for code.

## Evaluation Reuse

`packages/evaluation/src/metrics.ts` (`precisionAtK`, `recallAtK`, `ndcgAtK`, `reciprocalRank`, `mean`) takes only `(ranked: string[], labels: Record<string, Grade>)` — no `MemoryRecord`/`EvalMemory` coupling at all, so it is reused unmodified for code. `evaluate()`'s orchestration in `evaluate.ts` *is* `EvalExample`-shaped (embeds `EvalMemory[]`, which is `MEMORY_TYPES`-constrained) — same Case-B mismatch as `Candidate`. Fallback: a small, code-specific fixture dataset (`code-retrieval.data.ts`, frozen, same convention as `redundancy-pairs-dataset.ts`) drives a focused test that calls the reused metric functions directly, rather than forcing chunk data through `EvalExample`.

## Explicitly Not Implemented in 3.2

`brain_context`/MCP/Gateway integration (3.4), dependency graph (3.3), score-fusion ranking weights beyond the existing `computeScore`, a second normalization formula, redundancy-policy changes, any touch to `packages/codebase`'s indexer, `packages/gateway`, or `packages/mcp`.

---

# Phase 3.3 Spec — Dependency Intelligence

File-level static import graph over the repositories 3.1 indexes. A third coding-intelligence source, same discipline as 3.1/3.2: no ranking, no `brain_context` integration (3.4), no symbol/AST precision (future).

## Part C — Ownership Decision (pre-flight finding)

The mission's own ownership diagram is correct as given (contracts → storage → codebase, `@brain/codebase` never depending on `@brain/storage`) — pre-flight's job was to verify it is *achievable*, not to re-litigate it. The one real question: extraction needs each eligible file's **source text**, and `CodeFileRecord` (3.1) carries metadata only (`language`, `sizeBytes`, `contentHash`) — never `content`. Two options considered:

- Reconstruct content from `code_chunks` (concatenate by `chunkIndex`). Rejected: correct only when chunking used zero overlap, which is today's default but not a guarantee `ChunkPolicy` enforces — silently wrong on any repository indexed with overlap.
- Re-read the file from disk via `rootPath` + `relativePath`, exactly mirroring what `CodebaseIndexer` itself already does (`discovery.ts` + `readFile`). **Adopted.** `DependencySynchronizer` takes `rootPath` as an explicit parameter, the same shape as `IndexOptions`, and reads only files `CodebaseRepository.listFiles` already lists as currently indexed. This is reading text, not executing it — invariant 2 ("never execute/import indexed code") is about not `require()`/`import()`-ing target files as modules, not about not reading their bytes; 3.1's own indexer already reads every file's content the same way.

No SQL, and no filesystem access beyond read-only `readFile`/`realpath`-safe paths already established by 3.1, is added to `@brain/codebase` — extraction/resolution/sync/graph logic is pure JS + the existing `CodebaseRepository` interface. No architectural conflict found.

## Dependency Contract

```
CodeDependencyEdge {
  id            -- deterministic, see Edge Identity below
  repositoryId, scope
  sourceFileId
  targetFileId  -- non-null iff resolution === 'internal' (schema-enforced)
  specifier     -- literal text, e.g. "./user-service"
  kind          -- static_import | dynamic_import | require | re_export
  resolution    -- internal | external | unresolved
  sourceLine    -- first occurrence's 1-based line, nullable
  createdAt
}
```

`kind` drops the mission's suggested `other`: nothing in this phase's extractor ever emits it, and an enum member nothing produces is dead surface. Side-effect imports (`import "./x"`) and named/default imports both classify as `static_import` — no symbol list is tracked (explicit non-goal), so there is nothing left to distinguish them by.

## Edge Identity

`id = sha256(repositoryId + "\n" + sourceFileId + "\n" + specifier + "\n" + kind)` — same deterministic-hash convention as `deriveFileId`/`deriveChunkId` (`packages/codebase/src/hash.ts`), extended with `deriveEdgeId` in the same file. **Duplicate imports of the same specifier+kind from the same file collapse into one edge** (the mission's stated preference; no evidence in this repository justifies preserving multiple occurrences) — the extractor itself dedupes before returning, keeping the first occurrence's `sourceLine`.

## Migration

`packages/storage/migrations/0005_codebase_dependencies.sql`. `0003`/`0004` untouched. Two tables:

- `code_dependency_edges` — `source_file_id`/`target_file_id` carry **no FK** to `code_files.id` (deliberately — see Invalidation below); `repository_id` cascades on whole-repository deletion, matching `code_chunks`. Indexes: `(repository_id, source_file_id)`, `(repository_id, target_file_id)` — exactly the two access paths `dependenciesOf`/`dependentsOf` use; no speculative extra index.
- `code_dependency_state` — `(file_id PK, repository_id, content_hash, indexed_at)`, tracks which hash a file's edges were last extracted from. **Also no FK on `file_id`**, for the identical reason `code_embedding_state.chunk_id` (3.2) has none: a state row must be able to outlive its `code_files` row long enough for the next sync to notice the file is gone and clean up — a cascading FK would delete the evidence before the next sync ever runs. This is the second time this exact pattern is needed; treated here as an established convention, not rediscovered from scratch.

## Extraction Strategy

Regex/static parsing, per the Build Plan's own allowance — but not one fragile regex. `packages/codebase/src/dependency-mask.ts` first runs a small, pure lexical state machine (`maskComments`) that blanks `//...` and `/* ... */` regions character-by-character while passing every string literal through untouched (so specifier text is never lost) and never mistaking a `//`/`/*` *inside* a string for a real comment start. `packages/codebase/src/dependency-extract.ts` then runs five independent, individually-tested regex rules against the masked text (static from-import, side-effect import, `require(...)`, string-literal `import(...)`, `export ... from` / `export * from`), each anchored tightly enough (e.g. `import` must be directly followed by whitespace+quote, or by an optional `type` then a binding then `from`+quote) that ordinary prose mentioning the word "import" does not satisfy the shape. AEOS's `services/dependency-graph/extractor.py` was read as the Build-Plan-cited precedent (ADAPT) — its regex *shapes* are the starting point; its complete absence of comment/string awareness is exactly what is not carried forward, since this mission's own test list requires it.

**Known, disclosed limitation:** a string literal whose *contents* happen to spell out valid import syntax verbatim (e.g. `"import x from './y'"` as a plain string value, not real code) is not distinguished from real code — doing so would require full tokenization, which is explicitly out of scope (AST precision is future work). Ordinary prose merely containing the word "import" is correctly ignored, because the regexes require exact adjacency (keyword immediately followed by whitespace+quote, or by `from`+quote) that natural sentences don't produce.

## Supported Syntax

`import x from "./y"`, `import {a,b} from "./y"`, `import x, {a} from "./y"`, `import type ... from "./y"`, `import "./y"` (side-effect), `export {a} from "./y"`, `export * from "./y"`, `require("./y")`, string-literal `import("./y")`.

## Known Unsupported Syntax

Expression-form dynamic `import(x)`/`` import(`${x}`) `` (no literal specifier exists — **no edge is created at all**, rather than fabricating one with a fake specifier; this is what makes "does not create a false resolved edge" trivially true). `tsconfig.json` path aliases (never executed/read — undocumented in this phase, not silently guessed). Workspace-package resolution (`@brain/contracts` classifies as `external`, same as `zod` — distinguishing "workspace-internal npm package" from "true external" would need cross-package `package.json` inspection not justified by the acceptance criteria; documented, not built). `.json` specifier resolution (not in the extension precedence list — no observed need in this repository).

## Path Resolution

Relative specifiers (`.`/`..`-prefixed) only. `packages/codebase/src/dependency-resolve.ts`'s `resolveSpecifier` is a pure function: given a specifier, the source file's own `relativePath`, and an in-memory `Map<relativePath, fileId>` (built once per sync from `CodebaseRepository.listFiles`), it tries a fixed, deterministic candidate order — the literal specifier as-is, then `+.ts/.tsx/.js/.jsx/.mjs/.cjs`, then the same six as `/index.*` — first match wins. Never touches the filesystem or Node's own module resolver. A bare (non-relative) specifier is always `external`. A relative specifier matching no candidate is `unresolved`.

## External / Unresolved Policy

Exactly the mission's "at minimum" three-way split (`internal`/`external`/`unresolved`) — no `builtin` sub-category, no workspace-package sub-category. Unresolved edges are persisted, not discarded (diagnostic value), but `DependencyGraphService`'s traversal methods only ever follow `resolution === 'internal'` edges.

## Incremental Synchronization / Invalidation

Two separably-costed phases, run in sequence by `DependencySynchronizer.syncDependencies`, because — per the mission's own instruction — **parsing and resolution are separate concerns**:

1. **Parse (content-hash-gated).** For each currently-indexed eligible file (`language` is `typescript`/`javascript`), compare its `contentHash` against `code_dependency_state`. Unchanged → skip entirely (no disk read, no regex). New/changed → read from disk, `extractDependencies`, `resolveSpecifier` each specifier against the current file-inventory map, `replaceOutgoingEdges` (atomic delete-old/insert-new, same primitive shape as `CodebaseRepository.replaceFile`). A tracked file no longer in `listFiles` → `removeFileState` (its outgoing edges and state row both removed) — this is where a *source* file's deletion is handled.
2. **Re-resolve (inventory-gated, runs every sync unconditionally, over *all* current edges — changed files' or not).** For every edge currently in the repository, recompute `resolveSpecifier` against the *current* file-inventory map and compare to the stored `resolution`/`targetFileId`. Only a genuine change is written (`updateEdgeResolution`) — a fully unchanged repository triggers zero writes here too. This is what makes target-side invalidation correct without reparsing the source: if file B is deleted, A's edge to B is re-resolved on the *next* sync and flips to `unresolved` even though A's own content never changed; if B is later added, the same pass flips A's edge back to `internal` — neither case touches A's stored specifier list.

One file's read/extract failure is caught, logged, and does not abort the run (`filesFailed`, `failures[]`) — same discipline as 3.1's indexer.

## Storage Implementation

`SqliteCodeDependencyStore` (`packages/storage/src/code-dependency-store.ts`) mirrors `SqliteCodebaseRepository`'s shape: prepared statements, `db.transaction()` for `replaceOutgoingEdges` (the one operation requiring atomicity, same reasoning as `replaceFile`), plain indexed `WHERE repository_id = ?` scoping (repository-id is the isolation key at this layer, matching `CodebaseRepository`'s own convention — not a separately-threaded `ScopeRef` parameter).

## Graph Service

`DependencyGraphService` (`packages/codebase/src/dependency-graph.ts`), constructed from `CodebaseRepository` + `CodeDependencyStore`. `dependenciesOf`/`dependentsOf` wrap the store's raw (any-resolution) edge queries, filter to `resolution === 'internal'`, and resolve `targetFileId`/`sourceFileId` back to `{fileId, relativePath}` via the same file-inventory map. `impactOf` is reverse BFS over `dependentsOf`, starting with the origin fileId pre-marked visited (this single mechanism both guarantees cycle termination and satisfies "exclude the starting node from its own impact set" — no separate self-exclusion check needed), collecting `{fileId, relativePath, depth}`, ordered by depth ascending then `relativePath` ascending, with an optional `maxDepth` cutoff.

## Explicitly Not Implemented in 3.3

Symbol table, function/class/interface graphs, AST semantic parsing, LSP, test-impact prediction, change-risk scoring, git history, `brain_context`/MCP integration, dependency-specific `brain_*` tools, workspace-package/tsconfig-alias resolution, `.json` resolution, any redundancy or learning change.

---

# Phase 3.4 Spec — Context Integration

Integrates 3.1/3.2/3.3's coding intelligence into `brain_context`, the one existing agent-facing pipeline (`retrieval -> ranking -> context compilation -> token budgeting`). The frozen 10-tool MCP surface does not grow; `brain_context`'s request shape does not change; its response gains two new, optional, additive fields. This is the last Phase 3 sub-milestone — no new `brain_*` tools, no symbol/AST intelligence, no learning.

## Part D — Pre-flight Findings

Read `BUILD_PLAN.md`, `ARCHITECTURE.md` §5/§6/§11/§12/§17, `ARCHITECTURE_REVIEW.md` (MCP-thinness boundary discussion), `DECISIONS.md`, this document's 3.1–3.3 sections. Then inspected shipped code directly, not assumed: `packages/core/contracts/src/{context.ts, retrieval.ts, events.ts, code-search.ts, code-dependency.ts, signals.ts}`, `packages/gateway/src/{gateway.ts, types.ts}`, `packages/mcp/src/{schemas.ts, server.ts, bootstrap.ts, boundaries.test.ts}`, `packages/core/context/src/compiler.ts`, `packages/core/token/src/optimize.ts`, `packages/core/ranking/src/{rank.ts, score.ts}`, `packages/core/retrieval/src/service.ts`, `packages/codebase/src/dependency-graph.ts`, `packages/storage/src/{db.ts, event-store.ts, codebase-repository.ts, code-search-store.ts}`, and every relevant `package.json` for the current DAG.

Three findings changed the design from what the mission brief anticipated as open questions:

1. **`ContextPackSchema`/`ContextItemSchema` are `.strict()` zod, but nothing calls `.parse()` on the *outbound* side.** `Gateway.getContext` constructs `{...contextPack, contextId}` as a plain object typed by TypeScript structural typing, and `packages/mcp/src/server.ts`'s `ok()` helper just `JSON.stringify`s whatever it is given — no runtime schema validation on the response. This means adding new sibling fields to `ContextDelivery` is safe: it never gets fed back through the strict schema, so there is no `.strict()`-rejects-unknown-keys landmine to design around. The `.strict()` schemas remain exactly what they always were — input-boundary validators (`CompileContextInputSchema.parse`, `RetrievalQuerySchema.parse`) — and stay untouched.
2. **Code search is scope-native, not repository-scoped.** `SqliteCodeSearchStore.scopeWhere()` filters by `scope_kind`/`scope_id` exactly like `SqliteRetrievalStore` does for memory; `filters.repositoryId` is an optional narrowing filter, never required. `codeRetrieval.getCandidates({text, scope})` alone already searches every repository registered under that scope (plus global-scope code, mirroring memory's global-visible-from-project rule). The "which registered `CodebaseRecord`(s) belong to this project" question the mission raised does not need a new lookup method for the retrieval path — scope isolation is already correct at the store layer. No `CodebaseRepository.listRepositories(scope)` method is added; it would have no caller. `CodebaseRecord.lastIndexedAt` freshness surfacing is correspondingly **out of scope for 3.4** — nothing in the acceptance criteria or test list requires it, and the mission's own phrasing ("preserve it as diagnostics *where useful*") is soft, not a hard requirement. Named explicitly here rather than silently dropped.
3. **A `CodingContextService` owned by `@brain/codebase` is DAG-incompatible, not just undesirable.** `@brain/codebase`'s `package.json` depends on `@brain/contracts` and `ignore` only (verified). `CodeRetrievalService` lives in `@brain/retrieval`. A codebase-owned service that "internally coordinates registered repositories, code retrieval, and dependency enrichment" would require `@brain/codebase -> @brain/retrieval`, which the mission explicitly forbids as a casual DAG change. Pre-flight resolves this to the mission's stated alternative: **Gateway orchestrates over abstract services already exported by `@brain/retrieval` and `@brain/codebase`**, matching invariant 6 exactly. `@brain/gateway`'s `package.json` gains one new dependency, `@brain/codebase` (a new DAG edge, no cycle: codebase still depends on nothing above contracts).

No architectural conflict found beyond what's resolved above. Proceeding.

## Heterogeneous Context Type

Late normalization, per the mission's own design rule: memory keeps `ContextItem` unchanged through `compileContext`; code keeps `CodeSearchResult` unchanged through retrieval and scoring; dependency facts keep `DependencyGraphService`'s native `DependencyRef`/`ImpactRef` shape through enrichment. Only inside the new selection step do all three convert to a minimal common wrapper for budget competition, then split back into typed arrays for the response. `ContextItem` itself gains no new fields and no discriminant — it is not touched.

Two new plain-interface types in `packages/core/contracts/src/context-source.ts` (not `.strict()` zod boundary schemas — like `IndexResult`/`CodeSyncResult`/`DependencySyncResult` before them, these are internal/output summary shapes, never a `.parse()` input boundary):

```ts
export interface CodeContextItem {
  sourceType: "code";
  chunkId: string;
  repositoryId: string;
  fileId: string;
  relativePath: string;
  language: string | null;
  startLine: number;
  endLine: number;
  content: string;        // formatted, "[CODE] path:start-end\n<code>" -- see Context Formatting
  score: number;
  rank: number;
  wasCompressed: boolean;
}

export const DEPENDENCY_RELATIONS = ["dependency", "dependent", "impact"] as const;
export type DependencyRelation = (typeof DEPENDENCY_RELATIONS)[number];

export interface DependencyContextItem {
  sourceType: "dependency";
  repositoryId: string;
  seedFileId: string;         // the selected code file this fact enriches
  seedRelativePath: string;
  relation: DependencyRelation;
  facts: { fileId: string; relativePath: string; depth: number | null }[]; // depth set only for relation="impact"
  content: string;            // formatted, one item per (seedFile, relation) group -- see Context Formatting
  rank: number;
  wasCompressed: boolean;
}
```

Dependency facts for the same seed file and relation are grouped into ONE `DependencyContextItem` (not one per related file) — this is the "adjacent items sharing header overhead" case the mission flags under Code Chunk Content, applied at generation time instead of as a post-hoc merge step, so no separate chunk-merging logic is needed. `DependencyContextItem` deliberately has no `score`: per the Ranking/Enrichment decision below, dependency facts are never independently ranked against memory or code — they are attached to already-selected code and inherit their position from it.

`ContextDelivery` (`packages/gateway/src/types.ts`) gains two new optional fields:

```ts
export type ContextDelivery = ContextPack & {
  contextId: string | null;
  codeItems?: CodeContextItem[];
  dependencyItems?: DependencyContextItem[];
};
```

Absent (not `[]`) when no coding capability is wired, or wired but nothing relevant was found — the response shape a memory-only caller sees today is unchanged.

## Backwards-Compatibility Decision

**Option B: backward-compatible additive fields.** No breaking change to `brain_context`'s request (`getContextShape` in `packages/mcp/src/schemas.ts` stays `task/scope/maxTokens/agentCapabilities/taskId`, unchanged) or to `items`' shape. `mcp/boundaries.test.ts`'s mechanical assertion (`toolCount === 10`, one `gateway.*` call per handler) needs no change — `brain_context`'s handler still calls `gateway.getContext(...)` exactly once. No STOP condition was reached: the existing schema represents Phase 3 context correctly through pure addition, verified by finding #1 above (no strict-schema landmine on the way out), not merely hoped.

One real behavioral (not schema) consequence, stated honestly: because memory and code now share one token budget, a project with indexed code may legitimately return *fewer* memory items than the same request would have returned before 3.4, if code items won some of the budget. This is the intended tradeoff (the mission's own example task wants exactly this blend) and does not violate compatibility — `items` remains correctly-typed and non-empty-when-memory-matches-exist; it is simply no longer computed in isolation from code.

## Package / DAG Changes

```
@brain/contracts        <- + context-source.ts (CodeContextItem, DependencyContextItem)
      ^
      |
@brain/core/context     <- + source normalization / heterogeneous selection (new file, see below)
@brain/core/token        <- + generalized budget-fill core, existing optimizeContext delegates to it unchanged
      ^
      |
@brain/gateway           <- + @brain/codebase dependency; optional codeRetrieval/dependencyGraph ctor params
      ^
      |
@brain/mcp (bootstrap.ts only) <- wires SqliteCodeSearchStore/SqliteCodeDependencyStore/SqliteCodebaseRepository
```

`@brain/core/context` and `@brain/core/token` gain no dependency on `@brain/codebase` or `@brain/retrieval` — the new selection code there only ever imports types from `@brain/contracts`, which they already depend on. Gateway is the only package that imports the concrete `CodeRetrievalService`/`DependencyGraphService` classes. No cycle: `codebase -> contracts` only; `retrieval -> contracts` only; `gateway -> {contracts, memory, retrieval, ranking, context, token, learning, codebase}`, all one-directional, matching the existing shape exactly, just one wider.

## Memory Source

Unchanged. `retrieval.getCandidates` -> `rank()` -> `compileContext()` runs exactly as it does today, producing `CompiledContext.items: ContextItem[]`. This path has zero new code and is covered by the existing 638 tests remaining green.

## Code Source

New `CodeRetrievalService.getCandidates({text: task, scope}, limit: DEFAULT_CODE_CANDIDATE_LIMIT)` call in Gateway (only when `codeRetrieval` was injected), bounded at `DEFAULT_CODE_CANDIDATE_LIMIT = 20` (code chunks run larger than memory items; a smaller pool than memory's 50 is deliberate, characterized against real corpus size in the evaluation section, not asserted). Each `CodeSearchResult` is scored via the existing, unmodified `computeScore(signals, DEFAULT_RANKING_WEIGHTS)` (proven reusable on code signals since 3.2) and sorted score-descending, `chunkId` ascending as the final deterministic tie-break (mirrors `rank()`'s own tie-break shape, without memory's confidence field, which code has no honest value for). No new ranking module: this is an inline sort using an existing primitive, not a second ranking system.

## Dependency Enrichment

Enrichment, not an independent corpus, per the mission's own framing — computed only for code files that already won a slot in the (memory+code) selection below, never for the full candidate pool. Bounded policy, chosen against this repository's actual measured graph size (3.3: 150 eligible files, 647 edges, ~4.3 edges/file average):

```
maxDependencySeedFiles      = 3   -- only the top 3 SELECTED code files get enrichment
maxDirectDependenciesPerFile = 5
maxDirectDependentsPerFile   = 3
maxImpactDepth               = 1  -- shallow by design; see rationale below
maxImpactItems                = 5
```

`maxImpactDepth = 1` (not the mission's illustrative 2) is a deliberate, conservative starting point: the mission is explicit that dependency information may turn out to be mostly redundant with the code already shown (`DEPENDENCY VALUE AUDIT`), and `impactOf` at depth 2 on a graph this size can plausibly return double-digit items for a single seed file. Starting shallow and *measuring* whether depth 2 would have added real value (recorded, not silently discarded) is cheaper to correct later than starting wide and over-spending tokens now. All five numbers are `DependencyExpansionPolicy`, an injectable plain object with these as defaults — never hardcoded where the caller might reasonably need to override them (evaluation harness included).

For the top `maxDependencySeedFiles` code items **by position in the tier-1 score-ordered sequence** (before budget fill runs, not after — see Mixed-Source Prioritization for why this ordering matters): `dependencyGraph.dependenciesOf`, `.dependentsOf`, and `.impactOf(..., {maxDepth: 1})` (capped, sliced) become up to three `DependencyContextItem`s (one per relation present), inserted into the sequence immediately after their seed code item.

## Source Score Calibration

Hypothesis, grounded in reading the actual scoring code (not assumed): memory's `RankedResult.score` and code's per-item `computeScore` output are both produced by the *same* pipeline — per-query `normalizeScores` bounding raw lexical/semantic signals to `[0,1]` at the store layer, then an identical weighted sum whose weights sum to 1 (`score.test.ts`: "default weights sum to 1"). Both scores should therefore already live on comparable `[0, ~1]` scales, unlike a naive cross-system score comparison.

This is characterized empirically, not assumed into production: a new test (`source-calibration.test.ts`, see Formal Evaluation) runs representative coding-task queries against both a memory fixture and a code fixture built from the *same* underlying content pool, and reports the real score distributions side by side. If the distributions are close enough that raw-score interleaving does not systematically starve one source, direct score-descending interleaving (Option A) is used, *with* the starvation safety net below as a correction, not a replacement. If characterization instead shows a systematic skew, the fallback is per-source rank normalization before interleaving (Option A variant: sort each source's own list, then interleave by normalized rank position rather than raw score) — decided from the actual measurement, recorded in the implementation report, not pre-committed here.

## Mixed-Source Prioritization

Two-tier selection, implemented as a new pure function `selectSources(memoryItems, codeItems, dependencyItemsBySeed, policy): ContextSourceWrapper[]` in `packages/core/context/src/source-selection.ts`:

**Tier 1 — memory and code compete by score.** All `ContextItem`s and `CodeContextItem`s are wrapped (`{sourceType, rank: <placeholder>, content, wasCompressed: false}`) and sorted by their calibrated score (see above), producing one merged, score-ordered sequence.

**Starvation safety net.** After the score-sort, if one source (memory or code) has ≥1 candidate but zero items would survive an unbounded budget fill in the top slice while the other source has ≥2, the higher of that starved source's items is promoted ahead of the weakest already-ordered item from the dominant source. This is a correction applied only when a source with real candidates would otherwise get zero representation purely from scale mismatch — never a hardcoded quota (no forced "50/40/10" split), and never promotes an irrelevant item merely to fill a slot: a source with zero candidates gets zero items, always.

**Tier 2 — dependency items attach to their seed, not the global ranking.** Tier 1 does not drop anything, only orders — it produces one merged sequence covering every memory and code candidate. The code items in the first `maxDependencySeedFiles` positions of that sequence each get their (already-computed) `DependencyContextItem`s spliced in immediately after them. `rank` is then assigned sequentially over the resulting combined array (1..N), and *that* full array — memory, code, and spliced dependency items together — is what `fillBudget` (Token-Budget Integration, below) actually runs over; budget survival is decided once, in that single pass, never before it. This is what "attached enrichment, not independently ranked" means concretely: a dependency item's position in the queue is a function of its seed's tier-1 position, never of a score it doesn't have — but whether it actually survives the budget is decided by the same greedy pass as everything else.

**Determinism.** Every input to this function is already deterministically ordered (score, then a stable id tie-break); the function performs no I/O, no randomness, no wall-clock reads — same inputs always produce the same output array, independently testable with plain fixtures (test scenarios 11, 12, 20).

## Starvation Safety

Covered above; the concrete guarantee under test: a task with real memory matches AND real code matches never returns all-memory or all-code purely because of score-scale mismatch — but a task with zero code matches returns zero code items (never padding with irrelevant chunks to satisfy a quota), and symmetrically for memory.

## Context Formatting

Compact, matching the mission's own illustrative shape, no decorative wrapping:

```
[CODE] packages/gateway/src/gateway.ts:120-174
<raw chunk content, unmodified>
```

```
[DEPENDENCY] packages/gateway/src/gateway.ts directly imports:
- packages/core/retrieval/src/service.ts
- packages/core/ranking/src/rank.ts
```

```
[DEPENDENCY] packages/storage/src/db.ts is directly imported by:
- packages/storage/src/index.ts
```

```
[POTENTIAL IMPACT] packages/storage/src/db.ts transitively depends on this file at depth 1:
- packages/mcp/src/bootstrap.ts
```

Epistemic language preserved exactly per 3.3's own boundary: "directly imports" / "is directly imported by" / "transitively depends on this file at depth N", never "will break". Formatted text counts toward that item's token cost like any other content (token test 27) — no separate, untracked formatting budget.

## Token-Budget Integration

`packages/core/token/src/optimize.ts`'s two-pass fill (natural-fit pass, then compress-into-leftover pass, in array order, re-sorted to rank order at the end) is extracted into a generic core `fillBudget<T extends { content: string; rank: number; wasCompressed: boolean }>(items: T[], budget, estimate, compressFn)`. The existing `optimizeContext(compiledContext, budget, ...)` becomes a two-line wrapper calling `fillBudget` over `ContextItem[]` — its exported signature, behavior, and every existing test are unchanged (verified by the full regression, not just by inspection). A new `optimizeSources(sourceItems, budget, ...)` calls the *same* `fillBudget` over the tier-1+tier-2 wrapped array from `selectSources`. One algorithm, two thin typed callers — this is what makes "one context compiler, one budget path" concretely true rather than asserted: there is exactly one place budget arithmetic happens.

Gateway then splits `fillBudget`'s output back into `items` (unwrap `sourceType==="memory"`, drop the wrapper, back to plain `ContextItem[]` — byte-identical shape to today), `codeItems`, and `dependencyItems`, and computes one `tokenCount`/`truncated`/`omittedCount` over the *entire* combined set — never three independent sums that could exceed `maxTokens` together.

## Telemetry Design

`context_events`/`context_event_memories` are untouched — zero regression risk to existing feedback/outcome correlation, exactly matching how 3.2/3.3 never touched `code_embedding_state`/`code_dependency_state`'s siblings. New migration `packages/storage/migrations/0006_context_sources.sql`:

```sql
CREATE TABLE IF NOT EXISTS context_event_sources (
  context_event_id TEXT NOT NULL REFERENCES context_events(id) ON DELETE CASCADE,
  source_type       TEXT NOT NULL CHECK (source_type IN ('code','dependency')),
  source_id         TEXT NOT NULL,   -- chunkId for code rows; "{seedFileId}:{fileId}:{relation}" for dependency rows
  repository_id     TEXT NOT NULL,
  file_id           TEXT NOT NULL,
  relative_path     TEXT NOT NULL,
  relation          TEXT,             -- null for code rows; dependency|dependent|impact for dependency rows
  depth             INTEGER,          -- null unless relation = 'impact'
  included          INTEGER NOT NULL CHECK (included IN (0,1)),
  rank              INTEGER,
  token_count       INTEGER,
  PRIMARY KEY (context_event_id, source_type, source_id)
);
CREATE INDEX IF NOT EXISTS idx_context_event_sources_event ON context_event_sources(context_event_id);
```

FK cascades on `context_event_id` deliberately (unlike `code_embedding_state`/`code_dependency_state`'s intentionally-FK-less design): there is no later sync that needs to detect an orphaned source row the way dependency re-resolution needs to detect a deleted target file — a `context_event_sources` row is meaningless once its parent `context_events` row is gone, so cascading is correct here, not an oversight.

`EventStore` gains one new method, `recordContextSources(contextEventId, sources: ContextEventSource[]): Promise<void>`, called by Gateway right after `recordContext` succeeds, in the same spirit as (though not the same transaction as, since it depends on the just-minted `contextEventId`) `recordContext`'s own membership-row write. A write failure here degrades the same way telemetry already does elsewhere in `getContext` (logged, `contextId` still returned) — never fails the request.

Mirrors `context_event_memories`' own convention: one row per candidate the source contributed (both `included: true` and `included: false`), so future Phase 4 work can distinguish "code was found but not selected" from "code was never found" — the same distinction `ARCHITECTURE.md` §17 already requires for memory. For a grouped `DependencyContextItem`, this means one `context_event_sources` row per entry in its `.facts[]` array, not one row for the group — individual facts aren't independently token-costed (the group is priced as one item), so each fact's row carries the *group's* `token_count` rather than a fabricated per-fact split; `rank`/`included` are the group's values, repeated per fact. This is a documented simplification, not a precision claim beyond what the data actually supports.

## Feedback Semantics

Unchanged, deliberately. `brain_feedback`'s schema (`feedbackShape` in `mcp/schemas.ts`) still validates against `FeedbackEventSchema`, `memoryId: uuid` — a chunk id (sha256 hex) or a dependency fact simply cannot be passed to it, and nothing in 3.4 tries to make that work. Code/dependency delivery is recorded via `context_event_sources` (telemetry) but is not feedback-able this phase. This is a real, disclosed scope boundary, not an oversight: the mission explicitly rules out expanding the frozen `brain_feedback` schema without separate architectural review, and 3.4 does not need adaptive code feedback to be complete.

## Outcome Correlation

Unchanged. `brain_record_outcome` still correlates by `contextId` alone (`Gateway.requireKnownContext`), which already resolves to the *complete* mixed delivery via `getContextEvent` regardless of how many source types it contained — an outcome recorded against a mixed-context `contextId` is exactly as valid as one recorded against a memory-only one today, with no new code needed to make that true.

## Failure Degradation

Every scenario resolves to "the request that would have worked before 3.4 still works," implemented as `codeRetrieval`/`dependencyGraph` being **optional constructor parameters** (graceful degradation by construction, matching `RetrievalService`'s existing `Promise.allSettled` degradation shape for semantic-search failure, not a try/catch bolted onto an otherwise-required call):

| Scenario | Behavior |
|---|---|
| `codeRetrieval` not injected | Identical to pre-3.4: memory-only, no `codeItems`/`dependencyItems` keys at all |
| Code search throws (store failure) | Caught at the Gateway orchestration point, logged, `codeItems` omitted; memory context unaffected |
| Semantic code search unavailable | `CodeRetrievalService` already degrades to lexical-only internally (3.2); nothing new needed |
| `dependencyGraph` not injected, or throws | `dependencyItems` omitted; memory + code context still returned |
| No repository registered for scope | Code search returns `[]` naturally (no special-case needed — scope-native search over an empty corpus is just empty); memory-only response |
| No relevant code for this task | Code returns candidates but none survive tier-1 selection at a meaningful score — no padding, `codeItems` omitted or empty |
| No memory matches | `items: []`, `codeItems` still populated when relevant code exists — `items: []` is already a valid, existing response shape (a memory-only miss returns it today), so this adds no new caller-facing case to handle |

## Project / Repository Resolution

Covered under Pre-flight Finding 2: no new lookup needed. Scope flows through to `codeRetrieval`/`dependencyGraph` exactly as it already flows to memory retrieval.

## Gateway Composition

```
bootstrap.ts
  |  instantiate SqliteCodebaseRepository, SqliteCodeSearchStore, SqliteCodeDependencyStore
  v
new CodeRetrievalService(codeSearchStore)         -- @brain/retrieval, already exists (3.2)
new DependencyGraphService(codebaseRepo, depStore) -- @brain/codebase, already exists (3.3)
  v
new Gateway(memory, retrieval, events, capabilities, redundancyConfig, codeRetrieval, dependencyGraph)
```

No SQL, search, or graph logic enters `bootstrap.ts` beyond construction calls — identical discipline to how it already wires `SqliteRetrievalStore`/`SqliteMemoryRepository` today. `boundaries.test.ts`'s "only bootstrap.ts imports storage / only bootstrap.ts imports core service packages" checks need no change to their logic, only their forbidden-import list gains no new exception (Gateway already gets a free pass as the non-forbidden target; `@brain/codebase` was never in the forbidden list to begin with, verified).

## MCP Compatibility

`getContextShape` unchanged. `registerBrainTools` unchanged (still exactly 10 `server.registerTool` calls, still one `gateway.*` call per handler — mechanically re-verified by the existing `boundaries.test.ts`, not just by inspection). No new tool. The tool description string may gain one clause noting that code/dependency context can be included when available — documentation only, not a schema change.

## Explicitly Not Implemented in 3.4

Adaptive/learned score calibration, per-agent budgets, code feedback, symbol-level enrichment, call graphs, cross-package (`@brain/*` workspace) dependency resolution (still `external`, per 3.3), automatic repository indexing inside `brain_context`, index-freshness blocking, a `CodingContextService` package, any new `brain_*` tool, any redundancy or learning behavior change.
