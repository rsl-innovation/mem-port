import { createHash } from "node:crypto";
import { DateTime, type SurrealSession, type SurrealTransaction } from "surrealdb";
import type { Bundle } from "./bundleSchema.js";

export type ImportMode = "merge" | "overwrite";
export type OnConflict = "skip" | "update";

export interface ImportResult {
  created: number;
  updated: number;
  skipped: number;
  conflicts: number;
}

export interface ImportOptions {
  mode: ImportMode;
  onConflict?: OnConflict;
  dryRun?: boolean;
}

function hashContent(content: string): string {
  return createHash("sha256").update(content).digest("hex");
}

async function loadExistingEntities(tx: SurrealTransaction): Promise<Map<string, unknown>> {
  const [rows] = await tx.query<[Array<{ id: unknown; name: string; entity_type: string }>]>(
    `SELECT id, name, entity_type FROM entity`
  );
  const map = new Map<string, unknown>();
  for (const row of rows) map.set(`${row.name}::${row.entity_type}`, row.id);
  return map;
}

async function loadExistingHashes(
  tx: SurrealTransaction,
  table: "episode" | "memory" | "skill"
): Promise<Map<string, unknown>> {
  const fields = table === "episode" ? "title, content" : table === "skill" ? "name, description, content" : "content";
  const [rows] = await tx.query<
    [Array<{ id: unknown; title?: string; name?: string; description?: string; content: string }>]
  >(`SELECT id, ${fields} FROM ${table}`);
  const map = new Map<string, unknown>();
  for (const row of rows) {
    const hash =
      table === "episode"
        ? hashContent(`${row.title}\n${row.content}`)
        : table === "skill"
          ? hashContent(`${row.name}\n${row.description}\n${row.content}`)
          : hashContent(row.content);
    map.set(hash, row.id);
  }
  return map;
}

/**
 * Runs the entire import inside one transaction. `dryRun` executes the exact
 * same matching/write logic and always cancels instead of committing, so
 * dry-run behavior can never diverge from a real run.
 */
