import type { CandidateSignals, RankingWeights } from "@brain/contracts";

// AEOS's own validated starting shape (semantic weighted highest, lexical second,
// tag smallest -- AUDIT_AEOS.md 11's "no turbovec" weights: keyword 0.25 / vector
// 0.45 / tag 0.20 / metadata 0.10, redistributed across this contract's 3 weights,
// not the 4 AEOS had). Non-blocking implementation detail per
// IMPLEMENTATION_READINESS.md/PHASE_1_TASKS.md -- the *contract* that weights are
// named and swappable is what's fixed; these numbers are tuning, refined
// empirically once real evaluation data exists (P1-009's evaluation harness,
// Phase 4), not architecture.
export const DEFAULT_RANKING_WEIGHTS: RankingWeights = {
  lexical: 0.5,
  semantic: 0.4,
  tag: 0.1,
};

/**
 * The entire scoring formula, in one small, directly-testable function -- not
 * hidden inside a larger orchestration routine (Step 7). A missing signal
 * contributes 0; it is never treated as a penalty. A candidate that only matched
 * lexically is not worse *because* semanticScore is absent -- it simply has no
 * semantic evidence to add.
 *
 * Deliberately excludes record.confidence and every other ARCHITECTURE.md-listed
 * reranking signal not currently populated by Phase 1 retrieval -- see rank.ts's
 * doc comment for the full list of what was considered and why each was included
 * or reserved.
 */
export function computeScore(signals: CandidateSignals, weights: RankingWeights): number {
  return (
    weights.lexical * (signals.lexicalScore ?? 0) +
    weights.semantic * (signals.semanticScore ?? 0) +
    weights.tag * (signals.tagScore ?? 0)
  );
}
