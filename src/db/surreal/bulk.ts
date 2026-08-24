import type { SurrealQueryable } from "surrealdb";
import type { BulkStore } from "../../interfaces/store.interface.js";

export class SurrealBulkStore implements BulkStore {
  constructor(private readonly q: SurrealQueryable) {}

  /**
   * Edges first, then records. Deleting a record while its edges still point
   * at it would leave dangling `in`/`out` links in the relation tables.
   */
  async deleteAll(): Promise<void> {
    await this.q.query(
      `DELETE mentions; DELETE relates_to; DELETE memory; DELETE episode; DELETE skill; DELETE adr; DELETE entity;`
    );
  }
}
