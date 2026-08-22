import type { SurrealQueryable } from "surrealdb";

/**
 * Idempotent schema migration, applied once per library (forked session) on
 * first use. `DEFINE ... IF NOT EXISTS` makes re-running this safe across
 * daemon restarts, where the in-process "already migrated" cache is lost.
 */
export async function ensureSchema(session: SurrealQueryable): Promise<void> {
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

    DEFINE TABLE IF NOT EXISTS skill SCHEMAFULL;
    DEFINE FIELD IF NOT EXISTS name        ON skill TYPE string;
    DEFINE FIELD IF NOT EXISTS description ON skill TYPE string;
    DEFINE FIELD IF NOT EXISTS content     ON skill TYPE string;
    DEFINE FIELD IF NOT EXISTS tags        ON skill TYPE array<string> DEFAULT [];
    DEFINE FIELD IF NOT EXISTS source      ON skill TYPE string DEFAULT 'manual';
    DEFINE FIELD IF NOT EXISTS status      ON skill TYPE string DEFAULT 'active';
    DEFINE FIELD IF NOT EXISTS embedding   ON skill TYPE option<array<float>>;
    DEFINE FIELD IF NOT EXISTS created_at  ON skill TYPE datetime DEFAULT time::now();
    DEFINE FIELD IF NOT EXISTS updated_at  ON skill TYPE datetime DEFAULT time::now();
    DEFINE INDEX IF NOT EXISTS skill_name_idx ON skill FIELDS name;

    -- Architectural decision records. Note 'status' is the ADR lifecycle
    -- (proposed/accepted/superseded/deprecated), NOT the soft-delete flag that
    -- memory and skill overload it for — 'archived' carries that here instead.
    DEFINE TABLE IF NOT EXISTS adr SCHEMAFULL;
    DEFINE FIELD IF NOT EXISTS number       ON adr TYPE int;
    DEFINE FIELD IF NOT EXISTS title        ON adr TYPE string;
    DEFINE FIELD IF NOT EXISTS context      ON adr TYPE string;
    DEFINE FIELD IF NOT EXISTS decision     ON adr TYPE string;
    DEFINE FIELD IF NOT EXISTS consequences ON adr TYPE option<string>;
    DEFINE FIELD IF NOT EXISTS alternatives ON adr TYPE option<string>;
    DEFINE FIELD IF NOT EXISTS status       ON adr TYPE string DEFAULT 'proposed';
    DEFINE FIELD IF NOT EXISTS supersedes   ON adr TYPE option<record<adr>>;
    DEFINE FIELD IF NOT EXISTS tags         ON adr TYPE array<string> DEFAULT [];
    DEFINE FIELD IF NOT EXISTS source       ON adr TYPE string DEFAULT 'manual';
    DEFINE FIELD IF NOT EXISTS archived     ON adr TYPE bool DEFAULT false;
    DEFINE FIELD IF NOT EXISTS decided_at   ON adr TYPE datetime DEFAULT time::now();
    DEFINE FIELD IF NOT EXISTS embedding    ON adr TYPE option<array<float>>;
    DEFINE FIELD IF NOT EXISTS created_at   ON adr TYPE datetime DEFAULT time::now();
    DEFINE FIELD IF NOT EXISTS updated_at   ON adr TYPE datetime DEFAULT time::now();
    DEFINE INDEX IF NOT EXISTS adr_number_idx ON adr FIELDS number UNIQUE;

    -- OVERWRITE (not IF NOT EXISTS): the FROM set has grown as new mentionable
    -- tables were added, and this redefines only the relation's type constraint,
    -- not its existing edge rows, so it's safe to re-run against older libraries.
    DEFINE TABLE OVERWRITE mentions TYPE RELATION FROM memory|episode|skill|adr TO entity SCHEMALESS;

    DEFINE TABLE IF NOT EXISTS relates_to TYPE RELATION FROM entity TO entity SCHEMAFULL;
    DEFINE FIELD IF NOT EXISTS relation_type ON relates_to TYPE string;
    DEFINE FIELD IF NOT EXISTS attributes    ON relates_to TYPE object DEFAULT {};
    DEFINE FIELD IF NOT EXISTS created_at    ON relates_to TYPE datetime DEFAULT time::now();
  `);
}
