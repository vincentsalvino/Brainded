import {
  forceSimulation, forceManyBody, forceLink, forceCenter, forceCollide, forceX, forceY,
  type SimulationNodeDatum, type SimulationLinkDatum,
} from "d3-force";

export interface SimNode extends SimulationNodeDatum {
  id: string;
  radius: number;
}

export interface SimLink extends SimulationLinkDatum<SimNode> {
  kind: "similarity" | "supersedes";
  similarity?: number;
}

export const GRAPH_WIDTH = 1000;
export const GRAPH_HEIGHT = 700;

function endpointId(endpoint: SimLink["source"]): string {
  return typeof endpoint === "object" ? endpoint.id : String(endpoint);
}

/** Group by real relationships, never by type or an invented semantic edge. */
export function createGraphSimulation(nodes: SimNode[], links: SimLink[]) {
  const parents = new Map(nodes.map((node) => [node.id, node.id]));
  function root(id: string): string {
    const parent = parents.get(id);
    if (!parent || parent === id) return id;
    const result = root(parent);
    parents.set(id, result);
    return result;
  }
  for (const link of links) {
    const source = endpointId(link.source);
    const target = endpointId(link.target);
    if (parents.has(source) && parents.has(target)) parents.set(root(source), root(target));
  }

  const groups = new Map<string, { count: number; x?: number; y?: number }>();
  for (const node of nodes) {
    const id = root(node.id);
    const group = groups.get(id) ?? { count: 0 };
    group.count++;
    groups.set(id, group);
  }
  // Pack component centers first. Disconnected groups stay close without
  // overlapping, and isolated nodes don't drift indefinitely off the canvas.
  const centers = [...groups.values()];
  const packing = forceSimulation(centers)
    .force("x", forceX(GRAPH_WIDTH / 2).strength(0.12))
    .force("y", forceY(GRAPH_HEIGHT / 2).strength(0.12))
    .force("collide", forceCollide<(typeof centers)[number]>((group) => Math.sqrt(group.count) * 17 + 16).iterations(3))
    .stop();
  packing.tick(120);

  const targets = new Map(nodes.map((node) => [node.id, groups.get(root(node.id))!]));
  const linkForce = forceLink<SimNode, SimLink>(links)
    .id((node) => node.id)
    .distance((link) => link.kind === "supersedes" ? 42 : 34 + (1 - (link.similarity ?? 0.6)) * 36)
    .strength(0.55);
  const simulation = forceSimulation(nodes)
    .force("charge", forceManyBody().strength(-42).distanceMax(130))
    .force("link", linkForce)
    .force("x", forceX<SimNode>((node) => targets.get(node.id)!.x!).strength(0.085))
    .force("y", forceY<SimNode>((node) => targets.get(node.id)!.y!).strength(0.085))
    .force("center", forceCenter(GRAPH_WIDTH / 2, GRAPH_HEIGHT / 2).strength(0.15))
    .force("collide", forceCollide<SimNode>((node) => node.radius + 4).iterations(3));
  return { simulation, linkForce };
}
