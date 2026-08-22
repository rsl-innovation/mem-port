import type { LibraryStore } from "./store.interface.js";

/**
 * Owns the connection to a storage engine and hands out one `LibraryStore` per
 * library-id.
 *
 * Tenancy is the provider's problem, not the tool layer's. The SurrealDB
 * provider gives each library its own database inside a shared namespace; a
 * different engine might use a schema, a row-level predicate, or separate
 * connections. All the contract promises is isolation between library-ids and
 * that a returned store is connected and migrated.
 */
export interface StoreProvider {
  /**
   * A store for this raw (unsanitized) library-id, creating and migrating its
   * backing storage on first use.
   */
  getLibrary(rawLibraryId: string): Promise<LibraryStore>;

  /** Release every connection. Safe to call more than once. */
  close(): Promise<void>;
}
