import type { CodebaseRepository, CodeDependencyStore } from "@brain/contracts";

export interface DependencyRef {
  fileId: string;
  relativePath: string;
}

export interface ImpactRef extends DependencyRef {
  depth: number;
}

function dedupeSorted(refs: DependencyRef[]): DependencyRef[] {
  const byId = new Map(refs.map((r) => [r.fileId, r]));
  return [...byId.values()].sort((a, b) => a.relativePath.localeCompare(b.relativePath));
}

/**
 * Read-only graph queries over dependency edges -- separate from
 * DependencySynchronizer (write/sync). Wraps CodeDependencyStore's raw (any-
 * resolution) edge access and applies graph semantics: `dependenciesOf` filters to
 * resolution==='internal' (a file's external/unresolved imports are real store
 * data but not graph edges); `dependentsOf` needs no such filter -- an edge can only
 * be found by target_file_id equality if it has one, which the schema's own CHECK
 * constraint guarantees means resolution==='internal' already (see migration
 * 0005) -- filtering again here would be validating something that cannot happen.
 * `impactOf` is reverse BFS. See PHASE_3_SPEC.md Phase 3.3, Graph Service.
 */
export class DependencyGraphService {
  constructor(
    private readonly codebase: CodebaseRepository,
    private readonly store: CodeDependencyStore,
  ) {}

  private async relativePathByFileId(repositoryId: string): Promise<Map<string, string>> {
    const files = await this.codebase.listFiles(repositoryId);
    return new Map(files.map((f) => [f.id, f.relativePath]));
  }

  async dependenciesOf(repositoryId: string, fileId: string): Promise<DependencyRef[]> {
    const [edges, paths] = await Promise.all([
      this.store.dependenciesOf(repositoryId, fileId),
      this.relativePathByFileId(repositoryId),
    ]);
    const refs: DependencyRef[] = [];
    for (const edge of edges) {
      if (edge.resolution !== "internal" || !edge.targetFileId) continue;
      const relativePath = paths.get(edge.targetFileId);
      if (!relativePath) continue;
      refs.push({ fileId: edge.targetFileId, relativePath });
    }
    return dedupeSorted(refs);
  }

  async dependentsOf(repositoryId: string, fileId: string): Promise<DependencyRef[]> {
    const [edges, paths] = await Promise.all([
      this.store.dependentsOf(repositoryId, fileId),
      this.relativePathByFileId(repositoryId),
    ]);
    const refs: DependencyRef[] = [];
    for (const edge of edges) {
      const relativePath = paths.get(edge.sourceFileId);
      if (!relativePath) continue;
      refs.push({ fileId: edge.sourceFileId, relativePath });
    }
    return dedupeSorted(refs);
  }

  /**
   * Reverse BFS: "transitively depends on this file" -- deliberately not "will
   * break" (PHASE_3_SPEC.md Impact Traversal). The origin fileId is pre-marked
   * visited before the walk starts: this single mechanism both guarantees cycle
   * termination and excludes the starting node from its own impact set, without a
   * separate self-exclusion check.
   */
  async impactOf(repositoryId: string, fileId: string, options: { maxDepth?: number } = {}): Promise<ImpactRef[]> {
    const paths = await this.relativePathByFileId(repositoryId);
    const visited = new Set<string>([fileId]);
    const result: ImpactRef[] = [];

    let frontier = [fileId];
    let depth = 0;
    while (frontier.length > 0 && (options.maxDepth === undefined || depth < options.maxDepth)) {
      depth++;
      const next: string[] = [];
      for (const current of frontier) {
        const edges = await this.store.dependentsOf(repositoryId, current);
        for (const edge of edges) {
          if (visited.has(edge.sourceFileId)) continue;
          visited.add(edge.sourceFileId);
          const relativePath = paths.get(edge.sourceFileId);
          if (!relativePath) continue;
          result.push({ fileId: edge.sourceFileId, relativePath, depth });
          next.push(edge.sourceFileId);
        }
      }
      frontier = next;
    }

    return result.sort((a, b) => a.depth - b.depth || a.relativePath.localeCompare(b.relativePath));
  }
}
