# Using mem-port proactively

mem-port's tools give your copilot the *capability* to save and recall memory — they don't by themselves make it use that capability. As of this version, the connected server already tells any MCP client to use `save_memory`/`search_memory` and `save_skill`/`search_skills` proactively (via the server's `instructions` and each tool's description), which should be enough on its own for most agents.

This guide is for going further: pasting into your copilot's own custom-instructions file (`CLAUDE.md`, `.cursorrules`, Windsurf's rules file, etc.) if you want more explicit, tunable control over *when* and *where* it writes memory — in particular, keeping personal, organizational, and project memory genuinely separate rather than mixed into one library.

## Set up separate scopes for each vertical

`library-id` is mem-port's isolation boundary — each one maps to a fully separate knowledge graph. To keep personal/org/project memory apart, register mem-port under a **different connection per vertical**, each with its own `library-id`, rather than one connection shared across all three:

```bash
claude mcp add --transport http mem-port-personal http://127.0.0.1:8787/mcp \
  --header "library-id: personal"

claude mcp add --transport http mem-port-team http://127.0.0.1:8787/mcp \
  --header "library-id: org-acme"

claude mcp add --transport http mem-port-project http://127.0.0.1:8787/mcp \
  --header "library-id: project-checkout-service"
```

All three point at the same daemon — they're just different namespaces within it. Your copilot will see each connection's tools separately (Claude Code namespaces them like `mcp__mem-port-personal__save_memory` vs `mcp__mem-port-project__save_memory`), so the instructions below tell it which one to reach for.

If you don't need that separation, one connection is fine — `memory_type` and `entity_type` alone give you some organization within a single library. The rest of this guide assumes the three-connection setup.

## Paste this into your copilot's custom instructions

```
When working with the user, proactively save and recall memory using the connected mem-port tools:

- mem-port-personal (personal memory): stable facts about the user as an individual, true
  across all their work — communication and collaboration preferences, tools they favor,
  working style, background/expertise. Not specific to one project or team.

- mem-port-team (organizational memory): facts and decisions that apply across a team or
  company — coding conventions, architectural standards, stakeholders, "how we do things
  here." Shared context, not private to this one user.

- mem-port-project (project memory): facts scoped to the current codebase — architecture
  decisions and their rationale, known gotchas, ongoing initiatives, why something
  non-obvious is the way it is.

When you learn something that fits one of these, call that connection's save_memory in the
same turn you learn it — don't wait to be asked. Link related people/projects/tools via
entity_refs so context stays connected.

When you work out a non-obvious, reusable procedure (not one-off task state, but something
worth doing the same way next time), call that connection's save_skill. Skills are visible
to every copilot connected to that same library-id, so a procedure learned in one tool is
available in another without any manual copying.

At the start of a task, call search_memory on whichever connection(s) are relevant before
assuming no prior context exists, and search_skills before assuming there's no existing
procedure for it.

Don't save: anything already derivable from reading the current code/files, one-off state
only relevant to this conversation, or anything the user has asked you not to keep.
```

## Tune it to your work

The three-vertical split is a starting point, not a fixed schema — nothing in mem-port enforces it. Adjust the categories, add more `library-id`s for other contexts (e.g. per-client if you consult), or collapse back to one if the separation isn't earning its keep.
