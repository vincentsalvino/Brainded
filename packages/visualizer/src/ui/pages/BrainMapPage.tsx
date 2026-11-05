import { useMemo } from "react";
import { api } from "../api-client";
import { useFetch } from "../use-fetch";
import { EmptyState } from "../components/EmptyState";
import { GraphCanvas, type TraceState } from "../components/GraphCanvas";
import { MemoryInspector } from "../components/MemoryInspector";
import { Skeleton } from "../components/Skeleton";
import { MEMORY_TYPE_COLORS } from "../memory-type-colors";

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
  const visibleTypes = useMemo(() => [...new Set((graph?.nodes ?? []).map((node) => node.type))].sort(), [graph]);

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

      <div className="brain-map-header">
        <div className="brain-map-title">
          <h1>Memory map</h1>
          {graph ? (
            <span className="graph-summary">
              {graph.meta.totalMemories} memories · {graph.meta.totalEdges} relationships
            </span>
          ) : (
            <Skeleton width={172} height={12} />
          )}
        </div>
        <div className="brain-map-search">
          <input
            type="search"
            aria-label="Search memories"
            placeholder="Search memories..."
            value={searchQuery}
            onChange={(e) => onSearchQueryChange(e.target.value)}
          />
          {matchedIds && (
            <span className="search-results" role="status">
              {matchedIds.size} {matchedIds.size === 1 ? "match" : "matches"}
            </span>
          )}
        </div>
      </div>

      {activeContextId && contextDetail && (
        <span className="context-trace badge included">
          Context Trace: task {contextDetail.context.taskId ?? "(none)"} · {contextDetail.context.timestamp}
          {contextDetail.outcomes.length > 0 && ` · ${contextDetail.outcomes.map((o) => o.outcome).join(", ")}`}
          <button type="button" onClick={onClearContext}>Back to full graph</button>
        </span>
      )}

      {graph?.nodes.length === 0 ? (
        <EmptyState message="No memories indexed yet." />
      ) : (
        <div className="brain-map-frame">
          <div className="brain-map-body">
            {graph ? (
              <GraphCanvas
                nodes={graph.nodes}
                similarityEdges={graph.similarityEdges}
                supersedesEdges={graph.supersedesEdges}
                selectedMemoryId={selectedMemoryId}
                onSelectMemory={onSelectMemory}
                traceHighlight={traceHighlight}
                matchedIds={matchedIds}
              />
            ) : (
              <Skeleton width="100%" height="100%" />
            )}
            {graph && selectedMemoryId && (
              <MemoryInspector
                id={selectedMemoryId}
                nodesById={nodesById}
                onClose={() => onSelectMemory(null)}
                onSelectNeighbor={onSelectMemory}
                contextTrace={activeContextId ? contextDetail : null}
              />
            )}
          </div>
          {graph && (
            <div className="graph-caption">
              <div className="graph-legend" aria-label="Memory types">
                {visibleTypes.map((type) => (
                  <span key={type}><i style={{ backgroundColor: MEMORY_TYPE_COLORS[type] }} />{type.replaceAll("_", " ")}</span>
                ))}
              </div>
              <div className="graph-legend" aria-label="Relationships">
                <span className="relationship-key"><i />Similarity</span>
                {graph.supersedesEdges.length > 0 && <span className="relationship-key supersedes"><i />Supersedes</span>}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
