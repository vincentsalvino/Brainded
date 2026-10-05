import type { MemoryRepository, EventStore, RetrievalStore, MemoryPerformanceStore, MemoryRecord, ScopeRef, SimilarityPair } from "@brain/contracts";
import { DEFAULT_LEARNING_CONFIG } from "@brain/contracts";
import { computeUsefulnessSignal } from "@brain/learning";
import type {
  ActivityItem,
  OverviewResponse,
  ContextListResponse,
  ContextDetailResponse,
  MemoryGraphResponse,
  MemoryDetailResponse,
  GraphMemoryNode,
  GraphSupersedesEdge,
} from "../shared/api-types.js";

const RECENT_ACTIVITY_LIMIT = 20;
const CONTEXT_LIST_LIMIT = 20;
const GRAPH_NODE_LIMIT = 500;
// Visualization default, chosen from the real corpus's edge/isolated-node distribution
// (see docs/architecture/VISUALIZER_ARCHITECTURE.md) -- deliberately independent of redundancy
// detection's DEFAULT_NEAR_DUPLICATE_POLICY.candidateFloor (0.75 + a separate lexical
// containment check, a different algorithm answering a different question). A graph
// edge here means "related," never "duplicate."
const DEFAULT_GRAPH_MIN_SIMILARITY = 0.6;
const CONTENT_PREVIEW_LENGTH = 140;

function contentPreview(content: string): string {
  return content.length <= CONTENT_PREVIEW_LENGTH ? content : content.slice(0, CONTENT_PREVIEW_LENGTH) + "…";
}

/**
 * Observability read model over the Brain's storage -- parallel to Gateway, not
 * routed through it (Gateway's job is Brain operations; this is dashboard-shaped
 * reads, a different semantic category). Takes the full MemoryRepository/EventStore
 * interfaces, not a hand-carved read-only subset: the actual mutation-proof
 * guarantee is the readonly DB connection one layer down (bootstrap.ts), which a
 * TypeScript-only interface split can't strengthen.
 */
export class VisualizerQueryService {
  constructor(
    private readonly memories: MemoryRepository,
    private readonly events: EventStore,
    private readonly retrieval: RetrievalStore,
    private readonly performance: MemoryPerformanceStore,
    private readonly capabilities: { vectorSearchAvailable: boolean; appliedMigrations: string[] },
  ) {}

  async getOverview(): Promise<OverviewResponse> {
    const [memoryCounts, eventCounts, contexts, feedback, outcomes, mutations, workflow] = await Promise.all([
      this.memories.countAllMemories(),
      this.events.getEventCounts(),
      this.events.listRecentContextEvents(RECENT_ACTIVITY_LIMIT),
      this.events.listRecentFeedbackEvents(RECENT_ACTIVITY_LIMIT),
      this.events.listRecentOutcomeEvents(RECENT_ACTIVITY_LIMIT),
      this.events.listRecentMutationEvents(RECENT_ACTIVITY_LIMIT),
      this.events.getWorkflowAdherence(),
    ]);

    const recentActivity: ActivityItem[] = [
      ...contexts.map((event): ActivityItem => ({ kind: "context", timestamp: event.timestamp, event })),
      ...feedback.map((event): ActivityItem => ({ kind: "feedback", timestamp: event.timestamp, event })),
      ...outcomes.map((event): ActivityItem => ({ kind: "outcome", timestamp: event.timestamp, event })),
      ...mutations.map((event): ActivityItem => ({ kind: "mutation", timestamp: event.timestamp, event })),
    ]
      .sort((a, b) => (a.timestamp < b.timestamp ? 1 : a.timestamp > b.timestamp ? -1 : 0))
      .slice(0, RECENT_ACTIVITY_LIMIT);

    return {
      memories: memoryCounts,
      events: eventCounts,
      recentActivity,
      vectorSearchAvailable: this.capabilities.vectorSearchAvailable,
      appliedMigrations: this.capabilities.appliedMigrations,
      learning: { enabled: false }, // mirrors DEFAULT_LEARNING_CONFIG.enabled (@brain/contracts)
      redundancy: { enabled: false }, // mirrors Gateway's constructor default (@brain/gateway)
      workflow,
    };
  }

  async listContexts(limit: number = CONTEXT_LIST_LIMIT): Promise<ContextListResponse> {
    return { items: await this.events.listRecentContextEvents(limit) };
  }

