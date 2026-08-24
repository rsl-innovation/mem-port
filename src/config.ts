import os from "node:os";
import path from "node:path";

/**
 * Which storage engine backs the daemon.
 *
 * Both current values are SurrealDB — the split is transport, because the two
 * behave differently enough to matter (see `assertSupportedUrl`). A driver for
 * another engine would add its own value here and its own branch in
 * `createStoreProvider`.
 */
export type StoreDriver = "surreal-embedded" | "surreal-remote" | "postgres";

export type SurrealDriver = "surreal-embedded" | "surreal-remote";

export interface SurrealStoreConfig {
  /** Narrowed rather than the full StoreDriver, so StoreConfig discriminates. */
  driver: SurrealDriver;
  /** `surrealkv://<path>` for embedded, `ws://` or `wss://` for a hosted server. */
  url: string;
  namespace: string;
  /** How to authenticate. Absent for embedded, which runs as an implicit root. */
  auth?: { username: string; password: string } | { token: string };
  /** Prepended to every tenant database name, for a cluster shared with other apps. */
  databasePrefix: string;
  /**
   * Cap on cached per-library sessions. Each one is server-side state on a
   * hosted cluster, so a daemon serving thousands of libraries must not hold
   * them all open. Least-recently-used sessions are closed on eviction.
   */
  maxSessions: number;
}

export type AuthMode = "off" | "required";

export interface AuthConfig {
  /**
   * Whether callers must present an API key.
   *
   * Defaults to whatever the bind address implies: "off" on loopback, where
   * the operating system is already the boundary and a personal daemon should
   * not need credentials, and "required" on any other interface, where there
   * is no boundary left. Set MEM_PORT_AUTH to override in either direction --
   * "required" on loopback to develop against the real thing, "off" elsewhere
   * only when something in front is doing the authenticating.
   */
  mode: AuthMode;
  /** Creates the first admin when the control plane is empty. */
  bootstrapAdmin?: { username: string; password: string };
  /** How long an admin panel login stays valid. */
  sessionTtlHours: number;
}

export interface PostgresStoreConfig {
  driver: "postgres";
  /** A libpq connection string, e.g. postgres://user:pass@host:5432/memport */
  url: string;
  /**
   * Prefix for the per-workspace schema names, so several mem-port deployments
   * can share one database without colliding.
   */
  schemaPrefix: string;
  poolSize: number;
}

export type StoreConfig = SurrealStoreConfig | PostgresStoreConfig;

export interface Config {
  port: number;
  /**
   * Interface to bind. Defaults to loopback, which is the only thing currently
   * standing between the MCP endpoint and anyone who can reach the host: there
   * is no authentication on the request path, and `library-id` selects a
   * tenant rather than proving a right to it. Set this to 0.0.0.0 only where
   * something else — a platform auth layer, a private network — is enforcing
   * who may connect.
   */
  host: string;
  dataDir: string;
  embeddingModel: string;
  store: StoreConfig;
  auth: AuthConfig;
}

function defaultDataDir(): string {
  if (process.platform === "darwin") {
    return path.join(os.homedir(), "Library", "Application Support", "mem-port");
  }
  if (process.platform === "win32") {
    const appData = process.env.APPDATA ?? path.join(os.homedir(), "AppData", "Roaming");
    return path.join(appData, "mem-port");
  }
  const xdgDataHome = process.env.XDG_DATA_HOME ?? path.join(os.homedir(), ".local", "share");
  return path.join(xdgDataHome, "mem-port");
}

function schemeOf(url: string): string {
  const match = /^([a-z][a-z0-9+.-]*):/i.exec(url.trim());
  if (!match) {
    throw new Error(`MEM_PORT_DB_URL must start with a scheme, e.g. "wss://host" — got "${url}"`);
  }
  return match[1].toLowerCase();
}

const EMBEDDED_SCHEMES = new Set(["surrealkv", "rocksdb", "mem", "indxdb", "surrealkv+versioned"]);
const REMOTE_SCHEMES = new Set(["ws", "wss"]);
const POSTGRES_SCHEMES = new Set(["postgres", "postgresql"]);

