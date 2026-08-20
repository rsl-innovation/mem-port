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
