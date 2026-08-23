import type { ApiKey, User, Workspace } from "../interfaces/admin.interface.js";

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

const STYLES = `
:root{--bg:#fbfbfd;--fg:#1a1a1f;--muted:#6b6b76;--line:#e3e3e9;--card:#fff;--accent:#3b5bdb;--danger:#c92a2a;--ok:#2b8a3e}
@media (prefers-color-scheme:dark){:root{--bg:#141418;--fg:#ececf0;--muted:#9a9aa6;--line:#2b2b33;--card:#1c1c22;--accent:#748ffc;--danger:#ff8787;--ok:#69db7c}}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--fg);font:15px/1.55 ui-sans-serif,system-ui,-apple-system,"Segoe UI",sans-serif}
a{color:var(--accent)}
header{border-bottom:1px solid var(--line);background:var(--card)}
header .inner,main{max-width:900px;margin:0 auto;padding:16px 20px}
header .inner{display:flex;align-items:center;gap:20px;flex-wrap:wrap}
header strong{font-size:16px}
header nav{display:flex;gap:16px;margin-left:auto;align-items:center}
h1{font-size:21px;margin:0 0 4px}
h2{font-size:16px;margin:28px 0 10px}
.sub{color:var(--muted);margin:0 0 20px}
.card{background:var(--card);border:1px solid var(--line);border-radius:10px;padding:18px;margin-bottom:20px}
table{width:100%;border-collapse:collapse}
th,td{text-align:left;padding:9px 10px;border-bottom:1px solid var(--line);vertical-align:middle}
th{font-size:12px;text-transform:uppercase;letter-spacing:.05em;color:var(--muted)}
tr:last-child td{border-bottom:0}
code{font:13px/1.4 ui-monospace,SFMono-Regular,Menlo,monospace;background:rgba(128,128,128,.12);padding:2px 6px;border-radius:5px}
input,select{font:inherit;padding:8px 10px;border:1px solid var(--line);border-radius:7px;background:var(--bg);color:var(--fg);min-width:200px}
button{font:inherit;padding:8px 14px;border:0;border-radius:7px;background:var(--accent);color:#fff;cursor:pointer}
button.link{background:none;color:var(--danger);padding:4px 0;text-decoration:underline}
form.inline{display:inline}
form.row{display:flex;gap:10px;flex-wrap:wrap;align-items:center}
.flash{border-radius:9px;padding:12px 14px;margin-bottom:18px;border:1px solid}
.flash.err{border-color:var(--danger);color:var(--danger)}
.flash.ok{border-color:var(--ok);color:var(--ok)}
.reveal{border:1px solid var(--ok);border-radius:9px;padding:14px;margin-bottom:20px}
.reveal code{display:block;padding:11px;margin:9px 0 0;word-break:break-all;font-size:14px}
.muted{color:var(--muted)}
.pill{font-size:12px;padding:2px 8px;border-radius:999px;border:1px solid var(--line);color:var(--muted)}
.empty{color:var(--muted);padding:14px 0}
`;

export interface AdminView {
  user: { username: string };
  csrf: string;
}

function layout(title: string, body: string, admin?: AdminView): string {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(title)} — mem-port admin</title><style>${STYLES}</style></head><body>
${
  admin
    ? `<header><div class="inner"><strong>mem-port</strong>
<nav><a href="/admin/workspaces">Workspaces</a><a href="/admin/users">Users</a>
<span class="muted">${esc(admin.user.username)}</span>
<form method="post" action="/admin/logout" class="inline">
<input type="hidden" name="csrf" value="${esc(admin.csrf)}"><button class="link">Sign out</button></form>
</nav></div></header>`
    : ""
}
<main>${body}</main></body></html>`;
}

export function loginPage(error?: string): string {
  return layout(
    "Sign in",
    `<h1>mem-port admin</h1><p class="sub">Sign in to manage workspaces, users and keys.</p>
