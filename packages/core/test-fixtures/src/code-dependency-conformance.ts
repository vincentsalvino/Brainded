import { test } from "node:test";
import assert from "node:assert/strict";
import type { CodeDependencyEdge, CodeDependencyStore, ScopeRef } from "@brain/contracts";
import { globalScope, projectScope } from "@brain/contracts";

/**
 * ONE behavioural contract for CodeDependencyStore, run against every
 * implementation -- same purpose and discipline as store-conformance.ts /
 * code-store-conformance.ts (P2-001 precedent): replacement semantics, scope/
 * repository isolation, and direct dependency/dependent queries must agree exactly
 * between FakeCodeDependencyStore and SqliteCodeDependencyStore, not merely satisfy
 * the same TypeScript interface shape.
 */

export interface ConformanceDependencyHarness {
  name: string;
  setup(): Promise<{ store: CodeDependencyStore; cleanup: () => void }>;
}

function edge(repositoryId: string, overrides: Partial<CodeDependencyEdge> = {}): CodeDependencyEdge {
  return {
    id: overrides.id ?? "edge-1",
    repositoryId,
    scope: (overrides.scope ?? projectScope("proj-a")) as ScopeRef,
    sourceFileId: overrides.sourceFileId ?? "file-a",
    targetFileId: "targetFileId" in overrides ? (overrides.targetFileId as string | null) : "file-b",
    specifier: overrides.specifier ?? "./b",
    kind: overrides.kind ?? "static_import",
    resolution: overrides.resolution ?? "internal",
    sourceLine: overrides.sourceLine ?? 1,
    createdAt: overrides.createdAt ?? new Date().toISOString(),
  };
}

export function runCodeDependencyStoreConformance(harness: ConformanceDependencyHarness): void {
  const label = (name: string) => `[conformance:${harness.name}] ${name}`;

  test(label("replaceOutgoingEdges writes edges; listEdges reads them back"), async () => {
    const { store, cleanup } = await harness.setup();
    try {
      const { edgesCreated, edgesRemoved } = await store.replaceOutgoingEdges("repo-1", "file-a", "hash-1", [edge("repo-1")]);
      assert.equal(edgesCreated, 1);
      assert.equal(edgesRemoved, 0);
      const all = await store.listEdges("repo-1");
      assert.equal(all.length, 1);
      assert.equal(all[0]?.specifier, "./b");
    } finally {
      cleanup();
    }
  });

  test(label("a second replaceOutgoingEdges call for the same source file replaces, not appends"), async () => {
    const { store, cleanup } = await harness.setup();
    try {
      await store.replaceOutgoingEdges("repo-1", "file-a", "hash-1", [edge("repo-1", { id: "old", specifier: "./old" })]);
      const { edgesRemoved } = await store.replaceOutgoingEdges("repo-1", "file-a", "hash-2", [
        edge("repo-1", { id: "new", specifier: "./new" }),
      ]);
      assert.equal(edgesRemoved, 1);
      const all = await store.listEdges("repo-1");
      assert.deepEqual(all.map((e) => e.id), ["new"]);
    } finally {
      cleanup();
    }
  });

  test(label("repository isolation: another repository's edges never appear in listEdges"), async () => {
    const { store, cleanup } = await harness.setup();
    try {
      await store.replaceOutgoingEdges("repo-a", "file-a", "hash-1", [edge("repo-a", { id: "edge-a" })]);
      await store.replaceOutgoingEdges("repo-b", "file-a", "hash-1", [edge("repo-b", { id: "edge-b" })]);
      const edgesA = await store.listEdges("repo-a");
      assert.deepEqual(edgesA.map((e) => e.id), ["edge-a"]);
    } finally {
      cleanup();
    }
  });

  test(label("dependenciesOf returns exactly a source file's outgoing edges"), async () => {
    const { store, cleanup } = await harness.setup();
    try {
      await store.replaceOutgoingEdges("repo-1", "file-a", "hash-1", [
        edge("repo-1", { id: "e1", targetFileId: "file-b", specifier: "./b" }),
        edge("repo-1", { id: "e2", targetFileId: "file-c", specifier: "./c" }),
      ]);
      const deps = await store.dependenciesOf("repo-1", "file-a");
      assert.deepEqual(deps.map((e) => e.targetFileId).sort(), ["file-b", "file-c"]);
    } finally {
      cleanup();
    }
  });

  test(label("dependentsOf returns exactly the edges targeting a file, from any source"), async () => {
    const { store, cleanup } = await harness.setup();
    try {
      await store.replaceOutgoingEdges("repo-1", "file-a", "hash-1", [
        edge("repo-1", { id: "e1", sourceFileId: "file-a", targetFileId: "file-shared" }),
      ]);
      await store.replaceOutgoingEdges("repo-1", "file-b", "hash-1", [
        edge("repo-1", { id: "e2", sourceFileId: "file-b", targetFileId: "file-shared" }),
      ]);
      const dependents = await store.dependentsOf("repo-1", "file-shared");
      assert.deepEqual(dependents.map((e) => e.sourceFileId).sort(), ["file-a", "file-b"]);
    } finally {
      cleanup();
    }
  });

  test(label("updateEdgeResolution flips one edge's resolution/target without touching others"), async () => {
    const { store, cleanup } = await harness.setup();
    try {
      await store.replaceOutgoingEdges("repo-1", "file-a", "hash-1", [
        edge("repo-1", { id: "e1", targetFileId: "file-b", resolution: "internal" }),
        edge("repo-1", { id: "e2", targetFileId: null, resolution: "unresolved", specifier: "./gone" }),
      ]);
      await store.updateEdgeResolution("e2", "internal", "file-b-now-exists");
      const all = await store.listEdges("repo-1");
      assert.equal(all.find((e) => e.id === "e1")?.resolution, "internal");
      assert.equal(all.find((e) => e.id === "e2")?.resolution, "internal");
      assert.equal(all.find((e) => e.id === "e2")?.targetFileId, "file-b-now-exists");
    } finally {
      cleanup();
    }
  });

  test(label("removeFileState deletes a source file's outgoing edges and its tracked state"), async () => {
    const { store, cleanup } = await harness.setup();
    try {
      await store.replaceOutgoingEdges("repo-1", "file-a", "hash-1", [edge("repo-1")]);
      const { edgesRemoved } = await store.removeFileState("repo-1", "file-a");
      assert.equal(edgesRemoved, 1);
      assert.deepEqual(await store.listEdges("repo-1"), []);
      assert.deepEqual(await store.listDependencyState("repo-1"), []);
    } finally {
      cleanup();
    }
  });

  test(label("listDependencyState tracks contentHash per source file, scoped by repository"), async () => {
    const { store, cleanup } = await harness.setup();
    try {
      await store.replaceOutgoingEdges("repo-1", "file-a", "hash-1", [edge("repo-1")]);
      const state = await store.listDependencyState("repo-1");
      assert.deepEqual(state, [{ fileId: "file-a", contentHash: "hash-1" }]);
    } finally {
      cleanup();
    }
  });

  test(label("scope is preserved through the round trip"), async () => {
    const { store, cleanup } = await harness.setup();
    try {
      await store.replaceOutgoingEdges("repo-1", "file-a", "hash-1", [edge("repo-1", { scope: globalScope() })]);
      const all = await store.listEdges("repo-1");
      assert.equal(all[0]?.scope.kind, "global");
    } finally {
      cleanup();
    }
  });
}