/**
 * Reject transports that cannot support how mem-port uses SurrealDB, at
 * startup rather than on the first request that trips over it.
 *
 * The HTTP engine advertises neither `Sessions` nor `Transactions`. mem-port
 * needs both: tenancy is a forked session per library-id, and import runs in a
 * transaction. Over http(s) every tool call would fail with
 * `UnsupportedFeatureError`, so pointing someone at wss:// is far kinder than
 * letting them discover that one request at a time.
 */
function assertSupportedUrl(url: string, driver: StoreDriver): void {
  const scheme = schemeOf(url);

  if (scheme === "http" || scheme === "https") {
    throw new Error(
      `MEM_PORT_DB_URL uses ${scheme}://, which SurrealDB's HTTP engine cannot back: it supports neither sessions ` +
        `(mem-port gives each library-id its own forked session) nor transactions (import_library needs one). ` +
        `Use ws:// or wss:// against the same host instead.`
    );
  }

  if (driver === "surreal-remote" && !REMOTE_SCHEMES.has(scheme)) {
    throw new Error(`Store driver "surreal-remote" needs a ws:// or wss:// URL — got "${scheme}://".`);
  }
  if (driver === "surreal-embedded" && !EMBEDDED_SCHEMES.has(scheme)) {
    throw new Error(
      `Store driver "surreal-embedded" needs a local URL such as surrealkv:// or mem:// — got "${scheme}://".`
    );
  }
}

function resolveStoreConfig(dataDir: string, overrides?: Partial<StoreConfig>): StoreConfig {
  const url =
    overrides?.url ?? process.env.MEM_PORT_DB_URL ?? `surrealkv://${path.join(dataDir, "memport.db")}`;

  // A postgres:// URL selects the Postgres driver, the same way a ws:// URL
  // selects remote SurrealDB: the scheme is the honest signal of what is on
  // the other end, and MEM_PORT_STORE only exists to have a mismatch reported
  // rather than inferred.
  const scheme = schemeOf(url);
  const declaredDriver = overrides?.driver ?? (process.env.MEM_PORT_STORE as StoreDriver | undefined);
  if (declaredDriver === "postgres" || (!declaredDriver && POSTGRES_SCHEMES.has(scheme))) {
    if (!POSTGRES_SCHEMES.has(scheme)) {
      throw new Error(`Store driver "postgres" needs a postgres:// URL — got "${scheme}://".`);
    }
    const poolRaw = process.env.MEM_PORT_DB_POOL_SIZE;
    const poolSize = poolRaw ? Number(poolRaw) : 10;
    if (!Number.isInteger(poolSize) || poolSize < 1) {
      throw new Error(`MEM_PORT_DB_POOL_SIZE must be a positive integer — got "${poolRaw}".`);
    }
    return {
      driver: "postgres",
      url,
      schemaPrefix: process.env.MEM_PORT_DB_PREFIX ?? "",
      poolSize,
    };
  }

  // The scheme is the honest signal of which driver is in play, so an explicit
  // MEM_PORT_STORE only has to exist for the case where someone wants the
  // mismatch reported rather than inferred.
  const driver = (declaredDriver ??
    (REMOTE_SCHEMES.has(scheme) ? "surreal-remote" : "surreal-embedded")) as SurrealDriver;
  if (driver !== "surreal-embedded" && driver !== "surreal-remote") {
    throw new Error(
      `Unknown MEM_PORT_STORE value "${driver}". Expected "surreal-embedded", "surreal-remote" or "postgres".`
    );
  }
  const surrealOverrides = overrides as Partial<SurrealStoreConfig> | undefined;

  assertSupportedUrl(url, driver);

  const username = process.env.MEM_PORT_DB_USER;
  const password = process.env.MEM_PORT_DB_PASS;
  const token = process.env.MEM_PORT_DB_TOKEN;

  if (token && username) {
    throw new Error("Set either MEM_PORT_DB_TOKEN or MEM_PORT_DB_USER/MEM_PORT_DB_PASS, not both.");
  }
  if (username && !password) {
    throw new Error("MEM_PORT_DB_USER is set without MEM_PORT_DB_PASS.");
  }

  let auth = surrealOverrides?.auth;
  if (!auth && token) {
    auth = { token };
  } else if (!auth && username && password) {
    auth = { username, password };
  }

  // An embedded database is a file this process owns, so it needs no
  // credentials. A hosted one is a shared server, and connecting anonymously
  // would either fail deep inside the SDK or — worse — succeed against a
  // cluster left open.
  if (driver === "surreal-remote" && !auth) {
    throw new Error(
      "A remote SurrealDB URL needs credentials: set MEM_PORT_DB_USER and MEM_PORT_DB_PASS, or MEM_PORT_DB_TOKEN. " +
        "The user must be root- or namespace-level, since mem-port creates a database per library-id."
    );
  }

  const maxSessionsRaw = process.env.MEM_PORT_DB_MAX_SESSIONS;
  const maxSessions = surrealOverrides?.maxSessions ?? (maxSessionsRaw ? Number(maxSessionsRaw) : 256);
  if (!Number.isInteger(maxSessions) || maxSessions < 1) {
    throw new Error(`MEM_PORT_DB_MAX_SESSIONS must be a positive integer — got "${maxSessionsRaw}".`);
  }

  return {
    driver,
    url,
    namespace: surrealOverrides?.namespace ?? process.env.MEM_PORT_DB_NAMESPACE ?? "memport",
    auth,
    databasePrefix: surrealOverrides?.databasePrefix ?? process.env.MEM_PORT_DB_PREFIX ?? "",
    maxSessions,
  };
}

