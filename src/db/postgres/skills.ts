import type { Id, Vector } from "../../interfaces/common.interface.js";
import type {
  NewSkill,
  SkillDetail,
  SkillHit,
  SkillIdentity,
  SkillListFilter,
  SkillPatch,
  SkillRecord,
  SkillSearchFilter,
  SkillSummary,
} from "../../interfaces/skills.interface.js";
import type { SkillStore } from "../../interfaces/store.interface.js";
import { hashRow } from "../../port/contentHash.js";
import { fromNullable, fromVectorLiteral, toId, toIso, toUuid, toVectorLiteral } from "./map.js";
import type { Queryable } from "./queryable.js";

export class PostgresSkillStore implements SkillStore {
  constructor(
    private readonly q: Queryable,
    private readonly s: string
  ) {}

  async create(input: NewSkill): Promise<Id> {
    const { rows } = await this.q.query<{ id: string }>(
      `INSERT INTO ${this.s}.skill (name, description, content, tags, source, status, embedding, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, COALESCE($8::timestamptz, now()))
       RETURNING id`,
      [
        input.name,
        input.description,
        input.content,
        input.tags,
        input.source,
        input.status ?? "active",
        toVectorLiteral(input.embedding),
        input.created_at ?? null,
      ]
    );
    return toId("skill", rows[0].id);
  }

  async update(id: Id, patch: SkillPatch): Promise<void> {
    const uuid = toUuid(id);
    if (!uuid) return;

    const sets: string[] = [];
    const values: unknown[] = [];
    const set = (col: string, value: unknown) => {
      values.push(value);
      sets.push(`${col} = $${values.length}`);
    };

    if (patch.description !== undefined) set("description", patch.description);
    if (patch.content !== undefined) set("content", patch.content);
    if (patch.tags !== undefined) set("tags", patch.tags);
    if (patch.source !== undefined) set("source", patch.source);
    if (patch.status !== undefined) set("status", patch.status);
    if (patch.embedding !== undefined) set("embedding", toVectorLiteral(patch.embedding));
    if (sets.length === 0) return;

    values.push(uuid);
    await this.q.query(
      `UPDATE ${this.s}.skill SET ${sets.join(", ")}, updated_at = now() WHERE id = $${values.length}`,
      values
    );
  }

  async archive(id: Id): Promise<void> {
    const uuid = toUuid(id);
    if (!uuid) return;
    await this.q.query(`UPDATE ${this.s}.skill SET status = 'archived', updated_at = now() WHERE id = $1`, [uuid]);
  }

  async remove(id: Id): Promise<void> {
    const uuid = toUuid(id);
    if (!uuid) return;
    // Outbound mentions go too: `mentions.from_id` carries no foreign key
    // (it is polymorphic), so nothing would clean them up otherwise.
    await this.q.query(`DELETE FROM ${this.s}.mentions WHERE from_table = 'skill' AND from_id = $1`, [uuid]);
    await this.q.query(`DELETE FROM ${this.s}.skill WHERE id = $1`, [uuid]);
  }

  /**
   * Every version of a name, newest first.
   *
   * The SurrealDB driver must filter status in JS here, to work around an
   * index-planner bug that makes `name = $1 AND status = $2` return nothing
   * once two rows share a name. Postgres has no such problem, so the filter
   * goes in the WHERE clause where it belongs — which is precisely the kind of
   * engine-specific workaround the contract exists to keep out of shared code.
   */
  async findByName(name: string, opts?: { status?: string }): Promise<SkillIdentity[]> {
    const values: unknown[] = [name];
    let where = "name = $1";
    if (opts?.status !== undefined) {
      values.push(opts.status);
      where += ` AND status = $2`;
    }

    const { rows } = await this.q.query<{ id: string; name: string; status: string; created_at: Date }>(
      `SELECT id, name, status, created_at FROM ${this.s}.skill WHERE ${where} ORDER BY created_at DESC`,
      values
    );
    return rows.map((r) => ({
      id: toId("skill", r.id),
      name: r.name,
      status: r.status,
      created_at: toIso(r.created_at),
    }));
  }

  async getForArchive(id: Id): Promise<NewSkill | null> {
    const uuid = toUuid(id);
    if (!uuid) return null;

    const { rows } = await this.q.query<Record<string, unknown>>(
      `SELECT name, description, content, tags, source, status, embedding::text AS embedding, created_at
       FROM ${this.s}.skill WHERE id = $1`,
      [uuid]
    );
    const r = rows[0];
    if (!r) return null;

    return {
      name: r.name as string,
      description: r.description as string,
      content: r.content as string,
      tags: r.tags as string[],
      source: r.source as string,
      status: r.status as string,
      embedding: fromVectorLiteral(r.embedding),
      created_at: toIso(r.created_at),
    };
  }

