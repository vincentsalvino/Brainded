import { test, expect } from "vitest";
import { createGraphSimulation, GRAPH_WIDTH, GRAPH_HEIGHT, type SimNode, type SimLink } from "./graph-layout";

test("disconnected groups stay within the viewport and linked neighbors remain compact after settling", () => {
  const nodes: SimNode[] = Array.from({ length: 100 }, (_, index) => ({ id: String(index), radius: 9 }));
  const links: SimLink[] = [];
  // Ten groups of eight, plus twenty isolated memories.
  for (let group = 0; group < 10; group++) {
    for (let index = 1; index < 8; index++) {
      links.push({ source: String(group * 8), target: String(group * 8 + index), kind: "similarity", similarity: 0.8 });
    }
  }
  const { simulation } = createGraphSimulation(nodes, links);
  simulation.stop().tick(350);

  for (const node of nodes) {
    expect(node.x! - node.radius).toBeGreaterThan(0);
    expect(node.x! + node.radius).toBeLessThan(GRAPH_WIDTH);
    expect(node.y! - node.radius).toBeGreaterThan(0);
    expect(node.y! + node.radius).toBeLessThan(GRAPH_HEIGHT);
  }
  for (const link of links) {
    const source = link.source as SimNode;
    const target = link.target as SimNode;
    expect(Math.hypot(source.x! - target.x!, source.y! - target.y!)).toBeLessThan(90);
  }
  for (let index = 0; index < nodes.length; index++) {
    for (const other of nodes.slice(index + 1)) {
      const node = nodes[index]!;
      expect(Math.hypot(node.x! - other.x!, node.y! - other.y!)).toBeGreaterThanOrEqual(node.radius + other.radius);
    }
  }
});
