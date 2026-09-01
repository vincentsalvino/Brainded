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
