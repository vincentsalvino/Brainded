import {
  type CodeDependencyStore,
  type CodeDependencyEdge,
  type DependencyResolution,
} from "@brain/contracts";

/**
 * In-memory CodeDependencyStore for unit-testing packages/codebase's dependency
 * synchronizer/graph service without a real database -- mirrors FakeCodebaseRepository's
 * role. Semantics match SqliteCodeDependencyStore: replaceOutgoingEdges is a
 * repository-and-source-file-scoped delete-then-insert; queries are repositoryId-scoped.
 */
export class FakeCodeDependencyStore implements CodeDependencyStore {
  private readonly edges = new Map<string, CodeDependencyEdge>();
  private readonly state = new Map<string, { repositoryId: string; contentHash: string }>();

  async replaceOutgoingEdges(
    repositoryId: string,
    sourceFileId: string,
    contentHash: string,
    edges: CodeDependencyEdge[],
  ): Promise<{ edgesCreated: number; edgesRemoved: number }> {
    let edgesRemoved = 0;
    for (const [id, edge] of this.edges) {
      if (edge.repositoryId === repositoryId && edge.sourceFileId === sourceFileId) {
        this.edges.delete(id);
        edgesRemoved++;
      }
    }
    for (const edge of edges) {
      this.edges.set(edge.id, edge);
    }
    this.state.set(sourceFileId, { repositoryId, contentHash });
    return { edgesCreated: edges.length, edgesRemoved };
  }

  async listDependencyState(repositoryId: string): Promise<{ fileId: string; contentHash: string }[]> {
    return [...this.state.entries()]
      .filter(([, s]) => s.repositoryId === repositoryId)
      .map(([fileId, s]) => ({ fileId, contentHash: s.contentHash }));
  }

  async listEdges(repositoryId: string): Promise<CodeDependencyEdge[]> {
    return [...this.edges.values()].filter((e) => e.repositoryId === repositoryId);
  }

  async updateEdgeResolution(edgeId: string, resolution: DependencyResolution, targetFileId: string | null): Promise<void> {
    const edge = this.edges.get(edgeId);
    if (!edge) return;
    this.edges.set(edgeId, { ...edge, resolution, targetFileId });
  }

  async dependenciesOf(repositoryId: string, fileId: string): Promise<CodeDependencyEdge[]> {
    return [...this.edges.values()].filter((e) => e.repositoryId === repositoryId && e.sourceFileId === fileId);
  }

  async dependentsOf(repositoryId: string, fileId: string): Promise<CodeDependencyEdge[]> {
    return [...this.edges.values()].filter((e) => e.repositoryId === repositoryId && e.targetFileId === fileId);
  }

  async removeFileState(repositoryId: string, sourceFileId: string): Promise<{ edgesRemoved: number }> {
    let edgesRemoved = 0;
    for (const [id, edge] of this.edges) {
      if (edge.repositoryId === repositoryId && edge.sourceFileId === sourceFileId) {
        this.edges.delete(id);
        edgesRemoved++;
      }
    }
    this.state.delete(sourceFileId);
    return { edgesRemoved };
  }
}
