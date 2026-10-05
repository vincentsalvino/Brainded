import { useEffect, useRef } from "react";
import type { RefObject } from "react";
import {
  forceSimulation,
  forceManyBody,
  forceLink,
  forceCenter,
  forceCollide,
  type Simulation,
  type SimulationNodeDatum,
  type SimulationLinkDatum,
} from "d3-force";

export interface SimNode extends SimulationNodeDatum {
  id: string;
  radius: number;
}

export interface SimLink extends SimulationLinkDatum<SimNode> {
  kind: "similarity" | "supersedes";
  similarity?: number;
}

// Fixed internal coordinate space -- <svg viewBox="0 0 WIDTH HEIGHT"> scales
// responsively for free (native SVG), no ResizeObserver needed. Node/edge
// positions (from d3-force) live in this "world space"; pan/zoom is a
// SEPARATE, outer transform on top (see viewportRef) -- the two never need to
// know about each other except at the one point drag math converts between them.
export const GRAPH_WIDTH = 1000;
export const GRAPH_HEIGHT = 700;

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
  return {
    x: ((clientX - rect.left) / rect.width) * GRAPH_WIDTH,
    y: ((clientY - rect.top) / rect.height) * GRAPH_HEIGHT,
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
    applyViewTransform(); // explicit identity transform from the start, not an absent attribute
    const linkForce = forceLink<SimNode, SimLink>().id((d) => d.id).distance(70);
    linkForceRef.current = linkForce;
    simRef.current = forceSimulation<SimNode>()
      .force("charge", forceManyBody().strength(-140))
      .force("link", linkForce)
      .force("center", forceCenter(GRAPH_WIDTH / 2, GRAPH_HEIGHT / 2))
      .force("collide", forceCollide<SimNode>((d) => d.radius + 2))
      .on("tick", applyPositions);
    // Load-bearing: an unmounted component's tick listener would otherwise keep
    // firing against dead refs -- d3-force's timer is independent of React.
    return () => {
      simRef.current?.stop();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const sim = simRef.current;
    const linkForce = linkForceRef.current;
    if (!sim || !linkForce) return;

    // Carry forward position/velocity/pin for ids that survive a data change
    // (threshold tweak, new search) -- avoids re-scattering the whole graph.
    const previous = new Map(sim.nodes().map((n) => [n.id, n]));
    for (const n of nodes) {
      const prior = previous.get(n.id);
      if (prior) Object.assign(n, { x: prior.x, y: prior.y, vx: prior.vx, vy: prior.vy, fx: prior.fx, fy: prior.fy });
    }

    sim.nodes(nodes);
    linkForce.links(links);
    sim.alpha(1).restart();
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
      const t = transformRef.current;
      const viewBoxPoint = clientToViewBoxPoint(svg, event.clientX, event.clientY);
      const worldPoint = viewBoxToWorldPoint(viewBoxPoint, t);
      const nextK = clamp(event.deltaY < 0 ? t.k * ZOOM_STEP : t.k / ZOOM_STEP, MIN_ZOOM, MAX_ZOOM);
      t.x = viewBoxPoint.x - worldPoint.x * nextK;
      t.y = viewBoxPoint.y - worldPoint.y * nextK;
      t.k = nextK;
      applyViewTransform();
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
      const rect = svg.getBoundingClientRect();
      const dx = ((event.clientX - pan.startClientX) / rect.width) * GRAPH_WIDTH;
      const dy = ((event.clientY - pan.startClientY) / rect.height) * GRAPH_HEIGHT;
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
  };
}
