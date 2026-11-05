import { useMemo } from "react";
import type { GraphMemoryNode, GraphSupersedesEdge } from "../../shared/api-types";
import type { SimilarityPair } from "@brain/contracts";
import { useForceLayout, GRAPH_WIDTH, GRAPH_HEIGHT, type SimNode, type SimLink } from "../use-force-layout";
import { MEMORY_TYPE_COLORS } from "../memory-type-colors";
import { usePointerTooltip } from "../use-pointer-tooltip";
import { Icon } from "./Icon";

export type TraceState = "included" | "omitted";

interface GraphCanvasProps {
  nodes: GraphMemoryNode[];
  similarityEdges: SimilarityPair[];
  supersedesEdges: GraphSupersedesEdge[];
  selectedMemoryId: string | null;
  onSelectMemory: (id: string) => void;
  traceHighlight?: Map<string, TraceState> | null;
  matchedIds?: Set<string> | null;
  filteredIds?: Set<string> | null;
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
  filteredIds = null,
}: GraphCanvasProps) {
  const tip = usePointerTooltip();
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
    fitView,
    zoomIn,
    zoomOut,
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
    <div className="graph-stage">
      <svg
        ref={svgRef}
        aria-label="Memory relationships"
        className="memory-graph"
        viewBox={`0 0 ${GRAPH_WIDTH} ${GRAPH_HEIGHT}`}
        style={{ width: "100%", height: "100%", display: "block" }}
        onWheel={(event) => { tip.hide(); handleWheelZoom(event); }}
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
              // Hide filtered items without restarting the layout simulation.
              const hidden = filteredIds && (
                !filteredIds.has(String(endpointId(link.source))) || !filteredIds.has(String(endpointId(link.target)))
              );
              const isConnected = connectedLinkIndexes?.has(i) ?? false;
              const dimmed = connectedLinkIndexes !== null && !isConnected;
              return (
                <line
                  key={i}
                  ref={registerLink(i)}
                  display={hidden ? "none" : undefined}
                  strokeDasharray={link.kind === "supersedes" ? "4 3" : undefined}
                  stroke={isConnected ? "var(--accent)" : link.kind === "supersedes" ? "var(--warning)" : "var(--graph-edge)"}
                  strokeWidth={isConnected ? 2.25 : 1.35}
                  vectorEffect="non-scaling-stroke"
                  strokeLinecap="round"
                  pointerEvents="none"
                  opacity={dimmed ? 0.35 : 1}
                />
              );
            })}
          </g>
          <g>
            {nodes.map((node) => {
              const isSelected = node.id === selectedMemoryId;
              const isMatch = matchedIds?.has(node.id) ?? false;
              const type = node.type.replaceAll("_", " ");
              const confidence = `Confidence ${node.confidence.toFixed(2)}`;
              const tooltip = () => (
                <>
                  <strong className="tooltip-node-type"><i style={{ backgroundColor: MEMORY_TYPE_COLORS[node.type] }} />{type}</strong>
                  <span className="meta">{confidence}</span>
                  <span>{node.contentPreview}</span>
                </>
              );
              return (
                <circle
                  key={node.id}
                  ref={registerNode(node.id)}
                  display={filteredIds && !filteredIds.has(node.id) ? "none" : undefined}
                  className="graph-node"
                  role="button"
                  tabIndex={0}
                  aria-label={`${type}: ${node.contentPreview}`}
                  aria-description={confidence}
                  aria-pressed={isSelected}
                  r={nodeRadius(node.confidence)}
                  fill={MEMORY_TYPE_COLORS[node.type]}
                  opacity={opacityFor(node.id)}
                  stroke={isSelected ? "var(--accent)" : isMatch ? "var(--warning)" : "var(--surface-0)"}
                  strokeWidth={isSelected ? 2.5 : isMatch ? 2 : 1.25}
                  vectorEffect="non-scaling-stroke"
                  style={{ cursor: "pointer" }}
                  onKeyDown={(event) => {
                    if (event.key === "Escape") tip.hide();
                    if (event.key === "Enter" || event.key === " ") {
                      event.preventDefault();
                      tip.hide();
                      onSelectMemory(node.id);
                    }
                  }}
                  onFocus={(event) => tip.focus(event.currentTarget, tooltip())}
                  onBlur={tip.hide}
                  onPointerEnter={(event) => {
                    if (event.pointerType !== "touch" && event.buttons === 0) tip.show(event.clientX, event.clientY, tooltip());
                  }}
                  onPointerLeave={tip.hide}
                  onPointerDown={(e) => { tip.hide(); handlePointerDown(node.id, e); }}
                  onPointerMove={(e) => {
                    if (e.buttons === 0) tip.move(e.clientX, e.clientY);
                    handlePointerMove(node.id, e);
                  }}
                  onPointerUp={(e) => {
                    if (handlePointerUp(node.id, e)) onSelectMemory(node.id);
                  }}
                />
              );
            })}
          </g>
        </g>
      </svg>
      <div className="graph-controls" role="group" aria-label="Graph view controls">
        <button type="button" onClick={zoomOut} aria-label="Zoom out" title="Zoom out"><Icon name="minus" /></button>
        <button type="button" onClick={zoomIn} aria-label="Zoom in" title="Zoom in"><Icon name="plus" /></button>
        <button type="button" onClick={fitView} className="graph-fit icon-label"><Icon name="fit" />Fit view</button>
      </div>
      {tip.tooltip}
    </div>
  );
}
