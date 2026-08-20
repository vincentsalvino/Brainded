import type {
  MemoryRepository,
  MemoryRecord,
  MemoryCreateInput,
  MemoryUpdateInput,
  MemoryQuery,
  MemoryResult,
  ScopeRef,
} from "@brain/contracts";

/**
 * ponytail: this is a deliberately thin pass-through, not padded logic. Every rule
 * PHASE_1_SPEC.md assigned to "packages/core/memory" (scope enforcement, one audit
 * event per mutation, lifecycle-transition validity) ended up correctly living in
 * SqliteMemoryRepository instead, because the audit write must be atomic with the
 * mutation it describes -- that atomicity only exists at the storage layer.
 *
 * What this class still buys, for real: packages/mcp's dependency rule routes
 * through core/* services, never a raw repository interface, so an MCP handler
 * never needs to know or care whether "memory" is backed by SQLite today or
 * something else later. Phase 4 will also need a real place to add
 * usefulness-aware behavior on top of raw CRUD (e.g. auto-promoting confidence on
 * repeated confirmed use) without touching MCP or storage -- this is that seam.
 * Today it does nothing that repository.create() doesn't already do on its own.
 */
export class MemoryService {
  constructor(private readonly repository: MemoryRepository) {}

  create(input: MemoryCreateInput): Promise<MemoryRecord> {
    return this.repository.create(input);
  }

  get(id: string, scope: ScopeRef): Promise<MemoryRecord | null> {
    return this.repository.get(id, scope);
  }

  update(input: MemoryUpdateInput, scope: ScopeRef): Promise<MemoryRecord> {
    return this.repository.update(input, scope);
  }

  archive(id: string, scope: ScopeRef): Promise<MemoryRecord> {
    return this.repository.archive(id, scope);
  }

  query(query: MemoryQuery): Promise<MemoryResult> {
    return this.repository.query(query);
  }
}
