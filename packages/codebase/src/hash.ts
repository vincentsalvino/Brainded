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
