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
import { PostgresAdrStore } from "./adrs.js";
import { PostgresBulkStore } from "./bulk.js";
import { PostgresEntityStore } from "./entities.js";
import { PostgresEpisodeStore } from "./episodes.js";
import { PostgresGraphStore } from "./graph.js";
import { PostgresMemoryStore } from "./memories.js";
import { PostgresSkillStore } from "./skills.js";
import type { Queryable } from "./queryable.js";

/** A pool that can lend a dedicated connection, which is what a transaction needs. */
export interface TransactionCapablePool extends Queryable {
  connect(): Promise<Queryable & { release: () => void }>;
}

/**
 * The Postgres implementation of `LibraryStore`.
 *
 * Built over a `Queryable` rather than a Pool specifically, so the same class
 * serves a pooled query and a transaction's dedicated client — the same shape
 * the SurrealDB driver uses for sessions and transactions.
 *
 * Every table name is schema-qualified rather than reached through a
 * `search_path`. A pool hands out arbitrary connections, so connection-level
 * state is the wrong place to keep something as load-bearing as which tenant's
 * data a query reads: one missed reset and a query silently runs against
 * another workspace.
 */
export class PostgresLibraryStore implements LibraryStore {
  readonly entities: EntityStore;
  readonly episodes: EpisodeStore;
  readonly memories: MemoryStore;
  readonly skills: SkillStore;
  readonly adrs: AdrStore;
  readonly graph: GraphStore;
  readonly bulk: BulkStore;

  constructor(
    private readonly q: Queryable,
    private readonly schema: string,
    readonly libraryId: string,
    private readonly pool?: TransactionCapablePool
  ) {
    this.entities = new PostgresEntityStore(q, schema);
    this.episodes = new PostgresEpisodeStore(q, schema);
    this.memories = new PostgresMemoryStore(q, schema);
    this.skills = new PostgresSkillStore(q, schema);
    this.adrs = new PostgresAdrStore(q, schema);
    this.graph = new PostgresGraphStore(q, schema);
    this.bulk = new PostgresBulkStore(q, schema);
  }

  async transaction<T>(fn: (tx: LibraryStore) => Promise<T>): Promise<T> {
    if (!this.pool) {
      throw new Error("Postgres does not support nested transactions");
    }

    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const value = await fn(new PostgresLibraryStore(client, this.schema, this.libraryId));
      await client.query("COMMIT");
      return value;
    } catch (err) {
      await client.query("ROLLBACK").catch(() => undefined);
      // A deliberate rollback is a result, not a failure: it is how a dry run
      // exercises the real write path and then throws the writes away.
      if (err instanceof Rollback) {
        return err.value as T;
      }
      throw err;
    } finally {
      client.release();
    }
  }
}
