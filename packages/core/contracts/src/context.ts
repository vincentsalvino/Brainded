import { z } from "zod";
import { ScopeRefSchema } from "./scope.js";
import { MEMORY_TYPES, ProvenanceSchema } from "./memory.js";
import { RankedResultSchema } from "./retrieval.js";
import { SimilarityPairSchema } from "./signals.js";

export const TokenBudgetSchema = z
  .object({
    maxTokens: z.number().int().positive(),
  })
  .strict();
export type TokenBudget = z.infer<typeof TokenBudgetSchema>;

export const ContextCompileInputSchema = z
  .object({
    task: z.string().min(1),
    scope: ScopeRefSchema,
    budget: TokenBudgetSchema,
    rankedResults: z.array(RankedResultSchema),
    agentCapabilities: z.array(z.string().min(1)).optional(),
  })
  .strict();
export type ContextCompileInput = z.infer<typeof ContextCompileInputSchema>;

// Every item carries its source memoryId -- the provenance link that makes outcome
// attribution possible later (brain_feedback / brain_record_outcome). See
// ARCHITECTURE.md 17 (Phase 0 addition) and PHASE_1_SPEC.md Learning/Outcome Telemetry.
//
// domain/scope/source/confidence/rank were added alongside P1-010 (context
// compilation): the original shape only had memoryId/content/type/score, which
// cannot answer "where did this come from" (this task's Step 8) once an item is
// several steps removed from its MemoryRecord. Same field-completeness reasoning
// as sourceRef in P1-007 -- discovered by implementation, not speculative.
export const ContextItemSchema = z
  .object({
    memoryId: z.string().uuid(),
    content: z.string(),
    type: z.enum(MEMORY_TYPES),
    domain: z.string().min(1).nullable(),
    scope: ScopeRefSchema,
    source: ProvenanceSchema,
    confidence: z.number().min(0).max(1),
    score: z.number(),
    rank: z.number().int().positive(),
    wasCompressed: z.boolean(),
    // 2C-005 (E10/E25). Absent = normal/non-marked. Points only to another
    // memoryId within the SAME compileContext() call's candidate set -- never
    // an authorization signal, never persisted onto MemoryRecord.
    redundantWith: z.string().uuid().optional(),
  })
  .strict();
export type ContextItem = z.infer<typeof ContextItemSchema>;

export const ContextPackSchema = z
  .object({
    items: z.array(ContextItemSchema),
    tokenCount: z.number().int().nonnegative(),
    truncated: z.boolean(),
    omittedCount: z.number().int().nonnegative(),
  })
  .strict();
export type ContextPack = z.infer<typeof ContextPackSchema>;

// --- P1-010: Context Compilation (budget-free) -----------------------------
// Deliberately separate from ContextCompileInput/ContextPack above, which
// require/report token-budget data that is meaningless before P1-011 exists.
// PHASE_1_SPEC.md's original prose bundled budget enforcement into
// "packages/core/context"'s stated responsibility; BLUEPRINT.md/ARCHITECTURE.md's
// own suggested package layout already lists context/compression/token as three
// separate directories, which this split is closer to. Flagged in this task's
// report as a proposed PHASE_1_SPEC.md wording correction, not applied silently.

export const CompileContextInputSchema = z
  .object({
    task: z.string().min(1),
    scope: ScopeRefSchema,
    rankedResults: z.array(RankedResultSchema),
    agentCapabilities: z.array(z.string().min(1)).optional(),
    // 2C-004/005. Produced by core/retrieval's redundancy-pair computation
    // (which has store access); consumed here by the still-pure compiler.
    // Absent -> Phase 2B behavior exactly.
    redundancyPairs: z.array(SimilarityPairSchema).optional(),
  })
  .strict();
export type CompileContextInput = z.infer<typeof CompileContextInputSchema>;

// `duplicatesRemoved` counts exact-content-match items dropped during
// compilation -- a distinct concept from ContextPack's `omittedCount` (which
// will mean "dropped for token budget" once P1-011 exists). Different field name
// deliberately, so the two counts are never confused with each other.
export const CompiledContextSchema = z
  .object({
    items: z.array(ContextItemSchema),
    duplicatesRemoved: z.number().int().nonnegative(),
  })
  .strict();
export type CompiledContext = z.infer<typeof CompiledContextSchema>;
