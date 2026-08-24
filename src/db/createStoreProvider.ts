import type { Config } from "../config.js";
import type { StoreProvider } from "../interfaces/provider.interface.js";
import { PostgresStoreProvider } from "./postgres/provider.js";
import { SurrealStoreProvider } from "./surreal/provider.js";

/**
 * The one place a storage driver is named.
 *
 * Everything above this call works against `StoreProvider` and `LibraryStore`,
 * so adding an engine means adding a directory under `src/db/` and a case here.
 */
export function createStoreProvider(config: Config): StoreProvider {
  switch (config.store.driver) {
    case "surreal-embedded":
    case "surreal-remote":
      return new SurrealStoreProvider(config.store);
    case "postgres":
      return new PostgresStoreProvider(config.store);
    default: {
      const driver: never = config.store;
      throw new Error(`Unknown store driver: ${String(driver)}`);
    }
  }
}
