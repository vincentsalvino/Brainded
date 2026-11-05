import { openDatabase } from "@brain/storage";
import { SqliteMemoryRepository } from "@brain/storage";
import { DEFAULT_MEMORY_RELEVANCE, SqliteRetrievalStore } from "@brain/storage";
import { SqliteEventStore } from "@brain/storage";
import { SqliteMemoryPerformanceStore } from "@brain/storage";
import { LocalEmbeddingProvider } from "@brain/storage";
import { SqliteCodeSearchStore } from "@brain/storage";
import { SqliteCodeDependencyStore } from "@brain/storage";
import { SqliteCodebaseRepository } from "@brain/storage";
import { MemoryService } from "@brain/memory";
import { RetrievalService, DEFAULT_NEAR_DUPLICATE_POLICY } from "@brain/retrieval";
import { CodeRetrievalService } from "@brain/retrieval";
import { EventService, LearningSignalService } from "@brain/learning";
import { DEFAULT_LEARNING_CONFIG } from "@brain/contracts";
import { DependencyGraphService } from "@brain/codebase";
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

export function createBrain(dbPath: string, options: { localFilesOnly?: boolean; cacheDir?: string } = {}): Brain {
  const db = openDatabase(dbPath);
  const embeddings = new LocalEmbeddingProvider(options);

  const memoryRepository = new SqliteMemoryRepository(db.raw, embeddings);
  const retrievalStore = new SqliteRetrievalStore(db.raw, embeddings, db.vectorSearchAvailable, DEFAULT_MEMORY_RELEVANCE);
  const eventStore = new SqliteEventStore(db.raw);
  const codebaseRepository = new SqliteCodebaseRepository(db.raw);
  const codeSearchStore = new SqliteCodeSearchStore(db.raw, embeddings, db.vectorSearchAvailable);
  const codeDependencyStore = new SqliteCodeDependencyStore(db.raw);
  const performanceStore = new SqliteMemoryPerformanceStore(db.raw);

  const gateway = new Gateway(
    new MemoryService(memoryRepository),
    new RetrievalService(retrievalStore),
    new EventService(eventStore),
    { vectorSearchAvailable: db.vectorSearchAvailable },
    // 2C/2C.7: machinery in place, disabled pending live-pilot evidence strong
    // enough to justify a default-enable decision (docs/archive/phase-2c/PHASE_2C7_REPORT.md).
    { enabled: false, ...DEFAULT_NEAR_DUPLICATE_POLICY },
    new CodeRetrievalService(codeSearchStore),
    new DependencyGraphService(codebaseRepository, codeDependencyStore),
    // Phase 4.2 (F10): machinery wired end to end, DEFAULT_LEARNING_CONFIG.enabled
    // stays false -- the default-enable decision belongs to Phase 4.3
    // (docs/archive/phase-4/PHASE_4_DECISIONS.md F14/F15), same discipline as redundancy above.
    new LearningSignalService(performanceStore, DEFAULT_LEARNING_CONFIG),
  );

  return { gateway, close: () => db.close() };
}
