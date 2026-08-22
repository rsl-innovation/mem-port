import type { SurrealQueryable } from "surrealdb";
import type { Id } from "../../interfaces/common.interface.js";
import type {
  EpisodeListFilter,
  EpisodePatch,
  EpisodeRecord,
  EpisodeSummary,
  NewEpisode,
} from "../../interfaces/episodes.interface.js";
import type { EpisodeStore } from "../../interfaces/store.interface.js";
import { hashRow } from "../../port/contentHash.js";
import { fromIso, toId, toIso, toRecordId, toVector } from "./map.js";

interface EpisodeRow {
  id: unknown;
  title: string;
  content: string;
  source: string;
  occurred_at: unknown;
  embedding?: number[] | null;
}

export class SurrealEpisodeStore implements EpisodeStore {
  constructor(private readonly q: SurrealQueryable) {}

  async create(input: NewEpisode): Promise<Id> {
    const [created] = await this.q.query<[Array<{ id: unknown }>]>(
      `CREATE episode CONTENT {
         title: $title,
         content: $content,
         source: $source,
         occurred_at: $occurred_at,
         embedding: $embedding
       }`,
      {
        title: input.title,
        content: input.content,
        source: input.source,
        occurred_at: fromIso(input.occurred_at),
        embedding: input.embedding ?? undefined,
      }
    );
    return toId(created[0].id);
  }

  async update(id: Id, patch: EpisodePatch): Promise<void> {
    const assignments: string[] = [];
    const bindings: Record<string, unknown> = { id: toRecordId(id) };

    for (const field of ["title", "content", "source"] as const) {
      if (patch[field] !== undefined) {
        assignments.push(`${field} = $${field}`);
        bindings[field] = patch[field];
      }
    }
    if (patch.occurred_at !== undefined) {
      assignments.push("occurred_at = $occurred_at");
      bindings.occurred_at = fromIso(patch.occurred_at);
    }
    if (patch.embedding !== undefined) {
      assignments.push("embedding = $embedding");
      bindings.embedding = patch.embedding ?? undefined;
    }
    if (assignments.length === 0) return;

    await this.q.query(`UPDATE $id SET ${assignments.join(", ")}`, bindings);
  }

  async list(filter: EpisodeListFilter): Promise<EpisodeSummary[]> {
    const conditions: string[] = [];
    const bindings: Record<string, unknown> = { limit: filter.limit };

    if (filter.since) {
      conditions.push("occurred_at >= $since");
      bindings.since = fromIso(filter.since);
    }
    if (filter.until) {
      conditions.push("occurred_at <= $until");
      bindings.until = fromIso(filter.until);
    }
    if (filter.source !== undefined) {
      conditions.push("source = $source");
      bindings.source = filter.source;
    }

    const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
    const [rows] = await this.q.query<[EpisodeRow[]]>(
      `SELECT id, title, content, source, occurred_at FROM episode
       ${where}
       ORDER BY occurred_at DESC
       LIMIT $limit`,
      bindings
    );

    return rows.map((row) => ({
      id: toId(row.id),
      title: row.title,
      content: row.content,
      source: row.source,
      occurred_at: toIso(row.occurred_at),
    }));
  }

  async listAll(): Promise<EpisodeRecord[]> {
    const [rows] = await this.q.query<[EpisodeRow[]]>(`SELECT * FROM episode`);
    return rows.map((row) => ({
      id: toId(row.id),
      title: row.title,
      content: row.content,
      source: row.source,
      occurred_at: toIso(row.occurred_at),
      embedding: toVector(row.embedding),
    }));
  }

  async hashIndex(): Promise<Map<string, Id>> {
    const [rows] = await this.q.query<[EpisodeRow[]]>(`SELECT id, title, content FROM episode`);
    const index = new Map<string, Id>();
    for (const row of rows) {
      index.set(hashRow("episode", row as unknown as Record<string, unknown>), toId(row.id));
    }
    return index;
  }
}
