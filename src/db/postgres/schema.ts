import type { Queryable } from "./queryable.js";

/**
 * Embedding width.
 *
 * pgvector needs a fixed dimension to index, and this must match whatever
 * EmbeddingProvider is in use — LocalEmbeddingProvider's all-MiniLM-L6-v2 is
 * 384. Swapping to a model of a different width means a migration, and the
 * mismatch surfaces loudly as a pgvector error on the first insert rather than
 * as quietly wrong search results.
 */
export const EMBEDDING_DIMENSIONS = 384;

/**
 * One schema per workspace, holding the same tables the SurrealDB driver
 * defines as one database per workspace.
 *
 * Isolation is structural rather than a predicate: a query names its schema, so
 * it physically cannot reach another workspace's rows. That is the property the
 * tenancy tests assert, and it is worth the cost of migrating per schema.
 *
 * Idempotent throughout, so it is safe to re-run on every first touch.
 */
export async function ensureSchema(q: Queryable, schema: string): Promise<void> {
  const s = quoteIdent(schema);

  await q.query(`CREATE SCHEMA IF NOT EXISTS ${s}`);

  await q.query(`
    CREATE TABLE IF NOT EXISTS ${s}.entity (
      id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      name        text NOT NULL,
      entity_type text NOT NULL DEFAULT 'concept',
      summary     text,
      attributes  jsonb NOT NULL DEFAULT '{}'::jsonb,
      embedding   vector(${EMBEDDING_DIMENSIONS}),
      created_at  timestamptz NOT NULL DEFAULT now()
    );
    CREATE INDEX IF NOT EXISTS entity_name_idx ON ${s}.entity (name);

    CREATE TABLE IF NOT EXISTS ${s}.episode (
      id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      title       text NOT NULL,
      content     text NOT NULL,
      source      text NOT NULL,
      occurred_at timestamptz NOT NULL DEFAULT now(),
      embedding   vector(${EMBEDDING_DIMENSIONS}),
      created_at  timestamptz NOT NULL DEFAULT now()
    );

    CREATE TABLE IF NOT EXISTS ${s}.memory (
      id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      content        text NOT NULL,
      memory_type    text NOT NULL DEFAULT 'fact',
      importance     double precision NOT NULL DEFAULT 0.5,
      status         text NOT NULL DEFAULT 'active',
      embedding      vector(${EMBEDDING_DIMENSIONS}),
      -- ON DELETE SET NULL, not CASCADE: forgetting the episode a memory came
      -- from must not silently delete the memory derived from it.
      source_episode uuid REFERENCES ${s}.episode(id) ON DELETE SET NULL,
      created_at     timestamptz NOT NULL DEFAULT now(),
      updated_at     timestamptz NOT NULL DEFAULT now()
    );

    CREATE TABLE IF NOT EXISTS ${s}.skill (
      id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      name        text NOT NULL,
      description text NOT NULL,
      content     text NOT NULL,
      tags        text[] NOT NULL DEFAULT '{}',
      source      text NOT NULL DEFAULT 'manual',
      status      text NOT NULL DEFAULT 'active',
      embedding   vector(${EMBEDDING_DIMENSIONS}),
      created_at  timestamptz NOT NULL DEFAULT now(),
      updated_at  timestamptz NOT NULL DEFAULT now()
    );
    -- Deliberately NOT unique: forget_skill soft-archives, so an archived row
    -- keeps its name, and a unique constraint would refuse to let you
    -- re-create a skill you had forgotten. One-active-per-name is enforced by
    -- the upsert in services/skills.ts, not by the schema.
    CREATE INDEX IF NOT EXISTS skill_name_idx ON ${s}.skill (name);

    CREATE TABLE IF NOT EXISTS ${s}.adr (
      id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      number       integer NOT NULL,
      title        text NOT NULL,
      context      text NOT NULL,
      decision     text NOT NULL,
      consequences text,
      alternatives text,
      status       text NOT NULL DEFAULT 'proposed',
      supersedes   uuid REFERENCES ${s}.adr(id) ON DELETE SET NULL,
      tags         text[] NOT NULL DEFAULT '{}',
      source       text NOT NULL DEFAULT 'manual',
      archived     boolean NOT NULL DEFAULT false,
      decided_at   timestamptz NOT NULL DEFAULT now(),
      embedding    vector(${EMBEDDING_DIMENSIONS}),
      created_at   timestamptz NOT NULL DEFAULT now(),
      updated_at   timestamptz NOT NULL DEFAULT now()
    );
    CREATE UNIQUE INDEX IF NOT EXISTS adr_number_idx ON ${s}.adr (number);

    -- SurrealDB models mentions as a typed relation from memory|episode|skill|adr
    -- to entity. Relational storage has no polymorphic foreign key, so the source
    -- table travels alongside the id. No FK on from_id for the same reason;
    -- dangling edges are cleaned up by the delete paths that create them.
    CREATE TABLE IF NOT EXISTS ${s}.mentions (
      id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      from_table text NOT NULL CHECK (from_table IN ('memory','episode','skill','adr')),
      from_id    uuid NOT NULL,
      to_id      uuid NOT NULL REFERENCES ${s}.entity(id) ON DELETE CASCADE,
      created_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE UNIQUE INDEX IF NOT EXISTS mentions_edge_idx ON ${s}.mentions (from_table, from_id, to_id);
    CREATE INDEX IF NOT EXISTS mentions_to_idx ON ${s}.mentions (to_id);

    CREATE TABLE IF NOT EXISTS ${s}.relates_to (
      id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      from_id       uuid NOT NULL REFERENCES ${s}.entity(id) ON DELETE CASCADE,
      to_id         uuid NOT NULL REFERENCES ${s}.entity(id) ON DELETE CASCADE,
      relation_type text NOT NULL,
      attributes    jsonb NOT NULL DEFAULT '{}'::jsonb,
      created_at    timestamptz NOT NULL DEFAULT now()
    );
    CREATE INDEX IF NOT EXISTS relates_to_from_idx ON ${s}.relates_to (from_id);
  `);
}

/**
 * Quote a schema identifier.
 *
 * Schema names come from `sanitizeLibraryId`, whose output is already confined
 * to a safe charset, so this is defence in depth rather than the only guard —
 * but a schema name is interpolated into every statement this driver issues,
 * and that is not a place to rely on an invariant established three files away.
 */
export function quoteIdent(name: string): string {
  // Matches sanitizeLibraryId's own output charset, which includes hyphens.
  // Hyphens are legal inside a quoted identifier; it was worth checking rather
  // than assuming, because a stricter pattern here rejects perfectly valid
  // workspace names like "acme-eng" for no reason.
  if (!/^[a-z_][a-z0-9_-]*$/.test(name)) {
    throw new Error(`Unsafe Postgres identifier "${name}"`);
  }
  return `"${name}"`;
}
