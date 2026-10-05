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

  // --- Observability reads (packages/visualizer) --------------------------
  // Mirrors SqliteEventStore's equivalent methods -- see its doc comments for why
  // these are shaped the way they are (contextId not taskId, mutations not
  // retrieval in the recent-list set, etc.).

  async getEventCounts(): Promise<{
    contextEvents: number;
    feedbackEvents: number;
    outcomeEvents: number;
    retrievalEvents: number;
  }> {
    return {
      contextEvents: this.contextEvents.length,
      feedbackEvents: this.feedbackEvents.length,
      outcomeEvents: this.outcomeEvents.length,
      retrievalEvents: this.retrievalEvents.length,
    };
  }

  private static byTimestampDesc<T extends { timestamp: string }>(items: readonly T[]): T[] {
    return [...items].sort((a, b) => (a.timestamp < b.timestamp ? 1 : a.timestamp > b.timestamp ? -1 : 0));
  }

  async listRecentContextEvents(limit: number): Promise<ContextEvent[]> {
    return FakeEventStore.byTimestampDesc(this.contextEvents).slice(0, limit);
  }

  async listRecentFeedbackEvents(limit: number): Promise<FeedbackEvent[]> {
    return FakeEventStore.byTimestampDesc(this.feedbackEvents).slice(0, limit);
  }

  async listRecentOutcomeEvents(limit: number): Promise<OutcomeEvent[]> {
    return FakeEventStore.byTimestampDesc(this.outcomeEvents).slice(0, limit);
  }

  async listRecentMutationEvents(limit: number): Promise<MemoryMutationEvent[]> {
    return FakeEventStore.byTimestampDesc(this.mutationEvents).slice(0, limit);
  }

  async getFeedbackForContext(contextId: string): Promise<FeedbackEvent[]> {
    return this.feedbackEvents.filter((e) => e.contextId === contextId);
  }

  async getOutcomesForContext(contextId: string): Promise<OutcomeEvent[]> {
    return this.outcomeEvents.filter((e) => e.contextId === contextId);
  }

  async countDeliveriesForMemory(memoryId: string): Promise<number> {
    return this.contextEvents.filter((e) => e.memories.some((m) => m.memoryId === memoryId && m.included)).length;
  }

  async getWorkflowAdherence(): Promise<{
    tasksTracked: number;
    tasksWithContext: number;
    tasksWithFeedback: number;
    tasksWithOutcome: number;
  }> {
    const taskIds = new Set<string>();
    for (const e of this.contextEvents) if (e.taskId) taskIds.add(e.taskId);
    for (const e of this.outcomeEvents) taskIds.add(e.taskId);

    let tasksWithContext = 0;
    let tasksWithFeedback = 0;
    let tasksWithOutcome = 0;
    for (const taskId of taskIds) {
      if (this.contextEvents.some((e) => e.taskId === taskId)) tasksWithContext++;
      if (this.feedbackEvents.some((e) => e.taskId === taskId)) tasksWithFeedback++;
      if (this.outcomeEvents.some((e) => e.taskId === taskId)) tasksWithOutcome++;
    }
    return { tasksTracked: taskIds.size, tasksWithContext, tasksWithFeedback, tasksWithOutcome };
  }
}