function isLoopback(host: string): boolean {
  return host === "127.0.0.1" || host === "localhost" || host === "::1";
}

function resolveAuthConfig(host: string, overrides?: Partial<AuthConfig>): AuthConfig {
  const declared = process.env.MEM_PORT_AUTH?.trim().toLowerCase();
  if (declared !== undefined && declared !== "off" && declared !== "required") {
    throw new Error(`Invalid MEM_PORT_AUTH "${declared}". Expected "off" or "required".`);
  }

  const mode: AuthMode = overrides?.mode ?? (declared as AuthMode | undefined) ?? (isLoopback(host) ? "off" : "required");

  const username = process.env.MEM_PORT_ADMIN_USER;
  const password = process.env.MEM_PORT_ADMIN_PASSWORD;
  if (password && !username) {
    throw new Error("MEM_PORT_ADMIN_PASSWORD is set without MEM_PORT_ADMIN_USER.");
  }
  if (username && !password) {
    throw new Error("MEM_PORT_ADMIN_USER is set without MEM_PORT_ADMIN_PASSWORD.");
  }

  const bootstrapAdmin =
    overrides?.bootstrapAdmin ?? (username && password ? { username, password } : undefined);

  const ttlRaw = process.env.MEM_PORT_SESSION_TTL_HOURS;
  const sessionTtlHours = overrides?.sessionTtlHours ?? (ttlRaw ? Number(ttlRaw) : 12);
  if (!Number.isFinite(sessionTtlHours) || sessionTtlHours <= 0) {
    throw new Error(`MEM_PORT_SESSION_TTL_HOURS must be a positive number -- got "${ttlRaw}".`);
  }

  return { mode, bootstrapAdmin, sessionTtlHours };
}

export function resolveConfig(overrides: Partial<Config> = {}): Config {
  // PORT is the convention every container platform injects (Cloud Run, Heroku,
  // Fly); MEM_PORT_PORT stays ahead of it so an explicit setting still wins.
  const portEnv = process.env.MEM_PORT_PORT ?? process.env.PORT;
  const port = overrides.port ?? (portEnv ? Number(portEnv) : 8787);
  if (!Number.isInteger(port) || port < 0 || port > 65535) {
    throw new Error(`Invalid port "${portEnv}". Expected an integer between 0 and 65535.`);
  }

  const host = overrides.host ?? process.env.MEM_PORT_HOST ?? "127.0.0.1";
  const dataDir = overrides.dataDir ?? process.env.MEM_PORT_DATA_DIR ?? defaultDataDir();
  const embeddingModel =
    overrides.embeddingModel ?? process.env.MEM_PORT_EMBEDDING_MODEL ?? "Xenova/all-MiniLM-L6-v2";
  const store = resolveStoreConfig(dataDir, overrides.store);
  const auth = resolveAuthConfig(host, overrides.auth);
  return { port, host, dataDir, embeddingModel, store, auth };
}
