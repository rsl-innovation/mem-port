import type { SurrealQueryable } from "surrealdb";
import type { Id, IsoDateTime } from "../../interfaces/common.interface.js";
import type {
  AccessLevel,
  AdminSession,
  ApiKey,
  ControlPlaneStore,
  NewApiKey,
  NewUser,
  User,
  Workspace,
  WorkspaceGrant,
} from "../../interfaces/admin.interface.js";
import { fromIso, toId, toIso, toRecordId } from "./map.js";

/**
 * Read a stored access level.
 *
 * Anything that is not exactly "read" is "write" — which covers rows written
 * before the field existed (SurrealDB applies DEFAULT at creation, so those
 * read back as NONE) as well as a value corrupted by hand. Both cases resolve
 * to the level those grants already behaved as, so an upgrade is invisible.
 */
function toAccess(value: unknown): AccessLevel {
  return value === "read" ? "read" : "write";
}

interface UserRow {
  id: unknown;
  username: string;
  is_admin: boolean;
  disabled: boolean;
  password_hash?: string | null;
  default_access?: unknown;
  created_at: unknown;
}

interface KeyRow {
  id: unknown;
  key_id: string;
  secret_hash: string;
  user: unknown;
  label: string;
  created_at: unknown;
  last_used_at?: unknown;
  revoked_at?: unknown;
}

interface WorkspaceRow {
  id: unknown;
  slug: string;
  description?: string | null;
  created_at: unknown;
}

export class SurrealControlPlaneStore implements ControlPlaneStore {
  constructor(private readonly q: SurrealQueryable) {}

  async isUninitialized(): Promise<boolean> {
    const [rows] = await this.q.query<[Array<{ id: unknown }>]>(
      `SELECT id FROM cp_user WHERE is_admin = true LIMIT 1`
    );
    return rows.length === 0;
  }

  // --- users -------------------------------------------------------------

  async createUser(input: NewUser): Promise<User> {
    const [created] = await this.q.query<[UserRow[]]>(
      `CREATE cp_user CONTENT {
         username: $username, is_admin: $is_admin, password_hash: $password_hash,
         default_access: $default_level
       }`,
      {
        username: normalizeUsername(input.username),
        is_admin: input.isAdmin ?? false,
        password_hash: input.passwordHash ?? undefined,
        default_level: input.defaultAccess ?? "write",
      }
    );
    return toUser(created[0]);
  }

  async getUserByUsername(username: string): Promise<User | null> {
    const [rows] = await this.q.query<[UserRow[]]>(`SELECT * FROM cp_user WHERE username = $username LIMIT 1`, {
      username: normalizeUsername(username),
    });
    return rows[0] ? toUser(rows[0]) : null;
  }

  async getUserById(id: Id): Promise<User | null> {
    const [rows] = await this.q.query<[UserRow[]]>(`SELECT * FROM $id`, { id: toRecordId(id) });
    return rows[0] ? toUser(rows[0]) : null;
  }

  async listUsers(): Promise<User[]> {
    const [rows] = await this.q.query<[UserRow[]]>(`SELECT * FROM cp_user ORDER BY username ASC`);
    return rows.map(toUser);
  }

  async setUserDisabled(id: Id, disabled: boolean): Promise<void> {
    await this.q.query(`UPDATE $id SET disabled = $disabled`, { id: toRecordId(id), disabled });
  }

  async setUserPassword(id: Id, passwordHash: string): Promise<void> {
    await this.q.query(`UPDATE $id SET password_hash = $hash`, { id: toRecordId(id), hash: passwordHash });
  }

  async setUserDefaultAccess(id: Id, access: AccessLevel): Promise<void> {
    // Bound as $level, not $access: SurrealDB reserves $access for DEFINE ACCESS
    // and rejects the query outright if you bind that name.
    await this.q.query(`UPDATE $id SET default_access = $level`, { id: toRecordId(id), level: access });
  }

  async deleteUser(id: Id): Promise<void> {
    // Keys, grants and sessions go with the user. Leaving any of them behind
    // would leave a credential that still authenticates against a record that
    // no longer exists.
    const user = toRecordId(id);
    await this.q.query(
      `DELETE cp_key WHERE user = $user;
       DELETE cp_grant WHERE user = $user;
       DELETE cp_session WHERE user = $user;
       DELETE $user;`,
      { user }
    );
  }

  // --- workspaces --------------------------------------------------------

  async createWorkspace(slug: string, description?: string): Promise<Workspace> {
    const [created] = await this.q.query<[WorkspaceRow[]]>(
      `CREATE cp_workspace CONTENT { slug: $slug, description: $description }`,
      { slug, description: description ?? undefined }
    );
    return toWorkspace(created[0]);
  }

  async listWorkspaces(): Promise<Workspace[]> {
    const [rows] = await this.q.query<[WorkspaceRow[]]>(`SELECT * FROM cp_workspace ORDER BY slug ASC`);
    return rows.map(toWorkspace);
  }

  async getWorkspaceBySlug(slug: string): Promise<Workspace | null> {
    const [rows] = await this.q.query<[WorkspaceRow[]]>(`SELECT * FROM cp_workspace WHERE slug = $slug LIMIT 1`, {
      slug,
    });
    return rows[0] ? toWorkspace(rows[0]) : null;
  }

  async deleteWorkspace(id: Id): Promise<void> {
    const [rows] = await this.q.query<[WorkspaceRow[]]>(`SELECT slug FROM $id`, { id: toRecordId(id) });
    const slug = rows[0]?.slug;
    // Grants naming this workspace go too, or a later workspace reusing the
    // slug would silently inherit them.
    if (slug) {
      await this.q.query(`DELETE cp_grant WHERE workspace = $slug`, { slug });
    }
    await this.q.query(`DELETE $id`, { id: toRecordId(id) });
  }

