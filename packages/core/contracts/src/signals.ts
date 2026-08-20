import { z } from "zod";

/**
 * Canonical per-query normalization for retrieval signals (P2-002 / decision E2).
 *
 * Every RetrievalStore implementation must produce signal scores that are
 * comparable to each other: bounded to [0,1], and increasing with match quality.
 * This is the single definition of that transform -- the in-memory fake store and
 * the real SQLite store must both agree with it, exactly as both must agree with
 * `scopeIncludes` for isolation. The shared conformance suite in
 * @brain/test-fixtures asserts that agreement.
 *
 * Why per-query rather than global constants: bm25 magnitudes depend on corpus
 * size and term rarity, and vector distances depend on the embedding model, so
 * any fixed constant goes stale on the next write. Normalizing over the candidate
 * set a query actually returned is bounded, deterministic, needs no stored state,
 * and stays correct as the corpus grows.
 *
 * The degenerate case (one candidate, or every candidate equally good) yields 1.0
 * for every member -- never 0, never NaN. A lone candidate is the best available
 * match for that query; scoring it 0 would be a claim about absolute relevance
 * that a relative measure cannot make.
 */
export function normalizeScores(raw: number[]): number[] {
  if (raw.length === 0) return [];

  let min = raw[0] as number;
  let max = raw[0] as number;
  for (const value of raw) {
    if (value < min) min = value;
    if (value > max) max = value;
  }

  if (max === min) return raw.map(() => 1);

  const span = max - min;
  return raw.map((value) => (value - min) / span);
}

export const SimilarityPairSchema = z
  .object({
    a: z.string().uuid(),
    b: z.string().uuid(),
    similarity: z.number().min(-1).max(1),
  })
  .strict();
export type SimilarityPair = z.infer<typeof SimilarityPairSchema>;

/**
 * Deterministic ordering for SimilarityPair[] (E25 requirement): similarity
 * descending, then `a` ascending, then `b` ascending. Both RetrievalStore
 * implementations must produce output in this order so a caller never has to
 * re-sort, and so tests can assert exact array equality.
 */
export function sortSimilarityPairs(pairs: SimilarityPair[]): SimilarityPair[] {
  return [...pairs].sort((x, y) => {
    if (y.similarity !== x.similarity) return y.similarity - x.similarity;
    if (x.a !== y.a) return x.a < y.a ? -1 : 1;
    if (x.b !== y.b) return x.b < y.b ? -1 : 1;
    return 0;
  });
}
