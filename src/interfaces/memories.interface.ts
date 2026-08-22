import type { Embedded, Id, IsoDateTime, Scored, Vector } from "./common.interface.js";

/**
 * The kinds of thing worth remembering. Shared by save_memory, search_memory
 * and export_library, which previously each held their own copy of this tuple.
 */
export const MEMORY_TYPES = ["fact", "preference", "decision", "task", "reference"] as const;

export type MemoryType = (typeof MEMORY_TYPES)[number];

/** A durable fact. `status` carries soft deletion ("active" | "archived"). */
export interface Memory {
  id: Id;
  content: string;
  memory_type: string;
  importance: number;
  status: string;
  /** The episode this was derived from, when it came from one. */
  source_episode_id?: Id | null;
  created_at: IsoDateTime;
  updated_at: IsoDateTime;
}

/** What search_memory returns. */
export type MemoryHit = Pick<Memory, "id" | "content" | "memory_type" | "importance"> & Scored;

/** What an export bundle carries. */
export type MemoryRecord = Omit<Memory, "created_at" | "updated_at"> & Embedded;

export interface NewMemory {
  content: string;
  memory_type?: string;
  importance?: number;
  status?: string;
  source_episode_id?: Id | null;
  embedding?: Vector | null;
}

export type MemoryPatch = Partial<Pick<Memory, "content" | "memory_type" | "importance" | "status">> & {
  source_episode_id?: Id | null;
  embedding?: Vector | null;
};

export interface MemorySearchFilter {
  memory_types?: string[];
  status?: string;
  limit: number;
}

/** Narrows what export_library pulls out of the memory table. */
export interface MemoryExportScope {
  memory_types?: string[];
  /** Only memories created at or after this instant. */
  since?: IsoDateTime;
}
