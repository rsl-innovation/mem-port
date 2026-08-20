import { App } from "@modelcontextprotocol/ext-apps";

/**
 * The mem-port MCP App: one renderer for all nine read tools.
 *
 * Runs inside the host's sandboxed iframe. It never talks to the daemon —
 * everything it draws arrives on the tool result the host pushes in, so there
 * is no second code path that could disagree with the text block the model saw.
 *
 * Nodes are built with textContent rather than innerHTML throughout. Memories,
 * skills and ADRs are arbitrary user prose that routinely contains angle
 * brackets and ampersands, and this page renders inside the user's chat.
 */

interface ViewItem {
  title: string;
  subtitle?: string;
  meta?: string;
}

interface ViewSection {
  label: string;
  value: string;
}

type View =
  | { kind: "list"; tool: string; heading: string; empty: string; items: ViewItem[] }
  | { kind: "detail"; tool: string; key: string; title: string; subtitle?: string; sections: ViewSection[] };

const VIEW_META_KEY = "mem-port/view";

/** Anything past this in a section gets a scroll box rather than a tall page. */
const LONG_VALUE = 320;

const root = document.getElementById("root") as HTMLElement;

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className?: string,
  content?: string
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (content !== undefined) node.textContent = content;
  return node;
}

function renderList(view: Extract<View, { kind: "list" }>): HTMLElement {
  const wrap = el("div", "view");
  wrap.appendChild(el("h1", "heading", view.heading));

  if (view.items.length === 0) {
    wrap.appendChild(el("p", "empty", view.empty));
    return wrap;
  }

  const list = el("ul", "cards");
  for (const item of view.items) {
    const card = el("li", "card");
    card.appendChild(el("p", "card-title", item.title));
    if (item.subtitle) card.appendChild(el("p", "card-subtitle", item.subtitle));
    if (item.meta) card.appendChild(el("p", "card-meta", item.meta));
    list.appendChild(card);
  }
  wrap.appendChild(list);
  return wrap;
}

function renderDetail(view: Extract<View, { kind: "detail" }>): HTMLElement {
  const wrap = el("div", "view");
  const card = el("article", "card detail");

  card.appendChild(el("h1", "detail-title", view.title));
  if (view.subtitle) card.appendChild(el("p", "detail-subtitle", view.subtitle));

  for (const section of view.sections) {
    const block = el("section", "section");
    block.appendChild(el("p", "section-label", section.label));
    const value = el("p", section.value.length > LONG_VALUE ? "section-value long" : "section-value", section.value);
    block.appendChild(value);
    card.appendChild(block);
  }

  wrap.appendChild(card);
  return wrap;
}

function renderMessage(message: string): HTMLElement {
  const wrap = el("div", "view");
  wrap.appendChild(el("p", "empty", message));
  return wrap;
}

function draw(node: HTMLElement): void {
  root.replaceChildren(node);
}

/**
 * The view model rides on the result's `_meta`. If a host strips unknown `_meta`
 * we still have the text block, which is the same records as JSON — worth
 * falling back to, since a bare "nothing to show" would be indistinguishable
 * from an empty library.
 */
function viewFrom(result: { content?: Array<{ type?: string; text?: string }>; _meta?: Record<string, unknown> }): View | null {
  const meta = result._meta?.[VIEW_META_KEY];
  if (meta && typeof meta === "object") return meta as View;

  const text = result.content?.find((block) => block.type === "text")?.text;
  if (!text) return null;

  try {
    const parsed: unknown = JSON.parse(text);
    if (!Array.isArray(parsed)) return null;
    return {
      kind: "list",
      tool: "unknown",
      heading: `Results (${parsed.length})`,
      empty: "Nothing to show.",
      items: parsed.map((row: Record<string, unknown>) => ({
        title: String(row.name ?? row.title ?? row.content ?? row.id ?? "(untitled)"),
        subtitle: row.description ? String(row.description) : undefined,
      })),
    };
  } catch {
    return null;
  }
}

function applyTheme(theme: string | undefined): void {
  document.documentElement.dataset.theme = theme === "dark" ? "dark" : "light";
}

const app = new App({ name: "mem-port", version: "1.0.0" });

app.ontoolresult = (result) => {
  const view = viewFrom(result);
  if (!view) {
    draw(renderMessage("No results to display."));
    return;
  }
  draw(view.kind === "list" ? renderList(view) : renderDetail(view));
};

app.onhostcontextchanged = (context) => applyTheme(context.theme);

void app.connect().then(() => applyTheme(app.getHostContext()?.theme));
