import type { ContextSourceWrapper, TokenBudget } from "@brain/contracts";
import { compress } from "@brain/compression";
import { estimateTokens } from "./estimator.js";
import { fillBudget } from "./fill.js";

function identify(wrapper: ContextSourceWrapper): string {
  if (wrapper.sourceType === "memory") return `memory ${wrapper.item.memoryId}`;
  if (wrapper.sourceType === "code") return `code ${wrapper.item.chunkId}`;
  return `dependency ${wrapper.item.seedFileId}:${wrapper.item.relation}`;
}

/**
 * The heterogeneous sibling of optimizeContext, sharing fillBudget's exact
 * algorithm -- see PHASE_3_SPEC.md Token-Budget Integration: there is exactly
 * one place budget arithmetic happens, this function and optimizeContext are
 * both thin typed callers of it, never two independent enforcement paths.
 */
export function optimizeSources(
  sourceItems: ContextSourceWrapper[],
  budget: TokenBudget,
  estimate: (text: string) => number = estimateTokens,
  compressFn: (
    content: string,
    targetTokens: number,
    estimate: (text: string) => number,
  ) => { content: string; wasCompressed: boolean } = compress,
): { items: ContextSourceWrapper[]; tokenCount: number; truncated: boolean; omittedCount: number } {
  const result = fillBudget(sourceItems, budget, estimate, compressFn, identify);
  return { items: result.included, tokenCount: result.tokenCount, truncated: result.truncated, omittedCount: result.omittedCount };
}
