import type { Id } from "../../interfaces/common.interface.js";
import type {
  Entity,
  EntityDetail,
  EntityLookup,
  EntityPatch,
  EntityRecord,
  NewEntity,
} from "../../interfaces/entities.interface.js";
import type { EntityStore } from "../../interfaces/store.interface.js";
import { fromNullable, fromVectorLiteral, toId, toIso, toUuid, toVectorLiteral } from "./map.js";
import type { Queryable } from "./queryable.js";

interface EntityRow extends Record<string, unknown> {
  id: string;
  name: string;
  entity_type: string;
  summary: string | null;
  attributes: Record<string, unknown>;
  created_at: Date;
}

export class PostgresEntityStore implements EntityStore {
  constructor(
    private readonly q: Queryable,
    private readonly s: string
  ) {}

  async resolveRefs(names: string[] | undefined): Promise<Id[]> {
    if (!names || names.length === 0) return [];

    const ids: Id[] = [];
    for (const name of names) {
      const existing = await this.q.query<{ id: string }>(
        `SELECT id FROM ${this.s}.entity WHERE name = $1 LIMIT 1`,
        [name]
      );
      if (existing.rows.length > 0) {
        ids.push(toId("entity", existing.rows[0].id));
        continue;
      }
      const created = await this.q.query<{ id: string }>(
        `INSERT INTO ${this.s}.entity (name) VALUES ($1) RETURNING id`,
        [name]
      );
      ids.push(toId("entity", created.rows[0].id));
    }
    return ids;
  }

  async create(input: NewEntity): Promise<Id> {
    const { rows } = await this.q.query<{ id: string }>(
      `INSERT INTO ${this.s}.entity (name, entity_type, summary, attributes, embedding)
       VALUES ($1, $2, $3, $4, $5) RETURNING id`,
      [
        input.name,
        input.entity_type ?? "concept",
        input.summary ?? null,
        JSON.stringify(input.attributes ?? {}),
        toVectorLiteral(input.embedding),
      ]
    );
    return toId("entity", rows[0].id);
  }

  async update(id: Id, patch: EntityPatch): Promise<void> {
    const uuid = toUuid(id);
    if (!uuid) return;

    const sets: string[] = [];
    const values: unknown[] = [];
    const set = (col: string, value: unknown) => {
      values.push(value);
      sets.push(`${col} = $${values.length}`);
    };

    if (patch.name !== undefined) set("name", patch.name);
    if (patch.entity_type !== undefined) set("entity_type", patch.entity_type);
    if (patch.attributes !== undefined) set("attributes", JSON.stringify(patch.attributes));
    if (patch.summary !== undefined) set("summary", patch.summary ?? null);
    if (patch.embedding !== undefined) set("embedding", toVectorLiteral(patch.embedding));
    if (sets.length === 0) return;

    values.push(uuid);
    await this.q.query(`UPDATE ${this.s}.entity SET ${sets.join(", ")} WHERE id = $${values.length}`, values);
  }

  async get(lookup: EntityLookup): Promise<Entity | null> {
    const { rows } = await this.q.query<EntityRow>(
      `SELECT * FROM ${this.s}.entity WHERE ${"id" in lookup ? "id = $1" : "name = $1"} LIMIT 1`,
      ["id" in lookup ? toUuid(lookup.id) : lookup.name]
    );
    return rows[0] ? toEntity(rows[0]) : null;
  }