  async getById(id: Id): Promise<SkillDetail | null> {
    const uuid = toUuid(id);
    if (!uuid) return null;

    const { rows } = await this.q.query<Record<string, unknown>>(
      `SELECT s.*,
              COALESCE((
                SELECT json_agg(json_build_object('id', e.id, 'name', e.name) ORDER BY e.name)
                FROM ${this.s}.mentions m
                JOIN ${this.s}.entity e ON e.id = m.to_id
                WHERE m.from_table = 'skill' AND m.from_id = s.id
              ), '[]'::json) AS mentioned_entities
       FROM ${this.s}.skill s WHERE s.id = $1`,
      [uuid]
    );
    const r = rows[0];
    if (!r) return null;

    return {
      id: toId("skill", r.id as string),
      name: r.name as string,
      description: r.description as string,
      content: r.content as string,
      tags: r.tags as string[],
      source: r.source as string,
      status: r.status as string,
      created_at: toIso(r.created_at),
      updated_at: toIso(r.updated_at),
      mentioned_entities: (r.mentioned_entities as Array<{ id: string; name: string }>).map((e) => ({
        id: toId("entity", e.id),
        name: e.name,
      })),
    };
  }

  async list(filter: SkillListFilter): Promise<SkillSummary[]> {
    const conditions: string[] = [];
    const values: unknown[] = [];
    const add = (sql: string, value: unknown) => {
      values.push(value);
      conditions.push(sql.replace("?", `$${values.length}`));
    };

    if (filter.status !== undefined) add("status = ?", filter.status);
    if (filter.tag !== undefined) add("? = ANY(tags)", filter.tag);
    if (filter.source !== undefined) add("source = ?", filter.source);

    const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
    values.push(filter.limit);

    const { rows } = await this.q.query<Record<string, unknown>>(
      `SELECT id, name, description, tags, source, created_at FROM ${this.s}.skill
       ${where} ORDER BY created_at DESC LIMIT $${values.length}`,
      values
    );

    return rows.map((r) => ({
      id: toId("skill", r.id as string),
      name: r.name as string,
      description: r.description as string,
      tags: r.tags as string[],
      source: r.source as string,
      created_at: toIso(r.created_at),
    }));
  }

  /**
   * Ranked by cosine similarity.
   *
   * pgvector's `<=>` is cosine *distance*, so similarity is `1 - distance` and
   * ordering ascending by distance is descending by similarity. Written as
   * distance in ORDER BY rather than as the derived similarity so an HNSW index
   * can serve it later without rewriting the query.
   */
  async search(vector: Vector, filter: SkillSearchFilter): Promise<SkillHit[]> {
    const conditions = ["embedding IS NOT NULL"];
    const values: unknown[] = [toVectorLiteral(vector)];
    const add = (sql: string, value: unknown) => {
      values.push(value);
      conditions.push(sql.replace("?", `$${values.length}`));
    };

    if (filter.status !== undefined) add("status = ?", filter.status);
    if (filter.tags && filter.tags.length > 0) add("tags && ?", filter.tags);

    values.push(filter.limit);

    const { rows } = await this.q.query<Record<string, unknown>>(
      `SELECT id, name, description, tags, source, 1 - (embedding <=> $1::vector) AS score
       FROM ${this.s}.skill
       WHERE ${conditions.join(" AND ")}
       ORDER BY embedding <=> $1::vector
       LIMIT $${values.length}`,
      values
    );

    return rows.map((r) => ({
      id: toId("skill", r.id as string),
      name: r.name as string,
      description: r.description as string,
      tags: r.tags as string[],
      source: r.source as string,
      score: Number(r.score),
    }));
  }

  async listAll(): Promise<SkillRecord[]> {
    const { rows } = await this.q.query<Record<string, unknown>>(
      `SELECT id, name, description, content, tags, source, status, embedding::text AS embedding
       FROM ${this.s}.skill`
    );
    return rows.map((r) => ({
      id: toId("skill", r.id as string),
      name: r.name as string,
      description: r.description as string,
      content: r.content as string,
      tags: r.tags as string[],
      source: r.source as string,
      status: r.status as string,
      embedding: fromVectorLiteral(r.embedding),
    }));
  }

  async hashIndex(): Promise<Map<string, Id>> {
    const { rows } = await this.q.query<Record<string, unknown>>(
      `SELECT id, name, description, content FROM ${this.s}.skill`
    );
    const index = new Map<string, Id>();
    for (const r of rows) {
      index.set(hashRow("skill", r), toId("skill", r.id as string));
    }
    return index;
  }
}

/** Re-exported so sibling stores share the nullable convention. */
export { fromNullable };
