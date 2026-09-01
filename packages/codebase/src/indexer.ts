import { readFile } from "node:fs/promises";
import type { CodebaseRepository, CodeChunkRecord, CodeFileRecord, ScopeRef } from "@brain/contracts";
import { discoverFiles } from "./discovery.js";
import { loadIgnoreMatcher } from "./ignore.js";
import { isBinaryContent, detectLanguage } from "./classify.js";
import { hashContent, deriveFileId, deriveChunkId } from "./hash.js";
import { chunkContent, DEFAULT_CHUNK_POLICY, type ChunkPolicy } from "./chunker.js";

export interface IndexOptions {
  scope: ScopeRef;
  rootPath: string;
  extraIgnorePatterns?: string[];
  chunkPolicy?: ChunkPolicy;
}

export interface IndexResult {
  repositoryId: string;
  filesDiscovered: number;
  filesIndexed: number;
  filesUnchanged: number;
  filesUpdated: number;
  filesRemoved: number;
  filesSkipped: number;
  chunksCreated: number;
  chunksRemoved: number;
  durationMs: number;
  skipped: { relativePath: string; reason: string }[];
}

/**
 * Orchestrates discovery -> classification -> hashing -> chunking -> persistence.
 * Holds no SQL and no filesystem-unsafe path handling of its own -- those are
 * discovery.ts's job; this class only sequences the pipeline and owns the
 * incremental-diff decision (unchanged / updated / new / removed) plus per-file
 * failure isolation. See PHASE_3_SPEC.md's Indexer Contract for field semantics.
 */
export class CodebaseIndexer {
  constructor(private readonly repository: CodebaseRepository) {}

  async indexRepository(options: IndexOptions): Promise<IndexResult> {
    const start = performance.now();
    const chunkPolicy = options.chunkPolicy ?? DEFAULT_CHUNK_POLICY;

    const record =
      (await this.repository.findRepository(options.scope, options.rootPath)) ??
      (await this.repository.createRepository(options.scope, options.rootPath));

    const isIgnored = await loadIgnoreMatcher(options.rootPath, options.extraIgnorePatterns ?? []);
    const discovered = await discoverFiles(options.rootPath, isIgnored);
    const discoveredPaths = new Set(discovered.map((d) => d.relativePath));

    const existing = await this.repository.listFiles(record.id);
    const existingByPath = new Map(existing.map((f) => [f.relativePath, f]));

    const result: IndexResult = {
      repositoryId: record.id,
      filesDiscovered: discovered.length,
      filesIndexed: 0,
      filesUnchanged: 0,
      filesUpdated: 0,
      filesRemoved: 0,
      filesSkipped: 0,
      chunksCreated: 0,
      chunksRemoved: 0,
      durationMs: 0,
      skipped: [],
    };

    for (const entry of discovered) {
      const prior = existingByPath.get(entry.relativePath);
      try {
        const buffer = await readFile(entry.absolutePath);
        if (isBinaryContent(buffer)) {
          result.filesSkipped++;
          result.skipped.push({ relativePath: entry.relativePath, reason: "binary" });
          continue;
        }

        const content = buffer.toString("utf-8");
        const contentHash = hashContent(content);
        if (prior && prior.contentHash === contentHash) {
          result.filesUnchanged++;
          continue;
        }

        const fileId = deriveFileId(record.id, entry.relativePath);
        const spans = chunkContent(content, chunkPolicy);
        const file: CodeFileRecord = {
          id: fileId,
          repositoryId: record.id,
          scope: options.scope,
          relativePath: entry.relativePath,
          language: detectLanguage(entry.relativePath),
          sizeBytes: entry.sizeBytes,
          contentHash,
          indexedAt: new Date().toISOString(),
        };
        const chunks: CodeChunkRecord[] = spans.map((span) => ({
          id: deriveChunkId(fileId, span.chunkIndex),
          fileId,
          repositoryId: record.id,
          scope: options.scope,
          relativePath: entry.relativePath,
          chunkIndex: span.chunkIndex,
          startLine: span.startLine,
          endLine: span.endLine,
          content: span.content,
          contentHash: hashContent(span.content),
        }));

        const { chunksCreated, chunksRemoved } = await this.repository.replaceFile(file, chunks);
        result.chunksCreated += chunksCreated;
        result.chunksRemoved += chunksRemoved;
        if (prior) result.filesUpdated++;
        else result.filesIndexed++;
      } catch (error) {
        // One file's failure never aborts the run, and never touches its
        // previously-stored row -- so it is retried automatically next run (same
        // discipline as packages/knowledge's per-file ImportFailure handling).
        result.filesSkipped++;
        result.skipped.push({ relativePath: entry.relativePath, reason: String(error) });
      }
    }

    for (const [relativePath, fileRecord] of existingByPath) {
      if (discoveredPaths.has(relativePath)) continue;
      const { chunksRemoved } = await this.repository.removeFile(fileRecord.id);
      result.chunksRemoved += chunksRemoved;
      result.filesRemoved++;
    }

    await this.repository.markIndexed(record.id);
    result.durationMs = performance.now() - start;
    return result;
  }
}
