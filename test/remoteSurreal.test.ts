import { execFileSync } from "node:child_process";
import { execFile } from "node:child_process";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import type { Server } from "node:http";
import { startDaemon } from "../src/daemon.js";
import { closeRootConnection } from "../src/db/connection.js";
import { callTool, firstText } from "../src/mcpClient.js";

const run = promisify(execFile);

/**
 * mem-port against a real, separate SurrealDB server over WebSocket.
 *
 * This is the only test that reaches the parts of the hosted path no local
 * engine can stand in for: authenticating at connect time, defining the
 * namespace on a server that does not create one implicitly, forking a session
 * per library-id over a single socket, migrating a remote database, and
 * running a real remote transaction.
 *
 * The image tag is deliberately v3, not v2 or latest. `forkSession()` and
 * `beginTransaction()` are gated on the SERVER version, not just the transport
 * — `Features.Sessions` and `Features.Transactions` both declare a minimum of
 * 3.0.0 — so mem-port on a 2.x server fails with UnavailableFeatureError on the
 * first request. Pinning v3 here is what keeps that requirement tested rather
 * than remembered.
 *
 * Skips when Docker is unavailable. A skip is a gap in coverage, not a pass.
 */

const PORT = 18797;
const SURREAL_PORT = 18432;
const CONTAINER = "mem-port-test-surreal";
const IMAGE = "surrealdb/surrealdb:v3";

