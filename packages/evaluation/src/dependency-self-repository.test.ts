import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { globalScope } from "@brain/contracts";
import { openDatabase, SqliteCodebaseRepository, SqliteCodeDependencyStore } from "@brain/storage";
import { CodebaseIndexer, DependencySynchronizer, DependencyGraphService } from "@brain/codebase";

/**
 * Phase 3.3 integration tier: SELF-REPOSITORY EVALUATION + PERFORMANCE BASELINE +
 * IMPACT DEMONSTRATION (PHASE_3_SPEC.md). Indexes and resolves dependencies for the
 * real ai-brain repository, read-only. Qualitative -- human-inspect the printed
 * output; not the formal metric dataset (that is
 * dependency-graph-evaluation.test.ts's frozen fixture).
 */

// Chosen by reading the actual source this session, not assumed: barrel/index.ts
// files are this codebase's real hub nodes for relative-import edges (packages
// mostly reference each other via bare @brain/* specifiers, which are correctly
// 'external' -- see PHASE_3_SPEC.md Known Unsupported Syntax on workspace-package
// resolution being out of scope). db.ts and hash.ts are real, verified leaf/utility
// files with actual sibling-file consumers.
const REPRESENTATIVE_FILES = [
  "packages/storage/src/index.ts",
  "packages/storage/src/db.ts",
  "packages/codebase/src/index.ts",
  "packages/core/retrieval/src/index.ts",
  "packages/codebase/src/dependency-synchronizer.ts",
];

const IMPACT_TARGETS = ["packages/codebase/src/hash.ts", "packages/codebase/src/dependency-mask.ts"];

test(
  "[integration] self-repository dependency evaluation + performance baseline: index and resolve this repository for real",
  { timeout: 300_000 },
  async () => {
    const projectRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
    const dbDir = mkdtempSync(join(tmpdir(), "brain-dep-self-repo-"));

    try {
      const db = openDatabase(join(dbDir, "brain.db"));
      const codebase = new SqliteCodebaseRepository(db.raw);
      const store = new SqliteCodeDependencyStore(db.raw);
      const indexer = new CodebaseIndexer(codebase);
      const synchronizer = new DependencySynchronizer(codebase, store);
      const graph = new DependencyGraphService(codebase, store);

      const cold = await indexer.indexRepository({ scope: globalScope(), rootPath: projectRoot });
      const coldStart = performance.now();
      const coldSync = await synchronizer.syncDependencies({ scope: globalScope(), rootPath: projectRoot, repositoryId: cold.repositoryId });
      const coldSyncDurationMs = performance.now() - coldStart;

      await indexer.indexRepository({ scope: globalScope(), rootPath: projectRoot });
      const warmStart = performance.now();
      const warmSync = await synchronizer.syncDependencies({ scope: globalScope(), rootPath: projectRoot, repositoryId: cold.repositoryId });
      const warmSyncDurationMs = performance.now() - warmStart;

      console.log(
        "\n[Phase 3.3 performance baseline]\n" +
          `  files eligible:              ${coldSync.filesExamined}\n` +
          `  files parsed (cold):         ${coldSync.filesParsed}\n` +
          `  files unchanged (warm):      ${warmSync.filesUnchanged}\n` +
          `  total edges:                 ${warmSync.internalEdges + warmSync.externalEdges + warmSync.unresolvedEdges}\n` +
          `  internal edges:              ${warmSync.internalEdges}\n` +
          `  external edges:              ${warmSync.externalEdges}\n` +
          `  unresolved edges:            ${warmSync.unresolvedEdges}\n` +
          `  cold sync duration:          ${Math.round(coldSyncDurationMs)}ms\n` +
          `  warm sync duration:          ${Math.round(warmSyncDurationMs)}ms`,
      );

      assert.equal(warmSync.filesParsed, 0, "a warm sync over an untouched repository must reparse nothing");
      assert.ok(warmSyncDurationMs < coldSyncDurationMs, "a warm unchanged sync must be materially cheaper than cold");

      const files = await codebase.listFiles(cold.repositoryId);
      const fileIdByRelativePath = new Map(files.map((f) => [f.relativePath, f.id]));

      console.log("\n[Phase 3.3 self-repository relationships] (human-inspect only -- not the formal metric dataset)");
      for (const relativePath of REPRESENTATIVE_FILES) {
        const fileId = fileIdByRelativePath.get(relativePath);
        if (!fileId) {
          console.log(`\n${relativePath}: NOT FOUND in the indexed repository`);
          continue;
        }
        const [deps, dependents] = await Promise.all([
          graph.dependenciesOf(cold.repositoryId, fileId),
          graph.dependentsOf(cold.repositoryId, fileId),
        ]);
        console.log(`\n${relativePath}`);
        console.log(`  dependenciesOf: ${deps.length === 0 ? "(none)" : deps.map((d) => d.relativePath).join(", ")}`);
        console.log(`  dependentsOf:   ${dependents.length === 0 ? "(none)" : dependents.map((d) => d.relativePath).join(", ")}`);
      }

      console.log("\n[Phase 3.3 impact demonstration] (\"transitively depends on\", not \"will break\")");
      for (const relativePath of IMPACT_TARGETS) {
        const fileId = fileIdByRelativePath.get(relativePath);
        if (!fileId) {
          console.log(`\n${relativePath}: NOT FOUND`);
          continue;
        }
        const impact = await graph.impactOf(cold.repositoryId, fileId);
        console.log(`\nimpactOf(${relativePath}), ${impact.length} file(s):`);
        for (const r of impact) console.log(`  depth ${r.depth}: ${r.relativePath}`);
      }

      db.close();
    } finally {
      rmSync(dbDir, { recursive: true, force: true });
    }
  },
);
