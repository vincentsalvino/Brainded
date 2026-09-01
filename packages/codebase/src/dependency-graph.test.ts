import { test } from "node:test";
import assert from "node:assert/strict";
import { globalScope, type CodeDependencyEdge, type CodeFileRecord } from "@brain/contracts";
import { FakeCodebaseRepository, FakeCodeDependencyStore } from "@brain/test-fixtures";
import { DependencyGraphService } from "./dependency-graph.js";

async function mkFile(codebase: FakeCodebaseRepository, repositoryId: string, id: string, relativePath: string): Promise<void> {
  const file: CodeFileRecord = {
    id,
    repositoryId,
    scope: globalScope(),
    relativePath,
    language: "typescript",
    sizeBytes: 1,
    contentHash: `hash-${id}`,
    indexedAt: new Date().toISOString(),
  };
  await codebase.replaceFile(file, []);
}

function mkEdge(repositoryId: string, sourceFileId: string, targetFileId: string | null, overrides: Partial<CodeDependencyEdge> = {}): CodeDependencyEdge {
  return {
    id: `${sourceFileId}->${targetFileId ?? overrides.specifier}`,
    repositoryId,
    scope: globalScope(),
    sourceFileId,
    targetFileId,
    specifier: `./${targetFileId ?? "unknown"}`,
    kind: "static_import",
    resolution: targetFileId ? "internal" : "unresolved",
    sourceLine: 1,
    createdAt: new Date().toISOString(),
    ...overrides,
  };
}

async function setup() {
  const codebase = new FakeCodebaseRepository();
  const store = new FakeCodeDependencyStore();
  const repositoryId = (await codebase.createRepository(globalScope(), "/repo")).id;
  const graph = new DependencyGraphService(codebase, store);
  return { codebase, store, graph, repositoryId };
}

test("dependenciesOf: direct outgoing dependencies, resolved to relativePath", async () => {
  const { codebase, store, graph, repositoryId } = await setup();
  await mkFile(codebase, repositoryId, "f-users", "src/routes/users.ts");
  await mkFile(codebase, repositoryId, "f-service", "src/services/user-service.ts");
  await store.replaceOutgoingEdges(repositoryId, "f-users", "hash", [mkEdge(repositoryId, "f-users", "f-service")]);

  const deps = await graph.dependenciesOf(repositoryId, "f-users");
  assert.deepEqual(deps, [{ fileId: "f-service", relativePath: "src/services/user-service.ts" }]);
});

test("dependenciesOf: excludes external and unresolved edges", async () => {
  const { codebase, store, graph, repositoryId } = await setup();
  await mkFile(codebase, repositoryId, "f-a", "src/a.ts");
  await mkFile(codebase, repositoryId, "f-b", "src/b.ts");
  await store.replaceOutgoingEdges(repositoryId, "f-a", "hash", [
    mkEdge(repositoryId, "f-a", "f-b"),
    mkEdge(repositoryId, "f-a", null, { id: "ext", specifier: "zod", resolution: "external" }),
    mkEdge(repositoryId, "f-a", null, { id: "unres", specifier: "./gone", resolution: "unresolved" }),
  ]);

  const deps = await graph.dependenciesOf(repositoryId, "f-a");
  assert.deepEqual(deps, [{ fileId: "f-b", relativePath: "src/b.ts" }]);
});

test("dependentsOf: direct incoming dependents, resolved to relativePath", async () => {
  const { codebase, store, graph, repositoryId } = await setup();
  await mkFile(codebase, repositoryId, "f-repo", "src/repositories/user-repository.ts");
  await mkFile(codebase, repositoryId, "f-service", "src/services/user-service.ts");
  await store.replaceOutgoingEdges(repositoryId, "f-service", "hash", [mkEdge(repositoryId, "f-service", "f-repo")]);

  const dependents = await graph.dependentsOf(repositoryId, "f-repo");
  assert.deepEqual(dependents, [{ fileId: "f-service", relativePath: "src/services/user-service.ts" }]);
});

test("dependentsOf: deduplicates when two edges from the same file target the same file (e.g. static + dynamic import)", async () => {
  const { codebase, store, graph, repositoryId } = await setup();
  await mkFile(codebase, repositoryId, "f-a", "src/a.ts");
  await mkFile(codebase, repositoryId, "f-b", "src/b.ts");
  await store.replaceOutgoingEdges(repositoryId, "f-a", "hash", [
    mkEdge(repositoryId, "f-a", "f-b", { id: "e1", kind: "static_import" }),
    mkEdge(repositoryId, "f-a", "f-b", { id: "e2", kind: "dynamic_import" }),
  ]);

  const dependents = await graph.dependentsOf(repositoryId, "f-b");
  assert.equal(dependents.length, 1, "one file, one entry, even though it reaches the target via two edges");
});

