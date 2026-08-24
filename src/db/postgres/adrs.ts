import type { Id, Vector } from "../../interfaces/common.interface.js";
import type {
  AdrDetail,
  AdrHit,
  AdrListFilter,
  AdrPatch,
  AdrRecord,
  AdrSearchFilter,
  AdrSummary,
  NewAdr,
} from "../../interfaces/adrs.interface.js";
import type { AdrStore } from "../../interfaces/store.interface.js";
import { hashRow } from "../../port/contentHash.js";
import { fromNullable, fromVectorLiteral, toId, toIso, toUuid, toVectorLiteral } from "./map.js";
import type { Queryable } from "./queryable.js";

export class PostgresAdrStore implements AdrStore {
  constructor(
    private readonly q: Queryable,
    private readonly s: string
  ) {}

  /**
   * Highest number plus one.
   *
   * A plain aggregate, unlike the SurrealDB driver, which has to full-scan and
   * take the max in JS because `ORDER BY … LIMIT 1` resolves against the index
   * and returns nothing inside a transaction. Archived ADRs keep their numbers,
   * so `archived` is deliberately not filtered: reusing a number would rewrite
   * a supersede chain an older ADR still points into.
   */
  async nextNumber(): Promise<number> {
    const { rows } = await this.q.query<{ next: string }>(
      `SELECT COALESCE(MAX(number), 0) + 1 AS next FROM ${this.s}.adr`
    );
    return Number(rows[0].next);
  }

  async resolveRef(ref: string | number): Promise<Id | null> {
    if (typeof ref === "string" && ref.includes(":")) {
      const uuid = toUuid(ref);
      if (!uuid) return null;
      const { rows } = await this.q.query<{ id: string }>(`SELECT id FROM ${this.s}.adr WHERE id = $1`, [uuid]);
      return rows[0] ? toId("adr", rows[0].id) : null;
    }

    const number = typeof ref === "number" ? ref : Number(String(ref).replace(/^ADR-/i, ""));
    if (!Number.isInteger(number)) return null;

    const { rows } = await this.q.query<{ id: string }>(`SELECT id FROM ${this.s}.adr WHERE number = $1 LIMIT 1`, [
      number,
    ]);
    return rows[0] ? toId("adr", rows[0].id) : null;
  }

  async create(input: NewAdr): Promise<Id> {
    const { rows } = await this.q.query<{ id: string }>(
      `INSERT INTO ${this.s}.adr
         (number, title, context, decision, consequences, alternatives, status, supersedes,
          tags, source, archived, decided_at, embedding)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11, COALESCE($12::timestamptz, now()), $13)
       RETURNING id`,
      [
        input.number,
        input.title,
        input.context,
        input.decision,
        input.consequences ?? null,
        input.alternatives ?? null,
        input.status ?? "proposed",
        toUuid(input.supersedes_id),
        input.tags ?? [],
        input.source ?? "manual",
        input.archived ?? false,
        input.decided_at ?? null,
        toVectorLiteral(input.embedding),
      ]
    );
    return toId("adr", rows[0].id);
  }

  async update(id: Id, patch: AdrPatch): Promise<void> {
    const uuid = toUuid(id);
    if (!uuid) return;

    const sets: string[] = [];
    const values: unknown[] = [];
    const set = (col: string, value: unknown) => {
      values.push(value);
      sets.push(`${col} = $${values.length}`);
    };

    for (const field of ["title", "context", "decision", "status", "source"] as const) {
      if (patch[field] !== undefined) set(field, patch[field]);
    }
    if (patch.tags !== undefined) set("tags", patch.tags);
    if (patch.archived !== undefined) set("archived", patch.archived);
    if (patch.consequences !== undefined) set("consequences", patch.consequences ?? null);
    if (patch.alternatives !== undefined) set("alternatives", patch.alternatives ?? null);
    if (patch.decided_at !== undefined) set("decided_at", patch.decided_at);
    if (patch.embedding !== undefined) set("embedding", toVectorLiteral(patch.embedding));
    if (sets.length === 0) return;

    values.push(uuid);
    await this.q.query(
      `UPDATE ${this.s}.adr SET ${sets.join(", ")}, updated_at = now() WHERE id = $${values.length}`,
      values
    );
  }

  async archive(id: Id): Promise<void> {
    const uuid = toUuid(id);
    if (!uuid) return;
    await this.q.query(`UPDATE ${this.s}.adr SET archived = true, updated_at = now() WHERE id = $1`, [uuid]);
  }

  async remove(id: Id): Promise<void> {
    const uuid = toUuid(id);
    if (!uuid) return;
    await this.q.query(`DELETE FROM ${this.s}.mentions WHERE from_table = 'adr' AND from_id = $1`, [uuid]);
    await this.q.query(`DELETE FROM ${this.s}.adr WHERE id = $1`, [uuid]);
  }

  async setSupersedes(id: Id, target: Id | null): Promise<void> {
    const uuid = toUuid(id);
    if (!uuid) return;
    await this.q.query(`UPDATE ${this.s}.adr SET supersedes = $1 WHERE id = $2`, [toUuid(target), uuid]);
  }

  async clearSupersedesPointingAt(id: Id): Promise<void> {
    const uuid = toUuid(id);
    if (!uuid) return;
    await this.q.query(`UPDATE ${this.s}.adr SET supersedes = NULL WHERE supersedes = $1`, [uuid]);
  }

