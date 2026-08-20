// Deliberately depends on nothing -- not even @brain/contracts. The estimator is
// a plain function parameter, not a package import from @brain/token, which
// avoids what would otherwise be a circular dependency (core/token calls
// core/compression, which would need core/token's estimator back). See
// PHASE_1_SPEC.md's corrected packages/core/compression entry.

const TRUNCATION_MARKER = "\n[...truncated]";

// Below this many tokens, a truncated fragment is more likely to confuse an
// agent than help it -- not worth producing. Non-blocking implementation detail
// (same category as the default ranking weights / estimator ratio),
// documented and adjustable, not architecture.
export const MIN_COMPRESSION_FLOOR_TOKENS = 20;

/**
 * Truncation-only, non-LLM (ARCHITECTURE.md invariant 19 -- no required network
 * call). Best-effort: if it cannot bring `content` under `targetTokens` (below
 * the minimum floor, or the marker itself doesn't leave room for any body text),
 * it returns the ORIGINAL, UNMODIFIED content with wasCompressed:false. This is
 * deliberately the same signal as "compression wasn't needed" -- the caller
 * (core/token's optimizeContext) always re-checks
 * `estimate(result.content) <= targetTokens` itself before trusting the result,
 * so a single uniform check handles both "didn't need to shrink" and "couldn't
 * shrink enough," without a separate error path.
 *
 * Uses binary search against the passed-in `estimate` function to find the
 * longest prefix that fits, rather than assuming any fixed chars-per-token
 * ratio -- correct for whatever estimator is actually injected, including a
 * real tokenizer later.
 */
export function compress(
  content: string,
  targetTokens: number,
  estimate: (text: string) => number,
): { content: string; wasCompressed: boolean } {
  if (estimate(content) <= targetTokens) {
    return { content, wasCompressed: false };
  }
  if (targetTokens < MIN_COMPRESSION_FLOOR_TOKENS) {
    return { content, wasCompressed: false };
  }

  const markerTokens = estimate(TRUNCATION_MARKER);
  const budgetForBody = targetTokens - markerTokens;
  if (budgetForBody <= 0) {
    return { content, wasCompressed: false };
  }

  let lo = 0;
  let hi = content.length;
  while (lo < hi) {
    const mid = Math.floor((lo + hi + 1) / 2);
    if (estimate(content.slice(0, mid)) <= budgetForBody) {
      lo = mid;
    } else {
      hi = mid - 1;
    }
  }

  if (lo === 0) {
    return { content, wasCompressed: false };
  }

  return { content: content.slice(0, lo) + TRUNCATION_MARKER, wasCompressed: true };
}
