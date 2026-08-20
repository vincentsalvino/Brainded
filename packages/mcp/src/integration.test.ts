import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { globalScope, projectScope } from "@brain/contracts";
import { FakeEmbeddingProvider } from "@brain/test-fixtures";
import { openDatabase, SqliteMemoryRepository, SqliteRetrievalStore, SqliteEventStore } from "@brain/storage";
import { MemoryService } from "@brain/memory";
import { RetrievalService } from "@brain/retrieval";
import { EventService } from "@brain/learning";
import { Gateway } from "@brain/gateway";
import { registerBrainTools } from "./server.js";

// Full-path integration tests (this task's Step 19), driven through the REAL MCP
// wire protocol -- InMemoryTransport.createLinkedPair() carries real JSON-RPC
// messages between a real Client and a real McpServer, no stdio/subprocess
// needed -- against REAL SQLite storage (openDatabase(":memory:"), same as
// packages/storage's own cross-repository tests use). This proves the whole
// stack (adapter -> gateway -> retrieval -> ranking -> context -> token budget
// -> storage) actually wires together end to end, not just that each layer's
// own unit tests pass in isolation. Embeddings use FakeEmbeddingProvider, not
// LocalEmbeddingProvider -- same reason packages/storage's own repository tests
// do: a real model download doesn't belong in the default test run (see
// local-embedding-provider.test.ts, the one place that IS tested for real).
//
// The client below is a bare MCP SDK `Client`, not a subclass or wrapper named
// after any real product -- standing in for "any MCP-speaking agent" (this
// task's Step 15: agent-agnosticism must hold for a client the Brain has never
// seen, not just the ones on the shipping roadmap).

function setup() {
  const db = openDatabase(":memory:");
  const embeddings = new FakeEmbeddingProvider();
  const memoryRepository = new SqliteMemoryRepository(db.raw, embeddings);
  const retrievalStore = new SqliteRetrievalStore(db.raw, embeddings, db.vectorSearchAvailable);
  const eventStore = new SqliteEventStore(db.raw);
  const gateway = new Gateway(
    new MemoryService(memoryRepository),
    new RetrievalService(retrievalStore),
    new EventService(eventStore),
    { vectorSearchAvailable: db.vectorSearchAvailable },
  );
  return { db, eventStore, gateway };
}

