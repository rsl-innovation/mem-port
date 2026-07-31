# mem-port

A local MCP (Model Context Protocol) server for portable, long-term agentic memory — a thumb drive for your AI context.

Every AI copilot (Claude Code, Cursor, Windsurf, ...) keeps its own memory, siloed to that tool. mem-port runs as a single local daemon that any number of copilots can connect to, backed by an embedded knowledge graph (entities, episodes, memories, and the relations between them) that survives restarts and can be exported to a portable file and moved anywhere.

Unlike other memory-for-agents projects, mem-port needs **no external services** — no Postgres, no Qdrant, no Neo4j. It's one process, one embedded [SurrealDB](https://surrealdb.com) instance combining graph storage and vector search, and zero-config local semantic search (no API key required).

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

Easiest: use the CLI (`--header` accepts any number of `Key: Value` pairs):

```bash
claude mcp add --transport http mem-port http://127.0.0.1:8787/mcp \
  --header "library-id: my-personal-workspace"
```

Or add it directly to `.mcp.json` (project scope, shareable via version control) or `~/.claude.json` (user scope). The `type` field is required — an entry with a `url` but no `type` is treated as a misconfigured stdio server:

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

## Tools

| Tool | Purpose |
|---|---|
| `save_memory` | Save a fact/preference/decision/task/reference, optionally linked to entities |
| `search_memory` | Semantic (vector) search over memories |
| `save_episode` | Record a raw interaction/event that memories can be derived from |
| `list_episodes` | List recorded episodes, filterable by time range/source |
| `get_entity` | Look up an entity plus everything that mentions or relates to it |
| `relate_entities` | Create a graph relation between two entities |
| `forget_memory` | Soft-archive (default) or permanently delete a memory |
| `export_library` | Export this library to a portable `.memport.json` bundle |
| `import_library` | Import a `.memport.json` bundle, merging or overwriting |

## Porting memory between machines

Same-machine sharing across copilots needs no extra step — they just connect to the same daemon with the same `library-id`. `export_library`/`import_library` solve a different problem: moving to a new machine, backing up, versioning (the bundle is plain JSON — commit it to a private git repo if you like), or handing a curated slice of memory to someone else.

```bash
# on the old machine
mem-port export --library-id my-personal-workspace
# -> writes <data-dir>/exports/my-personal-workspace-<timestamp>.memport.json

# on the new machine, after copying the file over
mem-port import --library-id my-personal-workspace --in ./my-personal-workspace-....memport.json
```

`import` defaults to `--mode merge` (dedupes entities by name+type, memories/episodes by content hash — importing the same bundle twice is a no-op). Pass `--mode overwrite` to wipe the target library first, or `--dry-run` to see what would happen without writing anything.

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

## Known limitations (v1)

- Vector search is brute-force (no HNSW/DISKANN index yet) — fine at personal-memory-store scale, revisit if a library grows very large.
- `export_library`'s scope filtering supports `memory_types` and `since`; filtering by `entity_ids` isn't implemented yet.
- No authentication — the daemon binds to `127.0.0.1` only and trusts anything running locally on your machine.
- `@huggingface/transformers`' bundled `onnxruntime-node`/`sharp` carry known transitive advisories (ZIP/image parsing libs) with no upstream fix yet. mem-port never feeds them untrusted input, but `npm audit` will flag them.
