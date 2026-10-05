import { useMemo } from "react";
import type { GraphMemoryNode, GraphSupersedesEdge } from "../../shared/api-types";
import type { SimilarityPair } from "@brain/contracts";
import { useForceLayout, GRAPH_WIDTH, GRAPH_HEIGHT, type SimNode, type SimLink } from "../use-force-layout";
import { MEMORY_TYPE_COLORS } from "../memory-type-colors";

export type TraceState = "included" | "omitted";

interface GraphCanvasProps {
  nodes: GraphMemoryNode[];
  similarityEdges: SimilarityPair[];
  supersedesEdges: GraphSupersedesEdge[];
  selectedMemoryId: string | null;
  onSelectMemory: (id: string) => void;
  traceHighlight?: Map<string, TraceState> | null;
  matchedIds?: Set<string> | null;
}

function nodeRadius(confidence: number): number {
  return 4 + confidence * 6;
}

/** forceLink() resolves a link's source/target from a plain id string to the actual SimNode object on first tick (in place) -- this reads correctly either side of that mutation. */
function endpointId(end: string | number | SimNode | undefined): string | number | undefined {
  return typeof end === "object" ? end?.id : end;
}

export function GraphCanvas({
  nodes,
  similarityEdges,
  supersedesEdges,
  selectedMemoryId,
  onSelectMemory,
  traceHighlight = null,
  matchedIds = null,
}: GraphCanvasProps) {
  // Stable object identity unless the underlying DATA changes -- not on every
  // selection/trace/search re-render, or the simulation would never settle
  // (useForceLayout's effect depends on [nodes, links] by reference).
  const simNodes = useMemo<SimNode[]>(
    () => nodes.map((n) => ({ id: n.id, radius: nodeRadius(n.confidence) })),
    [nodes],
  );
  const simLinks = useMemo<SimLink[]>(
    () => [
      ...similarityEdges.map((e): SimLink => ({ source: e.a, target: e.b, kind: "similarity", similarity: e.similarity })),
      ...supersedesEdges.map((e): SimLink => ({ source: e.from, target: e.to, kind: "supersedes" })),
    ],
    [similarityEdges, supersedesEdges],
  );

  const {
    svgRef,
    viewportRef,
    registerNode,
    registerLink,
    handlePointerDown,
    handlePointerMove,
    handlePointerUp,
    handleWheelZoom,
    handleBackgroundPointerDown,
    handleBackgroundPointerMove,
    handleBackgroundPointerUp,
    resetView,
  } = useForceLayout(simNodes, simLinks);

  // null = nothing selected, don't dim anything. Recomputed on every simLinks
  // identity change (data reload) and selection change -- cheap, one pass over
  // at most a few hundred links.
  const connectedLinkIndexes = useMemo(() => {
    if (!selectedMemoryId) return null;
    const indexes = new Set<number>();
    simLinks.forEach((link, i) => {
      if (endpointId(link.source) === selectedMemoryId || endpointId(link.target) === selectedMemoryId) indexes.add(i);
    });
    return indexes;
  }, [simLinks, selectedMemoryId]);

  function opacityFor(id: string): number {
    if (!traceHighlight) return 1;
    const state = traceHighlight.get(id);
    if (state === "included") return 1;
    if (state === "omitted") return 0.55;
    return 0.15; // not part of this context's candidate set at all
  }

  return (
    <svg
      ref={svgRef}
      viewBox={`0 0 ${GRAPH_WIDTH} ${GRAPH_HEIGHT}`}
      style={{ width: "100%", height: "100%", display: "block" }}
      onWheel={handleWheelZoom}
      onClick={(e) => {
        if (e.target === e.currentTarget) return; // clicking empty canvas: no-op here, App handles clearing selection
      }}
    >
      {/* Fixed-size hit target for panning -- deliberately OUTSIDE the pan/zoom
          group below, so it always covers the visible viewport regardless of
          the current transform. Double-click resets the view (getting stuck
          zoomed/panned out with no way back is a real dead end otherwise). */}
      <rect
        x={0}
        y={0}
        width={GRAPH_WIDTH}
        height={GRAPH_HEIGHT}
        fill="transparent"
        style={{ cursor: "grab" }}
        onPointerDown={handleBackgroundPointerDown}
        onPointerMove={handleBackgroundPointerMove}
        onPointerUp={handleBackgroundPointerUp}
        onDoubleClick={resetView}
      />
      <g ref={viewportRef}>
        <g>
          {simLinks.map((link, i) => {
            const isConnected = connectedLinkIndexes?.has(i) ?? false;
            const dimmed = connectedLinkIndexes !== null && !isConnected;
            return (
              <line
                key={i}
                ref={registerLink(i)}
                strokeDasharray={link.kind === "supersedes" ? "4 3" : undefined}
                stroke={isConnected ? "var(--accent)" : link.kind === "supersedes" ? "var(--warning)" : "var(--border-strong)"}
                strokeWidth={isConnected ? 2 : 1}
                opacity={dimmed ? 0.15 : 1}
              />
            );
          })}
        </g>
        <g>
          {nodes.map((node) => {
            const isSelected = node.id === selectedMemoryId;
            const isMatch = matchedIds?.has(node.id) ?? false;
            return (
              <circle
                key={node.id}
                ref={registerNode(node.id)}
                r={nodeRadius(node.confidence)}
                fill={MEMORY_TYPE_COLORS[node.type]}
                opacity={opacityFor(node.id)}
                stroke={isSelected ? "var(--accent)" : isMatch ? "var(--warning)" : "none"}
                strokeWidth={isSelected ? 2.5 : isMatch ? 2 : 0}
                style={{ cursor: "pointer" }}
                onPointerDown={(e) => handlePointerDown(node.id, e)}
                onPointerMove={(e) => handlePointerMove(node.id, e)}
                onPointerUp={(e) => {
                  if (handlePointerUp(node.id, e)) onSelectMemory(node.id);
                }}
              >
                <title>{`${node.type} · confidence ${node.confidence.toFixed(2)}\n${node.contentPreview}`}</title>
              </circle>
            );
          })}
        </g>
      </g>
    </svg>
  );
}
