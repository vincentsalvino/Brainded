import { test } from "node:test";
import assert from "node:assert/strict";
import { CodeDependencyEdgeSchema } from "./code-dependency.js";
import { globalScope, projectScope } from "./scope.js";

function baseEdge(overrides: Record<string, unknown> = {}) {
  return {
    id: "edge-1",
    repositoryId: "repo-1",
    scope: projectScope("proj-a"),
    sourceFileId: "file-a",
    targetFileId: "file-b",
    specifier: "./b",
    kind: "static_import",
    resolution: "internal",
    sourceLine: 1,
    createdAt: new Date().toISOString(),
    ...overrides,
  };
}

test("CodeDependencyEdge: accepts a well-formed internal edge", () => {
  const edge = CodeDependencyEdgeSchema.parse(baseEdge());
  assert.equal(edge.resolution, "internal");
  assert.equal(edge.targetFileId, "file-b");
});

test("CodeDependencyEdge: accepts a well-formed external edge with null targetFileId", () => {
  const edge = CodeDependencyEdgeSchema.parse(
    baseEdge({ targetFileId: null, specifier: "zod", resolution: "external" }),
  );
  assert.equal(edge.targetFileId, null);
});

test("CodeDependencyEdge: accepts a well-formed unresolved edge with null targetFileId", () => {
  const edge = CodeDependencyEdgeSchema.parse(
    baseEdge({ targetFileId: null, specifier: "./missing", resolution: "unresolved" }),
  );
  assert.equal(edge.resolution, "unresolved");
});

test("CodeDependencyEdge: rejects internal resolution with a null targetFileId", () => {
  assert.throws(() => CodeDependencyEdgeSchema.parse(baseEdge({ resolution: "internal", targetFileId: null })));
});

test("CodeDependencyEdge: rejects external/unresolved resolution with a non-null targetFileId", () => {
  assert.throws(() => CodeDependencyEdgeSchema.parse(baseEdge({ resolution: "external", targetFileId: "file-b" })));
  assert.throws(() => CodeDependencyEdgeSchema.parse(baseEdge({ resolution: "unresolved", targetFileId: "file-b" })));
});

test("CodeDependencyEdge: rejects an unknown kind", () => {
  assert.throws(() => CodeDependencyEdgeSchema.parse(baseEdge({ kind: "symbol_reference" })));
});

test("CodeDependencyEdge: rejects an unknown resolution", () => {
  assert.throws(() => CodeDependencyEdgeSchema.parse(baseEdge({ resolution: "probably" })));
});

test("CodeDependencyEdge: sourceLine may be null", () => {
  const edge = CodeDependencyEdgeSchema.parse(baseEdge({ sourceLine: null }));
  assert.equal(edge.sourceLine, null);
});

test("CodeDependencyEdge: rejects unrecognized fields", () => {
  assert.throws(() => CodeDependencyEdgeSchema.parse(baseEdge({ symbols: ["x"] })));
});

test("CodeDependencyEdge: scope follows the same ScopeRef rules as everywhere else", () => {
  const edge = CodeDependencyEdgeSchema.parse(baseEdge({ scope: globalScope() }));
  assert.equal(edge.scope.kind, "global");
});
