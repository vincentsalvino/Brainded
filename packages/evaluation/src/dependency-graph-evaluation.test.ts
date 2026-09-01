import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { globalScope } from "@brain/contracts";
import { openDatabase, SqliteCodebaseRepository, SqliteCodeDependencyStore } from "@brain/storage";
import { CodebaseIndexer, DependencySynchronizer, DependencyGraphService } from "@brain/codebase";
import { DEPENDENCY_FIXTURE_FILES, DEPENDENCY_FIXTURE_GROUND_TRUTH } from "./dependency-graph.data.js";

/**
 * Phase 3.3 fixture evaluation (PHASE_3_SPEC.md QUALITY EVALUATION). Ground truth
 * was hand-labeled before this test was ever run against it -- see
 * dependency-graph.data.ts's own doc comment. Definitions, exactly as
 * PHASE_3_SPEC.md states them:
 *
 *   precision = correct extracted/resolved internal edges / all extracted/resolved internal edges
 *   recall    = correct extracted/resolved internal edges / all ground-truth internal edges
 *
 * plus resolution accuracy: across every ground-truth (source, specifier, kind)
 * triple (internal, external, AND unresolved), the fraction the extractor assigned
 * the correct resolution to.
 */

function edgeKey(source: string, specifier: string, kind: string): string {
  return `${source}\n${specifier}\n${kind}`;
}

test("[evaluation] Phase 3.3 dependency graph: precision/recall/resolution-accuracy on the frozen fixture", async () => {
  const root = mkdtempSync(join(tmpdir(), "brain-dep-fixture-"));
  const dbDir = mkdtempSync(join(tmpdir(), "brain-dep-fixture-db-"));
  try {
    for (const [relativePath, content] of Object.entries(DEPENDENCY_FIXTURE_FILES)) {
      const full = join(root, relativePath);
      mkdirSync(dirname(full), { recursive: true });
      writeFileSync(full, content);
    }

    const db = openDatabase(join(dbDir, "brain.db"));
    const codebase = new SqliteCodebaseRepository(db.raw);
    const store = new SqliteCodeDependencyStore(db.raw);
    const indexer = new CodebaseIndexer(codebase);
    const synchronizer = new DependencySynchronizer(codebase, store);
    const graph = new DependencyGraphService(codebase, store);

    const indexed = await indexer.indexRepository({ scope: globalScope(), rootPath: root });
    await synchronizer.syncDependencies({ scope: globalScope(), rootPath: root, repositoryId: indexed.repositoryId });

    const files = await codebase.listFiles(indexed.repositoryId);
    const relativePathByFileId = new Map(files.map((f) => [f.id, f.relativePath]));
    const fileIdByRelativePath = new Map(files.map((f) => [f.relativePath, f.id]));

    const actualEdges = await store.listEdges(indexed.repositoryId);
    const actualByKey = new Map(
      actualEdges.map((e) => [
        edgeKey(relativePathByFileId.get(e.sourceFileId) ?? "?", e.specifier, e.kind),
        { resolution: e.resolution, targetRelativePath: e.targetFileId ? relativePathByFileId.get(e.targetFileId) ?? null : null },
      ]),
    );

    let correctInternal = 0;
    let resolutionCorrect = 0;
    for (const truth of DEPENDENCY_FIXTURE_GROUND_TRUTH) {
      const actual = actualByKey.get(edgeKey(truth.source, truth.specifier, truth.kind));
      if (!actual) continue;
      if (actual.resolution === truth.resolution) {
        resolutionCorrect++;
        if (truth.resolution === "internal" && actual.targetRelativePath === truth.target) correctInternal++;
      }
    }

    const groundTruthInternalCount = DEPENDENCY_FIXTURE_GROUND_TRUTH.filter((t) => t.resolution === "internal").length;
    const actualInternalCount = actualEdges.filter((e) => e.resolution === "internal").length;

    const precision = actualInternalCount === 0 ? 0 : correctInternal / actualInternalCount;
    const recall = groundTruthInternalCount === 0 ? 0 : correctInternal / groundTruthInternalCount;
    const resolutionAccuracy = resolutionCorrect / DEPENDENCY_FIXTURE_GROUND_TRUTH.length;

    console.log(
      "\n[Phase 3.3 fixture evaluation]\n" +
        `  ground-truth edges:        ${DEPENDENCY_FIXTURE_GROUND_TRUTH.length} (${groundTruthInternalCount} internal)\n` +
        `  extracted edges:           ${actualEdges.length} (${actualInternalCount} internal)\n` +
        `  correct internal edges:    ${correctInternal}\n` +
        `  precision:                 ${precision.toFixed(3)}\n` +
        `  recall:                    ${recall.toFixed(3)}\n` +
        `  resolution accuracy:       ${resolutionAccuracy.toFixed(3)} (${resolutionCorrect}/${DEPENDENCY_FIXTURE_GROUND_TRUTH.length}, includes external/unresolved)`,
    );

    // Machinery correctness: metrics are well-formed. The actual values are
    // reported above, not gated on a pass/fail threshold (this fixture is far too
    // small for that to mean anything, and PHASE_3_SPEC.md explicitly warns
    // against tuning to make a small fixture's numbers look better).
    assert.ok(Number.isFinite(precision) && precision >= 0 && precision <= 1);
    assert.ok(Number.isFinite(recall) && recall >= 0 && recall <= 1);
    assert.ok(Number.isFinite(resolutionAccuracy) && resolutionAccuracy >= 0 && resolutionAccuracy <= 1);
    assert.equal(actualEdges.length, DEPENDENCY_FIXTURE_GROUND_TRUTH.length, "no extra/missing edges vs. the hand-labeled ground truth count");

    // Qualitative graph-query demonstration on the same fixture (human-inspectable,
    // not itself a metric): the two-node cycle must terminate and exclude itself.
    const cyclicA = fileIdByRelativePath.get("src/cyclic-a.ts") as string;
    const impact = await graph.impactOf(indexed.repositoryId, cyclicA);
    console.log(
      "\n[Phase 3.3 fixture demo] impactOf(src/cyclic-a.ts): " + impact.map((r) => `${r.relativePath}@${r.depth}`).join(", "),
    );
    assert.ok(!impact.some((r) => r.fileId === cyclicA), "the cycle must not include the origin in its own impact set");

    db.close();
  } finally {
    rmSync(root, { recursive: true, force: true });
    rmSync(dbDir, { recursive: true, force: true });
  }
});
