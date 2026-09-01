import type Database from "better-sqlite3";
import {
  type CodeDependencyStore,
  type CodeDependencyEdge,
  type DependencyResolution,
  type ScopeRef,
} from "@brain/contracts";

interface EdgeRow {
  id: string;
  repository_id: string;
  scope_kind: string;
  scope_id: string | null;
  source_file_id: string;
  target_file_id: string | null;
  specifier: string;
  kind: string;
  resolution: string;
  source_line: number | null;
  created_at: string;
}

function rowToEdge(row: EdgeRow): CodeDependencyEdge {
  return {
    id: row.id,
    repositoryId: row.repository_id,
    scope: { kind: row.scope_kind as ScopeRef["kind"], id: row.scope_id },
    sourceFileId: row.source_file_id,
    targetFileId: row.target_file_id,
    specifier: row.specifier,
    kind: row.kind as CodeDependencyEdge["kind"],
    resolution: row.resolution as CodeDependencyEdge["resolution"],
    sourceLine: row.source_line,
    createdAt: row.created_at,
  };
}

/**
 * Phase 3.3. Mirrors SqliteCodebaseRepository's shape: prepared statements, a
 * scope_kind/scope_id CHECK-backed schema, db.transaction() for the one operation
 * that must be atomic (replaceOutgoingEdges -- same "delete old, insert new, upsert
 * tracking row" primitive as replaceFile). repositoryId is the isolation key on
 * every query, matching CodebaseRepository's own convention.
 */
export class SqliteCodeDependencyStore implements CodeDependencyStore {
  constructor(private readonly db: Database.Database) {}

  async replaceOutgoingEdges(
    repositoryId: string,
    sourceFileId: string,
    contentHash: string,
    edges: CodeDependencyEdge[],
  ): Promise<{ edgesCreated: number; edgesRemoved: number }> {
    // Scoped by repository_id too, not just source_file_id: file ids are only
    // guaranteed unique WITHIN a repository (deriveFileId hashes repositoryId in),
    // but this statement must not rely on caller discipline to keep that true --
    // same isolation-in-SQL, not just isolation-by-convention, philosophy as every
    // other scoped query in this codebase.
    const deleteEdges = this.db.prepare(`DELETE FROM code_dependency_edges WHERE repository_id = ? AND source_file_id = ?`);
    const insertEdge = this.db.prepare(
      `INSERT INTO code_dependency_edges
         (id, repository_id, scope_kind, scope_id, source_file_id, target_file_id, specifier, kind, resolution, source_line, created_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
    );
    const upsertState = this.db.prepare(
      `INSERT INTO code_dependency_state (file_id, repository_id, content_hash, indexed_at)
       VALUES (?,?,?,?)
       ON CONFLICT(file_id) DO UPDATE SET content_hash = excluded.content_hash, indexed_at = excluded.indexed_at`,
    );

    let edgesRemoved = 0;
    const run = this.db.transaction(() => {
      edgesRemoved = deleteEdges.run(repositoryId, sourceFileId).changes;
      for (const edge of edges) {
        insertEdge.run(
          edge.id,
          edge.repositoryId,
          edge.scope.kind,
          edge.scope.id,
          edge.sourceFileId,
          edge.targetFileId,
          edge.specifier,
          edge.kind,
          edge.resolution,
          edge.sourceLine,
          edge.createdAt,
        );
      }
      upsertState.run(sourceFileId, repositoryId, contentHash, new Date().toISOString());
    });
    run();

    return { edgesCreated: edges.length, edgesRemoved };
  }

  async listDependencyState(repositoryId: string): Promise<{ fileId: string; contentHash: string }[]> {
    const rows = this.db
      .prepare(`SELECT file_id, content_hash FROM code_dependency_state WHERE repository_id = ?`)
      .all(repositoryId) as { file_id: string; content_hash: string }[];
    return rows.map((r) => ({ fileId: r.file_id, contentHash: r.content_hash }));
  }

  async listEdges(repositoryId: string): Promise<CodeDependencyEdge[]> {
    const rows = this.db
      .prepare(`SELECT * FROM code_dependency_edges WHERE repository_id = ?`)
      .all(repositoryId) as EdgeRow[];
    return rows.map(rowToEdge);
  }

  async updateEdgeResolution(edgeId: string, resolution: DependencyResolution, targetFileId: string | null): Promise<void> {
    this.db
      .prepare(`UPDATE code_dependency_edges SET resolution = ?, target_file_id = ? WHERE id = ?`)
      .run(resolution, targetFileId, edgeId);
  }

  async dependenciesOf(repositoryId: string, fileId: string): Promise<CodeDependencyEdge[]> {
    const rows = this.db
      .prepare(`SELECT * FROM code_dependency_edges WHERE repository_id = ? AND source_file_id = ?`)
      .all(repositoryId, fileId) as EdgeRow[];
    return rows.map(rowToEdge);
  }

  async dependentsOf(repositoryId: string, fileId: string): Promise<CodeDependencyEdge[]> {
    const rows = this.db
      .prepare(`SELECT * FROM code_dependency_edges WHERE repository_id = ? AND target_file_id = ?`)
      .all(repositoryId, fileId) as EdgeRow[];
    return rows.map(rowToEdge);
  }

  async removeFileState(repositoryId: string, sourceFileId: string): Promise<{ edgesRemoved: number }> {
    const edgesRemoved = this.db
      .prepare(`DELETE FROM code_dependency_edges WHERE repository_id = ? AND source_file_id = ?`)
      .run(repositoryId, sourceFileId).changes;
    this.db
      .prepare(`DELETE FROM code_dependency_state WHERE repository_id = ? AND file_id = ?`)
      .run(repositoryId, sourceFileId);
    return { edgesRemoved };
  }
}
