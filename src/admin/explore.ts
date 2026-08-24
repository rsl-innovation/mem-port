import type { LibraryStore } from "../interfaces/store.interface.js";
import type { Entity } from "../interfaces/entities.interface.js";
import type { RelationEdge } from "../interfaces/graph.interface.js";
import { esc, layout, type AdminView } from "./views.js";

/** Everything the explore view needs, read through the store contract. */
export interface WorkspaceSnapshot {
  counts: { entities: number; memories: number; episodes: number; skills: number; adrs: number };
  entities: Entity[];
  relations: RelationEdge[];
  /** entity id -> how many records mention it. Drives node prominence. */
  mentionCounts: Map<string, number>;
  recent: { memories: Array<{ content: string; memory_type: string }>; skills: Array<{ name: string; description: string }> };
}

/** Nodes rendered in the graph. Beyond this the picture stops being readable. */
const MAX_NODES = 36;

/**
 * Read everything the page needs.
 *
 * Sequential, not `Promise.all`: these queries share one cached session per
 * workspace, so firing them together buys nothing but contention. Seven small
 * reads on an admin page that is visited occasionally is not worth racing.
 */
export async function readSnapshot(store: LibraryStore): Promise<WorkspaceSnapshot> {
  const entities = await store.entities.listAll();
  const relations = await store.graph.listRelations();
  const mentions = await store.graph.listMentions();
  const memories = await store.memories.listAll();
  const episodes = await store.episodes.listAll();
  const skills = await store.skills.list({ status: "active", limit: 200 });
  const adrs = await store.adrs.list({ limit: 200 });

  const mentionCounts = new Map<string, number>();
  for (const edge of mentions) {
    mentionCounts.set(edge.toId, (mentionCounts.get(edge.toId) ?? 0) + 1);
  }

  return {
    counts: {
      entities: entities.length,
      memories: memories.length,
      episodes: episodes.length,
      skills: skills.length,
      adrs: adrs.length,
    },
    entities,
    relations,
    mentionCounts,
    recent: {
      memories: memories.slice(-6).reverse().map((m) => ({ content: m.content, memory_type: m.memory_type })),
      skills: skills.slice(0, 6).map((s) => ({ name: s.name, description: s.description })),
    },
  };
}

interface Node {
  id: string;
  name: string;
  weight: number;
  x: number;
  y: number;
}

/**
 * Lay the graph out on a ring, most-connected first.
 *
 * A ring rather than a force simulation on purpose: force layout needs
 * JavaScript and many iterations to settle, and this page is server-rendered
 * with no client script. A ring is deterministic — the same workspace draws
 * identically every time, so the picture is comparable across visits rather
 * than rearranging itself on each reload.
 */
function layoutNodes(snapshot: WorkspaceSnapshot, w: number, h: number): Node[] {
  const ranked = [...snapshot.entities]
    .map((e) => ({ e, weight: snapshot.mentionCounts.get(e.id) ?? 0 }))
    .sort((a, b) => b.weight - a.weight || a.e.name.localeCompare(b.e.name))
    .slice(0, MAX_NODES);

  const cx = w / 2;
  const cy = h / 2;
  const radius = Math.min(w, h) * 0.37;

  return ranked.map(({ e, weight }, i) => {
    const angle = (i / ranked.length) * Math.PI * 2 - Math.PI / 2;
    // Two alternating radii so neighbouring labels do not collide on a dense ring.
    const r = radius * (i % 2 === 0 ? 1 : 0.76);
    return {
      id: e.id,
      name: e.name,
      weight,
      x: cx + Math.cos(angle) * r,
      y: cy + Math.sin(angle) * r,
    };
  });
}

/**
 * The constellation: entities as points of light, relations as edges.
 *
 * This is the one place Stardust Teal is allowed — the design system reserves
 * it for exactly this node/edge system. Ember marks the most-connected entity,
 * as the single brightest point rather than a fill.
 */
