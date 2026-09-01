import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { createRequire } from "node:module";
import type { Ignore, Options } from "ignore";

// `ignore` ships a plain `module.exports = factory` (CJS, no __esModule marker) next
// to an ESM-flavored .d.ts; under this project's NodeNext + verbatimModuleSyntax
// config that combination makes a normal `import ignore from "ignore"` resolve to
// the wrong (whole-namespace, non-callable) type even though the runtime value
// would be correct. createRequire sidesteps the mistyped ESM interop entirely --
// the value import is untyped `require`, and the real `Ignore`/`Options` types
// still come from a proper type-only import right above.
const ignoreFactory = createRequire(import.meta.url)("ignore") as (options?: Options) => Ignore;

// .gitignore semantics (negation, anchoring, directory-only patterns) are genuinely
// gnarly -- hand-rolling this would silently misbehave on real repositories. `ignore`
// is the small, dependency-free, correctness-tested library ESLint/Prettier/VS Code
// use for this exact grammar (PHASE_3_SPEC.md Path/Ignore Policy).
export const DEFAULT_IGNORE_PATTERNS = [
  ".git",
  "node_modules",
  "dist",
  "build",
  "coverage",
  ".tmp",
  "*.tmp",
];

/**
 * Builds a `(relativePath) => boolean` predicate for `rootPath`: the default
 * patterns above, plus `rootPath`'s own `.gitignore` if one exists (missing is not
 * an error -- most fixture/sub-repositories won't have one), plus any
 * caller-supplied extra patterns. `relativePath` must be POSIX-style
 * (forward-slash, no leading slash) -- see discovery.ts.
 */
export async function loadIgnoreMatcher(
  rootPath: string,
  extraPatterns: string[] = [],
): Promise<(relativePath: string) => boolean> {
  const ig = ignoreFactory();
  ig.add(DEFAULT_IGNORE_PATTERNS);

  try {
    const gitignore = await readFile(join(rootPath, ".gitignore"), "utf-8");
    ig.add(gitignore);
  } catch {
    // No .gitignore is the common case for a fixture/sub-repository, not a failure.
  }

  if (extraPatterns.length > 0) ig.add(extraPatterns);

  return (relativePath: string) => ig.ignores(relativePath);
}
