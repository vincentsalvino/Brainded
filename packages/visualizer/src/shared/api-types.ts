import type {
  ContextEvent,
  ContextEventSource,
  FeedbackEvent,
  OutcomeEvent,
  MemoryMutationEvent,
  MemoryRecord,
  MemoryType,
  ScopeRef,
  SimilarityPair,
} from "@brain/contracts";

export interface OverviewResponse {
  memories: { total: number; active: number; archived: number; byType: Record<MemoryType, number> };
  events: { contextEvents: number; feedbackEvents: number; outcomeEvents: number; retrievalEvents: number };
  recentActivity: ActivityItem[];
  vectorSearchAvailable: boolean;
  appliedMigrations: string[];
  learning: { enabled: boolean };
  redundancy: { enabled: boolean };
  /**
   * Agent Workflow Integration V1 (docs/agent-integration/BRAIN_WORKFLOW_POLICY.md).
   * Coverage over tasks that left at least one trace -- see EventStore.getWorkflowAdherence's
   * doc comment (@brain/contracts) for what this can and can't see.
   */
  workflow: { tasksTracked: number; tasksWithContext: number; tasksWithFeedback: number; tasksWithOutcome: number };
}

export type ActivityItem =
  | { kind: "context"; timestamp: string; event: ContextEvent }
  | { kind: "feedback"; timestamp: string; event: FeedbackEvent }
  | { kind: "outcome"; timestamp: string; event: OutcomeEvent }
  | { kind: "mutation"; timestamp: string; event: MemoryMutationEvent };

export interface ContextListResponse {
  items: ContextEvent[];
}

export interface ContextDetailResponse {
  context: ContextEvent;
  sources: ContextEventSource[];
  feedback: FeedbackEvent[];
  outcomes: OutcomeEvent[];
}

// --- Memory graph -----------------------------------------------------------

/**
 * Minimal per-node display data for the global graph -- deliberately has NO
 * performance/usefulness field. Confidence (here) and usefulness (only ever on
 * MemoryDetailResponse, clearly labeled) must never be representable as one
 * merged value; keeping them on separate DTOs enforces that structurally,
 * the same discipline as "vectors never leave SQLite" applied to this signal.
 */
export interface GraphMemoryNode {
  id: string;
  type: MemoryType;
  scope: ScopeRef;
  confidence: number;
  tags: string[];
  createdAt: string;
  /** Server-truncated -- full content only in MemoryDetailResponse. Keeps a ~500-node payload small. */
  contentPreview: string;
}

/** `from` (newer) supersedes `to` (older) -- see MemoryRecord.supersedes. Directional, distinct from a similarity edge. */
export interface GraphSupersedesEdge {
  from: string;
  to: string;
}

export interface MemoryGraphMeta {
  /** The minSimilarity actually used for this response -- a VISUALIZATION threshold, unrelated to redundancy detection's. */
  threshold: number;
  totalMemories: number;
  totalEdges: number;
}

export interface MemoryGraphResponse {
  nodes: GraphMemoryNode[];
  similarityEdges: SimilarityPair[];
  supersedesEdges: GraphSupersedesEdge[];
  meta: MemoryGraphMeta;
}

export interface MemoryFeedbackSummary {
  useful: number;
  notUseful: number;
  other: number;
}

/**
 * DERIVED / EXPERIMENTAL -- computed on read from raw counts via the same
 * formula that would drive a ranking boost if learning were enabled (it
 * isn't). Never merge with MemoryRecord.confidence in the UI.
 */
export interface MemoryPerformanceView {
  usefulCount: number;
  notUsefulCount: number;
  redundantReasonCount: number;
  incorrectReasonCount: number;
  evidenceMass: number;
  usefulnessSignal: number;
}

export interface MemoryDetailResponse {
  memory: MemoryRecord;
  /** Similarity pairs touching this memory -- resolve the "other side" of each pair against the already-fetched node map, not a second payload. */
  neighbors: SimilarityPair[];
  /** Does some OTHER memory supersede this one? memory.supersedes already gives the reverse direction. */
  supersededBy: string | null;
  feedback: MemoryFeedbackSummary;
  deliveryCount: number;
  /** null = cold start (no aggregate row yet), never a fabricated zero. */
  performance: MemoryPerformanceView | null;
}
