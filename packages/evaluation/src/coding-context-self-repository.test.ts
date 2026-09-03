import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { globalScope } from "@brain/contracts";
import {
  openDatabase,
  SqliteMemoryRepository,
  SqliteRetrievalStore,
  SqliteEventStore,
  SqliteCodebaseRepository,
  SqliteCodeSearchStore,
  SqliteCodeDependencyStore,
  LocalEmbeddingProvider,
} from "@brain/storage";
import { MemoryService } from "@brain/memory";
import { RetrievalService, CodeRetrievalService } from "@brain/retrieval";
import { EventService } from "@brain/learning";
import { DependencyGraphService, CodebaseIndexer, DependencySynchronizer } from "@brain/codebase";
import { Gateway } from "@brain/gateway";

/**
 * Phase 3.4 integration tier: REAL CODING PILOT (PHASE_3_SPEC.md Task 12). The
 * final, most important evaluation -- runs the real, shipped Gateway (the same
 * wiring as packages/mcp's bootstrap.ts composition root) against the real
 * ai-brain repository, read-only: real indexing, real dependency sync, real
 * LocalEmbeddingProvider, real token budget. Deliberately separate from the
 * frozen fixture (coding-context-evaluation.test.ts, Task 10) -- that one
 * grades recall against hand-labeled ground truth; this one is a qualitative
 * demonstration on genuinely useful questions plus contextId/outcome
 * round-trip, mirroring 3.2/3.3's code-self-repository.test.ts and
 * dependency-self-repository.test.ts exactly.
 */

// Five real, currently-useful questions about this actual repository (chosen by
// reading the real source this session, not assumed) -- each maps to a distinct,
// verified, current piece of code:
//   1. scopeWhere() in packages/storage/src/code-search-store.ts
//   2. the zod .refine() invariant on CodeDependencyEdgeSchema in
//      packages/core/contracts/src/code-dependency.ts
//   3. fillBudget/optimizeContext in packages/core/token
//   4. the "unresolved" branch in packages/codebase/src/dependency-resolve.ts
//   5. DEFAULT_NEAR_DUPLICATE_POLICY in packages/core/retrieval/src/lexical-containment.ts
const REAL_TASKS = [
  "where is scope isolation enforced for code search",
  "what validates a CodeDependencyEdge's targetFileId/resolution invariant",
  "where does the token budget get enforced",
  "how does dependency resolution handle a missing target file",
  "where is the redundancy near-duplicate policy defined",
];

test(
  "[integration] Phase 3.4 real coding pilot: 5 real tasks against this repository, contextId round-tripped through feedback/outcome",
  { timeout: 600_000 },
  async () => {
    const projectRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
    const dbDir = mkdtempSync(join(tmpdir(), "brain-3.4-pilot-"));

    try {
      const db = openDatabase(join(dbDir, "brain.db"));
      const embeddings = new LocalEmbeddingProvider();
      const codebaseRepo = new SqliteCodebaseRepository(db.raw);
      const codeSearchStore = new SqliteCodeSearchStore(db.raw, embeddings, db.vectorSearchAvailable);
      const codeDependencyStore = new SqliteCodeDependencyStore(db.raw);

      const indexer = new CodebaseIndexer(codebaseRepo);
      const indexResult = await indexer.indexRepository({ scope: globalScope(), rootPath: projectRoot });
      await codeSearchStore.syncEmbeddings(indexResult.repositoryId);
      const synchronizer = new DependencySynchronizer(codebaseRepo, codeDependencyStore);
      await synchronizer.syncDependencies({ scope: globalScope(), rootPath: projectRoot, repositoryId: indexResult.repositoryId });

      const gateway = new Gateway(
        new MemoryService(new SqliteMemoryRepository(db.raw, embeddings)),
        new RetrievalService(new SqliteRetrievalStore(db.raw, embeddings, db.vectorSearchAvailable)),
        new EventService(new SqliteEventStore(db.raw)),
        { vectorSearchAvailable: db.vectorSearchAvailable },
        undefined,
        new CodeRetrievalService(codeSearchStore),
        new DependencyGraphService(codebaseRepo, codeDependencyStore),
      );

      console.log("\n[Phase 3.4 real coding pilot]");
      console.log(`  files indexed: ${indexResult.filesIndexed + indexResult.filesUpdated}, chunks: ${indexResult.chunksCreated}`);

      for (const taskText of REAL_TASKS) {
        const start = performance.now();
        const pack = await gateway.getContext({ task: taskText, scope: globalScope(), budget: { maxTokens: 3000 }, taskId: `pilot-${taskText.slice(0, 20)}` });
        const latencyMs = performance.now() - start;

        console.log(`\nTASK: ${taskText}`);
        console.log(`  contextId: ${pack.contextId}`);
        console.log(`  memory items: ${pack.items.length}, code items: ${pack.codeItems?.length ?? 0}, dependency items: ${pack.dependencyItems?.length ?? 0}`);
        console.log(`  tokenCount: ${pack.tokenCount} / 3000 (${((pack.tokenCount / 3000) * 100).toFixed(1)}%)`);
        console.log(`  latencyMs: ${latencyMs.toFixed(1)}`);
        for (const c of pack.codeItems ?? []) console.log(`    [CODE] ${c.relativePath}:${c.startLine}-${c.endLine} (score=${c.score.toFixed(3)})`);
        for (const d of pack.dependencyItems ?? []) console.log(`    [DEPENDENCY] ${d.seedRelativePath} ${d.relation}: ${d.facts.map((f) => f.relativePath).join(", ")}`);

        assert.ok(pack.tokenCount <= 3000, `task "${taskText}" exceeded budget`);
        assert.ok(pack.contextId, `task "${taskText}" must record a contextId`);

        // Gateway.recordOutcome only calls requireKnownContext(contextId) --
        // it never reads pack.items -- so gating this on pack.items.length
        // (memory items specifically) was wrong: it made the outcome
        // round-trip permanently unreachable for a coding pilot, whose DB is
        // never seeded with memories. contextId is already confirmed truthy
        // above; that's the only precondition recordOutcome actually has.
        const outcome = await gateway.recordOutcome({
          taskId: `pilot-${taskText.slice(0, 20)}`,
          sessionId: null,
          contextId: pack.contextId,
          outcome: "success",
          signal: null,
          notes: `Phase 3.4 real pilot: ${taskText}`,
        });
        assert.equal(outcome.contextId, pack.contextId);
        console.log(`  outcome recorded: ${outcome.contextId === pack.contextId}`);
      }

      db.close();
    } finally {
      // Cleanup failure must never mask a real assertion/error from the body above,
      // and must never fail the test on its own -- Windows can hold a brief file
      // lock on WAL/SHM files right after close() (same rationale as
      // code-self-repository.test.ts); a residual temp-dir leak is harmless
      // (OS-reclaimed).
      try {
        rmSync(dbDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
      } catch (cleanupError) {
        console.warn(`temp dir cleanup failed (non-fatal, left at ${dbDir}):`, cleanupError);
      }
    }
  },
);
