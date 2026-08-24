import type { Id, IsoDateTime, Vector } from "../../interfaces/common.interface.js";

/**
 * Translation between Postgres rows and the plain types the contract speaks in.
 */

/**
 * Ids are `<table>:<uuid>`.
 *
 * The contract treats an id as opaque, so a bare uuid would satisfy it. The
 * prefix is kept anyway because ids surface in tool output, error messages and
 * the admin UI, where "memory:9f3c…" says what it is and a bare uuid does not —
 * and because it keeps the shape identical to the SurrealDB driver, so nothing
 * downstream can come to depend on one driver's spelling.
 */
export function toId(table: string, uuid: string): Id {
  return `${table}:${uuid}`;
}

/**
 * Pull the uuid back out of an id.
 *
 * Returns null rather than throwing for anything malformed: ids arrive from
 * tool arguments, so a caller can hand us arbitrary text, and that is a
 * not-found rather than a server fault.
 */
export function toUuid(id: Id | null | undefined): string | null {
  if (!id) return null;
  const raw = id.includes(":") ? id.slice(id.indexOf(":") + 1) : id;
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(raw) ? raw : null;
}

/**
 * A timestamp as an ISO-8601 string.
 *
 * `pg` decodes timestamptz into a JS Date, which holds milliseconds. That is
 * lossless here because Postgres stores microseconds at most and mem-port only
 * ever writes what it was given, but the conversion still goes through one
 * place so the boundary rule — timestamps cross as strings — has a single
 * enforcement point.
 */
export function toIso(value: unknown): IsoDateTime {
  if (value instanceof Date) return value.toISOString();
  return String(value);
}

/** As `toIso`, preserving absence. */
export function toOptionalIso(value: unknown): IsoDateTime | undefined {
  return value === null || value === undefined ? undefined : toIso(value);
}

/**
 * An embedding for storage.
 *
 * pgvector accepts its literal text form, `[1,2,3]`. Absence is passed through
 * as null so an unset embedding stays unset rather than becoming a zero vector.
 */
export function toVectorLiteral(vector: Vector | null | undefined): string | null {
  return vector === null || vector === undefined ? null : `[${vector.join(",")}]`;
}

/** An embedding as read back. pgvector returns its text form. */
export function fromVectorLiteral(value: unknown): Vector | null | undefined {
  if (value === null || value === undefined) return undefined;
  if (Array.isArray(value)) return value as Vector;
  const text = String(value).trim();
  if (!text.startsWith("[")) return undefined;
  return text.slice(1, -1).split(",").filter(Boolean).map(Number);
}

/**
 * `undefined` for a NULL column, never `null`.
 *
 * The boundary rule is that an unset optional field is absent from a response,
 * because `JSON.stringify` omits an undefined key but emits `"k": null`. The
 * SurrealDB driver gets this for free — it returns undefined for an unset
 * `option<>` — whereas Postgres returns an explicit null for every nullable
 * column, so it has to be converted here or every response would grow keys.
 */
export function fromNullable<T>(value: T | null): T | undefined {
  return value === null ? undefined : value;
}
