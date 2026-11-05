import { useEffect, useRef } from "react";
import type { RefObject } from "react";
import type { Simulation, forceLink } from "d3-force";
import { createGraphSimulation, GRAPH_WIDTH, GRAPH_HEIGHT, type SimNode, type SimLink } from "./graph-layout";
export { GRAPH_WIDTH, GRAPH_HEIGHT, type SimNode, type SimLink } from "./graph-layout";

// Fixed internal coordinate space -- <svg viewBox="0 0 WIDTH HEIGHT"> scales
// responsively for free (native SVG), no ResizeObserver needed. Node/edge
// positions (from d3-force) live in this "world space"; pan/zoom is a
// SEPARATE, outer transform on top (see viewportRef) -- the two never need to
// know about each other except at the one point drag math converts between them.
const MIN_ZOOM = 0.2;
const MAX_ZOOM = 6;
const ZOOM_STEP = 1.15;

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

interface ViewTransform {
  x: number;
  y: number;
  k: number;
}

/** Client pixels -> SVG viewBox space (the outer CSS-size <-> viewBox mapping, unaffected by pan/zoom). */
function clientToViewBoxPoint(svg: SVGSVGElement, clientX: number, clientY: number): { x: number; y: number } {
  const rect = svg.getBoundingClientRect();
  const scale = Math.min(rect.width / GRAPH_WIDTH, rect.height / GRAPH_HEIGHT) || 1;
  return {
    x: (clientX - rect.left - (rect.width - GRAPH_WIDTH * scale) / 2) / scale,
    y: (clientY - rect.top - (rect.height - GRAPH_HEIGHT * scale) / 2) / scale,
  };
}

/** viewBox-space point -> world space (inverts the pan/zoom <g transform>). */
function viewBoxToWorldPoint(point: { x: number; y: number }, t: ViewTransform): { x: number; y: number } {
  return { x: (point.x - t.x) / t.k, y: (point.y - t.y) / t.k };
}

export interface UseForceLayoutResult {
  svgRef: RefObject<SVGSVGElement | null>;
  viewportRef: RefObject<SVGGElement | null>;
  registerNode: (id: string) => (el: SVGCircleElement | null) => void;
  registerLink: (index: number) => (el: SVGLineElement | null) => void;
  handlePointerDown: (id: string, event: React.PointerEvent<SVGCircleElement>) => void;
  handlePointerMove: (id: string, event: React.PointerEvent<SVGCircleElement>) => void;
  /** Returns true if this was a click (no meaningful drag movement), for the caller to open the inspector. */
  handlePointerUp: (id: string, event: React.PointerEvent<SVGCircleElement>) => boolean;
  handleWheelZoom: (event: React.WheelEvent<SVGSVGElement>) => void;
  handleBackgroundPointerDown: (event: React.PointerEvent<SVGElement>) => void;
  handleBackgroundPointerMove: (event: React.PointerEvent<SVGElement>) => void;
  handleBackgroundPointerUp: (event: React.PointerEvent<SVGElement>) => void;
  resetView: () => void;
  fitView: () => void;
  zoomIn: () => void;
  zoomOut: () => void;
}

const CLICK_MOVEMENT_THRESHOLD_PX = 5;

/**
 * Owns the d3-force simulation AND the pan/zoom viewport transform, driving
 * both imperatively via DOM refs -- never via React state. A default-
 * alphaDecay run takes ~300 ticks to settle; 300 React re-renders of hundreds
 * of elements is the textbook React-in-a-loop foot-gun. Selection/highlight
 * state stays ordinary React state in the caller -- only position/viewport is
 * tick/gesture-driven.
 */
