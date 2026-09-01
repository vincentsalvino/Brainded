import { test } from "node:test";
import assert from "node:assert/strict";
import { CodeSearchQuerySchema, CodeSearchResultSchema, CodeSearchFiltersSchema } from "./code-search.js";
import { globalScope, projectScope } from "./scope.js";

test("CodeSearchQuery: text/scope required, limit defaults, filters optional", () => {
  const query = CodeSearchQuerySchema.parse({ text: "validate input", scope: globalScope() });
  assert.equal(query.limit, 20);
  assert.equal(query.filters, undefined);
});

test("CodeSearchQuery: rejects unrecognized fields and empty text", () => {
  assert.throws(() => CodeSearchQuerySchema.parse({ text: "x", scope: globalScope(), extra: true }));
  assert.throws(() => CodeSearchQuerySchema.parse({ text: "", scope: globalScope() }));
});

test("CodeSearchFilters: repositoryId/pathPrefix/language all optional and independently settable", () => {
  const filters = CodeSearchFiltersSchema.parse({ language: "typescript" });
  assert.equal(filters.repositoryId, undefined);
  assert.equal(filters.pathPrefix, undefined);
  assert.equal(filters.language, "typescript");
});

function baseResult(overrides: Record<string, unknown> = {}) {
  return {
    chunkId: "chunk-1",
    fileId: "file-1",
    repositoryId: "repo-1",
    scope: projectScope("proj-a"),
    relativePath: "src/index.ts",
    language: "typescript",
    startLine: 1,
    endLine: 10,
    content: "export function validate() {}",
    signals: { lexicalScore: 0.8 },
    ...overrides,
  };
}

test("CodeSearchResult: accepts a well-formed lexical-only result", () => {
  const result = CodeSearchResultSchema.parse(baseResult());
  assert.equal(result.signals.lexicalScore, 0.8);
  assert.equal(result.signals.semanticScore, undefined);
});

test("CodeSearchResult: signals may carry both lexical and semantic scores at once (post-merge shape)", () => {
  const result = CodeSearchResultSchema.parse(baseResult({ signals: { lexicalScore: 0.8, semanticScore: 0.6 } }));
  assert.equal(result.signals.lexicalScore, 0.8);
  assert.equal(result.signals.semanticScore, 0.6);
});

test("CodeSearchResult: language may be null", () => {
  const result = CodeSearchResultSchema.parse(baseResult({ language: null }));
  assert.equal(result.language, null);
});

test("CodeSearchResult: rejects endLine before startLine", () => {
  assert.throws(() => CodeSearchResultSchema.parse(baseResult({ startLine: 10, endLine: 5 })));
});

test("CodeSearchResult: rejects unrecognized fields (e.g. a stray rawScore) and a memoryId-shaped substitute", () => {
  assert.throws(() => CodeSearchResultSchema.parse(baseResult({ rawScore: 1.0 })));
});
