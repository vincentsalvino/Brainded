/**
 * Ranking metrics. Pure arithmetic over (ordering, graded labels) -- no storage,
 * no network, no clock, no randomness. Every function here is hand-verified
 * against a fixture in metrics.test.ts, because a silently-wrong metric is worse
 * than no metric: it produces confident numbers that justify shipping the wrong
 * thing.
 */

export type Grade = 0 | 1 | 2;
export type Labels = Record<string, Grade | undefined>;

/** A key counts as relevant when its grade is 1 or 2. Unlabeled means grade 0. */
export function gradeOf(labels: Labels, key: string): number {
  return labels[key] ?? 0;
}

export function isRelevant(labels: Labels, key: string): boolean {
  return gradeOf(labels, key) > 0;
}

export function relevantCount(labels: Labels): number {
  return Object.values(labels).filter((g): g is Grade => g !== undefined && g > 0).length;
}

/** Precision@K = (relevant items in the top K) / K. */
export function precisionAtK(ranked: string[], labels: Labels, k: number): number {
  if (k <= 0) return 0;
  const topK = ranked.slice(0, k);
  const hits = topK.filter((key) => isRelevant(labels, key)).length;
  return hits / k;
}

/**
 * Recall@K = (relevant items in the top K) / (all relevant items).
 * An example with no relevant items has undefined recall; 0 is returned and such
 * examples are excluded from the aggregate by `evaluate()`.
 */
export function recallAtK(ranked: string[], labels: Labels, k: number): number {
  const total = relevantCount(labels);
  if (total === 0) return 0;
  const hits = ranked.slice(0, k).filter((key) => isRelevant(labels, key)).length;
  return hits / total;
}

/** Reciprocal rank of the first relevant item; 0 when none is ranked. */
export function reciprocalRank(ranked: string[], labels: Labels): number {
  const index = ranked.findIndex((key) => isRelevant(labels, key));
  return index === -1 ? 0 : 1 / (index + 1);
}

/**
 * DCG@K with the standard gain `2^grade - 1` and discount `log2(i + 2)` for
 * zero-based position i, i.e. position 1 has discount log2(2) = 1.
 *
 * The graded gain is the reason `EvalExample.labels` is 0/1/2 rather than
 * boolean: it is what lets a grade-2 memory at rank 1 score strictly better than
 * a grade-1 memory at rank 1, which is the whole Finding B question.
 */
export function dcgAtK(ranked: string[], labels: Labels, k: number): number {
  return ranked.slice(0, k).reduce((sum, key, i) => {
    const gain = Math.pow(2, gradeOf(labels, key)) - 1;
    return sum + gain / Math.log2(i + 2);
  }, 0);
}

/** Ideal DCG@K: the same labels, perfectly ordered. */
export function idealDcgAtK(labels: Labels, k: number): number {
  const grades = Object.values(labels)
    .filter((g): g is Grade => g !== undefined)
    .sort((a, b) => b - a);
  return grades
    .slice(0, k)
    .reduce<number>((sum, grade, i) => sum + (Math.pow(2, grade) - 1) / Math.log2(i + 2), 0);
}

/** NDCG@K in [0,1]. Returns 0 when the ideal is 0 (nothing relevant to find). */
export function ndcgAtK(ranked: string[], labels: Labels, k: number): number {
  const ideal = idealDcgAtK(labels, k);
  if (ideal === 0) return 0;
  return dcgAtK(ranked, labels, k) / ideal;
}

export function mean(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((sum, v) => sum + v, 0) / values.length;
}
