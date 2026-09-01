import { test } from "node:test";
import assert from "node:assert/strict";
import { resolveSpecifier } from "./dependency-resolve.js";

function index(entries: Record<string, string>): Map<string, string> {
  return new Map(Object.entries(entries));
}

test("explicit extension resolves directly", () => {
  const result = resolveSpecifier({
    specifier: "./user-service.ts",
    sourceRelativePath: "src/routes/users.ts",
    fileIndex: index({ "src/routes/user-service.ts": "file-service" }),
  });
  assert.deepEqual(result, { resolution: "internal", targetFileId: "file-service" });
});

test("extensionless specifier resolves against .ts", () => {
  const result = resolveSpecifier({
    specifier: "./user-service",
    sourceRelativePath: "src/routes/users.ts",
    fileIndex: index({ "src/routes/user-service.ts": "file-service" }),
  });
  assert.deepEqual(result, { resolution: "internal", targetFileId: "file-service" });
});

test("extensionless specifier resolves against .js when no .ts exists", () => {
  const result = resolveSpecifier({
    specifier: "./legacy",
    sourceRelativePath: "src/routes/users.ts",
    fileIndex: index({ "src/routes/legacy.js": "file-legacy" }),
  });
  assert.deepEqual(result, { resolution: "internal", targetFileId: "file-legacy" });
});

test("extensionless specifier resolves against .tsx", () => {
  const result = resolveSpecifier({
    specifier: "./widget",
    sourceRelativePath: "src/routes/page.tsx",
    fileIndex: index({ "src/routes/widget.tsx": "file-widget" }),
  });
  assert.deepEqual(result, { resolution: "internal", targetFileId: "file-widget" });
});

test("directory-index form resolves to index.ts", () => {
  const result = resolveSpecifier({
    specifier: "./models",
    sourceRelativePath: "src/routes/users.ts",
    fileIndex: index({ "src/routes/models/index.ts": "file-models" }),
  });
  assert.deepEqual(result, { resolution: "internal", targetFileId: "file-models" });
});

test("../ relative path resolves against a parent directory", () => {
  const result = resolveSpecifier({
    specifier: "../repositories/user-repository",
    sourceRelativePath: "src/services/user-service.ts",
    fileIndex: index({ "src/repositories/user-repository.ts": "file-repo" }),
  });
  assert.deepEqual(result, { resolution: "internal", targetFileId: "file-repo" });
});

test("a specifier with an explicit .js extension resolves against a .ts source file (TS/ESM convention: source imports reference the compiled .js, the indexed file is .ts)", () => {
  const result = resolveSpecifier({
    specifier: "./db.js",
    sourceRelativePath: "src/index.ts",
    fileIndex: index({ "src/db.ts": "file-db" }),
  });
  assert.deepEqual(result, { resolution: "internal", targetFileId: "file-db" });
});

test("when the literal specifier's extension exists as a real file, it wins over swapping to another extension", () => {
  const result = resolveSpecifier({
    specifier: "./thing.js",
    sourceRelativePath: "src/index.ts",
    fileIndex: index({ "src/thing.js": "file-real-js", "src/thing.ts": "file-ts" }),
  });
  assert.equal(result.targetFileId, "file-real-js", "an exact literal match must win over an extension swap");
});

test("a missing relative target is unresolved, not silently dropped", () => {
  const result = resolveSpecifier({
    specifier: "./does-not-exist",
    sourceRelativePath: "src/routes/users.ts",
    fileIndex: index({ "src/routes/user-service.ts": "file-service" }),
  });
  assert.deepEqual(result, { resolution: "unresolved", targetFileId: null });
});

test("a bare package specifier is external", () => {
  for (const specifier of ["zod", "better-sqlite3", "@brain/contracts", "node:fs"]) {
    assert.deepEqual(
      resolveSpecifier({ specifier, sourceRelativePath: "src/index.ts", fileIndex: index({}) }),
      { resolution: "external", targetFileId: null },
      `expected ${specifier} to resolve as external`,
    );
  }
});

test("candidate precedence is deterministic: .ts wins over .js when both exist", () => {
  const result = resolveSpecifier({
    specifier: "./thing",
    sourceRelativePath: "src/index.ts",
    fileIndex: index({ "src/thing.ts": "file-ts", "src/thing.js": "file-js" }),
  });
  assert.equal(result.targetFileId, "file-ts");
});

test("candidate precedence: a direct file wins over its own directory-index form", () => {
  const result = resolveSpecifier({
    specifier: "./thing",
    sourceRelativePath: "src/index.ts",
    fileIndex: index({ "src/thing.ts": "file-direct", "src/thing/index.ts": "file-index" }),
  });
  assert.equal(result.targetFileId, "file-direct");
});
