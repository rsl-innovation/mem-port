import type { Embedded, EntityRef, Id, IsoDateTime, Scored, Vector } from "./common.interface.js";

/**
 * A reusable procedure.
 *
 * `status` overloads the domain state with soft deletion ("active" | "archived"),
 * matching what the table already does — and what save_skill's version history
 * relies on, since a replaced version stays readable as an archived row.
 * Left as a plain string rather than a union so a library written by a newer
 * version still parses.
 */
export interface Skill {
  id: Id;
  name: string;
  description: string;
  content: string;
  tags: string[];
  source: string;
  status: string;
  created_at: IsoDateTime;
  updated_at: IsoDateTime;
}

/**
 * What list_skills returns.
 *
 * Note the absent `content`: list and search are for *choosing* a skill, and
 * returning every body would put the full text of every skill in the library
 * into the model's context on a single call. The projection is the contract,
 * not an optimization — see the skills test that asserts it.
 */
export type SkillSummary = Pick<Skill, "id" | "name" | "description" | "tags" | "source" | "created_at">;

/** What search_skills returns: the same projection as the list, plus relevance. */
export type SkillHit = Pick<Skill, "id" | "name" | "description" | "tags" | "source"> & Scored;

/**
 * Enough of a skill to pick the live row out of a name's version history.
 * A name maps to many rows over time, so name lookups resolve through this.
 */
export type SkillIdentity = Pick<Skill, "id" | "name" | "status" | "created_at">;

/** What get_skill returns: the whole record plus its outbound mentions. */
export interface SkillDetail extends Skill {
  mentioned_entities: EntityRef[];
}

/** What an export bundle carries: every stored field, including the vector. */
export type SkillRecord = Omit<Skill, "created_at" | "updated_at"> & Embedded;

export interface NewSkill {
  name: string;
  description: string;
  content: string;
  tags: string[];
  source: string;
  status?: string;
  embedding?: Vector | null;
  /**
   * Set only when archiving a previous version, so the historical copy keeps
   * the date it was actually written rather than the date it was superseded.
   */
  created_at?: IsoDateTime;
}

export type SkillPatch = Partial<Pick<Skill, "description" | "content" | "tags" | "source" | "status">> & {
  embedding?: Vector | null;
};

export interface SkillListFilter {
  tag?: string;
  source?: string;
  status?: string;
  limit: number;
}

export interface SkillSearchFilter {
  tags?: string[];
  status?: string;
  limit: number;
}
