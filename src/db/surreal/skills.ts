import type { SurrealQueryable } from "surrealdb";
import type { Id, Vector } from "../../interfaces/common.interface.js";
import type {
  NewSkill,
  SkillDetail,
  SkillHit,
  SkillIdentity,
  SkillListFilter,
  SkillPatch,
  SkillRecord,
  SkillSearchFilter,
  SkillSummary,
} from "../../interfaces/skills.interface.js";
import type { SkillStore } from "../../interfaces/store.interface.js";
import { hashRow } from "../../port/contentHash.js";
import { fromIso, toId, toIso, toRecordId, toVector } from "./map.js";

interface SkillRow {
  id: unknown;
  name: string;
  description: string;
  content: string;
  tags: string[];
  source: string;
  status: string;
  embedding?: number[] | null;
  created_at: unknown;
  updated_at: unknown;
  mentioned_entities?: Array<{ id: unknown; name: string }>;
}

export class SurrealSkillStore implements SkillStore {
  constructor(private readonly q: SurrealQueryable) {}

  async create(input: NewSkill): Promise<Id> {
    const [created] = await this.q.query<[Array<{ id: unknown }>]>(
      `CREATE skill CONTENT {
         name: $name,
         description: $description,
         content: $content,
         tags: $tags,
         source: $source,
         status: $status,
         embedding: $embedding,
         created_at: $created_at
       }`,
      {
        name: input.name,
        description: input.description,
        content: input.content,
        tags: input.tags,
        source: input.source,
        status: input.status ?? "active",
        embedding: input.embedding ?? undefined,
        created_at: fromIso(input.created_at),
      }
    );
    return toId(created[0].id);
  }

  async update(id: Id, patch: SkillPatch): Promise<void> {
    const assignments: string[] = [];
    const bindings: Record<string, unknown> = { id: toRecordId(id) };

    for (const field of ["description", "content", "tags", "source", "status"] as const) {
      if (patch[field] !== undefined) {
        assignments.push(`${field} = $${field}`);
        bindings[field] = patch[field];
      }
    }
    if (patch.embedding !== undefined) {
      assignments.push("embedding = $embedding");
      bindings.embedding = patch.embedding ?? undefined;
    }
    if (assignments.length === 0) return;

    await this.q.query(`UPDATE $id SET ${assignments.join(", ")}, updated_at = time::now()`, bindings);
  }

  async archive(id: Id): Promise<void> {
    await this.q.query(`UPDATE $id SET status = 'archived', updated_at = time::now()`, { id: toRecordId(id) });
  }

  async remove(id: Id): Promise<void> {
    await this.q.query(`DELETE $id`, { id: toRecordId(id) });
  }

  /**
   * Every version of a name, newest first, with any status filter applied in JS.
   *
   * The status filter is NOT pushed into the WHERE clause on purpose. With
   * `skill_name_idx` defined on `name`, a compound
   * `WHERE name = $name AND status = 'active'` gets planned against that index
   * and comes back EMPTY once two rows share a name — which is exactly the
   * state save_skill creates the moment it archives a previous version. The
   * symptom is a third save silently forking the skill instead of updating it.
   * Selecting on the indexed field alone is reliable; the histories are a
   * handful of rows, so filtering them here costs nothing.
   */
  async findByName(name: string, opts?: { status?: string }): Promise<SkillIdentity[]> {
    const [rows] = await this.q.query<[Array<{ id: unknown; name: string; status: string; created_at: unknown }>]>(
      `SELECT id, name, status, created_at FROM skill WHERE name = $name ORDER BY created_at DESC`,
      { name }
    );

    return rows
      .filter((row) => opts?.status === undefined || row.status === opts.status)
      .map((row) => ({
        id: toId(row.id),
        name: row.name,
        status: row.status,
        created_at: toIso(row.created_at),
      }));
  }

  async getForArchive(id: Id): Promise<NewSkill | null> {
    const [rows] = await this.q.query<[SkillRow[]]>(
      `SELECT name, description, content, tags, source, status, embedding, created_at FROM $id`,
      { id: toRecordId(id) }
    );
    const row = rows[0];
    if (!row) return null;

    return {
      name: row.name,
      description: row.description,
      content: row.content,
      tags: row.tags,
      source: row.source,
      status: row.status,
      embedding: toVector(row.embedding),
      created_at: toIso(row.created_at),
    };
  }

  async getById(id: Id): Promise<SkillDetail | null> {
    const [rows] = await this.q.query<[SkillRow[]]>(
      `SELECT *, ->mentions->entity.{id, name} AS mentioned_entities FROM [<record<skill>> $id]`,
      { id: toRecordId(id) }
    );
    const row = rows[0];
    if (!row) return null;

    return {
      id: toId(row.id),
      name: row.name,
      description: row.description,
      content: row.content,
      tags: row.tags,
      source: row.source,
      status: row.status,
      created_at: toIso(row.created_at),
      updated_at: toIso(row.updated_at),
      mentioned_entities: (row.mentioned_entities ?? []).map((e) => ({ id: toId(e.id), name: e.name })),
    };
  }

  async list(filter: SkillListFilter): Promise<SkillSummary[]> {
    const conditions: string[] = [];
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

    const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
    const [rows] = await this.q.query<[SkillRow[]]>(
      `SELECT id, name, description, tags, source, created_at FROM skill
       ${where}
       ORDER BY created_at DESC
       LIMIT $limit`,
      bindings
    );

    return rows.map((row) => ({
      id: toId(row.id),
      name: row.name,
      description: row.description,
      tags: row.tags,
      source: row.source,
      created_at: toIso(row.created_at),
    }));
  }

  async search(vector: Vector, filter: SkillSearchFilter): Promise<SkillHit[]> {
    const conditions = ["embedding != NONE"];
    const bindings: Record<string, unknown> = { queryVector: vector, limit: filter.limit };

    if (filter.status !== undefined) {
      conditions.push("status = $status");
      bindings.status = filter.status;
    }
    if (filter.tags && filter.tags.length > 0) {
      conditions.push("tags CONTAINSANY $tags");
      bindings.tags = filter.tags;
    }

    // Brute-force cosine similarity: no vector index yet — an HNSW/DISKANN
    // index is added once library sizes justify it.
    const [rows] = await this.q.query<[Array<SkillRow & { score: number }>]>(
      `SELECT id, name, description, tags, source, vector::similarity::cosine(embedding, $queryVector) AS score
       FROM skill
       WHERE ${conditions.join(" AND ")}
       ORDER BY score DESC
       LIMIT $limit`,
      bindings
    );

    return rows.map((row) => ({
      id: toId(row.id),
      name: row.name,
      description: row.description,
      tags: row.tags,
      source: row.source,
      score: row.score,
    }));
  }

  async listAll(): Promise<SkillRecord[]> {
    const [rows] = await this.q.query<[SkillRow[]]>(`SELECT * FROM skill`);
    return rows.map((row) => ({
      id: toId(row.id),
      name: row.name,
      description: row.description,
      content: row.content,
      tags: row.tags ?? [],
      source: row.source,
      status: row.status,
      embedding: toVector(row.embedding),
    }));
  }

  async hashIndex(): Promise<Map<string, Id>> {
    const [rows] = await this.q.query<[SkillRow[]]>(`SELECT id, name, description, content FROM skill`);
    const index = new Map<string, Id>();
    for (const row of rows) {
      index.set(hashRow("skill", row as unknown as Record<string, unknown>), toId(row.id));
    }
    return index;
  }
}
