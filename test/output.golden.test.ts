import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import type { Server } from "node:http";
import { startDaemon } from "../src/daemon.js";
import { closeRootConnection } from "../src/db/connection.js";
import { callTool } from "../src/mcpClient.js";

/**
 * Byte-level golden output for every read tool.
 *
 * The other suites assert on *fields* — `expect(got.status).toBe("superseded")`
 * — which is the wrong instrument for a storage refactor. A field assertion
 * passes just fine when a key that used to be absent starts arriving as
 * `null`, when a nanosecond timestamp gets truncated to milliseconds, or when
 * an unrelated key is dropped from the JSON entirely. Those are exactly the
 * regressions that moving row-shaping out of the tool files can introduce.
 *
 * So this snapshots the raw `content[0].text` string and the `_meta` view
 * model, with only genuinely non-deterministic values (record ids, timestamps,
 * temp paths, float noise in scores) masked. Everything that survives masking
 * — key presence, key ORDER, null vs absent, nesting, string formatting — is
 * held byte-for-byte.
 */

const PORT = 18795;
const LIB = "golden-lib";
let server: Server;
let dataDir: string;

beforeAll(async () => {
  dataDir = await mkdtemp(path.join(tmpdir(), "mem-port-golden-test-"));
  server = await startDaemon({ port: PORT, dataDir });
  await seed();
}, 180_000);

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
  await closeRootConnection();
  await rm(dataDir, { recursive: true, force: true });
});

/**
 * Masks the values that legitimately differ run to run, and nothing else.
 *
 * Order matters: full timestamps are replaced before bare dates, or the date
 * pattern would eat the leading half of every ISO string and leave a tail.
 */
function mask(text: string): string {
  return text
    .replace(/\b(entity|episode|memory|skill|adr|mentions|relates_to):[0-9a-z]+/gi, "$1:<id>")
    .replace(/\d{4}-\d{2}-\d{2}T[\d:.]+Z/g, "<timestamp>")
    .replace(/\d{4}-\d{2}-\d{2}/g, "<date>")
    // Scores are deterministic for a fixed model and input, but the last few
    // float digits are not worth betting a CI run on. Three decimals is the
    // precision the UI caption already shows.
    .replace(/("score":\s*)(-?\d+\.\d{1,3})\d*/g, "$1$2")
    .replace(new RegExp(dataDir.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "g"), "<dataDir>")
    .replace(/-\d{13}\.memport\.json/g, "-<epoch>.memport.json");
}

/** The two things a client actually receives: the model's text, and the app's view model. */
async function capture(tool: string, args: Record<string, unknown>): Promise<string> {
  const result = (await callTool(PORT, LIB, tool, args)) as {
    content: Array<{ type: string; text?: string }>;
    _meta?: unknown;
  };
  const text = result.content.find((b) => b.type === "text")?.text ?? "";
  return mask(`--- text ---\n${text}\n--- _meta ---\n${JSON.stringify(result._meta, null, 2)}\n`);
}

/**
 * Seeded one await at a time, never in parallel: several tools order by
 * `created_at`/`occurred_at`, and rows written in the same millisecond would
 * tie and come back in arbitrary order, which would make the snapshots flap
 * for reasons that have nothing to do with the refactor.
 */
