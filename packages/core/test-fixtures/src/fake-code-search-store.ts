import type { CodeSearchStore, CodeSearchQuery, CodeSearchResult, CodeSyncResult, CodeChunkRecord, EmbeddingProvider } from "@brain/contracts";
import { scopeIncludes, normalizeScores } from "@brain/contracts";

function wordOverlap(text: string, terms: string[]): number {
  if (terms.length === 0) return 0;
  const haystack = text.toLowerCase();
  const matched = terms.filter((term) => haystack.includes(term)).length;
  return matched / terms.length;
}

function termsOf(text: string): string[] {
  return text.toLowerCase().split(/\s+/).filter((t) => t.length > 0);
}

function cosineSimilarity(a: number[], b: number[]): number {
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += (a[i] as number) * (b[i] as number);
    normA += (a[i] as number) ** 2;
    normB += (b[i] as number) ** 2;
  }
  const denom = Math.sqrt(normA) * Math.sqrt(normB);
  return denom === 0 ? 0 : dot / denom;
}

function toResult(chunk: CodeChunkRecord, language: string | null): Omit<CodeSearchResult, "signals"> {
  return {
    chunkId: chunk.id,
    fileId: chunk.fileId,
    repositoryId: chunk.repositoryId,
    scope: chunk.scope,
    relativePath: chunk.relativePath,
    language,
    startLine: chunk.startLine,
    endLine: chunk.endLine,
    content: chunk.content,
  };
}

/**
 * In-memory CodeSearchStore for unit-testing packages/core/retrieval without a real
 * SQLite/FTS5/sqlite-vec instance -- mirrors FakeRetrievalStore's role. Unlike
 * FakeRetrievalStore's semanticSearch (which reuses the same word-overlap heuristic
 * as lexical, for simplicity), this fake genuinely calls the injected
 * EmbeddingProvider and computes cosine similarity, so it can exercise real
 * nearest-neighbor and syncEmbeddings behaviour against a deterministic fake model
 * (@brain/test-fixtures' FakeEmbeddingProvider) -- see PHASE_3_SPEC.md's TEST
 * EMBEDDINGS requirement.
 *
 * Deliberately does not model chunk removal (no `remove` method): nothing in this
 * phase's test suite needs it -- the removal side of syncEmbeddings is exercised
 * thoroughly against the real SqliteCodeSearchStore instead. `chunksRemoved` is
 * therefore always 0 here, which is honest for a store nothing ever removes from.
 */
export class FakeCodeSearchStore implements CodeSearchStore {
  private readonly chunks = new Map<string, CodeChunkRecord>();
  private readonly fileLanguage = new Map<string, string | null>();
  private readonly embeddingState = new Map<string, { contentHash: string; vector: number[] }>();
  private semanticShouldFail = false;

  constructor(private readonly embeddings: EmbeddingProvider) {}

  index(chunk: CodeChunkRecord, language: string | null = null): void {
    this.chunks.set(chunk.id, chunk);
    this.fileLanguage.set(chunk.fileId, language);
  }

  /** Lets a test simulate the vector backend being unavailable. */
  simulateSemanticFailure(shouldFail: boolean): void {
    this.semanticShouldFail = shouldFail;
  }

  private matching(query: CodeSearchQuery): CodeChunkRecord[] {
    return [...this.chunks.values()].filter((chunk) => {
      if (!scopeIncludes(chunk.scope, query.scope)) return false;
      if (query.filters?.repositoryId && chunk.repositoryId !== query.filters.repositoryId) return false;
      if (query.filters?.pathPrefix && !chunk.relativePath.startsWith(query.filters.pathPrefix)) return false;
      if (query.filters?.language && this.fileLanguage.get(chunk.fileId) !== query.filters.language) return false;
      return true;
    });
  }

  private toResult(chunk: CodeChunkRecord): Omit<CodeSearchResult, "signals"> {
    return toResult(chunk, this.fileLanguage.get(chunk.fileId) ?? null);
  }

  async lexicalSearch(query: CodeSearchQuery): Promise<CodeSearchResult[]> {
    const terms = termsOf(query.text);
    const selected = this.matching(query)
      .map((chunk) => ({ chunk, raw: wordOverlap(chunk.content, terms) }))
      .filter((c) => c.raw > 0)
      .sort((a, b) => b.raw - a.raw)
      .slice(0, query.limit);

    const scores = normalizeScores(selected.map((s) => s.raw));
    return selected.map(({ chunk }, index): CodeSearchResult => ({
      ...this.toResult(chunk),
      signals: { lexicalScore: scores[index] as number },
    }));
  }

  async semanticSearch(query: CodeSearchQuery): Promise<CodeSearchResult[]> {
    if (this.semanticShouldFail) {
      throw new Error("simulated semantic backend failure");
    }
    const queryVector = await this.embeddings.embed(query.text);
    const selected = this.matching(query)
      .map((chunk) => {
        const state = this.embeddingState.get(chunk.id);
        const raw = state ? cosineSimilarity(queryVector, state.vector) : -Infinity;
        return { chunk, raw };
      })
      .filter((c) => Number.isFinite(c.raw))
      .sort((a, b) => b.raw - a.raw)
      .slice(0, query.limit);

    const scores = normalizeScores(selected.map((s) => s.raw));
    return selected.map(({ chunk }, index): CodeSearchResult => ({
      ...this.toResult(chunk),
      signals: { semanticScore: scores[index] as number },
    }));
  }

  async syncEmbeddings(repositoryId: string): Promise<CodeSyncResult> {
    let chunksEmbedded = 0;
    let chunksUnchanged = 0;
    for (const chunk of this.chunks.values()) {
      if (chunk.repositoryId !== repositoryId) continue;
      const state = this.embeddingState.get(chunk.id);
      if (state && state.contentHash === chunk.contentHash) {
        chunksUnchanged++;
        continue;
      }
      const vector = await this.embeddings.embed(chunk.content);
      this.embeddingState.set(chunk.id, { contentHash: chunk.contentHash, vector });
      chunksEmbedded++;
    }
    return { chunksEmbedded, chunksUnchanged, chunksRemoved: 0, available: true };
  }
}
