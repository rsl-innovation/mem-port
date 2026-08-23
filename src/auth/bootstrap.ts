import type { AuthConfig } from "../config.js";
import type { ControlPlaneStore } from "../interfaces/admin.interface.js";
import { hashPassword } from "./secrets.js";

/**
 * Create the first admin, when there is none.
 *
 * Runs at startup rather than lazily so a deployment that has no way in fails
 * immediately with an explanation, instead of coming up healthy and refusing
 * every login later. Once an admin exists the bootstrap credentials are
 * ignored, so leaving them set does not silently reset a password or
 * resurrect an account that was deliberately removed.
 */
export async function bootstrapAdmin(cp: ControlPlaneStore, auth: AuthConfig): Promise<void> {
  if (!(await cp.isUninitialized())) return;

  if (!auth.bootstrapAdmin) {
    throw new Error(
      "Authentication is required but no admin account exists and none can be created. " +
        "Set MEM_PORT_ADMIN_USER and MEM_PORT_ADMIN_PASSWORD to create the first admin, " +
        "or set MEM_PORT_AUTH=off if this daemon is protected by something else."
    );
  }

  const { username, password } = auth.bootstrapAdmin;
  await cp.createUser({
    username,
    isAdmin: true,
    passwordHash: await hashPassword(password),
  });

  // eslint-disable-next-line no-console
  console.error(`Created initial admin user "${username}". Sign in at /admin and change this password.`);
}
