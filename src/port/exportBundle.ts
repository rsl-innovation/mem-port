import { createHash } from "node:crypto";
import { DateTime, type SurrealSession } from "surrealdb";
import { BUNDLE_FORMAT_VERSION, type Bundle, type BundleEdge } from "./bundleSchema.js";

const PACKAGE_VERSION = "0.1.0";

export interface ExportScope {
  memoryTypes?: string[];
  since?: string;
}

interface EntityRow {
  id: unknown;
  name: string;
  entity_type: string;
  summary: string | null;
  attributes: Record<string, unknown>;
  embedding: number[] | null;
}

interface EpisodeRow {
  id: unknown;
  title: string;
  content: string;
  source: string;
  occurred_at: unknown;
  embedding: number[] | null;
}

interface MemoryRow {
  id: unknown;
  content: string;
  memory_type: string;
  importance: number;
  status: string;
  embedding: number[] | null;
  source_episode: unknown | null;
}

interface SkillRow {
  id: unknown;
  name: string;
  description: string;
  content: string;
  tags: string[];
  source: string;
  status: string;
  embedding: number[] | null;
}

interface AdrRow {
  id: unknown;
  number: number;
  title: string;
  context: string;
  decision: string;
  consequences: string | null;
  alternatives: string | null;
  status: string;
  supersedes: unknown | null;
  tags: string[];
  source: string;
  archived: boolean;
  decided_at: unknown;
  embedding: number[] | null;
}

interface EdgeRow {
  fromId: unknown;
  toId: unknown;
  relation_type?: string;
  attributes?: Record<string, unknown>;
}

function hashContent(content: string): string {
  return createHash("sha256").update(content).digest("hex");
}

export async function exportBundle(
  session: SurrealSession,
  libraryId: string,
  embeddingProvider: { id: string; dimensions: number },
  scope?: ExportScope
): Promise<Bundle> {
  const conditions: string[] = [];
  const bindings: Record<string, unknown> = {};
  if (scope?.memoryTypes && scope.memoryTypes.length > 0) {
    conditions.push("memory_type IN $memoryTypes");
    bindings.memoryTypes = scope.memoryTypes;
  }
  if (scope?.since) {
    conditions.push("created_at >= $since");
    bindings.since = new DateTime(scope.since);
  }
  const memoryWhere = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";

  const [entityRows] = await session.query<[EntityRow[]]>(`SELECT * FROM entity`);
  const [episodeRows] = await session.query<[EpisodeRow[]]>(`SELECT * FROM episode`);
  const [memoryRows] = await session.query<[MemoryRow[]]>(`SELECT * FROM memory ${memoryWhere}`, bindings);
  const [skillRows] = await session.query<[SkillRow[]]>(`SELECT * FROM skill`);
  // Ordered, unlike the other tables: import renumbers ADRs in array order, so
  // an unordered read here would shuffle the log's chronology across a port.
  const [adrRows] = await session.query<[AdrRow[]]>(`SELECT * FROM adr ORDER BY number ASC`);
  const [mentionRows] = await session.query<[EdgeRow[]]>(`SELECT in AS fromId, out AS toId FROM mentions`);
  const [relatesRows] = await session.query<[EdgeRow[]]>(
    `SELECT in AS fromId, out AS toId, relation_type, attributes FROM relates_to`
  );

  const includedRefs = new Set<string>();
  for (const row of memoryRows) includedRefs.add(String(row.id));
  for (const row of episodeRows) includedRefs.add(String(row.id));
  for (const row of skillRows) includedRefs.add(String(row.id));
  for (const row of adrRows) includedRefs.add(String(row.id));
  for (const row of entityRows) includedRefs.add(String(row.id));

  const edges: BundleEdge[] = [];
  for (const row of mentionRows) {
    const fromRef = String(row.fromId);
    const toRef = String(row.toId);
    if (includedRefs.has(fromRef) && includedRefs.has(toRef)) {
      edges.push({ type: "mentions", fromRef, toRef });
    }
  }
  for (const row of relatesRows) {
    const fromRef = String(row.fromId);
    const toRef = String(row.toId);
    if (includedRefs.has(fromRef) && includedRefs.has(toRef)) {
      edges.push({
        type: "relates_to",
        fromRef,
        toRef,
        relation_type: row.relation_type ?? "related_to",
        attributes: row.attributes ?? {},
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
    entities: entityRows.map((row) => ({
      ref: String(row.id),
      name: row.name,
      entity_type: row.entity_type,
      summary: row.summary,
      attributes: row.attributes ?? {},
      embedding: row.embedding,
    })),
    episodes: episodeRows.map((row) => ({
      ref: String(row.id),
      title: row.title,
      content: row.content,
      source: row.source,
      occurred_at: String(row.occurred_at),
      embedding: row.embedding,
      contentHash: hashContent(`${row.title}\n${row.content}`),
    })),
    memories: memoryRows.map((row) => ({
      ref: String(row.id),
      content: row.content,
      memory_type: row.memory_type,
      importance: row.importance,
      status: row.status,
      embedding: row.embedding,
      sourceEpisodeRef: row.source_episode ? String(row.source_episode) : null,
      contentHash: hashContent(row.content),
    })),
    skills: skillRows.map((row) => ({
      ref: String(row.id),
      name: row.name,
      description: row.description,
      content: row.content,
      tags: row.tags ?? [],
      source: row.source,
      status: row.status,
      embedding: row.embedding,
      contentHash: hashContent(`${row.name}\n${row.description}\n${row.content}`),
    })),
    adrs: adrRows.map((row) => ({
      ref: String(row.id),
      number: row.number,
      title: row.title,
      context: row.context,
      decision: row.decision,
      consequences: row.consequences,
      alternatives: row.alternatives,
      status: row.status,
      supersedesRef: row.supersedes ? String(row.supersedes) : null,
      tags: row.tags ?? [],
      source: row.source,
      archived: row.archived,
      decided_at: String(row.decided_at),
      embedding: row.embedding,
      contentHash: hashContent(`${row.title}\n${row.context}\n${row.decision}`),
    })),
    edges,
  };
}
