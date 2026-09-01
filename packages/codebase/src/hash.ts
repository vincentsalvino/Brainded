import { createHash } from "node:crypto";

export function hashContent(content: string | Buffer): string {
  return createHash("sha256").update(content).digest("hex");
}

/**
 * Path-derived, never content-derived: a file's identity must survive edits (an
 * update stays an update, not a delete+create) and must not depend on rootPath or
 * any absolute, machine-specific path (a repository can move between machines and
 * re-index to the same file identities). See PHASE_3_SPEC.md's Repository Model.
 */
export function deriveFileId(repositoryId: string, relativePath: string): string {
  return hashContent(`${repositoryId}\n${relativePath}`);
}

/**
 * Only needs to be stable for a single content version -- a changed file's chunks
 * are wholesale replaced (see CodebaseRepository.replaceFile), never diffed
 * chunk-by-chunk, so the chunk id does not need to survive a content change.
 */
export function deriveChunkId(fileId: string, chunkIndex: number): string {
  return hashContent(`${fileId}\n${chunkIndex}`);
}

/**
 * Phase 3.3. One semantic edge per (sourceFileId, specifier, kind) -- deliberately
 * NOT content- or occurrence-derived, so multiple imports of the same specifier+kind
 * from the same file collapse into one edge (PHASE_3_SPEC.md Edge Identity). Content-
 * independent for the same reason deriveFileId is: an edge's identity must survive a
 * source file's content changing (the sync replaces its edge set wholesale, never
 * diffs edge-by-edge), and must not depend on rootPath or any absolute path.
 */
export function deriveEdgeId(repositoryId: string, sourceFileId: string, specifier: string, kind: string): string {
  return hashContent(`${repositoryId}\n${sourceFileId}\n${specifier}\n${kind}`);
}
