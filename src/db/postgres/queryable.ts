/**
 * The narrow slice of `pg` this driver uses.
 *
 * Declared structurally rather than imported from `pg`, so the interfaces and
 * every file that references them still typecheck when the optional dependency
 * is not installed. Both a Pool and a pooled Client satisfy it, which is what
 * lets the same store class serve transactional and non-transactional work.
 */
export interface Queryable {
  query<R extends Record<string, unknown> = Record<string, unknown>>(
    text: string,
    values?: unknown[]
  ): Promise<{ rows: R[]; rowCount: number | null }>;
}
