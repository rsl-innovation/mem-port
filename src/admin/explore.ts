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

/**
 * Nodes rendered in the graph.
 *
 * A chord layout with rotated labels stays legible far longer than a ring with
 * horizontal ones, but the ring's circumference is still finite: past roughly
 * this many, labels start to crowd however they are rotated.
 */
const MAX_NODES = 48;

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
  /** Radians, measured from 12 o'clock. */
  angle: number;
  x: number;
  y: number;
}

/**
 * Lay the graph out as a chord diagram: every entity on one ring, relations
 * drawn as chords curving through the middle.
 *
 * The obvious layout — nodes on a ring with straight lines between them and
 * horizontal labels — falls apart past about a dozen entities, and it was worth
 * seeing it fail to know why. Horizontal labels around a circle collide with
 * their neighbours (a real workspace produced "inventoryficatibns-service" from
 * two overlapping names), and straight edges through the centre turn into a
 * hairball that shows connection density without showing any actual connection.
 *
 * Rotating each label to its own radius fixes the collisions outright: labels
 * radiate outward like spokes, so neighbours can never overlap however many
 * there are. Curving each edge toward the centre separates chords that would
 * otherwise lie on top of each other, and reads as a constellation rather than
 * a scribble.
 *
 * Still deterministic and still server-rendered — no force simulation, no
 * client script, and the same workspace draws identically on every visit.
 */
function layoutNodes(snapshot: WorkspaceSnapshot, cx: number, cy: number, radius: number): Node[] {
  const ranked = [...snapshot.entities]
    .map((e) => ({ e, weight: snapshot.mentionCounts.get(e.id) ?? 0 }))
    .sort((a, b) => b.weight - a.weight || a.e.name.localeCompare(b.e.name))
    .slice(0, MAX_NODES);

  // Most-connected first, then alternating sides, so the busiest entities are
  // spread around the ring instead of bunched into one arc.
  const ordered: Array<{ e: (typeof ranked)[number]["e"]; weight: number }> = [];
  ranked.forEach((item, i) => (i % 2 === 0 ? ordered.push(item) : ordered.unshift(item)));

  return ordered.map((item, i) => {
    const angle = (i / ordered.length) * Math.PI * 2 - Math.PI / 2;
    return {
      id: item.e.id,
      name: item.e.name,
      weight: item.weight,
      angle,
      x: cx + Math.cos(angle) * radius,
      y: cy + Math.sin(angle) * radius,
    };
  });
}

/**
 * The constellation: entities as points of light on a ring, relations as chords.
 *
 * This is the one place Stardust Teal is allowed — the design system reserves it
 * for exactly this node/edge system. Ember marks the most-connected entity, as
 * the single brightest point rather than a fill.
 */
/** Longest label mem-port will draw before eliding. */
const LABEL_MAX_CHARS = 22;
/** Approximate advance width of IBM Plex Mono at 11px. */
const LABEL_CHAR_PX = 6.4;

