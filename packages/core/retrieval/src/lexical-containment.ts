/**
 * 2C.7 shipped the Phase 2C.6 hybrid near-duplicate rule (Rule H: an
 * unconditional cosine>=0.80 bypass, OR cosine>=0.75 with containment
 * corroboration) as production-shaped, unit-tested code. 2C.8's organic
 * pilot then found that bypass gives real false positives (two distinct,
 * context-impacting facts misclassified as duplicates -- both at cosine
 * >=0.80, neither ever reaching the containment check). 2C.9 showed
 * removing the bypass entirely (Strategy H2: cosine>=candidateFloor AND
 * containment>=containmentThreshold, no exception) rejects both false
 * positives at zero cost to any previously-validated detection. This file
 * now implements H2, decided in docs/PHASE_2C9_REPORT.md and shipped in
 * 2C.10. It decides ONLY "are these two contents a near-duplicate" -- never
 * which side anchors (toRedundancyPairs, unchanged, still owns that) and
 * never ranking or token budgeting.
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
  /** Minimum cosine similarity for a pair to reach classification at all. Passed to storage's findSimilarPairs. */
  candidateFloor: number;
  /** Containment at or above this, together with cosine >= candidateFloor, is required for a duplicate call. */
  containmentThreshold: number;
}

export const DEFAULT_CANDIDATE_FLOOR = 0.75;
export const DEFAULT_CONTAINMENT_THRESHOLD = 0.4;

export const DEFAULT_NEAR_DUPLICATE_POLICY: NearDuplicatePolicy = {
  candidateFloor: DEFAULT_CANDIDATE_FLOOR,
  containmentThreshold: DEFAULT_CONTAINMENT_THRESHOLD,
};

/** Phase 2C.10 Strategy H2, exactly: cosine >= candidateFloor AND containment >= containmentThreshold. No unconditional cosine-only bypass at any cosine value (docs/PHASE_2C9_REPORT.md). */
export function isNearDuplicate(
  input: { cosineSimilarity: number; contentA: string; contentB: string },
  policy: NearDuplicatePolicy = DEFAULT_NEAR_DUPLICATE_POLICY,
): boolean {
  if (input.cosineSimilarity < policy.candidateFloor) return false;
  return containmentCoefficient(input.contentA, input.contentB) >= policy.containmentThreshold;
}
