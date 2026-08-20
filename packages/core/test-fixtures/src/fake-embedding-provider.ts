import type { EmbeddingProvider } from "@brain/contracts";

const DIMENSIONS = 384;

/**
 * Deterministic, network-free, non-ML pseudo-embedding for unit tests: character
 * trigrams feature-hashed into a fixed-dimension vector, L2-normalized. Same text
 * always produces the same vector, and texts sharing more trigrams end up closer
 * together -- enough to exercise nearest-neighbor logic in tests without a real
 * model or network access. Not a stand-in for real semantic quality; see
 * LocalEmbeddingProvider in packages/storage for the real implementation.
 */
export class FakeEmbeddingProvider implements EmbeddingProvider {
  async embed(text: string): Promise<number[]> {
    const vector = new Array<number>(DIMENSIONS).fill(0);
    const padded = `  ${text.toLowerCase()}  `;
    for (let i = 0; i < padded.length - 2; i++) {
      const trigram = padded.slice(i, i + 3);
      const index = hash(trigram) % DIMENSIONS;
      vector[index] = (vector[index] ?? 0) + 1;
    }
    const magnitude = Math.sqrt(vector.reduce((sum, v) => sum + v * v, 0)) || 1;
    return vector.map((v) => v / magnitude);
  }
}

function hash(text: string): number {
  let h = 0;
  for (let i = 0; i < text.length; i++) {
    h = (Math.imul(31, h) + text.charCodeAt(i)) | 0;
  }
  return Math.abs(h);
}
