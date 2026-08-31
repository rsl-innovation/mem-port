import { execFileSync } from "node:child_process";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import type { Server } from "node:http";
import { startDaemon } from "../src/daemon.js";
import { closeRootConnection, getStoreProvider } from "../src/db/connection.js";
import { resolveConfig } from "../src/config.js";

/**
 * The same fixture, through both drivers, compared byte for byte.
 *
 * This is what the LibraryStore contract is *for*. Every other test proves one
 * driver behaves; this proves the boundary is real — that swapping SurrealDB
 * for Postgres changes nothing a client can observe. If the contract leaks an
 * engine detail, it shows up here as a diff rather than as a support ticket.
 *
 * Both daemons run in this one process, which means the module-level store
 * provider has to be closed between them (see `runDriver`).
 *
 * Skips without Docker. A skip is missing coverage, not a pass.
 */

const PG_URL = "postgres://postgres:memport@127.0.0.1:15432/memport";
const LIB = "cross-driver";

function dockerReady(): boolean {
  try {
    execFileSync("docker", ["info"], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

function pgReachable(): boolean {
  try {
    execFileSync("docker", ["exec", "mp-pg-test", "pg_isready", "-U", "postgres"], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

const hasDocker = dockerReady();
if (!hasDocker) {
  // eslint-disable-next-line no-console
  console.warn("[crossDriver] Docker unavailable — the Postgres driver is NOT being verified.");
}

/**
 * Mask the values that legitimately differ, and nothing else.
 *
 * Record ids differ by design — SurrealDB mints `skill:x9k2ab`, Postgres mints
 * `skill:<uuid>` — so both collapse to `table:<id>`. Everything that survives
 * masking (key presence, key ORDER, null vs absent, nesting, formatting) has to
 * be identical, and that is the actual claim under test.
 */
function mask(text: string): string {
  return text
    .replace(
      /\b(entity|episode|memory|skill|adr|mentions|relates_to):[0-9a-z-]+/gi,
      "$1:<id>"
    )
    .replace(/\d{4}-\d{2}-\d{2}T[\d:.]+Z/g, "<timestamp>")
    .replace(/\d{4}-\d{2}-\d{2}/g, "<date>")
    // Cosine similarity is computed by two different engines; three decimals is
    // the precision the UI itself displays.
    .replace(/("score":\s*)(-?\d+\.\d{1,3})\d*/g, "$1$2");
}

async function call(port: number, tool: string, args: unknown): Promise<string> {
  const res = await fetch(`http://127.0.0.1:${port}/mcp`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      accept: "application/json, text/event-stream",
      "library-id": LIB,
    },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: tool, arguments: args } }),
  });
  const text = await res.text();
  const line = text.split("\n").find((l) => l.startsWith("data: "));
  const payload = JSON.parse(line ? line.slice(6) : text);
  if (payload.error) throw new Error(payload.error.message);
  return payload.result?.content?.[0]?.text ?? "";
}

/** Seeded one await at a time: several tools order by timestamp, and ties would flap. */
async function seed(port: number): Promise<void> {
  await call(port, "save_episode", {
    title: "Kickoff with Alice",
    content: "Agreed the storage direction.",
    source: "claude-code",
    occurred_at: "2026-07-31T09:00:00Z",
    entity_refs: ["Alice", "mem-port"],
  });
  await call(port, "save_memory", {
    content: "User prefers dark mode in all editors",
    memory_type: "preference",
    importance: 0.8,
    entity_refs: ["Alice"],
  });
  await call(port, "save_memory", { content: "Checkout deploys from main only", memory_type: "fact" });
  await call(port, "save_skill", {
    name: "debug-flaky-test",
    description: "Use when a test passes locally but fails intermittently in CI",
    content: "1. Check for shared state.\n2. Look for timing assumptions.",
    tags: ["testing", "ci"],
    source: "claude-code",
    entity_refs: ["checkout-service"],
  });
  await call(port, "save_adr", {
    title: "Use SurrealDB for embedded storage",
    context: "Multi-tenant libraries need isolation per library-id.",
    decision: "Adopt embedded SurrealDB.",
    consequences: "One process to operate.",
    alternatives: "Postgres with pgvector.",
    status: "accepted",
    tags: ["storage"],
    source: "claude-code",
    entity_refs: ["mem-port"],
  });
  // Deliberately omits consequences AND alternatives — the absent-optional case
  // that separates "key missing" from "key null", which is where the two
  // engines behave differently underneath and must not differ above.
  await call(port, "save_adr", {
    title: "Keep embeddings local",
    context: "Sending record text to a hosted API would leak private notes.",
    decision: "Run all-MiniLM-L6-v2 locally.",
  });
  await call(port, "relate_entities", {
    from_entity: "Alice",
    to_entity: "checkout-service",
    relation_type: "leads",
  });
}

const READS: Array<[string, unknown]> = [
  ["search_memory", { query: "what editor theme does the user prefer" }],
  ["search_memory", { query: "anything", memory_types: ["task"] }],
  ["list_episodes", {}],
  ["get_entity", { name: "Alice" }],
  ["get_entity", { name: "checkout-service" }],
  ["list_skills", {}],
  ["search_skills", { query: "test is flaky in CI" }],
  ["get_skill", { name: "debug-flaky-test" }],
  ["list_adrs", {}],
  ["search_adrs", { query: "how do we isolate tenants" }],
  ["get_adr", { number: 1 }],
  ["get_adr", { number: 2 }],
];

/** Boot a daemon on one driver, seed it, capture every read, shut it down. */
async function runDriver(port: number, env: Record<string, string | undefined>): Promise<string[]> {
  const saved: Record<string, string | undefined> = {};
  for (const [k, v] of Object.entries(env)) {
    saved[k] = process.env[k];
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }

  const dataDir = await mkdtemp(path.join(tmpdir(), "mem-port-cross-"));
  let server: Server | undefined;
  try {
    server = await startDaemon({ port, dataDir });
    await seed(port);
    const out: string[] = [];
    for (const [tool, args] of READS) out.push(mask(await call(port, tool, args)));
    return out;
  } finally {
    if (server) await new Promise<void>((r) => server!.close(() => r()));
    // The provider is a process-wide singleton, so it must be released before
    // the next driver builds its own.
    await closeRootConnection();
    await rm(dataDir, { recursive: true, force: true });
    for (const [k, v] of Object.entries(saved)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  }
}

/**
 * The control-plane grant sequence, run against one driver.
 *
 * Separate from runDriver because it exercises ControlPlaneStore directly
 * rather than the MCP endpoint: grants are the layer *above* LibraryStore, and
 * the two implementations of them have to move together or a Postgres
 * deployment quietly hands out the wrong access.
 */
async function runControlPlane(env: Record<string, string | undefined>): Promise<unknown[]> {
  const saved: Record<string, string | undefined> = {};
  for (const [k, v] of Object.entries(env)) {
    saved[k] = process.env[k];
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }

  const dataDir = await mkdtemp(path.join(tmpdir(), "mem-port-cross-cp-"));
  try {
    const cp = await getStoreProvider(resolveConfig({ dataDir })).getControlPlane();
    const out: unknown[] = [];

    const writer = await cp.createUser({ username: "cd-writer" });
    const reader = await cp.createUser({ username: "cd-reader", defaultAccess: "read" });
    out.push(writer.defaultAccess, reader.defaultAccess);

    await cp.grantWorkspace(writer.id, "cd-alpha", "write");
    await cp.grantWorkspace(reader.id, "cd-alpha", "read");
    await cp.grantWorkspace(reader.id, "cd-beta", "write");
    out.push(await cp.listWorkspacesForUser(writer.id), await cp.listWorkspacesForUser(reader.id));

    // Re-granting upserts the level rather than duplicating the row.
    await cp.grantWorkspace(reader.id, "cd-alpha", "write");
    await cp.grantWorkspace(reader.id, "cd-beta", "read");
    out.push(await cp.listWorkspacesForUser(reader.id));

    // The user default is independent of the grants already held.
    await cp.setUserDefaultAccess(reader.id, "write");
    out.push((await cp.getUserByUsername("cd-reader"))?.defaultAccess);
    out.push(await cp.listWorkspacesForUser(reader.id));

    await cp.revokeWorkspace(reader.id, "cd-alpha");
    out.push(await cp.listWorkspacesForUser(reader.id));

    return out;
  } finally {
    await closeRootConnection();
    await rm(dataDir, { recursive: true, force: true });
    for (const [k, v] of Object.entries(saved)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  }
}

let container = false;

beforeAll(() => {
  if (!hasDocker) return;
  try {
    execFileSync("docker", ["rm", "-f", "mp-pg-test"], { stdio: "ignore" });
  } catch {
    // no such container
  }
  execFileSync("docker", [
    "run", "-d", "--name", "mp-pg-test",
    "-e", "POSTGRES_PASSWORD=memport", "-e", "POSTGRES_DB=memport",
    "-p", "15432:5432", "pgvector/pgvector:pg17",
  ]);
  const deadline = Date.now() + 90_000;
  while (!pgReachable()) {
    if (Date.now() > deadline) throw new Error("Postgres container did not become ready");
    execFileSync("sleep", ["1"]);
  }
  container = true;
}, 180_000);

afterAll(() => {
  if (container) {
    try {
      execFileSync("docker", ["rm", "-f", "mp-pg-test"], { stdio: "ignore" });
    } catch {
      // already gone
    }
  }
});

describe.skipIf(!hasDocker)("SurrealDB and Postgres are interchangeable", () => {
  it("produce byte-identical output for every read tool", async () => {
    const surreal = await runDriver(18810, { MEM_PORT_DB_URL: undefined, MEM_PORT_STORE: undefined });
    const postgres = await runDriver(18811, { MEM_PORT_DB_URL: PG_URL, MEM_PORT_STORE: undefined });

    expect(postgres).toHaveLength(surreal.length);
    for (const [i, [tool, args]] of READS.entries()) {
      expect(postgres[i], `${tool} ${JSON.stringify(args)} differs between drivers`).toBe(surreal[i]);
    }
  }, 300_000);

  it("grant read/write levels behave identically in both control planes", async () => {
    const surreal = await runControlPlane({ MEM_PORT_DB_URL: undefined, MEM_PORT_STORE: undefined });
    const postgres = await runControlPlane({ MEM_PORT_DB_URL: PG_URL, MEM_PORT_STORE: undefined });

    expect(postgres).toEqual(surreal);
    // Pinned, so a change that breaks both drivers the same way still fails.
    expect(surreal).toEqual([
      "write",
      "read",
      [{ workspace: "cd-alpha", access: "write" }],
      [
        { workspace: "cd-alpha", access: "read" },
        { workspace: "cd-beta", access: "write" },
      ],
      [
        { workspace: "cd-alpha", access: "write" },
        { workspace: "cd-beta", access: "read" },
      ],
      "write",
      [
        { workspace: "cd-alpha", access: "write" },
        { workspace: "cd-beta", access: "read" },
      ],
      [{ workspace: "cd-beta", access: "read" }],
    ]);
  }, 300_000);
});
