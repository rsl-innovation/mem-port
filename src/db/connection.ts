import type { Config } from "../config.js";
import type { StoreProvider } from "../interfaces/provider.interface.js";
import { createStoreProvider } from "./createStoreProvider.js";

/**
 * The process-wide store provider.
 *
 * A single provider per process, because the underlying connection is a
 * process-level resource: an embedded SurrealDB file cannot be opened twice,
 * and a hosted one should not be dialled once per request. The provider's own
 * caches are instance state, so this module holds the one global rather than
 * scattering several.
 */
let provider: StoreProvider | undefined;

export function getStoreProvider(config: Config): StoreProvider {
  provider ??= createStoreProvider(config);
  return provider;
}

/** Release the process-wide provider. Safe to call when nothing is open. */
export async function closeRootConnection(): Promise<void> {
  if (provider) {
    const current = provider;
    provider = undefined;
    await current.close();
  }
}
