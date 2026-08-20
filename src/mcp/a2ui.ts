import type { RequestHandlerExtra } from "@modelcontextprotocol/sdk/shared/protocol.js";
import type { ServerNotification, ServerRequest } from "@modelcontextprotocol/sdk/types.js";

/**
 * A2UI (Agent-to-UI) surfaces for the read tools.
 *
 * Every read tool keeps returning its JSON text block unchanged — that is what
 * the model reads, and nothing about it moves. Alongside it we append an
 * EmbeddedResource carrying an A2UI message stream, so a renderer-capable host
 * can draw the result instead of showing the model's JSON to a human.
 *
 * Spec: https://a2ui.org/specification/v1.0-a2ui/ — the payload is a JSON array
 * of protocol messages (createSurface / updateDataModel / updateComponents),
 * wrapped per https://a2ui.org/guides/a2ui_over_mcp/.
 */

export const A2UI_VERSION = "v1.0";
export const A2UI_CATALOG_ID = "https://a2ui.org/specification/v1_0/catalogs/basic/catalog.json";
export const A2UI_MIME_TYPE = "application/a2ui+json";

/** Per-client off switch, set next to `library-id` in the client's MCP config. */
const HEADER_NAME = "a2ui";

const TRUTHY = new Set(["1", "on", "true", "yes"]);
const FALSY = new Set(["0", "off", "false", "no"]);

type Extra = RequestHandlerExtra<ServerRequest, ServerNotification>;

type A2uiMessage = Record<string, unknown>;

export interface A2uiContentBlock {
  type: "resource";
  resource: { uri: string; mimeType: string; text: string };
}

export interface A2uiListItem {
  title: string;
  subtitle?: string | null;
  meta?: string | null;
}

export interface A2uiSection {
  label: string;
  value: string | null | undefined;
}

/**
 * A2UI is on by default. It is turned off by `a2ui: 0` on the request (per
 * client) or `A2UI=0` / `MEM_PORT_A2UI=0` in the daemon's environment (server
 * wide). An explicit header wins over the environment in both directions, so a
 * single client can opt back in on a daemon that has it off.
 */
export function a2uiEnabled(extra: Extra): boolean {
  const raw = extra.requestInfo?.headers?.[HEADER_NAME];
  const header = (Array.isArray(raw) ? raw[0] : raw)?.trim().toLowerCase();
  if (header) {
    if (FALSY.has(header)) return false;
    if (TRUTHY.has(header)) return true;
  }

  const env = (process.env.MEM_PORT_A2UI ?? process.env.A2UI)?.trim().toLowerCase();
  if (env && FALSY.has(env)) return false;

  return true;
}

/** Text bindings need strings; anything absent is dropped rather than rendered as "null". */
function text(value: unknown, max = 240): string | undefined {
  if (value === null || value === undefined) return undefined;
  const str = String(value).trim();
  if (!str) return undefined;
  return str.length > max ? `${str.slice(0, max - 1).trimEnd()}…` : str;
}

/** Surface ids are namespaced by tool so a list and a detail view can coexist. */
function surfaceIdFor(tool: string, key?: string): string {
  return key ? `mem-port/${tool}/${key}` : `mem-port/${tool}`;
}

function wrap(surfaceId: string, messages: A2uiMessage[]): A2uiContentBlock[] {
  return [
    {
      type: "resource",
      resource: {
        uri: `a2ui://${surfaceId}`,
        mimeType: A2UI_MIME_TYPE,
        text: JSON.stringify(messages),
      },
    },
  ];
}

/**
 * A scrollable list of result cards, bound to /items so the renderer iterates
 * the data model rather than us emitting one component per row.
 */
