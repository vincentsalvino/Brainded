import { randomUUID } from "node:crypto";
import type Database from "better-sqlite3";
import type {
  EventStore,
  TaskEvents,
  RetrievalEvent,
  ContextEvent,
  ContextEventMemory,
  OutcomeEvent,
  FeedbackEvent,
  MemoryMutationEvent,
  ContextEventSource,
} from "@brain/contracts";
import { assertContextMembershipConsistent } from "@brain/contracts";

interface RetrievalRow {
  id: string;
  timestamp: string;
  scope_kind: string;
  scope_id: string | null;
  query_text: string;
  candidate_ids: string;
  task_id: string | null;
}

interface ContextRow {
  id: string;
  timestamp: string;
  retrieval_event_id: string;
  scope_kind: string;
  scope_id: string | null;
  task_id: string | null;
  included_memory_ids: string;
  omitted_memory_ids: string;
  token_count: number;
  candidate_count: number | null;
  candidate_token_count: number | null;
  retrieval_ms: number | null;
  ranking_ms: number | null;
  compile_ms: number | null;
  optimize_ms: number | null;
}

interface ContextMemoryRow {
  context_event_id: string;
  memory_id: string;
  included: number;
  rank: number | null;
  token_count: number | null;
}

interface OutcomeRow {
  id: string;
  timestamp: string;
  task_id: string;
  session_id: string | null;
  context_id: string | null;
  outcome: string;
  signal: string | null;
  notes: string | null;
}

interface FeedbackRow {
  id: string;
  timestamp: string;
  memory_id: string;
  task_id: string | null;
  context_id: string | null;
  useful: number | null;
  reason: string | null;
  notes: string | null;
}

interface MutationRow {
  id: string;
  timestamp: string;
  memory_id: string;
  mutation_type: string;
  actor_origin: string;
  actor_agent_id: string | null;
  actor_session_id: string | null;
  actor_task_id: string | null;
  summary: string | null;
}

interface ContextSourceRow {
  context_event_id: string;
  source_type: string;
  source_id: string;
  repository_id: string;
  file_id: string;
  relative_path: string;
  relation: string | null;
  depth: number | null;
  included: number;
  rank: number | null;
  token_count: number | null;
}

function retrievalFromRow(r: RetrievalRow): RetrievalEvent {
  return {
    id: r.id,
    timestamp: r.timestamp,
    scope: { kind: r.scope_kind as RetrievalEvent["scope"]["kind"], id: r.scope_id },
    queryText: r.query_text,
    candidateIds: JSON.parse(r.candidate_ids) as string[],
    taskId: r.task_id,
  };
}

function contextMemoryFromRow(r: ContextMemoryRow): ContextEventMemory {
  return {
    memoryId: r.memory_id,
    included: r.included === 1,
    rank: r.rank,
    tokenCount: r.token_count,
  };
}

/**
 * `memories` is [] for any row written before migration 0002 -- those rows carry
 * the JSON arrays and nothing else. That is honest rather than reconstructed: a
 * pre-measurement delivery genuinely has no per-item rank or token cost, and
 * inventing one would fabricate data the Brain never observed.
 */
function contextFromRow(r: ContextRow, memories: ContextEventMemory[]): ContextEvent {
  return {
    id: r.id,
    timestamp: r.timestamp,
    retrievalEventId: r.retrieval_event_id,
    scope: { kind: r.scope_kind as ContextEvent["scope"]["kind"], id: r.scope_id },
    taskId: r.task_id,
    includedMemoryIds: JSON.parse(r.included_memory_ids) as string[],
    omittedMemoryIds: JSON.parse(r.omitted_memory_ids) as string[],
    tokenCount: r.token_count,
    memories,
    candidateCount: r.candidate_count,
    candidateTokenCount: r.candidate_token_count,
    retrievalMs: r.retrieval_ms,
    rankingMs: r.ranking_ms,
    compileMs: r.compile_ms,
    optimizeMs: r.optimize_ms,
  };
}

function outcomeFromRow(r: OutcomeRow): OutcomeEvent {
  return {
    id: r.id,
    timestamp: r.timestamp,
    taskId: r.task_id,
    sessionId: r.session_id,
    contextId: r.context_id,
    outcome: r.outcome as OutcomeEvent["outcome"],
    signal: r.signal ? (JSON.parse(r.signal) as OutcomeEvent["signal"]) : null,
    notes: r.notes,
  };
}

function feedbackFromRow(r: FeedbackRow): FeedbackEvent {
  return {
    id: r.id,
    timestamp: r.timestamp,
    memoryId: r.memory_id,
    taskId: r.task_id,
    contextId: r.context_id,
    useful: r.useful === null ? null : r.useful === 1,
    reason: r.reason as FeedbackEvent["reason"],
    notes: r.notes,
  };
}

function contextSourceFromRow(r: ContextSourceRow): ContextEventSource {
  return {
    sourceType: r.source_type as ContextEventSource["sourceType"],
    sourceId: r.source_id,
    repositoryId: r.repository_id,
    fileId: r.file_id,
    relativePath: r.relative_path,
    relation: r.relation as ContextEventSource["relation"],
    depth: r.depth,
    included: r.included === 1,
    rank: r.rank,
    tokenCount: r.token_count,
  };
}

