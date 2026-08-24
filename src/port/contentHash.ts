import { createHash } from "node:crypto";

/**
 * The dedupe key for a portable record.
 *
 * Export stamps each record with a `contentHash`; import looks that hash up
 * against what the target library already holds and treats a match as the same
 * record arriving twice. Both sides therefore have to compose the hash from
 * exactly the same fields in exactly the same order — a mismatch does not
 * error, it silently duplicates every record on every import.
 *
 * They used to be two copies held in step by a comment. Now there is one
 * definition, imported by the export path and by every store driver's
 * `hashIndex()`, so the two sides cannot drift.
 */

export function hashContent(content: string): string {
  return createHash("sha256").update(content).digest("hex");
}

/** Tables whose rows are deduped by content rather than by name. */
export type HashableTable = "episode" | "memory" | "skill" | "adr";

/** The fields that identify a row, per table. */
export const HASH_FIELDS: Record<HashableTable, readonly string[]> = {
  episode: ["title", "content"],
  memory: ["content"],
  skill: ["name", "description", "content"],
  adr: ["title", "context", "decision"],
};

/**
 * Compose a row's hash. Fields are joined with newlines in `HASH_FIELDS` order;
 * a driver reading raw rows and the exporter building a bundle both come
 * through here.
 */
export function hashRow(table: HashableTable, row: Record<string, unknown>): string {
  return hashContent(HASH_FIELDS[table].map((field) => String(row[field])).join("\n"));
}