// mission's own example: D -> C -> B -> A means "D imports C, C imports B, B
// imports A"; impactOf(D) = C, B, A (everyone transitively depending on D).
async function chain(): Promise<{ codebase: FakeCodebaseRepository; store: FakeCodeDependencyStore; graph: DependencyGraphService; repositoryId: string }> {
  const { codebase, store, graph, repositoryId } = await setup();
  await mkFile(codebase, repositoryId, "f-d", "src/d.ts");
  await mkFile(codebase, repositoryId, "f-c", "src/c.ts");
  await mkFile(codebase, repositoryId, "f-b", "src/b.ts");
  await mkFile(codebase, repositoryId, "f-a", "src/a.ts");
  await store.replaceOutgoingEdges(repositoryId, "f-c", "hash", [mkEdge(repositoryId, "f-c", "f-d")]);
  await store.replaceOutgoingEdges(repositoryId, "f-b", "hash", [mkEdge(repositoryId, "f-b", "f-c")]);
  await store.replaceOutgoingEdges(repositoryId, "f-a", "hash", [mkEdge(repositoryId, "f-a", "f-b")]);
  return { codebase, store, graph, repositoryId };
}

test("impactOf: transitive reverse traversal returns every file that transitively depends on the origin", async () => {
  const { graph, repositoryId } = await chain();
  const impact = await graph.impactOf(repositoryId, "f-d");
  assert.deepEqual(
    impact.map((r) => ({ fileId: r.fileId, depth: r.depth })),
    [
      { fileId: "f-c", depth: 1 },
      { fileId: "f-b", depth: 2 },
      { fileId: "f-a", depth: 3 },
    ],
  );
});

test("impactOf: maxDepth limits the traversal", async () => {
  const { graph, repositoryId } = await chain();
  const impact = await graph.impactOf(repositoryId, "f-d", { maxDepth: 2 });
  assert.deepEqual(
    impact.map((r) => r.fileId),
    ["f-c", "f-b"],
  );
});

test("impactOf: a leaf file with no dependents returns an empty impact set", async () => {
  const { graph, repositoryId } = await chain();
  const impact = await graph.impactOf(repositoryId, "f-a");
  assert.deepEqual(impact, []);
});

test("impactOf: cycle-safe -- A -> B -> C -> A terminates and excludes the starting node", async () => {
  const { codebase, store, graph, repositoryId } = await setup();
  await mkFile(codebase, repositoryId, "f-a", "src/a.ts");
  await mkFile(codebase, repositoryId, "f-b", "src/b.ts");
  await mkFile(codebase, repositoryId, "f-c", "src/c.ts");
  await store.replaceOutgoingEdges(repositoryId, "f-a", "hash", [mkEdge(repositoryId, "f-a", "f-b")]);
  await store.replaceOutgoingEdges(repositoryId, "f-b", "hash", [mkEdge(repositoryId, "f-b", "f-c")]);
  await store.replaceOutgoingEdges(repositoryId, "f-c", "hash", [mkEdge(repositoryId, "f-c", "f-a")]);

  const impact = await graph.impactOf(repositoryId, "f-a");
  assert.deepEqual(
    impact.map((r) => r.fileId).sort(),
    ["f-b", "f-c"],
    "the cycle must terminate, and A must never appear in its own impact set",
  );
});

test("impactOf: deterministic ordering (depth ascending, then relativePath ascending) and no duplicates when multiple paths converge", async () => {
  // Diamond: root <- left <- top, root <- right <- top (top depends on both left
  // and right, both of which depend on root) -- top must appear exactly once.
  const { codebase, store, graph, repositoryId } = await setup();
  await mkFile(codebase, repositoryId, "f-root", "src/root.ts");
  await mkFile(codebase, repositoryId, "f-left", "src/left.ts");
  await mkFile(codebase, repositoryId, "f-right", "src/right.ts");
  await mkFile(codebase, repositoryId, "f-top", "src/top.ts");
  await store.replaceOutgoingEdges(repositoryId, "f-left", "hash", [mkEdge(repositoryId, "f-left", "f-root")]);
  await store.replaceOutgoingEdges(repositoryId, "f-right", "hash", [mkEdge(repositoryId, "f-right", "f-root")]);
  await store.replaceOutgoingEdges(repositoryId, "f-top", "hash", [
    mkEdge(repositoryId, "f-top", "f-left", { id: "top->left" }),
    mkEdge(repositoryId, "f-top", "f-right", { id: "top->right" }),
  ]);

  const impact = await graph.impactOf(repositoryId, "f-root");
  assert.deepEqual(
    impact.map((r) => ({ fileId: r.fileId, depth: r.depth })),
    [
      { fileId: "f-left", depth: 1 },
      { fileId: "f-right", depth: 1 },
      { fileId: "f-top", depth: 2 },
    ],
    "left/right at depth 1 ordered by relativePath, top appears exactly once at depth 2 (not twice)",
  );
});

test("impactOf: only resolution==='internal' edges are followed -- external/unresolved never appear", async () => {
  const { codebase, store, graph, repositoryId } = await setup();
  await mkFile(codebase, repositoryId, "f-a", "src/a.ts");
  // f-a's own outgoing edges are external/unresolved -- irrelevant to impactOf(f-a)
  // anyway (impact looks at DEPENDENTS, not dependencies), but confirms the store
  // never manufactures a phantom dependent from a non-internal edge naming f-a as a
  // specifier coincidentally.
  await store.replaceOutgoingEdges(repositoryId, "f-a", "hash", [
    mkEdge(repositoryId, "f-a", null, { id: "ext", specifier: "some-package", resolution: "external" }),
  ]);
  const impact = await graph.impactOf(repositoryId, "f-a");
  assert.deepEqual(impact, []);
});
