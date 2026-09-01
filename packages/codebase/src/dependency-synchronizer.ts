import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type {
  CodebaseRepository,
  CodeDependencyStore,
  CodeDependencyEdge,
  DependencySyncResult,
  ScopeRef,
} from "@brain/contracts";
import { extractDependencies } from "./dependency-extract.js";
import { resolveSpecifier } from "./dependency-resolve.js";
import { deriveEdgeId } from "./hash.js";

const ELIGIBLE_LANGUAGES = new Set(["typescript", "javascript"]);

export interface DependencySyncOptions {
  scope: ScopeRef;
  rootPath: string;
  repositoryId: string;
}

/**
 * Orchestrates dependency extraction/resolution/persistence for one already-indexed
 * repository (run as an explicit second step after CodebaseIndexer.indexRepository,
 * same two-step pattern as 3.2's syncEmbeddings). See PHASE_3_SPEC.md Phase 3.3,
 * Incremental Synchronization / Invalidation for why parsing and resolution are two
 * separably-costed phases, not one.
 *
 * Reads file content from disk (rootPath + relativePath) -- CodeFileRecord carries
 * no content, and reconstructing it from chunks would silently assume zero chunk
 * overlap, which ChunkPolicy does not guarantee (PHASE_3_SPEC.md Part C).
 */
export class DependencySynchronizer {
  constructor(
    private readonly codebase: CodebaseRepository,
    private readonly store: CodeDependencyStore,
  ) {}

  async syncDependencies(options: DependencySyncOptions): Promise<DependencySyncResult> {
    const start = performance.now();
    const files = await this.codebase.listFiles(options.repositoryId);
    const fileIndex = new Map(files.map((f) => [f.relativePath, f.id]));
    const relativePathByFileId = new Map(files.map((f) => [f.id, f.relativePath]));
    const eligibleFiles = files.filter((f) => f.language !== null && ELIGIBLE_LANGUAGES.has(f.language));
    const eligibleIds = new Set(eligibleFiles.map((f) => f.id));

    const result: DependencySyncResult = {
      filesExamined: eligibleFiles.length,
      filesParsed: 0,
      filesUnchanged: 0,
      filesFailed: 0,
      edgesCreated: 0,
      edgesRemoved: 0,
      internalEdges: 0,
      externalEdges: 0,
      unresolvedEdges: 0,
      resolutionsUpdated: 0,
      durationMs: 0,
      failures: [],
    };

    // --- Phase 1: parse (content-hash-gated) ---------------------------------
    const trackedState = await this.store.listDependencyState(options.repositoryId);
    const trackedHashByFileId = new Map(trackedState.map((s) => [s.fileId, s.contentHash]));

    for (const tracked of trackedState) {
      if (!eligibleIds.has(tracked.fileId)) {
        const { edgesRemoved } = await this.store.removeFileState(options.repositoryId, tracked.fileId);
        result.edgesRemoved += edgesRemoved;
      }
    }

    for (const file of eligibleFiles) {
      if (trackedHashByFileId.get(file.id) === file.contentHash) {
        result.filesUnchanged++;
        continue;
      }
      try {
        const content = await readFile(join(options.rootPath, file.relativePath), "utf-8");
        const extracted = extractDependencies({ language: file.language, content });
        const now = new Date().toISOString();
        const edges: CodeDependencyEdge[] = extracted.map((dep) => {
          const resolved = resolveSpecifier({ specifier: dep.specifier, sourceRelativePath: file.relativePath, fileIndex });
          return {
            id: deriveEdgeId(options.repositoryId, file.id, dep.specifier, dep.kind),
            repositoryId: options.repositoryId,
            scope: options.scope,
            sourceFileId: file.id,
            targetFileId: resolved.targetFileId,
            specifier: dep.specifier,
            kind: dep.kind,
            resolution: resolved.resolution,
            sourceLine: dep.sourceLine,
            createdAt: now,
          };
        });

        const { edgesCreated, edgesRemoved } = await this.store.replaceOutgoingEdges(
          options.repositoryId,
          file.id,
          file.contentHash,
          edges,
        );
        result.edgesCreated += edgesCreated;
        result.edgesRemoved += edgesRemoved;
        result.filesParsed++;
      } catch (error) {
        // One file's failure never aborts the run, and never touches its
        // previously-stored edges -- retried automatically next sync, same
        // discipline as CodebaseIndexer's per-file failure isolation.
        result.filesFailed++;
        result.failures.push({ relativePath: file.relativePath, reason: String(error) });
      }
    }

    // --- Phase 2: re-resolve (inventory-gated, every edge, every sync) -------
    // By this point Phase 1 has already removed edges for any source file that is
    // gone/ineligible, so every remaining edge's sourceFileId is present in
    // relativePathByFileId.
    const currentEdges = await this.store.listEdges(options.repositoryId);
    for (const edge of currentEdges) {
      const sourceRelativePath = relativePathByFileId.get(edge.sourceFileId);
      if (!sourceRelativePath) continue;
      const resolved = resolveSpecifier({ specifier: edge.specifier, sourceRelativePath, fileIndex });
      if (resolved.resolution !== edge.resolution || resolved.targetFileId !== edge.targetFileId) {
        await this.store.updateEdgeResolution(edge.id, resolved.resolution, resolved.targetFileId);
        result.resolutionsUpdated++;
      }
    }

    const finalEdges = await this.store.listEdges(options.repositoryId);
    for (const edge of finalEdges) {
      if (edge.resolution === "internal") result.internalEdges++;
      else if (edge.resolution === "external") result.externalEdges++;
      else result.unresolvedEdges++;
    }

    result.durationMs = performance.now() - start;
    return result;
  }
}
