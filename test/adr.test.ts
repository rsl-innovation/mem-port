import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import type { Server } from "node:http";
import { startDaemon } from "../src/daemon.js";
import { closeRootConnection } from "../src/db/connection.js";
import { callTool } from "../src/mcpClient.js";

const PORT = 18791;
let server: Server;
let dataDir: string;

beforeAll(async () => {
  dataDir = await mkdtemp(path.join(tmpdir(), "mem-port-adr-test-"));
  server = await startDaemon({ port: PORT, dataDir });
}, 60_000);

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
  await closeRootConnection();
  await rm(dataDir, { recursive: true, force: true });
});

function parseSave(text: string | undefined): { label: string; id: string } {
  const label = text?.match(/Saved (ADR-\d+)/)?.[1] ?? "";
  const id = text?.match(/\((adr:[^)]+)\)/)?.[1] ?? "";
  return { label, id };
}

describe("adr log", () => {
  it("numbers, supersedes, searches, lists, gets, and forgets ADRs", async () => {
    const first = await callTool(PORT, "adr-lib", "save_adr", {
      title: "Use SQLite with sqlite-vec for storage",
      context: "The early prototype needed embedded vector search with no separate database process to install or operate.",
      decision: "Store records in a single SQLite file and use the sqlite-vec extension for cosine similarity search.",
      consequences: "Trivial to ship, but everything shares one namespace.",
      alternatives: "Postgres with pgvector — rejected because it requires a server to be running.",
      status: "accepted",
      tags: ["storage"],
      source: "claude-code",
    });
    const adr1 = parseSave(first.content[0]?.text);
    expect(adr1.label).toBe("ADR-0001");
    expect(adr1.id).toBeTruthy();

    const second = await callTool(PORT, "adr-lib", "save_adr", {
      title: "Use SurrealDB for embedded storage",
      context:
        "Multi-tenant libraries need an isolated namespace per library-id so one tenant can never read another's records, which a single shared SQLite file cannot express cleanly.",
      decision: "Adopt embedded SurrealDB, giving each library-id its own database within one process.",
      status: "accepted",
      supersedes: 1,
      tags: ["storage"],
      source: "claude-code",
      entity_refs: ["mem-port"],
    });
    const adr2 = parseSave(second.content[0]?.text);
    expect(adr2.label).toBe("ADR-0002");
    expect(second.content[0]?.text).toMatch(/superseding/);

    // Superseding flips the earlier ADR's lifecycle status, and the chain is
    // readable from both ends.
    const got1 = JSON.parse((await callTool(PORT, "adr-lib", "get_adr", { number: 1 })).content[0]?.text ?? "{}");
    expect(got1.status).toBe("superseded");
    expect(got1.alternatives).toMatch(/pgvector/);
    expect(got1.superseded_by).toEqual([expect.objectContaining({ adr: "ADR-0002" })]);

    const got2 = JSON.parse((await callTool(PORT, "adr-lib", "get_adr", { id: adr2.id })).content[0]?.text ?? "{}");
    expect(got2.supersedes).toEqual(expect.objectContaining({ adr: "ADR-0001" }));
    expect(got2.mentioned_entities).toEqual([expect.objectContaining({ name: "mem-port" })]);

    // Ranked against text that appears only in the context field — this is what
    // makes "why aren't we doing X?" style queries work.
    const searchResult = await callTool(PORT, "adr-lib", "search_adrs", {
      query: "how do we keep one tenant from reading another tenant's data?",
    });
    const hits = JSON.parse(searchResult.content[0]?.text ?? "[]") as Array<{ number: number }>;
    expect(hits[0]?.number).toBe(2);

    const statusFiltered = await callTool(PORT, "adr-lib", "list_adrs", { status: "superseded" });
    const superseded = JSON.parse(statusFiltered.content[0]?.text ?? "[]") as Array<{ number: number }>;
    expect(superseded).toHaveLength(1);
    expect(superseded[0]?.number).toBe(1);

    const tagFiltered = await callTool(PORT, "adr-lib", "list_adrs", { tag: "nonexistent-tag" });
    expect(JSON.parse(tagFiltered.content[0]?.text ?? "[]")).toHaveLength(0);

    const entityResult = await callTool(PORT, "adr-lib", "get_entity", { name: "mem-port" });
    const entity = JSON.parse(entityResult.content[0]?.text ?? "{}");
    expect(entity.mentioned_by_adrs).toEqual([expect.objectContaining({ adr: "ADR-0002" })]);

    await callTool(PORT, "adr-lib", "forget_adr", { adr_id: adr2.id });

    const listAfterForget = JSON.parse(
      (await callTool(PORT, "adr-lib", "list_adrs", {})).content[0]?.text ?? "[]"
    ) as Array<{ number: number }>;
    expect(listAfterForget).toHaveLength(1);
    expect(listAfterForget[0]?.number).toBe(1);

    const searchAfterForget = JSON.parse(
      (await callTool(PORT, "adr-lib", "search_adrs", { query: "tenant isolation" })).content[0]?.text ?? "[]"
    ) as Array<{ number: number }>;
    expect(searchAfterForget.some((hit) => hit.number === 2)).toBe(false);

    // Archived ADRs keep their number — reusing 2 here would silently rewrite
    // the supersede chain that ADR-0001 still points into.
    const third = await callTool(PORT, "adr-lib", "save_adr", {
      title: "Keep embeddings local",
      context: "Sending record text to a hosted embedding API would leak private notes off the machine.",
      decision: "Run all-MiniLM-L6-v2 locally via ONNX.",
    });
    expect(parseSave(third.content[0]?.text).label).toBe("ADR-0003");
  }, 60_000);

  it("rejects a supersedes reference that doesn't resolve", async () => {
    await expect(
      callTool(PORT, "adr-bad-ref-lib", "save_adr", {
        title: "Dangling supersede",
        context: "There is no ADR 99 in this library.",
        decision: "This save should fail rather than silently drop the link.",
        supersedes: 99,
      })
    ).rejects.toThrow(/No ADR found/);

    const listed = JSON.parse((await callTool(PORT, "adr-bad-ref-lib", "list_adrs", {})).content[0]?.text ?? "[]");
    expect(listed).toHaveLength(0);
  }, 60_000);

  it("never leaks ADRs across library-ids", async () => {
    await callTool(PORT, "adr-tenant-a", "save_adr", {
      title: "Tenant A only decision",
      context: "Tenant A confidential context.",
      decision: "Do the tenant A thing.",
    });

    const [aResult, bResult] = await Promise.all([
      callTool(PORT, "adr-tenant-a", "list_adrs", {}),
      callTool(PORT, "adr-tenant-b", "list_adrs", {}),
    ]);

    expect(JSON.parse(aResult.content[0]?.text ?? "[]")).toHaveLength(1);
    expect(JSON.parse(bResult.content[0]?.text ?? "[]")).toHaveLength(0);
  }, 60_000);
});
