-- Phase 3.3: Dependency Intelligence. File-level static import graph over the
-- repositories 3.1 indexes. See docs/phase-3/PHASE_3_SPEC.md Phase 3.3 Spec for the full
-- design. Does not modify 0003/0004.
--
-- source_file_id/target_file_id carry NO foreign key to code_files(id), and
-- code_dependency_state.file_id carries none either -- deliberately, same reason
-- 0004's code_embedding_state.chunk_id has none: a row must be able to outlive its
-- code_files row long enough for the NEXT dependency sync to notice the file is
-- gone and clean up (see DependencySynchronizer's re-resolve pass). A cascading FK
-- would delete the evidence before any sync ever saw it change.

CREATE TABLE IF NOT EXISTS code_dependency_edges (
  id              TEXT PRIMARY KEY,
  repository_id   TEXT NOT NULL REFERENCES repositories(id) ON DELETE CASCADE,
  scope_kind      TEXT NOT NULL CHECK (scope_kind IN ('global','project','session')),
  scope_id        TEXT NULL,
  source_file_id  TEXT NOT NULL,
  target_file_id  TEXT NULL,
  specifier       TEXT NOT NULL,
  kind            TEXT NOT NULL CHECK (kind IN ('static_import','dynamic_import','require','re_export')),
  resolution      TEXT NOT NULL CHECK (resolution IN ('internal','external','unresolved')),
  source_line     INTEGER NULL CHECK (source_line IS NULL OR source_line > 0),
  created_at      TEXT NOT NULL,
  CHECK (
    (scope_kind = 'global' AND scope_id IS NULL) OR
    (scope_kind != 'global' AND scope_id IS NOT NULL)
  ),
  CHECK (
    (resolution = 'internal' AND target_file_id IS NOT NULL) OR
    (resolution != 'internal' AND target_file_id IS NULL)
  )
);

-- The two demonstrated access paths (dependenciesOf / dependentsOf). No further
-- index added without a query/test that needs one.
CREATE INDEX IF NOT EXISTS idx_cde_repo_source ON code_dependency_edges(repository_id, source_file_id);
CREATE INDEX IF NOT EXISTS idx_cde_repo_target ON code_dependency_edges(repository_id, target_file_id);

-- Tracks which content_hash a file's outgoing edges were last extracted from, so
-- DependencySynchronizer's parse phase can skip unchanged files entirely (zero
-- disk reads, zero regex). A file with genuinely zero imports still needs a row
-- here -- absence of edges is otherwise indistinguishable from "never processed".
CREATE TABLE IF NOT EXISTS code_dependency_state (
  file_id        TEXT PRIMARY KEY,
  repository_id  TEXT NOT NULL REFERENCES repositories(id) ON DELETE CASCADE,
  content_hash   TEXT NOT NULL,
  indexed_at     TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_cds_repo ON code_dependency_state(repository_id);