  async getContextDetail(id: string): Promise<ContextDetailResponse | null> {
    const context = await this.events.getContextEvent(id);
    if (!context) return null;
    const [sources, feedback, outcomes] = await Promise.all([
      this.events.getContextEventSources(id),
      this.events.getFeedbackForContext(id),
      this.events.getOutcomesForContext(id),
    ]);
    return { context, sources, feedback, outcomes };
  }

  /**
   * Shared by getMemoryGraph and getMemoryDetail -- one fetch of the corpus plus
   * one findSimilarPairs call, never duplicated. Recomputes the whole corpus's
   * pairs even for a single-memory detail lookup (filtered afterwards); at this
   * corpus size that's one SQL query, and a dedicated "neighbors of one node"
   * query isn't worth building yet -- see docs/architecture/VISUALIZER_ARCHITECTURE.md.
   */
  private async fetchGraphComputation(options?: {
    scope?: ScopeRef;
    minSimilarity?: number;
    limit?: number;
  }): Promise<{ memories: MemoryRecord[]; similarityEdges: SimilarityPair[]; supersedesEdges: GraphSupersedesEdge[] }> {
    const minSimilarity = options?.minSimilarity ?? DEFAULT_GRAPH_MIN_SIMILARITY;
    const memories = await this.memories.listAllMemories({
      ...(options?.scope !== undefined ? { scope: options.scope } : {}),
      limit: options?.limit ?? GRAPH_NODE_LIMIT,
    });
    const ids = memories.map((m) => m.id);
    const idSet = new Set(ids);

    const similarityEdges = await this.retrieval.findSimilarPairs(ids, minSimilarity);

    const supersedesEdges: GraphSupersedesEdge[] = [];
    for (const m of memories) {
      if (m.supersedes && idSet.has(m.supersedes)) supersedesEdges.push({ from: m.id, to: m.supersedes });
    }

    return { memories, similarityEdges, supersedesEdges };
  }

  async getMemoryGraph(options?: { scope?: ScopeRef; minSimilarity?: number; limit?: number }): Promise<MemoryGraphResponse> {
    const minSimilarity = options?.minSimilarity ?? DEFAULT_GRAPH_MIN_SIMILARITY;
    const { memories, similarityEdges, supersedesEdges } = await this.fetchGraphComputation(options);

    const nodes: GraphMemoryNode[] = memories.map((m) => ({
      id: m.id,
      type: m.type,
      scope: m.scope,
      confidence: m.confidence,
      tags: m.tags,
      createdAt: m.createdAt,
      contentPreview: contentPreview(m.content),
    }));

    return {
      nodes,
      similarityEdges,
      supersedesEdges,
      meta: {
        threshold: minSimilarity,
        totalMemories: nodes.length,
        totalEdges: similarityEdges.length + supersedesEdges.length,
      },
    };
  }

  async getMemoryDetail(id: string): Promise<MemoryDetailResponse | null> {
    const memory = await this.memories.getMemoryById(id);
    if (!memory) return null;

    const [{ memories: corpus, similarityEdges }, feedbackEvents, deliveryCount, performanceBatch] = await Promise.all([
      this.fetchGraphComputation(),
      this.events.getEventsForMemory(id),
      this.events.countDeliveriesForMemory(id),
      this.performance.getPerformanceBatch([id]),
    ]);

    const neighbors = similarityEdges.filter((pair) => pair.a === id || pair.b === id);
    const supersededBy = corpus.find((m) => m.supersedes === id)?.id ?? null;

    const feedback = { useful: 0, notUseful: 0, other: 0 };
    for (const event of feedbackEvents) {
      if (event.useful === true) feedback.useful++;
      else if (event.useful === false) feedback.notUseful++;
      else feedback.other++;
    }

    const raw = performanceBatch.get(id);
    const performance = raw
      ? {
          usefulCount: raw.usefulCount,
          notUsefulCount: raw.notUsefulCount,
          redundantReasonCount: raw.redundantReasonCount,
          incorrectReasonCount: raw.incorrectReasonCount,
          ...computeUsefulnessSignal(raw, DEFAULT_LEARNING_CONFIG),
        }
      : null;

    return { memory, neighbors, supersededBy, feedback, deliveryCount, performance };
  }
}
