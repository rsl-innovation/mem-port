import type { ApiKey, User, Workspace } from "../interfaces/admin.interface.js";
import { THEME_CSS } from "./theme.js";

/**
 * Server-rendered HTML for the admin panel.
 *
 * Deliberately plain: forms and links, no client framework, no build step, no
 * external assets. The panel is a handful of CRUD screens an admin visits
 * occasionally, and keeping it dependency-free means it cannot drift out of
 * step with the daemon it ships inside.
 */

/**
 * Escape text for HTML.
 *
 * Applied to every interpolated value without exception. Usernames, workspace
 * slugs and key labels are all operator-supplied, and a panel that renders
 * them raw would let one admin store script that runs in another's session.
 */
export function esc(value: unknown): string {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

export interface AdminView {
  user: { username: string };
  csrf: string;
}

export function layout(title: string, body: string, admin?: AdminView): string {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex,nofollow">
<title>${esc(title)} — mem-port</title><style>${THEME_CSS}</style></head><body>
${
  admin
    ? `<header><div class="wrap"><a class="brand" href="/admin/workspaces">mem<span>-</span>port</a>
<nav><a href="/admin/workspaces">Workspaces</a><a href="/admin/users">Users</a><a href="/admin/docs">Docs</a>
<span class="who">${esc(admin.user.username)}</span>
<form method="post" action="/admin/logout" class="inline">
<input type="hidden" name="csrf" value="${esc(admin.csrf)}"><button class="link quiet">Sign out</button></form>
</nav></div></header>`
    : ""
}
<main>${body}</main></body></html>`;
}

export function loginPage(error?: string): string {
  return layout(
    "Sign in",
    `<div style="max-width:26rem;margin:clamp(2rem,10vh,6rem) auto 0">
<p class="eyebrow">mem-port</p>
<h1>Sign <em>in</em></h1>
<p class="sub">Manage workspaces, users and access keys.</p>
${error ? `<div class="note bad">${esc(error)}</div>` : ""}
<div class="panel"><form method="post" action="/admin/login">
<div style="margin-bottom:1rem"><label for="u">Username</label>
<input id="u" name="username" autocomplete="username" autofocus required style="width:100%"></div>
<div style="margin-bottom:1.35rem"><label for="p">Password</label>
<input id="p" name="password" type="password" autocomplete="current-password" required style="width:100%"></div>
<button style="width:100%">Sign in</button></form></div></div>`
  );
}

export function workspacesPage(
  admin: AdminView,
  workspaces: Workspace[],
  flash?: { kind: "ok" | "err"; message: string }
): string {
  const rows = workspaces
    .map(
      (w) => `<tr><td><span class="dot"></span><code>${esc(w.slug)}</code></td>
<td>${esc(w.description ?? "")}</td>
<td class="muted">${esc(w.createdAt.slice(0, 10))}</td>
<td><a href="/admin/workspaces/${encodeURIComponent(w.slug)}/explore">Explore</a></td>
<td><form method="post" action="/admin/workspaces/delete" class="inline"
onsubmit="return confirm('Delete workspace ${esc(w.slug)}? Access grants are removed. Stored memories are NOT deleted.')">
<input type="hidden" name="csrf" value="${esc(admin.csrf)}"><input type="hidden" name="id" value="${esc(w.id)}">
<button class="link">Delete</button></form></td></tr>`
    )
    .join("");

  return layout(
    "Workspaces",
    `<p class="eyebrow">Access control</p><h1>Work<em>spaces</em></h1>
<p class="sub">A workspace is one isolated knowledge graph. Its name is what clients send as the
<code>library-id</code> header, and nothing in one workspace can see anything in another.</p>
${flash ? `<div class="note${flash.kind === "err" ? " bad" : ""}">${esc(flash.message)}</div>` : ""}
<div class="panel"><form method="post" action="/admin/workspaces" class="row">
<input type="hidden" name="csrf" value="${esc(admin.csrf)}">
<div><label for="slug">Workspace name</label>
<input id="slug" name="slug" placeholder="acme-engineering" required pattern="[A-Za-z0-9_-]+"
 title="Letters, digits, hyphens and underscores"></div>
<div><label for="desc">Description</label>
<input id="desc" name="description" placeholder="Optional"></div>
<button>Create workspace</button></form></div>
<div class="panel">${
      rows
        ? `<table><tr><th>Workspace</th><th>Description</th><th>Created</th><th>Graph</th><th></th></tr>${rows}</table>`
        : `<p class="empty">No workspaces yet.</p>`
    }</div>`,
    admin
  );
}

export function usersPage(
  admin: AdminView,
  users: User[],
  flash?: { kind: "ok" | "err"; message: string }
): string {
  const rows = users
    .map(
      (u) => `<tr><td><a href="/admin/users/${encodeURIComponent(u.id)}">${esc(u.username)}</a></td>
<td>${u.isAdmin ? '<span class="pill">admin</span>' : ""} ${u.disabled ? '<span class="pill">disabled</span>' : ""}</td>
<td class="muted">${esc(u.createdAt.slice(0, 10))}</td></tr>`
    )
    .join("");

  return layout(
    "Users",
    `<p class="eyebrow">Access control</p><h1>Us<em>ers</em></h1>
<p class="sub">A user holds API keys and is granted access to specific workspaces. A key can only
open the workspaces its user was granted.</p>
${flash ? `<div class="note${flash.kind === "err" ? " bad" : ""}">${esc(flash.message)}</div>` : ""}
<div class="panel"><form method="post" action="/admin/users" class="row">
<input type="hidden" name="csrf" value="${esc(admin.csrf)}">
<div><label for="un">Username</label><input id="un" name="username" placeholder="alice" required></div>
<div><label for="pw">Panel password</label>
<input id="pw" name="password" type="password" placeholder="Admins only" autocomplete="new-password"></div>
<div><label for="ia">Admin</label>
<span style="display:flex;align-items:center;height:41px"><input id="ia" type="checkbox" name="is_admin" value="1"
 style="min-width:auto;width:18px;height:18px;accent-color:#f2a24c"></span></div>
<button>Create user</button></form></div>
<div class="panel">${
      rows ? `<table><tr><th>User</th><th></th><th>Created</th></tr>${rows}</table>` : `<p class="empty">No users yet.</p>`
    }</div>`,
    admin
  );
}

export function userPage(
  admin: AdminView,
  user: User,
  keys: ApiKey[],
  grants: string[],
  workspaces: Workspace[],
  opts: { revealedKey?: string; flash?: { kind: "ok" | "err"; message: string } } = {}
): string {
  const csrf = `<input type="hidden" name="csrf" value="${esc(admin.csrf)}">`;

  const keyRows = keys
    .map((k) => {
      const state = k.revokedAt
        ? '<span class="pill">revoked</span>'
        : `<form method="post" action="/admin/users/${encodeURIComponent(user.id)}/keys/revoke" class="inline"
onsubmit="return confirm('Revoke this key? Any client using it stops working immediately.')">
${csrf}<input type="hidden" name="key_id" value="${esc(k.id)}"><button class="link">Revoke</button></form>`;
      return `<tr><td>${esc(k.label || "—")}</td><td><code>${esc(k.keyId)}</code></td>
<td class="muted">${esc(k.createdAt.slice(0, 10))}</td>
<td class="muted">${k.lastUsedAt ? esc(k.lastUsedAt.slice(0, 10)) : "never"}</td><td>${state}</td></tr>`;
    })
    .join("");

  const grantRows = grants
    .map(
      (slug) => `<tr><td><code>${esc(slug)}</code></td>
<td><form method="post" action="/admin/users/${encodeURIComponent(user.id)}/grants/revoke" class="inline">
${csrf}<input type="hidden" name="workspace" value="${esc(slug)}"><button class="link">Revoke</button></form></td></tr>`
    )
    .join("");

  const options = workspaces
    .filter((w) => !grants.includes(w.slug))
    .map((w) => `<option value="${esc(w.slug)}">${esc(w.slug)}</option>`)
    .join("");

  return layout(
    user.username,
    `<p><a href="/admin/users">&larr; Users</a></p>
<h1>${esc(user.username)} ${user.isAdmin ? '<span class="pill">admin</span>' : ""} ${
      user.disabled ? '<span class="pill">disabled</span>' : ""
    }</h1>
<p class="sub">Created ${esc(user.createdAt.slice(0, 10))}</p>
${opts.flash ? `<div class="note${opts.flash.kind === "err" ? " bad" : ""}">${esc(opts.flash.message)}</div>` : ""}
${
  opts.revealedKey
    ? `<div class="reveal"><strong>New API key — copy it now.</strong>
<p class="muted" style="margin:6px 0 0">This is the only time it is shown. mem-port stores a hash, so it cannot be
displayed again; if it is lost, revoke it and issue another.</p>
<code>${esc(opts.revealedKey)}</code></div>`
    : ""
}

<h2>API keys</h2>
<div class="panel">
<form method="post" action="/admin/users/${encodeURIComponent(user.id)}/keys" class="row">
${csrf}<input name="label" placeholder="Laptop, CI, ...">
<button>Issue new key</button></form>
${
  keyRows
    ? `<table style="margin-top:16px"><tr><th>Label</th><th>Key id</th><th>Created</th><th>Last used</th><th></th></tr>${keyRows}</table>`
    : `<p class="empty">No keys yet.</p>`
}
</div>

<h2>Workspace access</h2>
<div class="panel">
${
  options
    ? `<form method="post" action="/admin/users/${encodeURIComponent(user.id)}/grants" class="row">
${csrf}<select name="workspace" required>${options}</select><button>Grant access</button></form>`
    : `<p class="muted">${
        workspaces.length ? "Every workspace is already granted." : "No workspaces exist yet."
      }</p>`
}
${
  grantRows
    ? `<table style="margin-top:16px"><tr><th>Workspace</th><th></th></tr>${grantRows}</table>`
    : `<p class="empty">No access granted. This user's keys cannot reach anything yet.</p>`
}
</div>

<h2>Account</h2>
<div class="panel">
<form method="post" action="/admin/users/${encodeURIComponent(user.id)}/password" class="row">
${csrf}<input name="password" type="password" placeholder="Set panel password" autocomplete="new-password" required>
<button>Update password</button></form>
<p style="margin-top:16px">
<form method="post" action="/admin/users/${encodeURIComponent(user.id)}/disable" class="inline">
${csrf}<input type="hidden" name="disabled" value="${user.disabled ? "0" : "1"}">
<button class="link${user.disabled ? " quiet" : ""}">${
  user.disabled ? "Re-enable this user" : "Disable this user"
}</button></form>
</p>
<p><form method="post" action="/admin/users/${encodeURIComponent(user.id)}/delete" class="inline"
onsubmit="return confirm('Delete ${esc(user.username)}? Their keys and grants are removed. This cannot be undone.')">
${csrf}<button class="link">Delete user</button></form></p>
</div>

<h2>Client setup</h2>
<div class="panel"><p class="muted">Point an MCP client at this daemon with the user's key and one workspace:</p>
<code>Authorization: Bearer &lt;the key above&gt;<br>library-id: &lt;workspace&gt;</code></div>`,
    admin
  );
}

export function errorPage(status: number, message: string): string {
  return layout(String(status), `<h1>${status}</h1><p class="sub">${esc(message)}</p><p><a href="/admin">Back</a></p>`);
}
