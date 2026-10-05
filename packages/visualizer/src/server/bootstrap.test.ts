import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { globalScope } from "@brain/contracts";
import { openDatabase, SqliteMemoryRepository } from "@brain/storage";
import { FakeEmbeddingProvider } from "@brain/test-fixtures";
import { createVisualizerBrain } from "./bootstrap.js";

function tempDbPath(): string {
  return join(mkdtempSync(join(tmpdir(), "brain-visualizer-bootstrap-")), "brain.db");
}

test("createVisualizerBrain: opens a real database readonly and getOverview reflects seeded data", async () => {
  const path = tempDbPath();

  // Seed via a normal read-write connection first -- bootstrap.ts's own connection
  // must never be able to do this itself.
  const seedDb = openDatabase(path);
  const repo = new SqliteMemoryRepository(seedDb.raw, new FakeEmbeddingProvider());
  await repo.create({ type: "fact", content: "seeded before the visualizer ever opens this file", scope: globalScope() });
  seedDb.close();

  const brain = createVisualizerBrain(path);
  try {
    const overview = await brain.queryService.getOverview();
    assert.equal(overview.memories.total, 1);
    assert.equal(overview.memories.byType.fact, 1);
    assert.equal(overview.vectorSearchAvailable, true);
    assert.ok(overview.appliedMigrations.includes("0001_initial_schema.sql"));
  } finally {
    brain.close();
    rmSync(dirname(path), { recursive: true, force: true });
  }
});
