import type { RetrievalEvent, ContextEvent, FeedbackEvent, OutcomeEvent, MemoryRecord, ScopeRef } from "@brain/contracts";
import { EvalExampleSchema, type EvalExample, type EvalMemory } from "./types.js";

/**
 * 2C-002 (P2-016). Structurally satisfied by @brain/test-fixtures'
 * FakeEventStore directly (its four public readonly arrays match exactly) --
 * no wrapper needed. A SqliteEventStore-backed adapter for the real corpus is
 * a throwaway reporting script (Task 9), not committed production API surface
 * -- this package must not import @brain/storage.
 */
export interface EventTables {
  retrievalEvents: RetrievalEvent[];
  contextEvents: ContextEvent[];
  feedbackEvents: FeedbackEvent[];
  outcomeEvents: OutcomeEvent[];
}

/** Structurally satisfied by MemoryRepository/FakeMemoryRepository/SqliteMemoryRepository -- only the read method this needs. */
export interface MemoryLookup {
  get(memoryId: string, scope: ScopeRef): Promise<MemoryRecord | null>;
}

/**
 * Builds replayable EvalExample[] from real correlated events:
 *   RetrievalEvent -> ContextEvent -> ContextEventMemory[] -> FeedbackEvent[] -> OutcomeEvent?
 *
 * Grouped by ContextEvent.id (the precise delivery identifier, per E3/P2-005)
 * -- NOT by taskId, which is optional and was 0% populated before Phase 2B
 * (PHASE_2_FINDINGS.md 4.1). Historical context events without a resolvable
 * retrieval event, or with no per-item membership (pre-migration rows), are
 * skipped: this function never fabricates linkage that was not recorded.
 *
 * KNOWN LIMITATION: FeedbackEvent.reason === 'redundant' has no structured
 * field naming which OTHER memory it is redundant with (only free-text
 * `notes`). Exported examples therefore always carry redundantWith: {} --
 * this function cannot reconstruct redundancy edges from history. See
 * docs/PHASE_2C_FINDINGS.md.
 */
export async function exportFromEvents(
  events: EventTables,
  memories: MemoryLookup,
  options: { since?: string } = {},
): Promise<EvalExample[]> {
  const retrievalById = new Map(events.retrievalEvents.map((r) => [r.id, r]));
  const examples: EvalExample[] = [];

  for (const contextEvent of events.contextEvents) {
    if (options.since && contextEvent.timestamp < options.since) continue;
    if (contextEvent.memories.length === 0) continue; // pre-migration row: no per-item membership to export
    const retrievalEvent = retrievalById.get(contextEvent.retrievalEventId);
    if (!retrievalEvent) continue; // cannot recover task text without it -- skip rather than fabricate

    const feedbackForDelivery = events.feedbackEvents.filter((f) => f.contextId === contextEvent.id);
    const outcomeForDelivery = events.outcomeEvents.find((o) => o.contextId === contextEvent.id) ?? null;
    const feedbackByMemory = new Map(feedbackForDelivery.map((f) => [f.memoryId, f]));

    const includedIds = contextEvent.memories.filter((m) => m.included).map((m) => m.memoryId);
    if (includedIds.length === 0) continue;

    const evalMemories: EvalMemory[] = [];
    const labels: Record<string, 0 | 1 | 2> = {};

    for (const memoryId of includedIds) {
      const record = await memories.get(memoryId, contextEvent.scope);
      if (!record) continue; // archived/purged since delivery -- cannot replay its content

      evalMemories.push({ key: memoryId, type: record.type, content: record.content, scope: record.scope, confidence: record.confidence });

      const feedback = feedbackByMemory.get(memoryId);
      if (!feedback || feedback.useful === null) continue; // no judgement -> unlabeled
      if (feedback.useful === true) {
        labels[memoryId] = 2;
      } else if (feedback.reason !== "redundant") {
        // useful=false, reason irrelevant | incorrect | other | null -> tier-1 negative (PHASE_2_SPEC.md 2.3)
        labels[memoryId] = 0;
      }
      // reason === "redundant": redundancy relation, NOT evidence the memory is false -- neither grade applied.
    }

    if (evalMemories.length === 0) continue; // every included memory was archived/purged since delivery

    examples.push(
      EvalExampleSchema.parse({
        id: contextEvent.id,
        task: retrievalEvent.queryText,
        scope: contextEvent.scope,
        memories: evalMemories,
        labels,
        redundantWith: {},
        notes:
          `exported from contextEvent ${contextEvent.id}` +
          (contextEvent.taskId ? `, taskId ${contextEvent.taskId}` : ""),
        outcome: outcomeForDelivery?.outcome ?? null,
      }),
    );
  }

  return examples;
}
