import type { CodeSearchResult } from "@brain/contracts";

/**
 * Identity-merge for code search results, verbatim mirror of merge.ts's
 * mergeCandidates keyed by chunkId instead of memoryId -- see PHASE_3_SPEC.md
 * Phase 3.2, Hybrid Dedup. The same chunk returned by both lexical and semantic
 * search becomes ONE CodeSearchResult carrying both signal scores, not two entries
 * and not a combined score. When both channels return the same chunk, the lexical
 * channel's copy wins for non-signal fields (it is inserted into the map first;
 * semantic only overlays `signals` onto it) -- this is mergeCandidates' existing,
 * already-shipped rule, reused unchanged, not a new policy invented for code.
 */
export function mergeCodeCandidates(lexical: CodeSearchResult[], semantic: CodeSearchResult[]): CodeSearchResult[] {
  const byId = new Map<string, CodeSearchResult>();

  for (const result of lexical) {
    byId.set(result.chunkId, result);
  }

  for (const result of semantic) {
    const existing = byId.get(result.chunkId);
    byId.set(
      result.chunkId,
      existing ? { ...existing, signals: { ...existing.signals, ...result.signals } } : result,
    );
  }

  return [...byId.values()];
}
