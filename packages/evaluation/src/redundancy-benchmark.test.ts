import { test } from "node:test";
import assert from "node:assert/strict";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { LocalEmbeddingProvider } from "@brain/storage";
import { loadRedundancyPairs, expectedLabelForCategory, type RedundancyPairCategory } from "./redundancy-pairs-dataset.js";
import { cosineSimilarity, distributionStats, classificationMetrics, sweepThresholds, type LabeledSimilarity } from "./classification-metrics.js";

/**
 * Phase 2C.2. Real-model characterization only -- no production code is
 * exercised (no Gateway, no compileContext, no DEFAULT_REDUNDANCY_THRESHOLD
 * read from @brain/gateway; the sweep thresholds below are this test's own
 * local constants). Real network/model download on first run -- integration-
 * only by design, excluded from the default `test` script (see package.json).
 */

const DATASET = join(dirname(fileURLToPath(import.meta.url)), "..", "datasets", "redundancy-pairs.jsonl");
const THRESHOLDS = [0.5, 0.55, 0.6, 0.65, 0.7, 0.75, 0.8, 0.85, 0.9];

test("Phase 2C.2: real-model redundancy threshold characterization benchmark", { timeout: 300_000 }, async () => {
  const pairs = loadRedundancyPairs(DATASET);
  assert.ok(pairs.length >= 30, `expected at least 30 labeled pairs, got ${pairs.length}`);

  const provider = new LocalEmbeddingProvider();
  const embeddingCache = new Map<string, number[]>();
  async function embedCached(text: string): Promise<number[]> {
    const cached = embeddingCache.get(text);
    if (cached) return cached;
    const vector = await provider.embed(text);
    embeddingCache.set(text, vector);
    return vector;
  }

  const results: {
    id: string;
    domain: string;
    category: RedundancyPairCategory;
    expectedLabel: "redundant" | "distinct";
    similarity: number;
  }[] = [];

  for (const pair of pairs) {
    const [vecA, vecB] = await Promise.all([embedCached(pair.contentA), embedCached(pair.contentB)]);
    results.push({
      id: pair.id,
      domain: pair.domain,
      category: pair.category,
      expectedLabel: expectedLabelForCategory(pair.category),
      similarity: cosineSimilarity(vecA, vecB),
    });
  }

  console.log("\n=== PHASE 2C.2 REAL-MODEL PAIR SIMILARITIES ===");
  for (const r of results) {
    console.log(`  [${r.category}] ${r.id.padEnd(28)} ${r.expectedLabel.padEnd(9)} sim=${r.similarity.toFixed(6)}  (${r.domain})`);
  }

  const byCategory: Record<RedundancyPairCategory, number[]> = { A: [], B: [], C: [], D: [] };
  for (const r of results) byCategory[r.category].push(r.similarity);

  console.log("\n=== DISTRIBUTIONS BY CATEGORY ===");
  for (const category of ["A", "B", "C", "D"] as const) {
    console.log(`  ${category}:`, JSON.stringify(distributionStats(byCategory[category])));
  }

  const samples: LabeledSimilarity[] = results.map((r) => ({ similarity: r.similarity, expectedLabel: r.expectedLabel }));

  console.log("\n=== THRESHOLD SWEEP ===");
  for (const row of sweepThresholds(samples, THRESHOLDS)) console.log(" ", JSON.stringify(row));

  console.log("\n=== 0.75 (CURRENT PRODUCTION DEFAULT) ===");
  console.log(" ", JSON.stringify(classificationMetrics(samples, 0.75)));

  const paraphrase = results.find((r) => r.id === "validation-b");
  const distinctNearMiss = results.find((r) => r.id === "validation-c");
  console.log("\n=== SPECIAL ANALYSIS: validation paraphrase (A/C) vs intentionally distinct (A/B) ===");
  console.log("  paraphrase (expected redundant):", paraphrase?.similarity);
  console.log("  distinct (expected distinct):   ", distinctNearMiss?.similarity);
  if (paraphrase && distinctNearMiss) {
    // A single threshold can only classify both correctly if the redundant
    // pair's similarity is STRICTLY HIGHER than the distinct pair's -- a
    // threshold between the two would then predict "redundant" for the first
    // and "distinct" for the second. If the redundant pair scores lower (as
    // measured), no threshold can separate them correctly.
    const singleThresholdPossible = paraphrase.similarity > distinctNearMiss.similarity;
    console.log("  a single threshold can classify both correctly:", singleThresholdPossible);
  }

  // Structural regression guards only -- NOT a verdict on threshold sufficiency.
  // Whether 0.75 (or any single threshold) is adequate is this phase's open
  // research question, answered in the report from the data above, not baked
  // in here as a pass/fail assertion.
  assert.ok(new Set(results.map((r) => r.domain)).size >= 10, "expected at least 10 distinct domains");
  assert.equal(new Set(results.map((r) => r.category)).size, 4, "expected all 4 categories represented");
  for (const r of results) {
    assert.ok(r.similarity >= -1 && r.similarity <= 1, `${r.id}: cosine similarity out of [-1,1] range`);
  }

  // Known real-model measurements from Phase 2C.1 Pilots #1/#2 must reproduce
  // within a small tolerance. LocalEmbeddingProvider is deterministic inference
  // over fixed weights, so a drift here means the model/environment changed --
  // itself worth knowing, not something to silently tolerate.
  const knownExpectations: Record<string, number> = {
    "rest-api-a1": 0.805,
    "rest-api-a2": 0.9996,
    "validation-b": 0.634876,
    "validation-c": 0.749969,
  };
  for (const [id, expected] of Object.entries(knownExpectations)) {
    const actual = results.find((r) => r.id === id)?.similarity;
    assert.ok(actual !== undefined, `missing known pair ${id}`);
    assert.ok(
      Math.abs((actual as number) - expected) < 0.02,
      `${id}: expected similarity near ${expected}, got ${actual} -- real-model/environment may have changed`,
    );
  }
});
