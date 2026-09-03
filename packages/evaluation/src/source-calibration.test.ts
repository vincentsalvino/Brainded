import { test } from "node:test";
import assert from "node:assert/strict";
import { globalScope } from "@brain/contracts";
import { FakeMemoryRepository, FakeRetrievalStore, FakeEventStore, FakeCodeSearchStore, FakeEmbeddingProvider } from "@brain/test-fixtures";
import { rank, computeScore, DEFAULT_RANKING_WEIGHTS } from "@brain/ranking";
import { RetrievalService, CodeRetrievalService } from "@brain/retrieval";
import { CODING_CONTEXT_MEMORIES, CODING_CONTEXT_FILES, CODING_CONTEXT_TASKS } from "./coding-context.data.js";

test("[evaluation] Phase 3.4 source score calibration: real memory vs. code score distributions on the same content pool", async () => {
  const eventStore = new FakeEventStore();
  const memoryRepo = new FakeMemoryRepository(eventStore);
  for (const m of CODING_CONTEXT_MEMORIES) await memoryRepo.create({ type: "constraint", content: m.content, scope: globalScope() });
  const retrievalStore = new FakeRetrievalStore(await memoryRepo.query({ scope: globalScope(), limit: 100 }).then((r) => r.items));

  const codeStore = new FakeCodeSearchStore(new FakeEmbeddingProvider());
  let i = 0;
  for (const [path, content] of Object.entries(CODING_CONTEXT_FILES)) {
    codeStore.index({ id: `chunk-${i}`, fileId: `file-${i}`, repositoryId: "repo-1", scope: globalScope(), relativePath: path, chunkIndex: 0, startLine: 1, endLine: content.split("\n").length, content, contentHash: `h${i}` });
    i++;
  }
  const codeRetrieval = new CodeRetrievalService(codeStore);
  const retrieval = new RetrievalService(retrievalStore);

  const memoryScores: number[] = [];
  const codeScores: number[] = [];

  for (const t of CODING_CONTEXT_TASKS) {
    const candidates = await retrieval.getCandidates({ text: t.task, scope: globalScope(), limit: 20 });
    for (const r of rank({ candidates, task: t.task })) memoryScores.push(r.score);

    const codeResults = await codeRetrieval.getCandidates({ text: t.task, scope: globalScope(), limit: 20 });
    for (const r of codeResults) codeScores.push(computeScore(r.signals, DEFAULT_RANKING_WEIGHTS));
  }

  const stats = (values: number[]): { min: number; max: number; mean: number; median: number } => {
    const sorted = [...values].sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);
    // Standard median: average the two middle elements for even-length input,
    // not just the upper one -- sorted.length % 2 === 0 skips the average and
    // silently returns the wrong element otherwise.
    const median = sorted.length === 0 ? 0 : sorted.length % 2 === 0 ? ((sorted[mid - 1] ?? 0) + (sorted[mid] ?? 0)) / 2 : (sorted[mid] ?? 0);
    return {
      min: sorted[0] ?? 0,
      max: sorted[sorted.length - 1] ?? 0,
      mean: values.reduce((a, b) => a + b, 0) / (values.length || 1),
      median,
    };
  };

  const memoryStats = stats(memoryScores);
  const codeStats = stats(codeScores);

  console.log("\n[Phase 3.4 source score calibration]");
  console.log(`  memory scores (n=${memoryScores.length}): ${JSON.stringify(memoryStats)}`);
  console.log(`  code scores   (n=${codeScores.length}): ${JSON.stringify(codeStats)}`);
  console.log(`  both bounded to computeScore's [0, weights-sum] range by construction: ${DEFAULT_RANKING_WEIGHTS.lexical + DEFAULT_RANKING_WEIGHTS.semantic + DEFAULT_RANKING_WEIGHTS.tag}`);

  // Machinery correctness, not a tuned threshold: both distributions must be
  // real (non-empty) and within the theoretically guaranteed bound -- the
  // actual overlap/skew is reported above for the implementation report to
  // characterize honestly, not gated here.
  assert.ok(memoryScores.length > 0 && codeScores.length > 0);
  const weightSum = DEFAULT_RANKING_WEIGHTS.lexical + DEFAULT_RANKING_WEIGHTS.semantic + DEFAULT_RANKING_WEIGHTS.tag;
  assert.ok(memoryStats.max <= weightSum + 1e-9 && codeStats.max <= weightSum + 1e-9, "both scores must stay within computeScore's guaranteed bound");
});
