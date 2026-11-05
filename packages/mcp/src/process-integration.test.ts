import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { globalScope } from "@brain/contracts";
import { openDatabase } from "@brain/storage";

const __dirname = dirname(fileURLToPath(import.meta.url));
const SERVER_JS = join(__dirname, "..", "dist", "server.js");

async function connectViaProcess(dbPath: string) {
  const transport = new StdioClientTransport({ command: process.execPath, args: [SERVER_JS, dbPath] });
  const client = new Client({ name: "process-integration-test", version: "0.0.0" });
  await client.connect(transport);
  return { client, close: () => client.close() };
}

function parsed(result: CallToolResult): any {
  return JSON.parse((result.content[0] as { text: string }).text);
}

test("cross-client: a memory written by one process is retrievable by a second, independent process, same DB file", async () => {
  const dir = await mkdtemp(join(tmpdir(), "brain-cross-client-"));
  const dbPath = join(dir, "test.db");
  try {
    const clientA = await connectViaProcess(dbPath);
    let created: { id: string };
    try {
      const instructions = clientA.client.getInstructions() ?? "";
      assert.match(instructions, /brain_context before implementation/);
      assert.match(instructions, /brain_feedback once with taskId, contextId, and memoryId/);
      assert.match(instructions, /brain_record_outcome with the same taskId and contextId/);
      assert.match(instructions, /Leave uncertain items unlabeled/);
      created = parsed(
        (await clientA.client.callTool({
          name: "brain_remember",
          arguments: { type: "fact", content: "cross-client fixture", scope: globalScope() },
        })) as CallToolResult,
      ) as { id: string };
    } finally {
      await clientA.close();
    }

    const clientB = await connectViaProcess(dbPath);
    let recalled: any;
    try {
      recalled = parsed(
        (await clientB.client.callTool({
          name: "brain_recall",
          arguments: { scope: globalScope(), id: created.id },
        })) as CallToolResult,
      );
    } finally {
      await clientB.close();
    }

    // Both clients are already closed by this point, whether or not the
    // assertions below throw -- neither process can leak past this test.
    assert.equal(recalled.id, created.id);
    assert.equal(recalled.content, "cross-client fixture");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("concurrency: two independent processes writing to the same DB file concurrently never corrupt it", async () => {
  const dir = await mkdtemp(join(tmpdir(), "brain-concurrency-"));
  const dbPath = join(dir, "test.db");
  try {
    const clientA = await connectViaProcess(dbPath);
    const clientB = await connectViaProcess(dbPath);

    let seeded: { id: string };
    let settled: PromiseSettledResult<CallToolResult>[];
    let rememberCount: number;
    let otherCount: number;
    try {
      // Seeded non-concurrently so the concurrent batch below has a valid,
      // pre-existing memoryId to recall/attach feedback to -- it has to
      // exist before it can be hit concurrently.
      seeded = parsed(
        (await clientA.client.callTool({
          name: "brain_remember",
          arguments: { type: "fact", content: "concurrency-seed", scope: globalScope() },
        })) as CallToolResult,
      ) as { id: string };
      assert.ok(seeded.id, "seed brain_remember must succeed before the concurrent batch runs");

      const callsA = Array.from({ length: 10 }, (_, i) =>
        clientA.client.callTool({
          name: "brain_remember",
          arguments: { type: "fact", content: `concurrency-A-${i}`, scope: globalScope() },
        }) as Promise<CallToolResult>,
      );
      const callsB = Array.from({ length: 10 }, (_, i) =>
        clientB.client.callTool({
          name: "brain_remember",
          arguments: { type: "fact", content: `concurrency-B-${i}`, scope: globalScope() },
        }) as Promise<CallToolResult>,
      );
      const rememberCalls = [...callsA, ...callsB];

      // The same call types Task 11's spec asks for alongside memory writes
      // -- a read, a feedback write, and an outcome write -- fired into the
      // SAME concurrent batch, against the memory seeded above.
      const otherCalls = [
        clientB.client.callTool({
          name: "brain_recall",
          arguments: { scope: globalScope(), id: seeded.id },
        }) as Promise<CallToolResult>,
        clientA.client.callTool({
          name: "brain_feedback",
          arguments: { memoryId: seeded.id, useful: true },
        }) as Promise<CallToolResult>,
        clientB.client.callTool({
          name: "brain_record_outcome",
          arguments: { taskId: randomUUID(), outcome: "success" },
        }) as Promise<CallToolResult>,
      ];

      rememberCount = rememberCalls.length;
      otherCount = otherCalls.length;
      settled = await Promise.allSettled([...rememberCalls, ...otherCalls]);
    } finally {
      await clientA.close();
      await clientB.close();
    }

    // Split the settled batch back into remember-type vs. the other three
    // call types -- Promise.allSettled preserves input order, so this slice
    // is exact.
    const rememberSettled = settled.slice(0, rememberCount);
    const otherSettled = settled.slice(rememberCount);

    const rememberFulfilled = rememberSettled.filter((r): r is PromiseFulfilledResult<CallToolResult> => r.status === "fulfilled");
    const rememberSucceeded = rememberFulfilled.filter((r) => r.value.isError !== true);
    const rememberToolErrors = rememberFulfilled.filter((r) => r.value.isError === true);

    const otherFulfilled = otherSettled.filter((r): r is PromiseFulfilledResult<CallToolResult> => r.status === "fulfilled");
    const otherSucceeded = otherFulfilled.filter((r) => r.value.isError !== true);
    const otherToolErrors = otherFulfilled.filter((r) => r.value.isError === true);

    const rejected = settled.filter((r) => r.status === "rejected");

    // Hard requirement: no unrecognized crash, across every call type in the
    // batch (remember, recall, feedback, outcome alike). A tool-level error
    // (isError: true, e.g. a clean SQLITE_BUSY surfaced through the gateway's
    // error model) is an acceptable, characterizable outcome; a
    // transport-level rejection (process crash, malformed response) is not.
    assert.equal(rejected.length, 0, `expected zero transport-level rejections, got ${rejected.length}: ${JSON.stringify(rejected.map((r) => (r as PromiseRejectedResult).reason?.message))}`);

    // Collect both queries before asserting on either -- db.close() must run
    // even if integrity_check comes back corrupt, otherwise the open readonly
    // handle can make the outer `finally`'s directory removal fail on
    // Windows and mask the real AssertionError with a filesystem error.
    const db = openDatabase(dbPath, { readonly: true });
    let integrity: { integrity_check: string }[];
    let storedCount: number;
    try {
      integrity = db.raw.pragma("integrity_check") as { integrity_check: string }[];
      storedCount = (db.raw.prepare(`SELECT COUNT(*) as c FROM memories`).get() as { c: number }).c;
    } finally {
      db.close();
    }

    // Hard requirement: the database itself is never corrupted, regardless of
    // how many individual writes succeeded.
    assert.deepEqual(integrity, [{ integrity_check: "ok" }]);

    // Hard requirement: every brain_remember call that reported success --
    // including the non-concurrent seed -- has a durable row in `memories`.
    // No silent data loss behind a false-positive success response. Scoped
    // to remember-type calls specifically: brain_feedback/brain_record_outcome
    // land in different tables and are not part of this count.
    assert.equal(
      storedCount,
      rememberSucceeded.length + 1,
      "every brain_remember call reporting success, plus the seed row, must have a durable row -- no false positives",
    );

    // Characterization, not a pass/fail gate either way: report what happened.
    console.log(
      `concurrency characterization: ${rememberSucceeded.length}/${rememberCount} remember calls succeeded, ` +
        `${rememberToolErrors.length}/${rememberCount} returned a tool-level error` +
        (rememberToolErrors.length > 0 ? ` (first: ${JSON.stringify(parsed(rememberToolErrors[0]!.value))})` : "") +
        `; ${otherSucceeded.length}/${otherCount} read/feedback/outcome calls succeeded, ` +
        `${otherToolErrors.length}/${otherCount} returned a tool-level error` +
        (otherToolErrors.length > 0 ? ` (first: ${JSON.stringify(parsed(otherToolErrors[0]!.value))})` : ""),
    );
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
