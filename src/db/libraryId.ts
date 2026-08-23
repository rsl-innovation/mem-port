import { createHash } from "node:crypto";

const MAX_LENGTH = 50;

/**
 * Databases mem-port reserves for itself.
 *
 * The control plane — users, API keys, workspace grants — lives in a database
 * beside the workspace ones. Since a workspace's database name is derived from
 * a caller-supplied header, a caller could otherwise simply ask for
 * `_memport_system` and be handed the table of credentials that decides
 * whether they were allowed to ask for anything at all.
 *
 * Enforced here rather than left to convention, because this is the single
 * function every database name in the system passes through.
 */
export const SYSTEM_DATABASE = "_memport_system";

const RESERVED = new Set([SYSTEM_DATABASE]);

/**
 * A `library-id` header value arrives as arbitrary user text. SurrealDB
 * database names are passed through the SDK's structured `use({ database })`
 * call (not interpolated into SurQL), so this isn't an injection concern —
 * sanitization here is to keep names short, stable, and filesystem/log
 * friendly, and to keep callers out of the reserved namespace.
 */
export function sanitizeLibraryId(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed) {
    throw new Error("library-id header must not be empty");
  }

  let sanitized = trimmed.toLowerCase().replace(/[^a-z0-9_-]/g, "_");

  if (sanitized.length > MAX_LENGTH) {
    const hash = createHash("sha256").update(trimmed).digest("hex").slice(0, 8);
    sanitized = `${sanitized.slice(0, MAX_LENGTH - hash.length - 1)}_${hash}`;
  }

  if (!/^[a-z_]/.test(sanitized)) {
    sanitized = `lib_${sanitized}`;
  }

  // Checked after every transformation, not before: "_MEMPORT_SYSTEM" and
  // " _memport_system " both normalize onto the reserved name, so testing the
  // raw input would miss them.
  if (RESERVED.has(sanitized)) {
    throw new Error(`"${raw}" is a reserved mem-port database name and cannot be used as a library-id`);
  }

  return sanitized;
}
