import type { Id, IsoDateTime } from "../../interfaces/common.interface.js";
import type {
  ApiKey,
  ControlPlaneStore,
  NewApiKey,
  NewUser,
  User,
  Workspace,
} from "../../interfaces/admin.interface.js";
import { fromNullable, toId, toIso, toOptionalIso, toUuid } from "./map.js";
import type { Queryable } from "./queryable.js";

export class PostgresControlPlaneStore implements ControlPlaneStore {
  constructor(
    private readonly q: Queryable,
    private readonly s: string
  ) {}

  async isUninitialized(): Promise<boolean> {
    const { rows } = await this.q.query(`SELECT 1 FROM ${this.s}.cp_user WHERE is_admin = true LIMIT 1`);
    return rows.length === 0;
  }

  // --- users -------------------------------------------------------------

  async createUser(input: NewUser): Promise<User> {
    const { rows } = await this.q.query<Record<string, unknown>>(
      `INSERT INTO ${this.s}.cp_user (username, is_admin, password_hash)
       VALUES ($1, $2, $3) RETURNING *`,
      [normalizeUsername(input.username), input.isAdmin ?? false, input.passwordHash ?? null]
    );
    return toUser(rows[0]);
  }

  async getUserByUsername(username: string): Promise<User | null> {
    const { rows } = await this.q.query<Record<string, unknown>>(
      `SELECT * FROM ${this.s}.cp_user WHERE username = $1 LIMIT 1`,
      [normalizeUsername(username)]
    );
    return rows[0] ? toUser(rows[0]) : null;
  }

  async getUserById(id: Id): Promise<User | null> {
    const uuid = toUuid(id);
    if (!uuid) return null;
    const { rows } = await this.q.query<Record<string, unknown>>(`SELECT * FROM ${this.s}.cp_user WHERE id = $1`, [
      uuid,
    ]);
    return rows[0] ? toUser(rows[0]) : null;
  }

  async listUsers(): Promise<User[]> {
    const { rows } = await this.q.query<Record<string, unknown>>(
      `SELECT * FROM ${this.s}.cp_user ORDER BY username ASC`
    );
    return rows.map(toUser);
  }

  async setUserDisabled(id: Id, disabled: boolean): Promise<void> {
    await this.q.query(`UPDATE ${this.s}.cp_user SET disabled = $1 WHERE id = $2`, [disabled, toUuid(id)]);
  }

  async setUserPassword(id: Id, passwordHash: string): Promise<void> {
    await this.q.query(`UPDATE ${this.s}.cp_user SET password_hash = $1 WHERE id = $2`, [passwordHash, toUuid(id)]);
  }

  async deleteUser(id: Id): Promise<void> {
    // Keys, grants and sessions cascade from the foreign key, so a deleted
    // user cannot leave a credential behind that still authenticates.
    await this.q.query(`DELETE FROM ${this.s}.cp_user WHERE id = $1`, [toUuid(id)]);
  }

  // --- workspaces --------------------------------------------------------

  async createWorkspace(slug: string, description?: string): Promise<Workspace> {
    const { rows } = await this.q.query<Record<string, unknown>>(
      `INSERT INTO ${this.s}.cp_workspace (slug, description) VALUES ($1, $2) RETURNING *`,
      [slug, description ?? null]
    );
    return toWorkspace(rows[0]);
  }

  async listWorkspaces(): Promise<Workspace[]> {
    const { rows } = await this.q.query<Record<string, unknown>>(
      `SELECT * FROM ${this.s}.cp_workspace ORDER BY slug ASC`
    );
    return rows.map(toWorkspace);
  }

  async getWorkspaceBySlug(slug: string): Promise<Workspace | null> {
    const { rows } = await this.q.query<Record<string, unknown>>(
      `SELECT * FROM ${this.s}.cp_workspace WHERE slug = $1 LIMIT 1`,
      [slug]
    );
    return rows[0] ? toWorkspace(rows[0]) : null;
  }

  async deleteWorkspace(id: Id): Promise<void> {
    const uuid = toUuid(id);
    if (!uuid) return;
    // Grants naming this workspace go too, or a later workspace reusing the
    // slug would silently inherit them.
    await this.q.query(
      `DELETE FROM ${this.s}.cp_grant WHERE workspace = (SELECT slug FROM ${this.s}.cp_workspace WHERE id = $1)`,
      [uuid]
    );
    await this.q.query(`DELETE FROM ${this.s}.cp_workspace WHERE id = $1`, [uuid]);
  }

  // --- keys --------------------------------------------------------------

  async createKey(input: NewApiKey): Promise<ApiKey> {
    const { rows } = await this.q.query<Record<string, unknown>>(
      `INSERT INTO ${this.s}.cp_key (key_id, secret_hash, user_id, label)
       VALUES ($1, $2, $3, $4) RETURNING *`,
      [input.keyId, input.secretHash, toUuid(input.userId), input.label]
    );
    return toKey(rows[0]);
  }