function graphSvg(snapshot: WorkspaceSnapshot): string {
  const W = 900;
  const H = 460;
  const nodes = layoutNodes(snapshot, W, H);
  if (nodes.length === 0) return "";

  const byId = new Map(nodes.map((n) => [n.id, n]));
  const maxWeight = Math.max(1, ...nodes.map((n) => n.weight));

  const edges = snapshot.relations
    .map((r) => ({ from: byId.get(r.fromId), to: byId.get(r.toId), type: r.relation_type }))
    .filter((e): e is { from: Node; to: Node; type: string } => Boolean(e.from && e.to));

  const edgeSvg = edges
    .map(
      (e) =>
        `<line x1="${e.from.x.toFixed(1)}" y1="${e.from.y.toFixed(1)}" x2="${e.to.x.toFixed(1)}" y2="${e.to.y.toFixed(1)}"
stroke="#6fe0c9" stroke-opacity=".38" stroke-width="1"><title>${esc(e.type)}</title></line>`
    )
    .join("");

  const nodeSvg = nodes
    .map((n, i) => {
      const scale = 3 + (n.weight / maxWeight) * 5;
      const brightest = i === 0 && n.weight > 0;
      const colour = brightest ? "#f2a24c" : "#6fe0c9";
      const labelAnchor = n.x > W / 2 ? "start" : "end";
      const labelDx = n.x > W / 2 ? scale + 6 : -(scale + 6);
      return `<g><circle cx="${n.x.toFixed(1)}" cy="${n.y.toFixed(1)}" r="${scale.toFixed(1)}"
fill="${colour}" opacity=".95"><title>${esc(n.name)} — mentioned by ${n.weight} record(s)</title></circle>
<circle cx="${n.x.toFixed(1)}" cy="${n.y.toFixed(1)}" r="${(scale * 2.6).toFixed(1)}" fill="${colour}" opacity=".10"/>
<text x="${(n.x + labelDx).toFixed(1)}" y="${(n.y + 4).toFixed(1)}" text-anchor="${labelAnchor}"
fill="#b7b2ac" font-family="IBM Plex Mono, ui-monospace, monospace" font-size="11">${esc(
        n.name.length > 22 ? `${n.name.slice(0, 21)}…` : n.name
      )}</text></g>`;
    })
    .join("");

  const hidden = snapshot.entities.length - nodes.length;

  return `<div class="panel" style="padding:0;overflow-x:auto">
<svg viewBox="0 0 ${W} ${H}" width="100%" role="img"
 aria-label="Entity graph: ${nodes.length} entities and ${edges.length} relations"
 style="display:block;min-width:640px;background:#07060a;border-radius:10px">
${edgeSvg}${nodeSvg}
</svg></div>
<p class="muted" style="margin-top:-.5rem;font-size:.875rem">
${nodes.length} of ${snapshot.entities.length} entities shown${
    hidden > 0 ? `, least-connected ${hidden} omitted for legibility` : ""
  }. ${edges.length} relation${edges.length === 1 ? "" : "s"} drawn. Hover a point for its name.</p>`;
}

