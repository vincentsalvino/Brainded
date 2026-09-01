-- Phase 3.4. Additive code/dependency delivery telemetry. context_events and
-- context_event_memories are untouched -- see PHASE_3_SPEC.md Phase 3.4,
-- Telemetry Design for why this is a new table, not a modification of those.

CREATE TABLE IF NOT EXISTS context_event_sources (
  context_event_id TEXT NOT NULL REFERENCES context_events(id) ON DELETE CASCADE,
  source_type       TEXT NOT NULL CHECK (source_type IN ('code','dependency')),
  source_id         TEXT NOT NULL,
  repository_id     TEXT NOT NULL,
  file_id           TEXT NOT NULL,
  relative_path     TEXT NOT NULL,
  relation          TEXT,
  depth             INTEGER,
  included          INTEGER NOT NULL CHECK (included IN (0,1)),
  rank              INTEGER,
  token_count       INTEGER,
  PRIMARY KEY (context_event_id, source_type, source_id)
);

CREATE INDEX IF NOT EXISTS idx_context_event_sources_event ON context_event_sources(context_event_id);
