import type { StoreProvider } from "../interfaces/provider.interface.js";
import type { LibraryStore } from "../interfaces/store.interface.js";
import type { Extra } from "./format.js";

const HEADER_NAME = "library-id";

/** The library-id a request is scoped to, as the client sent it. */
export function libraryIdOf(extra: Extra): string {
  const raw = extra.requestInfo?.headers?.[HEADER_NAME];
  const value = Array.isArray(raw) ? raw[0] : raw;

  if (!value) {
    throw new Error(`Missing required "${HEADER_NAME}" header`);
  }
  return value;
}

/**
 * The store for this request's library.
 *
 * Every tool handler starts here. Resolving per request — rather than binding a
 * library when the MCP session opens — is what keeps a long-lived connection
 * from serving one library's data under another's id.
 */
export async function resolveLibrary(extra: Extra, provider: StoreProvider): Promise<LibraryStore> {
  return provider.getLibrary(libraryIdOf(extra));
}
