import { test } from "node:test";
import assert from "node:assert/strict";
import { extractDependencies } from "./dependency-extract.js";

function ts(content: string) {
  return extractDependencies({ language: "typescript", content });
}

test("ES default import", () => {
  const deps = ts(`import x from "./x";`);
  assert.deepEqual(deps, [{ specifier: "./x", kind: "static_import", sourceLine: 1 }]);
});

test("ES named import", () => {
  const deps = ts(`import { a, b } from "./x";`);
  assert.deepEqual(deps, [{ specifier: "./x", kind: "static_import", sourceLine: 1 }]);
});

test("ES default + named import together", () => {
  const deps = ts(`import x, { a, b } from "./x";`);
  assert.deepEqual(deps, [{ specifier: "./x", kind: "static_import", sourceLine: 1 }]);
});

test("import type", () => {
  const deps = ts(`import type { A } from "./types";`);
  assert.deepEqual(deps, [{ specifier: "./types", kind: "static_import", sourceLine: 1 }]);
});

test("side-effect import", () => {
  const deps = ts(`import "./polyfill";`);
  assert.deepEqual(deps, [{ specifier: "./polyfill", kind: "static_import", sourceLine: 1 }]);
});

test("export-from", () => {
  const deps = ts(`export { a, b } from "./x";`);
  assert.deepEqual(deps, [{ specifier: "./x", kind: "re_export", sourceLine: 1 }]);
});

test("export-star", () => {
  const deps = ts(`export * from "./x";`);
  assert.deepEqual(deps, [{ specifier: "./x", kind: "re_export", sourceLine: 1 }]);
});

test("require literal", () => {
  const deps = ts(`const x = require("./x");`);
  assert.deepEqual(deps, [{ specifier: "./x", kind: "require", sourceLine: 1 }]);
});

test("dynamic import literal", () => {
  const deps = ts(`const mod = await import("./x");`);
  assert.deepEqual(deps, [{ specifier: "./x", kind: "dynamic_import", sourceLine: 1 }]);
});

test("dynamic import expression does not create a false resolved edge -- no edge at all", () => {
  const deps = ts(`const name = "./x"; const mod = await import(name);`);
  assert.deepEqual(deps, [], "no literal specifier exists for an expression-form dynamic import; nothing is fabricated");
});

test("dynamic import of a template literal does not create an edge", () => {
  const deps = ts("const mod = await import(`./${name}`);");
  assert.deepEqual(deps, []);
});

test("commented-out import is ignored", () => {
  const deps = ts(`// import x from "./fake"\nimport y from "./real";`);
  assert.deepEqual(deps, [{ specifier: "./real", kind: "static_import", sourceLine: 2 }]);
});

test("block-comment require is ignored", () => {
  const deps = ts(`/*\nrequire("./fake")\n*/\nrequire("./real");`);
  assert.deepEqual(deps, [{ specifier: "./real", kind: "require", sourceLine: 4 }]);
});

test("an ordinary string mentioning the word import is not treated as syntax", () => {
  const deps = ts(`const helpText = "click here to import your data from a file";\nimport x from "./real";`);
  assert.deepEqual(deps, [{ specifier: "./real", kind: "static_import", sourceLine: 2 }]);
});

test("multiple imports extract deterministically, in source order", () => {
  const deps = ts(`import a from "./a";\nimport b from "./b";\nrequire("./c");`);
  assert.deepEqual(deps, [
    { specifier: "./a", kind: "static_import", sourceLine: 1 },
    { specifier: "./b", kind: "static_import", sourceLine: 2 },
    { specifier: "./c", kind: "require", sourceLine: 3 },
  ]);
});

test("duplicate imports of the same specifier+kind from the same file collapse into one edge, keeping the first line", () => {
  const deps = ts(`import a from "./a";\nconst x = 1;\nimport a2 from "./a";`);
  assert.deepEqual(deps, [{ specifier: "./a", kind: "static_import", sourceLine: 1 }]);
});

test("the same specifier imported both statically and dynamically produces two distinct edges (different kind)", () => {
  const deps = ts(`import a from "./a";\nconst x = await import("./a");`);
  assert.deepEqual(deps, [
    { specifier: "./a", kind: "static_import", sourceLine: 1 },
    { specifier: "./a", kind: "dynamic_import", sourceLine: 2 },
  ]);
});

test("unsupported language returns an empty result, never throws", () => {
  assert.deepEqual(extractDependencies({ language: "python", content: `import os` }), []);
  assert.deepEqual(extractDependencies({ language: null, content: `anything` }), []);
});

test("javascript is supported the same as typescript", () => {
  const deps = extractDependencies({ language: "javascript", content: `const x = require("./x");` });
  assert.deepEqual(deps, [{ specifier: "./x", kind: "require", sourceLine: 1 }]);
});
