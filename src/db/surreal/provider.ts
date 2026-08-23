import { mkdir } from "node:fs/promises";
import path from "node:path";
import { Surreal, createRemoteEngines, type SurrealSession } from "surrealdb";
import { createNodeEngines } from "@surrealdb/node";
import type { SurrealStoreConfig } from "../../config.js";
import type { ControlPlaneStore } from "../../interfaces/admin.interface.js";
import type { StoreProvider } from "../../interfaces/provider.interface.js";
import type { LibraryStore } from "../../interfaces/store.interface.js";
import { SYSTEM_DATABASE, sanitizeLibraryId } from "../libraryId.js";
import { SurrealControlPlaneStore } from "./controlPlane.js";
import { ensureSchema } from "./schema.js";
import { ensureSystemSchema } from "./systemSchema.js";
import { SurrealLibraryStore } from "./store.js";

/**
 * Owns the SurrealDB connection and hands out one store per library-id.
 *
 * Tenancy is a database per library inside a shared namespace, reached through
 * a forked session. `forkSession()` shares the underlying connection but gets
 * independent namespace/database state, so concurrent requests for different
 * library-ids can never race each other's active database selection.
 *
 * The session and migration caches are instance fields rather than module
 * globals, so two daemons in one process (which the test suites come close to)
 * cannot see each other's state.
 */
export class SurrealStoreProvider implements StoreProvider {
  readonly #config: SurrealStoreConfig;
  #db: Surreal | undefined;
  /** Memoized so concurrent first requests share one connect rather than racing two. */
  #connecting: Promise<Surreal> | undefined;
  /** Insertion-ordered, oldest first — a Map is all an LRU needs here. */
  readonly #sessions = new Map<string, SurrealSession>();
  readonly #migrated = new Set<string>();

  constructor(config: SurrealStoreConfig) {
    this.#config = config;
  }

  async getLibrary(rawLibraryId: string): Promise<LibraryStore> {
    const session = await this.getSession(rawLibraryId);
    return new SurrealLibraryStore(session, rawLibraryId);
  }

  /**
   * The control-plane store, in its own database.
   *
   * Reached through `#openDatabase` directly rather than `getSession`, because
   * that path runs every name through `sanitizeLibraryId` — which now refuses
   * the reserved name outright. Callers cannot get here by asking for a
   * library; only this method can.
   */
  async getControlPlane(): Promise<ControlPlaneStore> {
    const dbName = `${this.#config.databasePrefix}${SYSTEM_DATABASE}`;
    const session = await this.#openDatabase(dbName, ensureSystemSchema);
    return new SurrealControlPlaneStore(session);
  }

  /**
   * The forked session for a library, migrated on first touch.
   *
   * Exposed beyond `getLibrary` only so tools not yet moved onto the contract
   * can share the same cached sessions during the migration, rather than
   * opening a second, divergent path to the same databases.
   */
  async getSession(rawLibraryId: string): Promise<SurrealSession> {
    return this.#openDatabase(this.#databaseName(rawLibraryId), ensureSchema);
  }

