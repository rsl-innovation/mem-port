import type { Id, Vector } from "./common.interface.js";
import type {
  Entity,
  EntityDetail,
  EntityLookup,
  EntityPatch,
  EntityRecord,
  NewEntity,
} from "./entities.interface.js";
import type {
  EpisodeListFilter,
  EpisodePatch,
  EpisodeRecord,
  EpisodeSummary,
  NewEpisode,
} from "./episodes.interface.js";
import type {
  MemoryExportScope,
  MemoryHit,
  MemoryPatch,
  MemoryRecord,
  MemorySearchFilter,
  NewMemory,
} from "./memories.interface.js";
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
} from "./skills.interface.js";
import type {
  AdrDetail,
  AdrHit,
  AdrListFilter,
  AdrPatch,
  AdrRecord,
  AdrSearchFilter,
  AdrSummary,
  NewAdr,
} from "./adrs.interface.js";
import type { MentionEdge, NewRelation, RelationEdge } from "./graph.interface.js";

/**
 * Everything mem-port can do to one library's data, in domain terms.
 *
 * This is the seam between mem-port and its storage engine. Nothing here names
 * a query language, a record-id object, graph-edge syntax, or a vector index:
 * the SurrealDB driver satisfies it with the SurQL that used to live inline in
 * the tool files, and another driver could satisfy it with tables and, say,
 * pgvector. If you find yourself wanting to add a method that only one engine
 * could implement, that is the signal the logic belongs above the contract —
 * in `src/services/` — rather than inside it.
 *
 * A `LibraryStore` handed to a caller is already connected and migrated.
 */
export interface LibraryStore {
  /** The raw, unsanitized library-id this store is scoped to. */
  readonly libraryId: string;

  readonly entities: EntityStore;
  readonly episodes: EpisodeStore;
  readonly memories: MemoryStore;
  readonly skills: SkillStore;
  readonly adrs: AdrStore;
  readonly graph: GraphStore;
  readonly bulk: BulkStore;

  /**
   * Run `fn` atomically.
   *
   * `fn` receives a store scoped to the transaction, so the same
   * store-agnostic code runs transactionally or not without being written
   * twice. Throwing `Rollback` aborts the transaction but still returns the
   * payload it carries — which is how import's dry-run exercises the real
   * write path and then discards it, instead of maintaining a parallel
   * "what would happen" path that can drift from the real one.
   *
   * Not reentrant: calling `transaction` on an already-transactional store throws.
   */
  transaction<T>(fn: (tx: LibraryStore) => Promise<T>): Promise<T>;
}

/**
 * Thrown from inside `transaction` to abort the write while still returning a
 * value to the caller. Anything else thrown aborts and propagates as an error.
 */
export class Rollback<T = unknown> extends Error {
  constructor(readonly value: T) {
    super("transaction rolled back deliberately");
    this.name = "Rollback";
  }
}

export interface SkillStore {
  create(input: NewSkill): Promise<Id>;
  update(id: Id, patch: SkillPatch): Promise<void>;
  /** Soft delete: status becomes "archived". Stays readable by id. */
  archive(id: Id): Promise<void>;
  /** Hard delete, including this skill's outbound mention edges. */
  remove(id: Id): Promise<void>;

  /**
   * Every skill sharing a name, newest first.
   *
   * Returns a list, not a row, because a name accumulates version history by
   * design: save_skill archives the row it replaces rather than deleting it.
   */
  findByName(name: string, opts?: { status?: string }): Promise<SkillIdentity[]>;

  /** The full stored row, as needed to copy a version into the archive. */
  getForArchive(id: Id): Promise<NewSkill | null>;

  getById(id: Id): Promise<SkillDetail | null>;
  list(filter: SkillListFilter): Promise<SkillSummary[]>;
  /** Ranked by cosine similarity against `vector`, descending. Rows without an embedding are excluded. */
  search(vector: Vector, filter: SkillSearchFilter): Promise<SkillHit[]>;

  /** Every row, for export. */
  listAll(): Promise<SkillRecord[]>;
  /** contentHash -> id, for import's dedupe. See src/port/contentHash.ts. */
  hashIndex(): Promise<Map<string, Id>>;
}

