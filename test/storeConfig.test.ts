import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { resolveConfig } from "../src/config.js";

/**
 * The hosted-SurrealDB configuration surface.
 *
 * Everything here is a startup-time guard. They matter because the failure
 * they prevent is otherwise silent or badly timed: pointing mem-port at an
 * http(s) endpoint, for instance, connects perfectly happily and then fails on
 * the first tool call — every tool call — because the HTTP engine supports
 * neither sessions nor transactions.
 */

const DB_ENV = [
  "MEM_PORT_DB_URL",
  "MEM_PORT_STORE",
  "MEM_PORT_DB_NAMESPACE",
  "MEM_PORT_DB_USER",
  "MEM_PORT_DB_PASS",
  "MEM_PORT_DB_TOKEN",
  "MEM_PORT_DB_PREFIX",
  "MEM_PORT_DB_MAX_SESSIONS",
] as const;

let saved: Record<string, string | undefined>;

beforeEach(() => {
  saved = Object.fromEntries(DB_ENV.map((key) => [key, process.env[key]]));
  for (const key of DB_ENV) delete process.env[key];
});

afterEach(() => {
  for (const key of DB_ENV) {
    if (saved[key] === undefined) delete process.env[key];
    else process.env[key] = saved[key];
  }
});

describe("store config", () => {
  it("defaults to an embedded database under the data dir", () => {
    const config = resolveConfig({ dataDir: "/tmp/mem-port-example" });
    expect(config.store.driver).toBe("surreal-embedded");
    expect(config.store.url).toBe("surrealkv:///tmp/mem-port-example/memport.db");
    expect(config.store.namespace).toBe("memport");
    expect(config.store.auth).toBeUndefined();
  });

  it("infers the remote driver from a websocket URL", () => {
    process.env.MEM_PORT_DB_URL = "wss://db.example.com";
    process.env.MEM_PORT_DB_USER = "root";
    process.env.MEM_PORT_DB_PASS = "secret";

    const config = resolveConfig({ dataDir: "/tmp/x" });
    expect(config.store.driver).toBe("surreal-remote");
    expect(config.store.auth).toEqual({ username: "root", password: "secret" });
  });

  it("rejects http(s), which cannot support sessions or transactions", () => {
    process.env.MEM_PORT_DB_URL = "https://db.example.com";
    process.env.MEM_PORT_DB_USER = "root";
    process.env.MEM_PORT_DB_PASS = "secret";

    // Failing at startup with an explanation beats failing on every tool call
    // with UnsupportedFeatureError.
    expect(() => resolveConfig({ dataDir: "/tmp/x" })).toThrow(/ws:\/\/ or wss:\/\//);
  });

  it("refuses to connect to a remote cluster anonymously", () => {
    process.env.MEM_PORT_DB_URL = "ws://127.0.0.1:8000";
    expect(() => resolveConfig({ dataDir: "/tmp/x" })).toThrow(/needs credentials/);
  });

  it("rejects a driver that contradicts the URL scheme", () => {
    process.env.MEM_PORT_DB_URL = "surrealkv:///tmp/db";
    process.env.MEM_PORT_STORE = "surreal-remote";
    expect(() => resolveConfig({ dataDir: "/tmp/x" })).toThrow(/needs a ws:\/\/ or wss:\/\/ URL/);
  });

  it("rejects both a token and a username", () => {
    process.env.MEM_PORT_DB_URL = "wss://db.example.com";
    process.env.MEM_PORT_DB_TOKEN = "tok";
    process.env.MEM_PORT_DB_USER = "root";
    process.env.MEM_PORT_DB_PASS = "secret";
    expect(() => resolveConfig({ dataDir: "/tmp/x" })).toThrow(/not both/);
  });

  it("rejects a username with no password", () => {
    process.env.MEM_PORT_DB_URL = "wss://db.example.com";
    process.env.MEM_PORT_DB_USER = "root";
    expect(() => resolveConfig({ dataDir: "/tmp/x" })).toThrow(/without MEM_PORT_DB_PASS/);
  });

  it("takes a bearer token as an alternative to a username", () => {
    process.env.MEM_PORT_DB_URL = "wss://db.example.com";
    process.env.MEM_PORT_DB_TOKEN = "tok";
    expect(resolveConfig({ dataDir: "/tmp/x" }).store.auth).toEqual({ token: "tok" });
  });

  it("carries the namespace, prefix and session cap through", () => {
    process.env.MEM_PORT_DB_NAMESPACE = "shared";
    process.env.MEM_PORT_DB_PREFIX = "memport_";
    process.env.MEM_PORT_DB_MAX_SESSIONS = "8";

    const store = resolveConfig({ dataDir: "/tmp/x" }).store;
    expect(store.namespace).toBe("shared");
    expect(store.databasePrefix).toBe("memport_");
    expect(store.maxSessions).toBe(8);
  });

  it("rejects a nonsensical session cap", () => {
    process.env.MEM_PORT_DB_MAX_SESSIONS = "0";
    expect(() => resolveConfig({ dataDir: "/tmp/x" })).toThrow(/positive integer/);
  });
});
