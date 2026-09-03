import type Database from "better-sqlite3";
import type { FeedbackEvent, OutcomeEvent, MemoryPerformanceRaw, MemoryPerformanceStore } from "@brain/contracts";
import { feedbackFromRow, outcomeFromRow, type FeedbackRow, type OutcomeRow } from "./event-store.js";

interface PerformanceRow {
  memory_id: string;
  scope_key: string;
  useful_count: number;
  not_useful_count: number;
  redundant_reason_count: number;
  incorrect_reason_count: number;
  diluted_success_evidence: number;
  diluted_failure_evidence: number;
  success_context_count: number;
  failure_context_count: number;
  labeled_context_count: number;
  last_feedback_at: string | null;
  last_outcome_at: string | null;
}

function rawFromRow(r: PerformanceRow): MemoryPerformanceRaw {
  return {
    memoryId: r.memory_id,
    scopeKey: r.scope_key,
    usefulCount: r.useful_count,
    notUsefulCount: r.not_useful_count,
    redundantReasonCount: r.redundant_reason_count,
    incorrectReasonCount: r.incorrect_reason_count,
    dilutedSuccessEvidence: r.diluted_success_evidence,
    dilutedFailureEvidence: r.diluted_failure_evidence,
    successContextCount: r.success_context_count,
    failureContextCount: r.failure_context_count,
    labeledContextCount: r.labeled_context_count,
    lastFeedbackAt: r.last_feedback_at,
    lastOutcomeAt: r.last_outcome_at,
  };
}

/** Only the fields a single delta actually changes; every other count defaults to 0/null. */
interface PerformanceDelta {
  usefulCount?: number;
  notUsefulCount?: number;
  redundantReasonCount?: number;
  incorrectReasonCount?: number;
  dilutedSuccessEvidence?: number;
  dilutedFailureEvidence?: number;
  successContextCount?: number;
  failureContextCount?: number;
  labeledContextCount?: number;
  lastFeedbackAt?: string;
  lastOutcomeAt?: string;
}

const GLOBAL_SCOPE_KEY = "*"; // F8: the only bucket populated in Phase 4.1/4.2.

/**
 * Additive upsert: a brand-new row is inserted as-is; an existing row has every count field
 * incremented by the delta's value (0 where the delta doesn't mention it) and each timestamp
 * replaced only if the delta actually sets it (COALESCE keeps the prior value otherwise, so a
 * feedback-only delta never blanks lastOutcomeAt and vice versa).
 */
function upsertPerformanceDelta(db: Database.Database, memoryId: string, delta: PerformanceDelta): void {
  db.prepare(
    `INSERT INTO memory_performance (
       memory_id, scope_key, useful_count, not_useful_count, redundant_reason_count, incorrect_reason_count,
       diluted_success_evidence, diluted_failure_evidence, success_context_count, failure_context_count,
       labeled_context_count, last_feedback_at, last_outcome_at
     ) VALUES (@memoryId, @scopeKey, @usefulCount, @notUsefulCount, @redundantReasonCount, @incorrectReasonCount,
       @dilutedSuccessEvidence, @dilutedFailureEvidence, @successContextCount, @failureContextCount,
       @labeledContextCount, @lastFeedbackAt, @lastOutcomeAt)
     ON CONFLICT(memory_id, scope_key) DO UPDATE SET
       useful_count             = useful_count             + excluded.useful_count,
       not_useful_count         = not_useful_count          + excluded.not_useful_count,
       redundant_reason_count   = redundant_reason_count    + excluded.redundant_reason_count,
       incorrect_reason_count   = incorrect_reason_count    + excluded.incorrect_reason_count,
       diluted_success_evidence = diluted_success_evidence  + excluded.diluted_success_evidence,
       diluted_failure_evidence = diluted_failure_evidence  + excluded.diluted_failure_evidence,
       success_context_count    = success_context_count     + excluded.success_context_count,
       failure_context_count    = failure_context_count     + excluded.failure_context_count,
       labeled_context_count    = labeled_context_count     + excluded.labeled_context_count,
       last_feedback_at         = COALESCE(excluded.last_feedback_at, last_feedback_at),
       last_outcome_at          = COALESCE(excluded.last_outcome_at, last_outcome_at)`,
  ).run({
    memoryId,
    scopeKey: GLOBAL_SCOPE_KEY,
    usefulCount: delta.usefulCount ?? 0,
    notUsefulCount: delta.notUsefulCount ?? 0,
    redundantReasonCount: delta.redundantReasonCount ?? 0,
    incorrectReasonCount: delta.incorrectReasonCount ?? 0,
    dilutedSuccessEvidence: delta.dilutedSuccessEvidence ?? 0,
    dilutedFailureEvidence: delta.dilutedFailureEvidence ?? 0,
    successContextCount: delta.successContextCount ?? 0,
    failureContextCount: delta.failureContextCount ?? 0,
    labeledContextCount: delta.labeledContextCount ?? 0,
    lastFeedbackAt: delta.lastFeedbackAt ?? null,
    lastOutcomeAt: delta.lastOutcomeAt ?? null,
  });
}

/**
 * Tier-1 aggregation (PHASE_2_DECISIONS.md E12, PHASE_4_DECISIONS.md F4/F5/F16a). Synchronous --
 * called inside SqliteEventStore.recordFeedback's own transaction (F12), and replayed directly by
 * rebuildAll() below, so both paths are the exact same code, not merely "the same semantics."
 *
 * `useful: null` is not a judgement (E4) and touches nothing -- no row is created or modified.
 * `reason: 'redundant'` feeds neither stream (E14) but is still a real Tier-1 observation
 * (labeledContextCount still increments). A `(memoryId, contextId)` pair may contribute at most
 * once: the dedup check queries feedback_events directly for the earliest row on that pair
 * (SQLite `rowid`, strictly insertion-ordered) rather than trusting caller-supplied order, so this
 * function is safe to call in any replay order. `contextId: null` rows have no pair to dedupe on
 * and always count independently.
 */
