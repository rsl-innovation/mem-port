import type { PostgresStoreConfig } from "../../config.js";
import type { ControlPlaneStore } from "../../interfaces/admin.interface.js";
import type { StoreProvider } from "../../interfaces/provider.interface.js";
import type { LibraryStore } from "../../interfaces/store.interface.js";
import { SYSTEM_DATABASE, sanitizeLibraryId } from "../libraryId.js";
import { PostgresControlPlaneStore } from "./controlPlane.js";
import { ensureSchema, quoteIdent } from "./schema.js";
import { ensureSystemSchema } from "./systemSchema.js";
import { PostgresLibraryStore, type TransactionCapablePool } from "./store.js";

/**
 * Postgres implementation of `StoreProvider`.
 *
 * One connection pool, one schema per workspace. Workspace isolation is
 * structural rather than a predicate — a query names its schema and physically
 * cannot reach another workspace's rows — which is the same property the
 * SurrealDB driver gets from a database per library.
 */
export class PostgresStoreProvider implements StoreProvider {
  readonly #config: PostgresStoreConfig;
  #pool: TransactionCapablePool | undefined;
  #connecting: Promise<TransactionCapablePool> | undefined;
  /**
   * In-flight and completed schema migrations, keyed by schema name.
   *
   * A promise rather than a "have I migrated this?" boolean, for the reason the
   * SurrealDB provider learned the hard way: the boolean form is a race, and
   * two callers reaching a new workspace at the same instant both run the
   * migration. `CREATE SCHEMA IF NOT EXISTS` is idempotent but concurrent DDL
   * on one schema still deadlocks or errors.
   */
  readonly #migrating = new Map<string, Promise<void>>();

  constructor(config: PostgresStoreConfig) {
    this.#config = config;
  }

  async getLibrary(rawLibraryId: string): Promise<LibraryStore> {
    const schema = this.#schemaName(sanitizeLibraryId(rawLibraryId));
    const pool = await this.#connect();
    await this.#migrate(schema, (p) => ensureSchema(p, schema));
    return new PostgresLibraryStore(pool, quoteIdent(schema), rawLibraryId, pool);
  }

  async getControlPlane(): Promise<ControlPlaneStore> {
    const schema = this.#schemaName(SYSTEM_DATABASE);
    const pool = await this.#connect();
    await this.#migrate(schema, (p) => ensureSystemSchema(p, schema));
    return new PostgresControlPlaneStore(pool, quoteIdent(schema));
  }

  async close(): Promise<void> {
    if (this.#connecting) await this.#connecting.catch(() => undefined);
    const pool = this.#pool as { end?: () => Promise<void> } | undefined;
    this.#pool = undefined;
    this.#connecting = undefined;
    this.#migrating.clear();
    await pool?.end?.().catch(() => undefined);
  }

  /**
   * Schema names are the sanitized library id.
   *
   * A leading underscore is legal in Postgres but `SYSTEM_DATABASE` starts with
   * one, and `quoteIdent` demands `[a-z_][a-z0-9_]*` — which it satisfies. The
   * configured prefix lets several mem-port deployments share one database.
   */
  #schemaName(sanitized: string): string {
    return `${this.#config.schemaPrefix}${sanitized}`;
  }

  #migrate(schema: string, run: (pool: TransactionCapablePool) => Promise<void>): Promise<void> {
    let pending = this.#migrating.get(schema);
    if (!pending) {
      pending = this.#connect().then(run);
      this.#migrating.set(schema, pending);
      // Cleared on failure only, so one transient error does not make a
      // workspace permanently unopenable for the life of the process.
      pending.catch(() => this.#migrating.delete(schema));
    }
    return pending;
  }

  #connect(): Promise<TransactionCapablePool> {
    if (this.#pool) return Promise.resolve(this.#pool);
    this.#connecting ??= this.#openPool();
    return this.#connecting;
  }

  async #openPool(): Promise<TransactionCapablePool> {
    const { Pool } = await loadPg();
    const pool = new Pool({
      connectionString: this.#config.url,
      max: this.#config.poolSize,
      // Fail fast rather than hanging a request forever on an unreachable host.
      connectionTimeoutMillis: 10_000,
    }) as unknown as TransactionCapablePool;

    try {
      await assertPgvector(pool, this.#config.url);
    } catch (err) {
      this.#connecting = undefined;
      await (pool as unknown as { end: () => Promise<void> }).end().catch(() => undefined);
      throw err;
    }

    this.#pool = pool;
    return pool;
  }
}

/**
 * Load `pg` on demand.
 *
 * It is an optional dependency, so someone running the default embedded setup
 * never installs it. Importing it at module scope would break that: the file is
 * reachable from `createStoreProvider`, so a missing module would crash every
 * daemon rather than only the ones actually asking for Postgres.
 */
async function loadPg(): Promise<{ Pool: new (config: unknown) => unknown }> {
  try {
    return (await import("pg")) as unknown as { Pool: new (config: unknown) => unknown };
  } catch {
    throw new Error(
      'The Postgres driver needs the "pg" package, which is an optional dependency and is not installed. ' +
        "Install it with: npm install pg"
    );
  }
}

/**
 * Refuse to start without pgvector.
 *
 * Every semantic search this product offers is a cosine similarity over an
 * embedding column, so without the extension mem-port cannot do the thing it
 * exists for. Checked once at connect time — like the SurrealDB 3.0 check —
 * because the alternative is a confusing type error on the first search rather
 * than a clear message at startup.
 */
async function assertPgvector(pool: TransactionCapablePool, url: string): Promise<void> {
  const { rows } = await pool.query<{ installed: string | null }>(
    `SELECT (SELECT extversion FROM pg_extension WHERE extname = 'vector') AS installed`
  );

  if (rows[0]?.installed) return;

  // Try to install it ourselves; on a managed service the extension is usually
  // available but not yet enabled, and this is a one-line fix the operator
  // should not have to discover from a stack trace.
  try {
    await pool.query("CREATE EXTENSION IF NOT EXISTS vector");
    return;
  } catch {
    throw new Error(
      `Postgres at ${safeUrl(url)} does not have the pgvector extension, and mem-port could not enable it. ` +
        `Every search mem-port offers is a vector similarity, so it cannot run without it. ` +
        `Run "CREATE EXTENSION vector;" as a superuser, or use an image that bundles it ` +
        `(pgvector/pgvector), or a managed Postgres with pgvector available.`
    );
  }
}

/** A connection string with any password removed, for error messages. */
function safeUrl(url: string): string {
  try {
    const parsed = new URL(url);
    if (parsed.password) parsed.password = "***";
    return parsed.toString();
  } catch {
    return "the configured URL";
  }
}
