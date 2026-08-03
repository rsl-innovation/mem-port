import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import type { Server } from "node:http";
import { startDaemon } from "../src/daemon.js";
import { closeRootConnection } from "../src/db/connection.js";
import { callTool } from "../src/mcpClient.js";

const PORT = 18788;
let server: Server;
let dataDir: string;

beforeAll(async () => {
  dataDir = await mkdtemp(path.join(tmpdir(), "mem-port-port-test-"));
  server = await startDaemon({ port: PORT, dataDir });
}, 60_000);

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
  await closeRootConnection();
  await rm(dataDir, { recursive: true, force: true });
});

describe("export/import round trip", () => {
  it("preserves entities, episodes, memories, and edges across a port", async () => {
    await callTool(PORT, "source-lib", "save_episode", {
      title: "Kickoff",
      content: "Talked with Alice about mem-port",
      source: "test",
      entity_refs: ["Alice", "mem-port"],
    });
    await callTool(PORT, "source-lib", "save_memory", {
      content: "Alice leads the mem-port effort",
      memory_type: "fact",
      entity_refs: ["Alice"],
    });
    await callTool(PORT, "source-lib", "relate_entities", {
      from_entity: "Alice",
      to_entity: "mem-port",
      relation_type: "leads",
    });
    await callTool(PORT, "source-lib", "save_skill", {
      name: "onboard-new-contributor",
      description: "Use when introducing someone new to the mem-port effort",
      content: "Walk them through the entity/episode/memory/skill graph model first.",
      entity_refs: ["mem-port"],
    });
    await callTool(PORT, "source-lib", "save_adr", {
      title: "Store each library in its own database",
      context: "Libraries must not be able to read one another's records.",
      decision: "Fork a SurrealDB session per library-id.",
      status: "accepted",
    });
    await callTool(PORT, "source-lib", "save_adr", {
      title: "Embed locally rather than calling a hosted API",
      context: "Record text is private and should not leave the machine.",
      decision: "Run all-MiniLM-L6-v2 through ONNX in-process.",
      status: "accepted",
      supersedes: 1,
      entity_refs: ["mem-port"],
    });

    const exportResult = await callTool(PORT, "source-lib", "export_library", {});
    const bundlePath = exportResult.content[0]?.text.match(/to (.+\.memport\.json)$/)?.[1];
    expect(bundlePath).toBeTruthy();

    const importResult = await callTool(PORT, "target-lib", "import_library", {
      bundle_path: bundlePath,
      mode: "merge",
    });
    const counts = JSON.parse(importResult.content[0]?.text ?? "{}");
    expect(counts).toEqual({ created: 7, updated: 0, skipped: 0, conflicts: 0 }); // 2 entities + 1 episode + 1 memory + 1 skill + 2 ADRs

    const aliceResult = await callTool(PORT, "target-lib", "get_entity", { name: "Alice" });
    const alice = JSON.parse(aliceResult.content[0]?.text ?? "{}");
    expect(alice.mentioned_by_memories).toHaveLength(1);
    expect(alice.mentioned_by_episodes).toHaveLength(1);
    expect(alice.related_entities).toEqual([
      expect.objectContaining({ relation_type: "leads", name: "mem-port" }),
    ]);

    const memPortResult = await callTool(PORT, "target-lib", "get_entity", { name: "mem-port" });
    const memPort = JSON.parse(memPortResult.content[0]?.text ?? "{}");
    expect(memPort.mentioned_by_skills).toEqual([
      expect.objectContaining({ name: "onboard-new-contributor" }),
    ]);
    expect(memPort.mentioned_by_adrs).toEqual([
      expect.objectContaining({ title: "Embed locally rather than calling a hosted API" }),
    ]);

    // The supersede chain has to survive renumbering, since links travel as
    // record refs rather than as the numbers themselves.
    const supersedingResult = await callTool(PORT, "target-lib", "get_adr", { number: 2 });
    const superseding = JSON.parse(supersedingResult.content[0]?.text ?? "{}");
    expect(superseding.title).toBe("Embed locally rather than calling a hosted API");
    expect(superseding.supersedes).toEqual(
      expect.objectContaining({ title: "Store each library in its own database" })
    );
  }, 60_000);

  it("re-importing the same bundle in merge mode creates nothing new", async () => {
    const exportResult = await callTool(PORT, "source-lib", "export_library", {});
    const bundlePath = exportResult.content[0]?.text.match(/to (.+\.memport\.json)$/)?.[1];

    const importResult = await callTool(PORT, "target-lib", "import_library", {
      bundle_path: bundlePath,
      mode: "merge",
    });
    const counts = JSON.parse(importResult.content[0]?.text ?? "{}");
    expect(counts.created).toBe(0);
    expect(counts.skipped).toBe(7);
  }, 60_000);

  it("renumbers imported ADRs onto the end of a target library's existing sequence", async () => {
    for (const name of ["A", "B", "C"]) {
      await callTool(PORT, "existing-adrs-lib", "save_adr", {
        title: `Pre-existing ${name}`,
        context: `Local decision ${name}.`,
        decision: `Do ${name}.`,
      });
    }

    const exportResult = await callTool(PORT, "source-lib", "export_library", {});
    const bundlePath = exportResult.content[0]?.text.match(/to (.+\.memport\.json)$/)?.[1];

    await callTool(PORT, "existing-adrs-lib", "import_library", { bundle_path: bundlePath, mode: "merge" });

    const listed = JSON.parse(
      (await callTool(PORT, "existing-adrs-lib", "list_adrs", {})).content[0]?.text ?? "[]"
    ) as Array<{ number: number; title: string }>;

    // 3 local + 2 imported, each with a distinct number continuing the sequence.
    expect(listed).toHaveLength(5);
    expect(listed.map((a) => a.number).sort((a, b) => a - b)).toEqual([1, 2, 3, 4, 5]);
    expect(listed.filter((a) => a.title.startsWith("Pre-existing")).map((a) => a.number).sort()).toEqual([1, 2, 3]);

    // The imported chain survives renumbering, since links are record refs.
    const imported = listed.find((a) => a.title === "Embed locally rather than calling a hosted API");
    const got = JSON.parse(
      (await callTool(PORT, "existing-adrs-lib", "get_adr", { number: imported?.number })).content[0]?.text ?? "{}"
    );
    expect(got.supersedes).toEqual(expect.objectContaining({ title: "Store each library in its own database" }));
  }, 60_000);

  it("dry_run reports what would happen without writing anything", async () => {
    const exportResult = await callTool(PORT, "source-lib", "export_library", {});
    const bundlePath = exportResult.content[0]?.text.match(/to (.+\.memport\.json)$/)?.[1];

    const importResult = await callTool(PORT, "dry-run-lib", "import_library", {
      bundle_path: bundlePath,
      dry_run: true,
    });
    const counts = JSON.parse(importResult.content[0]?.text ?? "{}");
    expect(counts.created).toBe(7);

    const listResult = await callTool(PORT, "dry-run-lib", "list_episodes", {});
    const episodes = JSON.parse(listResult.content[0]?.text ?? "[]");
    expect(episodes).toHaveLength(0);
  }, 60_000);
});
