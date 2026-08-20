import type { Candidate } from "@brain/contracts";

/**
 * Identity-merge: the same memoryId returned by both lexical and semantic search
 * becomes ONE Candidate carrying both signal scores, not two entries and not a
 * combined score. This is pooling, not ranking -- no weighting, no fusion formula.
 * That line is deliberate and load-bearing: P1-009 owns turning signals into a
 * single score; P1-008 only ever produces or merges raw per-signal evidence. See
 * this task's report for why AEOS's hybridSearch() (one weighted-sum pass) and
 * AEOS-brain's match_memories RPC (same pattern, different weights) are exactly
 * the shape this function must not become.
 *
 * Content-similarity dedup (different memoryIds, near-duplicate text) is a
 * separate, richer concern that stays in packages/core/context (P1-012) per
 * PHASE_1_SPEC.md -- this function only collapses same-identity hits.
 */
export function mergeCandidates(lexical: Candidate[], semantic: Candidate[]): Candidate[] {
  const byId = new Map<string, Candidate>();

  for (const candidate of lexical) {
    byId.set(candidate.memoryId, candidate);
  }

  for (const candidate of semantic) {
    const existing = byId.get(candidate.memoryId);
    byId.set(
      candidate.memoryId,
      existing ? { ...existing, signals: { ...existing.signals, ...candidate.signals } } : candidate,
    );
  }

  return [...byId.values()];
}
