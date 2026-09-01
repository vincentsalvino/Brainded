import type { DependencyKind } from "@brain/contracts";
import { maskComments } from "./dependency-mask.js";

export interface ExtractedDependency {
  specifier: string;
  kind: DependencyKind;
  sourceLine: number;
}

const ELIGIBLE_LANGUAGES = new Set(["typescript", "javascript"]);

function lineOf(content: string, index: number): number {
  let line = 1;
  for (let i = 0; i < index; i++) {
    if (content[i] === "\n") line++;
  }
  return line;
}

// Five small, independently-testable rules (PHASE_3_SPEC.md: "not one giant fragile
// regex") -- each anchored on the exact keyword/shape it claims, run against
// comment-masked content (dependency-mask.ts) so a masked-out region never matches.

const STATIC_FROM_IMPORT =
  /import\s+(?:type\s+)?(?:\{[^}]*\}|[A-Za-z_$][\w$]*(?:\s*,\s*\{[^}]*\})?)\s+from\s+(['"])([^'"]+)\1/g;
const SIDE_EFFECT_IMPORT = /import\s+(['"])([^'"]+)\1/g;
const REQUIRE_CALL = /require\s*\(\s*(['"])([^'"]+)\1\s*\)/g;
const DYNAMIC_IMPORT_LITERAL = /import\s*\(\s*(['"])([^'"]+)\1\s*\)/g;
const EXPORT_FROM = /export\s+(?:\{[^}]*\}|\*)\s+from\s+(['"])([^'"]+)\1/g;

function matchAll(regex: RegExp, masked: string, kind: DependencyKind): ExtractedDependency[] {
  const found: ExtractedDependency[] = [];
  for (const m of masked.matchAll(regex)) {
    const specifier = m[2];
    if (!specifier) continue;
    found.push({ specifier, kind, sourceLine: lineOf(masked, m.index) });
  }
  return found;
}

/**
 * Static/regex extraction over one file's content -- never throws, never executes
 * the content. Unsupported language -> []. Duplicate (specifier, kind) occurrences
 * from the same file collapse into one entry, keeping the first occurrence's line
 * (PHASE_3_SPEC.md Edge Identity: "one semantic edge per source/specifier/kind").
 */
export function extractDependencies(input: { language: string | null; content: string }): ExtractedDependency[] {
  if (!input.language || !ELIGIBLE_LANGUAGES.has(input.language)) return [];

  const masked = maskComments(input.content);

  // Side-effect imports include the `from`-form's own leading `import "..."`
  // shape? No -- STATIC_FROM_IMPORT requires a binding before `from`, and
  // SIDE_EFFECT_IMPORT requires a quote directly after `import`+whitespace with
  // nothing else; the two shapes cannot both match the same source position, so no
  // manual exclusion between them is needed.
  const all = [
    ...matchAll(STATIC_FROM_IMPORT, masked, "static_import"),
    ...matchAll(SIDE_EFFECT_IMPORT, masked, "static_import"),
    ...matchAll(REQUIRE_CALL, masked, "require"),
    ...matchAll(DYNAMIC_IMPORT_LITERAL, masked, "dynamic_import"),
    ...matchAll(EXPORT_FROM, masked, "re_export"),
  ].sort((a, b) => a.sourceLine - b.sourceLine);

  const byKey = new Map<string, ExtractedDependency>();
  for (const dep of all) {
    const key = `${dep.kind}\n${dep.specifier}`;
    if (!byKey.has(key)) byKey.set(key, dep);
  }
  return [...byKey.values()];
}
