#!/usr/bin/env node
/**
 * Download the embedding model into a cache directory at image-build time.
 *
 * Without this, the first embed call on every new instance fetches ~25MB from
 * HuggingFace. On a platform that starts and stops instances freely that cost
 * is paid over and over, and it makes serving a request depend on reaching a
 * third party at runtime. Baking the weights in trades image size for a cold
 * start that needs no network.
 *
 * Keep MODEL_ID in step with src/embeddings/localProvider.ts — a mismatch is
 * silent, and shows up only as a slow first request in production.
 */
import { pipeline, env } from "@huggingface/transformers";

const MODEL_ID = "onnx-community/all-MiniLM-L6-v2-ONNX";
const cacheDir = process.env.MEM_PORT_MODEL_CACHE_DIR ?? "/app/models";

env.cacheDir = cacheDir;

console.log(`Prefetching ${MODEL_ID} into ${cacheDir} ...`);
const extractor = await pipeline("feature-extraction", MODEL_ID);

// Run one real inference: downloading the files is not proof they load, and a
// build is the right place to find that out rather than the first request.
const output = await extractor(["warmup"], { pooling: "mean", normalize: true });
const [vector] = output.tolist();

if (!Array.isArray(vector) || vector.length !== 384) {
  throw new Error(`Expected a 384-dimension vector, got ${Array.isArray(vector) ? vector.length : typeof vector}`);
}

console.log(`OK — model cached and verified (${vector.length} dimensions)`);
