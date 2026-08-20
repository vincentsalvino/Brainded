import type { RetrievalStore, RetrievalQuery, Candidate, MemoryRecord } from "@brain/contracts";
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

/**
 * In-memory RetrievalStore for unit-testing packages/core/retrieval without a real
 * SQLite/FTS5/sqlite-vec instance. Scoring is a simple word-overlap heuristic, not a
 * stand-in for real BM25 or vector similarity -- it exists to exercise
 * candidate-shape and degradation logic, not to validate ranking quality.
 */
export class FakeRetrievalStore implements RetrievalStore {
  private readonly records: MemoryRecord[] = [];
  private semanticShouldFail = false;

  constructor(initial: MemoryRecord[] = []) {
    this.records.push(...initial);
  }

  index(record: MemoryRecord): void {
    this.records.push(record);
  }

  /** Lets a test simulate the vector backend being unavailable (P1-008 degradation test). */
  simulateSemanticFailure(shouldFail: boolean): void {
    this.semanticShouldFail = shouldFail;
  }

  private matching(query: RetrievalQuery): MemoryRecord[] {
    return this.records.filter((record) => {
      if (!scopeIncludes(record.scope, query.scope)) return false;
      if (query.filters?.type && record.type !== query.filters.type) return false;
      if (query.filters?.domain && record.domain !== query.filters.domain) return false;
      if (query.filters?.tags && !query.filters.tags.every((tag) => record.tags.includes(tag))) return false;
      return true;
    });
  }

  async lexicalSearch(query: RetrievalQuery): Promise<Candidate[]> {
    const terms = termsOf(query.text);
    const selected = this.matching(query)
      .map((record) => ({ record, raw: wordOverlap(record.content, terms) }))
      .filter((c) => c.raw > 0)
      .sort((a, b) => b.raw - a.raw)
      .slice(0, query.limit);

    // Same normalization contract as SqliteRetrievalStore (P2-002). The zero-overlap
    // filter runs on the RAW score, before normalization -- it is candidate
    // generation ("did this match at all"), not scoring. Normalizing first would
    // let the weakest surviving candidate be filtered out by its own normalized 0.
    const scores = normalizeScores(selected.map((s) => s.raw));
    return selected.map(({ record }, index): Candidate => ({
      memoryId: record.id,
      record,
      signals: { lexicalScore: scores[index] as number },
    }));
  }

  async semanticSearch(query: RetrievalQuery): Promise<Candidate[]> {
    if (this.semanticShouldFail) {
      throw new Error("simulated semantic backend failure");
    }
    const terms = termsOf(query.text);
    const selected = this.matching(query)
      .map((record) => ({ record, raw: wordOverlap(record.content, terms) }))
      .sort((a, b) => b.raw - a.raw)
      .slice(0, query.limit);

    const scores = normalizeScores(selected.map((s) => s.raw));
    return selected.map(({ record }, index): Candidate => ({
      memoryId: record.id,
      record,
      signals: { semanticScore: scores[index] as number },
    }));
  }
}
