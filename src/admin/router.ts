import type http from "node:http";
import type { AuthConfig } from "../config.js";
import type { ControlPlaneStore } from "../interfaces/admin.interface.js";
import { hashPassword, issueKey, verifyPassword } from "../auth/secrets.js";
import { isReservedLibraryId } from "../db/libraryId.js";
import {
  currentAdmin,
  endSession,
  readForm,
  startSession,
  verifyCsrf,
  type AdminContext,
} from "./session.js";
import { errorPage, loginPage, userPage, usersPage, workspacesPage } from "./views.js";

export const ADMIN_PREFIX = "/admin";

interface Ctx {
  cp: ControlPlaneStore;
  auth: AuthConfig;
  secureCookies: boolean;
}

function html(res: http.ServerResponse, status: number, body: string): void {
  res.writeHead(status, {
    "content-type": "text/html; charset=utf-8",
    // The panel renders operator-supplied names; a strict policy means a
    // missed escape cannot become script execution.
    "content-security-policy": "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'",
    "referrer-policy": "no-referrer",
    "x-content-type-options": "nosniff",
    "cache-control": "no-store",
  });
  res.end(body);
}

function redirect(res: http.ServerResponse, to: string): void {
  res.writeHead(303, { location: to, "cache-control": "no-store" });
  res.end();
}

/**
 * Handle a request under /admin. Returns false if the path is not ours, so the
 * caller can fall through to its own 404.
 */
export async function handleAdminRequest(
  ctx: Ctx,
  req: http.IncomingMessage,
  res: http.ServerResponse
): Promise<boolean> {
  const url = new URL(req.url ?? "/", "http://localhost");
  const path = url.pathname.replace(/\/+$/, "") || ADMIN_PREFIX;
  if (path !== ADMIN_PREFIX && !path.startsWith(`${ADMIN_PREFIX}/`)) return false;

  try {
    await route(ctx, req, res, path, url);
  } catch (err) {
    if (!res.headersSent) {
      html(res, 500, errorPage(500, err instanceof Error ? err.message : "Internal error"));
    }
  }
  return true;
}