export function useForceLayout(nodes: SimNode[], links: SimLink[]): UseForceLayoutResult {
  const svgRef = useRef<SVGSVGElement | null>(null);
  const viewportRef = useRef<SVGGElement | null>(null);
  const simRef = useRef<Simulation<SimNode, SimLink> | null>(null);
  const linkForceRef = useRef<ReturnType<typeof forceLink<SimNode, SimLink>> | null>(null);
  const nodeElsRef = useRef<Map<string, SVGCircleElement>>(new Map());
  const linkElsRef = useRef<Map<number, SVGLineElement>>(new Map());
  const dragRef = useRef<{ id: string; startClientX: number; startClientY: number; moved: boolean } | null>(null);
  const transformRef = useRef<ViewTransform>({ x: 0, y: 0, k: 1 });
  const panRef = useRef<{ startClientX: number; startClientY: number; startX: number; startY: number } | null>(null);

  function applyViewTransform(): void {
    const t = transformRef.current;
    viewportRef.current?.setAttribute("transform", `translate(${t.x} ${t.y}) scale(${t.k})`);
  }

  function zoomAt(point: { x: number; y: number }, factor: number): void {
    const t = transformRef.current;
    const world = viewBoxToWorldPoint(point, t);
    const k = clamp(t.k * factor, MIN_ZOOM, MAX_ZOOM);
    transformRef.current = { x: point.x - world.x * k, y: point.y - world.y * k, k };
    applyViewTransform();
  }

  function fitView(): void {
    const currentNodes = simRef.current?.nodes() ?? [];
    if (!currentNodes.length) return;
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (const node of currentNodes) {
      const x = node.x ?? GRAPH_WIDTH / 2;
      const y = node.y ?? GRAPH_HEIGHT / 2;
      minX = Math.min(minX, x - node.radius);
      maxX = Math.max(maxX, x + node.radius);
      minY = Math.min(minY, y - node.radius);
      maxY = Math.max(maxY, y + node.radius);
    }
    const k = clamp(
      Math.min((GRAPH_WIDTH - 120) / (maxX - minX), (GRAPH_HEIGHT - 120) / (maxY - minY)),
      MIN_ZOOM,
      2,
    );
    transformRef.current = {
      x: GRAPH_WIDTH / 2 - (minX + maxX) / 2 * k,
      y: GRAPH_HEIGHT / 2 - (minY + maxY) / 2 * k,
      k,
    };
    applyViewTransform();
  }

  function applyPositions(): void {
    // One position per node, computed once, used for BOTH its circle and any
    // line endpoint referencing it -- previously the circle used a clamped
    // position while lines read the raw (unclamped) simulation coordinate
    // directly off source/target, so a node pushed past the nominal bounds
    // rendered its circle in one place and its edges in another. Now that
    // pan/zoom exists, there's also no reason to hard-clamp at all: a node
    // drifting outside the initial 1000x700 view is reachable by panning,
    // not lost -- clamping was actively fighting forceManyBody's repulsion
    // (nodes pushed apart, then slammed back against the boundary), which is
    // what produced the squashed-into-a-row layout.
    const positions = new Map<string, { x: number; y: number }>();
    for (const n of simRef.current?.nodes() ?? []) {
      const x = n.x ?? GRAPH_WIDTH / 2;
      const y = n.y ?? GRAPH_HEIGHT / 2;
      positions.set(n.id, { x, y });
      const el = nodeElsRef.current.get(n.id);
      el?.setAttribute("cx", String(x));
      el?.setAttribute("cy", String(y));
    }
    const resolvedLinks = linkForceRef.current?.links() ?? [];
    resolvedLinks.forEach((l, i) => {
      const source = l.source as SimNode;
      const target = l.target as SimNode;
      const sourcePos = positions.get(source.id) ?? { x: 0, y: 0 };
      const targetPos = positions.get(target.id) ?? { x: 0, y: 0 };
      const el = linkElsRef.current.get(i);
      el?.setAttribute("x1", String(sourcePos.x));
      el?.setAttribute("y1", String(sourcePos.y));
      el?.setAttribute("x2", String(targetPos.x));
      el?.setAttribute("y2", String(targetPos.y));
    });
  }

  useEffect(() => {
    // Carry forward position/velocity/pin for ids that survive a data change
    // (threshold tweak, new search) -- avoids re-scattering the whole graph.
    const previous = new Map((simRef.current?.nodes() ?? []).map((n) => [n.id, n]));
    for (const n of nodes) {
      const prior = previous.get(n.id);
      if (prior) Object.assign(n, { x: prior.x, y: prior.y, vx: prior.vx, vy: prior.vy, fx: prior.fx, fy: prior.fy });
    }

    const { simulation, linkForce } = createGraphSimulation(nodes, links);
    simRef.current = simulation;
    linkForceRef.current = linkForce;
    // First paint already has a coherent layout, rather than a scattering of
    // nodes at the origin. Selection/search never rerun this effect.
    simulation.stop().tick(120);
    applyPositions();
    applyViewTransform();
    const outsideView = nodes.some((node) =>
      (node.x ?? 0) < 40 || (node.x ?? 0) > GRAPH_WIDTH - 40 ||
      (node.y ?? 0) < 40 || (node.y ?? 0) > GRAPH_HEIGHT - 40,
    );
    if (previous.size === 0 && outsideView) fitView();
    simulation.on("tick", applyPositions).alpha(0.25).restart();
    return () => {
      simulation.stop();
    };
  }, [nodes, links]);

  return {
    svgRef,
    viewportRef,
    registerNode: (id) => (el) => {
      if (el) nodeElsRef.current.set(id, el);
      else nodeElsRef.current.delete(id);
    },
    registerLink: (index) => (el) => {
      if (el) linkElsRef.current.set(index, el);
      else linkElsRef.current.delete(index);
    },
    handlePointerDown: (id, event) => {
      // jsdom (component tests) doesn't implement pointer capture -- real browsers do.
      try {
        event.currentTarget.setPointerCapture(event.pointerId);
      } catch {
        /* not implemented in this environment; drag still works via the same-element listeners below */
      }
      dragRef.current = { id, startClientX: event.clientX, startClientY: event.clientY, moved: false };
      simRef.current?.alphaTarget(0.3).restart();
    },
    handlePointerMove: (id, event) => {
      const drag = dragRef.current;
      const svg = svgRef.current;
      if (!drag || drag.id !== id || !svg) return;
      if (
        Math.abs(event.clientX - drag.startClientX) > CLICK_MOVEMENT_THRESHOLD_PX ||
        Math.abs(event.clientY - drag.startClientY) > CLICK_MOVEMENT_THRESHOLD_PX
      ) {
        drag.moved = true;
      }
      const node = simRef.current?.nodes().find((n) => n.id === id);
      if (!node) return;
      const viewBoxPoint = clientToViewBoxPoint(svg, event.clientX, event.clientY);
      const worldPoint = viewBoxToWorldPoint(viewBoxPoint, transformRef.current);
      node.fx = worldPoint.x;
      node.fy = worldPoint.y;
    },
    handlePointerUp: (id) => {
      const drag = dragRef.current;
      simRef.current?.alphaTarget(0);
      dragRef.current = null;
      return drag?.id === id && !drag.moved;
    },

    /** Zoom toward the cursor, not the canvas center -- the point under the pointer stays fixed. */
    handleWheelZoom: (event) => {
      const svg = svgRef.current;
      if (!svg) return;
      event.preventDefault();
      const viewBoxPoint = clientToViewBoxPoint(svg, event.clientX, event.clientY);
      zoomAt(viewBoxPoint, event.deltaY < 0 ? ZOOM_STEP : 1 / ZOOM_STEP);
    },

    /** Pan: only meaningful when the pointerdown originated on the background, not a node -- caller enforces that (e.g. a dedicated background rect). */
    handleBackgroundPointerDown: (event) => {
      try {
        event.currentTarget.setPointerCapture(event.pointerId);
      } catch {
        /* not implemented in jsdom */
      }
      const t = transformRef.current;
      panRef.current = { startClientX: event.clientX, startClientY: event.clientY, startX: t.x, startY: t.y };
    },
    handleBackgroundPointerMove: (event) => {
      const pan = panRef.current;
      const svg = svgRef.current;
      if (!pan || !svg) return;
      const start = clientToViewBoxPoint(svg, pan.startClientX, pan.startClientY);
      const current = clientToViewBoxPoint(svg, event.clientX, event.clientY);
      const dx = current.x - start.x;
      const dy = current.y - start.y;
      transformRef.current.x = pan.startX + dx;
      transformRef.current.y = pan.startY + dy;
      applyViewTransform();
    },
    handleBackgroundPointerUp: () => {
      panRef.current = null;
    },

    resetView: () => {
      transformRef.current = { x: 0, y: 0, k: 1 };
      applyViewTransform();
    },
    fitView,
    zoomIn: () => zoomAt({ x: GRAPH_WIDTH / 2, y: GRAPH_HEIGHT / 2 }, ZOOM_STEP),
    zoomOut: () => zoomAt({ x: GRAPH_WIDTH / 2, y: GRAPH_HEIGHT / 2 }, 1 / ZOOM_STEP),
  };
}
