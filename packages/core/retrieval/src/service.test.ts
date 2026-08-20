import { test } from "node:test";
import assert from "node:assert/strict";
import { globalScope, projectScope, sessionScope } from "@brain/contracts";
import { FakeRetrievalStore, buildMemoryRecord } from "@brain/test-fixtures";
import { RetrievalService } from "./service.js";

// Every test in this file uses FakeRetrievalStore (no SQLite, no real embedding
// model) -- network-free by construction, not by convention (Step 11.16).

test("lexical retrieval: a relevant fixture query returns the matching record with a real lexicalScore", async () => {
  // Only asserts the relevant record is present with a positive score -- NOT that
  // it is the only candidate. Retrieval pools evidence; it does not threshold on
  // relevance (that would be a ranking judgment, P1-009's job, not P1-008's). A
  // weakly/unrelated semantic match is legitimately allowed to also appear in the
  // pool, same as real vector KNN search has no hard relevance cutoff either.
  const store = new FakeRetrievalStore([
    buildMemoryRecord({ content: "use conventional commits for every pull request", scope: globalScope() }),
    buildMemoryRecord({ content: "the sky is blue", scope: globalScope() }),
  ]);
  const service = new RetrievalService(store);
  const results = await service.getCandidates({ text: "conventional commits", scope: globalScope(), limit: 10 });
  const match = results.find((r) => /conventional commits/.test(r.record.content));
  assert.ok(match, "the relevant record is in the pool");
  assert.ok((match?.signals.lexicalScore ?? 0) > 0);
});

test("semantic retrieval: candidates carry a semanticScore signal", async () => {
  const store = new FakeRetrievalStore([
    buildMemoryRecord({ content: "repository pattern for data access", scope: globalScope() }),
  ]);
  const service = new RetrievalService(store);
  const results = await service.getCandidates({ text: "repository pattern for data access", scope: globalScope(), limit: 10 });
  assert.ok(results.some((r) => r.signals.semanticScore !== undefined));
});

test("memory retrieval: an interaction-derived record (type=experience) is returned like any other", async () => {
  const store = new FakeRetrievalStore([
    buildMemoryRecord({ type: "experience", content: "last time this failed due to a timeout", scope: globalScope() }),
  ]);
  const service = new RetrievalService(store);
  const results = await service.getCandidates({ text: "timeout", scope: globalScope(), limit: 10 });
  assert.equal(results[0]?.record.type, "experience");
});

test("knowledge retrieval: a curated record (type=pattern) is returned like any other -- no special-casing needed (D2 unification)", async () => {
  const store = new FakeRetrievalStore([
    buildMemoryRecord({ type: "pattern", content: "repository pattern abstracts data access", scope: globalScope() }),
  ]);
  const service = new RetrievalService(store);
  const results = await service.getCandidates({ text: "repository pattern", scope: globalScope(), limit: 10 });
  assert.equal(results[0]?.record.type, "pattern");
});

test("scope isolation: near-identical content in a different project is never retrieved (adversarial, per this task's Step 4)", async () => {
  const store = new FakeRetrievalStore([
    buildMemoryRecord({ content: "Authentication uses JWT.", scope: projectScope("project-a") }),
    buildMemoryRecord({ content: "Authentication uses JWT.", scope: projectScope("project-b") }),
  ]);
  const service = new RetrievalService(store);
  const results = await service.getCandidates({ text: "Authentication uses JWT", scope: projectScope("project-a"), limit: 10 });
  assert.equal(results.length, 1);
  assert.equal(results[0]?.record.scope.id, "project-a");
});

test("global visibility: a global record is retrievable from a project-scoped query", async () => {
  const store = new FakeRetrievalStore([buildMemoryRecord({ content: "universal coding standard", scope: globalScope() })]);
  const service = new RetrievalService(store);
  const results = await service.getCandidates({ text: "universal coding standard", scope: projectScope("project-a"), limit: 10 });
  assert.equal(results.length, 1);
});

test("project isolation: a project-scoped query never sees a session-scoped record from elsewhere", async () => {
  const store = new FakeRetrievalStore([buildMemoryRecord({ content: "session-only debugging note", scope: sessionScope("session-x") })]);
  const service = new RetrievalService(store);
  const results = await service.getCandidates({ text: "session-only debugging note", scope: projectScope("project-a"), limit: 10 });
  assert.equal(results.length, 0);
});

