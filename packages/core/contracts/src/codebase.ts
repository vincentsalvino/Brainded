import { z } from "zod";
import { ScopeRefSchema } from "./scope.js";

// Phase 3.1 Repository Foundation. "Repository" here means a registered, indexed
// code root -- deliberately named CodebaseRecord, not RepositoryRecord, so it does
// not collide with this codebase's existing use of "*Repository" for a
// storage-access interface (MemoryRepository, RetrievalStore, EventStore in
// repositories.ts). See PHASE_3_SPEC.md Part A.
export const CodebaseRecordSchema = z
  .object({
    id: z.string().uuid(),
    scope: ScopeRefSchema,
    rootPath: z.string().min(1),
    createdAt: z.string().datetime(),
    updatedAt: z.string().datetime(),
    lastIndexedAt: z.string().datetime().nullable(),
  })
  .strict();
export type CodebaseRecord = z.infer<typeof CodebaseRecordSchema>;

// File/chunk ids are deterministic sha256 hex digests (see packages/codebase/src/hash.ts),
// not uuids -- hence a plain non-empty string, not z.string().uuid().
export const CodeFileRecordSchema = z
  .object({
    id: z.string().min(1),
    repositoryId: z.string().min(1),
    scope: ScopeRefSchema,
    relativePath: z.string().min(1),
    language: z.string().min(1).nullable(),
    sizeBytes: z.number().int().nonnegative(),
    contentHash: z.string().min(1),
    indexedAt: z.string().datetime(),
  })
  .strict();
export type CodeFileRecord = z.infer<typeof CodeFileRecordSchema>;

export const CodeChunkRecordSchema = z
  .object({
    id: z.string().min(1),
    fileId: z.string().min(1),
    repositoryId: z.string().min(1),
    scope: ScopeRefSchema,
    relativePath: z.string().min(1),
    chunkIndex: z.number().int().nonnegative(),
    startLine: z.number().int().positive(),
    endLine: z.number().int().positive(),
    content: z.string(),
    contentHash: z.string().min(1),
  })
  .strict()
  .refine((chunk) => chunk.endLine >= chunk.startLine, {
    message: "endLine must be >= startLine",
  });
export type CodeChunkRecord = z.infer<typeof CodeChunkRecordSchema>;
