-- Phase 4.1. Materialized, rebuildable projection over feedback_events/outcome_events
-- (PHASE_4_DECISIONS.md F3/F11, PHASE_4_SPEC.md 3). Raw counts only -- usefulnessSignal/
-- evidenceMass are derived on read (packages/core/learning, Phase 4.2), never stored, so a
-- formula or K/outcomeWeight change never requires a migration or a data rebuild.
--
-- scope_key is '*' (global) only in Phase 4.1/4.2 (F8) -- present so a project-specific bucket
-- can be added later with no migration, not populated yet.
--
-- diluted_success_evidence/diluted_failure_evidence are stored UNWEIGHTED (1/includedMemoryIds
-- per eligible outcome, PHASE_2_DECISIONS.md E12) -- config.outcomeWeight is applied only when
-- computeUsefulnessSignal reads this row, in Phase 4.2, never here.
--
-- ON DELETE CASCADE: same convention as feedback_events/context_event_memories -- purge() is a
-- genuine hard delete and must remove a memory's performance row along with everything else.

CREATE TABLE IF NOT EXISTS memory_performance (
  memory_id                 TEXT NOT NULL REFERENCES memories(id) ON DELETE CASCADE,
  scope_key                 TEXT NOT NULL DEFAULT '*',
  useful_count               INTEGER NOT NULL DEFAULT 0 CHECK (useful_count >= 0),
  not_useful_count           INTEGER NOT NULL DEFAULT 0 CHECK (not_useful_count >= 0),
  redundant_reason_count     INTEGER NOT NULL DEFAULT 0 CHECK (redundant_reason_count >= 0),
  incorrect_reason_count     INTEGER NOT NULL DEFAULT 0 CHECK (incorrect_reason_count >= 0),
  diluted_success_evidence   REAL    NOT NULL DEFAULT 0 CHECK (diluted_success_evidence >= 0),
  diluted_failure_evidence   REAL    NOT NULL DEFAULT 0 CHECK (diluted_failure_evidence >= 0),
  success_context_count      INTEGER NOT NULL DEFAULT 0 CHECK (success_context_count >= 0),
  failure_context_count      INTEGER NOT NULL DEFAULT 0 CHECK (failure_context_count >= 0),
  labeled_context_count      INTEGER NOT NULL DEFAULT 0 CHECK (labeled_context_count >= 0),
  last_feedback_at           TEXT    NULL,
  last_outcome_at            TEXT    NULL,
  PRIMARY KEY (memory_id, scope_key)
);

-- Batch read by candidate set is the only query shape MemoryPerformanceStore needs.
CREATE INDEX IF NOT EXISTS idx_memory_performance_memory ON memory_performance(memory_id);
