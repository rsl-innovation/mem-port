import type { RequestHandlerExtra } from "@modelcontextprotocol/sdk/shared/protocol.js";
import type { ServerNotification, ServerRequest } from "@modelcontextprotocol/sdk/types.js";
import type { Surreal, SurrealSession } from "surrealdb";
import { getLibrarySession } from "../db/sessions.js";

const HEADER_NAME = "library-id";

export async function resolveLibrary(
  extra: RequestHandlerExtra<ServerRequest, ServerNotification>,
  root: Surreal
): Promise<SurrealSession> {
  const raw = extra.requestInfo?.headers?.[HEADER_NAME];
  const value = Array.isArray(raw) ? raw[0] : raw;

  if (!value) {
    throw new Error(`Missing required "${HEADER_NAME}" header`);
  }

  return getLibrarySession(root, value);
}
