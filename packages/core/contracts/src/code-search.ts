import { z } from "zod";
import { ScopeRefSchema } from "./scope.js";
import { CandidateSignalsSchema } from "./retrieval.js";

// Phase 3.2 Code Retrieval. Deliberately NOT a reuse of Candidate/RetrievalQuery --
// see PHASE_3_SPEC.md Part B ("Candidate Ownership Decision") for why: Candidate.memoryId
// is a uuid (chunk ids are sha256 hex) and Candidate.record is a full, closed-enum
// MemoryRecord (a code chunk is not any of the 12 memory types). CandidateSignals is
// the one part of that shape that IS generic -- reused here unmodified.

export const CodeSearchFiltersSchema = z
  .object({
    repositoryId: z.string().min(1).optional(),
    pathPrefix: z.string().min(1).optional(),
    language: z.string().min(1).optional(),
  })
  .strict();
export type CodeSearchFilters = z.infer<typeof CodeSearchFiltersSchema>;

export const CodeSearchQuerySchema = z
  .object({
    text: z.string().min(1),
    scope: ScopeRefSchema,
    filters: CodeSearchFiltersSchema.optional(),
    limit: z.number().int().positive().max(200).default(20),
  })
  .strict();
// z.input: `limit` has a schema default. Same reasoning as RetrievalQuery.
export type CodeSearchQuery = z.input<typeof CodeSearchQuerySchema>;

export const CodeSearchResultSchema = z
  .object({
    chunkId: z.string().min(1),
    fileId: z.string().min(1),
    repositoryId: z.string().min(1),
    scope: ScopeRefSchema,
    relativePath: z.string().min(1),
    language: z.string().min(1).nullable(),
    startLine: z.number().int().positive(),
    endLine: z.number().int().positive(),
    content: z.string(),
    signals: CandidateSignalsSchema,
  })
  .strict()
  .refine((result) => result.endLine >= result.startLine, {
    message: "endLine must be >= startLine",
  });
export type CodeSearchResult = z.infer<typeof CodeSearchResultSchema>;

/**
 * Plain interface, not a zod schema -- an internal sync summary, not a validated
 * boundary input, same convention as @brain/codebase's IndexResult.
 * `available: false` means the vector backend was unavailable and no sync was
 * attempted (mirrors RetrievalStore.findSimilarPairs' existing degradation shape),
 * not that zero chunks happened to need embedding.
 */
export interface CodeSyncResult {
  chunksEmbedded: number;
  chunksUnchanged: number;
  chunksRemoved: number;
  available: boolean;
}
