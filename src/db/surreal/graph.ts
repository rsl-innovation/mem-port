import type { SurrealQueryable } from "surrealdb";
import type { Id } from "../../interfaces/common.interface.js";
import type { MentionEdge, NewRelation, RelationEdge } from "../../interfaces/graph.interface.js";
import type { GraphStore } from "../../interfaces/store.interface.js";
import { toId, toRecordId } from "./map.js";

export class SurrealGraphStore implements GraphStore {
  constructor(private readonly q: SurrealQueryable) {}

  async addMentions(fromId: Id, entityIds: Id[]): Promise<void> {
    for (const entityId of entityIds) {
      await this.q.query(`RELATE $from->mentions->$to`, {
        from: toRecordId(fromId),
        to: toRecordId(entityId),
      });
    }
  }

  /**
   * Replace a source's outbound mentions.
   *
   * Deletes by graph path rather than by edge id, so it clears whatever edges
   * exist without having to read them first. Inbound edges are untouched —
   * only the source's own claims about what it mentions are being restated.
   */
  async replaceMentions(fromId: Id, entityIds: Id[]): Promise<void> {
    await this.q.query(`DELETE $id->mentions`, { id: toRecordId(fromId) });
    await this.addMentions(fromId, entityIds);
  }

  async relate(fromId: Id, toId_: Id, relation: NewRelation): Promise<Id> {
    const [created] = await this.q.query<[Array<{ id: unknown }>]>(
      `RELATE $from->relates_to->$to CONTENT { relation_type: $relation_type, attributes: $attributes }`,
      {
        from: toRecordId(fromId),
        to: toRecordId(toId_),
        relation_type: relation.relation_type,
        attributes: relation.attributes ?? {},
      }
    );
    return toId(created[0].id);
  }

  async listMentions(): Promise<MentionEdge[]> {
    const [rows] = await this.q.query<[Array<{ fromId: unknown; toId: unknown }>]>(
      `SELECT in AS fromId, out AS toId FROM mentions`
    );
    return rows.map((row) => ({ fromId: toId(row.fromId), toId: toId(row.toId) }));
  }

  async listRelations(): Promise<RelationEdge[]> {
    const [rows] = await this.q.query<
      [Array<{ fromId: unknown; toId: unknown; relation_type?: string; attributes?: Record<string, unknown> }>]
    >(`SELECT in AS fromId, out AS toId, relation_type, attributes FROM relates_to`);

    return rows.map((row) => ({
      fromId: toId(row.fromId),
      toId: toId(row.toId),
      relation_type: row.relation_type ?? "related_to",
      attributes: row.attributes ?? {},
    }));
  }
}