  async listKeysForUser(userId: Id): Promise<ApiKey[]> {
    const { rows } = await this.q.query<Record<string, unknown>>(
      `SELECT * FROM ${this.s}.cp_key WHERE user_id = $1 ORDER BY created_at DESC`,
      [toUuid(userId)]
    );
    return rows.map(toKey);
  }

  async revokeKey(id: Id): Promise<void> {
    await this.q.query(`UPDATE ${this.s}.cp_key SET revoked_at = now() WHERE id = $1`, [toUuid(id)]);
  }

  async findKeyByKeyId(keyId: string): Promise<{ key: ApiKey; secretHash: string } | null> {
    const { rows } = await this.q.query<Record<string, unknown>>(
      `SELECT * FROM ${this.s}.cp_key WHERE key_id = $1 LIMIT 1`,
      [keyId]
    );
    return rows[0] ? { key: toKey(rows[0]), secretHash: rows[0].secret_hash as string } : null;
  }

  async touchKeyUsed(id: Id): Promise<void> {
    await this.q.query(`UPDATE ${this.s}.cp_key SET last_used_at = now() WHERE id = $1`, [toUuid(id)]);
  }

  // --- grants ------------------------------------------------------------

  async grantWorkspace(userId: Id, workspaceSlug: string): Promise<void> {
    await this.q.query(
      `INSERT INTO ${this.s}.cp_grant (user_id, workspace) VALUES ($1, $2)
       ON CONFLICT (user_id, workspace) DO NOTHING`,
      [toUuid(userId), workspaceSlug]
    );
  }

  async revokeWorkspace(userId: Id, workspaceSlug: string): Promise<void> {
    await this.q.query(`DELETE FROM ${this.s}.cp_grant WHERE user_id = $1 AND workspace = $2`, [
      toUuid(userId),
      workspaceSlug,
    ]);
  }

  async listWorkspacesForUser(userId: Id): Promise<string[]> {
    const { rows } = await this.q.query<{ workspace: string }>(
      `SELECT workspace FROM ${this.s}.cp_grant WHERE user_id = $1`,
      [toUuid(userId)]
    );
    return rows.map((r) => r.workspace);
  }

  // --- sessions ----------------------------------------------------------

  async createSession(userId: Id, tokenHash: string, expiresAt: IsoDateTime): Promise<void> {
    await this.q.query(
      `INSERT INTO ${this.s}.cp_session (token_hash, user_id, expires_at) VALUES ($1, $2, $3)`,
      [tokenHash, toUuid(userId), expiresAt]
    );
  }

  async findSession(tokenHash: string): Promise<{ userId: Id; expiresAt: IsoDateTime } | null> {
    const { rows } = await this.q.query<{ user_id: string; expires_at: Date }>(
      `SELECT user_id, expires_at FROM ${this.s}.cp_session WHERE token_hash = $1 LIMIT 1`,
      [tokenHash]
    );
    return rows[0] ? { userId: toId("cp_user", rows[0].user_id), expiresAt: toIso(rows[0].expires_at) } : null;
  }

  async deleteSession(tokenHash: string): Promise<void> {
    await this.q.query(`DELETE FROM ${this.s}.cp_session WHERE token_hash = $1`, [tokenHash]);
  }

  async deleteExpiredSessions(): Promise<void> {
    await this.q.query(`DELETE FROM ${this.s}.cp_session WHERE expires_at < now()`);
  }
}

/** Usernames are an identity, so they are compared case-insensitively and stored folded. */
function normalizeUsername(username: string): string {
  return username.trim().toLowerCase();
}

function toUser(r: Record<string, unknown>): User {
  return {
    id: toId("cp_user", r.id as string),
    username: r.username as string,
    isAdmin: r.is_admin as boolean,
    disabled: r.disabled as boolean,
    passwordHash: fromNullable(r.password_hash as string | null),
    createdAt: toIso(r.created_at),
  };
}

function toKey(r: Record<string, unknown>): ApiKey {
  return {
    id: toId("cp_key", r.id as string),
    keyId: r.key_id as string,
    userId: toId("cp_user", r.user_id as string),
    label: r.label as string,
    createdAt: toIso(r.created_at),
    lastUsedAt: toOptionalIso(r.last_used_at),
    revokedAt: toOptionalIso(r.revoked_at),
  };
}

function toWorkspace(r: Record<string, unknown>): Workspace {
  return {
    id: toId("cp_workspace", r.id as string),
    slug: r.slug as string,
    description: fromNullable(r.description as string | null),
    createdAt: toIso(r.created_at),
  };
}
