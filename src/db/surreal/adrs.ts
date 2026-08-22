import type { SurrealQueryable } from "surrealdb";
import type { Id, Vector } from "../../interfaces/common.interface.js";
import type {
  AdrDetail,
  AdrHit,
  AdrLink,
  AdrListFilter,
  AdrPatch,
  AdrRecord,
  AdrSearchFilter,
  AdrSummary,
  NewAdr,
} from "../../interfaces/adrs.interface.js";
import type { AdrStore } from "../../interfaces/store.interface.js";
import { hashRow } from "../../port/contentHash.js";
import { fromIso, toId, toIso, toOptionalId, toOptionalRecordId, toRecordId, toVector } from "./map.js";

interface AdrRow {
  id: unknown;
  number: number;
  title: string;
  context: string;
  decision: string;
  consequences?: string | null;
  alternatives?: string | null;
  status: string;
  supersedes?: unknown;
  tags: string[];
  source: string;
  archived: boolean;
  decided_at: unknown;
  created_at: unknown;
  updated_at: unknown;
  embedding?: number[] | null;
  mentioned_entities?: Array<{ id: unknown; name: string }>;
}

export class SurrealAdrStore implements AdrStore {
  constructor(private readonly q: SurrealQueryable) {}

  /**
   * Highest number in the library, plus one.
   *
   * Deliberately a full scan with the max taken in JS rather than
   * `ORDER BY number DESC LIMIT 1`: inside a transaction the ordered form gets
   * planned against `adr_number_idx` and comes back EMPTY, which restarts
   * numbering at 1 and then trips the unique index. Plain SELECTs inside a
   * transaction do see committed rows. Taking the scan unconditionally — not
   * just on the transactional path — keeps one code path for both callers so
   * they cannot drift; the table is small enough that the cost is noise.
   *
   * Archived ADRs still hold their numbers, so `archived` is not filtered here:
   * reusing a number would rewrite a supersede chain an older ADR points into.
   */
  async nextNumber(): Promise<number> {
    const [rows] = await this.q.query<[Array<{ number: number }>]>(`SELECT number FROM adr`);
    return rows.reduce((max, row) => (row.number > max ? row.number : max), 0) + 1;
  }

  async resolveRef(ref: string | number): Promise<Id | null> {
    if (typeof ref === "string" && ref.includes(":")) {
      const [rows] = await this.q.query<[Array<{ id: unknown }>]>(`SELECT id FROM $id`, {
        id: toRecordId(ref),
      });
      return rows[0]?.id === undefined ? null : toId(rows[0].id);
    }

    const number = typeof ref === "number" ? ref : Number(String(ref).replace(/^ADR-/i, ""));
    if (!Number.isInteger(number)) return null;

    const [rows] = await this.q.query<[Array<{ id: unknown }>]>(
      `SELECT id FROM adr WHERE number = $number LIMIT 1`,
      { number }
    );
    return rows[0]?.id === undefined ? null : toId(rows[0].id);
  }

  async create(input: NewAdr): Promise<Id> {
    const [created] = await this.q.query<[Array<{ id: unknown }>]>(
      `CREATE adr CONTENT {
         number: $number,
         title: $title,
         context: $context,
         decision: $decision,
         consequences: $consequences,
         alternatives: $alternatives,
         status: $status,
         supersedes: $supersedes,
         tags: $tags,
         source: $source,
         archived: $archived,
         decided_at: $decided_at,
         embedding: $embedding
       }`,
      {
        number: input.number,
        title: input.title,
        context: input.context,
        decision: input.decision,
        consequences: input.consequences,
        alternatives: input.alternatives,
        status: input.status ?? "proposed",
        supersedes: toOptionalRecordId(input.supersedes_id),
        tags: input.tags ?? [],
        source: input.source ?? "manual",
        archived: input.archived ?? false,
        decided_at: fromIso(input.decided_at),
        embedding: input.embedding ?? undefined,
      }
    );
    return toId(created[0].id);
  }

  async update(id: Id, patch: AdrPatch): Promise<void> {
    const assignments: string[] = [];
    const bindings: Record<string, unknown> = { id: toRecordId(id) };

    for (const field of ["title", "context", "decision", "status", "tags", "source", "archived"] as const) {
      if (patch[field] !== undefined) {
        assignments.push(`${field} = $${field}`);
        bindings[field] = patch[field];
      }
    }
    for (const field of ["consequences", "alternatives"] as const) {
      if (patch[field] !== undefined) {
        assignments.push(`${field} = $${field}`);
        bindings[field] = patch[field] ?? undefined;
      }
    }
    if (patch.decided_at !== undefined) {
      assignments.push("decided_at = $decided_at");
      bindings.decided_at = fromIso(patch.decided_at);
    }
    if (patch.embedding !== undefined) {
      assignments.push("embedding = $embedding");
      bindings.embedding = patch.embedding ?? undefined;
    }
    if (assignments.length === 0) return;

    await this.q.query(`UPDATE $id SET ${assignments.join(", ")}, updated_at = time::now()`, bindings);
  }

  async archive(id: Id): Promise<void> {
    await this.q.query(`UPDATE $id SET archived = true, updated_at = time::now()`, { id: toRecordId(id) });
  }

  async remove(id: Id): Promise<void> {
    await this.q.query(`DELETE $id`, { id: toRecordId(id) });
  }

  async setSupersedes(id: Id, target: Id | null): Promise<void> {
    // NONE, not null: `supersedes` is an option<record<adr>>, and SurrealDB
    // spells "no value" as NONE.
    await this.q.query(`UPDATE $id SET supersedes = $target`, {
      id: toRecordId(id),
      target: toOptionalRecordId(target),
    });
  }

