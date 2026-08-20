import type { CompiledContext, ContextItem, ContextPack, TokenBudget } from "@brain/contracts";
import { compress } from "@brain/compression";
import { estimateTokens } from "./estimator.js";

/**
 * The one and only token-budget enforcement point in the Brain (PHASE_1_SPEC.md
 * Token Budgeting). Consumes core/context's CompiledContext (already
 * deduplicated, items in the order core/context emitted them: rank order,
 * EXCEPT that redundant items are moved to the end per 2C-005's demotion --
 * exactly what makes a redundant item lose the budget race first, below) and
 * a budget; produces the final ContextPack -- the only artifact that ever
 * reaches an agent.
 *
 * Two-pass greedy fill, both passes in CompiledContext.items' array order
 * (rank order, except redundant items trail per 2C-005's demotion -- see
 * above):
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
 * else out. This is the concrete case the REGRESSION 4 test in this package
 * (an earlier, single-pass version failed it) guards against.
 *
 * Output is re-sorted back into rank order before being returned -- the
 * two-pass selection process doesn't visit items in final presentation order,
 * but the returned ContextPack always is.
 *
 * Never mutates its input. Never modifies `score` (ranking's output, read-only
 * here). Never queries storage, calls MCP, or knows what agent will consume the
 * result -- every input it needs is already on the CompiledContext passed in.
 */
export function optimizeContext(
  compiledContext: CompiledContext,
  budget: TokenBudget,
  estimate: (text: string) => number = estimateTokens,
  compressFn: (
    content: string,
    targetTokens: number,
    estimate: (text: string) => number,
  ) => { content: string; wasCompressed: boolean } = compress,
): ContextPack {
  const included: ContextItem[] = [];
  const unfitted: { item: ContextItem; cost: number | null }[] = [];
  let tokenCount = 0;

  // Pass 1: natural fits, in array order (rank order, redundant items trailing).
  for (const item of compiledContext.items) {
    const remaining = budget.maxTokens - tokenCount;
    if (remaining <= 0) {
      unfitted.push({ item, cost: null });
      continue;
    }

    let cost: number;
    try {
      cost = estimate(item.content);
    } catch (error) {
      // Cannot safely include -- or later retry compressing -- something whose
      // size we couldn't verify. cost:null means pass 2 won't retry it either.
      console.warn(`token estimation failed for memory ${item.memoryId}, omitting it:`, error);
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

  // Pass 2: compression attempts against whatever budget pass 1 left behind,
  // still in the same array order.
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
      console.warn(`compression failed for memory ${item.memoryId}, omitting it:`, error);
      omittedCount++;
      continue;
    }

    if (compressed.wasCompressed) {
      let compressedCost: number;
      try {
        compressedCost = estimate(compressed.content);
      } catch (error) {
        console.warn(`post-compression estimation failed for memory ${item.memoryId}, omitting it:`, error);
        omittedCount++;
        continue;
      }
      if (compressedCost <= remaining) {
        included.push({ ...item, content: compressed.content, wasCompressed: true });
        tokenCount += compressedCost;
        continue;
      }
    }

    // Doesn't fit even compressed -- omit, keep going. Does not stop pass 2.
    omittedCount++;
  }

  included.sort((a, b) => a.rank - b.rank);

  return {
    items: included,
    tokenCount,
    truncated: omittedCount > 0 || included.some((i) => i.wasCompressed),
    omittedCount,
  };
}