async function seed(): Promise<void> {
  await callTool(PORT, LIB, "save_episode", {
    title: "Kickoff call with Alice",
    content: "Walked through the storage requirements and agreed on an embedded-first approach.",
    source: "claude-code",
    occurred_at: "2026-07-31T09:00:00Z",
    entity_refs: ["Alice", "mem-port"],
  });

  await callTool(PORT, LIB, "save_memory", {
    content: "User prefers dark mode in all editors",
    memory_type: "preference",
    importance: 0.8,
    entity_refs: ["Alice"],
  });

  // No entity_refs, no source_episode_id — the sparse write path.
  await callTool(PORT, LIB, "save_memory", {
    content: "The checkout service is deployed from the main branch only",
    memory_type: "fact",
  });

  await callTool(PORT, LIB, "save_skill", {
    name: "debug-flaky-test",
    description: "Use when a test passes locally but fails intermittently in CI",
    content: "1. Check for shared state between tests.\n2. Look for timing assumptions.",
    tags: ["testing", "ci"],
    source: "claude-code",
    entity_refs: ["checkout-service"],
  });

  await callTool(PORT, LIB, "save_adr", {
    title: "Use SurrealDB for embedded storage",
    context: "Multi-tenant libraries need an isolated namespace per library-id.",
    decision: "Adopt embedded SurrealDB, giving each library-id its own database.",
    consequences: "One process to operate, but tenancy is a database-level concern.",
    alternatives: "Postgres with pgvector — rejected because it requires a server.",
    status: "accepted",
    tags: ["storage"],
    source: "claude-code",
    entity_refs: ["mem-port"],
  });

  // Deliberately omits consequences AND alternatives. This is the fixture that
  // pins down `undefined` vs `null`: get_adr passes both fields through
  // verbatim, and JSON.stringify omits an undefined key but emits `"k": null`.
  // A golden that only ever exercised populated optionals would happily pass a
  // refactor that coalesced every empty optional into null.
  await callTool(PORT, LIB, "save_adr", {
    title: "Keep embeddings local",
    context: "Sending record text to a hosted embedding API would leak private notes.",
    decision: "Run all-MiniLM-L6-v2 locally via ONNX.",
  });

  // "checkout-service" was auto-created by save_skill's entity_refs, so it has
  // no summary — the absent-optional case on the entity side.
  // NOTE: `attributes` is deliberately left empty. Passing a non-empty object
  // fails today with "Found field 'attributes.since', but no such field exists
  // for table 'relates_to'" — `relates_to` is SCHEMAFULL and `attributes` is
  // declared TYPE object without FLEXIBLE, so nested keys are rejected. That is
  // a pre-existing defect in the schema, not something this refactor should
  // quietly change while claiming byte-identical output.
  await callTool(PORT, LIB, "relate_entities", {
    from_entity: "Alice",
    to_entity: "checkout-service",
    relation_type: "leads",
  });
}

describe("golden output", () => {
  it("search_memory", async () => {
    expect(await capture("search_memory", { query: "what editor theme does the user prefer" })).toMatchSnapshot();
  }, 60_000);

  it("search_memory filtered and empty", async () => {
    expect(await capture("search_memory", { query: "anything at all", memory_types: ["task"] })).toMatchSnapshot();
  }, 60_000);

  it("list_episodes", async () => {
    expect(await capture("list_episodes", {})).toMatchSnapshot();
  }, 60_000);

  it("get_entity with relations and mentions", async () => {
    expect(await capture("get_entity", { name: "Alice" })).toMatchSnapshot();
  }, 60_000);

  it("get_entity with no summary and no relations", async () => {
    expect(await capture("get_entity", { name: "checkout-service" })).toMatchSnapshot();
  }, 60_000);

  it("list_skills", async () => {
    expect(await capture("list_skills", {})).toMatchSnapshot();
  }, 60_000);

  it("search_skills", async () => {
    expect(await capture("search_skills", { query: "test is flaky in CI" })).toMatchSnapshot();
  }, 60_000);

  it("get_skill", async () => {
    expect(await capture("get_skill", { name: "debug-flaky-test" })).toMatchSnapshot();
  }, 60_000);

  it("list_adrs", async () => {
    expect(await capture("list_adrs", {})).toMatchSnapshot();
  }, 60_000);

  it("search_adrs", async () => {
    expect(await capture("search_adrs", { query: "how do we isolate one tenant from another" })).toMatchSnapshot();
  }, 60_000);

  it("get_adr with every optional populated", async () => {
    expect(await capture("get_adr", { number: 1 })).toMatchSnapshot();
  }, 60_000);

  it("get_adr with consequences and alternatives absent", async () => {
    expect(await capture("get_adr", { number: 2 })).toMatchSnapshot();
  }, 60_000);

  it("export_library", async () => {
    expect(await capture("export_library", {})).toMatchSnapshot();
  }, 60_000);
});
