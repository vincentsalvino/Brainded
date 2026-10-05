import Database from "better-sqlite3";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { FeedbackEvent, OutcomeEvent, MemoryPerformanceRaw, Candidate, RankingWeights } from "@brain/contracts";
import { applyFeedbackToPerformance, applyOutcomeToPerformance } from "@brain/storage";

/**
 * Phase 4.3B (docs/phase-4/PHASE_4_3_REPORT.md). Time-causal historical replay -- reuses production's
 * exact applyFeedbackToPerformance/applyOutcomeToPerformance (from @brain/storage), never a
 * reimplementation, so "replay formula matches production" and "duplicate semantics match
 * production" hold by construction, not by parallel maintenance.
 *
 * The state lives in a throwaway, ISOLATED SQLite database that starts empty and is populated
 * ONLY with events strictly before the timestamp being evaluated. This is deliberately not "query
 * the full table WHERE timestamp < T" against a database that already contains every future row --
 * production's own dedup logic (F16a/F16b) queries "the earliest row for this key" against
 * whatever is physically present in feedback_events/outcome_events, so if future rows already
 * existed there, a naive time-filtered query could still be influenced by them. Building a
 * database that PHYSICALLY does not contain future rows yet makes future-leakage structurally
 * impossible, not merely filtered-around.
 */

function migrationSql(name: string): string {
  // dist-test/historical-replay.js -> package root -> migrations lives in @brain/storage, not here.
  // Read it directly from the sibling workspace package so this file is never out of sync with the
  // actual shipped schema (PHASE_4_SPEC.md 3).
  const here = dirname(fileURLToPath(import.meta.url));
  return readFileSync(join(here, "..", "..", "storage", "migrations", name), "utf-8");
}

/** A schema-only, empty isolated database: feedback_events/outcome_events (minimal columns the
 *  production apply* functions actually read) + context_event_memories (static, seeded once) +
 *  the real memory_performance table (read from migration 0007, not hand-duplicated). No FK
 *  constraints -- this is a pure aggregation simulation, not a copy of production data integrity. */
export function createIsolatedStateDb(): Database.Database {
  const db = new Database(":memory:");
  // Explicit, not assumed: this build's SQLite defaults foreign_keys ON. This is a pure
  // aggregation simulation over a deliberately partial schema (no real `memories` rows), so
  // enforcement is turned off rather than populating a stub table's rows for no purpose.
  db.pragma("foreign_keys = OFF");
  db.exec(`
    -- Empty stub: migration 0007's memory_performance table names memories(id) in a
    -- REFERENCES clause. SQLite requires the named table to exist by the time a statement
    -- touching memory_performance is prepared, even with foreign_keys enforcement left at
    -- its default (off) -- existence only, never populated; this is a pure aggregation
    -- simulation, not a copy of production data integrity.
    CREATE TABLE memories (id TEXT PRIMARY KEY);
    CREATE TABLE feedback_events (
      id TEXT PRIMARY KEY, timestamp TEXT NOT NULL, memory_id TEXT NOT NULL,
      task_id TEXT, context_id TEXT, useful INTEGER, reason TEXT, notes TEXT
    );
    CREATE TABLE outcome_events (
      id TEXT PRIMARY KEY, timestamp TEXT NOT NULL, task_id TEXT NOT NULL,
      session_id TEXT, context_id TEXT, outcome TEXT NOT NULL, signal TEXT, notes TEXT
    );
    CREATE TABLE context_event_memories (
      context_event_id TEXT NOT NULL, memory_id TEXT NOT NULL,
      included INTEGER NOT NULL, rank INTEGER, token_count INTEGER,
      PRIMARY KEY (context_event_id, memory_id)
    );
  `);
  db.exec(migrationSql("0007_memory_performance.sql"));
  return db;
}

export interface ContextMembershipSeed {
  contextEventId: string;
  memoryId: string;
  included: boolean;
  /** 1-based delivered position, matching context_event_memories.rank exactly; null for omitted. */
  rank: number | null;
}

/** Static historical fact ("who was delivered in context X, at what rank") -- seeded once, up
 *  front, for every context in the replay window. Not a moving target: knowing this about a PAST
 *  context is never future information, even when evaluating an EARLIER context. */
export function seedContextMembership(stateDb: Database.Database, rows: ContextMembershipSeed[]): void {
  const insert = stateDb.prepare(
    `INSERT INTO context_event_memories (context_event_id, memory_id, included, rank) VALUES (?,?,?,?)`,
  );
  stateDb.transaction(() => {
    for (const row of rows) insert.run(row.contextEventId, row.memoryId, row.included ? 1 : 0, row.rank);
  })();
}

