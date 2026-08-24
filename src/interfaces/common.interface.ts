/**
 * Primitives shared by every domain type.
 *
 * These exist to keep storage-engine concepts from reaching the tool layer.
 * A tool should never see a SurrealDB `RecordId`, a `DateTime` wrapper, or a
 * `StringRecordId` — it sees strings, and the driver is responsible for the
 * translation in both directions.
 */

/**
 * A record id in its string form, e.g. "skill:x9k2ab".
 *
 * The Surreal driver produces this with `String(recordId)`, which is exactly
 * the expression the tool files used inline before, so the ids clients already
 * hold keep resolving. Opaque by contract: parse it in the driver that minted
 * it, nowhere else.
 */
export type Id = string;

/**
 * An ISO-8601 timestamp, e.g. "2026-07-31T09:00:00.123456789Z".
 *
 * Deliberately a string and not a `Date`. SurrealDB datetimes carry nanosecond
 * precision and the tools serialize these values straight into their JSON
 * output; `Date` only holds milliseconds, so routing timestamps through it
 * would silently rewrite "…123456789Z" as "…123Z" in every response. Going
 * string-to-string keeps the wire format byte-identical and round-trips back
 * into the database without loss.
 */
export type IsoDateTime = string;

/** An embedding vector. Length is fixed by the embedding provider, not by the store. */
export type Vector = number[];

/** The shape an entity is named by when it appears inside another record's result. */
export interface EntityRef {
  id: Id;
  name: string;
}

/** Mixed into a row returned by a similarity search. Cosine similarity, -1 to 1. */
export interface Scored {
  score: number;
}

/**
 * Mixed into a row on its way into an export bundle.
 *
 * Optional *and* nullable on purpose: SurrealDB returns an unset `option<>`
 * field as `undefined`, while a bundle that has been through JSON carries an
 * explicit `null`. Both must survive a round trip untouched.
 */
export interface Embedded {
  embedding?: Vector | null;
}