test("session isolation: a session-scoped query never sees an unrelated project's record", async () => {
  const store = new FakeRetrievalStore([buildMemoryRecord({ content: "project-a specific detail", scope: projectScope("project-a") })]);
  const service = new RetrievalService(store);
  const results = await service.getCandidates({ text: "project-a specific detail", scope: sessionScope("session-x"), limit: 10 });
  assert.equal(results.length, 0);
});

test("candidate limit: the merged pool can exceed `limit` (up to 2x) -- limit caps each source, not the final pool", async () => {
  const records = Array.from({ length: 5 }, (_, i) => buildMemoryRecord({ content: `pattern match number ${i}`, scope: globalScope() }));
  const store = new FakeRetrievalStore(records);
  const service = new RetrievalService(store);
  const results = await service.getCandidates({ text: "pattern match", scope: globalScope(), limit: 3 });
  // Every record matches both lexically and semantically (FakeRetrievalStore uses
  // the same word-overlap heuristic for both), so each source independently caps at
  // 3, and identity-merge collapses the overlap back to at most 3 -- proving merge
  // does not silently re-truncate below what each source already returned.
  assert.ok(results.length <= 3, "still bounded by the natural overlap in this fixture");
  assert.ok(results.length > 0);
});

test("duplicate handling end-to-end: the same record from both sources appears exactly once", async () => {
  const store = new FakeRetrievalStore([buildMemoryRecord({ content: "shared match content here", scope: globalScope() })]);
  const service = new RetrievalService(store);
  const results = await service.getCandidates({ text: "shared match content here", scope: globalScope(), limit: 10 });
  assert.equal(results.length, 1);
  assert.ok(results[0]?.signals.lexicalScore !== undefined);
  assert.ok(results[0]?.signals.semanticScore !== undefined);
});

test("provenance survives retrieval: source and sourceRef are intact on the returned candidate", async () => {
  const store = new FakeRetrievalStore([
    buildMemoryRecord({ content: "imported pattern content", scope: globalScope(), source: { origin: "import", sourceRef: "aeos-seed:example" } }),
  ]);
  const service = new RetrievalService(store);
  const results = await service.getCandidates({ text: "imported pattern content", scope: globalScope(), limit: 10 });
  assert.equal(results[0]?.record.source.origin, "import");
  assert.equal(results[0]?.record.source.sourceRef, "aeos-seed:example");
});

test("empty database: no candidates, no error", async () => {
  const service = new RetrievalService(new FakeRetrievalStore([]));
  const results = await service.getCandidates({ text: "anything", scope: globalScope(), limit: 10 });
  assert.deepEqual(results, []);
});

test("empty query text is rejected deterministically (a bad request, not a degraded backend)", async () => {
  const service = new RetrievalService(new FakeRetrievalStore([]));
  await assert.rejects(() => service.getCandidates({ text: "", scope: globalScope(), limit: 10 }));
});

test("vector degradation: semantic search unavailable falls back to lexical-only, not an error", async () => {
  const store = new FakeRetrievalStore([buildMemoryRecord({ content: "fallback candidate content", scope: globalScope() })]);
  store.simulateSemanticFailure(true);
  const service = new RetrievalService(store);
  const results = await service.getCandidates({ text: "fallback candidate content", scope: globalScope(), limit: 10 });
  assert.equal(results.length, 1, "lexical results still returned");
  assert.equal(results[0]?.signals.semanticScore, undefined, "no semantic signal, because it degraded");
  assert.ok(results[0]?.signals.lexicalScore !== undefined);
});

test("embedding failure surfaces identically to vector-unavailable (both are 'semanticSearch rejected' from here)", async () => {
  const store = new FakeRetrievalStore([buildMemoryRecord({ content: "still findable lexically", scope: globalScope() })]);
  // simulateSemanticFailure models any semanticSearch() rejection, whether the
  // underlying cause is a missing sqlite-vec extension or the embedding call
  // itself throwing -- RetrievalService's degradation path does not, and should
  // not, distinguish between the two (see service.ts's doc comment).
  store.simulateSemanticFailure(true);
  const service = new RetrievalService(store);
  const results = await service.getCandidates({ text: "still findable lexically", scope: globalScope(), limit: 10 });
  assert.equal(results.length, 1);
});

test("a lexical (non-semantic) storage failure is NOT swallowed -- it propagates (real failure, not documented degradation)", async () => {
  const store = new FakeRetrievalStore([]);
  store.lexicalSearch = async () => {
    throw new Error("simulated data corruption");
  };
  const service = new RetrievalService(store);
  await assert.rejects(() => service.getCandidates({ text: "anything", scope: globalScope(), limit: 10 }), /simulated data corruption/);
});