export function explorePage(
  admin: AdminView,
  slug: string,
  snapshot: WorkspaceSnapshot
): string {
  const c = snapshot.counts;
  const total = c.entities + c.memories + c.episodes + c.skills + c.adrs;

  const stat = (label: string, value: number) => `<div class="stat"><b>${value}</b><span>${label}</span></div>`;

  const entityRows = [...snapshot.entities]
    .map((e) => ({ e, weight: snapshot.mentionCounts.get(e.id) ?? 0 }))
    .sort((a, b) => b.weight - a.weight || a.e.name.localeCompare(b.e.name))
    .slice(0, 30)
    .map(
      ({ e, weight }) => `<tr><td>${esc(e.name)}</td><td class="muted">${esc(e.entity_type)}</td>
<td class="muted">${weight || "—"}</td></tr>`
    )
    .join("");

  return layout(
    `Explore ${slug}`,
    `<p class="eyebrow"><a href="/admin/workspaces">Workspaces</a> / ${esc(slug)}</p>
<h1>Ex<em>plore</em></h1>
<p class="sub">What <code>${esc(slug)}</code> currently holds. Read-only — the fastest way to check
whether a newly connected client is actually writing anything.</p>

${
  total === 0
    ? `<div class="note"><strong>This workspace is empty.</strong> Nothing has been saved to it yet.
Check that a client is sending <code>library-id: ${esc(slug)}</code>, and that its copilot is being
told to use mem-port — see the <a href="/admin/docs#trouble">docs</a>.</div>`
    : `<div class="stats">
${stat("Entities", c.entities)}${stat("Memories", c.memories)}${stat("Episodes", c.episodes)}${stat(
        "Skills",
        c.skills
      )}${stat("Decisions", c.adrs)}
</div>

<h2>The graph</h2>
${
  snapshot.entities.length === 0
    ? `<p class="empty">No entities yet. Entities appear when records name people, projects or systems
via <code>entity_refs</code>, which is what links records to each other.</p>`
    : `<p class="sub">Every entity in this workspace, sized by how many records mention it. Lines are
explicit relations between entities; the brightest point is the most-connected.</p>
${graphSvg(snapshot)}`
}

<h2>Entities</h2>
<div class="panel tight">${
        entityRows
          ? `<table><tr><th>Name</th><th>Type</th><th>Mentions</th></tr>${entityRows}</table>`
          : `<p class="empty" style="padding:1.2rem">None yet.</p>`
      }</div>

<div class="grid2">
<div><h2>Recent memories</h2><div class="panel">${
        snapshot.recent.memories.length
          ? snapshot.recent.memories
              .map(
                (m) => `<p style="margin:0 0 .85rem"><span class="pill">${esc(m.memory_type)}</span><br>${esc(
                  m.content.length > 180 ? `${m.content.slice(0, 179)}…` : m.content
                )}</p>`
              )
              .join("")
          : `<p class="empty">None yet.</p>`
      }</div></div>
<div><h2>Skills</h2><div class="panel">${
        snapshot.recent.skills.length
          ? snapshot.recent.skills
              .map(
                (s) => `<p style="margin:0 0 .85rem"><b>${esc(s.name)}</b><br>
<span class="muted">${esc(s.description.length > 140 ? `${s.description.slice(0, 139)}…` : s.description)}</span></p>`
              )
              .join("")
          : `<p class="empty">None yet.</p>`
      }</div></div>
</div>`
}`,
    admin
  );
}

/** Shown when an admin has no grant for the workspace they are trying to read. */
export function exploreDeniedPage(admin: AdminView, slug: string, csrf: string, userId: string): string {
  return layout(
    `Explore ${slug}`,
    `<p class="eyebrow"><a href="/admin/workspaces">Workspaces</a> / ${esc(slug)}</p>
<h1>No <em>access</em></h1>
<p class="sub">Your account has not been granted <code>${esc(slug)}</code>.</p>
<div class="note"><strong>Administering a workspace and reading it are separate.</strong>
Being an admin lets you decide who may reach this workspace; it does not let you read what is in it.
That separation is what keeps a stolen admin password from exposing every workspace's contents.</div>
<div class="panel"><p style="margin-top:0">Grant it to yourself to explore it. The grant is visible on
your user page like any other, and you can revoke it afterwards.</p>
<form method="post" action="/admin/users/${encodeURIComponent(userId)}/grants">
<input type="hidden" name="csrf" value="${esc(csrf)}">
<input type="hidden" name="workspace" value="${esc(slug)}">
<input type="hidden" name="return_to" value="/admin/workspaces/${encodeURIComponent(slug)}/explore">
<button>Grant myself access to ${esc(slug)}</button></form></div>`,
    admin
  );
}