function insertFeedbackRow(stateDb: Database.Database, event: FeedbackEvent): void {
  stateDb
    .prepare(
      `INSERT INTO feedback_events (id, timestamp, memory_id, task_id, context_id, useful, reason, notes) VALUES (?,?,?,?,?,?,?,?)`,
    )
    .run(
      event.id, event.timestamp, event.memoryId, event.taskId, event.contextId,
      event.useful === null ? null : event.useful ? 1 : 0, event.reason, event.notes,
    );
}

function insertOutcomeRow(stateDb: Database.Database, event: OutcomeEvent): void {
  stateDb
    .prepare(
      `INSERT INTO outcome_events (id, timestamp, task_id, session_id, context_id, outcome, signal, notes) VALUES (?,?,?,?,?,?,?,?)`,
    )
    .run(event.id, event.timestamp, event.taskId, event.sessionId, event.contextId, event.outcome, null, event.notes);
}

/** Applies one raw event to the isolated state, via the exact production functions. */
export function applyFeedbackEvent(stateDb: Database.Database, event: FeedbackEvent): void {
  insertFeedbackRow(stateDb, event);
  applyFeedbackToPerformance(stateDb, event);
}

export function applyOutcomeEvent(stateDb: Database.Database, event: OutcomeEvent): void {
  insertOutcomeRow(stateDb, event);
  applyOutcomeToPerformance(stateDb, event);
}

/** Same query shape as SqliteMemoryPerformanceStore.getPerformanceBatch -- kept independent
 *  (not imported) because the isolated db's PerformanceRow shape is identical by construction
 *  (same migration 0007 DDL) but this file must not depend on packages/storage's internal,
 *  unexported row-mapping helpers. */
export function snapshotPerformance(stateDb: Database.Database, memoryIds: string[]): Map<string, MemoryPerformanceRaw> {
  const map = new Map<string, MemoryPerformanceRaw>();
  if (memoryIds.length === 0) return map;
  const placeholders = memoryIds.map(() => "?").join(",");
  const rows = stateDb
    .prepare(`SELECT * FROM memory_performance WHERE scope_key = '*' AND memory_id IN (${placeholders})`)
    .all(...memoryIds) as {
    memory_id: string; scope_key: string; useful_count: number; not_useful_count: number;
    redundant_reason_count: number; incorrect_reason_count: number; diluted_success_evidence: number;
    diluted_failure_evidence: number; success_context_count: number; failure_context_count: number;
    labeled_context_count: number; last_feedback_at: string | null; last_outcome_at: string | null;
  }[];
  for (const r of rows) {
    map.set(r.memory_id, {
      memoryId: r.memory_id, scopeKey: r.scope_key, usefulCount: r.useful_count,
      notUsefulCount: r.not_useful_count, redundantReasonCount: r.redundant_reason_count,
      incorrectReasonCount: r.incorrect_reason_count, dilutedSuccessEvidence: r.diluted_success_evidence,
      dilutedFailureEvidence: r.diluted_failure_evidence, successContextCount: r.success_context_count,
      failureContextCount: r.failure_context_count, labeledContextCount: r.labeled_context_count,
      lastFeedbackAt: r.last_feedback_at, lastOutcomeAt: r.last_outcome_at,
    });
  }
  return map;
}

// --- Chronological timeline -------------------------------------------------

export type TimelineEntry =
  | { kind: "feedback"; timestamp: string; rowid: number; event: FeedbackEvent }
  | { kind: "outcome"; timestamp: string; rowid: number; event: OutcomeEvent }
  | { kind: "context"; timestamp: string; rowid: number; contextEventId: string };

/**
 * Cross-table ordering rule (documented, not invented ad hoc per-call): primary key is
 * `timestamp` (server-generated in SqliteEventStore via `new Date().toISOString()` at insert
 * time -- never client-supplied, PHASE_4_FINDINGS.md 8.6-adjacent finding), which is safe to
 * compare ACROSS tables because it's the same process's wall clock at each insert. Ties (same
 * millisecond) break by `kind` (outcome, feedback, context -- arbitrary but deterministic) then by
 * that event's own table `rowid` (insertion order WITHIN its table, matching F16a/F16b's existing
 * within-table convention). Ties this coarse are not expected in practice; the tiebreak exists so
 * replay is deterministic even in the pathological case, per test-requirement 3.
 */
export function sortTimeline(entries: TimelineEntry[]): TimelineEntry[] {
  const kindOrder = { outcome: 0, feedback: 1, context: 2 } as const;
  return [...entries].sort((a, b) => {
    if (a.timestamp !== b.timestamp) return a.timestamp < b.timestamp ? -1 : 1;
    if (a.kind !== b.kind) return kindOrder[a.kind] - kindOrder[b.kind];
    return a.rowid - b.rowid;
  });
}

