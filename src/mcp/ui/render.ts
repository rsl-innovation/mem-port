/**
 * Pure rendering for the mem-port MCP App.
 *
 * No protocol, no side effects at import time — app.ts owns the App wiring and
 * calls in here. Keeping the two apart means the rendering can be driven from
 * a preview harness or a test with plain data, which is the only way to look at
 * a state like "16 results, second batch revealed" without a live host.
 *
 * Nodes are built with textContent rather than innerHTML throughout. Memories,
 * skills and ADRs are arbitrary user prose that routinely contains angle
 * brackets and ampersands, and this page renders inside the user's chat.
 */

export interface ViewItem {
  title: string;
  subtitle?: string;
  meta?: string;
}

export interface ViewSection {
  label: string;
  value: string;
}

export type View =
  | { kind: "list"; tool: string; heading: string; empty: string; items: ViewItem[] }
  | { kind: "detail"; tool: string; key: string; title: string; subtitle?: string; sections: ViewSection[] };

const VIEW_META_KEY = "mem-port/view";

/** Results revealed per batch. A search returning 20 is otherwise all scroll. */
const PAGE_SIZE = 5;

/** Anything past this in a section gets a scroll box rather than a tall page. */
const LONG_VALUE = 320;

/** Stagger between rows in a revealed batch. Enough to read as a sequence. */
const STAGGER_MS = 30;

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

/**
 * Tools end a heading with their own result count ("Skills (12)"). The list
 * renders a live tally of what is actually on screen, so the static one would
 * contradict it the moment a batch is revealed. Dropping it is cosmetic: if
 * the pattern ever stops matching, the heading simply keeps its count.
 */
export function headingText(heading: string): string {
  return heading.replace(/\s*\(\d+\)\s*$/, "");
}

export function renderRow(item: ViewItem): HTMLElement {
  const row = el("li", "row");
  row.appendChild(el("p", "row-title", item.title));
  if (item.subtitle) row.appendChild(el("p", "row-snippet", item.subtitle));
  if (item.meta) row.appendChild(el("p", "row-meta", item.meta));
  return row;
}

export function renderList(view: Extract<View, { kind: "list" }>): HTMLElement {
  const wrap = el("div", "view");

  const heading = headingText(view.heading);
  if (heading) wrap.appendChild(el("p", "heading", heading));

  if (view.items.length === 0) {
    wrap.appendChild(el("p", "empty", view.empty));
    return wrap;
  }

  const list = el("ol", "rows");
  const footer = el("div", "footer");
  wrap.append(list, footer);

  const total = view.items.length;
  let shown = 0;

  const drawFooter = (): void => {
    footer.replaceChildren();
    const remaining = total - shown;

    if (remaining <= 0) {
      // Only worth stating once the list was actually held back.
      if (total > PAGE_SIZE) footer.appendChild(el("p", "tally-final", `All ${total} shown`));
      return;
    }

    const button = el("button", "more");
    button.type = "button";
    button.append(
      el("span", "more-label", `Show ${Math.min(PAGE_SIZE, remaining)} more`),
      el("span", "more-tally", `${shown} of ${total}`)
    );
    button.addEventListener("click", () => {
      reveal();
      // Keep the button under the thumb/cursor rather than letting it jump.
      footer.querySelector("button")?.focus({ preventScroll: true });
    });
    footer.appendChild(button);
  };

  const reveal = (): void => {
    const batch = view.items.slice(shown, shown + PAGE_SIZE);
    batch.forEach((item, i) => {
      const row = renderRow(item);
      row.classList.add("enter");
      row.style.animationDelay = `${i * STAGGER_MS}ms`;
      list.appendChild(row);
    });
    shown += batch.length;
    drawFooter();
  };

  reveal();
  return wrap;
}

export function renderDetail(view: Extract<View, { kind: "detail" }>): HTMLElement {
  const wrap = el("div", "view enter");

  wrap.appendChild(el("h1", "detail-title", view.title));
  if (view.subtitle) wrap.appendChild(el("p", "detail-subtitle", view.subtitle));

  for (const section of view.sections) {
    const block = el("section", "section");
    block.appendChild(el("p", "section-label", section.label));
    block.appendChild(
      el("p", section.value.length > LONG_VALUE ? "section-value long" : "section-value", section.value)
    );
    wrap.appendChild(block);
  }

  return wrap;
}

export function renderMessage(message: string): HTMLElement {
  const wrap = el("div", "view");
  wrap.appendChild(el("p", "empty", message));
  return wrap;
}

/**
 * The view model rides on the result's `_meta`. If a host strips unknown `_meta`
 * we still have the text block, which is the same records as JSON — worth
 * falling back to, since a bare "nothing to show" would be indistinguishable
 * from an empty library.
 */
export function viewFrom(result: {
  content?: Array<{ type?: string; text?: string }>;
  _meta?: Record<string, unknown>;
}): View | null {
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
