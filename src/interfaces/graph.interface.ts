import type { Id } from "./common.interface.js";

/**
 * The two edge kinds in the graph.
 *
 * `mentions` runs from a memory/episode/skill/adr to an entity and carries no
 * payload. `relates_to` runs entity-to-entity and carries a verb plus free-form
 * attributes. Both are read wholesale by export and written individually
 * everywhere else, so the contract only needs those two directions.
 */

export interface MentionEdge {
  fromId: Id;
  toId: Id;
}

export interface RelationEdge {
  fromId: Id;
  toId: Id;
  relation_type: string;
  attributes: Record<string, unknown>;
}

export interface NewRelation {
  relation_type: string;
  attributes?: Record<string, unknown>;
}
