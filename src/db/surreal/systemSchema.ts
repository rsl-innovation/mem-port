import type { SurrealQueryable } from "surrealdb";

/**
 * Schema for the control-plane database.
 *
 * Lives in its own database (see SYSTEM_DATABASE), which no `library-id` can
 * name, so workspace data and the credentials guarding it never share a
 * namespace.
 *
 * Idempotent, like the workspace schema: `IF NOT EXISTS` throughout so it is
 * safe to re-run on every daemon start.
 */
export async function ensureSystemSchema(q: SurrealQueryable): Promise<void> {
  await q.query(`
    DEFINE TABLE IF NOT EXISTS cp_user SCHEMAFULL;
    DEFINE FIELD IF NOT EXISTS username      ON cp_user TYPE string;
    DEFINE FIELD IF NOT EXISTS is_admin      ON cp_user TYPE bool DEFAULT false;
    DEFINE FIELD IF NOT EXISTS disabled      ON cp_user TYPE bool DEFAULT false;
    DEFINE FIELD IF NOT EXISTS password_hash ON cp_user TYPE option<string>;
    DEFINE FIELD IF NOT EXISTS created_at    ON cp_user TYPE datetime DEFAULT time::now();
    -- Usernames are the login identity, so collisions must be impossible
    -- rather than merely unlikely.
    DEFINE INDEX IF NOT EXISTS cp_user_name_idx ON cp_user FIELDS username UNIQUE;

    DEFINE TABLE IF NOT EXISTS cp_workspace SCHEMAFULL;
    DEFINE FIELD IF NOT EXISTS slug        ON cp_workspace TYPE string;
    DEFINE FIELD IF NOT EXISTS description ON cp_workspace TYPE option<string>;
    DEFINE FIELD IF NOT EXISTS created_at  ON cp_workspace TYPE datetime DEFAULT time::now();
    DEFINE INDEX IF NOT EXISTS cp_workspace_slug_idx ON cp_workspace FIELDS slug UNIQUE;

    DEFINE TABLE IF NOT EXISTS cp_key SCHEMAFULL;
    -- The public half of a key, used to find the record. Unique because a
    -- collision would make two keys indistinguishable at lookup time.
    DEFINE FIELD IF NOT EXISTS key_id       ON cp_key TYPE string;
    -- The secret is NEVER stored, only this hash of it.
    DEFINE FIELD IF NOT EXISTS secret_hash  ON cp_key TYPE string;
    DEFINE FIELD IF NOT EXISTS user         ON cp_key TYPE record<cp_user>;
    DEFINE FIELD IF NOT EXISTS label        ON cp_key TYPE string DEFAULT '';
    DEFINE FIELD IF NOT EXISTS created_at   ON cp_key TYPE datetime DEFAULT time::now();
    DEFINE FIELD IF NOT EXISTS last_used_at ON cp_key TYPE option<datetime>;
    -- Revoked keys are kept rather than deleted, so a later attempt to use one
    -- is recognisable as a revoked key rather than an unknown one.
    DEFINE FIELD IF NOT EXISTS revoked_at   ON cp_key TYPE option<datetime>;
    DEFINE INDEX IF NOT EXISTS cp_key_keyid_idx ON cp_key FIELDS key_id UNIQUE;

    -- Grants are a relation rather than an array on the user, so revoking one
    -- is a delete rather than a read-modify-write that can lose a concurrent
    -- grant.
    DEFINE TABLE IF NOT EXISTS cp_grant SCHEMAFULL;
    DEFINE FIELD IF NOT EXISTS user       ON cp_grant TYPE record<cp_user>;
    DEFINE FIELD IF NOT EXISTS workspace  ON cp_grant TYPE string;
    DEFINE FIELD IF NOT EXISTS created_at ON cp_grant TYPE datetime DEFAULT time::now();
    DEFINE INDEX IF NOT EXISTS cp_grant_pair_idx ON cp_grant FIELDS user, workspace UNIQUE;

    DEFINE TABLE IF NOT EXISTS cp_session SCHEMAFULL;
    -- The session token itself is not stored either, so a leaked database
    -- cannot be replayed as a logged-in browser.
    DEFINE FIELD IF NOT EXISTS token_hash ON cp_session TYPE string;
    DEFINE FIELD IF NOT EXISTS user       ON cp_session TYPE record<cp_user>;
    DEFINE FIELD IF NOT EXISTS expires_at ON cp_session TYPE datetime;
    DEFINE INDEX IF NOT EXISTS cp_session_token_idx ON cp_session FIELDS token_hash UNIQUE;
  `);
}
