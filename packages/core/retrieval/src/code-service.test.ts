import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { globalScope, projectScope, type CodeChunkRecord } from "@brain/contracts";
import { FakeCodeSearchStore, FakeEmbeddingProvider } from "@brain/test-fixtures";
import { CodeRetrievalService } from "./code-service.js";

// REGRESSION guard (invariant 5, "STORAGE OWNS FTS/VECTOR PERSISTENCE"): no direct
// SQLite import from @brain/retrieval -- structural, via package.json, same
// discipline @brain/token's "no storage dependency" guard uses.
test("REGRESSION guard: @brain/retrieval declares no SQLite/vector dependency -- concrete storage enters only through CodeSearchStore/RetrievalStore DI", () => {
  const pkgPath = join(dirname(fileURLToPath(import.meta.url)), "..", "package.json");
  const pkg = JSON.parse(readFileSync(pkgPath, "utf-8")) as { dependencies?: Record<string, string> };
  const deps = Object.keys(pkg.dependencies ?? {});
  assert.ok(!deps.includes("better-sqlite3"));
  assert.ok(!deps.includes("sqlite-vec"));
});

// Every test in this file uses FakeCodeSearchStore (no SQLite, no real embedding
// model) -- network-free by construction, matching service.test.ts's discipline.

let n = 0;
function chunk(content: string, scope = globalScope(), overrides: Partial<CodeChunkRecord> = {}): CodeChunkRecord {
  const i = n++;
  return {
    id: `chunk-${i}`,
    fileId: `file-${i}`,
    repositoryId: "repo-1",
    scope,
    relativePath: `src/example-${i}.ts`,
    chunkIndex: 0,
    startLine: 1,
    endLine: 1,
    content,
    contentHash: `hash-${i}`,
    ...overrides,
  };
}

test("lexical retrieval: a relevant fixture query returns the matching chunk with a real lexicalScore", async () => {
  const store = new FakeCodeSearchStore(new FakeEmbeddingProvider());
  store.index(chunk("export function validateUserInput(payload) { return schema.parse(payload); }"));
  store.index(chunk("export function getForecast() { return sunny; }"));
  const service = new CodeRetrievalService(store);

  const results = await service.getCandidates({ text: "validateUserInput", scope: globalScope(), limit: 10 });
  const match = results.find((r) => /validateUserInput/.test(r.content));
  assert.ok(match, "the relevant chunk is in the pool");
  assert.ok((match?.signals.lexicalScore ?? 0) > 0);
});

test("semantic retrieval: results carry a semanticScore signal once synced", async () => {
  const store = new FakeCodeSearchStore(new FakeEmbeddingProvider());
  const target = chunk("repository pattern for data access");
  store.index(target);
  await store.syncEmbeddings(target.repositoryId);
  const service = new CodeRetrievalService(store);

  const results = await service.getCandidates({ text: "repository pattern for data access", scope: globalScope(), limit: 10 });
  assert.ok(results.some((r) => r.signals.semanticScore !== undefined));
});

test("scope isolation: near-identical content in a different project is never retrieved", async () => {
  const store = new FakeCodeSearchStore(new FakeEmbeddingProvider());
  store.index(chunk("authentication uses JWT tokens", projectScope("project-a")));
  store.index(chunk("authentication uses JWT tokens", projectScope("project-b")));
  const service = new CodeRetrievalService(store);

  const results = await service.getCandidates({ text: "authentication JWT tokens", scope: projectScope("project-a"), limit: 10 });
  assert.ok(results.every((r) => r.scope.id === "project-a"));
});

test("empty query text is rejected deterministically (a bad request, not a degraded backend)", async () => {
  const service = new CodeRetrievalService(new FakeCodeSearchStore(new FakeEmbeddingProvider()));
  await assert.rejects(() => service.getCandidates({ text: "", scope: globalScope(), limit: 10 }));
});

test("vector degradation: semantic search unavailable falls back to lexical-only, not an error", async () => {
  const store = new FakeCodeSearchStore(new FakeEmbeddingProvider());
  store.index(chunk("fallback candidate content"));
  store.simulateSemanticFailure(true);
  const service = new CodeRetrievalService(store);

  const results = await service.getCandidates({ text: "fallback candidate content", scope: globalScope(), limit: 10 });
  assert.equal(results.length, 1, "lexical results still returned");
  assert.equal(results[0]?.signals.semanticScore, undefined, "no semantic signal, because it degraded");
  assert.ok(results[0]?.signals.lexicalScore !== undefined);
});

test("a lexical (non-semantic) storage failure is NOT swallowed -- it propagates", async () => {
  const store = new FakeCodeSearchStore(new FakeEmbeddingProvider());
  store.lexicalSearch = async () => {
    throw new Error("simulated data corruption");
  };
  const service = new CodeRetrievalService(store);
  await assert.rejects(() => service.getCandidates({ text: "anything", scope: globalScope(), limit: 10 }), /simulated data corruption/);
});

test("hybrid: a chunk found by both channels appears once, with both signals merged (mergeCodeCandidates wired end to end)", async () => {
  const store = new FakeCodeSearchStore(new FakeEmbeddingProvider());
  const target = chunk("shared repository access pattern for database calls");
  store.index(target);
  await store.syncEmbeddings(target.repositoryId);
  const service = new CodeRetrievalService(store);

  const results = await service.getCandidates({ text: "shared repository access pattern for database calls", scope: globalScope(), limit: 10 });
  const merged = results.filter((r) => r.chunkId === target.id);
  assert.equal(merged.length, 1, "identity-merged, not duplicated across channels");
  assert.ok(merged[0]?.signals.lexicalScore !== undefined);
  assert.ok(merged[0]?.signals.semanticScore !== undefined);
});
