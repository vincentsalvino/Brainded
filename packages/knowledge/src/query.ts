import { globalScope, type MemoryRecord } from "@brain/contracts";
import type { MemoryService } from "@brain/memory";

/**
 * Knowledge-vs-experience helper queries (PHASE_1_SPEC.md packages/knowledge).
 * Thin, like MemoryService/EventService -- delegates to MemoryService.query(),
 * scoped to `global` because seed/curated knowledge is inherently
 * non-project-specific (Step 4's scope determination). Not a separate physical
 * store: this reads the exact same `memories` rows the importer writes.
 */
export class KnowledgeQuery {
  constructor(private readonly memory: MemoryService) {}

  async listByDomain(domain: string): Promise<MemoryRecord[]> {
    const result = await this.memory.query({ scope: globalScope(), limit: 500 });
    return result.items.filter((item) => item.domain === domain);
  }
}
