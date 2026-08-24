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
import { fromVectorLiteral, toId, toIso, toUuid, toVectorLiteral } from "./map.js";
import type { Queryable } from "./queryable.js";

export class PostgresEpisodeStore implements EpisodeStore {
  constructor(
    private readonly q: Queryable,
    private readonly s: string
  ) {}

  async create(input: NewEpisode): Promise<Id> {
    const { rows } = await this.q.query<{ id: string }>(
      `INSERT INTO ${this.s}.episode (title, content, source, occurred_at, embedding)
       VALUES ($1, $2, $3, COALESCE($4::timestamptz, now()), $5)
       RETURNING id`,
      [input.title, input.content, input.source, input.occurred_at ?? null, toVectorLiteral(input.embedding)]
    );
    return toId("episode", rows[0].id);
  }

  async update(id: Id, patch: EpisodePatch): Promise<void> {
    const uuid = toUuid(id);
    if (!uuid) return;

    const sets: string[] = [];
    const values: unknown[] = [];
    const set = (col: string, value: unknown) => {
      values.push(value);
      sets.push(`${col} = $${values.length}`);
    };

    if (patch.title !== undefined) set("title", patch.title);
    if (patch.content !== undefined) set("content", patch.content);
    if (patch.source !== undefined) set("source", patch.source);
    if (patch.occurred_at !== undefined) set("occurred_at", patch.occurred_at);
    if (patch.embedding !== undefined) set("embedding", toVectorLiteral(patch.embedding));
    if (sets.length === 0) return;

    values.push(uuid);
    await this.q.query(`UPDATE ${this.s}.episode SET ${sets.join(", ")} WHERE id = $${values.length}`, values);
  }

  async list(filter: EpisodeListFilter): Promise<EpisodeSummary[]> {
    const conditions: string[] = [];
    const values: unknown[] = [];
    const add = (sql: string, value: unknown) => {
      values.push(value);
      conditions.push(sql.replace("?", `$${values.length}`));
    };

    if (filter.since) add("occurred_at >= ?", filter.since);
    if (filter.until) add("occurred_at <= ?", filter.until);
    if (filter.source !== undefined) add("source = ?", filter.source);

    const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
    values.push(filter.limit);

    const { rows } = await this.q.query<Record<string, unknown>>(
      `SELECT id, title, content, source, occurred_at FROM ${this.s}.episode
       ${where} ORDER BY occurred_at DESC LIMIT $${values.length}`,
      values
    );

    return rows.map((r) => ({
      id: toId("episode", r.id as string),
      title: r.title as string,
      content: r.content as string,
      source: r.source as string,
      occurred_at: toIso(r.occurred_at),
    }));
  }

  async listAll(): Promise<EpisodeRecord[]> {
    const { rows } = await this.q.query<Record<string, unknown>>(
      `SELECT id, title, content, source, occurred_at, embedding::text AS embedding FROM ${this.s}.episode`
    );
    return rows.map((r) => ({
      id: toId("episode", r.id as string),
      title: r.title as string,
      content: r.content as string,
      source: r.source as string,
      occurred_at: toIso(r.occurred_at),
      embedding: fromVectorLiteral(r.embedding),
    }));
  }

  async hashIndex(): Promise<Map<string, Id>> {
    const { rows } = await this.q.query<Record<string, unknown>>(`SELECT id, title, content FROM ${this.s}.episode`);
    const index = new Map<string, Id>();
    for (const r of rows) index.set(hashRow("episode", r), toId("episode", r.id as string));
    return index;
  }
}
