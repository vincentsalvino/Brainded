import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, statSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { globalScope, type CodeSearchResult } from "@brain/contracts";
import { openDatabase, LocalEmbeddingProvider, SqliteCodebaseRepository, SqliteCodeSearchStore } from "@brain/storage";
import { CodebaseIndexer } from "@brain/codebase";
import { CodeRetrievalService } from "@brain/retrieval";

/**
 * Phase 3.2 integration tier: SELF-REPOSITORY EVALUATION + PERFORMANCE BASELINE
 * (PHASE_3_SPEC.md). Indexes and searches the real ai-brain repository, read-only,
 * with the real LocalEmbeddingProvider -- this is what makes the "human-inspect the
 * results" demonstration and the timing numbers meaningful (a fake embedding
 * provider would answer nothing about real semantic quality). Deliberately
 * separate from the default suite and from the fixture evaluation
 * (code-retrieval-evaluation.test.ts), which remains the frozen, hand-labeled
 * metric dataset -- this file is a qualitative demonstration plus timing, not a
 * second metrics gate (PHASE_3_SPEC.md explicitly warns against conflating the two).
 */

function channelOf(result: CodeSearchResult): string {
  const hasLexical = result.signals.lexicalScore !== undefined;
  const hasSemantic = result.signals.semanticScore !== undefined;
  if (hasLexical && hasSemantic) return "hybrid";
  if (hasLexical) return "lexical";
  if (hasSemantic) return "semantic";
  return "unknown";
}

const PRACTICAL_QUERIES = [
  "where is near duplicate classification implemented?",
  "where is the MCP server bootstrapped?",
  "where are SQLite migrations loaded?",
  "where is token budgeting enforced?",
  "where is codebase indexing implemented?",
];

test(
  "[integration] self-repository evaluation + performance baseline: index and search this repository for real",
  { timeout: 300_000 },
  async () => {
    const projectRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
    const dbDir = mkdtempSync(join(tmpdir(), "brain-code-eval-"));
    const dbPath = join(dbDir, "brain.db");

    try {
      const db = openDatabase(dbPath);
      const sizeBeforeIndexing = statSync(dbPath).size;

      const codebase = new SqliteCodebaseRepository(db.raw);
      const indexer = new CodebaseIndexer(codebase);
      const search = new SqliteCodeSearchStore(db.raw, new LocalEmbeddingProvider(), db.vectorSearchAvailable);
      const service = new CodeRetrievalService(search);

      const cold = await indexer.indexRepository({ scope: globalScope(), rootPath: projectRoot });

      const coldSyncStart = performance.now();
      const coldSync = await search.syncEmbeddings(cold.repositoryId);
      const coldSyncDurationMs = performance.now() - coldSyncStart;

      const warm = await indexer.indexRepository({ scope: globalScope(), rootPath: projectRoot });
      const unchangedSyncStart = performance.now();
      const unchangedSync = await search.syncEmbeddings(cold.repositoryId);
      const unchangedSyncDurationMs = performance.now() - unchangedSyncStart;

      const latencyQuery = { text: "near duplicate classification", scope: globalScope(), limit: 10 };
      const lexicalStart = performance.now();
      await search.lexicalSearch(latencyQuery);
      const lexicalLatencyMs = performance.now() - lexicalStart;

      const semanticStart = performance.now();
      await search.semanticSearch(latencyQuery);
      const semanticLatencyMs = performance.now() - semanticStart;

      const hybridStart = performance.now();
      await service.getCandidates(latencyQuery);
      const hybridLatencyMs = performance.now() - hybridStart;

      const sizeAfter = statSync(dbPath).size;

      console.log(
        "\n[Phase 3.2 performance baseline]\n" +
          `  code chunks indexed:            ${cold.chunksCreated}\n` +
          `  semantic chunks synchronized:    ${coldSync.chunksEmbedded} (unavailable=${!coldSync.available})\n` +
          `  cold semantic sync duration:     ${Math.round(coldSyncDurationMs)}ms\n` +
          `  unchanged sync duration:         ${Math.round(unchangedSyncDurationMs)}ms (embedded=${unchangedSync.chunksEmbedded}, unchanged=${unchangedSync.chunksUnchanged})\n` +
          `  lexical query latency:           ${Math.round(lexicalLatencyMs)}ms\n` +
          `  semantic query latency:          ${Math.round(semanticLatencyMs)}ms\n` +
          `  hybrid retrieval latency:        ${Math.round(hybridLatencyMs)}ms\n` +
          `  DB size before indexing:         ${sizeBeforeIndexing} bytes\n` +
          `  DB size after indexing+sync:     ${sizeAfter} bytes\n` +
          `  DB size increase:                ${sizeAfter - sizeBeforeIndexing} bytes`,
      );

      console.log("\n[Phase 3.2 self-repository queries] (human-inspect only -- not the formal metric dataset)");
      for (const text of PRACTICAL_QUERIES) {
        const results = await service.getCandidates({ text, scope: globalScope(), limit: 3 });
        console.log(`\nQ: ${text}`);
        if (results.length === 0) {
          console.log("  (no results)");
          continue;
        }
        for (const r of results) {
          const score = r.signals.lexicalScore ?? r.signals.semanticScore ?? 0;
          console.log(`  ${r.relativePath}:${r.startLine}-${r.endLine}  [${channelOf(r)}]  score=${score.toFixed(4)}`);
        }
      }

      // Performance-baseline machinery correctness, not a quality gate: real
      // numbers are reported above for human reading, not graded against a
      // threshold (PHASE_3_SPEC.md: "do not optimize unless measurements reveal an
      // actual problem").
      assert.ok(cold.filesDiscovered > 0, "expected at least one file in this repository");
      assert.equal(
        warm.filesUnchanged,
        cold.filesIndexed + cold.filesUpdated,
        "a re-index of an untouched repository must report every previously-indexed file as unchanged",
      );
      assert.equal(unchangedSync.chunksEmbedded, 0, "an unchanged sync must perform zero embedding calls");
      assert.ok(sizeAfter >= sizeBeforeIndexing, "DB size must not shrink after indexing and syncing");

      db.close();
    } finally {
      // Cleanup failure must never mask a real assertion/error from the body above
      // (a throw here would otherwise replace it, per JS try/finally semantics), and
      // must never fail the test on its own -- Windows can hold a brief file lock on
      // WAL/SHM files right after close(); maxRetries/retryDelay is Node's documented
      // mitigation, and a residual temp-dir leak is harmless (OS-reclaimed).
      try {
        rmSync(dbDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
      } catch (cleanupError) {
        console.warn(`temp dir cleanup failed (non-fatal, left at ${dbDir}):`, cleanupError);
      }
    }
  },
);
