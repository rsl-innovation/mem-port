import type { Id } from "../../interfaces/common.interface.js";
import type { MentionEdge, NewRelation, RelationEdge } from "../../interfaces/graph.interface.js";
import type { GraphStore } from "../../interfaces/store.interface.js";
import { toId, toUuid } from "./map.js";
import type { Queryable } from "./queryable.js";

/** Which table an id belongs to, taken from its own prefix. */
function tableOf(id: Id): string {
  return id.includes(":") ? id.slice(0, id.indexOf(":")) : "";
}

export class PostgresGraphStore implements GraphStore {
  constructor(
    private readonly q: Queryable,
    private readonly s: string
  ) {}

  async addMentions(fromId: Id, entityIds: Id[]): Promise<void> {
    if (entityIds.length === 0) return;

    const fromUuid = toUuid(fromId);
    const fromTable = tableOf(fromId);
    if (!fromUuid || !fromTable) return;

    for (const entityId of entityIds) {
      const toUuidValue = toUuid(entityId);
      if (!toUuidValue) continue;
      // ON CONFLICT DO NOTHING: the SurrealDB driver's RELATE is likewise
      // idempotent for a repeated edge, and an import replaying a bundle must
      // not fail on one it has already created.
      await this.q.query(
        `INSERT INTO ${this.s}.mentions (from_table, from_id, to_id) VALUES ($1, $2, $3)
         ON CONFLICT (from_table, from_id, to_id) DO NOTHING`,
        [fromTable, fromUuid, toUuidValue]
      );
    }
  }

  async replaceMentions(fromId: Id, entityIds: Id[]): Promise<void> {
    const fromUuid = toUuid(fromId);
    const fromTable = tableOf(fromId);
    if (!fromUuid || !fromTable) return;

    await this.q.query(`DELETE FROM ${this.s}.mentions WHERE from_table = $1 AND from_id = $2`, [fromTable, fromUuid]);
    await this.addMentions(fromId, entityIds);
  }

  async relate(fromId: Id, toId_: Id, relation: NewRelation): Promise<Id> {
    const { rows } = await this.q.query<{ id: string }>(
      `INSERT INTO ${this.s}.relates_to (from_id, to_id, relation_type, attributes)
       VALUES ($1, $2, $3, $4) RETURNING id`,
      [toUuid(fromId), toUuid(toId_), relation.relation_type, JSON.stringify(relation.attributes ?? {})]
    );
    return toId("relates_to", rows[0].id);
  }

  async listMentions(): Promise<MentionEdge[]> {
    const { rows } = await this.q.query<{ from_table: string; from_id: string; to_id: string }>(
      `SELECT from_table, from_id, to_id FROM ${this.s}.mentions`
    );
    return rows.map((r) => ({ fromId: toId(r.from_table, r.from_id), toId: toId("entity", r.to_id) }));
  }

  async listRelations(): Promise<RelationEdge[]> {
    const { rows } = await this.q.query<{
      from_id: string;
      to_id: string;
      relation_type: string;
      attributes: Record<string, unknown>;
    }>(`SELECT from_id, to_id, relation_type, attributes FROM ${this.s}.relates_to`);

    return rows.map((r) => ({
      fromId: toId("entity", r.from_id),
      toId: toId("entity", r.to_id),
      relation_type: r.relation_type,
      attributes: r.attributes ?? {},
    }));
  }
}
