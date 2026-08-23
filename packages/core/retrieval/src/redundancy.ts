import type { RankedResult, ScopeKind, SimilarityPair } from "@brain/contracts";
import { sortSimilarityPairs } from "@brain/contracts";

/**
 * 2C.1. Redundancy-anchor preference by scope specificity. Used ONLY to pick
 * which side of an ALREADY-similarity-flagged pair is kept (`a`) vs demoted
 * (`b`) when the two sides differ in specificity -- never to decide whether a
 * pair is similar enough to flag (that's minSimilarity, upstream), and never
 * touches RankedResult.rank itself (docs/PHASE_2C_PILOT_REPORT.md's real
 * finding: rank-only orientation let a higher-ranked global memory demote a
 * lower-ranked project-specific one it was redundant with).
 *
 * NOT a general project-vs-session hierarchy claim, even though `project`
 * sorts below `session` here. Per scopeIncludes(), a record is visible to a
 * query only if it is global or an EXACT kind+id match -- a project-scoped
 * query never sees a session-scoped record and vice versa, so the two never
 * appear together in the same `rankedResults` this function receives, and
 * this ordering can never actually compare them. The only comparisons this
 * table can ever produce in practice are global-vs-project (inside a
 * project-scoped query) or global-vs-session (inside a session-scoped
 * query) -- both resolve to "the non-global side anchors," which is the
 * whole of what 2C.1 needs. project < session exists only so one shared
 * table can express "less specific than global" for both kinds at once,
 * not because either is more specific than the other in any reachable sense.
 */
const SCOPE_SPECIFICITY: Record<ScopeKind, number> = { global: 0, project: 1, session: 2 };

/**
 * Re-orients raw {a,b,similarity} triples from RetrievalStore.findSimilarPairs
 * (which knows nothing about rank or scope -- it is a pure similarity
 * primitive) so that `a` is the preferred anchor and `b` is the side
 * `core/context`'s compileContext() demotes.
 *
 * Preference order: a more scope-specific memory anchors a less specific one
 * it is redundant with, regardless of rank (2C.1 rule 1/2). Between two
 * memories of the SAME scope specificity, the higher-ranked (lower
 * RankedResult.rank number) member anchors, per PHASE_2C_SPEC.md 2C-004 --
 * unchanged from Phase 2C's original behavior.
 *
 * A pair naming a memoryId not present in `rankedResults` is dropped rather
 * than passed through -- it cannot be oriented, and compileContext() only
 * ever sees items that came from rankedResults in the first place.
 */
export function toRedundancyPairs(rankedResults: RankedResult[], similarityPairs: SimilarityPair[]): SimilarityPair[] {
  const infoOf = new Map(rankedResults.map((r) => [r.memoryId, { rank: r.rank, specificity: SCOPE_SPECIFICITY[r.record.scope.kind] }]));

  const oriented: SimilarityPair[] = [];
  for (const pair of similarityPairs) {
    const infoA = infoOf.get(pair.a);
    const infoB = infoOf.get(pair.b);
    if (infoA === undefined || infoB === undefined) continue;

    const aAnchors =
      infoA.specificity !== infoB.specificity ? infoA.specificity > infoB.specificity : infoA.rank <= infoB.rank;
    oriented.push(
      aAnchors
        ? { a: pair.a, b: pair.b, similarity: pair.similarity }
        : { a: pair.b, b: pair.a, similarity: pair.similarity },
    );
  }
  return sortSimilarityPairs(oriented);
}
