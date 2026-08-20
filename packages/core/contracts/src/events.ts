import { z } from "zod";
import { ScopeRefSchema } from "./scope.js";
import { ProvenanceSchema } from "./memory.js";

// Event provenance chain (PHASE_1_SPEC.md Learning/Outcome Telemetry):
//   RetrievalEvent (all candidates considered)
//     -> ContextEvent (the subset actually delivered -- includedMemoryIds)
//        -> OutcomeEvent (task-level, via caller-supplied opaque taskId)
//   FeedbackEvent (memory-specific, independent of task outcome)
//
// Phase 1 scope is recording + correct linkage only. No aggregation, no algorithm --
// that is Phase 4. taskId/sessionId are caller-supplied and opaque to the Brain; the
// Brain does not observe what an agent does with a context pack.

export const RetrievalEventSchema = z
  .object({
    id: z.string().uuid(),
    timestamp: z.string().datetime(),
    scope: ScopeRefSchema,
    queryText: z.string().min(1),
    candidateIds: z.array(z.string().uuid()),
    taskId: z.string().min(1).nullable().default(null),
  })
  .strict();
export type RetrievalEvent = z.infer<typeof RetrievalEventSchema>;

// P2-006: the normalized context-event <-> memory relation. One row per candidate
// the context event represents, replacing the two opaque JSON arrays as the
// analytical shape. The arrays are retained for one migration cycle and both forms
// are written together; assertContextMembershipConsistent below is what stops them
// from silently diverging.
//
// `rank` is the candidate's position in the delivered pack (1-based) and is null
// for omitted candidates, which never had one.
//
// `tokenCount` is the DELIVERED token cost of this memory in this pack, measured
// with the same estimator core/token used, over the content actually delivered --
// so a compressed item reports the compressed size, not the original. It is null
// for omitted candidates: nothing was delivered, so there is no delivered cost.
// The candidate-pool cost lives on ContextEvent.candidateTokenCount instead.
export const ContextEventMemorySchema = z
  .object({
    memoryId: z.string().uuid(),
    included: z.boolean(),
    rank: z.number().int().positive().nullable().default(null),
    tokenCount: z.number().int().nonnegative().nullable().default(null),
  })
  .strict();
export type ContextEventMemory = z.infer<typeof ContextEventMemorySchema>;

export const ContextEventSchema = z
  .object({
    id: z.string().uuid(),
    timestamp: z.string().datetime(),
    retrievalEventId: z.string().uuid(),
    scope: ScopeRefSchema,
    taskId: z.string().min(1).nullable().default(null),
    includedMemoryIds: z.array(z.string().uuid()),
    omittedMemoryIds: z.array(z.string().uuid()),
    tokenCount: z.number().int().nonnegative(),
    // P2-006. Defaults to [] so a ContextEvent read back from a pre-migration row
    // (which has the JSON arrays but no junction rows) still satisfies the schema.
    memories: z.array(ContextEventMemorySchema).default([]),
    // P2-015 observability. All nullable: a measurement failure must degrade to
    // "not recorded", never to a failed request.
    candidateCount: z.number().int().nonnegative().nullable().default(null),
    candidateTokenCount: z.number().int().nonnegative().nullable().default(null),
    retrievalMs: z.number().int().nonnegative().nullable().default(null),
    rankingMs: z.number().int().nonnegative().nullable().default(null),
    compileMs: z.number().int().nonnegative().nullable().default(null),
    optimizeMs: z.number().int().nonnegative().nullable().default(null),
  })
  .strict();
export type ContextEvent = z.infer<typeof ContextEventSchema>;

/**
 * The two representations of context membership must agree exactly. Called on
 * every write (SqliteEventStore.recordContext) rather than left to the schema,
 * because the schema is not applied on the write path and "write both forms
 * consistently" has to be enforced where the write actually happens.
 *
 * Deliberately throws. Telemetry that silently records two disagreeing answers to
 * "what did the agent receive" is worse than no telemetry -- it is the same class
 * of defect that made the Phase 1 event chain unusable, one layer down.
 */