export interface ReplayContextResult {
  contextEventId: string;
  timestamp: string;
  candidateIds: string[];
  /** Recorded historical delivered order (from context_event_memories.rank) -- this dataset
   *  predates any learning implementation, so it IS the disabled-learning baseline by construction. */
  recordedOrder: string[];
  /** Reconstructed via the injected candidate-reconstruction function + the real, unmodified
   *  rank() (learning disabled). Compared against recordedOrder to validate reconstruction. */
  reconstructedBaselineOrder: string[] | null;
  exactlyReplayable: boolean;
  notReplayableReason: string | null;
  /** Full rank over every reconstructed candidate (included AND historically-omitted), not
   *  truncated to recordedOrder's length -- callers doing top-N/context-impact analysis slice
   *  this themselves against their own delivered-count definition, rather than this module
   *  guessing one. */
  enabledOrder: string[] | null;
  performanceAtTime: Map<string, MemoryPerformanceRaw>;
  /** The reconstructed candidates themselves (signals intact), so callers can compute base
   *  scores, apply their own classification, etc. without this module re-deriving every metric
   *  anyone might ever want. Null when not exactly replayable. */
  candidates: Candidate[] | null;
}

/**
 * Walks the merged chronological timeline exactly once. At each context entry: snapshots
 * time-causal performance state (built from ONLY events already applied to the isolated db --
 * test-requirements 1/2), reconstructs candidates via the injected function, validates against
 * the recorded order, and (if the injected weights/candidates are available) computes the
 * enabled-learning order using the real rank() -- never a reimplementation.
 *
 * `reconstructCandidates` is injected specifically so unit tests can exercise the causal/ordering
 * mechanism with a deterministic fake, without needing the real embedding model -- the real run
 * (historical-replay-real-corpus.test.ts) injects SqliteRetrievalStore + LocalEmbeddingProvider.
 */
export async function replayTimeline(
  entries: TimelineEntry[],
  membership: ContextMembershipSeed[],
  reconstructCandidates: (contextEventId: string) => Promise<Candidate[] | null>,
  rankFn: (candidates: Candidate[], learningEnabled: boolean) => string[],
): Promise<ReplayContextResult[]> {
  const stateDb = createIsolatedStateDb();
  seedContextMembership(stateDb, membership);

  const membershipByContext = new Map<string, ContextMembershipSeed[]>();
  for (const row of membership) {
    const list = membershipByContext.get(row.contextEventId) ?? [];
    list.push(row);
    membershipByContext.set(row.contextEventId, list);
  }

  const results: ReplayContextResult[] = [];
  for (const entry of sortTimeline(entries)) {
    if (entry.kind === "feedback") {
      applyFeedbackEvent(stateDb, entry.event);
    } else if (entry.kind === "outcome") {
      applyOutcomeEvent(stateDb, entry.event);
    } else {
      const rows = membershipByContext.get(entry.contextEventId) ?? [];
      const candidateIds = rows.map((r) => r.memoryId);
      const recordedOrder = rows
        .filter((r) => r.included && r.rank !== null)
        .sort((a, b) => (a.rank as number) - (b.rank as number))
        .map((r) => r.memoryId);

      const candidates = await reconstructCandidates(entry.contextEventId);
      const performanceAtTime = snapshotPerformance(stateDb, candidateIds);

      if (candidates === null) {
        results.push({
          contextEventId: entry.contextEventId, timestamp: entry.timestamp, candidateIds, recordedOrder,
          reconstructedBaselineOrder: null, exactlyReplayable: false,
          notReplayableReason: "candidate reconstruction unavailable", enabledOrder: null, performanceAtTime,
          candidates: null,
        });
        continue;
      }

      const reconstructedBaselineOrder = rankFn(candidates, false);
      const matches = arraysEqual(reconstructedBaselineOrder, recordedOrder);

      const decorated = candidates.map((c) => {
        const row = performanceAtTime.get(c.memoryId);
        return row ? { ...c, performance: computePerformanceFromRaw(row) } : c;
      });
      const enabledOrder = matches ? rankFn(decorated, true) : null;

      results.push({
        contextEventId: entry.contextEventId, timestamp: entry.timestamp, candidateIds, recordedOrder,
        reconstructedBaselineOrder, exactlyReplayable: matches,
        notReplayableReason: matches ? null : "reconstructed baseline order does not match the recorded delivered order",
        enabledOrder, performanceAtTime,
        candidates: matches ? candidates : null,
      });
    }
  }
  return results;
}

function arraysEqual(a: string[], b: string[]): boolean {
  return a.length === b.length && a.every((x, i) => x === b[i]);
}

// --- Classification (docs/phase-4/PHASE_4_3_REPORT.md "HARMFUL REORDER DEFINITION" / "CONTEXT-IMPACTING
// REORDER") -- shared by the real-corpus run and, if a future organic pilot is run, by that
// paired comparison too. Uses the mission's own two-clause definition verbatim, not a redefined
// one, and the F2 bound (not the superseded "any gap > maxBoost" claim) for "comparable relevance."

