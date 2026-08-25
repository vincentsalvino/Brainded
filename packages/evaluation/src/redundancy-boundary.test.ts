import { test } from "node:test";
import assert from "node:assert/strict";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { LocalEmbeddingProvider } from "@brain/storage";
import { loadRedundancyPairs, expectedLabelForCategory, type RedundancyPair } from "./redundancy-pairs-dataset.js";
import { cosineSimilarity, distributionStats, classificationMetrics, sweepThresholds, type LabeledSimilarity } from "./classification-metrics.js";

/**
 * Phase 2C.3. High-similarity boundary characterization: near-duplicate (A)
 * vs. same-domain-distinct (C) only. Paraphrase (B) and unrelated (D) from
 * Phase 2C.2 are deliberately excluded from this phase's analysis -- that
 * question was already answered (structural overlap, see
 * docs/PHASE_2C2_REPORT.md) and is out of scope here. Real network/model
 * download on first run -- integration-only, excluded from the default `test`
 * script (see package.json).
 */

const DATASET_2C2 = join(dirname(fileURLToPath(import.meta.url)), "..", "datasets", "redundancy-pairs.jsonl");
const DATASET_2C3 = join(dirname(fileURLToPath(import.meta.url)), "..", "datasets", "redundancy-pairs-boundary.jsonl");
const THRESHOLDS = [0.7, 0.725, 0.75, 0.775, 0.8, 0.825, 0.85, 0.875, 0.9];
const FOCUS_WINDOW: [number, number] = [0.7, 0.9];

interface MeasuredPair {
  id: string;
  source: "2C.2" | "2C.3";
  batch: string | null;
  domain: string;
  category: "A" | "C";
  expectedLabel: "redundant" | "distinct";
  similarity: number;
}

test("Phase 2C.3: high-similarity boundary between near-duplicate and same-domain-distinct pairs", { timeout: 300_000 }, async () => {
  const pairs2C2: RedundancyPair[] = loadRedundancyPairs(DATASET_2C2).filter((p) => p.category === "A" || p.category === "C");
  const pairs2C3: RedundancyPair[] = loadRedundancyPairs(DATASET_2C3);

  assert.ok(pairs2C3.length >= 40, `expected at least 40 new boundary pairs, got ${pairs2C3.length}`);
  const newNearDup = pairs2C3.filter((p) => p.category === "A");
  const newDistinct = pairs2C3.filter((p) => p.category === "C");
  assert.ok(newNearDup.length >= 20, `expected at least 20 new near-duplicate pairs, got ${newNearDup.length}`);
  assert.ok(newDistinct.length >= 20, `expected at least 20 new same-domain-distinct pairs, got ${newDistinct.length}`);

  const batches = new Set(pairs2C3.map((p) => p.batch));
  assert.ok(batches.has("batch-1") && batches.has("batch-2"), "expected both batch-1 and batch-2 represented");

  const provider = new LocalEmbeddingProvider();
  const embeddingCache = new Map<string, number[]>();
  async function embedCached(text: string): Promise<number[]> {
    const cached = embeddingCache.get(text);
    if (cached) return cached;
    const vector = await provider.embed(text);
    embeddingCache.set(text, vector);
    return vector;
  }

  const all: MeasuredPair[] = [];
  for (const p of [...pairs2C2, ...pairs2C3]) {
    const [vecA, vecB] = await Promise.all([embedCached(p.contentA), embedCached(p.contentB)]);
    all.push({
      id: p.id,
      source: pairs2C2.includes(p) ? "2C.2" : "2C.3",
      batch: p.batch,
      domain: p.domain,
      category: p.category as "A" | "C",
      expectedLabel: expectedLabelForCategory(p.category),
      similarity: cosineSimilarity(vecA, vecB),
    });
  }

  console.log(`\n=== PHASE 2C.3 COMBINED A/C POOL (${all.length} pairs: ${pairs2C2.length} from 2C.2 + ${pairs2C3.length} new) ===`);
  for (const r of all) {
    console.log(
      `  [${r.category}] ${r.id.padEnd(30)} ${r.source} ${(r.batch ?? "-").padEnd(9)} sim=${r.similarity.toFixed(6)}  (${r.domain})`,
    );
  }

  const nearDup = all.filter((r) => r.category === "A").map((r) => r.similarity);
  const distinct = all.filter((r) => r.category === "C").map((r) => r.similarity);

  console.log("\n=== HIGH-SIMILARITY DISTRIBUTION (combined 2C.2 + 2C.3) ===");
  console.log("  near-duplicate (A):", JSON.stringify(distributionStats(nearDup)));
  console.log("  same-domain distinct (C):", JSON.stringify(distributionStats(distinct)));

  const inWindow = (v: number) => v >= FOCUS_WINDOW[0] && v <= FOCUS_WINDOW[1];
  const nearDupInWindow = nearDup.filter(inWindow);
  const distinctInWindow = distinct.filter(inWindow);
  console.log(`\n=== FOCUS WINDOW [${FOCUS_WINDOW[0]}, ${FOCUS_WINDOW[1]}] ===`);
  console.log(`  near-duplicate pairs in window: ${nearDupInWindow.length}/${nearDup.length}`);
  console.log(`  distinct pairs in window:       ${distinctInWindow.length}/${distinct.length}`);

  const minNearDup = Math.min(...nearDup);
  const maxDistinct = Math.max(...distinct);
  const margin = minNearDup - maxDistinct;
  console.log("\n=== BOUNDARY MARGIN ===");
  console.log(`  min(near-duplicate) = ${minNearDup.toFixed(6)}`);
  console.log(`  max(distinct)       = ${maxDistinct.toFixed(6)}`);
  console.log(`  margin              = ${margin.toFixed(6)}`);
  if (margin <= 0) {
    console.log("  CLASSES OVERLAP: at least one distinct pair scores >= the weakest near-duplicate.");
  } else {
    console.log("  Classes are cleanly separated in this sample: no distinct pair reaches the weakest near-duplicate.");
  }
  const worstNearDup = all.find((r) => r.category === "A" && r.similarity === minNearDup);
  const worstDistinct = all.find((r) => r.category === "C" && r.similarity === maxDistinct);
  console.log(`  weakest near-duplicate: ${worstNearDup?.id}`);
  console.log(`  strongest distinct:     ${worstDistinct?.id}`);

  const samples: LabeledSimilarity[] = all.map((r) => ({ similarity: r.similarity, expectedLabel: r.expectedLabel }));
  console.log("\n=== THRESHOLD SWEEP (near-duplicate vs same-domain-distinct only) ===");
  for (const row of sweepThresholds(samples, THRESHOLDS)) console.log(" ", JSON.stringify(row));

  console.log("\n=== 0.75 RESULT ===", JSON.stringify(classificationMetrics(samples, 0.75)));
  console.log("=== 0.80 RESULT ===", JSON.stringify(classificationMetrics(samples, 0.8)));

  // Structural guards only -- NOT a verdict on which threshold to recommend.
  // That decision is this phase's report, made from the numbers above.
  for (const r of all) assert.ok(r.similarity >= -1 && r.similarity <= 1, `${r.id}: cosine similarity out of [-1,1] range`);
  assert.equal(new Set(all.map((r) => r.category)).size, 2, "expected exactly categories A and C in this phase's pool");
});
