import { z } from "zod";
import { ScopeRefSchema } from "./scope.js";
import { MEMORY_TYPES, MemoryRecordSchema } from "./memory.js";

export const RetrievalFiltersSchema = z
  .object({
    type: z.enum(MEMORY_TYPES).optional(),
    domain: z.string().min(1).optional(),
    tags: z.array(z.string().min(1)).optional(),
  })
  .strict();
export type RetrievalFilters = z.infer<typeof RetrievalFiltersSchema>;

export const RetrievalQuerySchema = z
  .object({
    text: z.string().min(1),
    scope: ScopeRefSchema,
    filters: RetrievalFiltersSchema.optional(),
    limit: z.number().int().positive().max(200).default(20),
  })
  .strict();
// z.input: `limit` has a schema default. Same reasoning as MemoryCreateInput in memory.ts.
export type RetrievalQuery = z.input<typeof RetrievalQuerySchema>;

// Candidates carry raw, individual, visible per-signal scores -- never pre-combined.
// See PHASE_1_SPEC.md Retrieval Pipeline 1.
export const CandidateSignalsSchema = z
  .object({
    lexicalScore: z.number().min(0).optional(),
    semanticScore: z.number().min(0).optional(),
    tagScore: z.number().min(0).optional(),
  })
  .strict();
export type CandidateSignals = z.infer<typeof CandidateSignalsSchema>;

// Phase 4.2 (PHASE_4_SPEC.md 2.3). rank()'s two new optional fields, as one object -- always
// produced and consumed together, so "no data" (absent/null) can never be confused with "neutral
// data" (evidenceMass: 0), which reading two loose fields independently would risk.
export const CandidatePerformanceSchema = z
  .object({
    usefulnessSignal: z.number().min(0).max(1),
    evidenceMass: z.number().nonnegative(),
  })
  .strict();
export type CandidatePerformance = z.infer<typeof CandidatePerformanceSchema>;

export const CandidateSchema = z
  .object({
    memoryId: z.string().uuid(),
    record: MemoryRecordSchema,
    signals: CandidateSignalsSchema,
    // .nullable().optional(), not .default(null): nothing calls CandidateSchema.parse() on
    // constructed candidates today (FakeRetrievalStore/SqliteRetrievalStore/mergeCandidates all
    // build plain object literals), so a default would never actually apply -- and would have
    // made every existing producer's object literal fail to typecheck by requiring the field.
    // undefined and null both mean "no learning signal"; rank() treats them identically.
    performance: CandidatePerformanceSchema.nullable().optional(),
  })
  .strict();
export type Candidate = z.infer<typeof CandidateSchema>;

export const RankingWeightsSchema = z
  .object({
    lexical: z.number().min(0),
    semantic: z.number().min(0),
    tag: z.number().min(0),
  })
  .strict();
export type RankingWeights = z.infer<typeof RankingWeightsSchema>;

// Phase 4.2 (PHASE_4_SPEC.md 2.3a). rank()'s own, independent activation gate -- deliberately not
// inferred from whether any candidate happens to carry `performance`, so disabling learning is one
// explicit, testable boolean. Omitted entirely (every pre-4.2 RankingInput) behaves exactly like
// {enabled: false}.
export const RankingLearningConfigSchema = z
  .object({
    enabled: z.boolean(),
    maxBoost: z.number().min(0).max(1),
  })
  .strict();
export type RankingLearningConfig = z.infer<typeof RankingLearningConfigSchema>;

export const RankingInputSchema = z
  .object({
    candidates: z.array(CandidateSchema),
    task: z.string().min(1).optional(),
    weights: RankingWeightsSchema.optional(),
    learning: RankingLearningConfigSchema.optional(),
  })
  .strict();
export type RankingInput = z.infer<typeof RankingInputSchema>;

// `diversity` is a reserved-but-unused signal slot for Phase 1 (decision D7 in
// DECISIONS.md) -- present so a future decision doesn't require a contract change.
export const RankedResultSignalsSchema = z
  .object({
    lexicalScore: z.number().min(0).optional(),
    semanticScore: z.number().min(0).optional(),
    tagScore: z.number().min(0).optional(),
    diversity: z.number().min(0).nullable().default(null),
  })
  .strict();
export type RankedResultSignals = z.infer<typeof RankedResultSignalsSchema>;

export const RankedResultSchema = z
  .object({
    memoryId: z.string().uuid(),
    record: MemoryRecordSchema,
    score: z.number(),
    signals: RankedResultSignalsSchema,
    rank: z.number().int().positive(),
  })
  .strict();
export type RankedResult = z.infer<typeof RankedResultSchema>;
