import type { MemoryRecord, MemoryCreateInput, MemoryUpdateInput, MemoryQuery, MemoryResult } from "./memory.js";
import type { ScopeRef } from "./scope.js";
import type { RetrievalQuery, Candidate } from "./retrieval.js";
import type { SimilarityPair } from "./signals.js";
import type {
  RetrievalEvent,
  ContextEvent,
  OutcomeEvent,
  FeedbackEvent,
  MemoryMutationEvent,
} from "./events.js";
import type { CodebaseRecord, CodeFileRecord, CodeChunkRecord } from "./codebase.js";

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
  /**
   * E25: pairwise similarity over an ALREADY scope-authorized set of memory
   * ids. Never returns a pair naming an id outside `memoryIds` -- this
   * function must not be able to widen scope, because it never receives one.
   * Vectors unavailable -> empty array, never a thrown error.
   */
  findSimilarPairs(memoryIds: string[], minSimilarity: number): Promise<SimilarityPair[]>;
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

/**
 * Phase 3.1. `replaceFile` is the single atomic write primitive -- it covers both
 * "new file" (no prior row) and "changed file" (prior row exists) because file ids
 * are deterministic per (repositoryId, relativePath), so the underlying write is
 * always a natural upsert. Implementations must delete the file's existing chunks
 * and write the new ones in the same transaction as the file-row upsert -- see
 * SqliteCodebaseRepository. Never returns/accepts a raw SQL handle; callers only
 * ever see CodebaseRecord/CodeFileRecord/CodeChunkRecord.
 */
export interface CodebaseRepository {
  findRepository(scope: ScopeRef, rootPath: string): Promise<CodebaseRecord | null>;
  createRepository(scope: ScopeRef, rootPath: string): Promise<CodebaseRecord>;
  markIndexed(repositoryId: string): Promise<void>;
  listFiles(repositoryId: string): Promise<CodeFileRecord[]>;
  replaceFile(
    file: CodeFileRecord,
    chunks: CodeChunkRecord[],
  ): Promise<{ chunksCreated: number; chunksRemoved: number }>;
  removeFile(fileId: string): Promise<{ chunksRemoved: number }>;
}
