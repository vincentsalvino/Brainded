import { z } from "zod";
import type { MemoryType } from "@brain/contracts";

/**
 * Mirrors AEOS's real PatternSchema exactly (references/AEOS/packages/core/src/schema.ts)
 * -- verified against the actual source, not the audit's paraphrase of it, which
 * turned out to be abbreviated (missing purpose/style_traits/use_when/avoid_when/
 * frameworks/team_size/dependencies -- all real fields present in the actual YAML).
 *
 * `.strict()` is the entire point: AEOS's own schema is a plain z.object(), which
 * silently drops unrecognized keys on .parse() (AUDIT_AEOS.md 8). Three of the 98
 * files (design/principles/{usability-first,frictionless-experience,
 * intuitive-navigation}.yaml) use different field names entirely (`priority`,
 * `rules`, `avoid` instead of `usage_rules`/`avoid_when`) and lost that content
 * silently under AEOS's parser. Under this schema they fail loudly instead --
 * exactly what P1-007's acceptance criteria asks for, not a recovery attempt.
 */
export const AEOS_SEED_CATEGORIES = [
  "layout", "component", "pattern", "interaction", "architecture", "api",
  "database", "auth", "realtime", "devops", "rule", "anti-pattern", "motion",
  "principle", "checklist", "standard", "decision", "review", "implementation",
] as const;
export type AeosSeedCategory = (typeof AEOS_SEED_CATEGORIES)[number];

export const AEOS_SEED_DOMAINS = ["design", "backend", "architecture", "engineering"] as const;

export const AeosSeedPatternSchema = z
  .object({
    id: z.string().min(1),
    category: z.enum(AEOS_SEED_CATEGORIES),
    domain: z.enum(AEOS_SEED_DOMAINS),
    name: z.string().min(1),
    description: z.string().min(1),
    purpose: z.string().optional(),
    tags: z.array(z.string()).default([]),
    use_when: z.array(z.string()).optional(),
    avoid_when: z.array(z.string()).optional(),
    frameworks: z.array(z.string()).optional(),
    style_traits: z.array(z.string()).optional(),
    complexity: z.enum(["low", "medium", "high"]).default("medium"),
    team_size: z.string().optional(),
    code: z.string().optional(),
    usage_rules: z.array(z.string()).optional(),
    dependencies: z.array(z.string()).optional(),
    version: z.string().default("1.0"),
    status: z.enum(["recommended", "deprecated", "experimental"]).default("recommended"),
    schema_version: z.number().int().default(1),
    framework_version: z.string().optional(),
    superseded_by: z.string().optional(),
    deprecated_at: z.string().optional(),
    deprecation_reason: z.string().optional(),
  })
  .strict();

export type AeosSeedPattern = z.infer<typeof AeosSeedPatternSchema>;

/**
 * category -> Brain memory type. Grounded in the actual 19-value category enum
 * above, not a folder-name heuristic. "Knowledge" per PHASE_1_SPEC.md / this
 * task's Step 3 is reusable patterns/procedures/principles -- these three types
 * are the ones that fit; nothing here becomes fact/decision/experience/error/
 * project_state/task_state/agent_experience/preference/constraint, which are
 * Memory's territory (interaction-derived), not curated reference knowledge.
 */
const CATEGORY_TO_TYPE: Record<AeosSeedCategory, MemoryType> = {
  rule: "rule",
  "anti-pattern": "rule",
  principle: "rule",
  standard: "rule",
  checklist: "procedure",
  implementation: "procedure",
  review: "procedure",
  layout: "pattern",
  component: "pattern",
  pattern: "pattern",
  interaction: "pattern",
  architecture: "pattern",
  api: "pattern",
  database: "pattern",
  auth: "pattern",
  realtime: "pattern",
  devops: "pattern",
  motion: "pattern",
  decision: "pattern",
};

export function memoryTypeForCategory(category: AeosSeedCategory): MemoryType {
  return CATEGORY_TO_TYPE[category];
}

/** Curated content gets a confidence signal from AEOS's own status field, not a flat default. */
const STATUS_TO_CONFIDENCE: Record<AeosSeedPattern["status"], number> = {
  recommended: 0.9,
  experimental: 0.5,
  deprecated: 0.2,
};

export function confidenceForStatus(status: AeosSeedPattern["status"]): number {
  return STATUS_TO_CONFIDENCE[status];
}

/** Composes the full MemoryRecord.content text from every substantive field AEOS's
 *  schema carries, so nothing meaningful is dropped in the domain/type/tags mapping. */
export function composeContent(pattern: AeosSeedPattern): string {
  const parts: string[] = [`# ${pattern.name}`, "", pattern.description.trim()];

  if (pattern.purpose) parts.push("", `Purpose: ${pattern.purpose.trim()}`);
  if (pattern.complexity) parts.push("", `Complexity: ${pattern.complexity}`);
  if (pattern.use_when?.length) parts.push("", "Use when:", ...pattern.use_when.map((s) => `- ${s}`));
  if (pattern.avoid_when?.length) parts.push("", "Avoid when:", ...pattern.avoid_when.map((s) => `- ${s}`));
  if (pattern.usage_rules?.length) parts.push("", "Usage rules:", ...pattern.usage_rules.map((s) => `- ${s}`));
  if (pattern.frameworks?.length) parts.push("", `Frameworks: ${pattern.frameworks.join(", ")}`);
  if (pattern.code) parts.push("", "```", pattern.code.trim(), "```");

  return parts.join("\n");
}
