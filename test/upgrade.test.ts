import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { Surreal, createRemoteEngines } from "surrealdb";
import { createNodeEngines } from "@surrealdb/node";
import { ensureSystemSchema } from "../src/db/surreal/systemSchema.js";
import { SurrealControlPlaneStore } from "../src/db/surreal/controlPlane.js";

/**
 * Upgrading a deployment that predates workspace access levels.
 *
 * The control-plane schema is re-applied on every daemon start, so adding a
 * field to a SCHEMAFULL table happens underneath live data. SurrealDB applies
 * DEFAULT at record creation, not retroactively, so rows written before the
 * field existed read back with it absent — and the claim under test is that
 * those grants keep behaving exactly as they did, with read-write access,
 * rather than degrading to read-only or failing to load at all.
 *
 * The Postgres twin is covered by the ALTER ... ADD COLUMN in its own schema
 * module, which backfills every existing row; that path is exercised in
 * crossDriver.test.ts.
 */

/** The control-plane schema exactly as it stood before access levels existed. */
const OLD_SCHEMA = `
  DEFINE TABLE IF NOT EXISTS cp_user SCHEMAFULL;
  DEFINE FIELD IF NOT EXISTS username      ON cp_user TYPE string;
  DEFINE FIELD IF NOT EXISTS is_admin      ON cp_user TYPE bool DEFAULT false;
  DEFINE FIELD IF NOT EXISTS disabled      ON cp_user TYPE bool DEFAULT false;
  DEFINE FIELD IF NOT EXISTS password_hash ON cp_user TYPE option<string>;
  DEFINE FIELD IF NOT EXISTS created_at    ON cp_user TYPE datetime DEFAULT time::now();
  DEFINE INDEX IF NOT EXISTS cp_user_name_idx ON cp_user FIELDS username UNIQUE;

  DEFINE TABLE IF NOT EXISTS cp_grant SCHEMAFULL;
  DEFINE FIELD IF NOT EXISTS user       ON cp_grant TYPE record<cp_user>;
  DEFINE FIELD IF NOT EXISTS workspace  ON cp_grant TYPE string;
  DEFINE FIELD IF NOT EXISTS created_at ON cp_grant TYPE datetime DEFAULT time::now();
  DEFINE INDEX IF NOT EXISTS cp_grant_pair_idx ON cp_grant FIELDS user, workspace UNIQUE;
`;

let dataDir: string;
let db: Surreal;

beforeAll(async () => {
  dataDir = await mkdtemp(path.join(tmpdir(), "mem-port-upgrade-test-"));
  db = new Surreal({ engines: { ...createRemoteEngines(), ...createNodeEngines() } });
  await db.connect(`surrealkv://${path.join(dataDir, "memport.db")}`);
  await db.use({ namespace: "memport", database: "_memport_system" });

  // A deployment on the previous build: one user, one grant, neither carrying
  // an access level because the fields did not exist yet.
  await db.query(OLD_SCHEMA);
  await db.query(`CREATE cp_user CONTENT { username: 'legacy' }`);
  await db.query(
    `CREATE cp_grant CONTENT {
       user: (SELECT VALUE id FROM cp_user WHERE username = 'legacy')[0], workspace: 'old-ws'
     }`
  );
}, 120_000);

afterAll(async () => {
  await db.close();
  await rm(dataDir, { recursive: true, force: true });
});

describe("upgrading a deployment that predates access levels", () => {
  it("keeps existing grants read-write, and stays writable afterwards", async () => {
    const [beforeRows] = await db.query<[Array<Record<string, unknown>>]>(`SELECT * FROM cp_grant`);
    expect(beforeRows[0], "the fixture must genuinely lack the field").not.toHaveProperty("access");

    // Restarting on the new build re-applies the schema over the live data.
    await ensureSystemSchema(db);

    const cp = new SurrealControlPlaneStore(db);
    const user = await cp.getUserByUsername("legacy");
    expect(user, "an existing user must still load").toBeTruthy();
    expect(user!.defaultAccess, "an absent default must not read as read-only").toBe("write");

    expect(await cp.listWorkspacesForUser(user!.id)).toEqual([{ workspace: "old-ws", access: "write" }]);

    // And the upgraded records are fully writable: re-granting sets the level
    // on a row that never had the field, rather than duplicating it.
    await cp.grantWorkspace(user!.id, "old-ws", "read");
    expect(await cp.listWorkspacesForUser(user!.id)).toEqual([{ workspace: "old-ws", access: "read" }]);

    await cp.setUserDefaultAccess(user!.id, "read");
    expect((await cp.getUserByUsername("legacy"))!.defaultAccess).toBe("read");
  }, 120_000);
});
