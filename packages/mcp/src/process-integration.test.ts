import { test } from "node:test";
import assert from "node:assert/strict";
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
    const created = parsed(
      (await clientA.client.callTool({
        name: "brain_remember",
        arguments: { type: "fact", content: "cross-client fixture", scope: globalScope() },
      })) as CallToolResult,
    ) as { id: string };
    await clientA.close();

    const clientB = await connectViaProcess(dbPath);
    const recalled = parsed(
      (await clientB.client.callTool({
        name: "brain_recall",
        arguments: { scope: globalScope(), id: created.id },
      })) as CallToolResult,
    );
    assert.equal(recalled.id, created.id);
    assert.equal(recalled.content, "cross-client fixture");
    await clientB.close();
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

    const settled = await Promise.allSettled([...callsA, ...callsB]);
    await clientA.close();
    await clientB.close();

    const fulfilled = settled.filter((r): r is PromiseFulfilledResult<CallToolResult> => r.status === "fulfilled");
    const succeeded = fulfilled.filter((r) => r.value.isError !== true);
    const toolErrors = fulfilled.filter((r) => r.value.isError === true);
    const rejected = settled.filter((r) => r.status === "rejected");

    // Hard requirement: no unrecognized crash. A tool-level error (isError:
    // true, e.g. a clean SQLITE_BUSY surfaced through the gateway's error
    // model) is an acceptable, characterizable outcome; a transport-level
    // rejection (process crash, malformed response) is not.
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

    // Hard requirement: every call that reported success actually landed —
    // no silent data loss behind a false-positive success response.
    assert.equal(storedCount, succeeded.length, "every call reporting success must have a durable row -- no false positives");

    // Characterization, not a pass/fail gate either way: report what happened.
    console.log(
      `concurrency characterization: ${succeeded.length}/20 succeeded, ${toolErrors.length}/20 returned a tool-level error` +
        (toolErrors.length > 0 ? ` (first: ${JSON.stringify(parsed(toolErrors[0]!.value))})` : ""),
    );
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
