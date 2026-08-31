import type { AccessLevel, ControlPlaneStore, WorkspaceGrant } from "../interfaces/admin.interface.js";
import { parseKey, verifyKeySecret } from "./secrets.js";

/** Who a request is, once its credential has been checked. */
export interface Principal {
  userId: string;
  username: string;
  isAdmin: boolean;
  /** Workspaces this user has been granted, each with the level it was granted at. */
  workspaces: WorkspaceGrant[];
  /** The key record's id, so its last-used stamp can be updated. */
  keyId: string;
}

export type AuthFailure =
  | { reason: "missing"; status: 401; message: string }
  | { reason: "invalid"; status: 401; message: string }
  | { reason: "revoked"; status: 401; message: string }
  | { reason: "disabled"; status: 403; message: string }
  | { reason: "forbidden"; status: 403; message: string };

export type AuthResult = { ok: true; principal: Principal } | { ok: false; failure: AuthFailure };

/**
 * The result of authorizing a principal for one workspace.
 *
 * Carries the level as well as the yes, because the caller needs both: the yes
 * decides whether the request is answered at all, and the level decides which
 * tools it is answered with.
 */
export type AuthzResult =
  | { ok: true; principal: Principal; access: AccessLevel }
  | { ok: false; failure: AuthFailure };

/** Pull a bearer token out of an Authorization header. */
export function bearerFrom(header: string | string[] | undefined): string | undefined {
  const raw = Array.isArray(header) ? header[0] : header;
  if (!raw) return undefined;
  const match = /^Bearer\s+(.+)$/i.exec(raw.trim());
  return match ? match[1].trim() : undefined;
}

/**
 * Resolve a presented API key to a principal.
 *
 * Deliberately uniform about *why* a credential failed: an unknown key id, a
 * key id that exists with the wrong secret, and a well-formed key that was
 * never issued all come back as the same "invalid" message. Distinguishing
 * them would let a caller probe which key ids exist.
 */
export async function authenticate(presented: string | undefined, cp: ControlPlaneStore): Promise<AuthResult> {
  if (!presented) {
    return {
      ok: false,
      failure: { reason: "missing", status: 401, message: "Missing Authorization header" },
    };
  }

  const parsed = parseKey(presented);
  if (!parsed) {
    return { ok: false, failure: { reason: "invalid", status: 401, message: "Invalid API key" } };
  }

  const found = await cp.findKeyByKeyId(parsed.keyId);
  if (!found || !verifyKeySecret(parsed.secret, found.secretHash)) {
    return { ok: false, failure: { reason: "invalid", status: 401, message: "Invalid API key" } };
  }

  // Revocation is reported plainly. Unlike a wrong secret, saying so leaks
  // nothing a holder of this key does not already know, and silence here would
  // send someone hunting a typo instead of asking for a new key.
  if (found.key.revokedAt) {
    return { ok: false, failure: { reason: "revoked", status: 401, message: "This API key has been revoked" } };
  }

  const user = await cp.getUserById(found.key.userId);
  if (!user) {
    return { ok: false, failure: { reason: "invalid", status: 401, message: "Invalid API key" } };
  }
  if (user.disabled) {
    return { ok: false, failure: { reason: "disabled", status: 403, message: "This account is disabled" } };
  }

  return {
    ok: true,
    principal: {
      userId: user.id,
      username: user.username,
      isAdmin: user.isAdmin,
      workspaces: await cp.listWorkspacesForUser(user.id),
      keyId: found.key.id,
    },
  };
}

/**
 * Whether a principal may open a workspace, and at what level.
 *
 * Being an admin is NOT sufficient. Admins decide who may reach what; that is
 * a different power from reading the contents, and keeping them apart means a
 * leaked admin credential exposes the account model rather than every
 * knowledge graph in the deployment. An admin who wants a workspace grants it
 * to themselves, explicitly and visibly.
 */
export function authorizeWorkspace(principal: Principal, workspaceSlug: string): AuthzResult {
  const grant = principal.workspaces.find((g) => g.workspace === workspaceSlug);
  if (grant) {
    return { ok: true, principal, access: grant.access };
  }
  return {
    ok: false,
    failure: {
      reason: "forbidden",
      status: 403,
      // Same message whether the workspace exists or not, so this cannot be
      // used to enumerate which workspaces a deployment holds.
      message: `No access to workspace "${workspaceSlug}"`,
    },
  };
}
