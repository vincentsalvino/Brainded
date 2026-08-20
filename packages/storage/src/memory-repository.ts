import { randomUUID } from "node:crypto";
import type Database from "better-sqlite3";
import {
  type MemoryRepository,
  type MemoryRecord,
  type MemoryCreateInput,
  type MemoryUpdateInput,
  type MemoryQuery,
  type MemoryResult,
  type ScopeRef,
  type EmbeddingProvider,
  type MemoryMutationEvent,
  MemoryCreateInputSchema,
  MemoryUpdateInputSchema,
} from "@brain/contracts";
import { insertMutationEventRow } from "./event-store.js";

interface MemoryRow {
  id: string;
  type: string;
  content: string;
  domain: string | null;
  scope_kind: string;
  scope_id: string | null;
  source_origin: string;
  source_agent_id: string | null;
  source_session_id: string | null;
  source_task_id: string | null;
  source_ref: string | null;
  confidence: number;
  status: string;
  tags: string;
  supersedes: string | null;
  created_at: string;
  updated_at: string;
}

function rowToRecord(row: MemoryRow): MemoryRecord {
  return {
    id: row.id,
    type: row.type as MemoryRecord["type"],
    content: row.content,
    domain: row.domain,
    scope: { kind: row.scope_kind as ScopeRef["kind"], id: row.scope_id },
    source: {
      origin: row.source_origin as MemoryRecord["source"]["origin"],
      ...(row.source_agent_id !== null ? { agentId: row.source_agent_id } : {}),
      ...(row.source_session_id !== null ? { sessionId: row.source_session_id } : {}),
      ...(row.source_task_id !== null ? { taskId: row.source_task_id } : {}),
      ...(row.source_ref !== null ? { sourceRef: row.source_ref } : {}),
    },
    confidence: row.confidence,
    status: row.status as MemoryRecord["status"],
    tags: JSON.parse(row.tags) as string[],
    supersedes: row.supersedes,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/**
 * Every scope-bearing query is enforced HERE, in the SQL WHERE clause -- not as a
 * post-query application-code filter. This is the specific class of failure
 * AUDIT_AEOS_BRAIN.md 11 documented (RLS policies that existed but restricted
 * nothing). scopeIncludes in @brain/contracts is the canonical semantic definition
 * this SQL must agree with; see its test-fixtures counterpart, FakeMemoryRepository,
 * for the same semantics implemented over an in-memory Map.
 */
function scopeWhere(scope: ScopeRef): { clause: string; params: unknown[] } {
  if (scope.kind === "global") {
    return { clause: "scope_kind = 'global'", params: [] };
  }
  return {
    clause: "(scope_kind = 'global' OR (scope_kind = ? AND scope_id = ?))",
    params: [scope.kind, scope.id],
  };
}

export class SqliteMemoryRepository implements MemoryRepository {
  constructor(
    private readonly db: Database.Database,
    private readonly embeddings: EmbeddingProvider,
  ) {}

  /** Writes the memory row and its mutation-audit row in one SQL transaction --
   *  the actual atomicity guarantee the EventStore interface's recordMutation doc
   *  comment claims. A crash between the two writes can no longer produce a memory
   *  with no audit trail (or vice versa): both commit or neither does. */
  private writeMutationAtomically(
    writeMemoryRow: () => void,
    mutation: Omit<MemoryMutationEvent, "id" | "timestamp">,
  ): void {
    const run = this.db.transaction(() => {
      writeMemoryRow();
      insertMutationEventRow(this.db, {
        ...mutation,
        id: randomUUID(),
        timestamp: new Date().toISOString(),
      });
    });
    run();
  }

  /** Embeds `content` and writes it to memory_vectors. Never throws past this method
   *  as a hard requirement of create()/update() -- if the embedding provider is
   *  unavailable, the memory write itself must still succeed (semantic search on
   *  this record will just find nothing until re-indexed; that is a retrieval-time
   *  degradation, not a write-time failure -- see the retrieval degradation test). */
  private async indexVector(memoryId: string, content: string): Promise<void> {
    try {
      const vector = await this.embeddings.embed(content);
      const json = JSON.stringify(vector);
      const exists = this.db.prepare(`SELECT 1 FROM memory_vectors WHERE memory_id = ?`).get(memoryId);
      if (exists) {
        this.db.prepare(`UPDATE memory_vectors SET embedding = ? WHERE memory_id = ?`).run(json, memoryId);
      } else {
        this.db
          .prepare(`INSERT INTO memory_vectors (memory_id, embedding) VALUES (?, ?)`)
          .run(memoryId, json);
      }
    } catch (error) {
      // The memory write itself must still succeed even if embedding fails -- this
      // is retrieval-time degradation (semantic search on this record will find
      // nothing until re-indexed), not a discarded write. It is surfaced (not a bare
      // swallow) specifically because AUDIT_AEOS_BRAIN.md 13 found the opposite
      // pattern -- a silently swallowed failure with zero observability -- to be a
      // real, undetected production bug for months.
      console.error(`memory ${memoryId}: embedding index failed, will be lexical-only until re-indexed:`, error);
    }
  }

  async create(rawInput: MemoryCreateInput): Promise<MemoryRecord> {
    const input = MemoryCreateInputSchema.parse(rawInput);
    const now = new Date().toISOString();
    const record: MemoryRecord = {
      id: randomUUID(),
      type: input.type,
      content: input.content,
      domain: input.domain ?? null,
      scope: input.scope,
      source: {
        origin: input.source?.origin ?? "system",
        ...(input.source?.agentId !== undefined ? { agentId: input.source.agentId } : {}),
        ...(input.source?.sessionId !== undefined ? { sessionId: input.source.sessionId } : {}),
        ...(input.source?.taskId !== undefined ? { taskId: input.source.taskId } : {}),
        ...(input.source?.sourceRef !== undefined ? { sourceRef: input.source.sourceRef } : {}),
      },
      confidence: input.confidence,
      status: "active",
      tags: input.tags,
      supersedes: input.supersedes ?? null,
      createdAt: now,
      updatedAt: now,
    };

    this.writeMutationAtomically(
      () => {
        this.db
          .prepare(
            `INSERT INTO memories (
              id, type, content, domain, scope_kind, scope_id,
              source_origin, source_agent_id, source_session_id, source_task_id, source_ref,
              confidence, status, tags, supersedes, created_at, updated_at
            ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
          )
          .run(
            record.id,
            record.type,
            record.content,
            record.domain,
            record.scope.kind,
            record.scope.id,
            record.source.origin,
            record.source.agentId ?? null,
            record.source.sessionId ?? null,
            record.source.taskId ?? null,
            record.source.sourceRef ?? null,
            record.confidence,
            record.status,
            JSON.stringify(record.tags),
            record.supersedes,
            record.createdAt,
            record.updatedAt,
          );
      },
      { memoryId: record.id, mutationType: "create", actor: record.source, summary: `created ${record.type} memory` },
    );

    await this.indexVector(record.id, record.content);

    return record;
  }

  async get(id: string, scope: ScopeRef): Promise<MemoryRecord | null> {
    const where = scopeWhere(scope);
    const row = this.db
      .prepare(`SELECT * FROM memories WHERE id = ? AND ${where.clause}`)
      .get(id, ...where.params) as MemoryRow | undefined;
    return row ? rowToRecord(row) : null;
  }

  async update(rawInput: MemoryUpdateInput, scope: ScopeRef): Promise<MemoryRecord> {
    const input = MemoryUpdateInputSchema.parse(rawInput);
    const existing = await this.get(input.id, scope);
    if (!existing) throw new Error(`memory ${input.id} not found in this scope`);

    const updated: MemoryRecord = {
      ...existing,
      content: input.content ?? existing.content,
      domain: input.domain === undefined ? existing.domain : input.domain,
      tags: input.tags ?? existing.tags,
      confidence: input.confidence ?? existing.confidence,
      status: input.status ?? existing.status,
      updatedAt: new Date().toISOString(),
    };

    this.writeMutationAtomically(
      () => {
        this.db
          .prepare(
            `UPDATE memories SET content = ?, domain = ?, tags = ?, confidence = ?, status = ?, updated_at = ? WHERE id = ?`,
          )
          .run(
            updated.content,
            updated.domain,
            JSON.stringify(updated.tags),
            updated.confidence,
            updated.status,
            updated.updatedAt,
            updated.id,
          );
      },
      {
        memoryId: updated.id,
        mutationType: input.status === "archived" ? "archive" : "update",
        actor: { origin: "agent" },
        summary: input.status === "archived" ? "archived via update" : "updated fields",
      },
    );

    if (input.content !== undefined) {
      await this.indexVector(updated.id, updated.content);
    }

    return updated;
  }

  async archive(id: string, scope: ScopeRef): Promise<MemoryRecord> {
    return this.update({ id, status: "archived" }, scope);
  }

  async query(rawQuery: MemoryQuery): Promise<MemoryResult> {
    const where = scopeWhere(rawQuery.scope);
    const clauses = [where.clause];
    const params: unknown[] = [...where.params];

    if (rawQuery.type) {
      clauses.push("type = ?");
      params.push(rawQuery.type);
    }
    if (rawQuery.status) {
      clauses.push("status = ?");
      params.push(rawQuery.status);
    }

    const limit = rawQuery.limit ?? 50;
    const rows = this.db
      .prepare(`SELECT * FROM memories WHERE ${clauses.join(" AND ")} ORDER BY created_at DESC LIMIT ?`)
      .all(...params, limit) as MemoryRow[];

    let items = rows.map(rowToRecord);
    if (rawQuery.tags && rawQuery.tags.length > 0) {
      const required = rawQuery.tags;
      items = items.filter((item) => required.every((tag) => item.tags.includes(tag)));
    }

    return { items };
  }

  async purge(id: string, scope: ScopeRef): Promise<void> {
    const where = scopeWhere(scope);
    const result = this.db
      .prepare(`DELETE FROM memories WHERE id = ? AND ${where.clause}`)
      .run(id, ...where.params);
    if (result.changes > 0) {
      this.db.prepare(`DELETE FROM memory_vectors WHERE memory_id = ?`).run(id);
    }
  }
}
