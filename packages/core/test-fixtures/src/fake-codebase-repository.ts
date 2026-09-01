import { randomUUID } from "node:crypto";
import {
  type CodebaseRepository,
  type CodebaseRecord,
  type CodeFileRecord,
  type CodeChunkRecord,
  type ScopeRef,
} from "@brain/contracts";

/**
 * In-memory CodebaseRepository for unit-testing packages/codebase's indexer
 * without a real database -- mirrors FakeMemoryRepository's role. Semantics match
 * SqliteCodebaseRepository: replaceFile is a deterministic-id upsert that wholesale
 * replaces the file's chunks; removeFile cascades.
 */
export class FakeCodebaseRepository implements CodebaseRepository {
  private readonly repositories = new Map<string, CodebaseRecord>();
  private readonly files = new Map<string, CodeFileRecord>();
  private readonly chunksByFile = new Map<string, CodeChunkRecord[]>();

  async findRepository(scope: ScopeRef, rootPath: string): Promise<CodebaseRecord | null> {
    for (const record of this.repositories.values()) {
      if (record.scope.kind === scope.kind && record.scope.id === scope.id && record.rootPath === rootPath) {
        return record;
      }
    }
    return null;
  }

  async createRepository(scope: ScopeRef, rootPath: string): Promise<CodebaseRecord> {
    const now = new Date().toISOString();
    const record: CodebaseRecord = { id: randomUUID(), scope, rootPath, createdAt: now, updatedAt: now, lastIndexedAt: null };
    this.repositories.set(record.id, record);
    return record;
  }

  async markIndexed(repositoryId: string): Promise<void> {
    const record = this.repositories.get(repositoryId);
    if (!record) return;
    const now = new Date().toISOString();
    this.repositories.set(repositoryId, { ...record, lastIndexedAt: now, updatedAt: now });
  }

  async listFiles(repositoryId: string): Promise<CodeFileRecord[]> {
    return [...this.files.values()].filter((f) => f.repositoryId === repositoryId);
  }

  async replaceFile(
    file: CodeFileRecord,
    chunks: CodeChunkRecord[],
  ): Promise<{ chunksCreated: number; chunksRemoved: number }> {
    this.files.set(file.id, file);
    const chunksRemoved = this.chunksByFile.get(file.id)?.length ?? 0;
    this.chunksByFile.set(file.id, [...chunks]);
    return { chunksCreated: chunks.length, chunksRemoved };
  }

  async removeFile(fileId: string): Promise<{ chunksRemoved: number }> {
    this.files.delete(fileId);
    const chunksRemoved = this.chunksByFile.get(fileId)?.length ?? 0;
    this.chunksByFile.delete(fileId);
    return { chunksRemoved };
  }
}
