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
