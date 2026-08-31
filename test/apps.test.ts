import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import type { Server } from "node:http";
import { Script } from "node:vm";
import { startDaemon } from "../src/daemon.js";
import { closeRootConnection } from "../src/db/connection.js";

const PORT = 18794;
const APP_URI = "ui://mem-port/results.html";
const APP_MIME = "text/html;profile=mcp-app";
const VIEW_KEY = "mem-port/view";

let server: Server;
let dataDir: string;

interface CallResult {
  content: Array<{ type: string; text?: string }>;
  _meta?: Record<string, any>;
}

/** The nine read tools, with arguments that produce a non-empty result. */
const READ_TOOLS: Array<[string, Record<string, unknown>, "list" | "detail"]> = [
  ["list_skills", {}, "list"],
  ["search_skills", { query: "leaked credential" }, "list"],
  ["get_skill", { name: "rotate-api-keys" }, "detail"],
  ["search_memory", { query: "indentation preference" }, "list"],
  ["list_episodes", {}, "list"],
  ["list_adrs", {}, "list"],
  ["search_adrs", { query: "where do vectors live" }, "list"],
  ["get_adr", { number: 1 }, "detail"],
  ["get_entity", { name: "billing-service" }, "detail"],
];

async function rpc(method: string, params: Record<string, unknown>, extraHeaders: Record<string, string> = {}): Promise<any> {
  const res = await fetch(`http://127.0.0.1:${PORT}/mcp`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      accept: "application/json, text/event-stream",
      "library-id": "apps-lib",
      ...extraHeaders,
    },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
  });
  const body = await res.text();
  const dataLine = body.split("\n").find((line) => line.startsWith("data: "));
  return JSON.parse(dataLine ? dataLine.slice("data: ".length) : body).result;
}

function call(name: string, args: Record<string, unknown>, headers: Record<string, string> = {}): Promise<CallResult> {
  return rpc("tools/call", { name, arguments: args }, headers);
}

function viewOf(result: CallResult): Record<string, any> {
  const view = result._meta?.[VIEW_KEY];
  expect(view, "expected a view model on the result _meta").toBeTruthy();
  return view;
}

beforeAll(async () => {
  dataDir = await mkdtemp(path.join(tmpdir(), "mem-port-apps-test-"));
  server = await startDaemon({ port: PORT, dataDir });

  await call("save_skill", {
    name: "rotate-api-keys",
    description: "Use when a credential has leaked into a public repo",
    content: "1. Revoke the key.\n2. Issue a replacement.",
    tags: ["security", "ops"],
    source: "claude-code",
    entity_refs: ["billing-service"],
  });
  await call("save_memory", { content: "User prefers tabs over spaces", memory_type: "preference" });
  await call("save_episode", { title: "Incident review", content: "Key leaked via CI logs", source: "claude-code" });
  await call("save_adr", {
    title: "Store embeddings in SurrealDB",
    context: "We needed vector search without a second datastore.",
    decision: "Use SurrealDB's native vector functions.",
    consequences: "Brute-force cosine until an index is justified.",
    tags: ["storage"],
    source: "claude-code",
  });
}, 120_000);

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
  await closeRootConnection();
  await rm(dataDir, { recursive: true, force: true });
});