  // --- keys --------------------------------------------------------------

  async createKey(input: NewApiKey): Promise<ApiKey> {
    const [created] = await this.q.query<[KeyRow[]]>(
      `CREATE cp_key CONTENT {
         key_id: $key_id, secret_hash: $secret_hash, user: $user, label: $label
       }`,
      {
        key_id: input.keyId,
        secret_hash: input.secretHash,
        user: toRecordId(input.userId),
        label: input.label,
      }
    );
    return toKey(created[0]);
  }

  async listKeysForUser(userId: Id): Promise<ApiKey[]> {
    const [rows] = await this.q.query<[KeyRow[]]>(
      `SELECT * FROM cp_key WHERE user = $user ORDER BY created_at DESC`,
      { user: toRecordId(userId) }
    );
    return rows.map(toKey);
  }

  async revokeKey(id: Id): Promise<void> {
    await this.q.query(`UPDATE $id SET revoked_at = time::now()`, { id: toRecordId(id) });
  }

  async findKeyByKeyId(keyId: string): Promise<{ key: ApiKey; secretHash: string } | null> {
    const [rows] = await this.q.query<[KeyRow[]]>(`SELECT * FROM cp_key WHERE key_id = $key_id LIMIT 1`, {
      key_id: keyId,
    });
    const row = rows[0];
    return row ? { key: toKey(row), secretHash: row.secret_hash } : null;
  }

  async touchKeyUsed(id: Id): Promise<void> {
    await this.q.query(`UPDATE $id SET last_used_at = time::now()`, { id: toRecordId(id) });
  }

  // --- grants ------------------------------------------------------------

  async grantWorkspace(userId: Id, workspaceSlug: string, access: AccessLevel): Promise<void> {
    // Re-granting a workspace already held sets its level rather than creating
    // a second row the unique index would reject: changing someone between
    // read-only and read-write is the same operation as granting them.
    const [existing] = await this.q.query<[Array<{ id: unknown }>]>(
      `SELECT id FROM cp_grant WHERE user = $user AND workspace = $workspace LIMIT 1`,
      { user: toRecordId(userId), workspace: workspaceSlug }
    );
    if (existing.length > 0) {
      await this.q.query(`UPDATE $id SET access = $level`, { id: existing[0].id, level: access });
      return;
    }

    await this.q.query(`CREATE cp_grant CONTENT { user: $user, workspace: $workspace, access: $level }`, {
      user: toRecordId(userId),
      workspace: workspaceSlug,
      level: access,
    });
  }

  async revokeWorkspace(userId: Id, workspaceSlug: string): Promise<void> {
    await this.q.query(`DELETE cp_grant WHERE user = $user AND workspace = $workspace`, {
      user: toRecordId(userId),
      workspace: workspaceSlug,
    });
  }

  async listWorkspacesForUser(userId: Id): Promise<WorkspaceGrant[]> {
    const [rows] = await this.q.query<[Array<{ workspace: string; access?: unknown }>]>(
      `SELECT workspace, access FROM cp_grant WHERE user = $user ORDER BY workspace ASC`,
      { user: toRecordId(userId) }
    );
    return rows.map((row) => ({ workspace: row.workspace, access: toAccess(row.access) }));
  }

  // --- sessions ----------------------------------------------------------

  async createSession(userId: Id, tokenHash: string, expiresAt: IsoDateTime): Promise<void> {
    await this.q.query(
      `CREATE cp_session CONTENT { token_hash: $hash, user: $user, expires_at: $expires }`,
      { hash: tokenHash, user: toRecordId(userId), expires: fromIso(expiresAt) }
    );
  }

  async findSession(tokenHash: string): Promise<{ userId: Id; expiresAt: IsoDateTime } | null> {
    const [rows] = await this.q.query<[Array<{ user: unknown; expires_at: unknown }>]>(
      `SELECT user, expires_at FROM cp_session WHERE token_hash = $hash LIMIT 1`,
      { hash: tokenHash }
    );
    const row = rows[0];
    return row ? { userId: toId(row.user), expiresAt: toIso(row.expires_at) } : null;
  }

  async deleteSession(tokenHash: string): Promise<void> {
    await this.q.query(`DELETE cp_session WHERE token_hash = $hash`, { hash: tokenHash });
  }

  async deleteExpiredSessions(): Promise<void> {
    await this.q.query(`DELETE cp_session WHERE expires_at < time::now()`);
  }
}

/** Usernames are an identity, so they are compared case-insensitively and stored folded. */
function normalizeUsername(username: string): string {
  return username.trim().toLowerCase();
}

function toUser(row: UserRow): User {
  return {
    id: toId(row.id),
    username: row.username,
    isAdmin: row.is_admin,
    disabled: row.disabled,
    defaultAccess: toAccess(row.default_access),
    passwordHash: row.password_hash,
    createdAt: toIso(row.created_at),
  };
}

function toKey(row: KeyRow): ApiKey {
  return {
    id: toId(row.id),
    keyId: row.key_id,
    userId: toId(row.user),
    label: row.label,
    createdAt: toIso(row.created_at),
    lastUsedAt: row.last_used_at === undefined ? undefined : toIso(row.last_used_at),
    revokedAt: row.revoked_at === undefined ? undefined : toIso(row.revoked_at),
  };
}

function toWorkspace(row: WorkspaceRow): Workspace {
  return {
    id: toId(row.id),
    slug: row.slug,
    description: row.description,
    createdAt: toIso(row.created_at),
  };
}

export type { AdminSession };
