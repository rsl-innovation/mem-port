import type { Embedded, EntityRef, Id, IsoDateTime, Scored, Vector } from "./common.interface.js";

/**
 * ADR lifecycle states. This is the *domain* status — soft deletion is tracked
 * separately on `archived`, unlike memory/skill which overload `status` for both.
 */
export const ADR_STATUSES = ["proposed", "accepted", "superseded", "deprecated"] as const;

export type AdrStatus = (typeof ADR_STATUSES)[number];

/**
 * An architectural decision record.
 *
 * `supersedes_id` is the raw link and nothing more. Tools that render the link
 * as a labelled reference ask for `AdrDetail`, which carries the resolved
 * target — dereferencing a record id is the driver's job, not the tool's.
 *
 * `consequences` and `alternatives` are optional *and* nullable: SurrealDB
 * returns an unset `option<string>` as `undefined`, and get_adr passes the
 * value through verbatim, so today those keys are simply absent from the JSON.
 * Coalescing either one to `null` in a mapper would add a key to every
 * response. Assign them straight across.
 */
export interface Adr {
  id: Id;
  number: number;
  title: string;
  context: string;
  decision: string;
  consequences?: string | null;
  alternatives?: string | null;
  status: string;
  /** Absent when this ADR supersedes nothing. */
  supersedes_id?: Id | null;
  tags: string[];
  source: string;
  archived: boolean;
  decided_at: IsoDateTime;
  created_at: IsoDateTime;
  updated_at: IsoDateTime;
}

/** What list_adrs returns. */
export type AdrSummary = Pick<
  Adr,
  "id" | "number" | "title" | "decision" | "status" | "tags" | "source" | "supersedes_id" | "decided_at"
>;

/** What search_adrs returns: enough context to judge relevance, plus the score. */
export type AdrHit = Pick<
  Adr,
  "id" | "number" | "title" | "context" | "decision" | "consequences" | "status" | "tags"
> & Scored;

/** One end of a supersede chain, as get_adr renders it. */
export interface AdrLink {
  id: Id;
  number: number;
  title: string;
  status?: string;
}

/** What get_adr returns: the record with both ends of its chain resolved. */
export interface AdrDetail extends Adr {
  supersedes: AdrLink | null;
  superseded_by: AdrLink[];
  mentioned_entities: EntityRef[];
}

/** What an export bundle carries. */
export type AdrRecord = Omit<Adr, "created_at" | "updated_at"> & Embedded;

export interface NewAdr {
  number: number;
  title: string;
  context: string;
  decision: string;
  consequences?: string;
  alternatives?: string;
  status?: string;
  supersedes_id?: Id | null;
  tags?: string[];
  source?: string;
  archived?: boolean;
  decided_at?: IsoDateTime;
  embedding?: Vector | null;
}

export type AdrPatch = Partial<
  Pick<Adr, "title" | "context" | "decision" | "consequences" | "alternatives" | "status" | "tags" | "source" | "archived">
> & {
  decided_at?: IsoDateTime;
  embedding?: Vector | null;
};

export interface AdrListFilter {
  status?: string;
  tag?: string;
  source?: string;
  limit: number;
}

export interface AdrSearchFilter {
  status?: string;
  tags?: string[];
  limit: number;
}
