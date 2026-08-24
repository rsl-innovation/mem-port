import type { Id } from "../interfaces/common.interface.js";
import type { LibraryStore } from "../interfaces/store.interface.js";
import { Rollback } from "../interfaces/store.interface.js";
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

/**
 * Import a bundle into a library, inside one transaction.
 *
 * `dryRun` runs the exact same matching and write logic and then rolls back, so
 * a preview can never disagree with what a real import would do — there is no
 * second "what would happen" code path to drift out of step.
 *
 * Store-agnostic: everything here is bundle-format policy (dedupe by content
 * hash, renumber ADRs onto the target's sequence, remap refs to local ids)
 * expressed in contract calls. Making each driver reimplement this would
 * guarantee the drivers eventually disagreed about what an import means.
 */
export async function importBundle(
  store: LibraryStore,
  bundle: Bundle,
  options: ImportOptions
): Promise<ImportResult> {
  return store.transaction(async (tx) => {
    const result = await runImport(tx, bundle, options);
    if (options.dryRun) {
      throw new Rollback(result);
    }
    return result;
  });
}

async function runImport(tx: LibraryStore, bundle: Bundle, options: ImportOptions): Promise<ImportResult> {
  const onConflict = options.onConflict ?? "skip";
  const merging = options.mode === "merge";
  const result: ImportResult = { created: 0, updated: 0, skipped: 0, conflicts: 0 };

  /** Bundle ref -> the id it landed on in this library. */
  const refMap = new Map<string, Id>();
  const empty = new Map<string, Id>();

  if (options.mode === "overwrite") {
    await tx.bulk.deleteAll();
  }

  const existingEntities = merging ? await tx.entities.identityIndex() : empty;
  for (const entity of bundle.entities) {
    const existing = existingEntities.get(`${entity.name}::${entity.entity_type}`);
    if (existing) {
      result.conflicts++;
      refMap.set(entity.ref, existing);
      if (onConflict === "update") {
        await tx.entities.update(existing, {
          summary: entity.summary,
          attributes: entity.attributes,
          embedding: entity.embedding,
        });
        result.updated++;
      } else {
        result.skipped++;
      }
      continue;
    }
    refMap.set(
      entity.ref,
      await tx.entities.create({
        name: entity.name,
        entity_type: entity.entity_type,
        summary: entity.summary,
        attributes: entity.attributes,
        embedding: entity.embedding,
      })
    );
    result.created++;
  }

  const existingEpisodes = merging ? await tx.episodes.hashIndex() : empty;
  for (const episode of bundle.episodes) {
    const existing = existingEpisodes.get(episode.contentHash);
    if (existing) {
      result.conflicts++;
      refMap.set(episode.ref, existing);
      if (onConflict === "update") {
        await tx.episodes.update(existing, {
          title: episode.title,
          content: episode.content,
          source: episode.source,
          embedding: episode.embedding,
        });
        result.updated++;
      } else {
        result.skipped++;
      }
      continue;
    }
    refMap.set(
      episode.ref,
      await tx.episodes.create({
        title: episode.title,
        content: episode.content,
        source: episode.source,
        occurred_at: episode.occurred_at,
        embedding: episode.embedding,
      })
    );
    result.created++;
  }

  // Episodes are imported first so a memory's source_episode link can be
  // remapped as it is created, without a second pass.
  const existingMemories = merging ? await tx.memories.hashIndex() : empty;
  for (const memory of bundle.memories) {
    const existing = existingMemories.get(memory.contentHash);
    if (existing) {
      result.conflicts++;
      refMap.set(memory.ref, existing);
      if (onConflict === "update") {
        await tx.memories.update(existing, {
          memory_type: memory.memory_type,
          importance: memory.importance,
          status: memory.status,
          embedding: memory.embedding,
        });
        result.updated++;
      } else {
        result.skipped++;
      }
      continue;
    }
    refMap.set(
      memory.ref,
      await tx.memories.create({
        content: memory.content,
        memory_type: memory.memory_type,
        importance: memory.importance,
        status: memory.status,
        embedding: memory.embedding,
        source_episode_id: memory.sourceEpisodeRef ? refMap.get(memory.sourceEpisodeRef) : undefined,
      })
    );
    result.created++;
  }

  const existingSkills = merging ? await tx.skills.hashIndex() : empty;
  for (const skill of bundle.skills) {
    const existing = existingSkills.get(skill.contentHash);
    if (existing) {
      result.conflicts++;
      refMap.set(skill.ref, existing);
      if (onConflict === "update") {
        await tx.skills.update(existing, {
          tags: skill.tags,
          source: skill.source,
          status: skill.status,
          embedding: skill.embedding,
        });
        result.updated++;
      } else {
        result.skipped++;
      }
      continue;
    }
    refMap.set(
      skill.ref,
      await tx.skills.create({
        name: skill.name,
        description: skill.description,
        content: skill.content,
        tags: skill.tags,
        source: skill.source,
        status: skill.status,
        embedding: skill.embedding,
      })
    );
    result.created++;
  }

  // ADRs import in two passes: `supersedes` points at another ADR, which may
  // appear later in the array, so every row has to exist before any link can be
  // resolved. (Memories avoid this by importing episodes first; a
  // self-referential table can't.)
  const existingAdrs = merging ? await tx.adrs.hashIndex() : empty;
  // Bundle numbers are discarded — they belong to the source library's sequence
  // and would collide here. Supersede links travel as refs through refMap, so
  // renumbering cannot break a chain.
  let nextNumber = await tx.adrs.nextNumber();
  const createdAdrRefs = new Set<string>();

  for (const adr of bundle.adrs) {
    const existing = existingAdrs.get(adr.contentHash);
    if (existing) {
      result.conflicts++;
      refMap.set(adr.ref, existing);
      if (onConflict === "update") {
        await tx.adrs.update(existing, {
          status: adr.status,
          tags: adr.tags,
          source: adr.source,
          archived: adr.archived,
          embedding: adr.embedding,
        });
        result.updated++;
      } else {
        result.skipped++;
      }
      continue;
    }
    refMap.set(
      adr.ref,
      await tx.adrs.create({
        number: nextNumber++,
        title: adr.title,
        context: adr.context,
        decision: adr.decision,
        consequences: adr.consequences ?? undefined,
        alternatives: adr.alternatives ?? undefined,
        status: adr.status,
        tags: adr.tags,
        source: adr.source,
        archived: adr.archived,
        decided_at: adr.decided_at,
        embedding: adr.embedding,
      })
    );
    createdAdrRefs.add(adr.ref);
    result.created++;
  }

  // Pass 2. Only ADRs this import created get their links written — rewriting
  // supersedes on a pre-existing local ADR could corrupt a chain the target
  // library already maintains.
  for (const adr of bundle.adrs) {
    if (!adr.supersedesRef || !createdAdrRefs.has(adr.ref)) continue;
    const id = refMap.get(adr.ref);
    const target = refMap.get(adr.supersedesRef);
    if (!id || !target) continue; // the superseded ADR fell outside the exported scope
    await tx.adrs.setSupersedes(id, target);
  }

  for (const edge of bundle.edges) {
    const fromId = refMap.get(edge.fromRef);
    const toId = refMap.get(edge.toRef);
    if (!fromId || !toId) continue; // endpoint fell outside the exported scope

    if (edge.type === "mentions") {
      await tx.graph.addMentions(fromId, [toId]);
    } else {
      await tx.graph.relate(fromId, toId, {
        relation_type: edge.relation_type,
        attributes: edge.attributes,
      });
    }
  }

  return result;
}