export interface MemoryStore {
  create(input: NewMemory): Promise<Id>;
  update(id: Id, patch: MemoryPatch): Promise<void>;
  archive(id: Id): Promise<void>;
  remove(id: Id): Promise<void>;
  search(vector: Vector, filter: MemorySearchFilter): Promise<MemoryHit[]>;
  listAll(scope?: MemoryExportScope): Promise<MemoryRecord[]>;
  hashIndex(): Promise<Map<string, Id>>;
}

export interface EpisodeStore {
  create(input: NewEpisode): Promise<Id>;
  update(id: Id, patch: EpisodePatch): Promise<void>;
  list(filter: EpisodeListFilter): Promise<EpisodeSummary[]>;
  listAll(): Promise<EpisodeRecord[]>;
  hashIndex(): Promise<Map<string, Id>>;
}

export interface EntityStore {
  /**
   * Get-or-create by name, returning ids in the order the names were given.
   *
   * The only method here that writes as a side effect of a read, because that
   * is precisely what every `entity_refs` argument in the tool surface means:
   * mentioning an entity should not require pre-creating it. Batched in the
   * signature even though the Surreal driver still loops internally, so a
   * driver can collapse it into one upsert later without a contract change.
   */
  resolveRefs(names: string[] | undefined): Promise<Id[]>;

  create(input: NewEntity): Promise<Id>;
  update(id: Id, patch: EntityPatch): Promise<void>;
  get(lookup: EntityLookup): Promise<Entity | null>;
  /** One entity with everything that points at it, in as few round trips as the driver can manage. */
  detail(lookup: EntityLookup): Promise<EntityDetail | null>;

  listAll(): Promise<EntityRecord[]>;
  /** `${name}::${entity_type}` -> id, for import's dedupe. */
  identityIndex(): Promise<Map<string, Id>>;
}

export interface AdrStore {
  /**
   * The next number in this library's sequence.
   *
   * Archived ADRs keep their numbers, so this must not skip them — reusing a
   * number would silently rewrite a supersede chain that an older ADR still
   * points into.
   */
  nextNumber(): Promise<number>;

  /**
   * Resolve a user-supplied reference to a record id, or null if no such ADR
   * exists. Accepts a record id ("adr:x9k2"), a bare number (7), or its
   * display form ("ADR-0007") — callers reach for whichever they last saw.
   */
  resolveRef(ref: string | number): Promise<Id | null>;

  create(input: NewAdr): Promise<Id>;
  update(id: Id, patch: AdrPatch): Promise<void>;
  /** Soft delete. ADRs track deletion on `archived`, separately from lifecycle `status`. */
  archive(id: Id): Promise<void>;
  remove(id: Id): Promise<void>;
  /** Point this ADR at the one it supersedes, or clear the link with null. */
  setSupersedes(id: Id, target: Id | null): Promise<void>;
  /** Clear inbound supersede links so a hard delete cannot leave them dangling. */
  clearSupersedesPointingAt(id: Id): Promise<void>;

  getDetail(lookup: { id: Id } | { number: number }): Promise<AdrDetail | null>;
  list(filter: AdrListFilter): Promise<AdrSummary[]>;
  search(vector: Vector, filter: AdrSearchFilter): Promise<AdrHit[]>;

  /** Every row, ordered by number ascending — import renumbers in array order. */
  listAll(): Promise<AdrRecord[]>;
  hashIndex(): Promise<Map<string, Id>>;
}

export interface GraphStore {
  addMentions(fromId: Id, entityIds: Id[]): Promise<void>;
  /** Replace the source's outbound mentions wholesale. Inbound edges are untouched. */
  replaceMentions(fromId: Id, entityIds: Id[]): Promise<void>;
  relate(fromId: Id, toId: Id, relation: NewRelation): Promise<Id>;

  listMentions(): Promise<MentionEdge[]>;
  listRelations(): Promise<RelationEdge[]>;
}

export interface BulkStore {
  /** Delete everything in this library, edges first. Backs import's "overwrite" mode. */
  deleteAll(): Promise<void>;
}
