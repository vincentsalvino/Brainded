import type { ContextItem } from "./context.js";

export interface CodeContextItem {
  sourceType: "code";
  chunkId: string;
  repositoryId: string;
  fileId: string;
  relativePath: string;
  language: string | null;
  startLine: number;
  endLine: number;
  content: string;
  score: number;
  rank: number;
  wasCompressed: boolean;
}

export const DEPENDENCY_RELATIONS = ["dependency", "dependent", "impact"] as const;
export type DependencyRelation = (typeof DEPENDENCY_RELATIONS)[number];

export interface DependencyFact {
  fileId: string;
  relativePath: string;
  /** Non-null only when relation is "impact" (transitive depth). */
  depth: number | null;
}

export interface DependencyContextItem {
  sourceType: "dependency";
  repositoryId: string;
  /** The already-selected code file this fact enriches. */
  seedFileId: string;
  seedRelativePath: string;
  relation: DependencyRelation;
  facts: DependencyFact[];
  content: string;
  rank: number;
  wasCompressed: boolean;
}

export interface DependencyExpansionPolicy {
  maxDependencySeedFiles: number;
  maxDirectDependenciesPerFile: number;
  maxDirectDependentsPerFile: number;
  maxImpactDepth: number;
  maxImpactItems: number;
}

/**
 * Conservative defaults chosen against this repository's own measured graph
 * size (Phase 3.3 self-repository evaluation: 150 eligible files, 647 edges,
 * ~4.3 edges/file). See PHASE_3_SPEC.md Phase 3.4, Dependency Enrichment.
 */
export const DEFAULT_DEPENDENCY_EXPANSION_POLICY: DependencyExpansionPolicy = {
  maxDependencySeedFiles: 3,
  maxDirectDependenciesPerFile: 5,
  maxDirectDependentsPerFile: 3,
  maxImpactDepth: 1,
  maxImpactItems: 5,
};

/**
 * The late-normalization wrapper: the ONLY point where memory/code/dependency
 * items share a common shape, used exclusively by selectSources/fillBudget for
 * heterogeneous budget competition. `item` always carries the full typed
 * original; `content`/`rank`/`wasCompressed` are the authoritative, possibly
 * budget-compressed values -- see PHASE_3_SPEC.md Token-Budget Integration for
 * why `.item.content` can go stale after compression and must never be read
 * directly once a wrapper has been through fillBudget.
 */
export type ContextSourceWrapper =
  | { sourceType: "memory"; content: string; rank: number; wasCompressed: boolean; item: ContextItem }
  | { sourceType: "code"; content: string; rank: number; wasCompressed: boolean; item: CodeContextItem }
  | { sourceType: "dependency"; content: string; rank: number; wasCompressed: boolean; item: DependencyContextItem };
