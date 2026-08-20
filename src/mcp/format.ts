import type { RequestHandlerExtra } from "@modelcontextprotocol/sdk/shared/protocol.js";
import type { ServerNotification, ServerRequest } from "@modelcontextprotocol/sdk/types.js";

/**
 * Formatting and feature-flag helpers for the UI surface.
 *
 * Lives below apps.ts / view.ts and imports neither, so they can share this
 * without a cycle.
 */

export type Extra = RequestHandlerExtra<ServerRequest, ServerNotification>;

const TRUTHY = new Set(["1", "on", "true", "yes"]);
const FALSY = new Set(["0", "off", "false", "no"]);

/**
 * A UI surface is on by default and turned off by a request header (per client)
 * or an environment variable (server wide). An explicit header wins over the
 * environment in both directions, so a single client can opt back in on a
 * daemon that has the surface switched off.
 */
export function surfaceEnabled(extra: Extra, header: string, envVars: string[]): boolean {
  const raw = extra.requestInfo?.headers?.[header];
  const value = (Array.isArray(raw) ? raw[0] : raw)?.trim().toLowerCase();
  if (value) {
    if (FALSY.has(value)) return false;
    if (TRUTHY.has(value)) return true;
  }

  for (const name of envVars) {
    const env = process.env[name]?.trim().toLowerCase();
    if (env && FALSY.has(env)) return false;
    if (env && TRUTHY.has(env)) return true;
  }

  return true;
}

/** Text bindings need strings; anything absent is dropped rather than rendered as "null". */
export function text(value: unknown, max = 240): string | undefined {
  if (value === null || value === undefined) return undefined;
  const str = String(value).trim();
  if (!str) return undefined;
  return str.length > max ? `${str.slice(0, max - 1).trimEnd()}…` : str;
}

/** Shared caption formatting so every surface reads the same way. */
export function captionOf(parts: Array<string | number | null | undefined>): string {
  return parts
    .map((part) => (typeof part === "number" ? String(part) : part))
    .filter((part): part is string => Boolean(part && part.trim()))
    .join(" · ");
}

export function formatScore(score: number): string {
  return `score ${score.toFixed(3)}`;
}

export function formatTags(tags: string[] | undefined): string | undefined {
  return tags && tags.length > 0 ? tags.join(", ") : undefined;
}

/**
 * SurrealDB hands back DateTime wrappers rather than Date objects, so go
 * through the same toJSON the text block already relies on before falling back.
 */
export function formatWhen(value: unknown): string | undefined {
  if (value === null || value === undefined) return undefined;
  const candidate = value as { toISOString?: () => string; toJSON?: () => unknown };
  const iso =
    typeof candidate.toISOString === "function"
      ? candidate.toISOString()
      : typeof candidate.toJSON === "function"
        ? String(candidate.toJSON())
        : String(value);
  return iso.slice(0, 10);
}
