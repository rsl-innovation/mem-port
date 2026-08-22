import type { SurrealQueryable } from "surrealdb";
import type { Id, Vector } from "../../interfaces/common.interface.js";
import type {
  MemoryExportScope,
  MemoryHit,
  MemoryPatch,
  MemoryRecord,
  MemorySearchFilter,
  NewMemory,
} from "../../interfaces/memories.interface.js";
import type { MemoryStore } from "../../interfaces/store.interface.js";
import { hashRow } from "../../port/contentHash.js";
import { fromIso, toId, toOptionalId, toOptionalRecordId, toRecordId, toVector } from "./map.js";

interface MemoryRow {
  id: unknown;
  content: string;
  memory_type: string;
  importance: number;
  status: string;
  embedding?: number[] | null;
  source_episode?: unknown;
}

export class SurrealMemoryStore implements MemoryStore {
  constructor(private readonly q: SurrealQueryable) {}

  async create(input: NewMemory): Promise<Id> {
    const [created] = await this.q.query<[Array<{ id: unknown }>]>(
      `CREATE memory CONTENT {
         content: $content,
         memory_type: $memory_type,
         importance: $importance,
         status: $status,
         embedding: $embedding,
         source_episode: $source_episode
       }`,
      {
        content: input.content,
        memory_type: input.memory_type ?? "fact",
        importance: input.importance ?? 0.5,
        status: input.status ?? "active",
        embedding: input.embedding ?? undefined,
        source_episode: toOptionalRecordId(input.source_episode_id),
      }
    );
    return toId(created[0].id);
  }

  async update(id: Id, patch: MemoryPatch): Promise<void> {
    const assignments: string[] = [];
    const bindings: Record<string, unknown> = { id: toRecordId(id) };

    for (const field of ["content", "memory_type", "importance", "status"] as const) {
      if (patch[field] !== undefined) {
        assignments.push(`${field} = $${field}`);
        bindings[field] = patch[field];
      }
    }
    if (patch.embedding !== undefined) {
      assignments.push("embedding = $embedding");
      bindings.embedding = patch.embedding ?? undefined;
    }
    if (patch.source_episode_id !== undefined) {
      assignments.push("source_episode = $source_episode");
      bindings.source_episode = toOptionalRecordId(patch.source_episode_id);
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

  async search(vector: Vector, filter: MemorySearchFilter): Promise<MemoryHit[]> {
    const conditions = ["embedding != NONE"];
    const bindings: Record<string, unknown> = { queryVector: vector, limit: filter.limit };

    if (filter.status !== undefined) {
      conditions.push("status = $status");
      bindings.status = filter.status;
    }
    if (filter.memory_types && filter.memory_types.length > 0) {
      conditions.push("memory_type IN $types");
      bindings.types = filter.memory_types;
    }

    // Brute-force cosine similarity: no vector index yet — an HNSW/DISKANN
    // index is added once library sizes justify it.
    const [rows] = await this.q.query<[Array<MemoryRow & { score: number }>]>(
      `SELECT id, content, memory_type, importance, vector::similarity::cosine(embedding, $queryVector) AS score
       FROM memory
       WHERE ${conditions.join(" AND ")}
       ORDER BY score DESC
       LIMIT $limit`,
      bindings
    );

    return rows.map((row) => ({
      id: toId(row.id),
      content: row.content,
      memory_type: row.memory_type,
      importance: row.importance,
      score: row.score,
    }));
  }

  async listAll(scope?: MemoryExportScope): Promise<MemoryRecord[]> {
    const conditions: string[] = [];
    const bindings: Record<string, unknown> = {};

    if (scope?.memory_types && scope.memory_types.length > 0) {
      conditions.push("memory_type IN $memoryTypes");
      bindings.memoryTypes = scope.memory_types;
    }
    if (scope?.since) {
      conditions.push("created_at >= $since");
      bindings.since = fromIso(scope.since);
    }

    const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
    const [rows] = await this.q.query<[MemoryRow[]]>(`SELECT * FROM memory ${where}`, bindings);

    return rows.map((row) => ({
      id: toId(row.id),
      content: row.content,
      memory_type: row.memory_type,
      importance: row.importance,
      status: row.status,
      source_episode_id: toOptionalId(row.source_episode),
      embedding: toVector(row.embedding),
    }));
  }

  async hashIndex(): Promise<Map<string, Id>> {
    const [rows] = await this.q.query<[MemoryRow[]]>(`SELECT id, content FROM memory`);
    const index = new Map<string, Id>();
    for (const row of rows) {
      index.set(hashRow("memory", row as unknown as Record<string, unknown>), toId(row.id));
    }
    return index;
  }
}
