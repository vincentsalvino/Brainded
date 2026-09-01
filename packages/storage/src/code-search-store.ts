import type Database from "better-sqlite3";
import {
  type CodeSearchStore,
  type CodeSearchQuery,
  type CodeSearchResult,
  type CodeSyncResult,
  type ScopeRef,
  type EmbeddingProvider,
  CodeSearchQuerySchema,
  normalizeScores,
} from "@brain/contracts";

interface ChunkRow {
  chunk_id: string;
  file_id: string;
  repository_id: string;
  scope_kind: string;
  scope_id: string | null;
  relative_path: string;
  language: string | null;
  start_line: number;
  end_line: number;
  content: string;
}

function rowToResult(row: ChunkRow): Omit<CodeSearchResult, "signals"> {
  return {
    chunkId: row.chunk_id,
    fileId: row.file_id,
    repositoryId: row.repository_id,
    scope: { kind: row.scope_kind as ScopeRef["kind"], id: row.scope_id },
    relativePath: row.relative_path,
    language: row.language,
    startLine: row.start_line,
    endLine: row.end_line,
    content: row.content,
  };
}

// Same canonical scope-isolation predicate as retrieval-store.ts/memory-repository.ts,
// prefixed `c.` because every query here joins code_chunks (c) to code_files (f) --
// scope_kind/scope_id are denormalized onto code_chunks directly (migration 0003),
// so this never needs to touch f. Duplicated rather than shared for the same reason
// those two copies are: no shared SQL-fragment module exists yet.
function scopeWhere(scope: ScopeRef): { clause: string; params: unknown[] } {
  if (scope.kind === "global") {
    return { clause: "c.scope_kind = 'global'", params: [] };
  }
  return {
    clause: "(c.scope_kind = 'global' OR (c.scope_kind = ? AND c.scope_id = ?))",
    params: [scope.kind, scope.id],
  };
}

