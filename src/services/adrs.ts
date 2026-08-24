import type { Id } from "../interfaces/common.interface.js";
import type { AdrStatus } from "../interfaces/adrs.interface.js";
import type { LibraryStore } from "../interfaces/store.interface.js";
import type { EmbeddingProvider } from "../embeddings/provider.js";

export interface SaveAdrInput {
  title: string;
  context: string;
  decision: string;
  consequences?: string;
  alternatives?: string;
  status?: AdrStatus;
  supersedes?: string | number;
  tags?: string[];
  source?: string;
  decided_at?: string;
  entity_refs?: string[];
}

export interface SaveAdrOutcome {
  id: Id;
  number: number;
  /** The ADR this one supersedes, once it has been flipped to "superseded". */
  supersededId?: Id;
}

/**
 * Record a decision, assigning it the next number in the library's sequence.
 *
 * Superseding is resolved before anything is written: a `supersedes` reference
 * that doesn't exist fails the whole save rather than silently dropping the
 * link and leaving two decisions that both look current.
 */
export async function saveAdr(
  store: LibraryStore,
  embeddings: EmbeddingProvider,
  input: SaveAdrInput
): Promise<SaveAdrOutcome> {
  let supersededId: Id | undefined;
  if (input.supersedes !== undefined) {
    const resolved = await store.adrs.resolveRef(input.supersedes);
    if (!resolved) {
      throw new Error(`No ADR found for supersedes reference "${input.supersedes}"`);
    }
    supersededId = resolved;
  }

  const number = await store.adrs.nextNumber();
  const embedding = await embeddings.embed(`${input.title}\n${input.context}\n${input.decision}`);

  const id = await store.adrs.create({
    number,
    title: input.title,
    context: input.context,
    decision: input.decision,
    consequences: input.consequences,
    alternatives: input.alternatives,
    status: input.status ?? "proposed",
    supersedes_id: supersededId,
    tags: input.tags ?? [],
    source: input.source ?? "manual",
    decided_at: input.decided_at,
    embedding,
  });

  if (supersededId) {
    await store.adrs.update(supersededId, { status: "superseded" });
  }

  await store.graph.addMentions(id, await store.entities.resolveRefs(input.entity_refs));

  return { id, number, supersededId };
}
