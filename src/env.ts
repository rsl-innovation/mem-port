import path from "node:path";

/**
 * Load a `.env` file into process.env, if one is there.
 *
 * Uses Node's built-in loader rather than a dependency — the package already
 * requires Node >= 22, where `process.loadEnvFile` is available.
 *
 * Real environment variables always win. `loadEnvFile` does not overwrite
 * anything already set, which is what makes the same image work unchanged in
 * both places: a `.env` is a local-development convenience, while a deployed
 * container gets its configuration from the platform (Cloud Run env vars,
 * Secret Manager) and simply has no `.env` to find.
 */
export function loadEnvFile(explicitPath?: string): string | undefined {
  const target = path.resolve(explicitPath ?? process.env.MEM_PORT_ENV_FILE ?? ".env");

  try {
    process.loadEnvFile(target);
    return target;
  } catch (err) {
    // No .env is the normal case in a container, so absence is never an error.
    // Anything else — unreadable, malformed — is worth surfacing, since it
    // means configuration the operator intended to apply silently did not.
    if ((err as NodeJS.ErrnoException).code === "ENOENT") {
      return undefined;
    }
    throw new Error(`Could not load env file ${target}: ${err instanceof Error ? err.message : String(err)}`);
  }
}
