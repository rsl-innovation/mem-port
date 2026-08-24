import { createHmac, timingSafeEqual } from "node:crypto";
import type http from "node:http";
import type { ControlPlaneStore, User } from "../interfaces/admin.interface.js";
import { hashSessionToken, issueSessionToken } from "../auth/secrets.js";

const COOKIE_NAME = "memport_admin";

export interface AdminContext {
  user: User;
  /** Per-session token that every state-changing form must echo back. */
  csrf: string;
}

export function parseCookies(header: string | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  if (!header) return out;
  for (const part of header.split(";")) {
    const eq = part.indexOf("=");
    if (eq === -1) continue;
    out[part.slice(0, eq).trim()] = decodeURIComponent(part.slice(eq + 1).trim());
  }
  return out;
}

/**
 * Start a session and set its cookie.
 *
 * `Secure` is conditional because a cookie marked Secure is never sent over
 * plain HTTP, which would make the panel impossible to sign into on a local
 * daemon. Everywhere else it is set, since that is exactly where the cookie
 * would otherwise cross a network in the clear.
 */
export async function startSession(
  cp: ControlPlaneStore,
  res: http.ServerResponse,
  user: User,
  ttlHours: number,
  secure: boolean
): Promise<void> {
  const token = issueSessionToken();
  const expires = new Date(Date.now() + ttlHours * 3600_000);
  await cp.createSession(user.id, hashSessionToken(token), expires.toISOString());

  const attrs = [
    `${COOKIE_NAME}=${encodeURIComponent(token)}`,
    "Path=/admin",
    "HttpOnly",
    // Strict rather than Lax: nothing links into the panel from elsewhere, so
    // there is no navigation to preserve, and Strict is what stops another
    // site's form from carrying this cookie into a state change.
    "SameSite=Strict",
    `Max-Age=${Math.floor(ttlHours * 3600)}`,
  ];
  if (secure) attrs.push("Secure");
  res.setHeader("set-cookie", attrs.join("; "));
}

export async function endSession(cp: ControlPlaneStore, req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
  const token = parseCookies(req.headers.cookie)[COOKIE_NAME];
  if (token) await cp.deleteSession(hashSessionToken(token));
  res.setHeader("set-cookie", `${COOKIE_NAME}=; Path=/admin; HttpOnly; SameSite=Strict; Max-Age=0`);
}

/** The signed-in admin, or null. Expired and non-admin sessions resolve to null. */
export async function currentAdmin(cp: ControlPlaneStore, req: http.IncomingMessage): Promise<AdminContext | null> {
  const token = parseCookies(req.headers.cookie)[COOKIE_NAME];
  if (!token) return null;

  const tokenHash = hashSessionToken(token);
  const session = await cp.findSession(tokenHash);
  if (!session) return null;

  if (new Date(session.expiresAt).getTime() <= Date.now()) {
    await cp.deleteSession(tokenHash);
    return null;
  }

  const user = await cp.getUserById(session.userId);
  // Re-checked on every request rather than trusted from login: an admin whose
  // rights were removed mid-session must lose the panel immediately, not when
  // their cookie happens to expire.
  if (!user || !user.isAdmin || user.disabled) return null;

  return { user, csrf: csrfFor(tokenHash) };
}

/**
 * A CSRF token bound to the session.
 *
 * Derived from the stored session hash rather than random-and-remembered, so
 * it needs no extra storage and cannot be valid for a different session. The
 * session hash never leaves the server, so the HMAC cannot be reconstructed by
 * a caller who only has the cookie.
 */
function csrfFor(tokenHash: string): string {
  return createHmac("sha256", tokenHash).update("csrf").digest("hex");
}

export function verifyCsrf(context: AdminContext, presented: string | undefined): boolean {
  if (!presented) return false;
  const expected = Buffer.from(context.csrf, "utf8");
  const actual = Buffer.from(presented, "utf8");
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

/** Read and parse an urlencoded form body, with a cap so a large POST cannot exhaust memory. */
export async function readForm(req: http.IncomingMessage, maxBytes = 64 * 1024): Promise<URLSearchParams> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > maxBytes) throw new Error("Request body too large");
    chunks.push(chunk as Buffer);
  }
  return new URLSearchParams(Buffer.concat(chunks).toString("utf8"));
}
