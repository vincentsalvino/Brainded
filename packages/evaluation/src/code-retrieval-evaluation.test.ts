import { test } from "node:test";
import assert from "node:assert/strict";
import type { CodeChunkRecord, CodeSearchResult } from "@brain/contracts";
import { FakeCodeSearchStore, FakeEmbeddingProvider } from "@brain/test-fixtures";
import { CodeRetrievalService } from "@brain/retrieval";
import { computeScore, DEFAULT_RANKING_WEIGHTS } from "@brain/ranking";
import { precisionAtK, recallAtK, ndcgAtK, reciprocalRank, relevantCount, mean, type Labels } from "./metrics.js";
import { CODE_EVAL_CHUNKS, CODE_EVAL_QUERIES, CODE_EVAL_REPOSITORY_ID, CODE_EVAL_SCOPE } from "./code-retrieval.data.js";

/**
 * Phase 3.2 fixture evaluation (PHASE_3_SPEC.md EVALUATION DATASET/METRICS).
 * Reuses @brain/evaluation's metric math unmodified (precisionAtK/recallAtK/
 * ndcgAtK/reciprocalRank/mean take only (ranked: string[], labels) -- no
 * MemoryRecord coupling, see PHASE_3_SPEC.md Part B) rather than forcing chunk data
 * through EvalExample. Network-free: FakeCodeSearchStore + FakeEmbeddingProvider.
 *
 * This is characterization, not a quality gate: no pass/fail threshold is asserted
 * on the metric VALUES themselves (PHASE_3_SPEC.md explicitly warns against tuning
 * to make a 10-query fixture's numbers look better). Assertions here check that the
 * evaluation machinery itself is correct (well-formed reports, valid ranges,
 * reused-metric consistency) -- the actual numbers are reported, not graded.
 */

const K_VALUES = [1, 3];

function toChunk(key: string, i: number): CodeChunkRecord {
  const fixture = CODE_EVAL_CHUNKS.find((c) => c.key === key);
  if (!fixture) throw new Error(`fixture setup: unknown chunk key ${key}`);
  return {
    id: key,
    fileId: `file-${key}`,
    repositoryId: CODE_EVAL_REPOSITORY_ID,
    scope: CODE_EVAL_SCOPE,
    relativePath: fixture.relativePath,
    chunkIndex: 0,
    startLine: 1,
    endLine: fixture.content.split("\n").length,
    content: fixture.content,
    contentHash: `hash-${i}`,
  };
}

async function buildFixtureStore(): Promise<{ store: FakeCodeSearchStore; service: CodeRetrievalService }> {
  const store = new FakeCodeSearchStore(new FakeEmbeddingProvider());
  CODE_EVAL_CHUNKS.forEach((fixture, i) => store.index(toChunk(fixture.key, i), fixture.language));
  await store.syncEmbeddings(CODE_EVAL_REPOSITORY_ID);
  return { store, service: new CodeRetrievalService(store) };
}

interface StrategyReport {
  name: string;
  mrr: number;
  atK: { k: number; precision: number; recall: number; ndcg: number }[];
}

function evaluateStrategy(name: string, perQueryRanked: Map<string, string[]>): StrategyReport {
  const scorable = CODE_EVAL_QUERIES.filter((q) => relevantCount(q.labels as Labels) > 0);
  const atK = K_VALUES.map((k) => ({
    k,
    precision: mean(scorable.map((q) => precisionAtK(perQueryRanked.get(q.id) ?? [], q.labels as Labels, k))),
    recall: mean(scorable.map((q) => recallAtK(perQueryRanked.get(q.id) ?? [], q.labels as Labels, k))),
    ndcg: mean(scorable.map((q) => ndcgAtK(perQueryRanked.get(q.id) ?? [], q.labels as Labels, k))),
  }));
  const mrr = mean(scorable.map((q) => reciprocalRank(perQueryRanked.get(q.id) ?? [], q.labels as Labels)));
  return { name, mrr, atK };
}

function formatReport(reports: StrategyReport[]): string {
  const lines: string[] = [];
  lines.push(["strategy".padEnd(12), "MRR".padStart(7), ...K_VALUES.flatMap((k) => [`P@${k}`.padStart(7), `R@${k}`.padStart(7), `NDCG@${k}`.padStart(9)])].join(""));
  for (const report of reports) {
    lines.push(
      [
        report.name.padEnd(12),
        report.mrr.toFixed(3).padStart(7),
        ...report.atK.flatMap((m) => [m.precision.toFixed(3).padStart(7), m.recall.toFixed(3).padStart(7), m.ndcg.toFixed(3).padStart(9)]),
      ].join(""),
    );
  }
  return lines.join("\n");
}

test("[evaluation] Phase 3.2 code retrieval: lexical vs semantic vs hybrid on the frozen fixture", async () => {
  const { store, service } = await buildFixtureStore();

  const lexicalRanked = new Map<string, string[]>();
  const semanticRanked = new Map<string, string[]>();
  const hybridRanked = new Map<string, string[]>();

  for (const query of CODE_EVAL_QUERIES) {
    const q = { text: query.text, scope: CODE_EVAL_SCOPE, limit: 10 };

    const lexical = await store.lexicalSearch(q);
    lexicalRanked.set(query.id, lexical.map((r) => r.chunkId));

    const semantic = await store.semanticSearch(q);
    semanticRanked.set(query.id, semantic.map((r) => r.chunkId));

    const hybrid = await service.getCandidates(q);
    const orderedHybrid = [...hybrid].sort(
      (a: CodeSearchResult, b: CodeSearchResult) => computeScore(b.signals, DEFAULT_RANKING_WEIGHTS) - computeScore(a.signals, DEFAULT_RANKING_WEIGHTS),
    );
    hybridRanked.set(query.id, orderedHybrid.map((r) => r.chunkId));
  }

  const reports = [
    evaluateStrategy("lexical", lexicalRanked),
    evaluateStrategy("semantic", semanticRanked),
    evaluateStrategy("hybrid", hybridRanked),
  ];

  console.log("\n[Phase 3.2 fixture evaluation] " + CODE_EVAL_QUERIES.length + " queries, " + CODE_EVAL_CHUNKS.length + " chunks\n" + formatReport(reports));

  // Machinery correctness, not a quality gate (see file doc comment): every metric
  // is a well-formed number in its documented range.
  for (const report of reports) {
    assert.ok(Number.isFinite(report.mrr) && report.mrr >= 0 && report.mrr <= 1, `${report.name} MRR out of range: ${report.mrr}`);
    for (const m of report.atK) {
      for (const [metricName, value] of Object.entries(m)) {
        if (metricName === "k") continue;
        assert.ok(Number.isFinite(value as number) && (value as number) >= 0 && (value as number) <= 1, `${report.name} ${metricName}@${m.k} out of range: ${value}`);
      }
    }
  }

  // Every query's ranked list only ever names a real chunk key -- catches a broken
  // id mapping between the fixture and the store, which a range check alone would not.
  const validKeys = new Set(CODE_EVAL_CHUNKS.map((c) => c.key));
  for (const ranked of [...lexicalRanked.values(), ...semanticRanked.values(), ...hybridRanked.values()]) {
    for (const key of ranked) assert.ok(validKeys.has(key), `unexpected chunk key in ranked results: ${key}`);
  }
});
