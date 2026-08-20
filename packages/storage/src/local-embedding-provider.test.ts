import { test } from "node:test";
import assert from "node:assert/strict";
import { LocalEmbeddingProvider } from "./local-embedding-provider.js";
import { EMBEDDING_DIMENSIONS } from "./db.js";

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
