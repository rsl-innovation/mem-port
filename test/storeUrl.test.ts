import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import type { Server } from "node:http";
import { startDaemon } from "../src/daemon.js";
import { closeRootConnection } from "../src/db/connection.js";
import { callTool, firstText } from "../src/mcpClient.js";

/**
 * Proves MEM_PORT_DB_URL actually reaches the connection, rather than the
 * daemon quietly falling back to the on-disk default.
 *
 * `mem://` is used because it is the one alternative URL available without a
 * server to talk to, but the path under test is the same one a hosted
 * `wss://` URL takes: resolveConfig picks the URL and driver, the provider
 * connects with it, forks a session per library-id, selects that library's
 * database and migrates it. What `mem://` cannot cover is the genuinely
 * remote-only work — signin and DEFINE NAMESPACE — which needs a live server.
 */

const PORT = 18796;
let server: Server;
let dataDir: string;
let previousUrl: string | undefined;

beforeAll(async () => {
  dataDir = await mkdtemp(path.join(tmpdir(), "mem-port-url-test-"));
  previousUrl = process.env.MEM_PORT_DB_URL;
  process.env.MEM_PORT_DB_URL = "mem://";
  server = await startDaemon({ port: PORT, dataDir });
}, 120_000);

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
  await closeRootConnection();
  if (previousUrl === undefined) delete process.env.MEM_PORT_DB_URL;
  else process.env.MEM_PORT_DB_URL = previousUrl;
  await rm(dataDir, { recursive: true, force: true });
});

describe("configured store URL", () => {
  it("serves a full round trip from the configured engine and writes no database file", async () => {
    await callTool(PORT, "url-lib", "save_skill", {
      name: "rotate-credentials",
      description: "Use when a credential has leaked",
      content: "1. Revoke.\n2. Reissue.",
      tags: ["security"],
      entity_refs: ["vault"],
    });

    const got = JSON.parse(firstText(await callTool(PORT, "url-lib", "get_skill", { name: "rotate-credentials" })) ?? "{}");
    expect(got.content).toMatch(/Revoke/);
    expect(got.mentioned_entities).toEqual([expect.objectContaining({ name: "vault" })]);

    // Tenancy still holds when the engine is swapped — it is a property of the
    // provider, not of the storage backend.
    const other = JSON.parse(firstText(await callTool(PORT, "url-other-lib", "list_skills", {})) ?? "[]");
    expect(other).toHaveLength(0);

    // The clincher: an in-memory URL must leave nothing on disk. If the daemon
    // had ignored MEM_PORT_DB_URL and used the default, memport.db would be here.
    expect(await readdir(dataDir)).not.toContain("memport.db");
  }, 120_000);
});
