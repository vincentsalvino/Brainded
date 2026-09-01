import { posix } from "node:path";
import type { DependencyResolution } from "@brain/contracts";

const EXTENSIONS = [".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs"];

export interface ResolvedSpecifier {
  resolution: DependencyResolution;
  targetFileId: string | null;
}

function stripKnownExtension(path: string): string {
  for (const ext of EXTENSIONS) {
    if (path.endsWith(ext)) return path.slice(0, -ext.length);
  }
  return path;
}

/**
 * Pure, deterministic. `fileIndex` maps a repository's indexed relativePath ->
 * fileId (built once per sync from CodebaseRepository.listFiles) -- never touches
 * the filesystem or Node's own module resolver (PHASE_3_SPEC.md Path Resolution).
 *
 * A bare (non-relative) specifier is always 'external' -- no workspace-package vs.
 * true-external distinction (documented simplification, PHASE_3_SPEC.md Known
 * Unsupported Syntax). A relative specifier is tried against a fixed, deterministic
 * candidate order: the literal specifier as-is (handles an already-explicit,
 * correctly-matching extension, and wins over every other candidate when it
 * matches a real file), then every supported extension appended to the
 * extension-stripped stem (handles both an extensionless specifier AND this
 * codebase's own convention of importing "./x.js" where the indexed source file is
 * actually "x.ts" -- TS/ESM source references the compiled .js, never the .ts it
 * was compiled from), then the same extensions under `/index`. First candidate
 * present in `fileIndex` wins.
 */
export function resolveSpecifier(input: {
  specifier: string;
  sourceRelativePath: string;
  fileIndex: Map<string, string>;
}): ResolvedSpecifier {
  if (!input.specifier.startsWith(".")) {
    return { resolution: "external", targetFileId: null };
  }

  const sourceDir = posix.dirname(input.sourceRelativePath);
  const base = posix.normalize(posix.join(sourceDir, input.specifier));
  const stem = stripKnownExtension(base);

  const candidates = [
    base,
    ...EXTENSIONS.map((ext) => `${stem}${ext}`),
    ...EXTENSIONS.map((ext) => `${stem}/index${ext}`),
  ];

  for (const candidate of candidates) {
    const fileId = input.fileIndex.get(candidate);
    if (fileId) return { resolution: "internal", targetFileId: fileId };
  }

  return { resolution: "unresolved", targetFileId: null };
}
