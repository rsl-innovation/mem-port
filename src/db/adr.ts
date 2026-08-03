import { StringRecordId, type SurrealSession } from "surrealdb";

/**
 * ADR lifecycle states. This is the *domain* status — soft deletion is tracked
 * separately on the `archived` field, unlike memory/skill which overload
 * `status` for both.
 */
export const ADR_STATUSES = ["proposed", "accepted", "superseded", "deprecated"] as const;

export type AdrStatus = (typeof ADR_STATUSES)[number];

/** ADR-0007 — the human-facing form of the per-library sequence number. */
export function formatAdrNumber(n: number): string {
  return `ADR-${String(n).padStart(4, "0")}`;
}

/**
 * Next number in this library's sequence. Archived ADRs still hold their
 * number, so this deliberately doesn't filter on `archived` — numbers are
 * never reused, otherwise a supersede chain could be rewritten by a later save.
 */
export async function nextAdrNumber(session: SurrealSession): Promise<number> {
  const [rows] = await session.query<[Array<{ number: number }>]>(
    `SELECT number FROM adr ORDER BY number DESC LIMIT 1`
  );
  return (rows[0]?.number ?? 0) + 1;
}

/**
 * Resolve a user-supplied ADR reference to a record id. Accepts a record id
 * ("adr:x9k2"), a bare sequence number (7), or its display form ("ADR-0007"),
 * because callers reasonably reach for whichever one they just saw in output.
 * Returns null when no such ADR exists.
 */
export async function resolveAdrRef(session: SurrealSession, ref: string | number): Promise<unknown | null> {
  if (typeof ref === "string" && ref.includes(":")) {
    const id = new StringRecordId(ref);
    const [rows] = await session.query<[Array<{ id: unknown }>]>(`SELECT id FROM $id`, { id });
    return rows[0]?.id ?? null;
  }

  const number = typeof ref === "number" ? ref : Number(String(ref).replace(/^ADR-/i, ""));
  if (!Number.isInteger(number)) {
    return null;
  }

  const [rows] = await session.query<[Array<{ id: unknown }>]>(`SELECT id FROM adr WHERE number = $number LIMIT 1`, {
    number,
  });
  return rows[0]?.id ?? null;
}
