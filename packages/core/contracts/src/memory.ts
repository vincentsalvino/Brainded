import { z } from "zod";
import { ScopeRefSchema } from "./scope.js";

export const MEMORY_TYPES = [
  "fact",
  "decision",
  "pattern",
  "rule",
  "procedure",
  "experience",
  "error",
  "constraint",
  "project_state",
  "task_state",
  "agent_experience",
  "preference",
] as const;
export type MemoryType = (typeof MEMORY_TYPES)[number];

// Phase 1 minimal lifecycle. Richer values (candidate, elevated, trusted, stale, ...)
// are a Phase 4 addition to this same enum, not a schema change. See PHASE_1_SPEC.md.
export const MEMORY_STATUSES = ["active", "archived"] as const;
export type MemoryStatus = (typeof MEMORY_STATUSES)[number];

export const PROVENANCE_ORIGINS = ["agent", "system", "import", "derived"] as const;
export type ProvenanceOrigin = (typeof PROVENANCE_ORIGINS)[number];

export const ProvenanceSchema = z
  .object({
    origin: z.enum(PROVENANCE_ORIGINS),
    agentId: z.string().min(1).optional(),
    sessionId: z.string().min(1).optional(),
    taskId: z.string().min(1).optional(),
    // Free-form "where exactly this came from" identifier -- e.g.
    // "aeos-seed:backend-repository-pattern". Not agent/session/task-scoped, so it
    // doesn't fit the three fields above; added for packages/knowledge (P1-007)
    // because origin:'import' alone can't answer "where did this come from"
    // (this task's Step 5) any more precisely than AEOS's own vague "seed" tag
    // could -- generically useful for any imported/derived memory, not just seed.
    sourceRef: z.string().min(1).optional(),
  })
  .strict();
export type Provenance = z.infer<typeof ProvenanceSchema>;

// domain is a content-category tag ONLY. It must never be used for authorization
// decisions -- access isolation is decided exclusively by `scope`. See ARCHITECTURE.md 8.
export const MemoryRecordSchema = z
  .object({
    id: z.string().uuid(),
    type: z.enum(MEMORY_TYPES),
    content: z.string().min(1),
    domain: z.string().min(1).nullable(),
    scope: ScopeRefSchema,
    source: ProvenanceSchema,
    confidence: z.number().min(0).max(1),
    status: z.enum(MEMORY_STATUSES),
    tags: z.array(z.string().min(1)),
    supersedes: z.string().uuid().nullable(),
    createdAt: z.string().datetime(),
    updatedAt: z.string().datetime(),
  })
  .strict();
export type MemoryRecord = z.infer<typeof MemoryRecordSchema>;

export const MemoryCreateInputSchema = z
  .object({
    type: z.enum(MEMORY_TYPES),
    content: z.string().min(1),
    scope: ScopeRefSchema,
    domain: z.string().min(1).nullable().optional(),
    source: ProvenanceSchema.partial().optional(),
    confidence: z.number().min(0).max(1).default(0.5),
    tags: z.array(z.string().min(1)).default([]),
    supersedes: z.string().uuid().nullable().optional(),
  })
  .strict();
// z.input, not z.infer/z.output: confidence/tags have schema defaults, so the
// *output* type marks them required. Callers constructing a create input (before
// MemoryCreateInputSchema.parse() fills the defaults in) need them optional.
export type MemoryCreateInput = z.input<typeof MemoryCreateInputSchema>;

// `type` and `scope` are deliberately absent here. Because this schema is `.strict()`,
// any attempt to include them fails validation loudly -- the schema itself is the
// immutability enforcement, per PHASE_1_SPEC.md's Memory Model section.
export const MemoryUpdateInputSchema = z
  .object({
    id: z.string().uuid(),
    content: z.string().min(1).optional(),
    domain: z.string().min(1).nullable().optional(),
    tags: z.array(z.string().min(1)).optional(),
    confidence: z.number().min(0).max(1).optional(),
    status: z.literal("archived").optional(),
  })
  .strict();
export type MemoryUpdateInput = z.infer<typeof MemoryUpdateInputSchema>;

export const MemoryQuerySchema = z
  .object({
    scope: ScopeRefSchema,
    type: z.enum(MEMORY_TYPES).optional(),
    tags: z.array(z.string().min(1)).optional(),
    status: z.enum(MEMORY_STATUSES).optional(),
    limit: z.number().int().positive().max(500).default(50),
    cursor: z.string().optional(),
  })
  .strict();
// z.input: `limit` has a schema default. See MemoryCreateInput's note above.
export type MemoryQuery = z.input<typeof MemoryQuerySchema>;

export const MemoryResultSchema = z
  .object({
    items: z.array(MemoryRecordSchema),
    nextCursor: z.string().optional(),
  })
  .strict();
export type MemoryResult = z.infer<typeof MemoryResultSchema>;
