import { test } from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { globalScope } from "@brain/contracts";
import { FakeMemoryRepository, FakeEventStore } from "@brain/test-fixtures";
import { MemoryService } from "@brain/memory";
import { KnowledgeImporter } from "./importer.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REAL_SEED_DIR = join(__dirname, "..", "..", "..", "references", "AEOS", "packages", "seed");

// P1-007's actual acceptance criterion (PHASE_1_TASKS.md): "AEOS's 98-file seed
// corpus imports cleanly under the new strict schema; any file that would have
// silently lost data under AEOS's non-strict parser (AUDIT_AEOS.md 8) now fails
// the import loudly with a clear error, not silently." This runs against the real
// reference corpus, not a fixture copy -- still network-free (FakeMemoryRepository/
// FakeEmbeddingProvider are never even constructed; MemoryService needs no
// embedding provider at all).
//
// AUDIT_AEOS.md 8 explicitly sampled rather than checking exhaustively ("sampling
// across architecture/decisions, architecture/anti-patterns, backend/auth,
// backend/database, and engineering/review found no other instances") and found 3
// mismatched files. Running strict validation against the full 98-file corpus --
// exactly what this test does -- found 7, not 3: 4 more files use field names
// (`related_principles`, `checks`, `severity`) that AEOS's own PatternSchema
// (references/AEOS/packages/core/src/schema.ts) doesn't recognize either, which the
// sample simply didn't happen to cover. This is the expected, correct outcome of
// strict validation over a sample-based audit, not a regression -- see this task's
// COMPATIBILITY NOTES.
test("imports the real AEOS 98-file seed corpus: the 7 field-name-mismatched files fail loudly, the other 91 import cleanly", async () => {
  const memory = new MemoryService(new FakeMemoryRepository(new FakeEventStore()));
  const importer = new KnowledgeImporter(memory);

  const result = await importer.importSeed(REAL_SEED_DIR);

  assert.equal(result.imported + result.failed.length, 98, "every one of the 98 files was accounted for");
  assert.equal(result.imported, 91);
  assert.equal(result.failed.length, 7);
  for (const failure of result.failed) {
    assert.ok(failure.error.length > 0, `failure for ${failure.file} has a real, non-empty error message`);
  }
  const failedFiles = result.failed.map((f) => f.file).sort();
  assert.deepEqual(failedFiles, [
    join("design", "motion", "principles", "purposeful-motion.yaml"),
    join("design", "principles", "frictionless-experience.yaml"),
    join("design", "principles", "frictionless-ux-review.yaml"),
    join("design", "principles", "intuitive-navigation.yaml"),
    join("design", "principles", "purposeful-motion.yaml"),
    join("design", "principles", "usability-first.yaml"),
    join("engineering", "review", "frictionless-ux-review.yaml"),
  ]);

  const all = await memory.query({ scope: globalScope(), limit: 200 });
  assert.equal(all.items.length, 91);
});