export function applyFeedbackToPerformance(db: Database.Database, event: FeedbackEvent): void {
  if (event.useful === null) return;

  if (event.contextId !== null) {
    const winner = db
      .prepare(`SELECT id FROM feedback_events WHERE memory_id = ? AND context_id = ? ORDER BY rowid ASC LIMIT 1`)
      .get(event.memoryId, event.contextId) as { id: string } | undefined;
    if (winner?.id !== event.id) return; // a duplicate of this pair already won
  }

  const delta: PerformanceDelta = { labeledContextCount: 1, lastFeedbackAt: event.timestamp };
  if (event.useful === true) {
    delta.usefulCount = 1;
  } else if (event.reason === "redundant") {
    delta.redundantReasonCount = 1;
  } else {
    delta.notUsefulCount = 1;
    if (event.reason === "incorrect") delta.incorrectReasonCount = 1;
  }

  upsertPerformanceDelta(db, event.memoryId, delta);
}

/**
 * Tier-2 aggregation (E12). Only `success`/`failure` are eligible -- E12 is silent on `partial`/
 * `unknown` (F16c), and treating either as directional evidence without an explicit decision would
 * be exactly the "building on an unpopulated signal fabricates evidence" mistake E4 already
 * rejected once for `reviewScore`. Dedup (F16b) is scoped to *eligible* outcomes for a context, by
 * the same rowid-first mechanism as feedback -- an ineligible outcome recorded first must not block
 * a later eligible one from ever counting. `contextId: null`, or a context with zero `included=1`
 * membership rows, contributes nothing; both are checked before any division ever happens.
 */
export function applyOutcomeToPerformance(db: Database.Database, event: OutcomeEvent): void {
  if (event.contextId === null) return;
  if (event.outcome !== "success" && event.outcome !== "failure") return;

  const winner = db
    .prepare(
      `SELECT id FROM outcome_events WHERE context_id = ? AND outcome IN ('success','failure') ORDER BY rowid ASC LIMIT 1`,
    )
    .get(event.contextId) as { id: string } | undefined;
  if (winner?.id !== event.id) return; // a duplicate eligible outcome for this context already won

  const included = db
    .prepare(`SELECT memory_id FROM context_event_memories WHERE context_event_id = ? AND included = 1`)
    .all(event.contextId) as { memory_id: string }[];
  if (included.length === 0) return; // nothing to fan out to -- never divides by zero

  const credit = 1 / included.length;
  for (const { memory_id: memoryId } of included) {
    upsertPerformanceDelta(
      db,
      memoryId,
      event.outcome === "success"
        ? { dilutedSuccessEvidence: credit, successContextCount: 1, lastOutcomeAt: event.timestamp }
        : { dilutedFailureEvidence: credit, failureContextCount: 1, lastOutcomeAt: event.timestamp },
    );
  }
}

/** SQLite-backed, rebuildable implementation of MemoryPerformanceStore. See migration 0007. */
export class SqliteMemoryPerformanceStore implements MemoryPerformanceStore {
  constructor(private readonly db: Database.Database) {}

  async getPerformanceBatch(memoryIds: string[]): Promise<Map<string, MemoryPerformanceRaw>> {
    const map = new Map<string, MemoryPerformanceRaw>();
    if (memoryIds.length === 0) return map;

    const placeholders = memoryIds.map(() => "?").join(",");
    const rows = this.db
      .prepare(
        `SELECT * FROM memory_performance WHERE scope_key = ? AND memory_id IN (${placeholders})`,
      )
      .all(GLOBAL_SCOPE_KEY, ...memoryIds) as PerformanceRow[];

    for (const row of rows) map.set(row.memory_id, rawFromRow(row));
    return map;
  }

  /**
   * F11: ground truth. Replays every raw feedback/outcome event through the exact same
   * apply*ToPerformance functions the incremental write path uses (F12) -- not a separately
   * re-derived bulk query -- so "rebuild equals incremental" holds by construction, not by
   * coincidence. Order doesn't affect the result (each event's dedup outcome is decided by a
   * direct query against the full table, not accumulated in-memory state), but rowid order is
   * used anyway for a deterministic, easy-to-debug replay.
   */
  async rebuildAll(): Promise<{ memoriesRebuilt: number }> {
    let memoriesRebuilt = 0;
    this.db.transaction(() => {
      this.db.prepare(`DELETE FROM memory_performance`).run();

      const feedbackRows = this.db.prepare(`SELECT * FROM feedback_events ORDER BY rowid ASC`).all() as FeedbackRow[];
      for (const row of feedbackRows) applyFeedbackToPerformance(this.db, feedbackFromRow(row));

      const outcomeRows = this.db.prepare(`SELECT * FROM outcome_events ORDER BY rowid ASC`).all() as OutcomeRow[];
      for (const row of outcomeRows) applyOutcomeToPerformance(this.db, outcomeFromRow(row));

      memoriesRebuilt = (
        this.db.prepare(`SELECT COUNT(DISTINCT memory_id) n FROM memory_performance`).get() as { n: number }
      ).n;
    })();
    return { memoriesRebuilt };
  }
}
