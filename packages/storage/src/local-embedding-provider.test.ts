import { test } from "node:test";
import assert from "node:assert/strict";
import { globalScope, projectScope } from "@brain/contracts";
import { LocalEmbeddingProvider } from "./local-embedding-provider.js";
import { EMBEDDING_DIMENSIONS, openDatabase } from "./db.js";
import { SqliteMemoryRepository } from "./memory-repository.js";
import { SqliteRetrievalStore } from "./retrieval-store.js";

// Integration test, deliberately separate from the main storage suite: this is the
// one place that exercises the real @huggingface/transformers model rather than
// FakeEmbeddingProvider. The model (~90MB) is fetched from the Hugging Face Hub on
// first run and cached locally after -- see LocalEmbeddingProvider's own doc
// comment on why this one-time fetch does not violate the zero-network-calls
// invariant (ARCHITECTURE.md 19). Slower and network-dependent by nature; that is
// why it is not part of the fast, network-free unit suite.

test(
  "LocalEmbeddingProvider returns a real, correctly-sized, non-trivial embedding",
  { timeout: 120_000 },
  async () => {
    const provider = new LocalEmbeddingProvider();
    const vector = await provider.embed("use conventional commits for every pull request");
    assert.equal(vector.length, EMBEDDING_DIMENSIONS);
    assert.ok(vector.some((v) => v !== 0), "embedding should not be all zeros");
  },
);

test(
  "LocalEmbeddingProvider: semantically similar text is closer than unrelated text (real cosine check)",
  { timeout: 120_000 },
  async () => {
    const provider = new LocalEmbeddingProvider();
    const a = await provider.embed("the repository pattern abstracts database access");
    const b = await provider.embed("database access is abstracted via the repository pattern");
    const c = await provider.embed("the weather today is sunny with a light breeze");

    const cosine = (x: number[], y: number[]) => {
      const dot = x.reduce((sum, xi, i) => sum + xi * (y[i] ?? 0), 0);
      const magX = Math.sqrt(x.reduce((sum, xi) => sum + xi * xi, 0));
      const magY = Math.sqrt(y.reduce((sum, yi) => sum + yi * yi, 0));
      return dot / (magX * magY);
    };

    assert.ok(cosine(a, b) > cosine(a, c), "similar sentences should be closer than unrelated ones");
  },
);

test(
  "integration: findSimilarPairs detects the known real-world redundant pair with the real embedding model",
  { timeout: 120_000 },
  async () => {
    const db = openDatabase(":memory:");
    const embeddings = new LocalEmbeddingProvider();
    const repo = new SqliteMemoryRepository(db.raw, embeddings);
    const store = new SqliteRetrievalStore(db.raw, embeddings, db.vectorSearchAvailable);

    const constraint = await repo.create({
      type: "constraint",
      content: "notes-api: database access must go through the repository layer (NotesRepository interface); route handlers must never touch the database directly",
      scope: projectScope("notes-api"),
      confidence: 1,
    });
    const projectRule = await repo.create({
      type: "rule",
      content: "notes-api REST endpoints use plural resource names: /notes, /notes/:id (POST, GET, GET/:id)",
      scope: projectScope("notes-api"),
      confidence: 1,
    });
    const globalRule = await repo.create({
      type: "rule",
      content: "REST API resources should use plural nouns in endpoint paths, such as /tasks and /notes.",
      scope: globalScope(),
      confidence: 0.5,
    });

    const pairs = await store.findSimilarPairs([constraint.id, projectRule.id, globalRule.id], 0);
    const byPair = new Map(pairs.map((p) => [[p.a, p.b].sort().join(","), p.similarity]));
    const redundantSimilarity = byPair.get([projectRule.id, globalRule.id].sort().join(","));
    const distinctSimilarity1 = byPair.get([constraint.id, projectRule.id].sort().join(","));
    const distinctSimilarity2 = byPair.get([constraint.id, globalRule.id].sort().join(","));

    console.log(`\nreal-model similarity: project~global (known redundant) = ${redundantSimilarity}`);
    console.log(`real-model similarity: constraint~projectRule (distinct) = ${distinctSimilarity1}`);
    console.log(`real-model similarity: constraint~globalRule (distinct)  = ${distinctSimilarity2}`);

    assert.ok(redundantSimilarity !== undefined && redundantSimilarity > 0.7, `expected the known pair near PHASE_2_FINDINGS.md's 0.785, got ${redundantSimilarity}`);
    assert.ok((distinctSimilarity1 ?? 1) < (redundantSimilarity ?? 0), "the distinct constraint pair must score lower than the known redundant pair");
    assert.ok((distinctSimilarity2 ?? 1) < (redundantSimilarity ?? 0), "the distinct constraint pair must score lower than the known redundant pair");
    db.close();
  },
);