async function connectCustomAgent(gateway: Gateway) {
  const server = new McpServer({ name: "ai-brain", version: "0.1.0" });
  registerBrainTools(server, gateway);

  const client = new Client({ name: "custom-agent", version: "1.0.0" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);

  return {
    client,
    close: async () => {
      await client.close();
      await server.close();
    },
  };
}

function parsed(result: CallToolResult): any {
  return JSON.parse((result.content[0] as { text: string }).text);
}

test("custom agent: discovers the 10 brain_* tools through tools/list", async () => {
  const { db, gateway } = setup();
  const { client, close } = await connectCustomAgent(gateway);
  const { tools } = await client.listTools();
  assert.equal(tools.length, 10);
  assert.ok(tools.every((t) => t.name.startsWith("brain_")));
  await close();
  db.close();
});

test("full path: brain_remember -> brain_recall round-trips through real storage over the wire", async () => {
  const { db, gateway } = setup();
  const { client, close } = await connectCustomAgent(gateway);

  const created = parsed(
    (await client.callTool({
      name: "brain_remember",
      arguments: { type: "fact", content: "use conventional commits", scope: globalScope() },
    })) as CallToolResult,
  );
  const recalled = parsed(
    (await client.callTool({ name: "brain_recall", arguments: { scope: globalScope(), id: created.id } })) as CallToolResult,
  );

  assert.equal(recalled.id, created.id);
  assert.equal(recalled.content, "use conventional commits");
  await close();
  db.close();
});

test("full path: brain_context runs retrieval -> ranking -> context -> token budget and stays within budget", async () => {
  const { db, gateway } = setup();
  const { client, close } = await connectCustomAgent(gateway);

  await client.callTool({
    name: "brain_remember",
    arguments: { type: "pattern", content: "use conventional commits for every pull request", scope: globalScope() },
  });
  const result = (await client.callTool({
    name: "brain_context",
    arguments: { task: "conventional commits", scope: globalScope(), maxTokens: 500 },
  })) as CallToolResult;

  assert.equal(result.isError, undefined);
  const pack = parsed(result);
  assert.ok(pack.tokenCount <= 500);
  await close();
  db.close();
});

test("scope isolation holds through the full MCP path: Project A memory is invisible to Project B", async () => {
  const { db, gateway } = setup();
  const { client, close } = await connectCustomAgent(gateway);

  await client.callTool({
    name: "brain_remember",
    arguments: { type: "fact", content: "Authentication uses JWT.", scope: projectScope("project-a") },
  });

  const recalled = parsed(
    (await client.callTool({ name: "brain_recall", arguments: { scope: projectScope("project-b") } })) as CallToolResult,
  );
  assert.equal(recalled.items.length, 0);

  const { results } = parsed(
    (await client.callTool({
      name: "brain_search",
      arguments: { text: "JWT", scope: projectScope("project-b") },
    })) as CallToolResult,
  );
  assert.equal(results.length, 0);

  const pack = parsed(
    (await client.callTool({
      name: "brain_context",
      arguments: { task: "JWT authentication", scope: projectScope("project-b"), maxTokens: 500 },
    })) as CallToolResult,
  );
  assert.ok(!JSON.stringify(pack).includes("Authentication uses JWT"));

  await close();
  db.close();
});

test("error model survives the wire: recall of an unknown id reports isError with a structured code, not a generic string", async () => {
  const { db, gateway } = setup();
  const { client, close } = await connectCustomAgent(gateway);

  const result = (await client.callTool({
    name: "brain_recall",
    arguments: { scope: globalScope(), id: "00000000-0000-0000-0000-000000000000" },
  })) as CallToolResult;

  assert.equal(result.isError, true);
  const body = parsed(result);
  assert.equal(body.code, "not_found");
  assert.ok(typeof body.message === "string" && body.message.length > 0);
  await close();
  db.close();
});

test("memory mutation -> audit event: brain_remember durably records a MemoryMutationEvent", async () => {
  const { db, gateway, eventStore } = setup();
  const { client, close } = await connectCustomAgent(gateway);

  const created = parsed(
    (await client.callTool({
      name: "brain_remember",
      arguments: { type: "fact", content: "durable mutation check", scope: globalScope() },
    })) as CallToolResult,
  );
  const mutations = await eventStore.getMutationsForMemory(created.id);

  assert.equal(mutations.length, 1);
  assert.equal(mutations[0]?.mutationType, "create");
  await close();
  db.close();
});

test("feedback -> learning event -> durable storage", async () => {
  const { db, gateway, eventStore } = setup();
  const { client, close } = await connectCustomAgent(gateway);

  const created = parsed(
    (await client.callTool({
      name: "brain_remember",
      arguments: { type: "fact", content: "feedback target", scope: globalScope() },
    })) as CallToolResult,
  );
  await client.callTool({ name: "brain_feedback", arguments: { memoryId: created.id, useful: true } });
  const events = await eventStore.getEventsForMemory(created.id);

  assert.equal(events.length, 1);
  assert.equal(events[0]?.useful, true);
  await close();
  db.close();
});

test("outcome recording -> durable storage, correlated by taskId", async () => {
  const { db, gateway, eventStore } = setup();
  const { client, close } = await connectCustomAgent(gateway);
  const taskId = randomUUID();

  await client.callTool({ name: "brain_context", arguments: { task: "some task", scope: globalScope(), maxTokens: 200, taskId } });
  await client.callTool({ name: "brain_record_outcome", arguments: { taskId, outcome: "success" } });
  const events = await eventStore.getEventsForTask(taskId);

  assert.equal(events.retrieval.length, 1);
  assert.equal(events.context.length, 1);
  assert.equal(events.outcome.length, 1);
  assert.equal(events.outcome[0]?.outcome, "success");
  await close();
  db.close();
});

test("full path: brain_update modifies an existing memory over the wire", async () => {
  const { db, gateway } = setup();
  const { client, close } = await connectCustomAgent(gateway);

  const created = parsed(
    (await client.callTool({
      name: "brain_remember",
      arguments: { type: "fact", content: "original content", scope: globalScope() },
    })) as CallToolResult,
  );
  const updated = parsed(
    (await client.callTool({
      name: "brain_update",
      arguments: { id: created.id, content: "revised content", scope: globalScope() },
    })) as CallToolResult,
  );

  assert.equal(updated.id, created.id);
  assert.equal(updated.content, "revised content");
  await close();
  db.close();
});

test("full path: brain_forget archives (not purges) a memory over the wire", async () => {
  const { db, gateway } = setup();
  const { client, close } = await connectCustomAgent(gateway);

  const created = parsed(
    (await client.callTool({
      name: "brain_remember",
      arguments: { type: "fact", content: "temp fact", scope: globalScope() },
    })) as CallToolResult,
  );
  const forgotten = parsed(
    (await client.callTool({ name: "brain_forget", arguments: { id: created.id, scope: globalScope() } })) as CallToolResult,
  );

  assert.equal(forgotten.status, "archived");
  await close();
  db.close();
});

test("full path: brain_project reports a memory count for the given project scope", async () => {
  const { db, gateway } = setup();
  const { client, close } = await connectCustomAgent(gateway);

  await client.callTool({ name: "brain_remember", arguments: { type: "fact", content: "a", scope: projectScope("project-a") } });
  await client.callTool({ name: "brain_remember", arguments: { type: "fact", content: "b", scope: projectScope("project-a") } });
  const info = parsed(
    (await client.callTool({ name: "brain_project", arguments: { projectId: "project-a" } })) as CallToolResult,
  );

  assert.equal(info.projectId, "project-a");
  assert.equal(info.memoryCount, 2);
  await close();
  db.close();
});

test("brain_status reports real capability state through the wire", async () => {
  const { db, gateway } = setup();
  const { client, close } = await connectCustomAgent(gateway);

  const status = parsed((await client.callTool({ name: "brain_status", arguments: {} })) as CallToolResult);

  assert.equal(status.ok, true);
  assert.equal(typeof status.vectorSearchAvailable, "boolean");
  await close();
  db.close();
});

// --- P2-005/006/015: end-to-end correlation over the real MCP wire ---------
//
// This is the direct answer to the Phase 2 audit's worst finding: 13 of 13
// recorded context deliveries had task_id NULL, so getEventsForTask returned an
// empty retrieval/context half for every real task and NOTHING could be
// attributed to a delivery. The Brain minted an id for every delivery and never
// returned it. It returns it now, and this test drives the whole loop through a
// real MCP client to prove it.

test("P2-005 ACCEPTANCE: brain_context -> contextId -> feedback + outcome -> durable, correlated storage", async () => {
  const { db, gateway, eventStore } = setup();
  const { client, close } = await connectCustomAgent(gateway);
  const taskId = randomUUID();

  const constraint = parsed(
    (await client.callTool({
      name: "brain_remember",
      arguments: {
        type: "constraint",
        content: "database access must go through the repository layer, never from route handlers",
        scope: projectScope("notes-api"),
        confidence: 1,
      },
    })) as CallToolResult,
  ) as { id: string };

  await client.callTool({
    name: "brain_remember",
    arguments: {
      type: "rule",
      content: "REST endpoints use plural resource names such as /notes",
      scope: projectScope("notes-api"),
      confidence: 1,
    },
  });

  // 1. The agent asks for context and is handed a delivery identifier.
  const delivery = parsed(
    (await client.callTool({
      name: "brain_context",
      arguments: {
        task: "refactor the database layer without changing API behavior",
        scope: projectScope("notes-api"),
        maxTokens: 500,
        taskId,
      },
    })) as CallToolResult,
  ) as {
    contextId: string | null;
    tokenCount: number;
    items: { memoryId: string }[];
  };

  assert.ok(delivery.contextId, "brain_context must return the id of the delivery it just recorded");
  assert.ok(delivery.items.length > 0);

  // 2. The agent reports on a specific memory IN THAT DELIVERY.
  await client.callTool({
    name: "brain_feedback",
    arguments: { memoryId: constraint.id, contextId: delivery.contextId, useful: true, reason: null, taskId },
  });

  // 3. And on the task outcome, naming the same delivery.
  await client.callTool({
    name: "brain_record_outcome",
    arguments: { taskId, contextId: delivery.contextId, outcome: "success", signal: { testsPassed: true } },
  });

  // --- the chain is now closed, end to end ---
  const contextEvent = await eventStore.getContextEvent(delivery.contextId);
  assert.ok(contextEvent, "the returned contextId must reference a real ContextEvent");

  const events = await eventStore.getEventsForTask(taskId);
  assert.equal(events.retrieval.length, 1);
  assert.equal(events.context.length, 1);
  assert.equal(events.outcome.length, 1);
  assert.equal(events.feedback.length, 1);
  assert.equal(events.feedback[0]?.contextId, delivery.contextId, "feedback points at the delivery");
  assert.equal(events.outcome[0]?.contextId, delivery.contextId, "outcome points at the delivery");
  assert.equal(events.context[0]?.retrievalEventId, events.retrieval[0]?.id, "context points at its retrieval");

  // Normalized membership rows exist and reconstruct the JSON arrays exactly.
  const membership = db.raw
    .prepare(`SELECT memory_id, included, rank, token_count FROM context_event_memories WHERE context_event_id = ?`)
    .all(delivery.contextId) as { memory_id: string; included: number; rank: number | null; token_count: number | null }[];
  assert.ok(membership.length > 0, "normalized membership rows must exist");
  assert.deepEqual(
    membership.filter((m) => m.included === 1).map((m) => m.memory_id).sort(),
    [...contextEvent.includedMemoryIds].sort(),
  );
  assert.deepEqual(
    membership.filter((m) => m.included === 0).map((m) => m.memory_id).sort(),
    [...contextEvent.omittedMemoryIds].sort(),
  );
  assert.deepEqual(
    membership.filter((m) => m.included === 1).map((m) => m.memory_id).sort(),
    [...delivery.items.map((i) => i.memoryId)].sort(),
    "what was stored as included is exactly what the agent was handed",
  );

  // Token accounting is consistent between the delivered pack and the stored rows.
  const deliveredTokens = membership
    .filter((m) => m.included === 1)
    .reduce((total, m) => total + (m.token_count ?? 0), 0);
  assert.equal(deliveredTokens, delivery.tokenCount);
  assert.equal(contextEvent.tokenCount, delivery.tokenCount);
  assert.ok((contextEvent.candidateTokenCount ?? 0) >= delivery.tokenCount);
  assert.equal(contextEvent.candidateCount, membership.length);

  await close();
  db.close();
});

test("P2-005 ACCEPTANCE: an unknown contextId is refused over the wire, not silently stored", async () => {
  const { db, gateway, eventStore } = setup();
  const { client, close } = await connectCustomAgent(gateway);

  const memory = parsed(
    (await client.callTool({
      name: "brain_remember",
      arguments: { type: "fact", content: "some fact", scope: globalScope() },
    })) as CallToolResult,
  ) as { id: string };

  const result = (await client.callTool({
    name: "brain_feedback",
    arguments: {
      memoryId: memory.id,
      contextId: "00000000-0000-4000-8000-000000000000",
      useful: true,
    },
  })) as CallToolResult;

  assert.equal(result.isError, true, "an unverifiable correlation id must fail loudly");
  assert.equal((await eventStore.getEventsForMemory(memory.id)).length, 0, "and must store nothing");

  await close();
  db.close();
});

test("P2-003: a pre-Phase-2B feedback payload (no contextId, no reason) is still accepted", async () => {
  const { db, gateway, eventStore } = setup();
  const { client, close } = await connectCustomAgent(gateway);

  const memory = parsed(
    (await client.callTool({
      name: "brain_remember",
      arguments: { type: "fact", content: "some fact", scope: globalScope() },
    })) as CallToolResult,
  ) as { id: string };

  // Exactly the payload a Phase 1 / Phase 2A agent sends. The new fields are
  // optional with schema defaults, so an existing caller keeps working unchanged.
  const result = (await client.callTool({
    name: "brain_feedback",
    arguments: { memoryId: memory.id, useful: true, notes: "worked" },
  })) as CallToolResult;
  assert.notEqual(result.isError, true);

  const stored = await eventStore.getEventsForMemory(memory.id);
  assert.equal(stored.length, 1);
  assert.equal(stored[0]?.contextId, null);
  assert.equal(stored[0]?.reason, null);

  const outcomeResult = (await client.callTool({
    name: "brain_record_outcome",
    arguments: { taskId: "legacy-task", outcome: "success" },
  })) as CallToolResult;
  assert.notEqual(outcomeResult.isError, true);
  assert.equal((await eventStore.getEventsForTask("legacy-task")).outcome[0]?.contextId, null);

  await close();
  db.close();
});
