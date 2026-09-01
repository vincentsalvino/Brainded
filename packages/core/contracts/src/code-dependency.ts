import { z } from "zod";
import { ScopeRefSchema } from "./scope.js";

// Phase 3.3 Dependency Intelligence. File-level static import graph over the
// repositories 3.1 indexes. See PHASE_3_SPEC.md Phase 3.3 Spec for the full design.

export const DEPENDENCY_KINDS = ["static_import", "dynamic_import", "require", "re_export"] as const;
export type DependencyKind = (typeof DEPENDENCY_KINDS)[number];

export const DEPENDENCY_RESOLUTIONS = ["internal", "external", "unresolved"] as const;
export type DependencyResolution = (typeof DEPENDENCY_RESOLUTIONS)[number];

/**
 * `id` is deterministic (sha256 of repositoryId/sourceFileId/specifier/kind, see
 * packages/codebase/src/hash.ts's deriveEdgeId) -- never a random uuid, so a plain
 * non-empty string. `targetFileId` must be set iff resolution is 'internal': the
 * refine below is the schema-level enforcement of that invariant, not just a
 * documentation comment.
 */
export const CodeDependencyEdgeSchema = z
  .object({
    id: z.string().min(1),
    repositoryId: z.string().min(1),
    scope: ScopeRefSchema,
    sourceFileId: z.string().min(1),
    targetFileId: z.string().min(1).nullable(),
    specifier: z.string().min(1),
    kind: z.enum(DEPENDENCY_KINDS),
    resolution: z.enum(DEPENDENCY_RESOLUTIONS),
    sourceLine: z.number().int().positive().nullable(),
    createdAt: z.string().datetime(),
  })
  .strict()
  .refine((edge) => (edge.resolution === "internal") === (edge.targetFileId !== null), {
    message: "targetFileId must be set if and only if resolution is 'internal'",
  });
export type CodeDependencyEdge = z.infer<typeof CodeDependencyEdgeSchema>;

/**
 * Plain interface, not a zod schema -- an internal sync summary, same convention as
 * @brain/codebase's IndexResult and code-search.ts's CodeSyncResult.
 */
export interface DependencySyncResult {
  filesExamined: number;
  filesParsed: number;
  filesUnchanged: number;
  filesFailed: number;
  edgesCreated: number;
  edgesRemoved: number;
  internalEdges: number;
  externalEdges: number;
  unresolvedEdges: number;
  resolutionsUpdated: number;
  durationMs: number;
  failures: { relativePath: string; reason: string }[];
}
