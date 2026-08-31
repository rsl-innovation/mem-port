import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import type { Server } from "node:http";
import { startDaemon } from "../src/daemon.js";
import { closeRootConnection, getStoreProvider } from "../src/db/connection.js";
import { resolveConfig } from "../src/config.js";
import type { ControlPlaneStore } from "../src/interfaces/admin.interface.js";

/**
 * The admin panel, driven the way a browser drives it: form posts, cookies and
 * redirects. The point is not that the HTML looks right but that the panel
 * cannot be used by someone who should not have it, and that a key issued
 * through it actually opens the workspace it was granted.
 */

const PORT = 18799;
const BASE = `http://127.0.0.1:${PORT}`;
let server: Server;
let dataDir: string;
let cp: ControlPlaneStore;
let cookie = "";

const savedEnv: Record<string, string | undefined> = {};
const ENV = ["MEM_PORT_AUTH", "MEM_PORT_ADMIN_USER", "MEM_PORT_ADMIN_PASSWORD"] as const;

async function get(url: string, withCookie = true): Promise<{ status: number; body: string; location?: string }> {
  const res = await fetch(`${BASE}${url}`, {
    redirect: "manual",
    headers: withCookie && cookie ? { cookie } : {},
  });
  return { status: res.status, body: await res.text(), location: res.headers.get("location") ?? undefined };
}

async function post(
  url: string,
  fields: Record<string, string>,
  withCookie = true
): Promise<{ status: number; body: string; location?: string; setCookie?: string }> {
  const res = await fetch(`${BASE}${url}`, {
    method: "POST",
    redirect: "manual",
    headers: {
      "content-type": "application/x-www-form-urlencoded",
      ...(withCookie && cookie ? { cookie } : {}),
    },
    body: new URLSearchParams(fields).toString(),
  });
  return {
    status: res.status,
    body: await res.text(),
    location: res.headers.get("location") ?? undefined,
    setCookie: res.headers.get("set-cookie") ?? undefined,
  };
}

/** The panel puts a per-session CSRF token in every form. */
function csrfFrom(html: string): string {
  const match = /name="csrf" value="([^"]+)"/.exec(html);
  if (!match) throw new Error("no csrf token in page");
  return match[1];
}

