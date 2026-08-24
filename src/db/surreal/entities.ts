import type { SurrealQueryable } from "surrealdb";
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
import { toId, toIso, toRecordId, toVector } from "./map.js";

interface EntityRow {
  id: unknown;
  name: string;
  entity_type: string;
  summary?: string | null;
  attributes: Record<string, unknown>;
  embedding?: number[] | null;
  created_at: unknown;
  mentioning_memories?: Array<{ id: unknown; content: string }>;
  mentioning_episodes?: Array<{ id: unknown; title: string }>;
  mentioning_skills?: Array<{ id: unknown; name: string }>;
  mentioning_adrs?: Array<{ id: unknown; number: number; title: string }>;
}

export class SurrealEntityStore implements EntityStore {
  constructor(private readonly q: SurrealQueryable) {}

  async resolveRefs(names: string[] | undefined): Promise<Id[]> {
    if (!names || names.length === 0) return [];

    const ids: Id[] = [];
    for (const name of names) {
      const [existing] = await this.q.query<[Array<{ id: unknown }>]>(
        `SELECT id FROM entity WHERE name = $name LIMIT 1`,
        { name }
      );
      if (existing.length > 0) {
        ids.push(toId(existing[0].id));
        continue;
      }
      const [created] = await this.q.query<[Array<{ id: unknown }>]>(`CREATE entity CONTENT { name: $name }`, {
        name,
      });
      ids.push(toId(created[0].id));
    }
    return ids;
  }

  async create(input: NewEntity): Promise<Id> {
    const [created] = await this.q.query<[Array<{ id: unknown }>]>(
      `CREATE entity CONTENT {
         name: $name,
         entity_type: $entity_type,
         summary: $summary,
         attributes: $attributes,
         embedding: $embedding
       }`,
      {
        name: input.name,
        entity_type: input.entity_type ?? "concept",
        summary: input.summary ?? undefined,
        attributes: input.attributes ?? {},
        embedding: input.embedding ?? undefined,
      }
    );
    return toId(created[0].id);
  }

  async update(id: Id, patch: EntityPatch): Promise<void> {
    const assignments: string[] = [];
    const bindings: Record<string, unknown> = { id: toRecordId(id) };

    for (const field of ["name", "entity_type", "attributes"] as const) {
      if (patch[field] !== undefined) {
        assignments.push(`${field} = $${field}`);
        bindings[field] = patch[field];
      }
    }
    // `summary` and `embedding` are option<> fields: an explicit null means
    // "clear it", which SurrealDB spells as NONE rather than null.
    for (const field of ["summary", "embedding"] as const) {
      if (patch[field] !== undefined) {
        assignments.push(`${field} = $${field}`);
        bindings[field] = patch[field] ?? undefined;
      }
    }
    if (assignments.length === 0) return;

    await this.q.query(`UPDATE $id SET ${assignments.join(", ")}`, bindings);
  }

  async get(lookup: EntityLookup): Promise<Entity | null> {
    const [rows] = await this.q.query<[EntityRow[]]>(
      `SELECT * FROM ${targetExpression(lookup)}`,
      bindingsFor(lookup)
    );
    const row = rows[0];
    return row ? toEntity(row) : null;
  }

  async detail(lookup: EntityLookup): Promise<EntityDetail | null> {
    // One query for the entity and all four fan-ins, using reverse graph
    // traversal. Answering this as four separate lookups would turn a single
    // round trip into an N+1 for every caller.
    const [rows] = await this.q.query<[EntityRow[]]>(
      `SELECT
         *,
         <-mentions<-memory.{id, content} AS mentioning_memories,
         <-mentions<-episode.{id, title} AS mentioning_episodes,
         <-mentions<-skill.{id, name} AS mentioning_skills,
         <-mentions<-adr.{id, number, title} AS mentioning_adrs
       FROM ${targetExpression(lookup)}`,
      bindingsFor(lookup)
    );

    const row = rows[0];
    if (!row) return null;

    // Outbound relations only — where this entity is the source. Reading them
    // in both directions would change what get_entity reports and what an
    // export bundle carries.
    const [related] = await this.q.query<[Array<{ relation_type: string; name: string; id: unknown }>]>(
      `SELECT relation_type, out.name AS name, out.id AS id FROM relates_to WHERE in = $entity`,
      { entity: row.id }
    );

    return {
      ...toEntity(row),
      mentioning_memories: (row.mentioning_memories ?? []).map((m) => ({ id: toId(m.id), content: m.content })),
      mentioning_episodes: (row.mentioning_episodes ?? []).map((e) => ({ id: toId(e.id), title: e.title })),
      mentioning_skills: (row.mentioning_skills ?? []).map((s) => ({ id: toId(s.id), name: s.name })),
      mentioning_adrs: (row.mentioning_adrs ?? []).map((a) => ({
        id: toId(a.id),
        number: a.number,
        title: a.title,
      })),
      related_entities: related.map((r) => ({
        id: toId(r.id),
        name: r.name,
        relation_type: r.relation_type,
      })),
    };
  }

  async listAll(): Promise<EntityRecord[]> {
    const [rows] = await this.q.query<[EntityRow[]]>(`SELECT * FROM entity`);
    return rows.map((row) => ({ ...toEntity(row), embedding: toVector(row.embedding) }));
  }

  async identityIndex(): Promise<Map<string, Id>> {
    const [rows] = await this.q.query<[Array<{ id: unknown; name: string; entity_type: string }>]>(
      `SELECT id, name, entity_type FROM entity`
    );
    const index = new Map<string, Id>();
    for (const row of rows) {
      index.set(`${row.name}::${row.entity_type}`, toId(row.id));
    }
    return index;
  }
}

/**
 * What to SELECT FROM.
 *
 * A record id has to be cast and wrapped in an array so the result is a row
 * list either way; a name goes through a subquery. Both forms keep the value
 * itself in a binding.
 */
function targetExpression(lookup: EntityLookup): string {
  return "id" in lookup
    ? `[<record<entity>> $id]`
    : `(SELECT VALUE id FROM entity WHERE name = $name LIMIT 1)`;
}

function bindingsFor(lookup: EntityLookup): Record<string, unknown> {
  return "id" in lookup ? { id: toRecordId(lookup.id) } : { name: lookup.name };
}

/**
 * `summary` is assigned verbatim, never coalesced: SurrealDB returns an unset
 * `option<string>` as undefined, and get_entity passes it straight into its
 * JSON result, so the key is absent from responses today. `?? null` here would
 * add a key to every entity the tool has ever returned.
 */
function toEntity(row: EntityRow): Entity {
  return {
    id: toId(row.id),
    name: row.name,
    entity_type: row.entity_type,
    summary: row.summary,
    attributes: row.attributes ?? {},
    created_at: toIso(row.created_at),
  };
}