function graphSvg(snapshot: WorkspaceSnapshot): string {
  const radius = 210;
  const nodes = layoutNodes(snapshot, 0, 0, radius);
  if (nodes.length === 0) return "";

  // The box has to be sized from the LABELS, not the ring. Sizing it from the
  // ring clipped the labels at 12 and 6 o'clock, where they run straight out of
  // the box -- the entity at the bottom rendered as "checkout-ser".
  const longest = Math.max(...nodes.map((n) => Math.min(n.name.length, LABEL_MAX_CHARS)));
  const pad = Math.ceil(longest * LABEL_CHAR_PX) + 20;
  const size = (radius + pad) * 2;
  const cx = size / 2;
  const cy = size / 2;
  for (const n of nodes) {
    n.x = cx + Math.cos(n.angle) * radius;
    n.y = cy + Math.sin(n.angle) * radius;
  }
  const W = size;
  const H = size;

  const byId = new Map(nodes.map((n) => [n.id, n]));
  const maxWeight = Math.max(1, ...nodes.map((n) => n.weight));

  const edges = snapshot.relations
    .map((r) => ({ from: byId.get(r.fromId), to: byId.get(r.toId), type: r.relation_type }))
    .filter((e): e is { from: Node; to: Node; type: string } => Boolean(e.from && e.to));

  /**
   * Curve toward the centre, but not all the way: a control point exactly at
   * the centre would make every chord pass through one pixel. Pulling it a
   * fraction of the way out along the chord's own midpoint keeps neighbouring
   * chords distinguishable.
   */
  const edgeSvg = edges
    .map((e) => {
      const mx = (e.from.x + e.to.x) / 2;
      const my = (e.from.y + e.to.y) / 2;
      const k = 0.42;
      const qx = cx + (mx - cx) * k;
      const qy = cy + (my - cy) * k;
      return `<path d="M${e.from.x.toFixed(1)} ${e.from.y.toFixed(1)} Q${qx.toFixed(1)} ${qy.toFixed(1)} ${e.to.x.toFixed(
        1
      )} ${e.to.y.toFixed(1)}" fill="none" stroke="#6fe0c9" stroke-opacity=".30" stroke-width="1"
><title>${esc(e.from.name)} ${esc(e.type)} ${esc(e.to.name)}</title></path>`;
    })
    .join("");

  const nodeSvg = nodes
    .map((n) => {
      const r = 3 + (n.weight / maxWeight) * 4.5;
      const brightest = n.weight === maxWeight && maxWeight > 0;
      const colour = brightest ? "#f2a24c" : "#6fe0c9";
      const deg = (n.angle * 180) / Math.PI;
      // Past vertical the label would read upside-down, so flip it and anchor
      // from the other end.
      const flipped = Math.cos(n.angle) < 0;
      const label = esc(n.name.length > LABEL_MAX_CHARS ? `${n.name.slice(0, LABEL_MAX_CHARS - 1)}…` : n.name);

      return `<g transform="translate(${cx} ${cy}) rotate(${deg.toFixed(2)})">
<circle cx="${radius}" cy="0" r="${(r * 2.8).toFixed(1)}" fill="${colour}" opacity=".10"/>
<circle cx="${radius}" cy="0" r="${r.toFixed(1)}" fill="${colour}"><title>${esc(
        n.name
      )} — mentioned by ${n.weight} record(s)</title></circle>
<text x="${flipped ? radius - 11 : radius + 11}" y="0" dy=".32em"
 text-anchor="${flipped ? "end" : "start"}" transform="${flipped ? `rotate(180 ${radius} 0)` : ""}"
 fill="${brightest ? "#f7b876" : "#b7b2ac"}" font-family="IBM Plex Mono, ui-monospace, monospace"
 font-size="11">${label}</text></g>`;
    })
    .join("");

  const hidden = snapshot.entities.length - nodes.length;

  // Centred at its natural size rather than stretched to the panel's width: a
  // square diagram blown up to 1180px would push everything below it off the
  // screen, and the labels are sized for 11px type, not for whatever scale the
  // container happens to be.
  // No panel and no background of its own: a constellation belongs on the void,
  // and boxing it inside a raised card put a visible double frame around it.
  return `<div style="overflow-x:auto;margin-bottom:1.5rem">
<svg viewBox="0 0 ${W} ${H}" role="img"
 aria-label="Entity graph: ${nodes.length} entities and ${edges.length} relations"
 style="display:block;width:100%;max-width:${W}px;margin:0 auto">
${edgeSvg}${nodeSvg}
</svg></div>
<p class="muted" style="margin-top:-.5rem;font-size:.875rem">
${nodes.length} of ${snapshot.entities.length} entities shown${
    hidden > 0 ? `, least-connected ${hidden} omitted for legibility` : ""
  }. ${edges.length} relation${edges.length === 1 ? "" : "s"} drawn. Hover a point or a line for detail.</p>`;
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
