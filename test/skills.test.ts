import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import type { Server } from "node:http";
import { startDaemon } from "../src/daemon.js";
import { closeRootConnection } from "../src/db/connection.js";
import { callTool, firstText } from "../src/mcpClient.js";

const PORT = 18790;
let server: Server;
let dataDir: string;

beforeAll(async () => {
  dataDir = await mkdtemp(path.join(tmpdir(), "mem-port-skills-test-"));
  server = await startDaemon({ port: PORT, dataDir });
}, 60_000);

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
  await closeRootConnection();
  await rm(dataDir, { recursive: true, force: true });
});

describe("skills", () => {
  it("saves, searches, lists, gets, and forgets a skill", async () => {
    const saveResult = await callTool(PORT, "skills-lib", "save_skill", {
      name: "debug-flaky-test",
      description: "Use when a test passes locally but fails intermittently in CI",
      content: "1. Check for shared state between tests.\n2. Look for timing assumptions.",
      tags: ["testing", "ci"],
      source: "claude-code",
      entity_refs: ["checkout-service"],
    });
    const skillId = saveResult.content[0]?.text.match(/Saved skill (\S+)/)?.[1];
    expect(skillId).toBeTruthy();

    const searchResult = await callTool(PORT, "skills-lib", "search_skills", {
      query: "test is flaky in CI",
    });
    const searchHits = JSON.parse(searchResult.content[0]?.text ?? "[]") as Array<{ id: string; name: string }>;
    expect(searchHits.some((s) => s.name === "debug-flaky-test")).toBe(true);

    const tagSearchResult = await callTool(PORT, "skills-lib", "search_skills", {
      query: "test is flaky in CI",
      tags: ["nonexistent-tag"],
    });
    const tagSearchHits = JSON.parse(tagSearchResult.content[0]?.text ?? "[]") as unknown[];
    expect(tagSearchHits).toHaveLength(0);

    const listResult = await callTool(PORT, "skills-lib", "list_skills", { tag: "testing" });
    const listed = JSON.parse(listResult.content[0]?.text ?? "[]") as Array<{ name: string }>;
    expect(listed).toHaveLength(1);
    expect(listed[0]?.name).toBe("debug-flaky-test");

    const getByName = await callTool(PORT, "skills-lib", "get_skill", { name: "debug-flaky-test" });
    const gotByName = JSON.parse(getByName.content[0]?.text ?? "{}");
    expect(gotByName.content).toMatch(/shared state/);
    expect(gotByName.mentioned_entities).toEqual([expect.objectContaining({ name: "checkout-service" })]);

    const entityResult = await callTool(PORT, "skills-lib", "get_entity", { name: "checkout-service" });
    const entity = JSON.parse(entityResult.content[0]?.text ?? "{}");
    expect(entity.mentioned_by_skills).toEqual([expect.objectContaining({ name: "debug-flaky-test" })]);

    await callTool(PORT, "skills-lib", "forget_skill", { skill_id: skillId });

    const listAfterForget = await callTool(PORT, "skills-lib", "list_skills", {});
    expect(JSON.parse(listAfterForget.content[0]?.text ?? "[]")).toHaveLength(0);

    const searchAfterForget = await callTool(PORT, "skills-lib", "search_skills", { query: "test is flaky in CI" });
    expect(JSON.parse(searchAfterForget.content[0]?.text ?? "[]")).toHaveLength(0);
  }, 60_000);

  it("withholds the procedure body from list and search, and only serves it from get_skill", async () => {
    const BODY = "1. Revoke the leaked key.\n2. Issue a replacement.\n3. Rotate anything derived from it.";
    await callTool(PORT, "body-lib", "save_skill", {
      name: "rotate-leaked-key",
      description: "Use when a credential has leaked into a public repo",
      content: BODY,
      tags: ["security"],
      source: "claude-code",
    });

    // list and search are for CHOOSING a skill. Returning every body would put
    // the full text of every skill in the library into the model's context on
    // a single call, which is the cost this contract exists to avoid.
    for (const [tool, args] of [
      ["list_skills", {}],
      ["search_skills", { query: "leaked credential in a repo" }],
    ] as const) {
      const text = firstText(await callTool(PORT, "body-lib", tool, args)) ?? "";
      expect(text, `${tool} must still identify the skill`).toContain("rotate-leaked-key");
      expect(text, `${tool} must still carry the description`).toContain("credential has leaked");
      expect(text, `${tool} must not carry the procedure body`).not.toContain("Revoke the leaked key");
    }

    // ...and the body has to be reachable, or withholding it above would make
    // the skill unusable rather than merely cheaper.
    const detail = firstText(await callTool(PORT, "body-lib", "get_skill", { name: "rotate-leaked-key" })) ?? "";
    expect(detail).toContain("Revoke the leaked key");
  }, 60_000);

  it("upserts on name instead of forking the skill, keeping the replaced version reachable", async () => {
    const first = await callTool(PORT, "upsert-lib", "save_skill", {
      name: "deploy-checkout",
      description: "Use when shipping the checkout service",
      content: "1. Run the smoke suite.\n2. Deploy to staging.",
      tags: ["deploy"],
      source: "claude-code",
      entity_refs: ["checkout-service"],
    });
    const firstText_ = firstText(first) ?? "";
    const originalId = firstText_.match(/Saved skill (\S+)/)?.[1];
    expect(originalId, "a first save should create").toBeTruthy();

    const second = await callTool(PORT, "upsert-lib", "save_skill", {
      name: "deploy-checkout",
      description: "Use when shipping the checkout service",
      content: "1. Run the smoke suite.\n2. Deploy to staging.\n3. Watch error rates for 10 minutes.",
      tags: ["deploy", "ops"],
      source: "claude-code",
      entity_refs: ["checkout-service", "pagerduty"],
    });
    const secondText = firstText(second) ?? "";
    expect(secondText, "a second save under the same name should update").toMatch(/^Updated skill/);

    // The id is stable across the update, so anything holding it still resolves.
    expect(secondText).toContain(String(originalId));

    // Exactly one active skill for the name — the duplicate this replaces.
    const listed = JSON.parse(firstText(await callTool(PORT, "upsert-lib", "list_skills", {})) ?? "[]") as Array<{
      name: string;
    }>;
    expect(listed.filter((s) => s.name === "deploy-checkout")).toHaveLength(1);

    // The name resolves to the CURRENT version, not the archived one.
    const current = JSON.parse(firstText(await callTool(PORT, "upsert-lib", "get_skill", { name: "deploy-checkout" })) ?? "{}");
    expect(current.content).toMatch(/Watch error rates/);
    expect(current.tags).toEqual(["deploy", "ops"]);

    // entity_refs describe the revised skill, so edges are replaced, not merged.
    expect(current.mentioned_entities.map((e: { name: string }) => e.name).sort()).toEqual([
      "checkout-service",
      "pagerduty",
    ]);

    // The replaced version survives, reachable by the id the update reported.
    const archivedId = secondText.match(/archived as (\S+?)\)/)?.[1];
    expect(archivedId, "the update should name the archived version").toBeTruthy();
    const archived = JSON.parse(firstText(await callTool(PORT, "upsert-lib", "get_skill", { id: archivedId! })) ?? "{}");
    expect(archived.status).toBe("archived");
    expect(archived.content).toMatch(/Deploy to staging\.$/);
    expect(archived.content, "the archived copy must be the OLD body").not.toMatch(/Watch error rates/);

    // A THIRD save is the case that matters most: by now the name has two rows
    // behind it, which is exactly the state that made a compound
    // "name AND status" lookup come back empty. If that regressed, this save
    // would silently create a fork instead of updating.
    const third = await callTool(PORT, "upsert-lib", "save_skill", {
      name: "deploy-checkout",
      description: "Use when shipping the checkout service",
      content: "1. Run the smoke suite.\n2. Deploy.\n3. Watch error rates.\n4. Announce in #ship.",
      tags: ["deploy"],
      source: "claude-code",
    });
    expect(firstText(third) ?? "", "a third save must still update, not fork").toMatch(/^Updated skill/);
    expect(firstText(third) ?? "").toContain(String(originalId));

    const stillOne = JSON.parse(firstText(await callTool(PORT, "upsert-lib", "list_skills", {})) ?? "[]") as Array<{
      name: string;
    }>;
    expect(stillOne.filter((s) => s.name === "deploy-checkout"), "still exactly one active row").toHaveLength(1);

    const latest = JSON.parse(firstText(await callTool(PORT, "upsert-lib", "get_skill", { name: "deploy-checkout" })) ?? "{}");
    expect(latest.content).toMatch(/Announce in #ship/);

    // Archived versions must stay out of search, or a superseded procedure
    // competes with the live one for the same query.
    const hits = JSON.parse(
      firstText(await callTool(PORT, "upsert-lib", "search_skills", { query: "shipping the checkout service" })) ?? "[]"
    ) as Array<{ name: string }>;
    expect(hits.filter((s) => s.name === "deploy-checkout")).toHaveLength(1);
  }, 60_000);

  it("never leaks skills across library-ids", async () => {
    await callTool(PORT, "skills-tenant-a", "save_skill", {
      name: "tenant-a-only-skill",
      description: "tenant A confidential procedure",
      content: "do the tenant A thing",
    });

    const [aResult, bResult] = await Promise.all([
      callTool(PORT, "skills-tenant-a", "list_skills", {}),
      callTool(PORT, "skills-tenant-b", "list_skills", {}),
    ]);

    expect(JSON.parse(aResult.content[0]?.text ?? "[]")).toHaveLength(1);
    expect(JSON.parse(bResult.content[0]?.text ?? "[]")).toHaveLength(0);
  }, 60_000);
});
