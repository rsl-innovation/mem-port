import type { Embedded, Id, IsoDateTime } from "./common.interface.js";

/**
 * A person, project, tool, or concept — the nodes memories and skills hang off.
 *
 * `summary` is optional *and* nullable for the same reason ADR's optional text
 * fields are: an entity auto-created by an `entity_refs` mention has no
 * summary, SurrealDB returns the unset field as `undefined`, and get_entity
 * passes it through verbatim, so the key is absent from the response today.
 */
export interface Entity {
  id: Id;
  name: string;
  entity_type: string;
  summary?: string | null;
  attributes: Record<string, unknown>;
  created_at: IsoDateTime;
}

/** An entity reached by following a relation out of another entity. */
export interface RelatedEntity {
  id: Id;
  name: string;
  relation_type: string;
}

/**
 * What get_entity returns: one entity and everything pointing at it.
 *
 * This is deliberately one shape rather than four separately-fetchable lists.
 * Splitting it would push a fan-out into the caller and hard-code an N+1 into
 * the contract; as one result, a driver stays free to answer it in a single
 * round trip (SurrealDB does it with reverse graph traversal, a relational
 * driver with joins).
 *
 * `related_entities` is OUTBOUND only — relations where this entity is the
 * source. That asymmetry is the existing behavior and is load-bearing for the
 * export/import round trip, so it is part of the contract, not an oversight.
 */
export interface EntityDetail extends Entity {
  mentioning_memories: Array<{ id: Id; content: string }>;
  mentioning_episodes: Array<{ id: Id; title: string }>;
  mentioning_skills: Array<{ id: Id; name: string }>;
  mentioning_adrs: Array<{ id: Id; number: number; title: string }>;
  related_entities: RelatedEntity[];
}

/** What an export bundle carries. */
export type EntityRecord = Entity & Embedded;

export interface NewEntity {
  name: string;
  entity_type?: string;
  summary?: string | null;
  attributes?: Record<string, unknown>;
  embedding?: number[] | null;
}

export type EntityPatch = Partial<Pick<Entity, "name" | "entity_type" | "summary" | "attributes">> & {
  embedding?: number[] | null;
};

/** How an entity is looked up: by record id, or by its unique-ish name. */
export type EntityLookup = { id: Id } | { name: string };