function buildFtsQuery(text: string): string {
  const terms = text
    .split(/\s+/)
    .map((t) => t.replace(/"/g, '""'))
    .filter((t) => t.length > 0);
  return terms.length === 0 ? '""' : terms.map((t) => `"${t}"`).join(" OR ");
}

/**
 * SQLite-backed CodeSearchStore: FTS5 for lexicalSearch, sqlite-vec for
 * semanticSearch, plus syncEmbeddings (see PHASE_3_SPEC.md Phase 3.2, Search-Index
 * Synchronization). Mirrors SqliteRetrievalStore's shape and degradation policy
 * (semantic failure throws for the caller to catch, never silently swallowed here).
 */
export class SqliteCodeSearchStore implements CodeSearchStore {
  constructor(
    private readonly db: Database.Database,
    private readonly embeddings: EmbeddingProvider,
    private readonly vectorSearchAvailable: boolean = true,
  ) {}

  // `language` lives on code_files, not code_chunks (migration 0003) -- every query
  // here joins `code_chunks c` to `code_files f ON f.id = c.file_id` so these
  // clauses can reference either.
  private whereClauses(query: CodeSearchQuery): { clause: string; params: unknown[] } {
    const where = scopeWhere(query.scope);
    const clauses = [where.clause];
    const params: unknown[] = [...where.params];
    if (query.filters?.repositoryId) {
      clauses.push("c.repository_id = ?");
      params.push(query.filters.repositoryId);
    }
    if (query.filters?.language) {
      clauses.push("f.language = ?");
      params.push(query.filters.language);
    }
    if (query.filters?.pathPrefix) {
      // Exact-prefix via substr, not LIKE -- no wildcard-escaping concerns for a
      // path string that may legitimately contain '%' or '_'.
      clauses.push("substr(c.relative_path, 1, ?) = ?");
      params.push(query.filters.pathPrefix.length, query.filters.pathPrefix);
    }
    return { clause: clauses.join(" AND "), params };
  }

  async lexicalSearch(rawQuery: CodeSearchQuery): Promise<CodeSearchResult[]> {
    const query = CodeSearchQuerySchema.parse(rawQuery);
    const ftsQuery = buildFtsQuery(query.text);
    const where = this.whereClauses(query);
    const rows = this.db
      .prepare(
        `SELECT c.id AS chunk_id, c.file_id, c.repository_id, c.scope_kind, c.scope_id,
                c.relative_path, f.language, c.start_line, c.end_line, c.content,
                code_chunks_fts.rank AS fts_rank
         FROM code_chunks_fts
         JOIN code_chunks c ON c.rowid = code_chunks_fts.rowid
         JOIN code_files f ON f.id = c.file_id
         WHERE code_chunks_fts MATCH ? AND ${where.clause}
         ORDER BY code_chunks_fts.rank
         LIMIT ?`,
      )
      .all(ftsQuery, ...where.params, query.limit * 3) as (ChunkRow & { fts_rank: number })[];

    // Same bm25-orientation fix as SqliteRetrievalStore.lexicalSearch: FTS5's `rank`
    // is negative, more-negative-is-better. Negate before normalizing. See
    // code-search-store.test.ts's explicit regression test for this.
    const selected = rows.slice(0, query.limit).map((row) => ({ result: rowToResult(row), raw: -row.fts_rank }));
    const scores = normalizeScores(selected.map((s) => s.raw));
    return selected.map(({ result }, index): CodeSearchResult => ({
      ...result,
      signals: { lexicalScore: scores[index] as number },
    }));
  }

  async semanticSearch(rawQuery: CodeSearchQuery): Promise<CodeSearchResult[]> {
    if (!this.vectorSearchAvailable) {
      throw new Error("vector search unavailable: sqlite-vec failed to load on this platform");
    }
    const query = CodeSearchQuerySchema.parse(rawQuery);
    const queryVector = await this.embeddings.embed(query.text);
    const overFetch = Math.max(query.limit * 5, 50);

    const knnRows = this.db
      .prepare(`SELECT chunk_id, distance FROM code_chunk_vectors WHERE embedding MATCH ? AND k = ? ORDER BY distance`)
      .all(JSON.stringify(queryVector), overFetch) as { chunk_id: string; distance: number }[];
    if (knnRows.length === 0) return [];

    const where = this.whereClauses(query);
    const placeholders = knnRows.map(() => "?").join(",");
    const rows = this.db
      .prepare(
        `SELECT c.id AS chunk_id, c.file_id, c.repository_id, c.scope_kind, c.scope_id,
                c.relative_path, f.language, c.start_line, c.end_line, c.content
         FROM code_chunks c
         JOIN code_files f ON f.id = c.file_id
         WHERE c.id IN (${placeholders}) AND ${where.clause}`,
      )
      .all(...knnRows.map((r) => r.chunk_id), ...where.params) as ChunkRow[];
    const byId = new Map(rows.map((r) => [r.chunk_id, rowToResult(r)]));

    // Nearer is better, so negate distance before normalizing -- same contract as
    // SqliteRetrievalStore.semanticSearch.
    const selected: { result: Omit<CodeSearchResult, "signals">; raw: number }[] = [];
    for (const knn of knnRows) {
      const result = byId.get(knn.chunk_id);
      if (!result) continue;
      selected.push({ result, raw: -knn.distance });
      if (selected.length >= query.limit) break;
    }

    const scores = normalizeScores(selected.map((s) => s.raw));
    return selected.map(({ result }, index): CodeSearchResult => ({
      ...result,
      signals: { semanticScore: scores[index] as number },
    }));
  }

  /**
   * Incremental sync: reads current (chunkId, contentHash) from code_chunks and
   * previously-tracked (chunkId, contentHash) from code_embedding_state (both plain
   * SQL, same connection) -- no chunks need to be passed in. A tracked id absent
   * from current chunks is removed from both code_chunk_vectors and
   * code_embedding_state; a current chunk whose hash still matches its tracked hash
   * is skipped (zero embedding calls); everything else is (re)embedded. One chunk's
   * embedding failure is caught, logged, and does not abort the run -- same
   * discipline as SqliteMemoryRepository.indexVector.
   */
  async syncEmbeddings(repositoryId: string): Promise<CodeSyncResult> {
    if (!this.vectorSearchAvailable) {
      return { chunksEmbedded: 0, chunksUnchanged: 0, chunksRemoved: 0, available: false };
    }

    const current = this.db
      .prepare(`SELECT id AS chunk_id, content, content_hash FROM code_chunks WHERE repository_id = ?`)
      .all(repositoryId) as { chunk_id: string; content: string; content_hash: string }[];
    const currentById = new Map(current.map((c) => [c.chunk_id, c]));

    const tracked = this.db
      .prepare(`SELECT chunk_id, content_hash FROM code_embedding_state WHERE repository_id = ?`)
      .all(repositoryId) as { chunk_id: string; content_hash: string }[];

    let chunksRemoved = 0;
    const deleteVector = this.db.prepare(`DELETE FROM code_chunk_vectors WHERE chunk_id = ?`);
    const deleteState = this.db.prepare(`DELETE FROM code_embedding_state WHERE chunk_id = ?`);
    for (const row of tracked) {
      if (!currentById.has(row.chunk_id)) {
        deleteVector.run(row.chunk_id);
        deleteState.run(row.chunk_id);
        chunksRemoved++;
      }
    }

    const trackedById = new Map(tracked.map((t) => [t.chunk_id, t.content_hash]));
    const upsertState = this.db.prepare(
      `INSERT INTO code_embedding_state (chunk_id, repository_id, content_hash, embedded_at)
       VALUES (?,?,?,?)
       ON CONFLICT(chunk_id) DO UPDATE SET content_hash = excluded.content_hash, embedded_at = excluded.embedded_at`,
    );
    // vec0 virtual tables don't support ON CONFLICT upsert (same reason
    // SqliteMemoryRepository.indexVector uses an explicit select-then-branch instead
    // of a single upsert statement) -- mirrored here, not simplified away.
    const vectorExists = this.db.prepare(`SELECT 1 FROM code_chunk_vectors WHERE chunk_id = ?`);
    const insertVector = this.db.prepare(`INSERT INTO code_chunk_vectors (chunk_id, embedding) VALUES (?, ?)`);
    const updateVector = this.db.prepare(`UPDATE code_chunk_vectors SET embedding = ? WHERE chunk_id = ?`);

    let chunksEmbedded = 0;
    let chunksUnchanged = 0;
    for (const chunk of current) {
      if (trackedById.get(chunk.chunk_id) === chunk.content_hash) {
        chunksUnchanged++;
        continue;
      }
      try {
        const vector = await this.embeddings.embed(chunk.content);
        const json = JSON.stringify(vector);
        if (vectorExists.get(chunk.chunk_id)) {
          updateVector.run(json, chunk.chunk_id);
        } else {
          insertVector.run(chunk.chunk_id, json);
        }
        upsertState.run(chunk.chunk_id, repositoryId, chunk.content_hash, new Date().toISOString());
        chunksEmbedded++;
      } catch (error) {
        console.error(`chunk ${chunk.chunk_id}: embedding index failed, will be lexical-only until re-synced:`, error);
      }
    }

    return { chunksEmbedded, chunksUnchanged, chunksRemoved, available: true };
  }
}
