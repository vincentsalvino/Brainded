import { test } from "node:test";
import assert from "node:assert/strict";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { globalScope } from "@brain/contracts";
import { FakeCodebaseRepository } from "@brain/test-fixtures";
import { CodebaseIndexer } from "./indexer.js";

// Performance Baseline (PHASE_3_TASKS.md #12): index this repository itself,
// read-only (the indexer never writes into rootPath -- only discovery.ts's own
// fs.readdir/readFile/realpath calls touch it), and report the numbers. Uses
// FakeCodebaseRepository, not a real SQLite database, because this test measures
// discovery/hash/chunk cost specifically, not storage I/O -- see PHASE_3_SPEC.md
// Part A for why packages/codebase never depends on @brain/storage.
test("[integration] indexing this repository: cold pass, then an unchanged re-index", async () => {
  const projectRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
  const repo = new FakeCodebaseRepository();
  const indexer = new CodebaseIndexer(repo);

  const cold = await indexer.indexRepository({ scope: globalScope(), rootPath: projectRoot });
  const warm = await indexer.indexRepository({ scope: globalScope(), rootPath: projectRoot });

  console.log("[self-index perf]", {
    filesDiscovered: cold.filesDiscovered,
    filesIndexed: cold.filesIndexed,
    filesSkipped: cold.filesSkipped,
    chunksCreated: cold.chunksCreated,
    coldIndexDurationMs: Math.round(cold.durationMs),
    unchangedReindexDurationMs: Math.round(warm.durationMs),
    filesUnchangedOnWarmPass: warm.filesUnchanged,
  });

  assert.ok(cold.filesDiscovered > 0, "expected at least one file in this repository");
  assert.equal(
    warm.filesUnchanged,
    cold.filesIndexed + cold.filesUpdated,
    "a re-index of an untouched repository must report every previously-indexed file as unchanged",
  );
  assert.equal(warm.chunksCreated, 0, "an unchanged re-index must not recreate any chunks");
});
