#!/usr/bin/env node

import { mkdirSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const help = `Usage: brain-mcp [database-path]
       brain-mcp --check [database-path]
       brain-mcp --config [database-path]
       brain-mcp --version

Run the Brainded MCP server over stdio. The default database is ~/.brainded/brain.db.
--check opens the database and reports storage and vector extension availability.
--config prints an MCP host configuration for this installation.`;

async function run(args: string[]): Promise<void> {
  const [first, second] = args;
  if (args.length === 1 && (first === "--help" || first === "-h")) {
    console.log(help);
    return;
  }
  if (args.length === 1 && first === "--version") {
    const manifest = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")) as { version: string };
    console.log(manifest.version);
    return;
  }
  const mode = first === "--check" || first === "--config" ? first : undefined;
  const givenPath = mode ? second : first;
  if (args.length > (mode ? 2 : 1) || givenPath?.startsWith("-")) throw new Error(help);

  const dataDir = join(homedir(), ".brainded");
  const dbPath = givenPath ? resolve(givenPath) : join(dataDir, "brain.db");
  if (mode === "--config") {
    console.log(JSON.stringify({ mcpServers: { "ai-brain": { command: process.execPath, args: [fileURLToPath(import.meta.url), dbPath] } } }, null, 2));
    return;
  }

  if (!givenPath || dbPath === join(dataDir, "brain.db")) mkdirSync(dataDir, { recursive: true });
  const options = {
    cacheDir: process.env.BRAIN_MODEL_CACHE_DIR ? resolve(process.env.BRAIN_MODEL_CACHE_DIR) : join(dataDir, "models"),
    localFilesOnly: process.env.BRAIN_LOCAL_FILES_ONLY === "1",
  };
  if (mode === "--check") {
    const { createBrain } = await import("./bootstrap.js");
    const brain = createBrain(dbPath, options);
    try {
      console.log(JSON.stringify({ dbPath, ...await brain.gateway.status() }, null, 2));
    } finally {
      brain.close();
    }
    return;
  }

  const { main } = await import("./server.js");
  await main(dbPath, options);
}

run(process.argv.slice(2)).catch(error => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