  /**
   * One entity with everything that points at it, in a single round trip.
   *
   * SurrealDB answers this with reverse graph traversal; here it is four
   * correlated json_agg subqueries plus one for outbound relations. Same
   * shape, same single round trip — which is exactly why the contract states
   * this as one method rather than exposing a per-table lookup that a caller
   * would have to run four times.
   *
   * Relations are OUTBOUND only, matching the SurrealDB driver. Reading them
   * both ways would change what get_entity reports and what an export carries.
   */
  async detail(lookup: EntityLookup): Promise<EntityDetail | null> {
    const { rows } = await this.q.query<Record<string, unknown>>(
      `SELECT e.*,
        COALESCE((SELECT json_agg(json_build_object('id', m2.id, 'content', m2.content) ORDER BY m2.created_at)
          FROM ${this.s}.mentions mm JOIN ${this.s}.memory m2 ON m2.id = mm.from_id
          WHERE mm.to_id = e.id AND mm.from_table = 'memory'), '[]'::json) AS mentioning_memories,
        COALESCE((SELECT json_agg(json_build_object('id', ep.id, 'title', ep.title) ORDER BY ep.occurred_at)
          FROM ${this.s}.mentions mm JOIN ${this.s}.episode ep ON ep.id = mm.from_id
          WHERE mm.to_id = e.id AND mm.from_table = 'episode'), '[]'::json) AS mentioning_episodes,
        COALESCE((SELECT json_agg(json_build_object('id', sk.id, 'name', sk.name) ORDER BY sk.created_at)
          FROM ${this.s}.mentions mm JOIN ${this.s}.skill sk ON sk.id = mm.from_id
          WHERE mm.to_id = e.id AND mm.from_table = 'skill'), '[]'::json) AS mentioning_skills,
        COALESCE((SELECT json_agg(json_build_object('id', a.id, 'number', a.number, 'title', a.title) ORDER BY a.number)
          FROM ${this.s}.mentions mm JOIN ${this.s}.adr a ON a.id = mm.from_id
          WHERE mm.to_id = e.id AND mm.from_table = 'adr'), '[]'::json) AS mentioning_adrs,
        COALESCE((SELECT json_agg(json_build_object('id', t.id, 'name', t.name, 'relation_type', r.relation_type)
                                  ORDER BY r.created_at)
          FROM ${this.s}.relates_to r JOIN ${this.s}.entity t ON t.id = r.to_id
          WHERE r.from_id = e.id), '[]'::json) AS related_entities
       FROM ${this.s}.entity e
       WHERE ${"id" in lookup ? "e.id = $1" : "e.name = $1"}
       LIMIT 1`,
      ["id" in lookup ? toUuid(lookup.id) : lookup.name]
    );

    const r = rows[0];
    if (!r) return null;

    const asArray = <T>(value: unknown): T[] => (Array.isArray(value) ? (value as T[]) : []);

    return {
      ...toEntity(r as unknown as EntityRow),
      mentioning_memories: asArray<{ id: string; content: string }>(r.mentioning_memories).map((m) => ({
        id: toId("memory", m.id),
        content: m.content,
      })),
      mentioning_episodes: asArray<{ id: string; title: string }>(r.mentioning_episodes).map((e) => ({
        id: toId("episode", e.id),
        title: e.title,
      })),
      mentioning_skills: asArray<{ id: string; name: string }>(r.mentioning_skills).map((s) => ({
        id: toId("skill", s.id),
        name: s.name,
      })),
      mentioning_adrs: asArray<{ id: string; number: number; title: string }>(r.mentioning_adrs).map((a) => ({
        id: toId("adr", a.id),
        number: a.number,
        title: a.title,
      })),
      related_entities: asArray<{ id: string; name: string; relation_type: string }>(r.related_entities).map((x) => ({
        id: toId("entity", x.id),
        name: x.name,
        relation_type: x.relation_type,
      })),
    };
  }

  async listAll(): Promise<EntityRecord[]> {
    const { rows } = await this.q.query<Record<string, unknown>>(
      `SELECT id, name, entity_type, summary, attributes, created_at, embedding::text AS embedding
       FROM ${this.s}.entity`
    );
    return rows.map((r) => ({
      ...toEntity(r as unknown as EntityRow),
      embedding: fromVectorLiteral(r.embedding),
    }));
  }

  async identityIndex(): Promise<Map<string, Id>> {
    const { rows } = await this.q.query<{ id: string; name: string; entity_type: string }>(
      `SELECT id, name, entity_type FROM ${this.s}.entity`
    );
    const index = new Map<string, Id>();
    for (const r of rows) index.set(`${r.name}::${r.entity_type}`, toId("entity", r.id));
    return index;
  }
}

/**
 * `summary` becomes undefined when NULL, never null.
 *
 * Postgres returns an explicit null for an unset nullable column, where
 * SurrealDB returns undefined. get_entity passes the value straight into its
 * JSON result, so without this conversion every entity without a summary would
 * grow a `"summary": null` key that the SurrealDB driver does not produce.
 */
function toEntity(row: EntityRow): Entity {
  return {
    id: toId("entity", row.id),
    name: row.name,
    entity_type: row.entity_type,
    summary: fromNullable(row.summary),
    attributes: row.attributes ?? {},
    created_at: toIso(row.created_at),
  };
}
