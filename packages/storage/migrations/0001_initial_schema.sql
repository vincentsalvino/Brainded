-- Phase 1 initial schema. Single source of truth for the storage layer -- see
-- PHASE_1_SPEC.md Storage Boundary ("a single source of truth... fixing AEOS's
-- two-independently-maintained-paths defect", AUDIT_AEOS.md 9).
--
-- Single `memories` table with a `type` discriminator (decision D2), not per-type
-- tables. scope_kind/scope_id are the access-isolation boundary; `domain` is a
-- separate, non-enforced content-category tag (ARCHITECTURE.md 8) -- see the CHECK
-- constraints below for how each is validated independently.

CREATE TABLE IF NOT EXISTS memories (
  id            TEXT PRIMARY KEY,
  type          TEXT NOT NULL CHECK (type IN (
                  'fact','decision','pattern','rule','procedure','experience',
                  'error','constraint','project_state','task_state',
                  'agent_experience','preference'
                )),
  content       TEXT NOT NULL CHECK (length(content) > 0),
  domain        TEXT NULL,
  scope_kind    TEXT NOT NULL CHECK (scope_kind IN ('global','project','session')),
  scope_id      TEXT NULL,
  source_origin      TEXT NOT NULL CHECK (source_origin IN ('agent','system','import','derived')),
  source_agent_id     TEXT NULL,
  source_session_id   TEXT NULL,
  source_task_id      TEXT NULL,
  source_ref          TEXT NULL,
  confidence    REAL NOT NULL CHECK (confidence >= 0 AND confidence <= 1),
  status        TEXT NOT NULL CHECK (status IN ('active','archived')),
  tags          TEXT NOT NULL DEFAULT '[]',
  supersedes    TEXT NULL REFERENCES memories(id),
  created_at    TEXT NOT NULL,
  updated_at    TEXT NOT NULL,
  CHECK (
    (scope_kind = 'global' AND scope_id IS NULL) OR
    (scope_kind != 'global' AND scope_id IS NOT NULL)
  )
);

CREATE INDEX IF NOT EXISTS idx_memories_scope ON memories(scope_kind, scope_id);
CREATE INDEX IF NOT EXISTS idx_memories_type ON memories(type);
CREATE INDEX IF NOT EXISTS idx_memories_status ON memories(status);

-- FTS5 keyword index over content, kept in sync via triggers (AEOS's proven
-- pattern, AUDIT_AEOS.md 12). content_rowid links to `memories`' implicit
-- INTEGER rowid even though the declared primary key is a TEXT uuid.
CREATE VIRTUAL TABLE IF NOT EXISTS memories_fts USING fts5(
  content,
  content='memories',
  content_rowid='rowid'
);

CREATE TRIGGER IF NOT EXISTS memories_fts_insert AFTER INSERT ON memories BEGIN
  INSERT INTO memories_fts(rowid, content) VALUES (new.rowid, new.content);
END;

CREATE TRIGGER IF NOT EXISTS memories_fts_update AFTER UPDATE ON memories BEGIN
  INSERT INTO memories_fts(memories_fts, rowid, content) VALUES ('delete', old.rowid, old.content);
  INSERT INTO memories_fts(rowid, content) VALUES (new.rowid, new.content);
END;

CREATE TRIGGER IF NOT EXISTS memories_fts_delete AFTER DELETE ON memories BEGIN
  INSERT INTO memories_fts(memories_fts, rowid, content) VALUES ('delete', old.rowid, old.content);
END;

-- Vector index (sqlite-vec) is created separately at runtime in db.ts, not here:
-- vec0 virtual tables require the sqlite-vec extension to already be loaded before
-- their DDL can run, which migrations (plain SQL) cannot guarantee on their own.

-- Event provenance tables (PHASE_1_SPEC.md Learning/Outcome Telemetry). Five event
-- types, one table each, append-only.

CREATE TABLE IF NOT EXISTS retrieval_events (
  id            TEXT PRIMARY KEY,
  timestamp     TEXT NOT NULL,
  scope_kind    TEXT NOT NULL CHECK (scope_kind IN ('global','project','session')),
  scope_id      TEXT NULL,
  query_text    TEXT NOT NULL,
  candidate_ids TEXT NOT NULL,
  task_id       TEXT NULL
);
CREATE INDEX IF NOT EXISTS idx_retrieval_events_task ON retrieval_events(task_id);

CREATE TABLE IF NOT EXISTS context_events (
  id                  TEXT PRIMARY KEY,
  timestamp           TEXT NOT NULL,
  retrieval_event_id  TEXT NOT NULL REFERENCES retrieval_events(id),
  scope_kind          TEXT NOT NULL CHECK (scope_kind IN ('global','project','session')),
  scope_id            TEXT NULL,
  task_id             TEXT NULL,
  included_memory_ids TEXT NOT NULL,
  omitted_memory_ids  TEXT NOT NULL,
  token_count         INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_context_events_task ON context_events(task_id);
CREATE INDEX IF NOT EXISTS idx_context_events_retrieval ON context_events(retrieval_event_id);

CREATE TABLE IF NOT EXISTS outcome_events (
  id          TEXT PRIMARY KEY,
  timestamp   TEXT NOT NULL,
  task_id     TEXT NOT NULL,
  session_id  TEXT NULL,
  outcome     TEXT NOT NULL CHECK (outcome IN ('success','failure','partial','unknown')),
  signal      TEXT NULL,
  notes       TEXT NULL
);
CREATE INDEX IF NOT EXISTS idx_outcome_events_task ON outcome_events(task_id);

-- ON DELETE CASCADE: purge() is a genuine hard delete (unlike archive(), which
-- keeps full history) -- "purge everything about this memory" includes its
-- feedback/mutation trail, not just the row. Without this, deleting a memory with
-- any recorded event orphans a foreign-key reference and the DELETE is rejected.
CREATE TABLE IF NOT EXISTS feedback_events (
  id          TEXT PRIMARY KEY,
  timestamp   TEXT NOT NULL,
  memory_id   TEXT NOT NULL REFERENCES memories(id) ON DELETE CASCADE,
  task_id     TEXT NULL,
  useful      INTEGER NULL CHECK (useful IN (0, 1)),
  notes       TEXT NULL
);
CREATE INDEX IF NOT EXISTS idx_feedback_events_memory ON feedback_events(memory_id);

CREATE TABLE IF NOT EXISTS memory_mutation_events (
  id                TEXT PRIMARY KEY,
  timestamp         TEXT NOT NULL,
  memory_id         TEXT NOT NULL REFERENCES memories(id) ON DELETE CASCADE,
  mutation_type     TEXT NOT NULL CHECK (mutation_type IN ('create','update','archive')),
  actor_origin      TEXT NOT NULL CHECK (actor_origin IN ('agent','system','import','derived')),
  actor_agent_id    TEXT NULL,
  actor_session_id  TEXT NULL,
  actor_task_id     TEXT NULL,
  summary           TEXT NULL
);
CREATE INDEX IF NOT EXISTS idx_memory_mutation_events_memory ON memory_mutation_events(memory_id);