function mutationFromRow(r: MutationRow): MemoryMutationEvent {
  return {
    id: r.id,
    timestamp: r.timestamp,
    memoryId: r.memory_id,
    mutationType: r.mutation_type as MemoryMutationEvent["mutationType"],
    actor: {
      origin: r.actor_origin as MemoryMutationEvent["actor"]["origin"],
      ...(r.actor_agent_id !== null ? { agentId: r.actor_agent_id } : {}),
      ...(r.actor_session_id !== null ? { sessionId: r.actor_session_id } : {}),
      ...(r.actor_task_id !== null ? { taskId: r.actor_task_id } : {}),
    },
    summary: r.summary,
  };
}

/**
 * Synchronous (no Promise) so SqliteMemoryRepository can call it inside a
 * `db.transaction()` alongside the memory row write itself -- that is what makes
 * "one audit event per mutation" (the interface's stated invariant,
 * repositories.ts) an actual atomicity guarantee rather than two independently-
 * committed statements with a crash window between them. SqliteEventStore.
 * recordMutation (below) is a thin async wrapper around this same function for
 * the general EventStore interface surface.
 */
export function insertMutationEventRow(db: Database.Database, event: MemoryMutationEvent): void {
  db.prepare(
    `INSERT INTO memory_mutation_events (id, timestamp, memory_id, mutation_type, actor_origin, actor_agent_id, actor_session_id, actor_task_id, summary) VALUES (?,?,?,?,?,?,?,?,?)`,
  ).run(
    event.id,
    event.timestamp,
    event.memoryId,
    event.mutationType,
    event.actor.origin,
    event.actor.agentId ?? null,
    event.actor.sessionId ?? null,
    event.actor.taskId ?? null,
    event.summary,
  );
}

/** SQLite-backed, append-only implementation of EventStore. See db.ts's migration for the five event tables. */
export class SqliteEventStore implements EventStore {
  constructor(private readonly db: Database.Database) {}

  async recordRetrieval(event: Omit<RetrievalEvent, "id" | "timestamp">): Promise<RetrievalEvent> {
    const full: RetrievalEvent = { ...event, id: randomUUID(), timestamp: new Date().toISOString() };
    this.db
      .prepare(
        `INSERT INTO retrieval_events (id, timestamp, scope_kind, scope_id, query_text, candidate_ids, task_id) VALUES (?,?,?,?,?,?,?)`,
      )
      .run(
        full.id,
        full.timestamp,
        full.scope.kind,
        full.scope.id,
        full.queryText,
        JSON.stringify(full.candidateIds),
        full.taskId,
      );
    return full;
  }

