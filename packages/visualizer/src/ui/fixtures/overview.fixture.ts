import type { OverviewResponse } from "../../shared/api-types";

const scope = { kind: "global" as const, id: null };

export const overviewFixture: OverviewResponse = {
  memories: {
    total: 42,
    active: 39,
    archived: 3,
    byType: {
      fact: 12,
      decision: 4,
      pattern: 6,
      rule: 5,
      procedure: 2,
      experience: 3,
      error: 1,
      constraint: 2,
      project_state: 3,
      task_state: 1,
      agent_experience: 2,
      preference: 1,
    },
  },
  events: { contextEvents: 118, feedbackEvents: 34, outcomeEvents: 27, retrievalEvents: 121 },
  vectorSearchAvailable: true,
  appliedMigrations: [
    "0001_initial_schema.sql",
    "0002_phase2_measurement.sql",
    "0003_codebase_index.sql",
    "0004_codebase_search.sql",
    "0005_codebase_dependencies.sql",
    "0006_context_sources.sql",
    "0007_memory_performance.sql",
  ],
  learning: { enabled: false },
  redundancy: { enabled: false },
  workflow: { tasksTracked: 24, tasksWithContext: 22, tasksWithFeedback: 18, tasksWithOutcome: 21 },
  recentActivity: [
    {
      kind: "outcome",
      timestamp: "2026-09-04T10:15:00.000Z",
      event: { id: "o1", timestamp: "2026-09-04T10:15:00.000Z", taskId: "task-42", sessionId: null, contextId: "ctx-1", outcome: "success", signal: { testsPassed: true }, notes: null },
    },
    {
      kind: "feedback",
      timestamp: "2026-09-04T10:14:00.000Z",
      event: { id: "f1", timestamp: "2026-09-04T10:14:00.000Z", memoryId: "m1", taskId: "task-42", contextId: "ctx-1", useful: true, reason: null, notes: null },
    },
    {
      kind: "context",
      timestamp: "2026-09-04T10:13:00.000Z",
      event: {
        id: "ctx-1", timestamp: "2026-09-04T10:13:00.000Z", retrievalEventId: "r1", scope, taskId: "task-42",
        includedMemoryIds: ["m1"], omittedMemoryIds: [], tokenCount: 812, memories: [], candidateCount: 12,
        candidateTokenCount: 3400, retrievalMs: 40, rankingMs: 4, compileMs: 2, optimizeMs: 1,
      },
    },
    {
      kind: "mutation",
      timestamp: "2026-09-04T10:10:00.000Z",
      event: { id: "mu1", timestamp: "2026-09-04T10:10:00.000Z", memoryId: "m2", mutationType: "create", actor: { origin: "agent" }, summary: "created rule memory" },
    },
  ],
};

export const emptyOverviewFixture: OverviewResponse = {
  memories: {
    total: 0, active: 0, archived: 0,
    byType: { fact: 0, decision: 0, pattern: 0, rule: 0, procedure: 0, experience: 0, error: 0, constraint: 0, project_state: 0, task_state: 0, agent_experience: 0, preference: 0 },
  },
  events: { contextEvents: 0, feedbackEvents: 0, outcomeEvents: 0, retrievalEvents: 0 },
  vectorSearchAvailable: true,
  appliedMigrations: ["0001_initial_schema.sql"],
  learning: { enabled: false },
  redundancy: { enabled: false },
  workflow: { tasksTracked: 0, tasksWithContext: 0, tasksWithFeedback: 0, tasksWithOutcome: 0 },
  recentActivity: [],
};