describe("mcp apps", () => {
  it("declares the UI resource on every read tool, and on no write tool", async () => {
    const { tools } = await rpc("tools/list", {});
    const byName = new Map(tools.map((t: any) => [t.name, t]));

    for (const [name] of READ_TOOLS) {
      const meta = byName.get(name)?._meta;
      expect(meta?.ui?.resourceUri, `${name} must point at the app`).toBe(APP_URI);
      // registerAppTool mirrors the modern key onto the deprecated one for
      // older hosts; losing that silently drops rendering on those clients.
      expect(meta?.["ui/resourceUri"], `${name} must keep the legacy mirror`).toBe(APP_URI);
    }

    for (const name of ["save_memory", "save_skill", "save_adr", "forget_memory", "export_library"]) {
      expect(byName.get(name)?._meta?.ui, `${name} must not claim a UI`).toBeUndefined();
    }
  }, 60_000);

  it("honours a client's own read-only header on a daemon with auth off", async () => {
    // No control plane here, so no grants: the client's own header is the only
    // thing that can narrow the tool set, and it must still work.
    const all = (await rpc("tools/list", {})).tools.map((t: any) => t.name);
    expect(all).toContain("save_memory");

    const readOnly = (await rpc("tools/list", {}, { "read-only": "1" })).tools.map((t: any) => t.name);
    expect(readOnly).not.toContain("save_memory");
    expect(readOnly).not.toContain("import_library");
    // export_library only reads the library, so it stays.
    expect(readOnly).toContain("export_library");
    expect(readOnly).toContain("search_memory");

    // The read tools keep their MCP Apps declaration when write tools are gone.
    const entry = (await rpc("tools/list", {}, { "read-only": "1" })).tools.find(
      (t: any) => t.name === "list_skills"
    );
    expect(entry?._meta?.ui?.resourceUri).toBe(APP_URI);
  }, 60_000);

  it("serves the app as a self-contained page under the MCP Apps mime type", async () => {
    const { resources } = await rpc("resources/list", {});
    const entry = resources.find((r: any) => r.uri === APP_URI);
    expect(entry, "the ui:// resource must be listed").toBeTruthy();
    expect(entry.mimeType).toBe(APP_MIME);

    const { contents } = await rpc("resources/read", { uri: APP_URI });
    const html = contents[0].text as string;
    expect(contents[0].mimeType).toBe(APP_MIME);
    expect(html).toContain("<!doctype html>");
    expect(html).toContain("<script");

    // The host renders this under a deny-by-default CSP, so anything fetched
    // from another origin is blocked and the page renders blank — which looks
    // exactly like "no results" rather than like an error. Assert that nothing
    // is loaded from outside the document at all.
    const external = html.match(/(?:src|href)\s*=\s*["'](?!#)[^"']+["']/gi) ?? [];
    expect(external, `page must not load external assets: ${external.join(", ")}`).toHaveLength(0);
  }, 60_000);

  it("serves a page whose inline bundle actually parses", async () => {
    const { contents } = await rpc("resources/read", { uri: APP_URI });
    const html = contents[0].text as string;

    // Regression guard. The build inlines the bundle into the HTML with
    // String.replace, whose replacement STRING syntax treats `$` specially —
    // and minified zod is full of `^${x}$` regexes, whose trailing "$`" means
    // "everything before the match". That spliced 12 copies of the page into
    // its own <script>, producing a page that passed every structural check
    // above while its bundle no longer parsed, so the app never ran and the
    // panel rendered blank. Both assertions below failed on that build.
    expect(html.match(/<!doctype html>/gi) ?? [], "the page must not contain itself").toHaveLength(1);

    const script = html.match(/<script type="module">([\s\S]*)<\/script>/)?.[1];
    expect(script, "the page must carry an inline bundle").toBeTruthy();
    expect(() => new Script(script!), "the inlined bundle must be syntactically valid").not.toThrow();
  }, 60_000);

  it("puts a well-formed view model on every read tool's result", async () => {
    for (const [name, args, kind] of READ_TOOLS) {
      const result = await call(name, args);

      expect(result.content[0]?.type, `${name} must keep its text block first`).toBe("text");
      expect(() => JSON.parse(result.content[0]!.text!), `${name} text must stay parseable`).not.toThrow();

      const view = viewOf(result);
      expect(view.kind, `${name} should render as a ${kind}`).toBe(kind);
      expect(view.tool).toBe(name);

      if (view.kind === "list") {
        expect(typeof view.heading).toBe("string");
        expect(typeof view.empty).toBe("string");
        expect(Array.isArray(view.items)).toBe(true);
        expect(view.items.length, `${name} should have found something`).toBeGreaterThan(0);
        for (const item of view.items) {
          expect(typeof item.title).toBe("string");
          expect(item.title.length, "an item must never render as a blank row").toBeGreaterThan(0);
        }
      } else {
        expect(typeof view.title).toBe("string");
        expect(view.title.length).toBeGreaterThan(0);
        expect(Array.isArray(view.sections)).toBe(true);
        expect(view.sections.length, `${name} should have sections to show`).toBeGreaterThan(0);
        for (const section of view.sections) {
          // Sections with no value are dropped upstream, so an empty one here
          // means a label rendering above blank space.
          expect(typeof section.label).toBe("string");
          expect(typeof section.value).toBe("string");
          expect(section.value.length).toBeGreaterThan(0);
        }
      }
    }
  }, 120_000);

  it("describes an empty result set as an empty state, not as zero items with no explanation", async () => {
    const result = await call("search_skills", { query: "nothing matches this", min_score: 0.99 });
    const view = viewOf(result);
    expect(view.items).toHaveLength(0);
    expect(view.empty.length, "an empty list still needs something to say").toBeGreaterThan(0);
  }, 60_000);

  it("omits the view model when the client sends mcp-apps: 0", async () => {
    const result = await call("list_skills", {}, { "mcp-apps": "0" });
    expect(result._meta?.[VIEW_KEY]).toBeUndefined();
    expect(result.content[0]?.type).toBe("text");
  }, 60_000);

  it("omits the view model when the daemon environment sets MCP_APPS=0, unless a client opts back in", async () => {
    process.env.MCP_APPS = "0";
    try {
      expect((await call("list_skills", {}))._meta?.[VIEW_KEY]).toBeUndefined();
      expect((await call("list_skills", {}, { "mcp-apps": "1" }))._meta?.[VIEW_KEY]).toBeTruthy();
    } finally {
      delete process.env.MCP_APPS;
    }
  }, 60_000);
});
