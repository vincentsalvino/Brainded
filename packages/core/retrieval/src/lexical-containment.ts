/**
 * 2C.7. The Phase 2C.6 hybrid near-duplicate rule, promoted from an offline
 * evaluation script into production-shaped, unit-tested code. Decides ONLY
 * "are these two contents a near-duplicate" -- never which side anchors
 * (toRedundancyPairs, unchanged, still owns that) and never ranking or
 * token budgeting.
 *
 * Stopword list is fixed and NOT user-configurable (2C.7 instruction) --
 * copied verbatim from the exact list Phase 2C.6 evaluated against 99 real
 * pairs with zero false positives. Changing it would silently invalidate
 * that evidence.
 */
const STOPWORDS: ReadonlySet<string> = new Set([
  "a", "an", "the", "and", "or", "but", "must", "should", "never", "always", "not", "no", "nor",
  "is", "are", "be", "being", "been", "to", "of", "in", "on", "for", "with", "before", "after",
  "this", "that", "these", "those", "its", "it", "as", "at", "by", "from", "into", "when",
  "where", "which", "who", "whom", "also", "than", "then", "so", "such", "via", "per", "each",
  "any", "all", "only", "every", "e", "g",
]);

/**
 * lowercase -> every non-alphanumeric character becomes a space (so
 * "notes-api" splits into "notes"/"api") -> whitespace split -> unique set,
 * stopwords removed. No stemming, no dependency -- matches the Phase 2C.6
 * evaluation exactly, not merely resembles it.
 */
export function tokenizeForContainment(content: string): Set<string> {
  const raw = content
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .split(" ")
    .filter((token) => token.length > 0);
  return new Set(raw.filter((token) => !STOPWORDS.has(token)));
}

/**
 * |intersection| / min(|A|, |B|) -- normalizes by the smaller side, the
 * right shape for "is this short rule wholly subsumed by that longer,
 * more-elaborated one" (Phase 2C.6's finding: Jaccard, normalized by the
 * union, systematically under-scores exactly this pattern).
 *
 * 0 when either token set is empty -- a real, defined answer ("no evidence
 * of overlap"), never NaN from a 0/0 division.
 */
export function containmentCoefficient(contentA: string, contentB: string): number {
  const setA = tokenizeForContainment(contentA);
  const setB = tokenizeForContainment(contentB);
  const denominator = Math.min(setA.size, setB.size);
  if (denominator === 0) return 0;

  let intersectionSize = 0;
  for (const token of setA) {
    if (setB.has(token)) intersectionSize++;
  }
  return intersectionSize / denominator;
}

export interface NearDuplicatePolicy {
  /** Minimum cosine similarity for a pair to reach classification at all. Passed to storage's findSimilarPairs -- NOT highConfidenceThreshold (2C.7's critical integration invariant). */
  candidateFloor: number;
  /** Cosine at or above this is a duplicate on semantic evidence alone, no lexical check needed. */
  highConfidenceThreshold: number;
  /** In [candidateFloor, highConfidenceThreshold), containment at or above this corroborates the duplicate call. */
  containmentThreshold: number;
}

export const DEFAULT_CANDIDATE_FLOOR = 0.75;
export const DEFAULT_HIGH_CONFIDENCE_THRESHOLD = 0.8;
export const DEFAULT_CONTAINMENT_THRESHOLD = 0.4;

export const DEFAULT_NEAR_DUPLICATE_POLICY: NearDuplicatePolicy = {
  candidateFloor: DEFAULT_CANDIDATE_FLOOR,
  highConfidenceThreshold: DEFAULT_HIGH_CONFIDENCE_THRESHOLD,
  containmentThreshold: DEFAULT_CONTAINMENT_THRESHOLD,
};

/** Phase 2C.6 Rule H, exactly: cosine >= high-confidence, OR (cosine >= floor AND containment >= containment threshold). */
export function isNearDuplicate(
  input: { cosineSimilarity: number; contentA: string; contentB: string },
  policy: NearDuplicatePolicy = DEFAULT_NEAR_DUPLICATE_POLICY,
): boolean {
  if (input.cosineSimilarity >= policy.highConfidenceThreshold) return true;
  if (input.cosineSimilarity >= policy.candidateFloor) {
    return containmentCoefficient(input.contentA, input.contentB) >= policy.containmentThreshold;
  }
  return false;
}
