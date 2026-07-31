import { createHash } from "node:crypto";

const MAX_LENGTH = 50;

/**
 * A `library-id` header value arrives as arbitrary user text. SurrealDB database
 * names are passed through the SDK's structured `use({ database })` call (not
 * interpolated into SurQL), so this isn't an injection concern — sanitization
 * here is purely to keep names short, stable, and filesystem/log friendly.
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

  return sanitized;
}
