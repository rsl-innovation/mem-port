import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { appViewMeta } from "./apps.js";
import { text, type Extra } from "./format.js";

export { captionOf, formatScore, formatTags, formatWhen, text, type Extra } from "./format.js";

/**
 * The view model a read tool states about its own result.
 *
 * A tool describes what it found once — a list of items, or one record's
 * sections — and that description drives two things:
 *
 *   text block   the JSON the model reads. Unchanged, always first.
 *   MCP Apps     the same view model on the result's `_meta`, picked up by the
 *                ui:// app iframe the host renders (see apps.ts).
 *
 * Stating it once is what keeps the two honest: the human cannot be shown a
 * different result than the model was given, because there is only one
 * description and both come from it.
 */

export interface ViewItem {
  title: string;
  subtitle?: string | null;
  meta?: string | null;
}

export interface ViewSection {
  label: string;
  value: string | null | undefined;
}

export interface ListView {
  kind: "list";
  tool: string;
  heading: string;
  empty: string;
  items: ViewItem[];
}

export interface DetailView {
  kind: "detail";
  tool: string;
  key: string;
  title: string;
  subtitle?: string | null;
  sections: ViewSection[];
}

export type View = ListView | DetailView;

/** Sections with no value are dropped rather than rendered as an empty row. */
function presentSections(sections: ViewSection[]): Array<{ label: string; value: string }> {
  return sections
    .map((section) => ({ label: section.label, value: text(section.value, 4000) }))
    .filter((section): section is { label: string; value: string } => section.value !== undefined);
}

/** A list of result cards. */
export function listResult(
  extra: Extra,
  json: unknown,
  opts: { tool: string; heading: string; empty: string; items: ViewItem[] }
): CallToolResult {
  const items = opts.items.map((item) => ({
    title: text(item.title, 160) ?? "(untitled)",
    subtitle: text(item.subtitle) ?? "",
    meta: text(item.meta, 160) ?? "",
  }));

  const view: ListView = { kind: "list", tool: opts.tool, heading: opts.heading, empty: opts.empty, items };

  return {
    content: [{ type: "text" as const, text: JSON.stringify(json, null, 2) }],
    _meta: appViewMeta(extra, view),
  };
}

/** A single record: title, a caption line, then label/value sections. */
export function detailResult(
  extra: Extra,
  json: unknown,
  opts: { tool: string; key: string; title: string; subtitle?: string | null; sections: ViewSection[] }
): CallToolResult {
  const view: DetailView = {
    kind: "detail",
    tool: opts.tool,
    key: opts.key,
    title: text(opts.title, 200) ?? "(untitled)",
    subtitle: text(opts.subtitle, 200) ?? "",
    sections: presentSections(opts.sections),
  };

  return {
    content: [{ type: "text" as const, text: JSON.stringify(json, null, 2) }],
    _meta: appViewMeta(extra, view),
  };
}
