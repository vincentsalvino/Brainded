import type { RankedResult, SimilarityPair } from "@brain/contracts";
import { sortSimilarityPairs } from "@brain/contracts";

/**
 * Re-orients raw {a,b,similarity} triples from RetrievalStore.findSimilarPairs
 * (which knows nothing about rank -- it is a pure similarity primitive) so
 * that `a` is always the HIGHER-ranked member (lower RankedResult.rank
 * number), per PHASE_2C_SPEC.md 2C-004: "a being the higher-ranked member."
 * `core/context`'s compileContext() demotes `b` behind `a` on this basis.
 *
 * A pair naming a memoryId not present in `rankedResults` is dropped rather
 * than passed through -- it cannot be oriented by rank, and compileContext()
 * only ever sees items that came from rankedResults in the first place.
 */
export function toRedundancyPairs(rankedResults: RankedResult[], similarityPairs: SimilarityPair[]): SimilarityPair[] {
  const rankOf = new Map(rankedResults.map((r) => [r.memoryId, r.rank]));

  const oriented: SimilarityPair[] = [];
  for (const pair of similarityPairs) {
    const rankA = rankOf.get(pair.a);
    const rankB = rankOf.get(pair.b);
    if (rankA === undefined || rankB === undefined) continue;
    oriented.push(
      rankA <= rankB
        ? { a: pair.a, b: pair.b, similarity: pair.similarity }
        : { a: pair.b, b: pair.a, similarity: pair.similarity },
    );
  }
  return sortSimilarityPairs(oriented);
}
