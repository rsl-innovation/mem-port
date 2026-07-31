import { z } from "zod";

export const BUNDLE_FORMAT_VERSION = 1;

const entitySchema = z.object({
  ref: z.string(),
  name: z.string(),
  entity_type: z.string(),
  summary: z.string().nullable().optional(),
  attributes: z.record(z.string(), z.unknown()).default({}),
  embedding: z.array(z.number()).nullable().optional(),
});

const episodeSchema = z.object({
  ref: z.string(),
  title: z.string(),
  content: z.string(),
  source: z.string(),
  occurred_at: z.string(),
  embedding: z.array(z.number()).nullable().optional(),
  contentHash: z.string(),
});

const memorySchema = z.object({
  ref: z.string(),
  content: z.string(),
  memory_type: z.string(),
  importance: z.number(),
  status: z.string(),
  embedding: z.array(z.number()).nullable().optional(),
  sourceEpisodeRef: z.string().nullable().optional(),
  contentHash: z.string(),
});

const skillSchema = z.object({
  ref: z.string(),
  name: z.string(),
  description: z.string(),
  content: z.string(),
  tags: z.array(z.string()).default([]),
  source: z.string(),
  status: z.string(),
  embedding: z.array(z.number()).nullable().optional(),
  contentHash: z.string(),
});

const mentionsEdgeSchema = z.object({
  type: z.literal("mentions"),
  fromRef: z.string(),
  toRef: z.string(),
});

const relatesToEdgeSchema = z.object({
  type: z.literal("relates_to"),
  fromRef: z.string(),
  toRef: z.string(),
  relation_type: z.string(),
  attributes: z.record(z.string(), z.unknown()).default({}),
});

const edgeSchema = z.discriminatedUnion("type", [mentionsEdgeSchema, relatesToEdgeSchema]);

export const bundleSchema = z.object({
  formatVersion: z.literal(BUNDLE_FORMAT_VERSION),
  memportVersion: z.string(),
  exportedAt: z.string(),
  sourceLibraryId: z.string(),
  embeddingProvider: z.object({ id: z.string(), dimensions: z.number() }),
  scope: z.union([
    z.object({ type: z.literal("all") }),
    z.object({
      type: z.literal("filtered"),
      memory_types: z.array(z.string()).optional(),
      since: z.string().optional(),
    }),
  ]),
  entities: z.array(entitySchema),
  episodes: z.array(episodeSchema),
  memories: z.array(memorySchema),
  skills: z.array(skillSchema).default([]),
  edges: z.array(edgeSchema),
});

export type Bundle = z.infer<typeof bundleSchema>;
export type BundleEntity = z.infer<typeof entitySchema>;
export type BundleEpisode = z.infer<typeof episodeSchema>;
export type BundleMemory = z.infer<typeof memorySchema>;
export type BundleSkill = z.infer<typeof skillSchema>;
export type BundleEdge = z.infer<typeof edgeSchema>;