  async getDetail(lookup: { id: Id } | { number: number }): Promise<AdrDetail | null> {
    const byId = "id" in lookup;
    const { rows } = await this.q.query<Record<string, unknown>>(
      `SELECT a.*,
        (SELECT json_build_object('id', p.id, 'number', p.number, 'title', p.title, 'status', p.status)
         FROM ${this.s}.adr p WHERE p.id = a.supersedes) AS supersedes_link,
        COALESCE((SELECT json_agg(json_build_object('id', c.id, 'number', c.number, 'title', c.title) ORDER BY c.number)
         FROM ${this.s}.adr c WHERE c.supersedes = a.id), '[]'::json) AS superseded_by,
        COALESCE((SELECT json_agg(json_build_object('id', e.id, 'name', e.name) ORDER BY e.name)
         FROM ${this.s}.mentions m JOIN ${this.s}.entity e ON e.id = m.to_id
         WHERE m.from_table = 'adr' AND m.from_id = a.id), '[]'::json) AS mentioned_entities
       FROM ${this.s}.adr a WHERE ${byId ? "a.id = $1" : "a.number = $1"} LIMIT 1`,
      [byId ? toUuid(lookup.id) : lookup.number]
    );

    const r = rows[0];
    if (!r) return null;

    const link = r.supersedes_link as { id: string; number: number; title: string; status: string } | null;
    const asArray = <T>(v: unknown): T[] => (Array.isArray(v) ? (v as T[]) : []);

    return {
      ...toAdr(r),
      supersedes: link ? { id: toId("adr", link.id), number: link.number, title: link.title, status: link.status } : null,
      superseded_by: asArray<{ id: string; number: number; title: string }>(r.superseded_by).map((x) => ({
        id: toId("adr", x.id),
        number: x.number,
        title: x.title,
      })),
      mentioned_entities: asArray<{ id: string; name: string }>(r.mentioned_entities).map((e) => ({
        id: toId("entity", e.id),
        name: e.name,
      })),
    };
  }

  async list(filter: AdrListFilter): Promise<AdrSummary[]> {
    const conditions = ["archived = false"];
    const values: unknown[] = [];
    const add = (sql: string, value: unknown) => {
      values.push(value);
      conditions.push(sql.replace("?", `$${values.length}`));
    };

    if (filter.status !== undefined) add("status = ?", filter.status);
    if (filter.tag !== undefined) add("? = ANY(tags)", filter.tag);
    if (filter.source !== undefined) add("source = ?", filter.source);
    values.push(filter.limit);

    const { rows } = await this.q.query<Record<string, unknown>>(
      `SELECT id, number, title, decision, status, tags, source, supersedes, decided_at
       FROM ${this.s}.adr WHERE ${conditions.join(" AND ")}
       ORDER BY number DESC LIMIT $${values.length}`,
      values
    );

    return rows.map((r) => ({
      id: toId("adr", r.id as string),
      number: r.number as number,
      title: r.title as string,
      decision: r.decision as string,
      status: r.status as string,
      tags: r.tags as string[],
      source: r.source as string,
      supersedes_id: r.supersedes === null ? undefined : toId("adr", r.supersedes as string),
      decided_at: toIso(r.decided_at),
    }));
  }

  async search(vector: Vector, filter: AdrSearchFilter): Promise<AdrHit[]> {
    const conditions = ["archived = false", "embedding IS NOT NULL"];
    const values: unknown[] = [toVectorLiteral(vector)];
    const add = (sql: string, value: unknown) => {
      values.push(value);
      conditions.push(sql.replace("?", `$${values.length}`));
    };

    if (filter.status !== undefined) add("status = ?", filter.status);
    if (filter.tags && filter.tags.length > 0) add("tags && ?", filter.tags);
    values.push(filter.limit);

    const { rows } = await this.q.query<Record<string, unknown>>(
      `SELECT id, number, title, context, decision, consequences, status, tags,
              1 - (embedding <=> $1::vector) AS score
       FROM ${this.s}.adr WHERE ${conditions.join(" AND ")}
       ORDER BY embedding <=> $1::vector LIMIT $${values.length}`,
      values
    );

    return rows.map((r) => ({
      id: toId("adr", r.id as string),
      number: r.number as number,
      title: r.title as string,
      context: r.context as string,
      decision: r.decision as string,
      consequences: fromNullable(r.consequences as string | null),
      status: r.status as string,
      tags: r.tags as string[],
      score: Number(r.score),
    }));
  }

  async listAll(): Promise<AdrRecord[]> {
    const { rows } = await this.q.query<Record<string, unknown>>(
      `SELECT *, embedding::text AS embedding FROM ${this.s}.adr ORDER BY number ASC`
    );
    return rows.map((r) => ({ ...toAdr(r), embedding: fromVectorLiteral(r.embedding) }));
  }

  async hashIndex(): Promise<Map<string, Id>> {
    const { rows } = await this.q.query<Record<string, unknown>>(
      `SELECT id, title, context, decision FROM ${this.s}.adr`
    );
    const index = new Map<string, Id>();
    for (const r of rows) index.set(hashRow("adr", r), toId("adr", r.id as string));
    return index;
  }
}

/**
 * `consequences` and `alternatives` become undefined when NULL, never null —
 * get_adr passes them through verbatim, so a null here would add two keys to
 * every ADR the SurrealDB driver returns without them.
 */
function toAdr(r: Record<string, unknown>) {
  return {
    id: toId("adr", r.id as string),
    number: r.number as number,
    title: r.title as string,
    context: r.context as string,
    decision: r.decision as string,
    consequences: fromNullable(r.consequences as string | null),
    alternatives: fromNullable(r.alternatives as string | null),
    status: r.status as string,
    supersedes_id: r.supersedes === null ? undefined : toId("adr", r.supersedes as string),
    tags: (r.tags as string[]) ?? [],
    source: r.source as string,
    archived: r.archived as boolean,
    decided_at: toIso(r.decided_at),
    created_at: toIso(r.created_at),
    updated_at: toIso(r.updated_at),
  };
}
