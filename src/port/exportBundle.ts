import type { LibraryStore } from "../interfaces/store.interface.js";
import { BUNDLE_FORMAT_VERSION, type Bundle, type BundleEdge } from "./bundleSchema.js";
import { hashRow } from "./contentHash.js";

const PACKAGE_VERSION = "0.1.0";

export interface ExportScope {
  memoryTypes?: string[];
  since?: string;
}

/**
 * Everything in a library as one portable bundle.
 *
 * Store-agnostic: seven contract reads and then pure shaping. Record ids become
 * `ref` strings that only have to be internally consistent within the bundle,
 * which is what lets an import remap them onto whatever ids the target
 * assigns — including a target running a different storage engine entirely.
 */
export async function exportBundle(
  store: LibraryStore,
  libraryId: string,
  embeddingProvider: { id: string; dimensions: number },
  scope?: ExportScope
): Promise<Bundle> {
  const entities = await store.entities.listAll();
  const episodes = await store.episodes.listAll();
  const memories = await store.memories.listAll(
    scope ? { memory_types: scope.memoryTypes, since: scope.since } : undefined
  );
  const skills = await store.skills.listAll();
  const adrs = await store.adrs.listAll();
  const mentions = await store.graph.listMentions();
  const relations = await store.graph.listRelations();

  // A scoped export can leave an edge with one endpoint outside the bundle;
  // carrying it would produce a dangling ref that the importer could only drop.
  const includedRefs = new Set<string>([
    ...entities.map((row) => row.id),
    ...episodes.map((row) => row.id),
    ...memories.map((row) => row.id),
    ...skills.map((row) => row.id),
    ...adrs.map((row) => row.id),
  ]);

  const edges: BundleEdge[] = [];
  for (const edge of mentions) {
    if (includedRefs.has(edge.fromId) && includedRefs.has(edge.toId)) {
      edges.push({ type: "mentions", fromRef: edge.fromId, toRef: edge.toId });
    }
  }
  for (const edge of relations) {
    if (includedRefs.has(edge.fromId) && includedRefs.has(edge.toId)) {
      edges.push({
        type: "relates_to",
        fromRef: edge.fromId,
        toRef: edge.toId,
        relation_type: edge.relation_type,
        attributes: edge.attributes,
      });
    }
  }

  return {
    formatVersion: BUNDLE_FORMAT_VERSION,
    memportVersion: PACKAGE_VERSION,
    exportedAt: new Date().toISOString(),
    sourceLibraryId: libraryId,
    embeddingProvider,
    scope: scope ? { type: "filtered", memory_types: scope.memoryTypes, since: scope.since } : { type: "all" },
    entities: entities.map((row) => ({
      ref: row.id,
      name: row.name,
      entity_type: row.entity_type,
      summary: row.summary,
      attributes: row.attributes ?? {},
      embedding: row.embedding,
    })),
    episodes: episodes.map((row) => ({
      ref: row.id,
      title: row.title,
      content: row.content,
      source: row.source,
      occurred_at: row.occurred_at,
      embedding: row.embedding,
      contentHash: hashRow("episode", row as unknown as Record<string, unknown>),
    })),
    memories: memories.map((row) => ({
      ref: row.id,
      content: row.content,
      memory_type: row.memory_type,
      importance: row.importance,
      status: row.status,
      embedding: row.embedding,
      sourceEpisodeRef: row.source_episode_id ?? null,
      contentHash: hashRow("memory", row as unknown as Record<string, unknown>),
    })),
    skills: skills.map((row) => ({
      ref: row.id,
      name: row.name,
      description: row.description,
      content: row.content,
      tags: row.tags ?? [],
      source: row.source,
      status: row.status,
      embedding: row.embedding,
      contentHash: hashRow("skill", row as unknown as Record<string, unknown>),
    })),
    adrs: adrs.map((row) => ({
      ref: row.id,
      number: row.number,
      title: row.title,
      context: row.context,
      decision: row.decision,
      consequences: row.consequences,
      alternatives: row.alternatives,
      status: row.status,
      supersedesRef: row.supersedes_id ?? null,
      tags: row.tags ?? [],
      source: row.source,
      archived: row.archived,
      decided_at: row.decided_at,
      embedding: row.embedding,
      contentHash: hashRow("adr", row as unknown as Record<string, unknown>),
    })),
    edges,
  };
}
