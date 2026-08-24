import { SurrealSession, type SurrealQueryable } from "surrealdb";
import type {
  AdrStore,
  BulkStore,
  EntityStore,
  EpisodeStore,
  GraphStore,
  LibraryStore,
  MemoryStore,
  SkillStore,
} from "../../interfaces/store.interface.js";
import { Rollback } from "../../interfaces/store.interface.js";
import { SurrealAdrStore } from "./adrs.js";
import { SurrealBulkStore } from "./bulk.js";
import { SurrealEntityStore } from "./entities.js";
import { SurrealEpisodeStore } from "./episodes.js";
import { SurrealGraphStore } from "./graph.js";
import { SurrealMemoryStore } from "./memories.js";
import { SurrealSkillStore } from "./skills.js";

/**
 * The SurrealDB implementation of `LibraryStore`.
 *
 * Built over a `SurrealQueryable` rather than a `SurrealSession` specifically:
 * a session and a transaction both satisfy that interface, so a transactional
 * store is this same class over a different queryable. Every sub-store is
 * written once and works identically inside or outside a transaction.
 */
export class SurrealLibraryStore implements LibraryStore {
  readonly entities: EntityStore;
  readonly episodes: EpisodeStore;
  readonly memories: MemoryStore;
  readonly skills: SkillStore;
  readonly adrs: AdrStore;
  readonly graph: GraphStore;
  readonly bulk: BulkStore;

  constructor(
    private readonly q: SurrealQueryable,
    readonly libraryId: string
  ) {
    this.entities = new SurrealEntityStore(q);
    this.episodes = new SurrealEpisodeStore(q);
    this.memories = new SurrealMemoryStore(q);
    this.skills = new SurrealSkillStore(q);
    this.adrs = new SurrealAdrStore(q);
    this.graph = new SurrealGraphStore(q);
    this.bulk = new SurrealBulkStore(q);
  }

  async transaction<T>(fn: (tx: LibraryStore) => Promise<T>): Promise<T> {
    if (!(this.q instanceof SurrealSession)) {
      throw new Error("SurrealDB does not support nested transactions");
    }

    const tx = await this.q.beginTransaction();
    try {
      const value = await fn(new SurrealLibraryStore(tx, this.libraryId));
      await tx.commit();
      return value;
    } catch (err) {
      await tx.cancel().catch(() => undefined);
      // A deliberate rollback is a result, not a failure — it is how a dry run
      // exercises the real write path and then throws the writes away.
      if (err instanceof Rollback) {
        return err.value as T;
      }
      throw err;
    }
  }
}
