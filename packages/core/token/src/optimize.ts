import type { CompiledContext, ContextItem, ContextPack, TokenBudget } from "@brain/contracts";
import { compress } from "@brain/compression";
import { estimateTokens } from "./estimator.js";
import { fillBudget } from "./fill.js";

// Two-pass greedy fill -- see fill.ts's fillBudget for the algorithm; this is
// a thin ContextItem-typed wrapper over it.
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
  const result = fillBudget(compiledContext.items, budget, estimate, compressFn, (item: ContextItem) => `memory ${item.memoryId}`);
  return {
    items: result.included,
    tokenCount: result.tokenCount,
    truncated: result.truncated,
    omittedCount: result.omittedCount,
  };
}
