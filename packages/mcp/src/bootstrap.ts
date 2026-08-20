import { openDatabase } from "@brain/storage";
import { SqliteMemoryRepository } from "@brain/storage";
import { SqliteRetrievalStore } from "@brain/storage";
import { SqliteEventStore } from "@brain/storage";
import { LocalEmbeddingProvider } from "@brain/storage";
import { MemoryService } from "@brain/memory";
import { RetrievalService } from "@brain/retrieval";
import { EventService } from "@brain/learning";
import { Gateway } from "@brain/gateway";

/**
 * The ONE file in this repository allowed to import both a concrete
 * packages/storage implementation and a packages/core service constructor
 * (PHASE_1_SPEC.md Package Architecture: "composition root"). Every other file
 * in packages/mcp imports @brain/gateway only. boundaries.test.ts is the
 * mechanical check that names this file as the sole exception -- it fails the
 * build if any other file in packages/mcp/src imports @brain/storage or a core
 * service package directly.
 */
export interface Brain {
  gateway: Gateway;
  close(): void;
}

export function createBrain(dbPath: string): Brain {
  const db = openDatabase(dbPath);
  const embeddings = new LocalEmbeddingProvider();

  const memoryRepository = new SqliteMemoryRepository(db.raw, embeddings);
  const retrievalStore = new SqliteRetrievalStore(db.raw, embeddings, db.vectorSearchAvailable);
  const eventStore = new SqliteEventStore(db.raw);

  const gateway = new Gateway(
    new MemoryService(memoryRepository),
    new RetrievalService(retrievalStore),
    new EventService(eventStore),
    { vectorSearchAvailable: db.vectorSearchAvailable },
  );

  return { gateway, close: () => db.close() };
}
