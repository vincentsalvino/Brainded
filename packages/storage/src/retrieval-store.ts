import type Database from "better-sqlite3";
import {
  type RetrievalStore,
  type RetrievalQuery,
  type Candidate,
  type MemoryRecord,
  type ScopeRef,
  type EmbeddingProvider,
  type SimilarityPair,
  RetrievalQuerySchema,
  normalizeScores,
  sortSimilarityPairs,
} from "@brain/contracts";

interface MemoryRow {
  id: string;
  type: string;
  content: string;
  domain: string | null;
  scope_kind: string;
  scope_id: string | null;
  source_origin: string;
  source_agent_id: string | null;
  source_session_id: string | null;
  source_task_id: string | null;
  source_ref: string | null;
  confidence: number;
  status: string;
  tags: string;
  supersedes: string | null;
  created_at: string;
  updated_at: string;
}

function rowToRecord(row: MemoryRow): MemoryRecord {
  return {
    id: row.id,
    type: row.type as MemoryRecord["type"],
    content: row.content,
    domain: row.domain,
    scope: { kind: row.scope_kind as ScopeRef["kind"], id: row.scope_id },
    source: {
      origin: row.source_origin as MemoryRecord["source"]["origin"],
      ...(row.source_agent_id !== null ? { agentId: row.source_agent_id } : {}),
      ...(row.source_session_id !== null ? { sessionId: row.source_session_id } : {}),
      ...(row.source_task_id !== null ? { taskId: row.source_task_id } : {}),
      ...(row.source_ref !== null ? { sourceRef: row.source_ref } : {}),
    },
    confidence: row.confidence,
    status: row.status as MemoryRecord["status"],
    tags: JSON.parse(row.tags) as string[],
    supersedes: row.supersedes,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

// Same canonical scope-isolation predicate as memory-repository.ts (and scopeIncludes
// in @brain/contracts). Duplicated rather than shared as a compiled SQL fragment is
// awkward to import cleanly across two files without a bigger shared-SQL-utils
// module; both copies are exercised by the same cross-file scope test suite.
function scopeWhere(scope: ScopeRef): { clause: string; params: unknown[] } {
  if (scope.kind === "global") {
    return { clause: "scope_kind = 'global'", params: [] };
  }
  return {
    clause: "(scope_kind = 'global' OR (scope_kind = ? AND scope_id = ?))",
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
 * SQLite-backed RetrievalStore: FTS5 for lexicalSearch, sqlite-vec for
 * semanticSearch. Neither method catches its own failures -- degradation policy
 * (e.g. "vector search failed, fall back to lexical only") belongs to the caller
 * (packages/core/retrieval), matching FakeRetrievalStore's behavior in
 * @brain/test-fixtures so both are exercised by the same degradation tests.
 */
export class SqliteRetrievalStore implements RetrievalStore {
  constructor(
    private readonly db: Database.Database,
    private readonly embeddings: EmbeddingProvider,
    private readonly vectorSearchAvailable: boolean = true,
  ) {}

  private whereClauses(query: RetrievalQuery): { clause: string; params: unknown[] } {
    const where = scopeWhere(query.scope);
    const clauses = [where.clause];
    const params: unknown[] = [...where.params];
    if (query.filters?.type) {
      clauses.push("type = ?");
      params.push(query.filters.type);
    }
    if (query.filters?.domain) {
      clauses.push("domain = ?");
      params.push(query.filters.domain);
    }
    return { clause: clauses.join(" AND "), params };
  }

  private matchesTags(record: MemoryRecord, query: RetrievalQuery): boolean {
    if (!query.filters?.tags) return true;
    return query.filters.tags.every((tag) => record.tags.includes(tag));
  }

  async lexicalSearch(rawQuery: RetrievalQuery): Promise<Candidate[]> {
    const query = RetrievalQuerySchema.parse(rawQuery);
    const ftsQuery = buildFtsQuery(query.text);
    const where = this.whereClauses(query);
    const rows = this.db
      .prepare(
        `SELECT m.*, memories_fts.rank AS fts_rank
         FROM memories_fts
         JOIN memories m ON m.rowid = memories_fts.rowid
         WHERE memories_fts MATCH ? AND ${where.clause}
         ORDER BY memories_fts.rank
         LIMIT ?`,
      )
      .all(ftsQuery, ...where.params, query.limit * 3) as (MemoryRow & { fts_rank: number })[];

    // FTS5's `rank` is bm25(): NEGATIVE, and more negative means a better match.
    // Negating it makes the raw score increase with match quality; normalizeScores
    // then bounds the set to [0,1]. The pre-P2-002 code used
    // `1 / (1 + Math.abs(rank))`, which is monotonically DECREASING in match
    // quality -- the best BM25 hit received the lowest score, and ranking then
    // re-sorted the correct candidate order into a wrong one
    // (PHASE_2_FINDINGS.md 3.2).
    const selected: { record: MemoryRecord; raw: number }[] = [];
    for (const row of rows) {
      const record = rowToRecord(row);
      if (!this.matchesTags(record, query)) continue;
      selected.push({ record, raw: -row.fts_rank });
      if (selected.length >= query.limit) break;
    }

    const scores = normalizeScores(selected.map((s) => s.raw));
    return selected.map(({ record }, index): Candidate => ({
      memoryId: record.id,
      record,
      signals: { lexicalScore: scores[index] as number },
    }));
  }

  async semanticSearch(rawQuery: RetrievalQuery): Promise<Candidate[]> {
    if (!this.vectorSearchAvailable) {
      throw new Error("vector search unavailable: sqlite-vec failed to load on this platform");
    }
    const query = RetrievalQuerySchema.parse(rawQuery);
    const queryVector = await this.embeddings.embed(query.text);
    const overFetch = Math.max(query.limit * 5, 50);

    const knnRows = this.db
      .prepare(`SELECT memory_id, distance FROM memory_vectors WHERE embedding MATCH ? AND k = ? ORDER BY distance`)
      .all(JSON.stringify(queryVector), overFetch) as { memory_id: string; distance: number }[];
    if (knnRows.length === 0) return [];

    const where = this.whereClauses(query);
    const placeholders = knnRows.map(() => "?").join(",");
    const rows = this.db
      .prepare(`SELECT * FROM memories WHERE id IN (${placeholders}) AND ${where.clause}`)
      .all(...knnRows.map((r) => r.memory_id), ...where.params) as MemoryRow[];
    const byId = new Map(rows.map((r) => [r.id, rowToRecord(r)]));

    // Nearer is better, so negate distance before normalizing -- same contract as
    // lexicalSearch above. The pre-P2-002 `1 / (1 + distance)` was correctly
    // *directed* but occupied [0.333, 1] for L2-normalized embeddings, with a
    // realized spread of only 0.121 on the live corpus against lexical's 0.709.
    // That made the declared ranking weights describe roughly a 7.4:1 influence
    // ratio rather than the stated 0.5/0.4 (PHASE_2_FINDINGS.md 3.3).
    const selected: { record: MemoryRecord; raw: number }[] = [];
    for (const knn of knnRows) {
      const record = byId.get(knn.memory_id);
      if (!record || !this.matchesTags(record, query)) continue;
      selected.push({ record, raw: -knn.distance });
      if (selected.length >= query.limit) break;
    }

    const scores = normalizeScores(selected.map((s) => s.raw));
    return selected.map(({ record }, index): Candidate => ({
      memoryId: record.id,
      record,
      signals: { semanticScore: scores[index] as number },
    }));
  }

  /**
   * E25. Vectors never leave this method: the query computes cosine distance
   * natively in SQLite via sqlite-vec and only scalar {a,b,similarity} triples
   * cross back into JS. `memory_vectors` has no row for a memory whose
   * embedding failed to index (see memory-repository.ts's indexVector) -- the
   * inner join simply excludes it, which is the correct degradation (no
   * similarity data means no pair, not an error).
   */
  async findSimilarPairs(memoryIds: string[], minSimilarity: number): Promise<SimilarityPair[]> {
    const uniqueIds = [...new Set(memoryIds)];
    if (!this.vectorSearchAvailable || uniqueIds.length < 2) return [];

    const placeholders = uniqueIds.map(() => "?").join(",");
    const rows = this.db
      .prepare(
        `SELECT x.memory_id AS a, y.memory_id AS b, vec_distance_cosine(x.embedding, y.embedding) AS distance
         FROM memory_vectors x
         JOIN memory_vectors y ON x.memory_id < y.memory_id
         WHERE x.memory_id IN (${placeholders}) AND y.memory_id IN (${placeholders})`,
      )
      .all(...uniqueIds, ...uniqueIds) as { a: string; b: string; distance: number }[];

    const pairs: SimilarityPair[] = rows
      .map((r) => ({ a: r.a, b: r.b, similarity: 1 - r.distance }))
      .filter((p) => p.similarity >= minSimilarity);
    return sortSimilarityPairs(pairs);
  }
}