${error ? `<div class="flash err">${esc(error)}</div>` : ""}
<div class="card"><form method="post" action="/admin/login">
<p><label>Username<br><input name="username" autocomplete="username" autofocus required></label></p>
<p><label>Password<br><input name="password" type="password" autocomplete="current-password" required></label></p>
<button>Sign in</button></form></div>`
  );
}

export function workspacesPage(
  admin: AdminView,
  workspaces: Workspace[],
  flash?: { kind: "ok" | "err"; message: string }
): string {
  const rows = workspaces
    .map(
      (w) => `<tr><td><code>${esc(w.slug)}</code></td><td>${esc(w.description ?? "")}</td>
<td class="muted">${esc(w.createdAt.slice(0, 10))}</td>
<td><form method="post" action="/admin/workspaces/delete" class="inline"
onsubmit="return confirm('Delete workspace ${esc(w.slug)}? Access grants are removed. Stored memories are NOT deleted.')">
<input type="hidden" name="csrf" value="${esc(admin.csrf)}"><input type="hidden" name="id" value="${esc(w.id)}">
<button class="link">Delete</button></form></td></tr>`
    )
    .join("");

  return layout(
    "Workspaces",
    `<h1>Workspaces</h1>
<p class="sub">A workspace is one isolated knowledge graph. Its name is what clients send as the <code>library-id</code> header.</p>
${flash ? `<div class="flash ${flash.kind}">${esc(flash.message)}</div>` : ""}
<div class="card"><form method="post" action="/admin/workspaces" class="row">
<input type="hidden" name="csrf" value="${esc(admin.csrf)}">
<input name="slug" placeholder="acme-engineering" required pattern="[A-Za-z0-9_-]+"
 title="Letters, digits, hyphens and underscores">
<input name="description" placeholder="Description (optional)">
<button>Create workspace</button></form></div>
<div class="card">${
      rows
        ? `<table><tr><th>Workspace</th><th>Description</th><th>Created</th><th></th></tr>${rows}</table>`
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
    `<h1>Users</h1>
<p class="sub">A user holds API keys and is granted access to workspaces.</p>
${flash ? `<div class="flash ${flash.kind}">${esc(flash.message)}</div>` : ""}
<div class="card"><form method="post" action="/admin/users" class="row">
<input type="hidden" name="csrf" value="${esc(admin.csrf)}">
<input name="username" placeholder="alice" required>
<label class="muted"><input type="checkbox" name="is_admin" value="1" style="min-width:auto"> admin</label>
<input name="password" type="password" placeholder="Panel password (admins only)" autocomplete="new-password">
<button>Create user</button></form></div>
<div class="card">${
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
${opts.flash ? `<div class="flash ${opts.flash.kind}">${esc(opts.flash.message)}</div>` : ""}
${
  opts.revealedKey
    ? `<div class="reveal"><strong>New API key — copy it now.</strong>
<p class="muted" style="margin:6px 0 0">This is the only time it is shown. mem-port stores a hash, so it cannot be
displayed again; if it is lost, revoke it and issue another.</p>
<code>${esc(opts.revealedKey)}</code></div>`
    : ""
}

<h2>API keys</h2>
<div class="card">
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
<div class="card">
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
<div class="card">
<form method="post" action="/admin/users/${encodeURIComponent(user.id)}/password" class="row">
${csrf}<input name="password" type="password" placeholder="Set panel password" autocomplete="new-password" required>
<button>Update password</button></form>
<p style="margin-top:16px">
<form method="post" action="/admin/users/${encodeURIComponent(user.id)}/disable" class="inline">
${csrf}<input type="hidden" name="disabled" value="${user.disabled ? "0" : "1"}">
<button class="link">${user.disabled ? "Re-enable this user" : "Disable this user"}</button></form>
</p>
<p><form method="post" action="/admin/users/${encodeURIComponent(user.id)}/delete" class="inline"
onsubmit="return confirm('Delete ${esc(user.username)}? Their keys and grants are removed. This cannot be undone.')">
${csrf}<button class="link">Delete user</button></form></p>
</div>

<h2>Client setup</h2>
<div class="card"><p class="muted">Point an MCP client at this daemon with the user's key and one workspace:</p>
<code>Authorization: Bearer &lt;the key above&gt;<br>library-id: &lt;workspace&gt;</code></div>`,
    admin
  );
}

export function errorPage(status: number, message: string): string {
  return layout(String(status), `<h1>${status}</h1><p class="sub">${esc(message)}</p><p><a href="/admin">Back</a></p>`);
}
