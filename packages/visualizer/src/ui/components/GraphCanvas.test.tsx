import { test, expect, vi } from "vitest";
import { render, fireEvent, screen } from "@testing-library/react";
import { GraphCanvas } from "./GraphCanvas";
import { GRAPH_WIDTH, GRAPH_HEIGHT } from "../use-force-layout";
import { memoryGraphFixture, emptyMemoryGraphFixture } from "../fixtures/graph.fixture";

test("renders one circle per node and one line per edge", () => {
  const { container } = render(
    <GraphCanvas
      nodes={memoryGraphFixture.nodes}
      similarityEdges={memoryGraphFixture.similarityEdges}
      supersedesEdges={memoryGraphFixture.supersedesEdges}
      selectedMemoryId={null}
      onSelectMemory={() => {}}
    />,
  );
  expect(container.querySelectorAll("circle").length).toBe(memoryGraphFixture.nodes.length);
  expect(container.querySelectorAll("line").length).toBe(
    memoryGraphFixture.similarityEdges.length + memoryGraphFixture.supersedesEdges.length,
  );
});

test("renders nothing but a valid empty svg for an empty graph", () => {
  const { container } = render(
    <GraphCanvas
      nodes={emptyMemoryGraphFixture.nodes}
      similarityEdges={emptyMemoryGraphFixture.similarityEdges}
      supersedesEdges={emptyMemoryGraphFixture.supersedesEdges}
      selectedMemoryId={null}
      onSelectMemory={() => {}}
    />,
  );
  expect(container.querySelectorAll("circle").length).toBe(0);
});

test("clicking a node (pointerdown+pointerup, no movement) calls onSelectMemory with its id", () => {
  const onSelectMemory = vi.fn();
  const { container } = render(
    <GraphCanvas
      nodes={memoryGraphFixture.nodes}
      similarityEdges={memoryGraphFixture.similarityEdges}
      supersedesEdges={memoryGraphFixture.supersedesEdges}
      selectedMemoryId={null}
      onSelectMemory={onSelectMemory}
    />,
  );
  const circles = container.querySelectorAll("circle");
  const target = circles[0]!;
  firePointer(target, "pointerdown", { clientX: 10, clientY: 10 });
  firePointer(target, "pointerup", { clientX: 10, clientY: 10 });
  expect(onSelectMemory).toHaveBeenCalledWith(memoryGraphFixture.nodes[0]!.id);
});

test("the selected node's circle gets a distinct stroke; others keep a separating outline", () => {
  const selectedId = memoryGraphFixture.nodes[0]!.id;
  const { container } = render(
    <GraphCanvas
      nodes={memoryGraphFixture.nodes}
      similarityEdges={memoryGraphFixture.similarityEdges}
      supersedesEdges={memoryGraphFixture.supersedesEdges}
      selectedMemoryId={selectedId}
      onSelectMemory={() => {}}
    />,
  );
  const circles = container.querySelectorAll("circle");
  expect(circles[0]!.getAttribute("stroke-width")).toBe("2.5");
  expect(circles[1]!.getAttribute("stroke-width")).toBe("1.25");
});

test("selecting a node highlights only the lines connected to it, and dims the rest", () => {
  const { container } = render(
    <GraphCanvas
      nodes={memoryGraphFixture.nodes}
      similarityEdges={memoryGraphFixture.similarityEdges}
      supersedesEdges={memoryGraphFixture.supersedesEdges}
      selectedMemoryId="m1"
      onSelectMemory={() => {}}
    />,
  );
  // simLinks order: [m1-m2, m2-m3, m1-m3, m6new-m6old] -- only the first and third touch m1.
  const lines = container.querySelectorAll("line");
  expect(lines[0]!.getAttribute("stroke")).toBe("var(--accent)");
  expect(lines[0]!.getAttribute("opacity")).toBe("1");
  expect(lines[2]!.getAttribute("stroke")).toBe("var(--accent)");
  expect(lines[2]!.getAttribute("opacity")).toBe("1");
  expect(lines[1]!.getAttribute("opacity")).toBe("0.35");
  expect(lines[3]!.getAttribute("opacity")).toBe("0.35");
});

