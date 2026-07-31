import path from "node:path";
import { pipeline, env, type FeatureExtractionPipeline } from "@huggingface/transformers";
import type { EmbeddingProvider } from "./provider.js";

const MODEL_ID = "onnx-community/all-MiniLM-L6-v2-ONNX";
const DIMENSIONS = 384;

/**
 * Zero-config semantic search: a small local ONNX model, no API key required.
 * Model weights are cached under the daemon's own data dir (not the global HF
 * cache) so the whole footprint stays under one directory.
 */
export class LocalEmbeddingProvider implements EmbeddingProvider {
  readonly id = "local-minilm-l6-v2";
  readonly dimensions = DIMENSIONS;

  private extractorPromise: Promise<FeatureExtractionPipeline> | undefined;

  constructor(private readonly dataDir: string) {}

  private getExtractor(): Promise<FeatureExtractionPipeline> {
    if (!this.extractorPromise) {
      // Override lets repeated local test runs (or a power user) share one
      // download instead of re-fetching into every ephemeral data dir.
      env.cacheDir = process.env.MEM_PORT_MODEL_CACHE_DIR ?? path.join(this.dataDir, "models");
      this.extractorPromise = pipeline("feature-extraction", MODEL_ID);
    }
    return this.extractorPromise;
  }

  async embed(text: string): Promise<number[]> {
    const [vector] = await this.embedBatch([text]);
    return vector;
  }

  async embedBatch(texts: string[]): Promise<number[][]> {
    if (texts.length === 0) {
      return [];
    }
    const extractor = await this.getExtractor();
    const output = await extractor(texts, { pooling: "mean", normalize: true });
    return output.tolist() as number[][];
  }
}
