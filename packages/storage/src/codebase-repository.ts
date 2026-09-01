import type Database from "better-sqlite3";
import {
  type CodebaseRepository,
  type CodebaseRecord,
  type CodeFileRecord,
  type CodeChunkRecord,
  type ScopeRef,
} from "@brain/contracts";
import { randomUUID } from "node:crypto";

interface RepositoryRow {
  id: string;
  scope_kind: string;
  scope_id: string | null;
  root_path: string;
  created_at: string;
  updated_at: string;
  last_indexed_at: string | null;
}

function repositoryRowToRecord(row: RepositoryRow): CodebaseRecord {
  return {
    id: row.id,
    scope: { kind: row.scope_kind as ScopeRef["kind"], id: row.scope_id },
    rootPath: row.root_path,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    lastIndexedAt: row.last_indexed_at,
  };
}

interface FileRow {
  id: string;
  repository_id: string;
  scope_kind: string;
  scope_id: string | null;
  relative_path: string;
  language: string | null;
  size_bytes: number;
  content_hash: string;
  indexed_at: string;
}

function fileRowToRecord(row: FileRow): CodeFileRecord {
  return {
    id: row.id,
    repositoryId: row.repository_id,
    scope: { kind: row.scope_kind as ScopeRef["kind"], id: row.scope_id },
    relativePath: row.relative_path,
    language: row.language,
    sizeBytes: row.size_bytes,
    contentHash: row.content_hash,
    indexedAt: row.indexed_at,
  };
}

/**
 * Phase 3.1. Mirrors SqliteMemoryRepository's shape: prepared statements, a
 * scope_kind/scope_id CHECK-backed schema, db.transaction() for the one operation
 * that must be atomic (replaceFile -- see repositories.ts's doc comment on why this
 * is a single upsert-and-replace primitive, not separate insert/update methods).
 */
export class SqliteCodebaseRepository implements CodebaseRepository {
  constructor(private readonly db: Database.Database) {}

  async findRepository(scope: ScopeRef, rootPath: string): Promise<CodebaseRecord | null> {
    const row = this.db
      .prepare(`SELECT * FROM repositories WHERE scope_kind = ? AND scope_id IS ? AND root_path = ?`)
      .get(scope.kind, scope.id, rootPath) as RepositoryRow | undefined;
    return row ? repositoryRowToRecord(row) : null;
  }

  async createRepository(scope: ScopeRef, rootPath: string): Promise<CodebaseRecord> {
    const now = new Date().toISOString();
    const record: CodebaseRecord = {
      id: randomUUID(),
      scope,
      rootPath,
      createdAt: now,
      updatedAt: now,
      lastIndexedAt: null,
    };
    this.db
      .prepare(
        `INSERT INTO repositories (id, scope_kind, scope_id, root_path, created_at, updated_at, last_indexed_at)
         VALUES (?,?,?,?,?,?,NULL)`,
      )
      .run(record.id, record.scope.kind, record.scope.id, record.rootPath, record.createdAt, record.updatedAt);
    return record;
  }

  async markIndexed(repositoryId: string): Promise<void> {
    const now = new Date().toISOString();
    this.db
      .prepare(`UPDATE repositories SET last_indexed_at = ?, updated_at = ? WHERE id = ?`)
      .run(now, now, repositoryId);
  }

  async listFiles(repositoryId: string): Promise<CodeFileRecord[]> {
    const rows = this.db
      .prepare(`SELECT * FROM code_files WHERE repository_id = ?`)
      .all(repositoryId) as FileRow[];
    return rows.map(fileRowToRecord);
  }

  async replaceFile(
    file: CodeFileRecord,
    chunks: CodeChunkRecord[],
  ): Promise<{ chunksCreated: number; chunksRemoved: number }> {
    const insertFile = this.db.prepare(
      `INSERT INTO code_files (id, repository_id, scope_kind, scope_id, relative_path, language, size_bytes, content_hash, indexed_at)
       VALUES (?,?,?,?,?,?,?,?,?)
       ON CONFLICT(id) DO UPDATE SET
         language = excluded.language,
         size_bytes = excluded.size_bytes,
         content_hash = excluded.content_hash,
         indexed_at = excluded.indexed_at`,
    );
    const deleteChunks = this.db.prepare(`DELETE FROM code_chunks WHERE file_id = ?`);
    const insertChunk = this.db.prepare(
      `INSERT INTO code_chunks (id, file_id, repository_id, scope_kind, scope_id, relative_path, chunk_index, start_line, end_line, content, content_hash)
       VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
    );

    let chunksRemoved = 0;
    const run = this.db.transaction(() => {
      insertFile.run(
        file.id,
        file.repositoryId,
        file.scope.kind,
        file.scope.id,
        file.relativePath,
        file.language,
        file.sizeBytes,
        file.contentHash,
        file.indexedAt,
      );
      chunksRemoved = deleteChunks.run(file.id).changes;
      for (const chunk of chunks) {
        insertChunk.run(
          chunk.id,
          chunk.fileId,
          chunk.repositoryId,
          chunk.scope.kind,
          chunk.scope.id,
          chunk.relativePath,
          chunk.chunkIndex,
          chunk.startLine,
          chunk.endLine,
          chunk.content,
          chunk.contentHash,
        );
      }
    });
    run();

    return { chunksCreated: chunks.length, chunksRemoved };
  }

  async removeFile(fileId: string): Promise<{ chunksRemoved: number }> {
    const chunksRemoved = this.db.prepare(`SELECT COUNT(*) n FROM code_chunks WHERE file_id = ?`).get(fileId) as {
      n: number;
    };
    this.db.prepare(`DELETE FROM code_files WHERE id = ?`).run(fileId);
    return { chunksRemoved: chunksRemoved.n };
  }
}
