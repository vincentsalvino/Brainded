import type { RankingInput, RankedResult } from "@brain/contracts";
import { computeScore, DEFAULT_RANKING_WEIGHTS, DEFAULT_MAX_BOOST } from "./score.js";

function clamp(value: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, value));
}

/**
 * Phase 1 ranking baseline: a plain weighted sum over the two signals retrieval
 * (P1-008) actually produces (lexicalScore, semanticScore). tagScore is plumbed
 * through the formula (score.ts) but contributes 0 in practice -- no Phase 1
 * retrieval source currently populates it (tag filtering already narrows the
 * candidate pool upstream in P1-008; scoring by tag was never required).
 *
 * Every other ARCHITECTURE.md-listed reranking signal was considered and
 * deliberately excluded, not overlooked:
 *
 * - confidence: PHASE_1_SPEC.md is explicit that record.confidence "must never be
 *   conflated with score" -- it stays on RankedResult.record untouched, and is
 *   used only as a tie-breaker below, never folded into the primary score. AEOS's
 *   own failure mode (a performance boost additively stacked onto an
 *   already-normalized relevance score, letting "proven" patterns dominate
 *   regardless of query relevance, AUDIT_AEOS.md 11) is exactly the shape this
 *   avoids.
 * - historical usefulness (Phase 4.2, PHASE_2_DECISIONS.md E7): folded in as a
 *   bounded POST-score multiplier, not a fourth weighted term here -- computeScore
 *   stays pure relevance, unchanged by this file's own Phase 4.2 addition below.
 *   `input.learning` is this function's own explicit, independent activation gate,
 *   never inferred from whether a candidate happens to carry `performance`.
 * - freshness, scope-specificity, source quality, contradiction risk: each has
 *   raw data available (timestamps, scope, provenance) but no Phase-1-defined
 *   policy for how it should affect ranking -- reserved, not invented.
 * - diversity: reserved (signals.diversity stays null on every output). AEOS's
 *   diversity.ts was read directly (not assumed): it computes a Simpson's-Index
 *   metric over an entire *result set* for evaluation/OII purposes, not a
 *   per-candidate score -- it doesn't even match this slot's shape. Nothing to
 *   port for Phase 1.
 *
 * Candidate REranking only: no retrieval, no I/O, no repository access, no MCP --
 * every signal this needs is already present on the Candidate objects passed in
 * (PHASE_1_SPEC.md Package Architecture, packages/core/ranking). Does not mutate
 * its input: every RankedResult is a new object.
 */
export function rank(input: RankingInput): RankedResult[] {
  const weights = input.weights ?? DEFAULT_RANKING_WEIGHTS;
  // Phase 4.2: `input.learning` omitted (every pre-4.2 call site, untouched) behaves exactly like
  // {enabled: false} -- learningEnabled is false, boost is 0 for every candidate, unconditionally,
  // regardless of whether any candidate happens to carry `performance`. This is the second of two
  // independent fail-safe layers (F10); Gateway not decorating is the first.
  const learningEnabled = input.learning?.enabled === true;
  const maxBoost = input.learning?.maxBoost ?? DEFAULT_MAX_BOOST;

  const scored = input.candidates.map((candidate) => {
    const base = computeScore(candidate.signals, weights);
    // `!= null` catches both undefined (field omitted) and null (explicitly "no data") in one
    // check -- Task 8's contract makes both mean the same thing: no learning signal.
    const perf = candidate.performance;
    const boost =
      learningEnabled && perf != null
        ? clamp(maxBoost * (perf.usefulnessSignal - 0.5) * 2, -maxBoost, maxBoost)
        : 0;
    return { candidate, score: base * (1 + boost) };
  });

  // Deterministic ordering (Step 6): same candidates + same weights always
  // produce the same order. Never relies on object iteration, SQLite incidental
  // ordering, insertion timing, Date.now(), or random values.
  scored.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    // Tie-break 1: among equally-scored candidates, prefer the more-trusted
    // memory. This is a separate decision from the score itself, not a backdoor
    // way of folding confidence into relevance.
    if (b.candidate.record.confidence !== a.candidate.record.confidence) {
      return b.candidate.record.confidence - a.candidate.record.confidence;
    }
    // Tie-break 2 (final, total order): memoryId, lexicographic. Not meaningful,
    // only stable -- guarantees a deterministic result even when every other
    // signal is identical.
    if (a.candidate.memoryId < b.candidate.memoryId) return -1;
    if (a.candidate.memoryId > b.candidate.memoryId) return 1;
    return 0;
  });

  return scored.map(
    ({ candidate, score }, index): RankedResult => ({
      memoryId: candidate.memoryId,
      record: candidate.record,
      score,
      signals: { ...candidate.signals, diversity: null },
      rank: index + 1,
    }),
  );
}
