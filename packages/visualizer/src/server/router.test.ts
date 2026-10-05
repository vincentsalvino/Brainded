import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { globalScope } from "@brain/contracts";
import { FakeEventStore, FakeMemoryRepository, FakeRetrievalStore, FakeMemoryPerformanceStore } from "@brain/test-fixtures";
import { VisualizerQueryService } from "./query-service.js";
import { createApiHandler } from "./router.js";

async function startServer() {
  const eventStore = new FakeEventStore();
  const memoryRepo = new FakeMemoryRepository(eventStore);
  const retrievalStore = new FakeRetrievalStore();
  const performanceStore = new FakeMemoryPerformanceStore();
  const queryService = new VisualizerQueryService(memoryRepo, eventStore, retrievalStore, performanceStore, {
    vectorSearchAvailable: true,
    appliedMigrations: [],
  });
  const server = createServer(createApiHandler(queryService));
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const { port } = server.address() as AddressInfo;
  return {
    baseUrl: `http://127.0.0.1:${port}`,
    eventStore,
    memoryRepo,
    retrievalStore,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}

test("GET /api/overview returns 200 and the overview shape", async () => {
  const { baseUrl, close } = await startServer();
  try {
    const res = await fetch(`${baseUrl}/api/overview`);
    assert.equal(res.status, 200);
    const body = (await res.json()) as Record<string, unknown>;
    assert.ok("memories" in body);
    assert.ok("events" in body);
    assert.ok("recentActivity" in body);
  } finally {
    await close();
  }
});

test("GET /api/contexts returns 200 and an items array", async () => {
  const { baseUrl, close } = await startServer();
  try {
    const res = await fetch(`${baseUrl}/api/contexts`);
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.deepEqual(body, { items: [] });
  } finally {
    await close();
  }
});

test("GET /api/contexts/:id returns 200 for a known id, 404 for an unknown one", async () => {
  const { baseUrl, eventStore, close } = await startServer();
  try {
    const retrieval = await eventStore.recordRetrieval({ scope: globalScope(), queryText: "q", candidateIds: [], taskId: null });
    const ctx = await eventStore.recordContext({
      retrievalEventId: retrieval.id,
      scope: globalScope(),
      taskId: null,
      includedMemoryIds: [],
      omittedMemoryIds: [],
      tokenCount: 0,
      memories: [],
      candidateCount: null,
      candidateTokenCount: null,
      retrievalMs: null,
      rankingMs: null,
      compileMs: null,
      optimizeMs: null,
    });

    const found = await fetch(`${baseUrl}/api/contexts/${ctx.id}`);
    assert.equal(found.status, 200);
    const body = (await found.json()) as { context: { id: string } };
    assert.equal(body.context.id, ctx.id);

    const missing = await fetch(`${baseUrl}/api/contexts/00000000-0000-0000-0000-000000000000`);
    assert.equal(missing.status, 404);
  } finally {
    await close();
  }
});

test("GET /api/graph/memories returns 200 with nodes/edges/meta, and respects ?minSimilarity=", async () => {
  const { baseUrl, memoryRepo, retrievalStore, close } = await startServer();
  try {
    const a = await memoryRepo.create({ type: "fact", content: "alpha beta gamma delta epsilon", scope: globalScope() });
    retrievalStore.index(a);
    const b = await memoryRepo.create({ type: "fact", content: "alpha beta gamma delta zeta", scope: globalScope() });
    retrievalStore.index(b);

    const atDefault = await fetch(`${baseUrl}/api/graph/memories`);
    assert.equal(atDefault.status, 200);
    const defaultBody = (await atDefault.json()) as { nodes: unknown[]; similarityEdges: unknown[]; meta: { threshold: number } };
    assert.equal(defaultBody.nodes.length, 2);
    assert.equal(defaultBody.meta.threshold, 0.6);

    const atZero = await fetch(`${baseUrl}/api/graph/memories?minSimilarity=0`);
    const zeroBody = (await atZero.json()) as { meta: { threshold: number } };
    assert.equal(zeroBody.meta.threshold, 0);
  } finally {
    await close();
  }
});

test("GET /api/memories/:id returns 200 for a known id, 404 for an unknown one", async () => {
  const { baseUrl, memoryRepo, retrievalStore, close } = await startServer();
  try {
    const memory = await memoryRepo.create({ type: "fact", content: "x", scope: globalScope() });
    retrievalStore.index(memory);

    const found = await fetch(`${baseUrl}/api/memories/${memory.id}`);
    assert.equal(found.status, 200);
    const body = (await found.json()) as { memory: { id: string } };
    assert.equal(body.memory.id, memory.id);

    const missing = await fetch(`${baseUrl}/api/memories/00000000-0000-0000-0000-000000000000`);
    assert.equal(missing.status, 404);
  } finally {
    await close();
  }
});

test("GET /api/unknown-path returns 404", async () => {
  const { baseUrl, close } = await startServer();
  try {
    const res = await fetch(`${baseUrl}/api/unknown-path`);
    assert.equal(res.status, 404);
  } finally {
    await close();
  }
});

test("a queryService throw surfaces as 500, not a hang or crash", async () => {
  const { baseUrl, close, memoryRepo } = await startServer();
  try {
    // Force countAllMemories to reject by making the fake's map throw --
    // simplest reliable failure without adding a simulateFailure hook the fakes
    // don't otherwise need.
    memoryRepo.countAllMemories = () => Promise.reject(new Error("boom"));
    const res = await fetch(`${baseUrl}/api/overview`);
    assert.equal(res.status, 500);
    const body = await res.json();
    assert.deepEqual(body, { error: "internal error" });
  } finally {
    await close();
  }
});
