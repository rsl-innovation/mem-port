import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import type { Server } from "node:http";
import { startDaemon } from "../src/daemon.js";
import { closeRootConnection } from "../src/db/connection.js";

const PORT = 18793;
let server: Server;
let dataDir: string;

/** The A2UI v1.0 basic catalog's component names, from catalog.json. */
const CATALOG_COMPONENTS = new Set([
  "Text", "Image", "Icon", "Video", "AudioPlayer", "Row", "Column", "List", "Card",
  "Tabs", "Modal", "Divider", "Button", "TextField", "CheckBox", "ChoicePicker",
  "Slider", "DateTimeInput",
]);

interface ContentBlock {
  type: string;
  text?: string;
  resource?: { uri: string; mimeType: string; text: string };
}

async function call(
  tool: string,
  args: Record<string, unknown>,
  extraHeaders: Record<string, string> = {}
): Promise<ContentBlock[]> {
  const res = await fetch(`http://127.0.0.1:${PORT}/mcp`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      accept: "application/json, text/event-stream",
      "library-id": "a2ui-lib",
      ...extraHeaders,
    },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: tool, arguments: args } }),
  });
  const body = await res.text();
  const dataLine = body.split("\n").find((line) => line.startsWith("data: "));
  const payload = JSON.parse(dataLine ? dataLine.slice("data: ".length) : body);
  return payload.result.content as ContentBlock[];
}

function a2uiOf(content: ContentBlock[]): Array<Record<string, any>> {
  const block = content.find((c) => c.type === "resource");
  expect(block, "expected an A2UI resource block").toBeTruthy();
  expect(block?.resource?.mimeType).toBe("application/a2ui+json");
  return JSON.parse(block!.resource!.text);
}

/**
 * Structural conformance: the failure this guards against is a dangling child
 * id or an invented component name, both of which render as a blank surface
 * rather than as an error anyone would notice.
 */
function assertValidSurface(messages: Array<Record<string, any>>): void {
  expect(messages.length).toBeGreaterThanOrEqual(3);
  for (const message of messages) {
    expect(message.version).toBe("v1.0");
  }

  const create = messages.find((m) => m.createSurface)?.createSurface;
  const data = messages.find((m) => m.updateDataModel)?.updateDataModel;
  const update = messages.find((m) => m.updateComponents)?.updateComponents;
  expect(create?.surfaceId).toBeTruthy();
  expect(create?.catalogId).toContain("catalogs/basic/catalog.json");
  expect(data?.surfaceId).toBe(create.surfaceId);
  expect(update?.surfaceId).toBe(create.surfaceId);

  const components = update.components as Array<Record<string, any>>;
  const ids = components.map((c) => c.id);
  expect(new Set(ids).size, "component ids must be unique").toBe(ids.length);
  expect(ids).toContain("root");

  const defined = new Set(ids);
  const referenced = new Set<string>();

  for (const component of components) {
    expect(component.id, "every component needs an id").toBeTruthy();
    expect(CATALOG_COMPONENTS.has(component.component), `unknown component ${component.component}`).toBe(true);

    if (component.child !== undefined) {
      expect(defined.has(component.child), `dangling child ${component.child}`).toBe(true);
      referenced.add(component.child);
    }
    if (Array.isArray(component.children)) {
      for (const child of component.children) {
        expect(defined.has(child), `dangling child ${child}`).toBe(true);
        referenced.add(child);
      }
    } else if (component.children && typeof component.children === "object") {
      expect(defined.has(component.children.componentId), "dangling template componentId").toBe(true);
      expect(component.children.path.startsWith("/"), "template path must be absolute").toBe(true);
      referenced.add(component.children.componentId);
      // The bound array has to exist in the data model, or the list renders empty.
      expect(data.value[component.children.path.slice(1)]).toBeInstanceOf(Array);
    }

    // Absolute bindings must resolve against the data model root.
    if (component.text && typeof component.text === "object" && component.text.path?.startsWith("/")) {
      expect(data.value, `unbound path ${component.text.path}`).toHaveProperty(component.text.path.slice(1));
    }
  }

  // Every component except root must be reachable, or it is dead weight.
  for (const id of ids) {
    if (id !== "root") expect(referenced.has(id), `unreachable component ${id}`).toBe(true);
  }
}

beforeAll(async () => {
  dataDir = await mkdtemp(path.join(tmpdir(), "mem-port-a2ui-test-"));
  server = await startDaemon({ port: PORT, dataDir });
}, 60_000);

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
  await closeRootConnection();
  await rm(dataDir, { recursive: true, force: true });
});

describe("a2ui", () => {
  it("renders every read tool as a conformant surface, without disturbing the text block", async () => {
    await call("save_skill", {
      name: "rotate-api-keys",
      description: "Use when a credential has leaked into a public repo",
      content: "1. Revoke the key.\n2. Issue a replacement.\n3. Force-push is not enough — assume it is compromised.",
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

    const cases: Array<[string, Record<string, unknown>]> = [
      ["list_skills", {}],
      ["search_skills", { query: "leaked credential" }],
      ["get_skill", { name: "rotate-api-keys" }],
      ["search_memory", { query: "indentation preference" }],
      ["list_episodes", {}],
      ["list_adrs", {}],
      ["search_adrs", { query: "where do vectors live" }],
      ["get_adr", { number: 1 }],
      ["get_entity", { name: "billing-service" }],
    ];

    for (const [tool, args] of cases) {
      const content = await call(tool, args);
      expect(content[0]?.type, `${tool} must keep its text block first`).toBe("text");
      expect(() => JSON.parse(content[0]!.text!), `${tool} text block must stay parseable`).not.toThrow();
      assertValidSurface(a2uiOf(content));
    }
  }, 120_000);

  it("renders an empty result set as an empty-state surface rather than a broken list", async () => {
    const content = await call("search_skills", { query: "nothing matches this", min_score: 0.99 });
    const messages = a2uiOf(content);
    assertValidSurface(messages);

    const components = messages.find((m) => m.updateComponents).updateComponents.components;
    expect(components.some((c: Record<string, any>) => c.component === "List")).toBe(false);
    expect(components.map((c: Record<string, any>) => c.id)).toContain("empty");
  }, 60_000);

  it("omits the A2UI block when the client sends a2ui: 0", async () => {
    const content = await call("list_skills", {}, { a2ui: "0" });
    expect(content).toHaveLength(1);
    expect(content[0]?.type).toBe("text");
  }, 60_000);

  it("omits the A2UI block when the daemon environment sets A2UI=0", async () => {
    process.env.A2UI = "0";
    try {
      const content = await call("list_skills", {});
      expect(content).toHaveLength(1);
      expect(content[0]?.type).toBe("text");

      // An explicit header still wins over the environment, in both directions.
      const opted = await call("list_skills", {}, { a2ui: "1" });
      expect(opted.some((c) => c.type === "resource")).toBe(true);
    } finally {
      delete process.env.A2UI;
    }
  }, 60_000);

  it("keeps the A2UI block when the client sends a2ui: 1", async () => {
    const content = await call("list_skills", {}, { a2ui: "1" });
    expect(content.some((c) => c.type === "resource")).toBe(true);
  }, 60_000);
});
