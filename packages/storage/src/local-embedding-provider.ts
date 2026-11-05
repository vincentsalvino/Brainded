import type { FeatureExtractionPipeline } from "@huggingface/transformers";
import type { EmbeddingProvider } from "@brain/contracts";
import { EMBEDDING_DIMENSIONS } from "./db.js";

/**
 * Default EmbeddingProvider: local, in-process, no external API call per embedding
 * (ARCHITECTURE.md invariant 19; validated approach from AUDIT_AEOS.md 13).
 *
 * The model weights (~90MB, all-MiniLM-L6-v2, 384-dim -- matches EMBEDDING_DIMENSIONS)
 * are fetched once from the Hugging Face Hub on first use and cached locally by the
 * runtime; every embedding call after that is fully offline. This one-time fetch is
 * the same tradeoff every local transformer-based embedding library makes, including
 * AEOS's own @xenova/transformers usage that this class is modeled on -- it is not a
 * per-operation network dependency, which is what invariant 19 rules out.
 */
export class LocalEmbeddingProvider implements EmbeddingProvider {
  private extractorPromise: Promise<FeatureExtractionPipeline> | null = null;

  constructor(private readonly options: { localFilesOnly?: boolean; cacheDir?: string } = {}) {}

  private async getExtractor(): Promise<FeatureExtractionPipeline> {
    this.extractorPromise ??= import("@huggingface/transformers").then(({ pipeline }) =>
      pipeline("feature-extraction", "Xenova/all-MiniLM-L6-v2", {
        local_files_only: this.options.localFilesOnly ?? false,
        ...(this.options.cacheDir ? { cache_dir: this.options.cacheDir } : {}),
      }),
    );
    return this.extractorPromise;
  }

  async embed(text: string): Promise<number[]> {
    const extractor = await this.getExtractor();
    const output = await extractor(text, { pooling: "mean", normalize: true });
    const vector = Array.from(output.data as Float32Array);
    if (vector.length !== EMBEDDING_DIMENSIONS) {
      throw new Error(
        `expected a ${EMBEDDING_DIMENSIONS}-dimension embedding, got ${vector.length}`,
      );
    }
    return vector;
  }
}
