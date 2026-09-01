import { CodeSearchQuerySchema, type CodeSearchQuery, type CodeSearchResult, type CodeSearchStore } from "@brain/contracts";
import { mergeCodeCandidates } from "./code-merge.js";

/**
 * Code candidate generation ONLY -- verbatim mirror of RetrievalService.getCandidates
 * (packages/core/retrieval/src/service.ts), operating on CodeSearchStore/
 * CodeSearchResult instead of RetrievalStore/Candidate. See PHASE_3_SPEC.md Phase
 * 3.2 Part B for why these are separate types rather than one service overloaded
 * over both. Same failure-mode policy, deliberately asymmetric between the two
 * sources:
 * - lexicalSearch failing propagates as a real error.
 * - semanticSearch failing degrades to lexical-only, logged, not silently swallowed
 *   and not thrown -- the one documented, expected degradation path.
 */
export class CodeRetrievalService {
  constructor(private readonly store: CodeSearchStore) {}

  async getCandidates(rawQuery: CodeSearchQuery): Promise<CodeSearchResult[]> {
    const query = CodeSearchQuerySchema.parse(rawQuery);

    const [lexicalResult, semanticResult] = await Promise.allSettled([
      this.store.lexicalSearch(query),
      this.store.semanticSearch(query),
    ]);

    if (lexicalResult.status === "rejected") {
      throw lexicalResult.reason;
    }

    let semanticCandidates: CodeSearchResult[] = [];
    if (semanticResult.status === "fulfilled") {
      semanticCandidates = semanticResult.value;
    } else {
      console.warn("semantic code retrieval unavailable, continuing with lexical-only candidates:", semanticResult.reason);
    }

    return mergeCodeCandidates(lexicalResult.value, semanticCandidates);
  }
}
