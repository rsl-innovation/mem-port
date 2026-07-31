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

    const exportResult = await callTool(PORT, "source-lib", "export_library", {});
    const bundlePath = exportResult.content[0]?.text.match(/to (.+\.memport\.json)$/)?.[1];
    expect(bundlePath).toBeTruthy();

    const importResult = await callTool(PORT, "target-lib", "import_library", {
      bundle_path: bundlePath,
      mode: "merge",
    });
    const counts = JSON.parse(importResult.content[0]?.text ?? "{}");
    expect(counts).toEqual({ created: 4, updated: 0, skipped: 0, conflicts: 0 }); // 2 entities + 1 episode + 1 memory

    const entityResult = await callTool(PORT, "target-lib", "get_entity", { name: "Alice" });
    const entity = JSON.parse(entityResult.content[0]?.text ?? "{}");
    expect(entity.mentioned_by_memories).toHaveLength(1);
    expect(entity.mentioned_by_episodes).toHaveLength(1);
    expect(entity.related_entities).toEqual([
      expect.objectContaining({ relation_type: "leads", name: "mem-port" }),
    ]);
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
    expect(counts.skipped).toBe(4);
  }, 60_000);

  it("dry_run reports what would happen without writing anything", async () => {
    const exportResult = await callTool(PORT, "source-lib", "export_library", {});
    const bundlePath = exportResult.content[0]?.text.match(/to (.+\.memport\.json)$/)?.[1];

    const importResult = await callTool(PORT, "dry-run-lib", "import_library", {
      bundle_path: bundlePath,
      dry_run: true,
    });
    const counts = JSON.parse(importResult.content[0]?.text ?? "{}");
    expect(counts.created).toBe(4);

    const listResult = await callTool(PORT, "dry-run-lib", "list_episodes", {});
    const episodes = JSON.parse(listResult.content[0]?.text ?? "[]");
    expect(episodes).toHaveLength(0);
  }, 60_000);
});
