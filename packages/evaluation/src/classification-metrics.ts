/**
 * Phase 2C.2. Pure binary-classification metrics for the redundancy-threshold
 * benchmark: given a real cosine similarity and a human-declared expected
 * label, does thresholding the similarity predict the label correctly?
 * Positive class is "redundant" throughout -- a false positive here means a
 * DISTINCT pair got flagged redundant (risks demoting real, useful knowledge);
 * a false negative means a genuinely redundant pair was missed (only wastes
 * context tokens). No storage, no network, no randomness -- same discipline as
 * metrics.ts's ranking metrics.
 */

export function cosineSimilarity(a: number[], b: number[]): number {
  let dot = 0;
  let magA = 0;
  let magB = 0;
  for (let i = 0; i < a.length; i++) {
    const ai = a[i] as number;
    const bi = b[i] as number;
    dot += ai * bi;
    magA += ai * ai;
    magB += bi * bi;
  }
  return dot / (Math.sqrt(magA) * Math.sqrt(magB));
}

export interface DistributionStats {
  count: number;
  min: number | null;
  max: number | null;
  mean: number | null;
  median: number | null;
}

/** count/min/max/mean/median over a similarity distribution. Empty input -> nulls, never a fabricated 0. */
export function distributionStats(values: number[]): DistributionStats {
  if (values.length === 0) return { count: 0, min: null, max: null, mean: null, median: null };
  const sorted = [...values].sort((a, b) => a - b);
  const count = sorted.length;
  const mean = sorted.reduce((sum, v) => sum + v, 0) / count;
  const mid = Math.floor(count / 2);
  const median = count % 2 === 0 ? ((sorted[mid - 1] as number) + (sorted[mid] as number)) / 2 : (sorted[mid] as number);
  return { count, min: sorted[0] as number, max: sorted[count - 1] as number, mean, median };
}

export type ExpectedLabel = "redundant" | "distinct";

export interface LabeledSimilarity {
  similarity: number;
  expectedLabel: ExpectedLabel;
}

export interface ConfusionMetrics {
  threshold: number;
  tp: number;
  fp: number;
  tn: number;
  fn: number;
  /** null when nothing was predicted redundant -- a fabricated 0 or 1 would misrepresent "no prediction made." */
  precision: number | null;
  recall: number | null;
  f1: number | null;
  falsePositiveRate: number | null;
  falseNegativeRate: number | null;
}

/** Predicted redundant iff similarity >= threshold (inclusive). */
export function classificationMetrics(samples: LabeledSimilarity[], threshold: number): ConfusionMetrics {
  let tp = 0;
  let fp = 0;
  let tn = 0;
  let fn = 0;
  for (const sample of samples) {
    const predictedRedundant = sample.similarity >= threshold;
    const actualRedundant = sample.expectedLabel === "redundant";
    if (predictedRedundant && actualRedundant) tp++;
    else if (predictedRedundant && !actualRedundant) fp++;
    else if (!predictedRedundant && !actualRedundant) tn++;
    else fn++;
  }

  const precision = tp + fp === 0 ? null : tp / (tp + fp);
  const recall = tp + fn === 0 ? null : tp / (tp + fn);
  const f1 = precision === null || recall === null || precision + recall === 0 ? null : (2 * precision * recall) / (precision + recall);
  const falsePositiveRate = fp + tn === 0 ? null : fp / (fp + tn);
  const falseNegativeRate = fn + tp === 0 ? null : fn / (fn + tp);

  return { threshold, tp, fp, tn, fn, precision, recall, f1, falsePositiveRate, falseNegativeRate };
}

export function sweepThresholds(samples: LabeledSimilarity[], thresholds: number[]): ConfusionMetrics[] {
  return thresholds.map((threshold) => classificationMetrics(samples, threshold));
}