export type ContextChangeKind = "unchanged" | "rank-only" | "context-impacting";
export type ReorderSafety = "safe" | "harmful";

export interface ContextChangeClassification {
  kind: ContextChangeKind;
  safety: ReorderSafety | null; // null when kind is "unchanged" -- nothing to classify
  reason: string | null;
}

const REORDER_BOUND_RATIO = (1 + 0.15) / (1 - 0.15); // F2's actual worst-case bound at maxBoost=0.15

function netUsefulness(raw: MemoryPerformanceRaw | undefined): "positive" | "negative" | "neutral" {
  if (!raw) return "neutral";
  if (raw.usefulCount > raw.notUsefulCount) return "positive";
  if (raw.notUsefulCount > raw.usefulCount) return "negative";
  return "neutral";
}

/**
 * Classifies one context's disabled-vs-enabled comparison. `recordedOrder`/`enabledFullOrder` are
 * this context's own ReplayContextResult fields; `candidates` supplies base scores (via the real,
 * unmodified computeScore) for the "comparable baseline relevance" check in clause (a).
 */
export function classifyContextChange(params: {
  recordedOrder: string[];
  enabledFullOrder: string[];
  candidates: Candidate[];
  performanceAtTime: Map<string, MemoryPerformanceRaw>;
  weights: RankingWeights;
}): ContextChangeClassification {
  const { recordedOrder, enabledFullOrder, candidates, performanceAtTime, weights } = params;
  const n = recordedOrder.length;
  const topN = enabledFullOrder.slice(0, n);
  const recordedSet = new Set(recordedOrder);
  const topNSet = new Set(topN);

  const entered = topN.filter((id) => !recordedSet.has(id));
  const left = recordedOrder.filter((id) => !topNSet.has(id));

  if (entered.length === 0 && arraysEqual(topN, recordedOrder)) {
    return { kind: "unchanged", safety: null, reason: null };
  }

  const scoreById = new Map(candidates.map((c) => [c.memoryId, computeScore(c.signals, weights)]));

  if (entered.length > 0 || left.length > 0) {
    // Clause (b): a labeled-useful (net-positive) memory displaced in favor of a labeled-not-useful
    // (net-negative) one.
    for (const leftId of left) {
      if (netUsefulness(performanceAtTime.get(leftId)) !== "positive") continue;
      for (const enteredId of entered) {
        if (netUsefulness(performanceAtTime.get(enteredId)) === "negative") {
          return { kind: "context-impacting", safety: "harmful", reason: `${enteredId} (negative-supported) displaced ${leftId} (positive-supported) from the delivered set` };
        }
      }
    }
    return { kind: "context-impacting", safety: "safe", reason: null };
  }

  // Rank-only: same delivered set, different order. Clause (a): a negative-supported memory
  // overtaking a positive-supported one at comparable baseline relevance (F2's actual bound).
  for (let i = 0; i < topN.length; i++) {
    for (let j = i + 1; j < topN.length; j++) {
      const higher = topN[i] as string; // now ranks above `lower`
      const lower = topN[j] as string;
      const wasHigherBefore = recordedOrder.indexOf(higher) > recordedOrder.indexOf(lower);
      if (!wasHigherBefore) continue; // this pair didn't swap
      if (netUsefulness(performanceAtTime.get(higher)) !== "negative") continue;
      if (netUsefulness(performanceAtTime.get(lower)) !== "positive") continue;
      const a = scoreById.get(higher) ?? 0;
      const b = scoreById.get(lower) ?? 0;
      const ratio = Math.max(a, b) / Math.max(Math.min(a, b), 1e-9);
      if (ratio <= REORDER_BOUND_RATIO) {
        return { kind: "rank-only", safety: "harmful", reason: `${higher} (negative-supported) overtook ${lower} (positive-supported) at comparable baseline relevance (ratio ${ratio.toFixed(3)})` };
      }
    }
  }
  return { kind: "rank-only", safety: "safe", reason: null };
}

import { computeScore } from "@brain/ranking";

// computeUsefulnessSignal lives in @brain/learning, which depends on @brain/contracts only --
// importing it here (evaluation already has @brain/learning as a devDependency) keeps this file
// from re-deriving E5's formula a second time.
import { computeUsefulnessSignal } from "@brain/learning";
import { DEFAULT_LEARNING_CONFIG } from "@brain/contracts";

const FROZEN_EVAL_CONFIG = { ...DEFAULT_LEARNING_CONFIG, enabled: true }; // k=5, outcomeWeight=0, maxBoost=0.15 -- frozen, not tuned in this phase

function computePerformanceFromRaw(raw: MemoryPerformanceRaw) {
  return computeUsefulnessSignal(raw, FROZEN_EVAL_CONFIG);
}
