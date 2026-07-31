import type { SurrealSession } from "surrealdb";

/**
 * Resolve entity name references to record ids, creating any entity that
 * doesn't exist yet ("get or create" — callers shouldn't have to pre-create
 * entities just to mention them from a memory or episode).
 */
export async function resolveEntityRefs(session: SurrealSession, names: string[] | undefined): Promise<unknown[]> {
  if (!names || names.length === 0) {
    return [];
  }

  const ids: unknown[] = [];
  for (const name of names) {
    const [existing] = await session.query<[Array<{ id: unknown }>]>(
      `SELECT id FROM entity WHERE name = $name LIMIT 1`,
      { name }
    );
    if (existing.length > 0) {
      ids.push(existing[0].id);
      continue;
    }

    const [created] = await session.query<[Array<{ id: unknown }>]>(`CREATE entity CONTENT { name: $name }`, {
      name,
    });
    ids.push(created[0].id);
  }

  return ids;
}

export async function createMentionEdges(session: SurrealSession, fromId: unknown, entityIds: unknown[]): Promise<void> {
  for (const entityId of entityIds) {
    await session.query(`RELATE $from->mentions->$to`, { from: fromId, to: entityId });
  }
}