async function route(
  ctx: Ctx,
  req: http.IncomingMessage,
  res: http.ServerResponse,
  path: string,
  url: URL
): Promise<void> {
  const { cp } = ctx;
  const method = req.method ?? "GET";

  // --- unauthenticated ---------------------------------------------------

  if (path === `${ADMIN_PREFIX}/login`) {
    if (method === "GET") {
      return html(res, 200, loginPage(url.searchParams.get("error") ?? undefined));
    }
    if (method === "POST") {
      const form = await readForm(req);
      const user = await cp.getUserByUsername(form.get("username") ?? "");

      // One message for a wrong username and a wrong password: distinguishing
      // them tells an attacker which accounts exist.
      const ok =
        user && user.isAdmin && !user.disabled && user.passwordHash
          ? await verifyPassword(form.get("password") ?? "", user.passwordHash)
          : false;

      if (!ok || !user) {
        return redirect(res, `${ADMIN_PREFIX}/login?error=${encodeURIComponent("Incorrect username or password")}`);
      }
      await startSession(cp, res, user, ctx.auth.sessionTtlHours, ctx.secureCookies);
      return redirect(res, `${ADMIN_PREFIX}/workspaces`);
    }
  }

  // --- everything below requires an admin session ------------------------

  const admin = await currentAdmin(cp, req);
  if (!admin) {
    return redirect(res, `${ADMIN_PREFIX}/login`);
  }

  if (method === "POST" && !verifyCsrf(admin, (await readFormOnce(req)).get("csrf") ?? undefined)) {
    return html(res, 403, errorPage(403, "This form has expired. Go back and try again."));
  }
  const form = await readFormOnce(req);

  if (path === ADMIN_PREFIX) return redirect(res, `${ADMIN_PREFIX}/workspaces`);

  if (path === `${ADMIN_PREFIX}/logout` && method === "POST") {
    await endSession(cp, req, res);
    return redirect(res, `${ADMIN_PREFIX}/login`);
  }

  // --- workspaces --------------------------------------------------------

  if (path === `${ADMIN_PREFIX}/workspaces`) {
    if (method === "GET") {
      return html(res, 200, workspacesPage(admin, await cp.listWorkspaces(), flashFrom(url)));
    }
    if (method === "POST") {
      const slug = (form.get("slug") ?? "").trim();
      const error = await validateWorkspaceSlug(cp, slug);
      if (error) return redirect(res, `${ADMIN_PREFIX}/workspaces?err=${encodeURIComponent(error)}`);

      await cp.createWorkspace(slug, form.get("description")?.trim() || undefined);
      return redirect(res, `${ADMIN_PREFIX}/workspaces?ok=${encodeURIComponent(`Created workspace "${slug}"`)}`);
    }
  }

  if (path === `${ADMIN_PREFIX}/workspaces/delete` && method === "POST") {
    await cp.deleteWorkspace(form.get("id") ?? "");
    return redirect(
      res,
      `${ADMIN_PREFIX}/workspaces?ok=${encodeURIComponent("Workspace deleted. Its stored memories were not removed.")}`
    );
  }

  // --- users -------------------------------------------------------------

  if (path === `${ADMIN_PREFIX}/users`) {
    if (method === "GET") {
      return html(res, 200, usersPage(admin, await cp.listUsers(), flashFrom(url)));
    }
    if (method === "POST") {
      const username = (form.get("username") ?? "").trim();
      if (!username) return redirect(res, `${ADMIN_PREFIX}/users?err=${encodeURIComponent("Username is required")}`);
      if (await cp.getUserByUsername(username)) {
        return redirect(res, `${ADMIN_PREFIX}/users?err=${encodeURIComponent(`"${username}" already exists`)}`);
      }

      const password = form.get("password") ?? "";
      const isAdmin = form.get("is_admin") === "1";
      if (isAdmin && !password) {
        return redirect(
          res,
          `${ADMIN_PREFIX}/users?err=${encodeURIComponent("An admin needs a password to sign in to this panel")}`
        );
      }

      const user = await cp.createUser({
        username,
        isAdmin,
        passwordHash: password ? await hashPassword(password) : undefined,
      });
      return redirect(res, `${ADMIN_PREFIX}/users/${encodeURIComponent(user.id)}`);
    }
  }

  const userMatch = /^\/admin\/users\/([^/]+)(\/[a-z/]+)?$/.exec(path);
  if (userMatch) {
    const userId = decodeURIComponent(userMatch[1]);
    const action = userMatch[2] ?? "";
    const user = await cp.getUserById(userId);
    if (!user) return html(res, 404, errorPage(404, "No such user"));

    const render = async (opts: Parameters<typeof userPage>[5] = {}) =>
      html(
        res,
        200,
        userPage(
          admin,
          (await cp.getUserById(userId))!,
          await cp.listKeysForUser(userId),
          await cp.listWorkspacesForUser(userId),
          await cp.listWorkspaces(),
          opts
        )
      );

    if (method === "GET" && action === "") return render({ flash: flashFrom(url) });

    if (method === "POST") {
      switch (action) {
        case "/keys": {
          const issued = issueKey();
          await cp.createKey({
            keyId: issued.keyId,
            secretHash: issued.secretHash,
            userId,
            label: (form.get("label") ?? "").trim(),
          });
          // Rendered directly rather than redirected: the plaintext exists
          // only in this response and must not travel in a URL, where it would
          // land in history and logs.
          return render({ revealedKey: issued.plaintext });
        }
        case "/keys/revoke": {
          await cp.revokeKey(form.get("key_id") ?? "");
          return render({ flash: { kind: "ok", message: "Key revoked." } });
        }
        case "/grants": {
          const workspace = (form.get("workspace") ?? "").trim();
          if (workspace) await cp.grantWorkspace(userId, workspace);
          return render({ flash: { kind: "ok", message: `Granted access to "${workspace}".` } });
        }
        case "/grants/revoke": {
          await cp.revokeWorkspace(userId, form.get("workspace") ?? "");
          return render({ flash: { kind: "ok", message: "Access revoked." } });
        }
        case "/password": {
          const password = form.get("password") ?? "";
          if (!password) return render({ flash: { kind: "err", message: "Password cannot be empty." } });
          await cp.setUserPassword(userId, await hashPassword(password));
          return render({ flash: { kind: "ok", message: "Password updated." } });
        }
        case "/disable": {
          const disabled = form.get("disabled") === "1";
          // Locking yourself out is a support ticket, not a feature.
          if (disabled && userId === admin.user.id) {
            return render({ flash: { kind: "err", message: "You cannot disable your own account." } });
          }
          await cp.setUserDisabled(userId, disabled);
          return render({ flash: { kind: "ok", message: disabled ? "User disabled." : "User re-enabled." } });
        }
        case "/delete": {
          if (userId === admin.user.id) {
            return render({ flash: { kind: "err", message: "You cannot delete your own account." } });
          }
          await cp.deleteUser(userId);
          return redirect(res, `${ADMIN_PREFIX}/users?ok=${encodeURIComponent("User deleted")}`);
        }
      }
    }
  }

  return html(res, 404, errorPage(404, "Not found"));
}

async function validateWorkspaceSlug(cp: ControlPlaneStore, slug: string): Promise<string | undefined> {
  if (!slug) return "Workspace name is required";
  if (!/^[A-Za-z0-9_-]+$/.test(slug)) return "Use letters, digits, hyphens and underscores only";
  // Rejected here as well as at the door, so an admin gets told why rather
  // than creating a workspace whose every request is refused.
  if (isReservedLibraryId(slug)) return `"${slug}" is reserved by mem-port`;
  if (await cp.getWorkspaceBySlug(slug)) return `"${slug}" already exists`;
  return undefined;
}

function flashFrom(url: URL): { kind: "ok" | "err"; message: string } | undefined {
  const ok = url.searchParams.get("ok");
  if (ok) return { kind: "ok", message: ok };
  const err = url.searchParams.get("err");
  if (err) return { kind: "err", message: err };
  return undefined;
}

/**
 * A request body can only be read once, but CSRF verification and the handler
 * both need it. Parsed on first use and cached on the request object.
 */
const FORM_CACHE = new WeakMap<http.IncomingMessage, URLSearchParams>();

async function readFormOnce(req: http.IncomingMessage): Promise<URLSearchParams> {
  if (req.method !== "POST") return new URLSearchParams();
  let cached = FORM_CACHE.get(req);
  if (!cached) {
    cached = await readForm(req);
    FORM_CACHE.set(req, cached);
  }
  return cached;
}
