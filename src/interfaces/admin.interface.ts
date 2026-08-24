import type { Id, IsoDateTime } from "./common.interface.js";

/**
 * The control plane: who may reach which workspace.
 *
 * A *workspace* is what the `library-id` header names — one isolated knowledge
 * graph, one database. This layer says nothing about what is inside a
 * workspace; it decides only whether a request gets to open one at all.
 *
 * Kept separate from `LibraryStore` on purpose. That contract describes a
 * knowledge graph and is what a Postgres driver would implement; this
 * describes mem-port's own account model, which every driver would share.
 */

export interface User {
  id: Id;
  /** Login/display name, unique and case-folded. */
  username: string;
  /** Admins reach the admin panel; everyone else only holds keys. */
  isAdmin: boolean;
  disabled: boolean;
  createdAt: IsoDateTime;
  /** Present only for users who can sign in to the panel. */
  passwordHash?: string | null;
}

export interface NewUser {
  username: string;
  isAdmin?: boolean;
  passwordHash?: string | null;
}

/**
 * An issued API key.
 *
 * The secret itself is never stored — only `secretHash`, and `keyId` so a
 * presented key can be found in one lookup rather than by hashing it against
 * every key on file. A key is shown to the admin once, at creation.
 */
export interface ApiKey {
  id: Id;
  keyId: string;
  userId: Id;
  /** What this key is for, e.g. "alice's laptop". */
  label: string;
  createdAt: IsoDateTime;
  lastUsedAt?: IsoDateTime | null;
  /** Set when revoked; a revoked key is kept so its use can still be recognised. */
  revokedAt?: IsoDateTime | null;
}

export interface NewApiKey {
  keyId: string;
  secretHash: string;
  userId: Id;
  label: string;
}

/** A key resolved from a presented credential, with everything a request needs to authorize. */
export interface AuthenticatedKey {
  key: ApiKey;
  user: User;
  /** Workspace ids this key's user may open. */
  workspaces: string[];
}

export interface Workspace {
  id: Id;
  /** The value clients send as `library-id`. */
  slug: string;
  description?: string | null;
  createdAt: IsoDateTime;
}

export interface AdminSession {
  token: string;
  userId: Id;
  expiresAt: IsoDateTime;
}

/**
 * Storage for the control plane.
 *
 * Every method here runs on the request path or the admin panel, so it is
 * deliberately small: one lookup to authenticate, and CRUD for the panel.
 */
export interface ControlPlaneStore {
  /** True when no admin exists yet, so the bootstrap admin should be created. */
  isUninitialized(): Promise<boolean>;

  createUser(input: NewUser): Promise<User>;
  getUserByUsername(username: string): Promise<User | null>;
  getUserById(id: Id): Promise<User | null>;
  listUsers(): Promise<User[]>;
  setUserDisabled(id: Id, disabled: boolean): Promise<void>;
  setUserPassword(id: Id, passwordHash: string): Promise<void>;
  deleteUser(id: Id): Promise<void>;

  createWorkspace(slug: string, description?: string): Promise<Workspace>;
  listWorkspaces(): Promise<Workspace[]>;
  getWorkspaceBySlug(slug: string): Promise<Workspace | null>;
  deleteWorkspace(id: Id): Promise<void>;

  createKey(input: NewApiKey): Promise<ApiKey>;
  listKeysForUser(userId: Id): Promise<ApiKey[]>;
  revokeKey(id: Id): Promise<void>;
  /**
   * Resolve a presented key. Returns the record and its secret hash for the
   * caller to verify — verification is a crypto concern, not a storage one.
   */
  findKeyByKeyId(keyId: string): Promise<{ key: ApiKey; secretHash: string } | null>;
  touchKeyUsed(id: Id): Promise<void>;

  grantWorkspace(userId: Id, workspaceSlug: string): Promise<void>;
  revokeWorkspace(userId: Id, workspaceSlug: string): Promise<void>;
  listWorkspacesForUser(userId: Id): Promise<string[]>;

  createSession(userId: Id, tokenHash: string, expiresAt: IsoDateTime): Promise<void>;
  findSession(tokenHash: string): Promise<{ userId: Id; expiresAt: IsoDateTime } | null>;
  deleteSession(tokenHash: string): Promise<void>;
  deleteExpiredSessions(): Promise<void>;
}
