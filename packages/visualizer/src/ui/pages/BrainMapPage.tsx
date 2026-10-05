import { useMemo } from "react";
import { api } from "../api-client";
import { useFetch } from "../use-fetch";
import { EmptyState } from "../components/EmptyState";
import { GraphCanvas, type TraceState } from "../components/GraphCanvas";
import { MemoryInspector } from "../components/MemoryInspector";
import { Skeleton } from "../components/Skeleton";

interface BrainMapPageProps {
  activeContextId: string | null;
  onClearContext: () => void;
  selectedMemoryId: string | null;
  onSelectMemory: (id: string | null) => void;
  searchQuery: string;
  onSearchQueryChange: (query: string) => void;
}

/**
 * View state (selection, trace, search) is owned by App.tsx, not here -- it
 * needs to be visible to App's Escape-key handling, which coordinates
 * selectedMemoryId and activeContextId together (topmost overlay closes
 * first). This page is a controlled view over that state plus its own data
 * fetch.
 */
export function BrainMapPage({
  activeContextId,
  onClearContext,
  selectedMemoryId,
  onSelectMemory,
  searchQuery,
  onSearchQueryChange,
}: BrainMapPageProps) {
  const { data: graph, error } = useFetch(() => api.getMemoryGraph(), []);
  const { data: contextDetail } = useFetch(
    () => (activeContextId ? api.getContextDetail(activeContextId) : Promise.resolve(null)),
    [activeContextId],
  );

  const nodesById = useMemo(() => new Map((graph?.nodes ?? []).map((n) => [n.id, n])), [graph]);

  const traceHighlight = useMemo(() => {
    if (!contextDetail) return null;
    const map = new Map<string, TraceState>();
    for (const id of contextDetail.context.includedMemoryIds) map.set(id, "included");
    for (const id of contextDetail.context.omittedMemoryIds) map.set(id, "omitted");
    return map;
  }, [contextDetail]);

  const matchedIds = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();
    if (!query || !graph) return null;
    const ids = graph.nodes
      .filter((n) => n.contentPreview.toLowerCase().includes(query) || n.tags.some((t) => t.toLowerCase().includes(query)))
      .map((n) => n.id);
    return new Set(ids);
  }, [graph, searchQuery]);

  if (error) return <EmptyState message={`failed to load memory graph: ${error.message}`} tone="error" />;

  return (
    <div className="brain-map">
      {!graph && (
        <span className="sr-only" role="status">
          Loading brain map…
        </span>
      )}

      <div className="brain-map-toolbar">
        <input
          type="text"
          className="mono"
          placeholder="Search memories..."
          value={searchQuery}
          onChange={(e) => onSearchQueryChange(e.target.value)}
        />
        {graph ? (
          <span className="meta mono">
            {graph.meta.totalMemories} memories · {graph.meta.totalEdges} relationships · threshold {graph.meta.threshold}
          </span>
        ) : (
          <Skeleton width={280} height={14} />
        )}
        {activeContextId && contextDetail && (
          <span className="badge included mono">
            Context Trace: task {contextDetail.context.taskId ?? "(none)"} · {contextDetail.context.timestamp}
            {contextDetail.outcomes.length > 0 && ` · ${contextDetail.outcomes.map((o) => o.outcome).join(", ")}`}
            <button type="button" onClick={onClearContext} style={{ marginLeft: 6 }}>
              back to full graph
            </button>
          </span>
        )}
      </div>

      {!graph ? (
        <div className="brain-map-body">
          <div className="brain-map-canvas">
            <Skeleton width="100%" height="100%" />
          </div>
        </div>
      ) : graph.nodes.length === 0 ? (
        <EmptyState message="No memories indexed yet." />
      ) : (
        <div className="brain-map-body">
          <div className="brain-map-canvas">
            <GraphCanvas
              nodes={graph.nodes}
              similarityEdges={graph.similarityEdges}
              supersedesEdges={graph.supersedesEdges}
              selectedMemoryId={selectedMemoryId}
              onSelectMemory={onSelectMemory}
              traceHighlight={traceHighlight}
              matchedIds={matchedIds}
            />
          </div>
          {selectedMemoryId && (
            <MemoryInspector
              id={selectedMemoryId}
              nodesById={nodesById}
              onClose={() => onSelectMemory(null)}
              onSelectNeighbor={onSelectMemory}
              contextTrace={activeContextId ? contextDetail : null}
            />
          )}
        </div>
      )}
    </div>
  );
}
