import type { BulkStore } from "../../interfaces/store.interface.js";
import type { Queryable } from "./queryable.js";

export class PostgresBulkStore implements BulkStore {
  constructor(
    private readonly q: Queryable,
    private readonly s: string
  ) {}

  /**
   * Edges first, then records.
   *
   * Foreign keys would cascade most of this, but `mentions.from_id` is
   * polymorphic and therefore unconstrained, so those rows have to go
   * explicitly or an overwrite import would leave edges pointing at records
   * that no longer exist.
   */
  async deleteAll(): Promise<void> {
    await this.q.query(`
      DELETE FROM ${this.s}.mentions;
      DELETE FROM ${this.s}.relates_to;
      DELETE FROM ${this.s}.memory;
      DELETE FROM ${this.s}.episode;
      DELETE FROM ${this.s}.skill;
      UPDATE ${this.s}.adr SET supersedes = NULL;
      DELETE FROM ${this.s}.adr;
      DELETE FROM ${this.s}.entity;
    `);
  }
}
