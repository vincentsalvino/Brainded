import type { ContextListResponse, ContextDetailResponse } from "../../shared/api-types";

const scope = { kind: "global" as const, id: null };

export const contextListFixture: ContextListResponse = {
  items: [
    {
      id: "ctx-1", timestamp: "2026-09-04T10:13:00.000Z", retrievalEventId: "r1", scope, taskId: "task-42",
      includedMemoryIds: ["m1"], omittedMemoryIds: ["m2"], tokenCount: 812, memories: [], candidateCount: 12,
      candidateTokenCount: 3400, retrievalMs: 40, rankingMs: 4, compileMs: 2, optimizeMs: 1,
    },
    {
      id: "ctx-2", timestamp: "2026-09-04T09:58:00.000Z", retrievalEventId: "r2", scope, taskId: null,
      includedMemoryIds: [], omittedMemoryIds: [], tokenCount: 0, memories: [], candidateCount: 0,
      candidateTokenCount: 0, retrievalMs: 12, rankingMs: 1, compileMs: 0, optimizeMs: 0,
    },
  ],
};

export const contextDetailFixture: ContextDetailResponse = {
  context: {
    id: "ctx-1", timestamp: "2026-09-04T10:13:00.000Z", retrievalEventId: "r1", scope, taskId: "task-42",
    includedMemoryIds: ["m1"], omittedMemoryIds: ["m2"], tokenCount: 812,
    memories: [
      { memoryId: "m1", included: true, rank: 1, tokenCount: 640 },
      { memoryId: "m2", included: false, rank: null, tokenCount: null },
    ],
    candidateCount: 2, candidateTokenCount: 900, retrievalMs: 40, rankingMs: 4, compileMs: 2, optimizeMs: 1,
  },
  sources: [
    { sourceType: "code", sourceId: "chunk-1", repositoryId: "repo-1", fileId: "file-1", relativePath: "packages/gateway/src/gateway.ts", relation: null, depth: null, included: true, rank: 2, tokenCount: 172, },
    { sourceType: "dependency", sourceId: "file-1:file-2:dependency", repositoryId: "repo-1", fileId: "file-2", relativePath: "packages/core/retrieval/src/service.ts", relation: "dependency", depth: 1, included: false, rank: null, tokenCount: null, },
  ],
  feedback: [{ id: "f1", timestamp: "2026-09-04T10:14:00.000Z", memoryId: "m1", taskId: "task-42", contextId: "ctx-1", useful: true, reason: null, notes: null }],
  outcomes: [{ id: "o1", timestamp: "2026-09-04T10:15:00.000Z", taskId: "task-42", sessionId: null, contextId: "ctx-1", outcome: "success", signal: { testsPassed: true }, notes: null }],
};

export const emptyContextListFixture: ContextListResponse = { items: [] };
