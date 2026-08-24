import type { Embedded, Id, IsoDateTime, Vector } from "./common.interface.js";

/** A recorded interaction or event — the raw material memories get derived from. */
export interface Episode {
  id: Id;
  title: string;
  content: string;
  source: string;
  occurred_at: IsoDateTime;
  created_at: IsoDateTime;
}

/** What list_episodes returns. */
export type EpisodeSummary = Pick<Episode, "id" | "title" | "content" | "source" | "occurred_at">;

/** What an export bundle carries. */
export type EpisodeRecord = Omit<Episode, "created_at"> & Embedded;

export interface NewEpisode {
  title: string;
  content: string;
  source: string;
  occurred_at?: IsoDateTime;
  embedding?: Vector | null;
}

export type EpisodePatch = Partial<Pick<Episode, "title" | "content" | "source">> & {
  occurred_at?: IsoDateTime;
  embedding?: Vector | null;
};

export interface EpisodeListFilter {
  since?: IsoDateTime;
  until?: IsoDateTime;
  source?: string;
  limit: number;
}