export function a2uiList(
  extra: Extra,
  opts: { tool: string; heading: string; empty: string; items: A2uiListItem[] }
): A2uiContentBlock[] {
  if (!a2uiEnabled(extra)) return [];

  const surfaceId = surfaceIdFor(opts.tool);
  const items = opts.items.map((item) => ({
    title: text(item.title, 160) ?? "(untitled)",
    subtitle: text(item.subtitle) ?? "",
    meta: text(item.meta, 160) ?? "",
  }));

  const components: A2uiMessage[] = [
    { id: "root", component: "Column", children: ["heading", items.length > 0 ? "results" : "empty"] },
    { id: "heading", component: "Text", text: { path: "/heading" } },
  ];

  if (items.length > 0) {
    components.push(
      { id: "results", component: "List", children: { componentId: "item_card", path: "/items" }, direction: "vertical" },
      { id: "item_card", component: "Card", child: "item_body" },
      { id: "item_body", component: "Column", children: ["item_title", "item_subtitle", "item_meta"] },
      { id: "item_title", component: "Text", text: { path: "title" } },
      { id: "item_subtitle", component: "Text", text: { path: "subtitle" }, variant: "caption" },
      { id: "item_meta", component: "Text", text: { path: "meta" }, variant: "caption" }
    );
  } else {
    components.push({ id: "empty", component: "Text", text: { path: "/empty" }, variant: "caption" });
  }

  return wrap(surfaceId, [
    { version: A2UI_VERSION, createSurface: { surfaceId, catalogId: A2UI_CATALOG_ID } },
    {
      version: A2UI_VERSION,
      updateDataModel: { surfaceId, value: { heading: `## ${opts.heading}`, empty: opts.empty, items } },
    },
    { version: A2UI_VERSION, updateComponents: { surfaceId, components } },
  ]);
}

/** A single record: title, a caption line, then label/value sections. */
export function a2uiDetail(
  extra: Extra,
  opts: { tool: string; key: string; title: string; subtitle?: string | null; sections: A2uiSection[] }
): A2uiContentBlock[] {
  if (!a2uiEnabled(extra)) return [];

  const surfaceId = surfaceIdFor(opts.tool, opts.key);
  const sections = opts.sections
    .map((section) => ({ label: section.label, value: text(section.value, 4000) }))
    .filter((section): section is { label: string; value: string } => section.value !== undefined);

  const subtitle = text(opts.subtitle, 200);

  const header = ["detail_title"];
  if (subtitle) header.push("detail_subtitle");
  header.push("detail_divider", "detail_sections");

  const components: A2uiMessage[] = [
    { id: "root", component: "Card", child: "detail_body" },
    { id: "detail_body", component: "Column", children: header },
    { id: "detail_title", component: "Text", text: { path: "/title" } },
    { id: "detail_divider", component: "Divider", axis: "horizontal" },
    { id: "detail_sections", component: "Column", children: { componentId: "section_body", path: "/sections" } },
    { id: "section_body", component: "Column", children: ["section_label", "section_value"] },
    { id: "section_label", component: "Text", text: { path: "label" }, variant: "caption" },
    { id: "section_value", component: "Text", text: { path: "value" } },
  ];

  if (subtitle) {
    components.push({ id: "detail_subtitle", component: "Text", text: { path: "/subtitle" }, variant: "caption" });
  }

  return wrap(surfaceId, [
    { version: A2UI_VERSION, createSurface: { surfaceId, catalogId: A2UI_CATALOG_ID } },
    {
      version: A2UI_VERSION,
      updateDataModel: {
        surfaceId,
        value: { title: `## ${text(opts.title, 200) ?? "(untitled)"}`, subtitle: subtitle ?? "", sections },
      },
    },
    { version: A2UI_VERSION, updateComponents: { surfaceId, components } },
  ]);
}

/** Shared caption formatting so every surface reads the same way. */
export function captionOf(parts: Array<string | number | null | undefined>): string {
  return parts
    .map((part) => (typeof part === "number" ? String(part) : part))
    .filter((part): part is string => Boolean(part && part.trim()))
    .join(" · ");
}

export function formatScore(score: number): string {
  return `score ${score.toFixed(3)}`;
}

export function formatTags(tags: string[] | undefined): string | undefined {
  return tags && tags.length > 0 ? tags.join(", ") : undefined;
}

/**
 * SurrealDB hands back DateTime wrappers rather than Date objects, so go
 * through the same toJSON the text block already relies on before falling back.
 */
export function formatWhen(value: unknown): string | undefined {
  if (value === null || value === undefined) return undefined;
  const candidate = value as { toISOString?: () => string; toJSON?: () => unknown };
  const iso =
    typeof candidate.toISOString === "function"
      ? candidate.toISOString()
      : typeof candidate.toJSON === "function"
        ? String(candidate.toJSON())
        : String(value);
  return iso.slice(0, 10);
}
