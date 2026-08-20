import type { MemoryRecord, MemoryCreateInput, MemoryUpdateInput, MemoryQuery, MemoryResult } from "./memory.js";
import type { ScopeRef } from "./scope.js";
import type { RetrievalQuery, Candidate } from "./retrieval.js";
import type {
  RetrievalEvent,
  ContextEvent,
  OutcomeEvent,
  FeedbackEvent,
  MemoryMutationEvent,
} from "./events.js";

// Behavioral contracts only -- implementations live in packages/storage.
// packages/core/* depend on these interfaces, never on a concrete implementation
// or a DB driver directly. See PHASE_1_SPEC.md Storage Boundary / Package Architecture.

export interface MemoryRepository {
  /**
   * Every implementation must atomically write exactly one MemoryMutationEvent
   * (via EventStore.recordMutation) as part of create/update/archive -- this is an
   * invariant of the repository, not something callers must remember to trigger.
   */
  create(input: MemoryCreateInput): Promise<MemoryRecord>;
  get(id: string, scope: ScopeRef): Promise<MemoryRecord | null>;
  update(input: MemoryUpdateInput, scope: ScopeRef): Promise<MemoryRecord>;
  archive(id: string, scope: ScopeRef): Promise<MemoryRecord>;
  query(query: MemoryQuery): Promise<MemoryResult>;
  /** Hard delete. Interface-only in Phase 1 -- not exposed via any brain_* operation. */
  purge(id: string, scope: ScopeRef): Promise<void>;
}

export interface RetrievalStore {
  lexicalSearch(query: RetrievalQuery): Promise<Candidate[]>;
  semanticSearch(query: RetrievalQuery): Promise<Candidate[]>;
}

export interface TaskEvents {
  retrieval: RetrievalEvent[];
  context: ContextEvent[];
  outcome: OutcomeEvent[];
  feedback: FeedbackEvent[];
}

export interface EventStore {
  recordRetrieval(event: Omit<RetrievalEvent, "id" | "timestamp">): Promise<RetrievalEvent>;
  recordContext(event: Omit<ContextEvent, "id" | "timestamp">): Promise<ContextEvent>;
  recordOutcome(event: Omit<OutcomeEvent, "id" | "timestamp">): Promise<OutcomeEvent>;
  recordFeedback(event: Omit<FeedbackEvent, "id" | "timestamp">): Promise<FeedbackEvent>;
  recordMutation(event: Omit<MemoryMutationEvent, "id" | "timestamp">): Promise<MemoryMutationEvent>;
  /**
   * P2-005: lets the Gateway verify a caller-supplied contextId before accepting
   * feedback or an outcome against it. An unverifiable correlation id is worse
   * than none -- it produces confidently-wrong attribution later.
   */
  getContextEvent(contextId: string): Promise<ContextEvent | null>;
  getEventsForTask(taskId: string): Promise<TaskEvents>;
  getEventsForMemory(memoryId: string): Promise<FeedbackEvent[]>;
  getMutationsForMemory(memoryId: string): Promise<MemoryMutationEvent[]>;
}

export interface EmbeddingProvider {
  embed(text: string): Promise<number[]>;
}