export async function importBundle(session: SurrealSession, bundle: Bundle, options: ImportOptions): Promise<ImportResult> {
  const onConflict = options.onConflict ?? "skip";
  const tx = await session.beginTransaction();
  const result: ImportResult = { created: 0, updated: 0, skipped: 0, conflicts: 0 };
  const refMap = new Map<string, unknown>();

  try {
    if (options.mode === "overwrite") {
      await tx.query(`DELETE mentions; DELETE relates_to; DELETE memory; DELETE episode; DELETE skill; DELETE entity;`);
    }

    const existingEntities = options.mode === "merge" ? await loadExistingEntities(tx) : new Map<string, unknown>();
    for (const entity of bundle.entities) {
      const key = `${entity.name}::${entity.entity_type}`;
      const existing = existingEntities.get(key);
      if (existing) {
        result.conflicts++;
        refMap.set(entity.ref, existing);
        if (onConflict === "update") {
          await tx.query(`UPDATE $id SET summary = $summary, attributes = $attributes, embedding = $embedding`, {
            id: existing,
            summary: entity.summary ?? undefined,
            attributes: entity.attributes,
            embedding: entity.embedding ?? undefined,
          });
          result.updated++;
        } else {
          result.skipped++;
        }
        continue;
      }
      const [created] = await tx.query<[Array<{ id: unknown }>]>(
        `CREATE entity CONTENT { name: $name, entity_type: $entity_type, summary: $summary, attributes: $attributes, embedding: $embedding }`,
        {
          name: entity.name,
          entity_type: entity.entity_type,
          summary: entity.summary ?? undefined,
          attributes: entity.attributes,
          embedding: entity.embedding ?? undefined,
        }
      );
      refMap.set(entity.ref, created[0].id);
      result.created++;
    }

    const existingEpisodeHashes =
      options.mode === "merge" ? await loadExistingHashes(tx, "episode") : new Map<string, unknown>();
    for (const episode of bundle.episodes) {
      const existing = existingEpisodeHashes.get(episode.contentHash);
      if (existing) {
        result.conflicts++;
        refMap.set(episode.ref, existing);
        if (onConflict === "update") {
          await tx.query(
            `UPDATE $id SET title = $title, content = $content, source = $source, embedding = $embedding`,
            {
              id: existing,
              title: episode.title,
              content: episode.content,
              source: episode.source,
              embedding: episode.embedding ?? undefined,
            }
          );
          result.updated++;
        } else {
          result.skipped++;
        }
        continue;
      }
      const [created] = await tx.query<[Array<{ id: unknown }>]>(
        `CREATE episode CONTENT { title: $title, content: $content, source: $source, occurred_at: $occurred_at, embedding: $embedding }`,
        {
          title: episode.title,
          content: episode.content,
          source: episode.source,
          occurred_at: new DateTime(episode.occurred_at),
          embedding: episode.embedding ?? undefined,
        }
      );
      refMap.set(episode.ref, created[0].id);
      result.created++;
    }

    const existingMemoryHashes =
      options.mode === "merge" ? await loadExistingHashes(tx, "memory") : new Map<string, unknown>();
    for (const memory of bundle.memories) {
      const existing = existingMemoryHashes.get(memory.contentHash);
      if (existing) {
        result.conflicts++;
        refMap.set(memory.ref, existing);
        if (onConflict === "update") {
          await tx.query(
            `UPDATE $id SET memory_type = $memory_type, importance = $importance, status = $status, embedding = $embedding`,
            {
              id: existing,
              memory_type: memory.memory_type,
              importance: memory.importance,
              status: memory.status,
              embedding: memory.embedding ?? undefined,
            }
          );
          result.updated++;
        } else {
          result.skipped++;
        }
        continue;
      }
      const sourceEpisodeId = memory.sourceEpisodeRef ? refMap.get(memory.sourceEpisodeRef) : undefined;
      const [created] = await tx.query<[Array<{ id: unknown }>]>(
        `CREATE memory CONTENT {
           content: $content, memory_type: $memory_type, importance: $importance,
           status: $status, embedding: $embedding, source_episode: $source_episode
         }`,
        {
          content: memory.content,
          memory_type: memory.memory_type,
          importance: memory.importance,
          status: memory.status,
          embedding: memory.embedding ?? undefined,
          source_episode: sourceEpisodeId ?? undefined,
        }
      );
      refMap.set(memory.ref, created[0].id);
      result.created++;
    }

    const existingSkillHashes =
      options.mode === "merge" ? await loadExistingHashes(tx, "skill") : new Map<string, unknown>();
    for (const skill of bundle.skills) {
      const existing = existingSkillHashes.get(skill.contentHash);
      if (existing) {
        result.conflicts++;
        refMap.set(skill.ref, existing);
        if (onConflict === "update") {
          await tx.query(`UPDATE $id SET tags = $tags, source = $source, status = $status, embedding = $embedding`, {
            id: existing,
            tags: skill.tags,
            source: skill.source,
            status: skill.status,
            embedding: skill.embedding ?? undefined,
          });
          result.updated++;
        } else {
          result.skipped++;
        }
        continue;
      }
      const [created] = await tx.query<[Array<{ id: unknown }>]>(
        `CREATE skill CONTENT {
           name: $name, description: $description, content: $content,
           tags: $tags, source: $source, status: $status, embedding: $embedding
         }`,
        {
          name: skill.name,
          description: skill.description,
          content: skill.content,
          tags: skill.tags,
          source: skill.source,
          status: skill.status,
          embedding: skill.embedding ?? undefined,
        }
      );
      refMap.set(skill.ref, created[0].id);
      result.created++;
    }

    for (const edge of bundle.edges) {
      const fromId = refMap.get(edge.fromRef);
      const toId = refMap.get(edge.toRef);
      if (!fromId || !toId) {
        continue; // endpoint fell outside the exported scope
      }
      if (edge.type === "mentions") {
        await tx.query(`RELATE $from->mentions->$to`, { from: fromId, to: toId });
      } else {
        await tx.query(
          `RELATE $from->relates_to->$to CONTENT { relation_type: $relation_type, attributes: $attributes }`,
          { from: fromId, to: toId, relation_type: edge.relation_type, attributes: edge.attributes }
        );
      }
    }

    if (options.dryRun) {
      await tx.cancel();
    } else {
      await tx.commit();
    }

    return result;
  } catch (err) {
    await tx.cancel();
    throw err;
  }
}
