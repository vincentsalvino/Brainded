-- Phase 3.2: Code Retrieval. Makes 3.1's persisted code_chunks lexical- and
-- semantic-searchable. See docs/phase-3/PHASE_3_SPEC.md Phase 3.2 Spec for the full design.
--
-- code_chunks_fts mirrors memories_fts (0001) exactly: external-content FTS5 kept
-- in sync via triggers. replaceFile's delete-then-insert of a file's chunks (3.1,
-- SqliteCodebaseRepository) fires these triggers inside the same transaction --
-- no new write path required.

CREATE VIRTUAL TABLE IF NOT EXISTS code_chunks_fts USING fts5(
  content,
  content='code_chunks',
  content_rowid='rowid'
);

CREATE TRIGGER IF NOT EXISTS code_chunks_fts_insert AFTER INSERT ON code_chunks BEGIN
  INSERT INTO code_chunks_fts(rowid, content) VALUES (new.rowid, new.content);
END;

CREATE TRIGGER IF NOT EXISTS code_chunks_fts_update AFTER UPDATE ON code_chunks BEGIN
  INSERT INTO code_chunks_fts(code_chunks_fts, rowid, content) VALUES ('delete', old.rowid, old.content);
  INSERT INTO code_chunks_fts(rowid, content) VALUES (new.rowid, new.content);
END;

CREATE TRIGGER IF NOT EXISTS code_chunks_fts_delete AFTER DELETE ON code_chunks BEGIN
  INSERT INTO code_chunks_fts(code_chunks_fts, rowid, content) VALUES ('delete', old.rowid, old.content);
END;

-- Vector index (sqlite-vec, code_chunk_vectors) is created separately at runtime in
-- db.ts, not here -- same reason memory_vectors isn't in 0001: vec0 virtual tables
-- require the extension already loaded, which migrations cannot guarantee.

-- Tracks which content_hash was last embedded per chunk, so syncEmbeddings() can
-- skip unchanged chunks and detect removed ones. Deliberately NO foreign key on
-- chunk_id: a tracking row must be able to outlive its code_chunks row (which 3.1's
-- replaceFile/removeFile may already have deleted by the time sync runs next) so
-- that sync can still notice "existed before, gone now" and remove the orphaned
-- code_chunk_vectors row. A hard FK here would either block that delete (RESTRICT)
-- or cascade the tracking row away before sync ever sees it (CASCADE) -- both wrong.
CREATE TABLE IF NOT EXISTS code_embedding_state (
  chunk_id      TEXT PRIMARY KEY,
  repository_id TEXT NOT NULL REFERENCES repositories(id) ON DELETE CASCADE,
  content_hash  TEXT NOT NULL,
  embedded_at   TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_code_embedding_state_repo ON code_embedding_state(repository_id);
