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
 * Token-Budget Integration.
 *
 * Two-pass greedy fill, both passes in `items`' given array order (never
 * re-sorted by this function except the final rank-order pass below). For
 * optimizeContext's caller, that array order is CompiledContext.items: rank
 * order, EXCEPT that redundant items are moved to the end per 2C-005's
 * demotion -- exactly what makes a redundant item lose the budget race first.
 *
 *   Pass 1 -- include everything that fits AS-IS, in that array order.
 *   Pass 2 -- for whatever didn't fit in pass 1, try compressing it into
 *             whatever budget is left, still in that same array order.
 *
 * Natural fits always claim their space first; compression only ever spends
 * what's LEFT OVER after that. This two-pass split exists specifically to
 * avoid a real failure mode a single-pass version has: given one huge
 * top-ranked item and several small lower-ranked ones, a single pass that
 * tries "fit-or-compress" item-by-item will compress the huge item down to
 * whatever fits in the *original* budget -- even if that means crushing it to
 * a barely-meaningful fragment -- and spend most of the budget doing so,
 * starving the small items that would otherwise have fit naturally and
 * provided more real value. Two passes fix this: the small items secure their
 * space in pass 1 regardless of the huge item's rank, and the huge item's
 * compression attempt in pass 2 only gets whatever is left, which may be
 * nothing (a correct, deterministic omission) rather than crowding everything
 * else out. This is the concrete case optimize.test.ts's REGRESSION 4 guard
 * (an earlier, single-pass version failed it) checks for.
 *
 * Output is re-sorted back into rank order before being returned -- the
 * two-pass selection process doesn't visit items in final presentation order,
 * but the returned FillResult always is.
 *
 * Never mutates its input items. Any fields on T beyond content/rank/
 * wasCompressed (e.g. ContextItem's score) are carried through untouched, via
 * a shallow spread on the compressed-item path. Never queries storage, calls
 * MCP, or knows what agent -- or even what T is -- will consume the result;
 * every input it needs is passed in explicitly by the caller.
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
