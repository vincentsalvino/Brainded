-- Phase 2B: correlation + measurement (P2-004). Additive and reversible: no table
-- is dropped, no column removed, no row rewritten. Rolling back means dropping
-- context_event_memories and deleting this file's ledger row -- the added columns
-- are all nullable and inert to Phase 1/2A code paths.
--
-- Deliberately NOT in this migration: memory_usefulness_stats. Learning is on hold
-- (decision E14, held); Phase 2B builds measurement only.
--
-- NOTE for future migrations: unlike 0001, this file is NOT self-idempotent --
-- SQLite's ALTER TABLE ADD COLUMN has no IF NOT EXISTS. Safety comes from the
-- schema_migrations ledger (db.ts), which is why that ledger had to land in the
-- same change.

-- P2-006: the normalized context-event <-> memory relation.
--
-- Replaces context_events' two JSON TEXT arrays as the ANALYTICAL shape. Those
-- arrays are unindexable and unjoinable, so "how many contexts included memory X"
-- was a full scan plus a JSON parse per row, and per-item delivered token cost had
-- nowhere to live at all. Both forms are written together for one migration cycle;
-- assertContextMembershipConsistent (@brain/contracts) is what keeps them equal.
--
-- included: 1 = delivered to the agent in this pack, 0 = candidate that was not.
-- rank:     1-based position in the delivered pack; NULL for omitted candidates.
-- token_count: DELIVERED token cost, measured over the content actually sent (so a
--              compressed item reports its compressed size). NULL for omitted
--              candidates -- nothing was delivered, so there is no delivered cost.
--              Candidate-pool cost lives on context_events.candidate_token_count.
--
-- ON DELETE CASCADE on both sides for the same reason feedback_events has it:
-- purge() is a genuine hard delete, and an orphaned junction row would block it.
CREATE TABLE IF NOT EXISTS context_event_memories (
  context_event_id TEXT    NOT NULL REFERENCES context_events(id) ON DELETE CASCADE,
  memory_id        TEXT    NOT NULL REFERENCES memories(id)       ON DELETE CASCADE,
  included         INTEGER NOT NULL CHECK (included IN (0, 1)),
  rank             INTEGER NULL CHECK (rank IS NULL OR rank > 0),
  token_count      INTEGER NULL CHECK (token_count IS NULL OR token_count >= 0),
  PRIMARY KEY (context_event_id, memory_id)
);

-- "which contexts included this memory" -- the query the JSON arrays could not
-- answer without scanning everything.
CREATE INDEX IF NOT EXISTS idx_cem_memory ON context_event_memories(memory_id, included);
CREATE INDEX IF NOT EXISTS idx_cem_context ON context_event_memories(context_event_id);

-- P2-015 observability. All nullable: a measurement failure degrades to
-- "not recorded", never to a failed request. Existing rows stay valid as NULL,
-- which honestly means "recorded before measurement existed".
ALTER TABLE context_events ADD COLUMN candidate_count       INTEGER NULL;
ALTER TABLE context_events ADD COLUMN candidate_token_count INTEGER NULL;
ALTER TABLE context_events ADD COLUMN retrieval_ms          INTEGER NULL;
ALTER TABLE context_events ADD COLUMN ranking_ms            INTEGER NULL;
ALTER TABLE context_events ADD COLUMN compile_ms            INTEGER NULL;
ALTER TABLE context_events ADD COLUMN optimize_ms           INTEGER NULL;

-- P2-005: correlation. contextId is the precise delivery identifier the Brain
-- mints and can verify; task_id stays as the broader logical-task identifier and
-- is unchanged. Both remain optional.
ALTER TABLE feedback_events ADD COLUMN context_id TEXT NULL REFERENCES context_events(id);
ALTER TABLE outcome_events  ADD COLUMN context_id TEXT NULL REFERENCES context_events(id);

-- Why the memory was or was not useful. Recorded now, acted on later: the
-- distinction between "redundant here" and "wrong" is unrecoverable from free-text
-- notes after the fact.
ALTER TABLE feedback_events ADD COLUMN reason TEXT NULL
  CHECK (reason IS NULL OR reason IN ('redundant', 'irrelevant', 'incorrect', 'other'));

CREATE INDEX IF NOT EXISTS idx_feedback_events_context ON feedback_events(context_id);
CREATE INDEX IF NOT EXISTS idx_outcome_events_context ON outcome_events(context_id);
