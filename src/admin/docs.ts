import { esc, layout, type AdminView } from "./views.js";

/**
 * Documentation, served from the daemon itself.
 *
 * Written for the person who has just been handed this URL and a password: what
 * the product stores, how to hand someone access, and what to paste into a
 * client. Deliberately not a copy of the README — that addresses someone
 * installing mem-port on their own machine, while this addresses someone
 * administering a shared one.
 *
 * Two things are stated plainly rather than glossed, because getting either
 * wrong is expensive: an issued key is visible exactly once, and being an admin
 * does not grant access to any workspace's contents.
 */
export function docsPage(admin: AdminView, origin: string): string {
  const o = esc(origin);

  return layout(
    "Docs",
    `<p class="eyebrow">Documentation</p>
<h1>Using <em>mem-port</em></h1>
<p class="sub">What this server stores, how to give someone access to it, and what they paste into
their AI tool to start using it.</p>

<ul class="toc">
<li><a href="#what">What mem-port is</a></li>
<li><a href="#records">What it stores</a></li>
<li><a href="#portal">Running the portal</a></li>
<li><a href="#connect">Connecting a client</a></li>
<li><a href="#explore">Exploring a graph</a></li>
<li><a href="#security">Keys and access</a></li>
<li><a href="#trouble">Troubleshooting</a></li>
</ul>

<h2 id="what">What mem-port is</h2>
<p>mem-port is shared long-term memory for AI copilots. Claude Code, Cursor, Windsurf and any other
MCP client point at this one server, so something learned in one tool is available in the next
instead of being re-explained every session.</p>
<p>It speaks the Model Context Protocol, so a client discovers its tools automatically — there is
nothing to teach the model beyond connecting it.</p>

<h2 id="records">What it stores</h2>
<p>Five record types, each answering a different retrieval question. They live in one graph, linked
by the people, projects and systems they mention.</p>
<div class="panel tight"><table>
<tr><th>Record</th><th>Answers</th></tr>
<tr><td><span class="dot"></span><b>Memories</b></td><td>What do I know about this person or project?</td></tr>
<tr><td><span class="dot"></span><b>Episodes</b></td><td>What happened, and when?</td></tr>
<tr><td><span class="dot"></span><b>Entities</b></td><td>Who and what is involved, and how do they relate?</td></tr>
<tr><td><span class="dot"></span><b>Skills</b></td><td>How do we do this thing, the way we do it here?</td></tr>
<tr><td><span class="dot"></span><b>Decision records</b></td><td>Why is it built this way, and what did we reject?</td></tr>
</table></div>
<p>Search is semantic rather than keyword-based, so a question finds a record that means the same
thing without sharing its words.</p>

<h2 id="portal">Running the portal</h2>
<p>Three things happen here, in this order.</p>

<h3>1. Create a workspace</h3>
<p>A workspace is one isolated knowledge graph. Nothing in one can see anything in another, so use
separate workspaces for separate contexts — a team, a client, a personal one — and a shared
workspace where people should genuinely share memory.</p>
<p class="muted">The workspace name is what clients send as the <code>library-id</code> header, so
keep it short and typeable.</p>

<h3>2. Create a user and issue a key</h3>
<p>A user is a person or a machine that will connect. Issuing a key produces the credential they
use. Give each device or service its own key with a label naming it, so revoking one does not lock
someone out of everything else.</p>
<div class="note"><strong>A key is shown once.</strong> mem-port stores only a hash of it, so it
cannot be displayed again later — not by you, not by anyone with database access. If it is lost,
revoke it and issue another.</div>

<h3>3. Grant workspace access</h3>
<p>A key opens nothing until its user is granted a workspace. Grant only what each person needs;
revoking a grant takes effect on the very next request, without touching their key.</p>
<div class="note"><strong>Being an admin is not access.</strong> Admins decide who may reach what,
which is a different power from reading it — so a stolen admin password exposes this account model
rather than every workspace's contents. To browse a workspace yourself, grant it to your own
account.</div>

<h2 id="connect">Connecting a client</h2>
<p>Every client needs the same three things: this server's URL, a key, and a workspace name.</p>
<pre><code>URL             ${o}/mcp
Authorization   Bearer &lt;the key you issued&gt;
library-id      &lt;the workspace you granted&gt;</code></pre>

<h3>Claude Code</h3>
<pre><code>claude mcp add --transport http mem-port ${o}/mcp \\
  --header "Authorization: Bearer &lt;key&gt;" \\
  --header "library-id: &lt;workspace&gt;"</code></pre>

<h3>Anything else that reads a JSON config</h3>
<pre><code>{
  "mcpServers": {
    "mem-port": {
      "type": "http",
      "url": "${o}/mcp",
      "headers": {
        "Authorization": "Bearer &lt;key&gt;",
        "library-id": "&lt;workspace&gt;"
      }
    }
  }
}</code></pre>

<h3>Checking it works</h3>
<p>From a terminal, with a real key and workspace:</p>
<pre><code>curl -s -X POST ${o}/mcp \\
  -H 'content-type: application/json' \\
  -H 'accept: application/json, text/event-stream' \\
  -H 'authorization: Bearer &lt;key&gt;' \\
  -H 'library-id: &lt;workspace&gt;' \\
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/call",
       "params":{"name":"list_skills","arguments":{}}}'</code></pre>
<p class="muted">A <code>401</code> means the key is wrong, missing or revoked. A <code>403</code>
means the key is fine but its user has no grant for that workspace.</p>

<h3>Getting the copilot to actually use it</h3>
<p>Clients call tools when the model decides to. mem-port ships instructions telling it to save
durable facts and search before assuming nothing exists, but a line in the project's own rules file
helps considerably — something like <em>&ldquo;Use mem-port to store and recall project
context.&rdquo;</em></p>

<h2 id="explore">Exploring a graph</h2>
<p>Each workspace has an <b>Explore</b> view: what it holds, the entities in it, and how they connect.
It is read-only and exists to answer &ldquo;is anything actually landing in here?&rdquo; — the usual
first question after connecting a new client.</p>
<p class="muted">Because exploring means reading the contents, it needs a grant like any other
access. Grant the workspace to your own account first.</p>

<h2 id="security">Keys and access</h2>
<div class="panel tight"><table>
<tr><th>Action</th><th>Effect</th></tr>
<tr><td>Revoke a key</td><td>That key stops working immediately. Other keys for the same user are unaffected.</td></tr>
<tr><td>Rotate a key</td><td>Issue a new one, move the client onto it, then revoke the old one — in that order, so nothing is offline in between.</td></tr>
<tr><td>Revoke a grant</td><td>The user's keys stop opening that workspace, and keep working elsewhere.</td></tr>
<tr><td>Disable a user</td><td>Every key they hold stops working at once, without deleting anything.</td></tr>
<tr><td>Delete a user</td><td>Removes them with their keys and grants. Records they wrote stay in the workspace.</td></tr>
<tr><td>Delete a workspace</td><td>Removes it from this list and drops its grants. <b>Stored records are not deleted</b> — recreating the same name makes them reachable again.</td></tr>
</table></div>

<h2 id="trouble">Troubleshooting</h2>
<div class="panel tight"><table>
<tr><th>Symptom</th><th>Cause</th></tr>
<tr><td>Client reports 401</td><td>Key missing, mistyped or revoked. Issue a fresh one.</td></tr>
<tr><td>Client reports 403</td><td>Key is valid but the workspace is not granted to its user — or the workspace name is misspelled. The two are deliberately indistinguishable from outside, so an unauthenticated caller cannot discover which workspaces exist.</td></tr>
<tr><td>Copilot connects but never saves anything</td><td>The model is choosing not to call the tools. Add an instruction to the project's rules file.</td></tr>
<tr><td>Searches return nothing</td><td>Nothing saved to <em>that</em> workspace yet. Check the Explore view, and check the client is sending the workspace you expect.</td></tr>
<tr><td>Someone sees another team's memory</td><td>Two clients are sending the same <code>library-id</code>. Workspaces are isolated; a shared name is a shared workspace.</td></tr>
</table></div>`,
    admin
  );
}
