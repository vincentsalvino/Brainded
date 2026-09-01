import type { DependencyFact, DependencyRelation } from "@brain/contracts";

/** Compact code provenance -- no decorative wrapping, per PHASE_3_SPEC.md Context Formatting. */
export function formatCodeContent(chunk: { relativePath: string; startLine: number; endLine: number; content: string }): string {
  return `[CODE] ${chunk.relativePath}:${chunk.startLine}-${chunk.endLine}\n${chunk.content}`;
}

const RELATION_VERBS: Record<Exclude<DependencyRelation, "impact">, string> = {
  dependency: "directly imports",
  dependent: "is directly imported by",
};

/**
 * One formatted block per (seedFile, relation) group -- multiple related files
 * share one header, avoiding per-fact header repetition (PHASE_3_SPEC.md
 * Dependency Enrichment). Epistemic language is exact: "directly imports" /
 * "is directly imported by" / "transitively depends on ... at depth N" --
 * never "will break" (preserves 3.3's own boundary).
 */
export function formatDependencyContent(seedRelativePath: string, relation: DependencyRelation, facts: DependencyFact[]): string {
  const paths = facts.map((f) => `- ${f.relativePath}`).join("\n");
  if (relation === "impact") {
    // Assumes all facts in this call share the same depth for "impact" relation.
    // This holds because the default dependency-expansion policy caps impact traversal to depth 1.
    // If a caller passes facts at mixed depths, grouping by depth must happen before this call,
    // or this function would need to report per-fact depth (out of scope for formatting).
    const depth = facts[0]?.depth ?? 1;
    return `[POTENTIAL IMPACT] ${seedRelativePath} transitively depends on this file at depth ${depth}:\n${paths}`;
  }
  return `[DEPENDENCY] ${seedRelativePath} ${RELATION_VERBS[relation]}:\n${paths}`;
}
