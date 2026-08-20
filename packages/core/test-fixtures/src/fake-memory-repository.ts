import { randomUUID } from "node:crypto";
import {
  type MemoryRepository,
  type MemoryRecord,
  type MemoryCreateInput,
  type MemoryUpdateInput,
  type MemoryQuery,
  type MemoryResult,
  type ScopeRef,
  type EventStore,
  MemoryCreateInputSchema,
  MemoryUpdateInputSchema,
  scopeIncludes,
} from "@brain/contracts";

/**
 * In-memory MemoryRepository for unit-testing core packages without a real
 * database. Enforces scope isolation the same way the real SQLite repository must
 * (scopeIncludes is the single canonical definition, see contracts/scope.ts) and
 * writes exactly one MemoryMutationEvent per create/update/archive, matching the
 * interface's stated invariant.
 *
 * purge() does not emit a mutation event: it is interface-only in Phase 1 (not
 * reachable via any brain_* operation), so extending the mutation-type enum for an
 * operation nothing can trigger yet would be unnecessary infrastructure.
 */
export class FakeMemoryRepository implements MemoryRepository {
  private readonly records = new Map<string, MemoryRecord>();

  constructor(private readonly eventStore: EventStore) {}

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
    this.records.set(record.id, record);
    await this.eventStore.recordMutation({
      memoryId: record.id,
      mutationType: "create",
      actor: record.source,
      summary: `created ${record.type} memory`,
    });
    return record;
  }

  async get(id: string, scope: ScopeRef): Promise<MemoryRecord | null> {
    const record = this.records.get(id);
    if (!record || !scopeIncludes(record.scope, scope)) return null;
    return record;
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
    this.records.set(updated.id, updated);
    await this.eventStore.recordMutation({
      memoryId: updated.id,
      mutationType: input.status === "archived" ? "archive" : "update",
      actor: { origin: "agent" },
      summary: input.status === "archived" ? "archived via update" : "updated fields",
    });
    return updated;
  }

  async archive(id: string, scope: ScopeRef): Promise<MemoryRecord> {
    return this.update({ id, status: "archived" }, scope);
  }

  async query(rawQuery: MemoryQuery): Promise<MemoryResult> {
    const matches = [...this.records.values()].filter((record) => {
      if (!scopeIncludes(record.scope, rawQuery.scope)) return false;
      if (rawQuery.type && record.type !== rawQuery.type) return false;
      if (rawQuery.status && record.status !== rawQuery.status) return false;
      if (rawQuery.tags && !rawQuery.tags.every((tag) => record.tags.includes(tag))) return false;
      return true;
    });
    return { items: matches.slice(0, rawQuery.limit) };
  }

  async purge(id: string, scope: ScopeRef): Promise<void> {
    const existing = await this.get(id, scope);
    if (existing) this.records.delete(id);
  }
}
