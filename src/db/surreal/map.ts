import { DateTime, StringRecordId } from "surrealdb";
import type { Id, IsoDateTime, Vector } from "../../interfaces/common.interface.js";

/**
 * Translation between SurrealDB's wire values and the plain types the contract
 * speaks in. Every value crossing out of this driver goes through here.
 */

/**
 * A record id in its string form.
 *
 * `String(v)` is literally the expression the tool files used inline before
 * this driver existed, so ids stay byte-identical to what clients already hold.
 */
export function toId(value: unknown): Id {
  return String(value);
}

/** As `toId`, but preserves "this record has no link" rather than stringifying undefined. */
export function toOptionalId(value: unknown): Id | undefined {
  return value === null || value === undefined ? undefined : String(value);
}

/**
 * A SurrealDB `DateTime` as an ISO-8601 string.
 *
 * Goes through `toISOString()`, which is exactly what `DateTime.toJSON()`
 * returns, so a timestamp that used to reach the client by being passed raw
 * into `JSON.stringify` now reaches it as the same characters. Deliberately
 * NOT `.toDate()`, which truncates SurrealDB's nanoseconds to milliseconds and
 * would quietly rewrite every timestamp in every response.
 */
export function toIso(value: unknown): IsoDateTime {
  const candidate = value as { toISOString?: () => string } | null | undefined;
  return typeof candidate?.toISOString === "function" ? candidate.toISOString() : String(value);
}

/** ISO string back into a `DateTime` for writing. Nanosecond-lossless in both directions. */
export function fromIso(value: IsoDateTime | undefined): DateTime | undefined {
  return value === undefined ? undefined : new DateTime(value);
}

/** A record id string back into the bindable form SurrealDB expects. */
export function toRecordId(id: Id): StringRecordId {
  return new StringRecordId(id);
}

/** As `toRecordId`, passing absence through so an optional link stays unset. */
export function toOptionalRecordId(id: Id | null | undefined): StringRecordId | undefined {
  return id === null || id === undefined ? undefined : new StringRecordId(id);
}

/**
 * An embedding as stored.
 *
 * Passed through untouched rather than coalesced: an unset `option<array<float>>`
 * comes back as `undefined` and a bundle that has been through JSON carries
 * `null`, and both round-trip through the export format unchanged.
 */
export function toVector(value: unknown): Vector | null | undefined {
  return value as Vector | null | undefined;
}