  async clearSupersedesPointingAt(id: Id): Promise<void> {
    await this.q.query(`UPDATE adr SET supersedes = NONE WHERE supersedes = $id`, { id: toRecordId(id) });
  }

  async getDetail(lookup: { id: Id } | { number: number }): Promise<AdrDetail | null> {
    const target = "id" in lookup ? `[<record<adr>> $id]` : `(SELECT VALUE id FROM adr WHERE number = $number LIMIT 1)`;
    const bindings = "id" in lookup ? { id: toRecordId(lookup.id) } : { number: lookup.number };

    const [rows] = await this.q.query<[AdrRow[]]>(
      `SELECT *, ->mentions->entity.{id, name} AS mentioned_entities FROM ${target}`,
      bindings
    );
    const row = rows[0];
    if (!row) return null;

    let supersedes: AdrLink | null = null;
    if (row.supersedes) {
      const [linked] = await this.q.query<[Array<{ id: unknown; number: number; title: string; status: string }>]>(
        `SELECT id, number, title, status FROM $id`,
        { id: row.supersedes }
      );
      const target_ = linked[0];
      supersedes = target_
        ? { id: toId(target_.id), number: target_.number, title: target_.title, status: target_.status }
        : null;
    }

    const [supersededBy] = await this.q.query<[Array<{ id: unknown; number: number; title: string }>]>(
      `SELECT id, number, title FROM adr WHERE supersedes = $id`,
      { id: row.id }
    );

    return {
      ...toAdr(row),
      supersedes,
      superseded_by: supersededBy.map((r) => ({ id: toId(r.id), number: r.number, title: r.title })),
      mentioned_entities: (row.mentioned_entities ?? []).map((e) => ({ id: toId(e.id), name: e.name })),
    };
  }

  async list(filter: AdrListFilter): Promise<AdrSummary[]> {
    const conditions = ["archived = false"];
    const bindings: Record<string, unknown> = { limit: filter.limit };

    if (filter.status !== undefined) {
      conditions.push("status = $status");
      bindings.status = filter.status;
    }
    if (filter.tag !== undefined) {
      conditions.push("tags CONTAINS $tag");
      bindings.tag = filter.tag;
    }
    if (filter.source !== undefined) {
      conditions.push("source = $source");
      bindings.source = filter.source;
    }

    const [rows] = await this.q.query<[AdrRow[]]>(
      `SELECT id, number, title, decision, status, tags, source, supersedes, decided_at FROM adr
       WHERE ${conditions.join(" AND ")}
       ORDER BY number DESC
       LIMIT $limit`,
      bindings
    );

    return rows.map((row) => ({
      id: toId(row.id),
      number: row.number,
      title: row.title,
      decision: row.decision,
      status: row.status,
      tags: row.tags,
      source: row.source,
      supersedes_id: toOptionalId(row.supersedes),
      decided_at: toIso(row.decided_at),
    }));
  }

  async search(vector: Vector, filter: AdrSearchFilter): Promise<AdrHit[]> {
    const conditions = ["archived = false", "embedding != NONE"];
    const bindings: Record<string, unknown> = { queryVector: vector, limit: filter.limit };

    if (filter.status !== undefined) {
      conditions.push("status = $status");
      bindings.status = filter.status;
    }
    if (filter.tags && filter.tags.length > 0) {
      conditions.push("tags CONTAINSANY $tags");
      bindings.tags = filter.tags;
    }

    const [rows] = await this.q.query<[Array<AdrRow & { score: number }>]>(
      `SELECT id, number, title, context, decision, consequences, status, tags,
              vector::similarity::cosine(embedding, $queryVector) AS score
       FROM adr
       WHERE ${conditions.join(" AND ")}
       ORDER BY score DESC
       LIMIT $limit`,
      bindings
    );

    return rows.map((row) => ({
      id: toId(row.id),
      number: row.number,
      title: row.title,
      context: row.context,
      decision: row.decision,
      consequences: row.consequences,
      status: row.status,
      tags: row.tags,
      score: row.score,
    }));
  }

  async listAll(): Promise<AdrRecord[]> {
    // Ordered, unlike the other tables: import renumbers ADRs in array order,
    // so an unordered read here would shuffle the log's chronology across a port.
    const [rows] = await this.q.query<[AdrRow[]]>(`SELECT * FROM adr ORDER BY number ASC`);
    return rows.map((row) => ({ ...toAdr(row), embedding: toVector(row.embedding) }));
  }

  async hashIndex(): Promise<Map<string, Id>> {
    const [rows] = await this.q.query<[AdrRow[]]>(`SELECT id, title, context, decision FROM adr`);
    const index = new Map<string, Id>();
    for (const row of rows) {
      index.set(hashRow("adr", row as unknown as Record<string, unknown>), toId(row.id));
    }
    return index;
  }
}

/**
 * `consequences` and `alternatives` are assigned verbatim, never coalesced.
 * SurrealDB returns unset `option<string>` fields as undefined and get_adr
 * passes them straight into its JSON result, so those keys are absent from
 * responses today — `?? null` here would add two keys to every ADR ever
 * returned.
 */
function toAdr(row: AdrRow) {
  return {
    id: toId(row.id),
    number: row.number,
    title: row.title,
    context: row.context,
    decision: row.decision,
    consequences: row.consequences,
    alternatives: row.alternatives,
    status: row.status,
    supersedes_id: toOptionalId(row.supersedes),
    tags: row.tags ?? [],
    source: row.source,
    archived: row.archived,
    decided_at: toIso(row.decided_at),
    created_at: toIso(row.created_at),
    updated_at: toIso(row.updated_at),
  };
}
