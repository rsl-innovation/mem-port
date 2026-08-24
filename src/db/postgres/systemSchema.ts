import type { Queryable } from "./queryable.js";
import { quoteIdent } from "./schema.js";

/**
 * The control-plane schema: users, API keys, workspace grants, admin sessions.
 *
 * Lives in its own schema, which `sanitizeLibraryId` refuses to produce, so no
 * `library-id` can name it.
 */
export async function ensureSystemSchema(q: Queryable, schema: string): Promise<void> {
  const s = quoteIdent(schema);

  await q.query(`CREATE SCHEMA IF NOT EXISTS ${s}`);
  await q.query(`
    CREATE TABLE IF NOT EXISTS ${s}.cp_user (
      id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      username      text NOT NULL,
      is_admin      boolean NOT NULL DEFAULT false,
      disabled      boolean NOT NULL DEFAULT false,
      password_hash text,
      created_at    timestamptz NOT NULL DEFAULT now()
    );
    CREATE UNIQUE INDEX IF NOT EXISTS cp_user_name_idx ON ${s}.cp_user (username);

    CREATE TABLE IF NOT EXISTS ${s}.cp_workspace (
      id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      slug        text NOT NULL,
      description text,
      created_at  timestamptz NOT NULL DEFAULT now()
    );
    CREATE UNIQUE INDEX IF NOT EXISTS cp_workspace_slug_idx ON ${s}.cp_workspace (slug);

    CREATE TABLE IF NOT EXISTS ${s}.cp_key (
      id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      key_id       text NOT NULL,
      -- The secret itself is never stored, only this hash of it.
      secret_hash  text NOT NULL,
      user_id      uuid NOT NULL REFERENCES ${s}.cp_user(id) ON DELETE CASCADE,
      label        text NOT NULL DEFAULT '',
      created_at   timestamptz NOT NULL DEFAULT now(),
      last_used_at timestamptz,
      -- Revoked keys are kept rather than deleted, so a later attempt to use
      -- one is recognisable as revoked rather than unknown.
      revoked_at   timestamptz
    );
    CREATE UNIQUE INDEX IF NOT EXISTS cp_key_keyid_idx ON ${s}.cp_key (key_id);

    CREATE TABLE IF NOT EXISTS ${s}.cp_grant (
      id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id    uuid NOT NULL REFERENCES ${s}.cp_user(id) ON DELETE CASCADE,
      workspace  text NOT NULL,
      created_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE UNIQUE INDEX IF NOT EXISTS cp_grant_pair_idx ON ${s}.cp_grant (user_id, workspace);

    CREATE TABLE IF NOT EXISTS ${s}.cp_session (
      id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      token_hash text NOT NULL,
      user_id    uuid NOT NULL REFERENCES ${s}.cp_user(id) ON DELETE CASCADE,
      expires_at timestamptz NOT NULL
    );
    CREATE UNIQUE INDEX IF NOT EXISTS cp_session_token_idx ON ${s}.cp_session (token_hash);
  `);
}