  async #openDatabase(
    dbName: string,
    migrate: (session: SurrealSession) => Promise<void>
  ): Promise<SurrealSession> {
    const db = await this.#connect();

    let session = this.#sessions.get(dbName);
    if (session) {
      // Refresh recency: delete then re-set moves it to the end of the Map's
      // insertion order, which is what makes eviction below least-recently-used.
      this.#sessions.delete(dbName);
    } else {
      session = await db.forkSession();
      await session.use({ database: dbName });
    }
    this.#sessions.set(dbName, session);
    await this.#evictExcessSessions();

    if (!this.#migrated.has(dbName)) {
      await migrate(session);
      this.#migrated.add(dbName);
    }

    return session;
  }

  async close(): Promise<void> {
    // Await any in-flight connect first, or we would leak the connection it is
    // about to resolve with.
    if (this.#connecting) {
      await this.#connecting.catch(() => undefined);
    }
    for (const session of this.#sessions.values()) {
      await session.closeSession().catch(() => undefined);
    }
    this.#sessions.clear();
    this.#migrated.clear();
    if (this.#db) {
      await this.#db.close();
      this.#db = undefined;
    }
    this.#connecting = undefined;
  }

  #databaseName(rawLibraryId: string): string {
    return `${this.#config.databasePrefix}${sanitizeLibraryId(rawLibraryId)}`;
  }

  async #evictExcessSessions(): Promise<void> {
    while (this.#sessions.size > this.#config.maxSessions) {
      const oldest = this.#sessions.keys().next();
      if (oldest.done) return;
      const session = this.#sessions.get(oldest.value);
      this.#sessions.delete(oldest.value);
      await session?.closeSession().catch(() => undefined);
      // `#migrated` deliberately keeps the entry: the schema is still applied
      // on the server, and re-running it would be wasted round trips.
    }
  }

  #connect(): Promise<Surreal> {
    if (this.#db) return Promise.resolve(this.#db);
    this.#connecting ??= this.#openConnection();
    return this.#connecting;
  }

  async #openConnection(): Promise<Surreal> {
    const { url, namespace, auth, driver } = this.#config;

    if (driver === "surreal-embedded") {
      // surrealkv:// and friends write to a path that has to exist first.
      const storagePath = url.replace(/^[a-z0-9+.-]+:\/\//i, "");
      if (storagePath) {
        await mkdir(path.dirname(storagePath), { recursive: true });
      }
    }

    const db = new Surreal({
      engines: {
        ...createRemoteEngines(),
        ...createNodeEngines(),
      },
    });

    try {
      // Credentials go to `connect` rather than a separate `signin` call: the
      // SDK reuses connect-time authentication for every forked session and
      // re-applies it when one expires, whereas an explicit signin() opts out
      // of that and leaves session-expiry handling to us.
      // A bearer token is handed over as a bare string; user/password goes as
      // an object. Both are valid `ProvidedAuth`, they just aren't the same shape.
      const authentication = auth && ("token" in auth ? auth.token : auth);

      await db.connect(url, {
        namespace,
        ...(authentication ? { authentication } : {}),
      });

      if (driver === "surreal-remote") {
        await assertServerSupported(db, url);

        // An embedded database materializes its namespace on first write; a
        // hosted cluster does not, and `use({database})` on a missing namespace
        // fails.
        await db.query(`DEFINE NAMESPACE IF NOT EXISTS ${quoteIdent(namespace)}`);
        await db.use({ namespace });
      }
    } catch (err) {
      this.#connecting = undefined;
      await db.close().catch(() => undefined);
      throw err;
    }

    this.#db = db;
    return db;
  }
}

/** Sessions and transactions were both introduced server-side in SurrealDB 3.0. */
const MINIMUM_SERVER_MAJOR = 3;

/**
 * Fail fast on a server too old to back mem-port.
 *
 * `forkSession()` and `beginTransaction()` are gated on the SERVER version as
 * well as the transport: the SDK declares both `Sessions` and `Transactions`
 * as requiring 3.0.0. Without this check a 2.x server connects perfectly
 * happily and then throws UnavailableFeatureError on the first tool call —
 * every tool call — with nothing pointing at the version as the cause.
 */
async function assertServerSupported(db: Surreal, url: string): Promise<void> {
  const { version } = await db.version();
  const major = Number(/(\d+)\./.exec(version.replace(/^surrealdb-/, ""))?.[1]);

  if (!Number.isInteger(major) || major < MINIMUM_SERVER_MAJOR) {
    throw new Error(
      `SurrealDB at ${url} reports "${version}", but mem-port needs server ${MINIMUM_SERVER_MAJOR}.0.0 or newer: ` +
        `it gives every library-id its own session (added in 3.0) and imports inside a transaction (also 3.0).`
    );
  }
}

/**
 * SurrealQL will not take a bound parameter in a DDL name position, so the
 * namespace has to be interpolated. Anything outside the identifier charset is
 * rejected rather than escaped — a namespace comes from operator config, so a
 * surprising value is a misconfiguration worth failing on, not something to
 * quietly rewrite.
 */
function quoteIdent(name: string): string {
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) {
    throw new Error(
      `Invalid SurrealDB namespace "${name}": use letters, digits and underscores, starting with a letter or underscore.`
    );
  }
  return name;
}
