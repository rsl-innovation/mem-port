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
export type StoreDriver = "surreal-embedded" | "surreal-remote";

export interface SurrealStoreConfig {
  driver: StoreDriver;
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

export interface Config {
  port: number;
  dataDir: string;
  embeddingModel: string;
  store: SurrealStoreConfig;
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

function resolveStoreConfig(dataDir: string, overrides?: Partial<SurrealStoreConfig>): SurrealStoreConfig {
  const url =
    overrides?.url ?? process.env.MEM_PORT_DB_URL ?? `surrealkv://${path.join(dataDir, "memport.db")}`;

  // The scheme is the honest signal of which driver is in play, so an explicit
  // MEM_PORT_STORE only has to exist for the case where someone wants the
  // mismatch reported rather than inferred.
  const declared = overrides?.driver ?? (process.env.MEM_PORT_STORE as StoreDriver | undefined);
  const driver: StoreDriver = declared ?? (REMOTE_SCHEMES.has(schemeOf(url)) ? "surreal-remote" : "surreal-embedded");
  if (driver !== "surreal-embedded" && driver !== "surreal-remote") {
    throw new Error(`Unknown MEM_PORT_STORE value "${driver}". Expected "surreal-embedded" or "surreal-remote".`);
  }

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

  let auth = overrides?.auth;
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
  const maxSessions = overrides?.maxSessions ?? (maxSessionsRaw ? Number(maxSessionsRaw) : 256);
  if (!Number.isInteger(maxSessions) || maxSessions < 1) {
    throw new Error(`MEM_PORT_DB_MAX_SESSIONS must be a positive integer — got "${maxSessionsRaw}".`);
  }

  return {
    driver,
    url,
    namespace: overrides?.namespace ?? process.env.MEM_PORT_DB_NAMESPACE ?? "memport",
    auth,
    databasePrefix: overrides?.databasePrefix ?? process.env.MEM_PORT_DB_PREFIX ?? "",
    maxSessions,
  };
}

export function resolveConfig(overrides: Partial<Config> = {}): Config {
  const port = overrides.port ?? (process.env.MEM_PORT_PORT ? Number(process.env.MEM_PORT_PORT) : 8787);
  const dataDir = overrides.dataDir ?? process.env.MEM_PORT_DATA_DIR ?? defaultDataDir();
  const embeddingModel =
    overrides.embeddingModel ?? process.env.MEM_PORT_EMBEDDING_MODEL ?? "Xenova/all-MiniLM-L6-v2";
  const store = resolveStoreConfig(dataDir, overrides.store);
  return { port, dataDir, embeddingModel, store };
}
