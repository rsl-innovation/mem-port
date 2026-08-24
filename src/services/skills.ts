import type { Id } from "../interfaces/common.interface.js";
import type { LibraryStore } from "../interfaces/store.interface.js";
import type { EmbeddingProvider } from "../embeddings/provider.js";

export interface SaveSkillInput {
  name: string;
  description: string;
  content: string;
  tags?: string[];
  source?: string;
  entity_refs?: string[];
}

export interface SaveSkillOutcome {
  id: Id;
  created: boolean;
  /** The id the replaced version is now readable under, when one was replaced. */
  archivedVersionId?: Id;
  /** Extra active rows for this name that a pre-upsert version of mem-port left behind. */
  collapsedDuplicates: number;
}

/**
 * Save a skill, upserting on name.
 *
 * A skill's *name* is its identity: saving under a name that already exists
 * revises that skill in place rather than forking it, so anything holding the
 * id still resolves. The version being replaced is copied to an archived row
 * first, keeping the old procedure readable by id instead of destroying it.
 *
 * This lives above the store rather than inside a driver because it is product
 * policy, not storage mechanics. Every part of it is expressed in contract
 * calls; two drivers implementing it independently would eventually disagree
 * about what "saving a skill twice" means.
 */
export async function saveSkill(
  store: LibraryStore,
  embeddings: EmbeddingProvider,
  input: SaveSkillInput
): Promise<SaveSkillOutcome> {
  const tags = input.tags ?? [];
  const source = input.source ?? "manual";
  const embedding = await embeddings.embed(`${input.name}\n${input.description}`);

  const active = await store.skills.findByName(input.name, { status: "active" });
  const current = active[0];

  if (!current) {
    const id = await store.skills.create({
      name: input.name,
      description: input.description,
      content: input.content,
      tags,
      source,
      embedding,
    });
    await attachEntities(store, id, input.entity_refs);
    return { id, created: true, collapsedDuplicates: 0 };
  }

  // Copy the version being replaced into an archived row, carrying its
  // original created_at so the history keeps the date it was actually written.
  const previous = await store.skills.getForArchive(current.id);
  let archivedVersionId: Id | undefined;
  if (previous) {
    archivedVersionId = await store.skills.create({ ...previous, status: "archived" });
  }

  // Older versions of mem-port forked on save, so a name can already have
  // several active rows behind it. Collapse them, or list_skills keeps
  // reporting duplicates and search ranks a superseded procedure against the
  // live one.
  const duplicates = active.slice(1);
  for (const duplicate of duplicates) {
    await store.skills.archive(duplicate.id);
  }

  await store.skills.update(current.id, {
    description: input.description,
    content: input.content,
    tags,
    source,
    embedding,
  });

  // entity_refs describe the revised skill, so its mentions are replaced
  // wholesale rather than merged with what the previous version claimed.
  await store.graph.replaceMentions(current.id, await store.entities.resolveRefs(input.entity_refs));

  return { id: current.id, created: false, archivedVersionId, collapsedDuplicates: duplicates.length };
}

async function attachEntities(store: LibraryStore, id: Id, names: string[] | undefined): Promise<void> {
  const entityIds = await store.entities.resolveRefs(names);
  await store.graph.addMentions(id, entityIds);
}