function dockerReady(): boolean {
  try {
    execFileSync("docker", ["info"], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

const hasDocker = dockerReady();
if (!hasDocker) {
  // eslint-disable-next-line no-console
  console.warn("[remoteSurreal] Docker unavailable — the hosted SurrealDB path is NOT being verified.");
}

let server: Server;
let dataDir: string;
const savedEnv: Record<string, string | undefined> = {};

const ENV_KEYS = ["MEM_PORT_DB_URL", "MEM_PORT_DB_USER", "MEM_PORT_DB_PASS", "MEM_PORT_DB_NAMESPACE"] as const;

describe.skipIf(!hasDocker)("hosted SurrealDB over WebSocket", () => {
  beforeAll(async () => {
    await run("docker", ["rm", "-f", CONTAINER]).catch(() => undefined);
    await run("docker", [
      "run", "-d", "--name", CONTAINER,
      "-p", `${SURREAL_PORT}:8000`,
      IMAGE, "start", "--user", "root", "--pass", "root",
    ]);

    // The container binds its port before it will answer RPC; poll rather than sleep.
    const deadline = Date.now() + 60_000;
    for (;;) {
      try {
        if ((await fetch(`http://127.0.0.1:${SURREAL_PORT}/health`)).ok) break;
      } catch {
        // not up yet
      }
      if (Date.now() > deadline) throw new Error("SurrealDB container did not become healthy within 60s");
      await new Promise((resolve) => setTimeout(resolve, 500));
    }

    for (const key of ENV_KEYS) savedEnv[key] = process.env[key];
    process.env.MEM_PORT_DB_URL = `ws://127.0.0.1:${SURREAL_PORT}`;
    process.env.MEM_PORT_DB_USER = "root";
    process.env.MEM_PORT_DB_PASS = "root";
    process.env.MEM_PORT_DB_NAMESPACE = "memport_test";

    dataDir = await mkdtemp(path.join(tmpdir(), "mem-port-remote-test-"));
    server = await startDaemon({ port: PORT, dataDir });
  }, 180_000);

  afterAll(async () => {
    if (server) await new Promise<void>((resolve) => server.close(() => resolve()));
    await closeRootConnection();
    for (const key of ENV_KEYS) {
      if (savedEnv[key] === undefined) delete process.env[key];
      else process.env[key] = savedEnv[key];
    }
    if (dataDir) await rm(dataDir, { recursive: true, force: true });
    await run("docker", ["rm", "-f", CONTAINER]).catch(() => undefined);
  }, 60_000);

  it("is talking to a server new enough for sessions and transactions", async () => {
    const version = await (await fetch(`http://127.0.0.1:${SURREAL_PORT}/version`)).text();
    const major = Number(/surrealdb-(\d+)\./.exec(version)?.[1]);
    expect(major, `${version} is too old: sessions and transactions need >= 3.0.0`).toBeGreaterThanOrEqual(3);
  }, 30_000);

  it("connects, authenticates, migrates and serves a full round trip", async () => {
    await callTool(PORT, "remote-lib", "save_episode", {
      title: "Design review",
      content: "Agreed to put the storage engine behind a contract.",
      source: "claude-code",
      occurred_at: "2026-08-20T10:00:00Z",
      entity_refs: ["mem-port"],
    });

    await callTool(PORT, "remote-lib", "save_memory", {
      content: "The team prefers WebSocket over HTTP for SurrealDB",
      memory_type: "preference",
      importance: 0.7,
      entity_refs: ["mem-port"],
    });

    const hits = JSON.parse(
      firstText(await callTool(PORT, "remote-lib", "search_memory", { query: "which transport is preferred" })) ?? "[]"
    ) as Array<{ content: string }>;
    expect(hits[0]?.content).toMatch(/WebSocket/);

    // Reverse graph traversal, resolved over the remote connection.
    const entity = JSON.parse(firstText(await callTool(PORT, "remote-lib", "get_entity", { name: "mem-port" })) ?? "{}");
    expect(entity.mentioned_by_memories).toHaveLength(1);
    expect(entity.mentioned_by_episodes).toHaveLength(1);
  }, 120_000);

  it("keeps libraries isolated in separate remote databases", async () => {
    await callTool(PORT, "remote-tenant-a", "save_skill", {
      name: "tenant-a-skill",
      description: "tenant A only",
      content: "do the tenant A thing",
    });

    const [a, b] = await Promise.all([
      callTool(PORT, "remote-tenant-a", "list_skills", {}),
      callTool(PORT, "remote-tenant-b", "list_skills", {}),
    ]);
    expect(JSON.parse(firstText(a) ?? "[]")).toHaveLength(1);
    expect(JSON.parse(firstText(b) ?? "[]")).toHaveLength(0);
  }, 120_000);

  it("runs import_library in a real remote transaction, dry run included", async () => {
    const bundle = {
      formatVersion: 1,
      memportVersion: "0.1.0",
      exportedAt: "2026-08-20T10:00:00Z",
      sourceLibraryId: "elsewhere",
      embeddingProvider: { id: "test", dimensions: 3 },
      scope: { type: "all" as const },
      entities: [{ ref: "entity:1", name: "imported-thing", entity_type: "concept", attributes: {} }],
      episodes: [],
      memories: [
        {
          ref: "memory:1",
          content: "An imported memory",
          memory_type: "fact",
          importance: 0.5,
          status: "active",
          contentHash: "abc123",
        },
      ],
      skills: [],
      adrs: [],
      edges: [{ type: "mentions" as const, fromRef: "memory:1", toRef: "entity:1" }],
    };

    const dry = JSON.parse(
      firstText(await callTool(PORT, "remote-import-lib", "import_library", { bundle, dry_run: true })) ?? "{}"
    );
    expect(dry.created).toBe(2);

    // The rollback has to have actually taken effect on the server, not just
    // been reported. This is the assertion that makes the WebSocket-only
    // requirement concrete: over http:// there is no transaction to roll back,
    // so the dry run would leave these rows behind.
    await expect(
      callTool(PORT, "remote-import-lib", "get_entity", { name: "imported-thing" })
    ).rejects.toThrow(/not found/i);

    const real = JSON.parse(firstText(await callTool(PORT, "remote-import-lib", "import_library", { bundle })) ?? "{}");
    expect(real).toMatchObject({ created: 2, updated: 0, skipped: 0, conflicts: 0 });

    const entity = JSON.parse(
      firstText(await callTool(PORT, "remote-import-lib", "get_entity", { name: "imported-thing" })) ?? "{}"
    );
    expect(entity.mentioned_by_memories).toEqual([expect.objectContaining({ content: "An imported memory" })]);
  }, 120_000);
});