  /**
   * Writes the context_events row and its context_event_memories rows as ONE
   * transaction (P2-006 atomicity). Either the whole delivery record exists or
   * none of it does -- a context event whose membership rows are missing would be
   * indistinguishable from a genuinely empty delivery.
   *
   * Membership consistency is asserted BEFORE anything is written, so a caller
   * bug surfaces as a loud failure rather than two disagreeing records.
   */
  async recordContext(event: Omit<ContextEvent, "id" | "timestamp">): Promise<ContextEvent> {
    assertContextMembershipConsistent(event);

    const full: ContextEvent = { ...event, id: randomUUID(), timestamp: new Date().toISOString() };

    const insertEvent = this.db.prepare(
      `INSERT INTO context_events (id, timestamp, retrieval_event_id, scope_kind, scope_id, task_id, included_memory_ids, omitted_memory_ids, token_count, candidate_count, candidate_token_count, retrieval_ms, ranking_ms, compile_ms, optimize_ms) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    );
    const insertMembership = this.db.prepare(
      `INSERT INTO context_event_memories (context_event_id, memory_id, included, rank, token_count) VALUES (?,?,?,?,?)`,
    );

    this.db.transaction(() => {
      insertEvent.run(
        full.id,
        full.timestamp,
        full.retrievalEventId,
        full.scope.kind,
        full.scope.id,
        full.taskId,
        JSON.stringify(full.includedMemoryIds),
        JSON.stringify(full.omittedMemoryIds),
        full.tokenCount,
        full.candidateCount,
        full.candidateTokenCount,
        full.retrievalMs,
        full.rankingMs,
        full.compileMs,
        full.optimizeMs,
      );
      for (const memory of full.memories) {
        insertMembership.run(full.id, memory.memoryId, memory.included ? 1 : 0, memory.rank, memory.tokenCount);
      }
    })();

    return full;
  }

  private membershipFor(contextEventIds: string[]): Map<string, ContextEventMemory[]> {
    const byContext = new Map<string, ContextEventMemory[]>();
    if (contextEventIds.length === 0) return byContext;

    const placeholders = contextEventIds.map(() => "?").join(",");
    const rows = this.db
      .prepare(
        `SELECT * FROM context_event_memories WHERE context_event_id IN (${placeholders})
         ORDER BY included DESC, rank ASC, memory_id ASC`,
      )
      .all(...contextEventIds) as ContextMemoryRow[];

    for (const row of rows) {
      const list = byContext.get(row.context_event_id) ?? [];
      list.push(contextMemoryFromRow(row));
      byContext.set(row.context_event_id, list);
    }
    return byContext;
  }

  private hydrateContexts(rows: ContextRow[]): ContextEvent[] {
    const membership = this.membershipFor(rows.map((r) => r.id));
    return rows.map((row) => contextFromRow(row, membership.get(row.id) ?? []));
  }

  async getContextEvent(contextId: string): Promise<ContextEvent | null> {
    const row = this.db.prepare(`SELECT * FROM context_events WHERE id = ?`).get(contextId) as
      | ContextRow
      | undefined;
    if (!row) return null;
    return this.hydrateContexts([row])[0] as ContextEvent;
  }

  async recordOutcome(event: Omit<OutcomeEvent, "id" | "timestamp">): Promise<OutcomeEvent> {
    const full: OutcomeEvent = { ...event, id: randomUUID(), timestamp: new Date().toISOString() };
    this.db
      .prepare(
        `INSERT INTO outcome_events (id, timestamp, task_id, session_id, context_id, outcome, signal, notes) VALUES (?,?,?,?,?,?,?,?)`,
      )
      .run(
        full.id,
        full.timestamp,
        full.taskId,
        full.sessionId,
        full.contextId,
        full.outcome,
        full.signal ? JSON.stringify(full.signal) : null,
        full.notes,
      );
    return full;
  }

  async recordFeedback(event: Omit<FeedbackEvent, "id" | "timestamp">): Promise<FeedbackEvent> {
    const full: FeedbackEvent = { ...event, id: randomUUID(), timestamp: new Date().toISOString() };
    this.db
      .prepare(
        `INSERT INTO feedback_events (id, timestamp, memory_id, task_id, context_id, useful, reason, notes) VALUES (?,?,?,?,?,?,?,?)`,
      )
      .run(
        full.id,
        full.timestamp,
        full.memoryId,
        full.taskId,
        full.contextId,
        full.useful === null ? null : full.useful ? 1 : 0,
        full.reason,
        full.notes,
      );
    return full;
  }

  async recordMutation(event: Omit<MemoryMutationEvent, "id" | "timestamp">): Promise<MemoryMutationEvent> {
    const full: MemoryMutationEvent = { ...event, id: randomUUID(), timestamp: new Date().toISOString() };
    insertMutationEventRow(this.db, full);
    return full;
  }

  async recordContextSources(contextEventId: string, sources: ContextEventSource[]): Promise<void> {
    const insert = this.db.prepare(
      `INSERT INTO context_event_sources (context_event_id, source_type, source_id, repository_id, file_id, relative_path, relation, depth, included, rank, token_count) VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
    );
    this.db.transaction(() => {
      for (const source of sources) {
        insert.run(
          contextEventId,
          source.sourceType,
          source.sourceId,
          source.repositoryId,
          source.fileId,
          source.relativePath,
          source.relation,
          source.depth,
          source.included ? 1 : 0,
          source.rank,
          source.tokenCount,
        );
      }
    })();
  }

  async getContextEventSources(contextEventId: string): Promise<ContextEventSource[]> {
    const rows = this.db
      .prepare(`SELECT * FROM context_event_sources WHERE context_event_id = ? ORDER BY source_type, rank ASC`)
      .all(contextEventId) as ContextSourceRow[];
    return rows.map(contextSourceFromRow);
  }

  async getEventsForTask(taskId: string): Promise<TaskEvents> {
    const retrieval = (
      this.db.prepare(`SELECT * FROM retrieval_events WHERE task_id = ?`).all(taskId) as RetrievalRow[]
    ).map(retrievalFromRow);
    const context = this.hydrateContexts(
      this.db.prepare(`SELECT * FROM context_events WHERE task_id = ?`).all(taskId) as ContextRow[],
    );
    const outcome = (
      this.db.prepare(`SELECT * FROM outcome_events WHERE task_id = ?`).all(taskId) as OutcomeRow[]
    ).map(outcomeFromRow);
    const feedback = (
      this.db.prepare(`SELECT * FROM feedback_events WHERE task_id = ?`).all(taskId) as FeedbackRow[]
    ).map(feedbackFromRow);
    return { retrieval, context, outcome, feedback };
  }

  async getEventsForMemory(memoryId: string): Promise<FeedbackEvent[]> {
    return (
      this.db.prepare(`SELECT * FROM feedback_events WHERE memory_id = ?`).all(memoryId) as FeedbackRow[]
    ).map(feedbackFromRow);
  }

  async getMutationsForMemory(memoryId: string): Promise<MemoryMutationEvent[]> {
    return (
      this.db
        .prepare(`SELECT * FROM memory_mutation_events WHERE memory_id = ? ORDER BY timestamp ASC`)
        .all(memoryId) as MutationRow[]
    ).map(mutationFromRow);
  }
}
