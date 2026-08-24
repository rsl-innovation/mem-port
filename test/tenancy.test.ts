import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import type { Server } from "node:http";
import { startDaemon } from "../src/daemon.js";
import { closeRootConnection } from "../src/db/connection.js";
import { callTool } from "../src/mcpClient.js";

const PORT = 18787;
let server: Server;
let dataDir: string;

beforeAll(async () => {
  dataDir = await mkdtemp(path.join(tmpdir(), "mem-port-tenancy-test-"));
  server = await startDaemon({ port: PORT, dataDir });
}, 60_000);

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
  await closeRootConnection();
  await rm(dataDir, { recursive: true, force: true });
}, 30_000);

describe("tenancy isolation", () => {
  it("never leaks memories across library-ids", async () => {
    await callTool(PORT, "tenant-a", "save_memory", { content: "tenant A confidential note", memory_type: "fact" });
    await callTool(PORT, "tenant-b", "save_memory", { content: "tenant B confidential note", memory_type: "fact" });

    const [aResult, bResult, freshResult] = await Promise.all([
      callTool(PORT, "tenant-a", "search_memory", { query: "confidential note" }),
      callTool(PORT, "tenant-b", "search_memory", { query: "confidential note" }),
      callTool(PORT, "tenant-never-seen-before", "search_memory", { query: "confidential note" }),
    ]);

    const aContent = JSON.parse(aResult.content[0]?.text ?? "[]") as Array<{ content: string }>;
    const bContent = JSON.parse(bResult.content[0]?.text ?? "[]") as Array<{ content: string }>;
    const freshContent = JSON.parse(freshResult.content[0]?.text ?? "[]") as unknown[];

    expect(aContent).toHaveLength(1);
    expect(aContent[0]?.content).toBe("tenant A confidential note");
    expect(bContent).toHaveLength(1);
    expect(bContent[0]?.content).toBe("tenant B confidential note");
    expect(freshContent).toHaveLength(0);
  }, 60_000);

  /**
   * Two clients reaching the same brand-new library at the same instant used to
   * make both run the schema migration concurrently, and concurrent DDL on one
   * database fails with "Transaction write conflict". The guard was a boolean
   * set consulted before an await, so both callers saw it unset.
   */
  it("survives concurrent first contact with a brand-new library", async () => {
    const results = await Promise.all(
      Array.from({ length: 5 }, (_, i) =>
        callTool(PORT, "race-lib", "save_memory", { content: `concurrent write ${i}` })
      )
    );
    expect(results).toHaveLength(5);

    const listed = JSON.parse(
      (await callTool(PORT, "race-lib", "search_memory", { query: "concurrent write" })).content[0]?.text ?? "[]"
    ) as unknown[];
    expect(listed, "every concurrent write should have landed").toHaveLength(5);
  }, 60_000);

  it("rejects requests with no library-id header", async () => {
    const res = await fetch(`http://127.0.0.1:${PORT}/mcp`, {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json, text/event-stream" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "tools/call",
        params: { name: "save_memory", arguments: { content: "orphan" } },
      }),
    });
    const text = await res.text();
    const dataLine = text.split("\n").find((line) => line.startsWith("data: "));
    const payload = JSON.parse(dataLine ? dataLine.slice("data: ".length) : text);

    expect(payload.result.isError).toBe(true);
    expect(payload.result.content[0].text).toMatch(/library-id/);
  });
});
