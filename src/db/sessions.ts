import type { Surreal, SurrealSession } from "surrealdb";
import { sanitizeLibraryId } from "./libraryId.js";
import { ensureSchema } from "./schema.js";

const sessions = new Map<string, SurrealSession>();
const migrated = new Set<string>();

/**
 * One forked SurrealSession per library-id, cached for the life of the daemon.
 * `forkSession()` shares the root connection but gets independent NS/DB state,
 * so concurrent requests for different library-ids can never race each other's
 * active database selection.
 */
export async function getLibrarySession(root: Surreal, rawLibraryId: string): Promise<SurrealSession> {
  const dbName = sanitizeLibraryId(rawLibraryId);

  let session = sessions.get(dbName);
  if (!session) {
    session = await root.forkSession();
    await session.use({ database: dbName });
    sessions.set(dbName, session);
  }

  if (!migrated.has(dbName)) {
    await ensureSchema(session);
    migrated.add(dbName);
  }

  return session;
}