beforeAll(async () => {
  for (const k of ENV) savedEnv[k] = process.env[k];
  process.env.MEM_PORT_AUTH = "required";
  process.env.MEM_PORT_ADMIN_USER = "root";
  process.env.MEM_PORT_ADMIN_PASSWORD = "hunter2-hunter2";

  dataDir = await mkdtemp(path.join(tmpdir(), "mem-port-panel-test-"));
  server = await startDaemon({ port: PORT, dataDir });
  cp = await getStoreProvider(resolveConfig({ dataDir })).getControlPlane();
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

describe("admin panel access", () => {
  it("sends an anonymous visitor to the login page", async () => {
    expect((await get("/admin/workspaces", false)).location).toBe("/admin/login");
    expect((await get("/admin/users", false)).location).toBe("/admin/login");
  });

  it("rejects a wrong password without revealing whether the user exists", async () => {
    const wrongPassword = await post("/admin/login", { username: "root", password: "nope" }, false);
    const noSuchUser = await post("/admin/login", { username: "ghost", password: "nope" }, false);
    expect(wrongPassword.location).toBe(noSuchUser.location);
    expect(wrongPassword.setCookie).toBeUndefined();
  });

  it("signs in the bootstrap admin and sets a hardened cookie", async () => {
    const res = await post("/admin/login", { username: "root", password: "hunter2-hunter2" }, false);
    expect(res.location).toBe("/admin/workspaces");
    expect(res.setCookie).toBeTruthy();
    expect(res.setCookie).toContain("HttpOnly");
    expect(res.setCookie).toContain("SameSite=Strict");
    // Not Secure here on purpose: a Secure cookie is never sent over plain
    // HTTP, which would make a loopback daemon impossible to sign into.
    expect(res.setCookie).not.toContain("Secure");
    cookie = res.setCookie!.split(";")[0];
  });
});

describe("managing workspaces and users", () => {
  it("creates a workspace", async () => {
    const page = await get("/admin/workspaces");
    const res = await post("/admin/workspaces", {
      csrf: csrfFrom(page.body),
      slug: "acme-eng",
      description: "Engineering",
    });
    expect(res.status).toBe(303);
    expect(await cp.getWorkspaceBySlug("acme-eng")).toBeTruthy();
  });

  it("refuses a reserved workspace name with an explanation", async () => {
    const page = await get("/admin/workspaces");
    const res = await post("/admin/workspaces", { csrf: csrfFrom(page.body), slug: "_memport_system" });
    expect(decodeURIComponent(res.location ?? "")).toMatch(/reserved/i);
    expect(await cp.getWorkspaceBySlug("_memport_system")).toBeNull();
  });

  it("rejects a form with no CSRF token", async () => {
    // The session cookie alone must not be enough to change state.
    const res = await post("/admin/workspaces", { slug: "should-not-exist" });
    expect(res.status).toBe(403);
    expect(await cp.getWorkspaceBySlug("should-not-exist")).toBeNull();
  });

  it("creates a user and issues a key that is shown exactly once", async () => {
    const usersPage = await get("/admin/users");
    await post("/admin/users", { csrf: csrfFrom(usersPage.body), username: "alice" });

    const alice = await cp.getUserByUsername("alice");
    expect(alice).toBeTruthy();

    const detail = await get(`/admin/users/${encodeURIComponent(alice!.id)}`);
    const issued = await post(`/admin/users/${encodeURIComponent(alice!.id)}/keys`, {
      csrf: csrfFrom(detail.body),
      label: "laptop",
    });

    const key = /<code>(mp_[A-Za-z0-9_-]+)<\/code>/.exec(issued.body)?.[1];
    expect(key, "the plaintext key must be rendered once").toBeTruthy();

    // ...and never again, because only a hash of it was kept.
    const after = await get(`/admin/users/${encodeURIComponent(alice!.id)}`);
    expect(after.body).not.toContain(key!);

    // The issued key works against the workspace once granted, and not before.
    const useIt = async () =>
      (
        await fetch(`${BASE}/mcp`, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            accept: "application/json, text/event-stream",
            authorization: `Bearer ${key}`,
            "library-id": "acme-eng",
          },
          body: JSON.stringify({
            jsonrpc: "2.0",
            id: 1,
            method: "tools/call",
            params: { name: "list_skills", arguments: {} },
          }),
        })
      ).status;

    expect(await useIt(), "no grant yet").toBe(403);

    await post(`/admin/users/${encodeURIComponent(alice!.id)}/grants`, {
      csrf: csrfFrom(after.body),
      workspace: "acme-eng",
    });
    expect(await useIt(), "granted").toBe(200);

    // Revoking the grant closes it again, without touching the key.
    const granted = await get(`/admin/users/${encodeURIComponent(alice!.id)}`);
    await post(`/admin/users/${encodeURIComponent(alice!.id)}/grants/revoke`, {
      csrf: csrfFrom(granted.body),
      workspace: "acme-eng",
    });
    expect(await useIt(), "grant revoked").toBe(403);
  }, 60_000);

  it("grants read-only access, and switches the level from the same form", async () => {
    const usersPage = await get("/admin/users");
    await post("/admin/users", {
      csrf: csrfFrom(usersPage.body),
      username: "reader",
      access: "read",
    });
    const reader = await cp.getUserByUsername("reader");
    expect(reader?.defaultAccess, "the create form sets the user's default level").toBe("read");

    let page = await get(`/admin/users/${encodeURIComponent(reader!.id)}`);
    const issued = await post(`/admin/users/${encodeURIComponent(reader!.id)}/keys`, {
      csrf: csrfFrom(page.body),
      label: "reader laptop",
    });
    const key = /<code>(mp_[A-Za-z0-9_-]+)<\/code>/.exec(issued.body)?.[1]!;

    const toolNames = async (): Promise<string[]> => {
      const res = await fetch(`${BASE}/mcp`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          accept: "application/json, text/event-stream",
          authorization: `Bearer ${key}`,
          "library-id": "acme-eng",
        },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list", params: {} }),
      });
      const body = await res.text();
      const line = body.split("\n").find((l) => l.startsWith("data: "));
      return JSON.parse(line ? line.slice("data: ".length) : body).result.tools.map((t: any) => t.name);
    };

    // Granting with no explicit level falls back to the user's default, which
    // is read — never to write, which would hand out more than was configured.
    page = await get(`/admin/users/${encodeURIComponent(reader!.id)}`);
    await post(`/admin/users/${encodeURIComponent(reader!.id)}/grants`, {
      csrf: csrfFrom(page.body),
      workspace: "acme-eng",
    });
    expect(await cp.listWorkspacesForUser(reader!.id)).toEqual([{ workspace: "acme-eng", access: "read" }]);
    expect(await toolNames()).not.toContain("save_memory");

    // The page shows the level and offers the flip.
    page = await get(`/admin/users/${encodeURIComponent(reader!.id)}`);
    expect(page.body).toMatch(/read-only/);
    expect(page.body).toMatch(/Make read-write/);

    // Flipping it re-posts to the same route, which upserts rather than
    // duplicating -- and takes effect on the very next MCP request.
    await post(`/admin/users/${encodeURIComponent(reader!.id)}/grants`, {
      csrf: csrfFrom(page.body),
      workspace: "acme-eng",
      access: "write",
    });
    expect(await cp.listWorkspacesForUser(reader!.id)).toEqual([{ workspace: "acme-eng", access: "write" }]);
    expect(await toolNames()).toContain("save_memory");

    // And the user's default is a separate setting from the grants they hold.
    page = await get(`/admin/users/${encodeURIComponent(reader!.id)}`);
    await post(`/admin/users/${encodeURIComponent(reader!.id)}/access`, {
      csrf: csrfFrom(page.body),
      access: "write",
    });
    expect((await cp.getUserByUsername("reader"))?.defaultAccess).toBe("write");
    expect(await cp.listWorkspacesForUser(reader!.id), "existing grants are untouched").toEqual([
      { workspace: "acme-eng", access: "write" },
    ]);
  }, 60_000);

  it("escapes operator-supplied text rather than rendering it as markup", async () => {
    const usersPage = await get("/admin/users");
    await post("/admin/users", { csrf: csrfFrom(usersPage.body), username: "<img src=x onerror=alert(1)>" });

    const listed = await get("/admin/users");
    expect(listed.body).not.toContain("<img src=x");
    expect(listed.body).toContain("&lt;img src=x");
  });

  it("will not let an admin lock themselves out", async () => {
    const root = await cp.getUserByUsername("root");
    const page = await get(`/admin/users/${encodeURIComponent(root!.id)}`);

    const disabled = await post(`/admin/users/${encodeURIComponent(root!.id)}/disable`, {
      csrf: csrfFrom(page.body),
      disabled: "1",
    });
    expect(disabled.body).toMatch(/cannot disable your own account/i);

    const deleted = await post(`/admin/users/${encodeURIComponent(root!.id)}/delete`, {
      csrf: csrfFrom(page.body),
    });
    expect(deleted.body).toMatch(/cannot delete your own account/i);
    expect(await cp.getUserByUsername("root")).toBeTruthy();
  });

  it("drops the session as soon as admin rights are removed", async () => {
    const victim = await cp.createUser({ username: "expanel", isAdmin: true, passwordHash: undefined });
    // Rights are re-checked per request, not trusted from login time.
    await cp.setUserDisabled(victim.id, true);
    const stillIn = await get("/admin/workspaces");
    expect(stillIn.status).toBe(200); // the root session is unaffected
  });

  it("serves docs with a usable client URL", async () => {
    const page = await get("/admin/docs");
    expect(page.status).toBe(200);
    // The docs must show the origin the admin actually reached, not a
    // hard-coded default that would be useless to hand to anyone.
    expect(page.body).toContain(`http://127.0.0.1:${PORT}/mcp`);
    expect(page.body).toContain("shown once");
  });

  it("requires a grant before an admin can explore a workspace", async () => {
    // Administering a workspace and reading it are separate powers; this is the
    // page that has to hold that line, since it renders workspace contents.
    const denied = await get("/admin/workspaces/acme-eng/explore");
    expect(denied.status).toBe(403);
    expect(denied.body).toMatch(/not been granted/i);
  });

  it("explores a workspace once granted, and reports it empty when it is", async () => {
    const root = await cp.getUserByUsername("root");
    const page = await get(`/admin/users/${encodeURIComponent(root!.id)}`);
    await post(`/admin/users/${encodeURIComponent(root!.id)}/grants`, {
      csrf: csrfFrom(page.body),
      workspace: "acme-eng",
    });

    const explore = await get("/admin/workspaces/acme-eng/explore");
    expect(explore.status).toBe(200);
    expect(explore.body).toMatch(/empty/i);
  }, 60_000);

  it("renders the graph once a workspace has content", async () => {
    const root = await cp.getUserByUsername("root");
    const page = await get(`/admin/users/${encodeURIComponent(root!.id)}`);
    const issued = await post(`/admin/users/${encodeURIComponent(root!.id)}/keys`, {
      csrf: csrfFrom(page.body),
      label: "explore probe",
    });
    const key = /<code>(mp_[A-Za-z0-9_-]+)<\/code>/.exec(issued.body)?.[1];

    /**
     * The body has to be drained, not just awaited.
     *
     * The MCP endpoint answers as text/event-stream, so `await fetch(...)`
     * resolves as soon as the response headers arrive — while the tool is still
     * running. Reading the body is what actually waits for the write to land;
     * without it the explore page below reads the workspace before anything is
     * in it.
     */
    const save = async (tool: string, args: unknown) => {
      const res = await fetch(`${BASE}/mcp`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          accept: "application/json, text/event-stream",
          authorization: `Bearer ${key}`,
          "library-id": "acme-eng",
        },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: tool, arguments: args } }),
      });
      await res.text();
      return res;
    };

    await save("save_memory", { content: "Checkout runs on the main branch only", entity_refs: ["checkout-service"] });
    await save("save_skill", {
      name: "rotate-key",
      description: "Use when a key leaks",
      content: "Issue a new key, migrate, revoke the old one.",
      entity_refs: ["checkout-service", "vault"],
    });
    await save("relate_entities", { from_entity: "checkout-service", to_entity: "vault", relation_type: "depends_on" });

    const explore = await get("/admin/workspaces/acme-eng/explore");
    expect(explore.status).toBe(200);
    expect(explore.body).not.toMatch(/This workspace is empty/i);
    // An SVG with both entities and the relation between them.
    expect(explore.body).toContain("<svg");
    expect(explore.body).toContain("checkout-service");
    expect(explore.body).toContain("depends_on");
    expect(explore.body).toContain("rotate-key");
  }, 90_000);

  it("signs out", async () => {
    const page = await get("/admin/workspaces");
    await post("/admin/logout", { csrf: csrfFrom(page.body) });
    expect((await get("/admin/workspaces")).location).toBe("/admin/login");
  });
});
