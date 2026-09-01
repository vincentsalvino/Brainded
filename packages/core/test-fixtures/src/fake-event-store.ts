import { randomUUID } from "node:crypto";
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
import { assertContextMembershipConsistent } from "@brain/contracts";

/** In-memory EventStore for unit-testing core packages without a real database. */
export class FakeEventStore implements EventStore {
  readonly retrievalEvents: RetrievalEvent[] = [];
  readonly contextEvents: ContextEvent[] = [];
  readonly outcomeEvents: OutcomeEvent[] = [];
  readonly feedbackEvents: FeedbackEvent[] = [];
  readonly mutationEvents: MemoryMutationEvent[] = [];
  readonly contextEventSources: (ContextEventSource & { contextEventId: string })[] = [];

  async recordRetrieval(event: Omit<RetrievalEvent, "id" | "timestamp">): Promise<RetrievalEvent> {
    const full: RetrievalEvent = { ...event, id: randomUUID(), timestamp: new Date().toISOString() };
    this.retrievalEvents.push(full);
    return full;
  }

  async recordContext(event: Omit<ContextEvent, "id" | "timestamp">): Promise<ContextEvent> {
    // Same membership guard as SqliteEventStore -- the fake must reject a
    // divergent write for the same reason the real store does, or core packages
    // could pass tests against a laxer contract than production enforces.
    assertContextMembershipConsistent(event);
    const full: ContextEvent = { ...event, id: randomUUID(), timestamp: new Date().toISOString() };
    this.contextEvents.push(full);
    return full;
  }

  async getContextEvent(contextId: string): Promise<ContextEvent | null> {
    return this.contextEvents.find((e) => e.id === contextId) ?? null;
  }

  async recordOutcome(event: Omit<OutcomeEvent, "id" | "timestamp">): Promise<OutcomeEvent> {
    const full: OutcomeEvent = { ...event, id: randomUUID(), timestamp: new Date().toISOString() };
    this.outcomeEvents.push(full);
    return full;
  }

  async recordFeedback(event: Omit<FeedbackEvent, "id" | "timestamp">): Promise<FeedbackEvent> {
    const full: FeedbackEvent = { ...event, id: randomUUID(), timestamp: new Date().toISOString() };
    this.feedbackEvents.push(full);
    return full;
  }

  async recordMutation(event: Omit<MemoryMutationEvent, "id" | "timestamp">): Promise<MemoryMutationEvent> {
    const full: MemoryMutationEvent = { ...event, id: randomUUID(), timestamp: new Date().toISOString() };
    this.mutationEvents.push(full);
    return full;
  }

  async getEventsForTask(taskId: string): Promise<TaskEvents> {
    return {
      retrieval: this.retrievalEvents.filter((e) => e.taskId === taskId),
      context: this.contextEvents.filter((e) => e.taskId === taskId),
      outcome: this.outcomeEvents.filter((e) => e.taskId === taskId),
      feedback: this.feedbackEvents.filter((e) => e.taskId === taskId),
    };
  }

  async getEventsForMemory(memoryId: string): Promise<FeedbackEvent[]> {
    return this.feedbackEvents.filter((e) => e.memoryId === memoryId);
  }

  async getMutationsForMemory(memoryId: string): Promise<MemoryMutationEvent[]> {
    return this.mutationEvents.filter((e) => e.memoryId === memoryId);
  }

  async recordContextSources(contextEventId: string, sources: ContextEventSource[]): Promise<void> {
    for (const source of sources) this.contextEventSources.push({ ...source, contextEventId });
  }

  async getContextEventSources(contextEventId: string): Promise<ContextEventSource[]> {
    return this.contextEventSources.filter((s) => s.contextEventId === contextEventId);
  }
}
