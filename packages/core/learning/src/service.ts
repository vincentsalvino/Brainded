import type {
  EventStore,
  TaskEvents,
  RetrievalEvent,
  ContextEvent,
  OutcomeEvent,
  FeedbackEvent,
  MemoryMutationEvent,
  ContextEventSource,
} from "@brain/contracts";

/**
 * ponytail: thin pass-through today, same reasoning as MemoryService in
 * packages/core/memory -- SqliteEventStore already owns the actual writes. The
 * seam matters here specifically because Phase 4 (BUILD_PLAN.md) adds real
 * aggregation logic (usefulness scores, promotion signals) ON TOP of this same
 * class without touching MCP or storage. Phase 1's job for this class is narrower
 * and more important than it looks: prove recordOutcome/recordFeedback are real,
 * callable, and correctly linked -- see the end-to-end test in service.test.ts,
 * which exists specifically because both AEOS and AEOS-brain shipped this exact
 * path silently broken (AEOS_COMPARISON.md 6).
 */
export class EventService {
  constructor(private readonly store: EventStore) {}

  recordRetrieval(event: Omit<RetrievalEvent, "id" | "timestamp">): Promise<RetrievalEvent> {
    return this.store.recordRetrieval(event);
  }

  recordContext(event: Omit<ContextEvent, "id" | "timestamp">): Promise<ContextEvent> {
    return this.store.recordContext(event);
  }

  recordOutcome(event: Omit<OutcomeEvent, "id" | "timestamp">): Promise<OutcomeEvent> {
    return this.store.recordOutcome(event);
  }

  recordFeedback(event: Omit<FeedbackEvent, "id" | "timestamp">): Promise<FeedbackEvent> {
    return this.store.recordFeedback(event);
  }

  recordMutation(event: Omit<MemoryMutationEvent, "id" | "timestamp">): Promise<MemoryMutationEvent> {
    return this.store.recordMutation(event);
  }

  getContextEvent(contextId: string): Promise<ContextEvent | null> {
    return this.store.getContextEvent(contextId);
  }

  getEventsForTask(taskId: string): Promise<TaskEvents> {
    return this.store.getEventsForTask(taskId);
  }

  getEventsForMemory(memoryId: string): Promise<FeedbackEvent[]> {
    return this.store.getEventsForMemory(memoryId);
  }

  getMutationsForMemory(memoryId: string): Promise<MemoryMutationEvent[]> {
    return this.store.getMutationsForMemory(memoryId);
  }

  recordContextSources(contextEventId: string, sources: ContextEventSource[]): Promise<void> {
    return this.store.recordContextSources(contextEventId, sources);
  }

  getContextEventSources(contextEventId: string): Promise<ContextEventSource[]> {
    return this.store.getContextEventSources(contextEventId);
  }
}
