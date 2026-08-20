import { z } from "zod";
import { ScopeRefSchema, MEMORY_TYPES, OUTCOME_VALUES } from "@brain/contracts";

/**
 * P2-007/P2-008: the replayable evaluation dataset.
 *
 * An example declares its OWN memories. A run therefore never reads
 * `data/brain.db`, never depends on whatever a developer happens to have stored,
 * and reproduces identically on any machine. These strings are regression
 * fixtures; no production package may reference them.
 */

export const EvalMemorySchema = z
  .object({
    /** Stable handle used by `labels`/`redundantWith`. Not a uuid -- readable on purpose. */
    key: z.string().min(1),
    type: z.enum(MEMORY_TYPES),
    content: z.string().min(1),
    scope: ScopeRefSchema,
    confidence: z.number().min(0).max(1).default(0.5),
  })
  .strict();
export type EvalMemory = z.infer<typeof EvalMemorySchema>;

/**
 * Graded relevance, not binary. Binary labels cannot express "relevant, but less
 * useful here than the other relevant one" -- which is exactly the Finding B
 * distinction, and exactly what NDCG needs to score an ordering rather than a set.
 *
 *   2 = the memory a competent engineer would act on for this task
 *   1 = genuinely related, secondary
 *   0 = not useful for this task (NOT "wrong" -- see redundantWith)
 */
export const RELEVANCE_GRADES = [0, 1, 2] as const;

export const EvalExampleSchema = z
  .object({
    id: z.string().min(1),
    task: z.string().min(1),
    scope: ScopeRefSchema,
    memories: z.array(EvalMemorySchema).min(1),
    labels: z.record(z.string(), z.union([z.literal(0), z.literal(1), z.literal(2)])),
    /**
     * `redundantKey -> subsumingKey`. Encodes Finding C's structure: the global
     * plural rule was not wrong, it added nothing the project rule had not already
     * said more specifically. Unused by ranking metrics; consumed by redundancy
     * measurement once P2-013/014 exist.
     */
    redundantWith: z.record(z.string(), z.string()).default({}),
    notes: z.string().nullable().default(null),
    /**
     * 2C-002. Outcome attached as METADATA -- it does not automatically label
     * any included memory (PHASE_2C_SPEC.md 2C-002). Present so
     * exportFromEvents can carry a real OutcomeEvent's value through without
     * fabricating a per-memory grade from it.
     */
    outcome: z.enum(OUTCOME_VALUES).nullable().default(null),
  })
  .strict()
  .superRefine((example, ctx) => {
    const keys = new Set(example.memories.map((m) => m.key));
    if (keys.size !== example.memories.length) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: `${example.id}: duplicate memory key` });
    }
    // A label or redundancy edge naming a memory the example never declared is a
    // silently-wrong dataset -- the class of defect AUDIT_AEOS.md 8 documented.
    // Reject loudly instead.
    for (const key of Object.keys(example.labels)) {
      if (!keys.has(key)) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: `${example.id}: label references unknown memory "${key}"` });
      }
    }
    for (const [from, to] of Object.entries(example.redundantWith)) {
      if (!keys.has(from)) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: `${example.id}: redundantWith references unknown memory "${from}"` });
      }
      if (!keys.has(to)) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: `${example.id}: redundantWith targets unknown memory "${to}"` });
      }
    }
  });
export type EvalExample = z.infer<typeof EvalExampleSchema>;

/** Ranked memory keys, best first -- whatever the strategy under test produced. */
export type RankedKeys = string[];

/** A strategy is any function from an example to an ordering of its memory keys. */
export type Strategy = (example: EvalExample) => Promise<RankedKeys> | RankedKeys;

export interface MetricsAtK {
  k: number;
  precision: number;
  recall: number;
  ndcg: number;
}

export interface ExampleResult {
  exampleId: string;
  ranked: RankedKeys;
  topKey: string | null;
  /** Grade of the top-ranked item -- the single number the Finding B case turns on. */
  topGrade: number;
  reciprocalRank: number;
  atK: MetricsAtK[];
}

export type Significance = "SIGNIFICANT" | "INDICATIVE";

export interface EvalReport {
  strategy: string;
  exampleCount: number;
  /** Total graded labels across all examples -- the honest denominator. */
  labeledObservationCount: number;
  mrr: number;
  atK: MetricsAtK[];
  perExample: ExampleResult[];
  significance: Significance;
  significanceReason: string;
}
