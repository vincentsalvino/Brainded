import type { MemoryGraphResponse, MemoryDetailResponse, GraphMemoryNode } from "../../shared/api-types";

const scope = { kind: "global" as const, id: null };

function node(overrides: Partial<GraphMemoryNode> & Pick<GraphMemoryNode, "id" | "type" | "contentPreview">): GraphMemoryNode {
  return {
    scope,
    confidence: 0.7,
    tags: [],
    createdAt: "2026-09-01T00:00:00.000Z",
    ...overrides,
  };
}

export const memoryGraphFixture: MemoryGraphResponse = {
  nodes: [
    node({ id: "m1", type: "rule", contentPreview: "REST endpoints use plural nouns", confidence: 0.8 }),
    node({ id: "m2", type: "rule", contentPreview: "Validate API input with Zod before business logic", confidence: 0.8 }),
    node({ id: "m3", type: "pattern", contentPreview: "Translate application errors at the HTTP boundary", confidence: 0.6 }),
    node({ id: "m4", type: "fact", contentPreview: "The staging DB rotates credentials every 90 days", confidence: 0.5 }),
    node({ id: "m5", type: "decision", contentPreview: "Use SQLite over Postgres for the local-first Brain", confidence: 0.9 }),
    // Superseded pair -- real data has none of these yet (no live write path sets `supersedes`), synthetic here.
    node({ id: "m6-old", type: "fact", contentPreview: "Old: the API lives at v1/", confidence: 0.4 }),
    node({ id: "m6-new", type: "fact", contentPreview: "New: the API lives at v2/", confidence: 0.9 }),
  ],
  similarityEdges: [
    { a: "m1", b: "m2", similarity: 0.62 },
    { a: "m2", b: "m3", similarity: 0.71 },
    { a: "m1", b: "m3", similarity: 0.65 },
  ],
  supersedesEdges: [{ from: "m6-new", to: "m6-old" }],
  meta: { threshold: 0.6, totalMemories: 7, totalEdges: 4 },
};

export const emptyMemoryGraphFixture: MemoryGraphResponse = {
  nodes: [],
  similarityEdges: [],
  supersedesEdges: [],
  meta: { threshold: 0.6, totalMemories: 0, totalEdges: 0 },
};

export const memoryDetailFixture: MemoryDetailResponse = {
  memory: {
    id: "m1",
    type: "rule",
    content: "REST API resources should use plural nouns in endpoint paths, such as /tasks and /notes.",
    domain: null,
    scope,
    source: { origin: "system" },
    confidence: 0.8,
    status: "active",
    tags: ["api", "convention"],
    supersedes: null,
    createdAt: "2026-09-01T00:00:00.000Z",
    updatedAt: "2026-09-01T00:00:00.000Z",
  },
  neighbors: [
    { a: "m1", b: "m2", similarity: 0.62 },
    { a: "m1", b: "m3", similarity: 0.65 },
  ],
  supersededBy: null,
  feedback: { useful: 3, notUseful: 1, other: 0 },
  deliveryCount: 5,
  performance: {
    usefulCount: 3,
    notUsefulCount: 1,
    redundantReasonCount: 0,
    incorrectReasonCount: 0,
    evidenceMass: 4,
    usefulnessSignal: 0.64,
  },
};

export const coldStartMemoryDetailFixture: MemoryDetailResponse = {
  ...memoryDetailFixture,
  memory: { ...memoryDetailFixture.memory, id: "m4" },
  neighbors: [],
  feedback: { useful: 0, notUseful: 0, other: 0 },
  deliveryCount: 0,
  performance: null,
};