test("no selection: no line is highlighted or dimmed", () => {
  const { container } = render(
    <GraphCanvas
      nodes={memoryGraphFixture.nodes}
      similarityEdges={memoryGraphFixture.similarityEdges}
      supersedesEdges={memoryGraphFixture.supersedesEdges}
      selectedMemoryId={null}
      onSelectMemory={() => {}}
    />,
  );
  for (const line of container.querySelectorAll("line")) {
    expect(line.getAttribute("opacity")).toBe("1");
  }
});

test("trace mode fades nodes that are neither included nor omitted in the selected context", () => {
  const [n1, n2, n3] = memoryGraphFixture.nodes;
  const traceHighlight = new Map<string, "included" | "omitted">([
    [n1!.id, "included"],
    [n2!.id, "omitted"],
  ]);
  const { container } = render(
    <GraphCanvas
      nodes={memoryGraphFixture.nodes}
      similarityEdges={memoryGraphFixture.similarityEdges}
      supersedesEdges={memoryGraphFixture.supersedesEdges}
      selectedMemoryId={null}
      onSelectMemory={() => {}}
      traceHighlight={traceHighlight}
    />,
  );
  const circles = container.querySelectorAll("circle");
  expect(circles[0]!.getAttribute("opacity")).toBe("1"); // included
  expect(circles[1]!.getAttribute("opacity")).toBe("0.55"); // omitted
  expect(circles[2]!.getAttribute("opacity")).toBe("0.15"); // not part of context
  void n3;
});

test("search match gets a highlight stroke distinct from selection", () => {
  const matchId = memoryGraphFixture.nodes[2]!.id;
  const { container } = render(
    <GraphCanvas
      nodes={memoryGraphFixture.nodes}
      similarityEdges={memoryGraphFixture.similarityEdges}
      supersedesEdges={memoryGraphFixture.supersedesEdges}
      selectedMemoryId={null}
      onSelectMemory={() => {}}
      matchedIds={new Set([matchId])}
    />,
  );
  const circles = container.querySelectorAll("circle");
  expect(circles[2]!.getAttribute("stroke")).toBe("var(--warning)");
});

// jsdom has no PointerEvent constructor at all (a known, longstanding jsdom
// gap -- confirmed empirically, not assumed: fireEvent.pointerDown/Move/Up
// silently deliver clientX/clientY as undefined because there's no real
// PointerEvent class for them to construct). Dispatching a MouseEvent under
// the "pointerdown"/"pointermove"/"pointerup" type string instead works:
// React's synthetic event system dispatches by event-type string, not by
// checking `instanceof PointerEvent`, and MouseEvent's clientX/clientY are
// fully implemented in jsdom. pointerId is genuinely absent this way (fine --
// the component already treats setPointerCapture as best-effort, try/catch'd
// for exactly this kind of environment gap).
function firePointer(el: Element, type: "pointerdown" | "pointermove" | "pointerup", init: { clientX?: number; clientY?: number } = {}) {
  fireEvent(el, new MouseEvent(type, { bubbles: true, cancelable: true, ...init }));
}

// jsdom's getBoundingClientRect returns an all-zero rect by default -- these
// tests need a real size to exercise the client<->viewBox conversion math.
function mockSvgRect(svg: SVGSVGElement) {
  vi.spyOn(svg, "getBoundingClientRect").mockReturnValue({
    left: 0,
    top: 0,
    width: 1000,
    height: 700,
    right: 1000,
    bottom: 700,
    x: 0,
    y: 0,
    toJSON: () => "",
  });
}

