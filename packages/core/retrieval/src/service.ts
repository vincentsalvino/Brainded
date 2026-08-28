import { RetrievalQuerySchema, type RetrievalQuery, type Candidate, type RetrievalStore, type RankedResult, type SimilarityPair } from "@brain/contracts";
import { mergeCandidates } from "./merge.js";
import { toRedundancyPairs } from "./redundancy.js";
import { isNearDuplicate, type NearDuplicatePolicy } from "./lexical-containment.js";

/**
 * Candidate generation ONLY. "Here are the potentially relevant things" -- never
 * "here is what the agent should see." No score fusion, no reranking, no context
 * compilation, no token budgeting: each returned Candidate keeps its raw,
 * per-signal scores (signals.lexicalScore / signals.semanticScore) separate and
 * un-combined. Combining them into one "retrieval score" is P1-009's job, on
 * purpose -- that boundary is what lets ranking strategy change later without
 * touching retrieval, which is exactly the mistake both AEOS's hybridSearch()
 * (one weighted-sum pass: FTS + vector + tag + performance + exploration) and
 * AEOS-brain's match_memories RPC (same shape, different weights) made.
 *
 * Failure-mode policy, deliberately asymmetric between the two sources:
 * - lexicalSearch failing propagates as a real error (data corruption / storage
 *   failure -- not something to silently paper over, PHASE_1_SPEC.md Error
 *   Handling).
 * - semanticSearch failing (vector backend unavailable OR the embedding call
 *   itself failing -- both surface identically here) degrades to lexical-only,
 *   logged, not silently swallowed and not thrown. This is the one documented,
 *   expected degradation path (sqlite-vec platform fragility,
 *   PHASE_1_READINESS.md risks) vs. an actual failure.
 * - Malformed input (RetrievalQuerySchema.parse) is a bad request, not a backend
 *   failure -- it throws, uncaught, before either search runs.
 */
export class RetrievalService {
  constructor(private readonly store: RetrievalStore) {}

  async getCandidates(rawQuery: RetrievalQuery): Promise<Candidate[]> {
    const query = RetrievalQuerySchema.parse(rawQuery);

    const [lexicalResult, semanticResult] = await Promise.allSettled([
      this.store.lexicalSearch(query),
      this.store.semanticSearch(query),
    ]);

    if (lexicalResult.status === "rejected") {
      throw lexicalResult.reason;
    }

    let semanticCandidates: Candidate[] = [];
    if (semanticResult.status === "fulfilled") {
      semanticCandidates = semanticResult.value;
    } else {
      console.warn("semantic retrieval unavailable, continuing with lexical-only candidates:", semanticResult.reason);
    }

    return mergeCandidates(lexicalResult.value, semanticCandidates);
  }

  /**
   * P2-013/2C.7: redundancy-pair computation in retrieval preparation, which
   * already has store access (PHASE_2_SPEC.md 8). Delegates cosine
   * similarity math to the store (E25) -- never lexical logic, per 2C.7
   * instruction -- then applies the pure hybrid near-duplicate classifier
   * (isNearDuplicate) to decide WHICH of the store's returned pairs are
   * really near-duplicates, before handing only the accepted ones to
   * toRedundancyPairs for anchor orientation. Two separate questions, two
   * separate functions: this method decides "is it a duplicate at all",
   * toRedundancyPairs decides "which side anchors" -- never combined.
   *
   * `policy.candidateFloor` (not `highConfidenceThreshold`) is what reaches
   * the store: a pair in [candidateFloor, highConfidenceThreshold) must
   * still be retrieved so containment can corroborate it. Passing the
   * high-confidence threshold here would silently drop every pair the
   * lexical check exists to rescue.
   */
  async getRedundancyPairs(rankedResults: RankedResult[], policy: NearDuplicatePolicy): Promise<SimilarityPair[]> {
    if (rankedResults.length < 2) return [];
    const candidatePairs = await this.store.findSimilarPairs(rankedResults.map((r) => r.memoryId), policy.candidateFloor);

    const contentById = new Map(rankedResults.map((r) => [r.memoryId, r.record.content]));
    const nearDuplicatePairs = candidatePairs.filter((pair) => {
      const contentA = contentById.get(pair.a);
      const contentB = contentById.get(pair.b);
      if (contentA === undefined || contentB === undefined) return false;
      return isNearDuplicate({ cosineSimilarity: pair.similarity, contentA, contentB }, policy);
    });

    return toRedundancyPairs(rankedResults, nearDuplicatePairs);
  }
}
