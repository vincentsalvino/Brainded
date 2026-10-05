import {
  openDatabase,
  appliedMigrations,
  SqliteMemoryRepository,
  SqliteEventStore,
  SqliteRetrievalStore,
  SqliteMemoryPerformanceStore,
  LocalEmbeddingProvider,
} from "@brain/storage";
import { VisualizerQueryService } from "./query-service.js";

/**
 * The ONE file in packages/visualizer allowed to import @brain/storage (mirrors
 * packages/mcp/src/bootstrap.ts's exact role -- see boundaries.test.ts, which
 * enforces this mechanically). Opens the DB READONLY: this process must never be
 * able to write to the Brain's database, structurally, not just by convention.
 */
export interface VisualizerBrain {
  queryService: VisualizerQueryService;
  close(): void;
}

export function createVisualizerBrain(dbPath: string): VisualizerBrain {
  const db = openDatabase(dbPath, { readonly: true });
  // Cheap/lazy construction (the embedding model loads only on .embed(), which no
  // query-service path ever calls) -- matches packages/mcp/src/bootstrap.ts.
  const embeddings = new LocalEmbeddingProvider();
  const memoryRepository = new SqliteMemoryRepository(db.raw, embeddings);
  const eventStore = new SqliteEventStore(db.raw);
  const retrievalStore = new SqliteRetrievalStore(db.raw, embeddings, db.vectorSearchAvailable);
  const performanceStore = new SqliteMemoryPerformanceStore(db.raw);

  const queryService = new VisualizerQueryService(memoryRepository, eventStore, retrievalStore, performanceStore, {
    vectorSearchAvailable: db.vectorSearchAvailable,
    appliedMigrations: appliedMigrations(db.raw),
  });

  return { queryService, close: () => db.close() };
}