test("wheel over the canvas zooms toward the cursor and does not scroll the page", () => {
  const { container } = render(
    <GraphCanvas
      nodes={memoryGraphFixture.nodes}
      similarityEdges={memoryGraphFixture.similarityEdges}
      supersedesEdges={memoryGraphFixture.supersedesEdges}
      selectedMemoryId={null}
      onSelectMemory={() => {}}
    />,
  );
  const svg = container.querySelector("svg")!;
  mockSvgRect(svg);
  const group = container.querySelector("g")!; // outer viewport <g>, first in document order
  expect(group.getAttribute("transform")).toBe("translate(0 0) scale(1)");

  const wheelEvent = new WheelEvent("wheel", { bubbles: true, cancelable: true, deltaY: -100, clientX: 500, clientY: 350 });
  const preventDefaultSpy = vi.spyOn(wheelEvent, "preventDefault");
  fireEvent(svg, wheelEvent);
  expect(preventDefaultSpy).toHaveBeenCalled();
  const transform = group.getAttribute("transform")!;
  expect(transform).toMatch(/scale\(1\.1[45]/); // zoomed in from 1.0
});

test("dragging the background pans the viewport; dragging a node does not", () => {
  const { container } = render(
    <GraphCanvas
      nodes={memoryGraphFixture.nodes}
      similarityEdges={memoryGraphFixture.similarityEdges}
      supersedesEdges={memoryGraphFixture.supersedesEdges}
      selectedMemoryId={null}
      onSelectMemory={() => {}}
    />,
  );
  const svg = container.querySelector("svg")!;
  mockSvgRect(svg);
  const background = container.querySelector("rect")!;
  const group = container.querySelector("g")!;

  firePointer(background, "pointerdown", { clientX: 100, clientY: 100 });
  firePointer(background, "pointermove", { clientX: 150, clientY: 130 });
  firePointer(background, "pointerup");

  expect(group.getAttribute("transform")).toBe("translate(50 30) scale(1)");
});

test("double-clicking the background resets pan and zoom", () => {
  const { container } = render(
    <GraphCanvas
      nodes={memoryGraphFixture.nodes}
      similarityEdges={memoryGraphFixture.similarityEdges}
      supersedesEdges={memoryGraphFixture.supersedesEdges}
      selectedMemoryId={null}
      onSelectMemory={() => {}}
    />,
  );
  const svg = container.querySelector("svg")!;
  mockSvgRect(svg);
  const background = container.querySelector("rect")!;
  const group = container.querySelector("g")!;

  firePointer(background, "pointerdown", { clientX: 0, clientY: 0 });
  firePointer(background, "pointermove", { clientX: 200, clientY: 200 });
  firePointer(background, "pointerup");
  expect(group.getAttribute("transform")).not.toBe("translate(0 0) scale(1)");

  fireEvent.doubleClick(background);
  expect(group.getAttribute("transform")).toBe("translate(0 0) scale(1)");
});

test("REGRESSION: every line endpoint exactly matches its source/target circle's position, never a stale or clamped value", async () => {
  const { container } = render(
    <GraphCanvas
      nodes={memoryGraphFixture.nodes}
      similarityEdges={memoryGraphFixture.similarityEdges}
      supersedesEdges={memoryGraphFixture.supersedesEdges}
      selectedMemoryId={null}
      onSelectMemory={() => {}}
    />,
  );
  // Let the simulation actually tick and move nodes away from their initial
  // positions -- the bug this guards was invisible at t=0 (everything still
  // defaulted to center) and only showed once real movement diverged the two
  // independently-computed positions.
  await new Promise((resolve) => setTimeout(resolve, 100));

  const circlesById = new Map(
    [...container.querySelectorAll("circle")].map((el, i) => [memoryGraphFixture.nodes[i]!.id, el]),
  );
  const allEdges = [
    ...memoryGraphFixture.similarityEdges.map((e) => ({ source: e.a, target: e.b })),
    ...memoryGraphFixture.supersedesEdges.map((e) => ({ source: e.from, target: e.to })),
  ];
  const lines = container.querySelectorAll("line");
  expect(lines.length).toBe(allEdges.length);

  lines.forEach((line: Element, i: number) => {
    const edge = allEdges[i]!;
    const sourceCircle = circlesById.get(edge.source)!;
    const targetCircle = circlesById.get(edge.target)!;
    expect(line.getAttribute("x1")).toBe(sourceCircle.getAttribute("cx"));
    expect(line.getAttribute("y1")).toBe(sourceCircle.getAttribute("cy"));
    expect(line.getAttribute("x2")).toBe(targetCircle.getAttribute("cx"));
    expect(line.getAttribute("y2")).toBe(targetCircle.getAttribute("cy"));
  });

  // And a sanity check that this test would actually have caught the bug --
  // positions must have moved off the shared undefined-fallback center.
  const anyCircleMoved = [...circlesById.values()].some(
    (el) => el.getAttribute("cx") !== String(GRAPH_WIDTH / 2) || el.getAttribute("cy") !== String(GRAPH_HEIGHT / 2),
  );
  expect(anyCircleMoved).toBe(true);
});

test("supersedes edges render dashed, distinct from similarity edges", () => {
  const { container } = render(
    <GraphCanvas
      nodes={memoryGraphFixture.nodes}
      similarityEdges={memoryGraphFixture.similarityEdges}
      supersedesEdges={memoryGraphFixture.supersedesEdges}
      selectedMemoryId={null}
      onSelectMemory={() => {}}
    />,
  );
  const lines = container.querySelectorAll("line");
  const dashed = [...lines].filter((l) => l.getAttribute("stroke-dasharray"));
  expect(dashed.length).toBe(memoryGraphFixture.supersedesEdges.length);
});

test("view controls zoom and recover every node after panning away", () => {
  const { container } = render(
    <GraphCanvas {...memoryGraphFixture} selectedMemoryId={null} onSelectMemory={() => {}} />,
  );
  const svg = container.querySelector("svg")!;
  mockSvgRect(svg);
  const viewport = container.querySelector("g")!;
  fireEvent.click(screen.getByRole("button", { name: "Zoom in" }));
  expect(viewport.getAttribute("transform")).toContain("scale(1.15)");
  fireEvent.click(screen.getByRole("button", { name: "Zoom out" }));
  expect(viewport.getAttribute("transform")).toContain("scale(1)");

  const background = container.querySelector("rect")!;
  firePointer(background, "pointerdown", { clientX: 0, clientY: 0 });
  firePointer(background, "pointermove", { clientX: 2000, clientY: 2000 });
  firePointer(background, "pointerup");
  fireEvent.click(screen.getByRole("button", { name: "Fit view" }));
  const transform = viewport.getAttribute("transform")!;
  const [, x, y, k] = transform.match(/translate\(([-\d.e]+) ([-\d.e]+)\) scale\(([-\d.e]+)\)/)!;
  for (const circle of container.querySelectorAll("circle")) {
    const cx = Number(circle.getAttribute("cx")) * Number(k) + Number(x);
    const cy = Number(circle.getAttribute("cy")) * Number(k) + Number(y);
    expect(cx).toBeGreaterThan(0);
    expect(cx).toBeLessThan(GRAPH_WIDTH);
    expect(cy).toBeGreaterThan(0);
    expect(cy).toBeLessThan(GRAPH_HEIGHT);
  }
});

test("pan uses the SVG's uniform scale on a wide canvas", () => {
  const { container } = render(
    <GraphCanvas {...memoryGraphFixture} selectedMemoryId={null} onSelectMemory={() => {}} />,
  );
  const svg = container.querySelector("svg")!;
  vi.spyOn(svg, "getBoundingClientRect").mockReturnValue({ width: 1400, height: 700, left: 0, top: 0 } as DOMRect);
  const background = container.querySelector("rect")!;
  firePointer(background, "pointerdown", { clientX: 300, clientY: 100 });
  firePointer(background, "pointermove", { clientX: 350, clientY: 130 });
  firePointer(background, "pointerup");
  expect(container.querySelector("g")!.getAttribute("transform")).toBe("translate(50 30) scale(1)");
});

test("nodes can be selected from the keyboard", () => {
  const onSelectMemory = vi.fn();
  const { container } = render(
    <GraphCanvas {...memoryGraphFixture} selectedMemoryId={null} onSelectMemory={onSelectMemory} />,
  );
  fireEvent.keyDown(container.querySelector("circle")!, { key: "Enter" });
  expect(onSelectMemory).toHaveBeenCalledWith(memoryGraphFixture.nodes[0]!.id);
});
