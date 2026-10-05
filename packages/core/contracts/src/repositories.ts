import type { MemoryRecord, MemoryCreateInput, MemoryUpdateInput, MemoryQuery, MemoryResult, MemoryType } from "./memory.js";
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
  /**
   * Deliberately UNSCOPED -- reads across every scope at once, with no ScopeRef
   * parameter to misuse (its absence is the safety mechanism, not an
   * optional/ignorable one). Exists only for packages/visualizer's global
   * Overview, which has no project/session selector in V0.1 by product
   * decision. Returns aggregate counts only, never record content. Every other
   * method here enforces scope in SQL -- see scopeWhere's doc comment in
   * memory-repository.ts for why that rule exists. See also listAllMemories/
   * getMemoryById below, the same exception for full records.
   */
  countAllMemories(): Promise<{ total: number; active: number; archived: number; byType: Record<MemoryType, number> }>;
  /**
   * Every active memory (status='active' only -- archived memories are not
   * graph nodes), optionally scope-filtered via the same scopeWhere logic
   * every other method uses. Scope omitted -> every scope at once, same
   * deliberate exception as countAllMemories -- packages/visualizer's global
   * memory graph has no scope selector in V0.1. `limit` defaults to
   * MemoryQuerySchema's existing max (500): reusing an existing ceiling rather
   * than inventing a new one.
   */
  listAllMemories(options?: { scope?: ScopeRef; limit?: number }): Promise<MemoryRecord[]>;
  /**
   * Unscoped equivalent of get(id, scope) -- needed because a click on the
   * unscoped global graph has no caller-scope to enforce against. No status
   * filter, mirroring get()'s own unfiltered-by-status behavior.
   */
  getMemoryById(id: string): Promise<MemoryRecord | null>;
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

  // --- Observability reads (packages/visualizer) --------------------------
  // Unfiltered/aggregate reads for a dashboard, not task/memory correlation --
  // deliberately separate from the lookup methods above.

  /** Row counts across the four event tables. */
  getEventCounts(): Promise<{
    contextEvents: number;
    feedbackEvents: number;
    outcomeEvents: number;
    retrievalEvents: number;
  }>;
  /**
   * Newest first. Every ContextEvent already has exactly one paired
   * RetrievalEvent, so this -- not a listRecentRetrievalEvents -- is what an
   * activity feed shows; listing both would double every delivery.
   */
  listRecentContextEvents(limit: number): Promise<ContextEvent[]>;
  /** Newest first. */
  listRecentFeedbackEvents(limit: number): Promise<FeedbackEvent[]>;
  /** Newest first. */
  listRecentOutcomeEvents(limit: number): Promise<OutcomeEvent[]>;
  /** Newest first -- unlike getMutationsForMemory (oldest first, a per-memory audit trail). */
  listRecentMutationEvents(limit: number): Promise<MemoryMutationEvent[]>;
  /**
   * Feedback recorded against this exact contextId -- NOT taskId. taskId is
   * nullable, and one task can have multiple context deliveries, so filtering by
   * taskId here would either miss a context (no taskId) or leak a sibling
   * delivery's feedback into the wrong context's detail view.
   */
  getFeedbackForContext(contextId: string): Promise<FeedbackEvent[]>;
  /** Same contextId-exactness reasoning as getFeedbackForContext. An array: nothing enforces one outcome per context. */
  getOutcomesForContext(contextId: string): Promise<OutcomeEvent[]>;
  /** Count of context deliveries that actually included this memory (context_event_memories.included = 1). */
  countDeliveriesForMemory(memoryId: string): Promise<number>;
  /**
   * Agent Workflow Integration V1 (docs/agent-integration/BRAIN_WORKFLOW_POLICY.md).
   * Coverage over tasks that left at least one trace -- a taskId on a context or
   * outcome event. Cannot see a task that skipped brain_context entirely: that
   * task mints no taskId anywhere, so it leaves nothing to count. Not a
   * substitute for a true substantive-task denominator, which nothing here
   * computes.
   */
  getWorkflowAdherence(): Promise<{
    tasksTracked: number;
    tasksWithContext: number;
    tasksWithFeedback: number;
    tasksWithOutcome: number;
  }>;
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
