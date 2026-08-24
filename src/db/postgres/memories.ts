import type { Id, Vector } from "../../interfaces/common.interface.js";
import type {
  MemoryExportScope,
  MemoryHit,
  MemoryPatch,
  MemoryRecord,
  MemorySearchFilter,
  NewMemory,
} from "../../interfaces/memories.interface.js";
import type { MemoryStore } from "../../interfaces/store.interface.js";
import { hashRow } from "../../port/contentHash.js";
import { fromVectorLiteral, toId, toUuid, toVectorLiteral } from "./map.js";
import type { Queryable } from "./queryable.js";

export class PostgresMemoryStore implements MemoryStore {
  constructor(
    private readonly q: Queryable,
    private readonly s: string
  ) {}

  async create(input: NewMemory): Promise<Id> {
    const { rows } = await this.q.query<{ id: string }>(
      `INSERT INTO ${this.s}.memory (content, memory_type, importance, status, embedding, source_episode)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING id`,
      [
        input.content,
        input.memory_type ?? "fact",
        input.importance ?? 0.5,
        input.status ?? "active",
        toVectorLiteral(input.embedding),
        toUuid(input.source_episode_id),
      ]
    );
    return toId("memory", rows[0].id);
  }

  async update(id: Id, patch: MemoryPatch): Promise<void> {
    const uuid = toUuid(id);
    if (!uuid) return;

    const sets: string[] = [];
    const values: unknown[] = [];
    const set = (col: string, value: unknown) => {
      values.push(value);
      sets.push(`${col} = $${values.length}`);
    };

    if (patch.content !== undefined) set("content", patch.content);
    if (patch.memory_type !== undefined) set("memory_type", patch.memory_type);
    if (patch.importance !== undefined) set("importance", patch.importance);
    if (patch.status !== undefined) set("status", patch.status);
    if (patch.embedding !== undefined) set("embedding", toVectorLiteral(patch.embedding));
    if (patch.source_episode_id !== undefined) set("source_episode", toUuid(patch.source_episode_id));
    if (sets.length === 0) return;

    values.push(uuid);
    await this.q.query(
      `UPDATE ${this.s}.memory SET ${sets.join(", ")}, updated_at = now() WHERE id = $${values.length}`,
      values
    );
  }

  async archive(id: Id): Promise<void> {
    const uuid = toUuid(id);
    if (!uuid) return;
    await this.q.query(`UPDATE ${this.s}.memory SET status = 'archived', updated_at = now() WHERE id = $1`, [uuid]);
  }

  async remove(id: Id): Promise<void> {
    const uuid = toUuid(id);
    if (!uuid) return;
    await this.q.query(`DELETE FROM ${this.s}.mentions WHERE from_table = 'memory' AND from_id = $1`, [uuid]);
    await this.q.query(`DELETE FROM ${this.s}.memory WHERE id = $1`, [uuid]);
  }

  async search(vector: Vector, filter: MemorySearchFilter): Promise<MemoryHit[]> {
    const conditions = ["embedding IS NOT NULL"];
    const values: unknown[] = [toVectorLiteral(vector)];
    const add = (sql: string, value: unknown) => {
      values.push(value);
      conditions.push(sql.replace("?", `$${values.length}`));
    };

    if (filter.status !== undefined) add("status = ?", filter.status);
    if (filter.memory_types && filter.memory_types.length > 0) add("memory_type = ANY(?)", filter.memory_types);

    values.push(filter.limit);

    const { rows } = await this.q.query<Record<string, unknown>>(
      `SELECT id, content, memory_type, importance, 1 - (embedding <=> $1::vector) AS score
       FROM ${this.s}.memory
       WHERE ${conditions.join(" AND ")}
       ORDER BY embedding <=> $1::vector
       LIMIT $${values.length}`,
      values
    );

    return rows.map((r) => ({
      id: toId("memory", r.id as string),
      content: r.content as string,
      memory_type: r.memory_type as string,
      importance: Number(r.importance),
      score: Number(r.score),
    }));
  }

  async listAll(scope?: MemoryExportScope): Promise<MemoryRecord[]> {
    const conditions: string[] = [];
    const values: unknown[] = [];
    const add = (sql: string, value: unknown) => {
      values.push(value);
      conditions.push(sql.replace("?", `$${values.length}`));
    };

    if (scope?.memory_types && scope.memory_types.length > 0) add("memory_type = ANY(?)", scope.memory_types);
    if (scope?.since) add("created_at >= ?", scope.since);

    const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
    const { rows } = await this.q.query<Record<string, unknown>>(
      `SELECT id, content, memory_type, importance, status, source_episode, embedding::text AS embedding
       FROM ${this.s}.memory ${where}`,
      values
    );

    return rows.map((r) => ({
      id: toId("memory", r.id as string),
      content: r.content as string,
      memory_type: r.memory_type as string,
      importance: Number(r.importance),
      status: r.status as string,
      // NULL becomes undefined, never null: an unset link must stay absent
      // from the exported bundle rather than becoming an explicit null.
      source_episode_id: r.source_episode === null ? undefined : toId("episode", r.source_episode as string),
      embedding: fromVectorLiteral(r.embedding),
    }));
  }

  async hashIndex(): Promise<Map<string, Id>> {
    const { rows } = await this.q.query<Record<string, unknown>>(`SELECT id, content FROM ${this.s}.memory`);
    const index = new Map<string, Id>();
    for (const r of rows) index.set(hashRow("memory", r), toId("memory", r.id as string));
    return index;
  }
}
