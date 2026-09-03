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
  ContextEventSource,
} from "./events.js";
import type { MemoryPerformanceRaw } from "./learning.js";
import type { CodebaseRecord, CodeFileRecord, CodeChunkRecord } from "./codebase.js";
import type { CodeSearchQuery, CodeSearchResult, CodeSyncResult } from "./code-search.js";
import type { CodeDependencyEdge, DependencyResolution } from "./code-dependency.js";

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
  /** Additive code/dependency delivery telemetry -- see events.ts's ContextEventSource. */
  recordContextSources(contextEventId: string, sources: ContextEventSource[]): Promise<void>;
  getContextEventSources(contextEventId: string): Promise<ContextEventSource[]>;
}

/**
 * Phase 4.1 (PHASE_4_SPEC.md 2.4). Read-batch plus rebuild only -- no `record*` method: the
 * write path lives inside SqliteEventStore.recordFeedback/recordOutcome's own transaction
 * (F12), the same way insertMutationEventRow is called synchronously inside
 * SqliteMemoryRepository's transaction today rather than being a separate interface method
 * callers must remember to invoke.
 */
export interface MemoryPerformanceStore {
  /** Rows present in the returned Map only for memoryIds that have an aggregate; no entry means cold start. */
  getPerformanceBatch(memoryIds: string[]): Promise<Map<string, MemoryPerformanceRaw>>;
  /** Recomputes every row from raw feedback_events/outcome_events. Ground truth (F11) -- must equal incremental state exactly. */
  rebuildAll(): Promise<{ memoriesRebuilt: number }>;
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

/**
 * Phase 3.2. Deliberately separate from RetrievalStore, not an overload of it --
 * see PHASE_3_SPEC.md Part B (Candidate Ownership Decision, CASE B): CodeSearchResult
 * is not a Candidate, so a code search store is not a RetrievalStore. Mirrors
 * RetrievalStore's two-method shape (lexicalSearch/semanticSearch, same degradation
 * policy: semantic failure throws for the caller to catch and degrade, never silently
 * swallowed here) plus syncEmbeddings, kept on this interface because it is the same
 * "code search index" concern (FTS5 + vector), not because it shares RetrievalStore's
 * contract -- @brain/codebase's CodebaseRepository is untouched by this addition.
 */
export interface CodeSearchStore {
  lexicalSearch(query: CodeSearchQuery): Promise<CodeSearchResult[]>;
  semanticSearch(query: CodeSearchQuery): Promise<CodeSearchResult[]>;
  /**
   * Incremental: embeds only chunks new or changed since the last sync (by
   * contentHash), removes vector entries for chunks no longer present. Never
   * throws on an unavailable vector backend -- returns `{available: false}`,
   * mirroring RetrievalStore.findSimilarPairs' existing degradation shape.
   */
  syncEmbeddings(repositoryId: string): Promise<CodeSyncResult>;
}

/**
 * Phase 3.3. Raw edge access + write/sync primitives -- separate from
 * DependencyGraphService (packages/codebase), which owns graph semantics
 * (internal-only filtering, transitive traversal, cycle safety). This interface
 * returns edges of ANY resolution (unresolved/external included -- diagnostic
 * value, per PHASE_3_SPEC.md); the graph service filters to resolution==='internal'
 * for traversal. repositoryId is the isolation key, matching CodebaseRepository's
 * own convention (not a separately-threaded ScopeRef parameter).
 */
export interface CodeDependencyStore {
  /**
   * Atomic delete-old/insert-new for one source file's outgoing edges, plus the
   * contentHash tracking row -- same single-primitive shape as
   * CodebaseRepository.replaceFile (covers both "new file" and "changed file").
   */
  replaceOutgoingEdges(
    repositoryId: string,
    sourceFileId: string,
    contentHash: string,
    edges: CodeDependencyEdge[],
  ): Promise<{ edgesCreated: number; edgesRemoved: number }>;
  /** Bulk, not per-file: the synchronizer needs the whole repository's tracked state at once to decide what changed. */
  listDependencyState(repositoryId: string): Promise<{ fileId: string; contentHash: string }[]>;
  listEdges(repositoryId: string): Promise<CodeDependencyEdge[]>;
  /** Targeted update for the re-resolve pass -- never rewrites a whole file's edge set just to fix one resolution. */
  updateEdgeResolution(edgeId: string, resolution: DependencyResolution, targetFileId: string | null): Promise<void>;
  dependenciesOf(repositoryId: string, fileId: string): Promise<CodeDependencyEdge[]>;
  dependentsOf(repositoryId: string, fileId: string): Promise<CodeDependencyEdge[]>;
  /** Removes a source file's outgoing edges and its dependency-state row -- used when the file itself is gone from the codebase index. */
  removeFileState(repositoryId: string, sourceFileId: string): Promise<{ edgesRemoved: number }>;
}
