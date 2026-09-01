import type { TokenBudget } from "@brain/contracts";

export interface FillableItem {
  content: string;
  rank: number;
  wasCompressed: boolean;
}

export interface FillResult<T extends FillableItem> {
  included: T[];
  tokenCount: number;
  truncated: boolean;
  omittedCount: number;
}

/**
 * The one and only token-budget enforcement algorithm in the Brain. Extracted
 * from what was optimizeContext's body verbatim (Phase 1) so that Phase 3.4's
 * heterogeneous optimizeSources can share it exactly rather than reimplementing
 * budget arithmetic a second time -- see PHASE_3_SPEC.md Phase 3.4,
 * Token-Budget Integration. Two-pass greedy fill, in `items`' given array
 * order (never re-sorted by this function except the final rank-order pass):
 * pass 1 includes everything that fits as-is; pass 2 tries compressing
 * whatever didn't fit, into whatever budget pass 1 left over. See
 * optimize.ts's original doc comment (still present on optimizeContext) for
 * why the two passes are split rather than combined.
 */
export function fillBudget<T extends FillableItem>(
  items: T[],
  budget: TokenBudget,
  estimate: (text: string) => number,
  compressFn: (content: string, targetTokens: number, estimate: (text: string) => number) => { content: string; wasCompressed: boolean },
  identify: (item: T) => string,
): FillResult<T> {
  const included: T[] = [];
  const unfitted: { item: T; cost: number | null }[] = [];
  let tokenCount = 0;

  for (const item of items) {
    const remaining = budget.maxTokens - tokenCount;
    if (remaining <= 0) {
      unfitted.push({ item, cost: null });
      continue;
    }
    let cost: number;
    try {
      cost = estimate(item.content);
    } catch (error) {
      console.warn(`token estimation failed for ${identify(item)}, omitting it:`, error);
      unfitted.push({ item, cost: null });
      continue;
    }
    if (cost <= remaining) {
      included.push(item);
      tokenCount += cost;
    } else {
      unfitted.push({ item, cost });
    }
  }

  let omittedCount = 0;
  for (const { item, cost } of unfitted) {
    const remaining = budget.maxTokens - tokenCount;
    if (remaining <= 0 || cost === null) {
      omittedCount++;
      continue;
    }
    let compressed: { content: string; wasCompressed: boolean };
    try {
      compressed = compressFn(item.content, remaining, estimate);
    } catch (error) {
      console.warn(`compression failed for ${identify(item)}, omitting it:`, error);
      omittedCount++;
      continue;
    }
    if (compressed.wasCompressed) {
      let compressedCost: number;
      try {
        compressedCost = estimate(compressed.content);
      } catch (error) {
        console.warn(`post-compression estimation failed for ${identify(item)}, omitting it:`, error);
        omittedCount++;
        continue;
      }
      if (compressedCost <= remaining) {
        included.push({ ...item, content: compressed.content, wasCompressed: true });
        tokenCount += compressedCost;
        continue;
      }
    }
    omittedCount++;
  }

  included.sort((a, b) => a.rank - b.rank);

  return {
    included,
    tokenCount,
    truncated: omittedCount > 0 || included.some((i) => i.wasCompressed),
    omittedCount,
  };
}
