import type { SurrealSession } from "surrealdb";

/**
 * Idempotent schema migration, applied once per library (forked session) on
 * first use. `DEFINE ... IF NOT EXISTS` makes re-running this safe across
 * daemon restarts, where the in-process "already migrated" cache is lost.
 */
export async function ensureSchema(session: SurrealSession): Promise<void> {
  await session.query(`
    DEFINE TABLE IF NOT EXISTS entity SCHEMAFULL;
    DEFINE FIELD IF NOT EXISTS name        ON entity TYPE string;
    DEFINE FIELD IF NOT EXISTS entity_type ON entity TYPE string DEFAULT 'concept';
    DEFINE FIELD IF NOT EXISTS summary     ON entity TYPE option<string>;
    DEFINE FIELD IF NOT EXISTS attributes  ON entity TYPE object DEFAULT {};
    DEFINE FIELD IF NOT EXISTS embedding   ON entity TYPE option<array<float>>;
    DEFINE FIELD IF NOT EXISTS created_at  ON entity TYPE datetime DEFAULT time::now();
    DEFINE INDEX IF NOT EXISTS entity_name_idx ON entity FIELDS name;

    DEFINE TABLE IF NOT EXISTS episode SCHEMAFULL;
    DEFINE FIELD IF NOT EXISTS title       ON episode TYPE string;
    DEFINE FIELD IF NOT EXISTS content     ON episode TYPE string;
    DEFINE FIELD IF NOT EXISTS source      ON episode TYPE string;
    DEFINE FIELD IF NOT EXISTS occurred_at ON episode TYPE datetime DEFAULT time::now();
    DEFINE FIELD IF NOT EXISTS embedding   ON episode TYPE option<array<float>>;
    DEFINE FIELD IF NOT EXISTS created_at  ON episode TYPE datetime DEFAULT time::now();

    DEFINE TABLE IF NOT EXISTS memory SCHEMAFULL;
    DEFINE FIELD IF NOT EXISTS content        ON memory TYPE string;
    DEFINE FIELD IF NOT EXISTS memory_type    ON memory TYPE string DEFAULT 'fact';
    DEFINE FIELD IF NOT EXISTS importance     ON memory TYPE float DEFAULT 0.5;
    DEFINE FIELD IF NOT EXISTS status         ON memory TYPE string DEFAULT 'active';
    DEFINE FIELD IF NOT EXISTS embedding      ON memory TYPE option<array<float>>;
    DEFINE FIELD IF NOT EXISTS source_episode ON memory TYPE option<record<episode>>;
    DEFINE FIELD IF NOT EXISTS created_at     ON memory TYPE datetime DEFAULT time::now();
    DEFINE FIELD IF NOT EXISTS updated_at     ON memory TYPE datetime DEFAULT time::now();

    DEFINE TABLE IF NOT EXISTS mentions TYPE RELATION FROM memory|episode TO entity SCHEMALESS;

    DEFINE TABLE IF NOT EXISTS relates_to TYPE RELATION FROM entity TO entity SCHEMAFULL;
    DEFINE FIELD IF NOT EXISTS relation_type ON relates_to TYPE string;
    DEFINE FIELD IF NOT EXISTS attributes    ON relates_to TYPE object DEFAULT {};
    DEFINE FIELD IF NOT EXISTS created_at    ON relates_to TYPE datetime DEFAULT time::now();
  `);
}