export function assertContextMembershipConsistent(event: {
  includedMemoryIds: string[];
  omittedMemoryIds: string[];
  memories: ContextEventMemory[];
}): void {
  if (event.memories.length === 0) return; // pre-migration row, nothing to cross-check

  const sorted = (ids: string[]): string => [...ids].sort().join(",");
  const included = sorted(event.memories.filter((m) => m.included).map((m) => m.memoryId));
  const omitted = sorted(event.memories.filter((m) => !m.included).map((m) => m.memoryId));

  if (included !== sorted(event.includedMemoryIds)) {
    throw new Error(
      `context membership diverged: normalized included [${included}] != includedMemoryIds [${sorted(event.includedMemoryIds)}]`,
    );
  }
  if (omitted !== sorted(event.omittedMemoryIds)) {
    throw new Error(
      `context membership diverged: normalized omitted [${omitted}] != omittedMemoryIds [${sorted(event.omittedMemoryIds)}]`,
    );
  }
}

export const OUTCOME_VALUES = ["success", "failure", "partial", "unknown"] as const;
export type OutcomeValue = (typeof OUTCOME_VALUES)[number];

export const OutcomeSignalSchema = z
  .object({
    testsPassed: z.boolean().optional(),
    reviewScore: z.number().min(0).max(1).optional(),
    humanEdited: z.boolean().optional(),
  })
  .strict();
export type OutcomeSignal = z.infer<typeof OutcomeSignalSchema>;

export const OutcomeEventSchema = z
  .object({
    id: z.string().uuid(),
    timestamp: z.string().datetime(),
    taskId: z.string().min(1),
    sessionId: z.string().min(1).nullable().default(null),
    // P2-005: the exact delivery this outcome refers to. Optional -- taskId stays
    // valid and unchanged -- but contextId is the precise identifier, because the
    // Brain minted it and can verify it, whereas taskId is caller-invented.
    contextId: z.string().uuid().nullable().default(null),
    outcome: z.enum(OUTCOME_VALUES),
    signal: OutcomeSignalSchema.nullable().default(null),
    notes: z.string().nullable().default(null),
  })
  .strict();
export type OutcomeEvent = z.infer<typeof OutcomeEventSchema>;

// Why the memory was or was not useful. Recorded in Phase 2B, acted on in a later
// phase -- but recorded NOW because the distinction is unrecoverable afterwards:
// the one real negative datapoint in the corpus is a globally-correct memory
// rejected as a duplicate, which free-text notes cannot separate from a memory
// that is simply wrong.
export const FEEDBACK_REASONS = ["redundant", "irrelevant", "incorrect", "other"] as const;
export type FeedbackReason = (typeof FEEDBACK_REASONS)[number];

export const FeedbackEventSchema = z
  .object({
    id: z.string().uuid(),
    timestamp: z.string().datetime(),
    memoryId: z.string().uuid(),
    taskId: z.string().min(1).nullable().default(null),
    contextId: z.string().uuid().nullable().default(null),
    useful: z.boolean().nullable(),
    reason: z.enum(FEEDBACK_REASONS).nullable().default(null),
    notes: z.string().nullable().default(null),
  })
  .strict();
export type FeedbackEvent = z.infer<typeof FeedbackEventSchema>;

// Audit trail for memory mutations (PHASE_1_SPEC.md Memory Model: "every write, update,
// and delete is attributable via the audit log"). Routed through the same append-only
// EventStore abstraction as the other four event types rather than a separate
// audit-log mechanism -- reuses an existing tool instead of inventing a new one
// (rule 20: no unnecessary abstractions merely because a reference project had one).
export const MUTATION_TYPES = ["create", "update", "archive"] as const;
export type MutationType = (typeof MUTATION_TYPES)[number];

export const MemoryMutationEventSchema = z
  .object({
    id: z.string().uuid(),
    timestamp: z.string().datetime(),
    memoryId: z.string().uuid(),
    mutationType: z.enum(MUTATION_TYPES),
    actor: ProvenanceSchema,
    summary: z.string().min(1).nullable().default(null),
  })
  .strict();
export type MemoryMutationEvent = z.infer<typeof MemoryMutationEventSchema>;
