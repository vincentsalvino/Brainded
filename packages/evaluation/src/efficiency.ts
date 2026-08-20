/**
 * 2C-001. Pure token/context efficiency metrics, computed from Phase 2B's
 * already-stored measurements -- no re-estimation with a different
 * tokenizer. Deliberately generic over the SOURCE of each item's label: both
 * a live pipeline run (Task 8) and exportFromEvents-derived real data
 * (Task 7) build DeliveredItemMeasurement[] and feed this same function.
 *
 * "redundant" is its own label, never folded into "not_useful": a memory
 * flagged redundant is not evidence it is wrong (PHASE_2C_SPEC.md 2C-002),
 * so counting its tokens as contextEfficiency's numerator OR as evidence of
 * waste would both misrepresent it.
 */

export type DeliveredItemLabel = "useful" | "not_useful" | "redundant" | "unlabeled";

export interface DeliveredItemMeasurement {
  memoryId: string;
  /** Delivered (post-compression) token cost. null = measurement unavailable for this item. */
  tokenCount: number | null;
  label: DeliveredItemLabel;
}

export interface EfficiencyInput {
  delivered: DeliveredItemMeasurement[];
  /** Candidate-pool token cost BEFORE compilation/optimization. null = unavailable. */
  candidateTokenCount: number | null;
}

export interface EfficiencyMetrics {
  contextEfficiency: number | null;
  redundantRatio: number | null;
  retrievalEfficiency: number | null;
  labeledFraction: number | null;
  deliveredItems: number;
  labeledDeliveredItems: number;
  /** null when any delivered item's tokenCount is unavailable -- a partial sum would understate the true total. */
  deliveredTokens: number | null;
}

export function computeEfficiencyMetrics(input: EfficiencyInput): EfficiencyMetrics {
  const deliveredItems = input.delivered.length;
  const labeledDeliveredItems = input.delivered.filter((d) => d.label !== "unlabeled").length;
  const labeledFraction = deliveredItems === 0 ? null : labeledDeliveredItems / deliveredItems;

  const anyTokenCountMissing = input.delivered.some((d) => d.tokenCount === null);
  let deliveredTokens: number | null = null;
  let usefulTokens = 0;
  let redundantTokens = 0;
  if (deliveredItems > 0 && !anyTokenCountMissing) {
    deliveredTokens = 0;
    for (const d of input.delivered) {
      const cost = d.tokenCount as number;
      deliveredTokens += cost;
      if (d.label === "useful") usefulTokens += cost;
      if (d.label === "redundant") redundantTokens += cost;
    }
  }

  // deliveredTokens === 0 (distinct from null: a real measurement, every
  // delivered item genuinely cost zero tokens -- practically near-impossible
  // since MemoryRecord.content is non-empty, but 0/0 is undefined regardless
  // of why the denominator is zero) is treated the same as "unavailable":
  // there is nothing to compute a meaningful ratio over either way.
  const contextEfficiency = deliveredTokens === null || deliveredTokens === 0 ? null : usefulTokens / deliveredTokens;
  const redundantRatio = deliveredTokens === null || deliveredTokens === 0 ? null : redundantTokens / deliveredTokens;
  const retrievalEfficiency =
    deliveredTokens === null || input.candidateTokenCount === null || input.candidateTokenCount === 0
      ? null
      : deliveredTokens / input.candidateTokenCount;

  return {
    contextEfficiency,
    redundantRatio,
    retrievalEfficiency,
    labeledFraction,
    deliveredItems,
    labeledDeliveredItems,
    deliveredTokens,
  };
}
