import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import type { Server } from "node:http";
import { startDaemon } from "../src/daemon.js";
import { closeRootConnection, getStoreProvider } from "../src/db/connection.js";
import { resolveConfig } from "../src/config.js";
import { issueKey } from "../src/auth/secrets.js";
import type { ControlPlaneStore } from "../src/interfaces/admin.interface.js";

/**
 * Enforcement of the account model on the MCP endpoint.
 *
 * These are the tests that decide whether mem-port can be exposed at all. The
 * tenancy suite proves workspaces cannot see each other's data; this proves a
 * caller cannot reach a workspace it was never granted, which is a different
 * claim and the one that matters once the loopback boundary is gone.
 */

const PORT = 18798;
let server: Server;
let dataDir: string;
let cp: ControlPlaneStore;

const savedEnv: Record<string, string | undefined> = {};
const ENV = ["MEM_PORT_AUTH", "MEM_PORT_ADMIN_USER", "MEM_PORT_ADMIN_PASSWORD"] as const;

let aliceKey: string;
let bobKey: string;
let revokedKey: string;
let disabledKey: string;

async function mcp(
  key: string | undefined,
  libraryId: string | undefined,
  body: unknown = { jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "list_skills", arguments: {} } }
): Promise<{ status: number; text: string }> {
  const headers: Record<string, string> = {
    "content-type": "application/json",
    accept: "application/json, text/event-stream",
  };
  if (key) headers.authorization = `Bearer ${key}`;
  if (libraryId) headers["library-id"] = libraryId;

  const res = await fetch(`http://127.0.0.1:${PORT}/mcp`, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });
  return { status: res.status, text: await res.text() };
}

beforeAll(async () => {
  for (const k of ENV) savedEnv[k] = process.env[k];
  process.env.MEM_PORT_AUTH = "required";
  process.env.MEM_PORT_ADMIN_USER = "root";
  process.env.MEM_PORT_ADMIN_PASSWORD = "bootstrap-secret";

  dataDir = await mkdtemp(path.join(tmpdir(), "mem-port-auth-test-"));
  server = await startDaemon({ port: PORT, dataDir });

  cp = await getStoreProvider(resolveConfig({ dataDir })).getControlPlane();

  await cp.createWorkspace("alpha");
  await cp.createWorkspace("beta");

  const alice = await cp.createUser({ username: "alice" });
  await cp.grantWorkspace(alice.id, "alpha");
  const issuedAlice = issueKey();
  await cp.createKey({ ...issuedAlice, userId: alice.id, label: "alice laptop" });
  aliceKey = issuedAlice.plaintext;

  const bob = await cp.createUser({ username: "bob" });
  await cp.grantWorkspace(bob.id, "beta");
  const issuedBob = issueKey();
  await cp.createKey({ ...issuedBob, userId: bob.id, label: "bob laptop" });
  bobKey = issuedBob.plaintext;

  const issuedRevoked = issueKey();
  const revoked = await cp.createKey({ ...issuedRevoked, userId: alice.id, label: "old" });
  await cp.revokeKey(revoked.id);
  revokedKey = issuedRevoked.plaintext;

  const carol = await cp.createUser({ username: "carol" });
  await cp.grantWorkspace(carol.id, "alpha");
  const issuedCarol = issueKey();
  await cp.createKey({ ...issuedCarol, userId: carol.id, label: "carol" });
  await cp.setUserDisabled(carol.id, true);
  disabledKey = issuedCarol.plaintext;
}, 180_000);

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
  await closeRootConnection();
  for (const k of ENV) {
    if (savedEnv[k] === undefined) delete process.env[k];
    else process.env[k] = savedEnv[k];
  }
  await rm(dataDir, { recursive: true, force: true });
});

describe("api key enforcement", () => {
  it("bootstraps exactly one admin from the environment", async () => {
    const root = await cp.getUserByUsername("root");
    expect(root?.isAdmin).toBe(true);
    expect(root?.passwordHash, "the bootstrap password must be hashed, never stored raw").not.toContain(
      "bootstrap-secret"
    );
    expect(await cp.isUninitialized()).toBe(false);
  });

  it("rejects a request with no credential", async () => {
    const res = await mcp(undefined, "alpha");
    expect(res.status).toBe(401);
  });

  it.each([
    ["garbage", "not-a-key"],
    ["well-formed but never issued", issueKey().plaintext],
  ])("rejects %s", async (_label, key) => {
    expect((await mcp(key, "alpha")).status).toBe(401);
  });

  it("rejects a key whose secret is wrong even though its id is real", async () => {
    // The id half is public and appears in the admin UI, so possessing it must
    // prove nothing on its own.
    const tampered = aliceKey.slice(0, -4) + "AAAA";
    expect((await mcp(tampered, "alpha")).status).toBe(401);
  });

  it("rejects a revoked key", async () => {
    expect((await mcp(revokedKey, "alpha")).status).toBe(401);
  });

  it("rejects a key belonging to a disabled user", async () => {
    expect((await mcp(disabledKey, "alpha")).status).toBe(403);
  });

  it("accepts a valid key for a granted workspace", async () => {
    const res = await mcp(aliceKey, "alpha");
    expect(res.status).toBe(200);
    expect(res.text).toContain("list_skills");
  });

  it("refuses a workspace the caller was not granted", async () => {
    // Alice's key is entirely valid; this is authorization, not authentication.
    expect((await mcp(aliceKey, "beta")).status).toBe(403);
    expect((await mcp(bobKey, "alpha")).status).toBe(403);
  });

  it("gives the same answer for a workspace that does not exist", async () => {
    // Otherwise the difference between 403 and 404 enumerates the deployment.
    const denied = await mcp(aliceKey, "beta");
    const missing = await mcp(aliceKey, "no-such-workspace");
    expect(missing.status).toBe(denied.status);
  });

  it("refuses a request with no library-id even when authenticated", async () => {
    expect((await mcp(aliceKey, undefined)).status).toBe(403);
  });

  it("never lets a caller reach the control-plane database", async () => {
    // The worst case: an authenticated caller who has somehow been granted the
    // reserved name outright. It must still be refused, and refused at the
    // door rather than by a tool erroring out behind a 200.
    const alice = await cp.getUserByUsername("alice");
    await cp.grantWorkspace(alice!.id, "_memport_system");

    const res = await mcp(aliceKey, "_memport_system");
    expect(res.status).toBe(403);
    expect(res.text).not.toContain("cp_user");
    expect(res.text).not.toContain("secret_hash");

    await cp.revokeWorkspace(alice!.id, "_memport_system");
  });

  it("records that a key was used", async () => {
    await mcp(aliceKey, "alpha");
    // Written best-effort after the response, so allow it a moment to land.
    await new Promise((r) => setTimeout(r, 300));
    const alice = await cp.getUserByUsername("alice");
    const keys = await cp.listKeysForUser(alice!.id);
    expect(keys.find((k) => k.label === "alice laptop")?.lastUsedAt).toBeTruthy();
  });
});
