-- Phase 3.1: Repository Foundation. Registered repositories, their discovered
-- files, and deterministic line-window chunks -- a retrieval SOURCE, not memories
-- (ARCHITECTURE.md 18: "the codebase index is a knowledge source, it is not
-- identical to memory"). Nothing here is written into the `memories` table.
--
-- Same scope_kind/scope_id CHECK shape as `memories` (0001) -- no new scope concept.
-- file_id/chunk id are deterministic sha256 hex (packages/codebase/src/hash.ts),
-- derived from (repositoryId, relativePath[, chunkIndex]) only -- never from
-- rootPath or any absolute, machine-specific path, so a moved repository re-indexes
-- to the same identities. This is also why re-indexing an unchanged file is a
-- natural upsert rather than a separate insert/update branch.

CREATE TABLE IF NOT EXISTS repositories (
  id              TEXT PRIMARY KEY,
  scope_kind      TEXT NOT NULL CHECK (scope_kind IN ('global','project','session')),
  scope_id        TEXT NULL,
  root_path       TEXT NOT NULL,
  created_at      TEXT NOT NULL,
  updated_at      TEXT NOT NULL,
  last_indexed_at TEXT NULL,
  CHECK (
    (scope_kind = 'global' AND scope_id IS NULL) OR
    (scope_kind != 'global' AND scope_id IS NOT NULL)
  )
);

-- One registration per (scope, rootPath): re-registering the same root finds the
-- existing row (findRepository) rather than ever needing this constraint to fire,
-- but it is the actual, DB-enforced guarantee, not just an application-code habit.
CREATE UNIQUE INDEX IF NOT EXISTS idx_repositories_scope_root
  ON repositories(scope_kind, scope_id, root_path);

CREATE TABLE IF NOT EXISTS code_files (
  id             TEXT PRIMARY KEY,
  repository_id  TEXT NOT NULL REFERENCES repositories(id) ON DELETE CASCADE,
  scope_kind     TEXT NOT NULL CHECK (scope_kind IN ('global','project','session')),
  scope_id       TEXT NULL,
  relative_path  TEXT NOT NULL,
  language       TEXT NULL,
  size_bytes     INTEGER NOT NULL CHECK (size_bytes >= 0),
  content_hash   TEXT NOT NULL,
  indexed_at     TEXT NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_code_files_repo_path ON code_files(repository_id, relative_path);
CREATE INDEX IF NOT EXISTS idx_code_files_repo ON code_files(repository_id);

-- ON DELETE CASCADE from both file_id and repository_id: removeFile() deletes a
-- code_files row and relies on the file_id cascade; a whole repository going away
-- (not exposed via any operation yet, but the FK shape should not forbid it later)
-- relies on the repository_id cascade independently reaching chunks too.
CREATE TABLE IF NOT EXISTS code_chunks (
  id             TEXT PRIMARY KEY,
  file_id        TEXT NOT NULL REFERENCES code_files(id) ON DELETE CASCADE,
  repository_id  TEXT NOT NULL REFERENCES repositories(id) ON DELETE CASCADE,
  scope_kind     TEXT NOT NULL CHECK (scope_kind IN ('global','project','session')),
  scope_id       TEXT NULL,
  relative_path  TEXT NOT NULL,
  chunk_index    INTEGER NOT NULL CHECK (chunk_index >= 0),
  start_line     INTEGER NOT NULL CHECK (start_line > 0),
  end_line       INTEGER NOT NULL CHECK (end_line >= start_line),
  content        TEXT NOT NULL,
  content_hash   TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_code_chunks_file ON code_chunks(file_id, chunk_index);
CREATE INDEX IF NOT EXISTS idx_code_chunks_repo ON code_chunks(repository_id);

-- dependency_edges is explicitly deferred to Phase 3.3 (PHASE_3_SPEC.md) -- not
-- created here.
