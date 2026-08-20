import { z } from "zod";

export const SCOPE_KINDS = ["global", "project", "session"] as const;
export type ScopeKind = (typeof SCOPE_KINDS)[number];

export const ScopeRefSchema = z
  .object({
    kind: z.enum(SCOPE_KINDS),
    id: z.string().min(1).nullable(),
  })
  .strict()
  .refine((scope) => (scope.kind === "global" ? scope.id === null : scope.id !== null), {
    message: "id must be null for kind 'global' and non-null for 'project'/'session'",
  });

export type ScopeRef = z.infer<typeof ScopeRefSchema>;

export function globalScope(): ScopeRef {
  return { kind: "global", id: null };
}

export function projectScope(id: string): ScopeRef {
  return { kind: "project", id };
}

export function sessionScope(id: string): ScopeRef {
  return { kind: "session", id };
}

/**
 * A memory scoped `recordScope` is visible to a request operating at `queryScope`
 * iff it is either global (visible everywhere) or an exact kind+id match. This is
 * the single canonical definition of scope isolation -- the in-memory fake
 * repository and the real SQLite repository must both agree with it. `domain` is
 * never part of this check (ARCHITECTURE.md 8 -- content taxonomy is not an
 * authorization boundary).
 */
export function scopeIncludes(recordScope: ScopeRef, queryScope: ScopeRef): boolean {
  if (recordScope.kind === "global") return true;
  return recordScope.kind === queryScope.kind && recordScope.id === queryScope.id;
}
