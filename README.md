# mem-port

[![npm version](https://img.shields.io/npm/v/@rsl-innovation/mem-port.svg)](https://www.npmjs.com/package/@rsl-innovation/mem-port)

**[mem-port.com](https://mem-port.com/)**

A local MCP (Model Context Protocol) server for portable, long-term agentic memory — a thumb drive for your AI context.

Every AI copilot (Claude Code, Cursor, Windsurf, ...) keeps its own memory, siloed to that tool. The usual workaround — copy-pasting context, summaries, or exported notes from one agent into another — only captures a snapshot frozen at the moment you made it. From there the copies drift: each agent keeps learning on its own, nothing keeps the copies in sync, and the longer you go the more your copilots disagree about what's actually true. mem-port runs as a single local daemon that any number of copilots can connect to, backed by an embedded knowledge graph (entities, episodes, memories, skills, architectural decision records, and the relations between them) that survives restarts and can be exported to a portable file and moved anywhere. Every connected copilot reads and writes the same graph, so there's nothing to paste and nothing to drift.

Unlike other memory-for-agents projects, mem-port needs **no external services** — no Postgres, no Qdrant, no Neo4j. It's one process, one embedded [SurrealDB](https://surrealdb.com) instance combining graph storage and vector search, and zero-config local semantic search (no API key required).

Connecting a client (below) gives it the *ability* to use mem-port; for more detailed, tunable instructions on what it should actually save and when — including keeping personal/team/project memory in separate scopes — see **[MEMORY_GUIDE.md](./MEMORY_GUIDE.md)**.

## Quick start

```bash
npx @rsl-innovation/mem-port serve
```

This starts a daemon on `http://127.0.0.1:8787/mcp`. Point any MCP client at it over Streamable HTTP, with a `library-id` header identifying your workspace. Every copilot that connects with the same `library-id` shares the same memory; different `library-id`s are fully isolated from each other (each maps to its own SurrealDB namespace/database) — there's no cross-tenant leakage.

`npx` re-checks the registry on every invocation. If you'll be running mem-port commands often, install it globally instead so `mem-port` is a plain command on your PATH:

```bash
npm install -g @rsl-innovation/mem-port
mem-port serve
```

The rest of this README uses `mem-port <command>` for brevity. If you didn't install globally, substitute `npx @rsl-innovation/mem-port <command>` wherever you see that — it works identically, just slower to start.

### Connecting from Claude Code

Easiest: use the CLI (`--header` accepts any number of `Key: Value` pairs). Add `--scope user` so the server is available in every project on this machine, not just the one you happen to be in when you run the command — the default `local` scope ties it to a single project directory:

```bash
claude mcp add --transport http mem-port http://127.0.0.1:8787/mcp \
  --header "library-id: my-personal-workspace" \
  --scope user
```

Or add it directly to `~/.claude.json` (user scope, applies everywhere) or `.mcp.json` (project scope, shareable via version control with that repo's team). The `type` field is required — an entry with a `url` but no `type` is treated as a misconfigured stdio server:

```json
{
  "mcpServers": {
    "mem-port": {
      "type": "http",
      "url": "http://127.0.0.1:8787/mcp",
      "headers": { "library-id": "my-personal-workspace" }
    }
  }
}
```

Run `/mcp` inside Claude Code to confirm it shows `mem-port` as connected.

### Connecting from the Claude Code VS Code extension

The extension shares the exact same MCP configuration as the CLI (`.mcp.json` / `~/.claude.json`) — there's no separate settings UI to add a server from. Open the integrated terminal (`` Ctrl+` `` / `` Cmd+` ``) and run the same command as above:

```bash
claude mcp add --transport http mem-port http://127.0.0.1:8787/mcp \
  --header "library-id: my-personal-workspace" \
  --scope user
```

This requires the [standalone `claude` CLI](https://code.claude.com/docs/en/setup) to be installed — the extension bundles its own private copy for the chat panel and does *not* put `claude` on your terminal PATH, so `claude mcp add` won't work in the integrated terminal until you install the CLI separately. Editing `.mcp.json` directly (the JSON block above) works too and doesn't need the CLI.

Once added, type `/mcp` in the chat panel to confirm mem-port shows as connected, or to enable/disable/reconnect it.

### Connecting from other MCP clients

Any client that supports Streamable HTTP with custom headers can connect the same way. Clients that only support stdio-based servers (some Claude Desktop configurations, for example) need a stdio-to-HTTP bridge such as [`mcp-remote`](https://www.npmjs.com/package/mcp-remote):

```json
{
  "mcpServers": {
    "mem-port": {
      "command": "npx",
      "args": ["-y", "mcp-remote@latest", "http://127.0.0.1:8787/mcp", "--header", "library-id:my-personal-workspace"]
    }
  }
}
```

### Getting your copilot to use it proactively

Connecting the server gives your copilot the *ability* to save/recall memory — the server's MCP `instructions` and tool descriptions already nudge any client toward using it proactively. For more explicit control (and for keeping personal/organizational/project memory in separate `library-id` scopes instead of one bucket), see [MEMORY_GUIDE.md](./MEMORY_GUIDE.md) for instructions to paste into your copilot's own custom-instructions file.

## Tools

| Tool | Purpose |
|---|---|
| `save_memory` | Save a fact/preference/decision/task/reference, optionally linked to entities |
| `search_memory` | Semantic (vector) search over memories |
| `save_episode` | Record a raw interaction/event that memories can be derived from |
| `list_episodes` | List recorded episodes, filterable by time range/source |
| `save_skill` | Save a reusable procedure, optionally linked to entities |
| `search_skills` | Semantic (vector) search over skills, by task/situation |
| `list_skills` | List saved skills, filterable by tag/source |
| `get_skill` | Look up a skill by exact name or id |
| `forget_skill` | Soft-archive (default) or permanently delete a skill |
| `save_adr` | Record an architectural decision, optionally superseding an earlier one |
| `search_adrs` | Semantic (vector) search over ADRs, by problem or area |
| `list_adrs` | List the ADR log, filterable by status/tag/source |
| `get_adr` | Look up one ADR in full, by number or id |
| `forget_adr` | Soft-archive (default) or permanently delete an ADR |
| `get_entity` | Look up an entity plus everything that mentions or relates to it |
| `relate_entities` | Create a graph relation between two entities |
| `forget_memory` | Soft-archive (default) or permanently delete a memory |
| `export_library` | Export this library to a portable `.memport.json` bundle |
| `import_library` | Import a `.memport.json` bundle, merging or overwriting |

### Rendered results (A2UI)

The nine read tools — `search_memory`, `list_episodes`, `search_skills`, `list_skills`, `get_skill`, `search_adrs`, `list_adrs`, `get_adr`, `get_entity` — return their results twice: the JSON text block your copilot reads, plus an [A2UI](https://a2ui.org) surface a renderer-capable host can draw instead of showing a human that JSON. Lists come back as result cards, `get_*` as a detail view.

The A2UI payload is an [A2UI v1.0](https://a2ui.org/specification/v1.0-a2ui/) message stream against the basic catalog, wrapped as an MCP embedded resource with mime type `application/a2ui+json`, [as the A2UI-over-MCP guide specifies](https://a2ui.org/guides/a2ui_over_mcp/). The text block is always first and is byte-identical to what it was before, so clients that don't render A2UI behave exactly as they did.

It is **on by default**. To turn it off, add an `a2ui: 0` header next to `library-id` where you configure the client:

```json
{
  "mcpServers": {
    "mem-port": {
      "type": "http",
      "url": "http://127.0.0.1:8787/mcp",
      "headers": { "library-id": "my-personal-workspace", "a2ui": "0" }
    }
  }
}
```

Or turn it off for every client at once by starting the daemon with `A2UI=0 mem-port serve`. An explicit `a2ui` header wins over the environment in both directions, so one client can opt back in on a daemon that has it off.

## Memories and episodes

**Memories** are the core unit — one durable, self-contained statement worth recalling in a later session that starts from zero context ("User prefers dark mode in all editors"). Each carries a `memory_type` (`fact`, `preference`, `decision`, `task`, or `reference`) that `search_memory` can filter on, and an `importance` from 0 to 1. The type is worth picking deliberately: it's the difference between a searchable library and a flat pile of text — see [MEMORY_GUIDE.md](./MEMORY_GUIDE.md) for how to choose, and for what doesn't belong in memory at all.

**Episodes** are the raw material memories get derived from — a conversation, a debugging session, a meeting — recorded with a `title`, `content`, a `source` (which copilot recorded it) and `occurred_at`. Where a memory is a distilled claim, an episode is an unedited record of something that happened. `save_memory` takes a `source_episode_id`, so a memory can point back at the episode it came from and keep its provenance.

The two answer different questions, which is why both exist: *"what's true about this project?"* is a semantic search over memories, while *"what happened last Tuesday?"* is a chronological read of episodes via `list_episodes` (filterable by time range and source). Memories are what you search; episodes are what you replay.

**Entities** — people, projects, tools — are the connective tissue. Passing `entity_refs` when saving anything links it to those entities, creating them on first mention. `get_entity` then returns every memory, episode, skill, and ADR that mentions the entity plus its related entities, which makes "tell me everything relevant to checkout-service" one lookup instead of several searches. `relate_entities` adds typed edges between entities themselves (`Alice` —leads→ `mem-port`).

## Skills memory

Alongside episodes and memories, mem-port stores **skills** — reusable procedures for recurring tasks (e.g. "how to debug a flaky test in this repo," "the deploy steps for checkout-service"). A skill has a `name`, a `description` (the trigger condition — when a copilot should reach for it, matched by `search_skills`), and `content` (the actual instructions).

Skills are what makes "porting common skills across AI" work with no extra machinery: since they live in the same shared knowledge graph as everything else, a skill saved by Claude Code is immediately visible to Cursor or Windsurf the moment they connect with the same `library-id` — no file format conversion needed. `export_library`/`import_library` carry skills between machines exactly like entities, episodes, and memories.

## ADR log

mem-port also keeps an **ADR log** — architectural decision records, the consequential technical choices whose reasoning matters months later. Each ADR gets a sequential number within its library (`ADR-0001`, `ADR-0002`, ...) and holds the four things a decision record needs: the `context` that forced the decision, the `decision` itself, its `consequences`, and the `alternatives` that lost.

This is deliberately not the same as `save_memory(memory_type: "decision")`. A memory records *that* something was decided; an ADR keeps the problem framing and the rejected options, which is what you actually need when someone proposes the rejected option again a year later. `search_adrs` matches against title + context + decision, so "why aren't we using Postgres?" finds the record even when it shares no words with it.

Decisions get reversed, so ADRs have a lifecycle (`proposed` → `accepted`, then `superseded` or `deprecated`) and a supersede chain. Passing `supersedes` when recording a newer decision — as a record id, a number, or its display form like `ADR-0003` — automatically marks the older one `superseded` and links the two, so the log stays readable from either end rather than accumulating contradictory records.

Prefer superseding an ADR over `forget_adr` — a decision that was reversed is usually worth keeping on the record.

## Porting memory between machines

Same-machine sharing across copilots needs no extra step — they just connect to the same daemon with the same `library-id`. `export_library`/`import_library` solve a different problem: moving to a new machine, backing up, versioning (the bundle is plain JSON — commit it to a private git repo if you like), or handing a curated slice of memory to someone else.

```bash
# on the old machine
mem-port export --library-id my-personal-workspace
# -> writes <data-dir>/exports/my-personal-workspace-<timestamp>.memport.json

# on the new machine, after copying the file over
mem-port import --library-id my-personal-workspace --in ./my-personal-workspace-....memport.json
```

`import` defaults to `--mode merge` (dedupes entities by name+type, memories/episodes/skills/ADRs by content hash — importing the same bundle twice is a no-op). Imported ADRs are renumbered onto the end of the target library's sequence rather than colliding with its existing numbers; supersede links are carried across by record reference, so a chain survives renumbering intact. Pass `--mode overwrite` to wipe the target library first, or `--dry-run` to see what would happen without writing anything.

## Running persistently

`mem-port serve` runs in the foreground — it's a long-lived daemon, not a one-shot command, so it blocks whatever terminal started it and dies when that terminal closes. If your MCP client can't connect (`ECONNREFUSED 127.0.0.1:8787`), that's almost always the reason: nothing is actually listening. Check with `lsof -i :8787`.

For a quick session, background it: `mem-port serve &` (or `nohup mem-port serve > ~/.mem-port.log 2>&1 &` to survive closing the terminal). For something that survives reboots and restarts itself if it ever crashes, set it up as a proper background service.

### macOS (launchd)

```bash
which node        # note this path
which mem-port     # note this path too, then resolve the symlink:
readlink -f "$(which mem-port)"   # -> .../lib/node_modules/@rsl-innovation/mem-port/bin/mem-port.js
```

Write `~/Library/LaunchAgents/com.rsl-innovation.mem-port.plist`, substituting the two paths above. **Invoke `node` directly with the resolved script path — don't point `ProgramArguments` at the `mem-port` shim itself.** `launchd` doesn't inherit your shell's PATH, so the shim's `#!/usr/bin/env node` shebang fails with `env: node: No such file or directory` when launchd runs it:

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>com.rsl-innovation.mem-port</string>
    <key>ProgramArguments</key>
    <array>
        <string>/usr/local/bin/node</string>
        <string>/usr/local/lib/node_modules/@rsl-innovation/mem-port/bin/mem-port.js</string>
        <string>serve</string>
    </array>
    <key>RunAtLoad</key>
    <true/>
    <key>KeepAlive</key>
    <true/>
    <key>StandardOutPath</key>
    <string>/Users/YOUR_USERNAME/Library/Logs/mem-port.log</string>
    <key>StandardErrorPath</key>
    <string>/Users/YOUR_USERNAME/Library/Logs/mem-port.error.log</string>
</dict>
</plist>
```

```bash
launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/com.rsl-innovation.mem-port.plist   # start now + on every login
launchctl bootout gui/$(id -u)/com.rsl-innovation.mem-port                                  # stop and unregister
tail -f ~/Library/Logs/mem-port.log ~/Library/Logs/mem-port.error.log                       # logs
```

To pick up a new version after `npm install -g @rsl-innovation/mem-port`, restart the running job in place — no need to unload/reload the plist:

```bash
launchctl kickstart -k gui/$(id -u)/com.rsl-innovation.mem-port
```

To stop it and start it again later, use `bootout`/`bootstrap` (above) rather than `launchctl stop` — this plist's `KeepAlive` is unconditionally `true`, so a plain `stop` gets immediately relaunched by launchd. `bootout` actually unregisters the job, and `bootstrap` registers and starts it again.

### Linux (systemd --user)

```ini
# ~/.config/systemd/user/mem-port.service
[Unit]
Description=mem-port

[Service]
ExecStart=/usr/bin/node /path/to/lib/node_modules/@rsl-innovation/mem-port/bin/mem-port.js serve
Restart=on-failure

[Install]
WantedBy=default.target
```

```bash
systemctl --user enable --now mem-port
journalctl --user -u mem-port -f
```

## Configuration

| Env var | Default | Purpose |
|---|---|---|
| `MEM_PORT_PORT` | `8787` | HTTP port |
| `MEM_PORT_DATA_DIR` | OS-appropriate app data dir | Where the SurrealDB store and cached embedding model live |
| `MEM_PORT_EMBEDDING_MODEL` | `Xenova/all-MiniLM-L6-v2` | Local embedding model id (reserved for future use) |
| `MEM_PORT_MODEL_CACHE_DIR` | `<data-dir>/models` | Override the embedding model cache location |
| `A2UI` / `MEM_PORT_A2UI` | on | Set to `0` to stop the read tools emitting [A2UI](#rendered-results-a2ui) surfaces |

All state lives under one data directory — the SurrealDB store (`surrealkv://`, persistent across restarts) and the cached local embedding model. Delete the data dir to fully reset.

## Development

```bash
npm install
npm run dev        # start the daemon with tsx, no build step
npm test           # vitest: tenancy isolation + export/import round-trip
npm run typecheck
npm run build       # tsup -> dist/, what npx @rsl-innovation/mem-port actually runs
```

`scripts/smoke.sh` is a plain-curl smoke test against a already-running daemon (no Node/Inspector dependency, usable in CI):

```bash
npm run dev &
./scripts/smoke.sh
```

### Releasing

Releases are automated. Bumping the version creates the commit and the `vX.Y.Z` tag; pushing the tag is what triggers everything else:

```bash
npm version patch   # or minor / major — runs typecheck + tests first
git push --follow-tags
```

The `Release` workflow then verifies the tag matches `package.json`, re-runs typecheck and tests, publishes to npm (with provenance, via OIDC trusted publishing — no token stored anywhere), and creates the GitHub Release with notes generated from the commits since the previous tag.

Do not run `npm publish` by hand; a tag push is the only supported path.

## Gotchas

- **mem-port is a localhost server — it only works with clients running on the same machine.** Web/cloud-hosted chat sessions (e.g. chatgpt.com or claude.ai in a browser tab) run server-side and have no route to `127.0.0.1` on your computer, so they can't reach mem-port no matter how it's configured. To connect ChatGPT, Claude, or similar tools, install their **desktop app** and add mem-port there — the desktop app runs locally and can reach the daemon, whereas the same account's web session cannot.
- Claude Code's CLI and VS Code extension both run locally already, so they work out of the box (see the connection instructions above) — this gotcha mainly matters for tools you might otherwise only use through a browser.

## Known limitations (v1)

- Vector search is brute-force (no HNSW/DISKANN index yet) — fine at personal-memory-store scale, revisit if a library grows very large.
- `export_library`'s scope filtering supports `memory_types` and `since`; filtering by `entity_ids` isn't implemented yet.
- No authentication — the daemon binds to `127.0.0.1` only and trusts anything running locally on your machine.
- `@huggingface/transformers`' bundled `onnxruntime-node`/`sharp` carry known transitive advisories (ZIP/image parsing libs) with no upstream fix yet. mem-port never feeds them untrusted input, but `npm audit` will flag them.
