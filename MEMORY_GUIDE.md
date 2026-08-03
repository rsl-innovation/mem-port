# Using mem-port proactively

mem-port's tools give your copilot the *capability* to save and recall memory — they don't by themselves make it use that capability well. As of this version, the connected server already tells any MCP client to use `save_memory`/`search_memory`, `save_skill`/`search_skills`, and `save_adr`/`search_adrs` proactively (via the server's `instructions` and each tool's description), which is enough to get *some* proactive use out of most agents.

This guide is for going further: pasting into your copilot's own custom-instructions file (`CLAUDE.md`, `.cursorrules`, Windsurf's rules file, etc.) if you want more explicit, tunable control over *what* it saves, *when*, and *where* — in particular, keeping personal, organizational, and project memory genuinely separate rather than mixed into one library, and avoiding the two failure modes that show up once a library has been in use for a while: **duplicate memories** (the same fact saved slightly differently each session) and **noise** (task-local trivia that never gets recalled and just dilutes search results).

See [README.md](./README.md) for how to install mem-port and connect a client in the first place — this guide assumes you already have at least one working connection.

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

If you don't need that separation, one connection is fine — `memory_type` and `entity_type` alone give you some organization within a single library. The rest of this guide assumes the three-connection setup; if you're on one connection, just drop the `mem-port-*` prefixes below and reason about which `memory_type`/`entity_refs` to use instead.

## Choosing a memory_type

Every `save_memory` call takes a `memory_type`. Picking the right one is what makes `search_memory`'s `memory_types` filter (and a future reader skimming raw records) useful instead of a flat pile of text. Use this as the decision order — check `task` and `decision` first, since they're the easiest to misclassify as plain `fact`:

| Type | Use when the memory is... | Example |
|---|---|---|
| `task` | Outstanding or ongoing work — something not yet finished | "Migrating checkout-service off the legacy queue; blocked on the payments team's schema sign-off, expected 2026-08-15." |
| `decision` | A choice that was made, plus the reasoning — not just the outcome | "Chose SurrealDB over Postgres+Qdrant because it combines graph and vector storage in one embedded process, avoiding a second service to run locally." |
| `preference` | How the user likes something done, independent of any one task | "User wants commit messages under 70 characters, body explains why not what." |
| `reference` | A pointer to where the real information lives, not the information itself | "Bugs for checkout-service are tracked in Linear project CHK, not GitHub Issues." |
| `fact` | Objective, durable info that doesn't fit the above — the default/fallback | "checkout-service's staging environment shares a database with the payments-service staging environment." |

If a memory could plausibly be two types (e.g. a decision that's also somewhat a preference), pick the one that answers "why would I search for this?" — you'll search for a `decision` when asking "why is it built this way," and for a `preference` when asking "how does the user want this done."

**`decision` vs. an ADR:** if the choice was between real alternatives and the rejected options matter — a library, a data model, a protocol, a tradeoff you'll be asked to revisit — use `save_adr` instead. It keeps the problem framing, the alternatives that lost, a lifecycle status, and a supersede link to whatever replaces it later; a `decision` memory keeps only the outcome and its rationale. Reach for `memory_type: "decision"` for smaller, local choices that don't warrant an entry in the project's decision log.

## What actually belongs in memory

Save something the moment you learn it if, and only if, it would still be true and still be useful in a conversation that starts from zero context. A good test: could someone reconstruct this by reading the current code/files/git history in under a minute? If yes, don't save it — point at it instead (or don't save it at all).

**Save:**
- A decision and its rationale, especially when the rationale isn't obvious from the code itself (e.g. "we use polling here, not webhooks, because the client's firewall blocks inbound connections").
- A preference the user stated or clearly demonstrated by correcting you, and confirmations of an unusual choice that worked (accepting something without pushback is a signal too, not just corrections).
- An outstanding task, its blockers, and any deadline — convert relative dates ("by Thursday") to absolute ones before saving, since "Thursday" stops meaning anything once time has passed.
- A pointer to an external system (issue tracker, dashboard, doc) that you'd otherwise have to ask the user to repeat every session.
- A durable fact about the user's role, expertise, or the project's constraints that changes how you should explain things or what tradeoffs you should default to.

**Don't save:**
- Anything derivable by reading the current code, config, or file structure — architecture, conventions, file paths. Code drifts out of sync with a memory the moment either one changes; the code is authoritative.
- Git history, who-changed-what, commit contents — `git log`/`git blame` already answer this and stay correct as history grows.
- A bug's fix or root cause — the fix lives in the diff, the reasoning belongs in the commit message. A memory saying "bug X was caused by Y" goes stale the instant the code changes again.
- One-off state scoped to the current conversation only ("user is currently looking at file Z") — this has no value once the session ends.
- Anything the user has asked you not to keep, even if it would otherwise qualify.

When in doubt, ask: "if I forgot everything about this conversation and only had this one sentence, would it change what I do next time?" If not, it's noise.

## Avoid duplicates: search before you save

`search_memory` is cheap; a library full of five near-duplicate versions of the same fact is not. Before saving a `fact`, `preference`, or `decision` that might already exist (anything about a recurring topic — the user's stack, their preferences, a standing project decision), search first:

```
search_memory("does the user have a stated preference about X") on the relevant connection
```

- If nothing relevant comes back, save normally.
- If a close match comes back but is now outdated or incomplete, prefer `forget_memory` on the stale one and save a fresh one over letting both sit side by side — two contradicting memories are worse than one correct one.
- If the match is still accurate, don't re-save it just because you re-derived it this session — that's exactly the duplication this step exists to prevent.

## Use entities, skills, and the ADR log to keep things connected

`entity_refs` on `save_memory` (and the two-argument `relate_entities`) turn a flat list of memories into a graph. Tag every person, project, or tool a memory is meaningfully *about* — not incidentally mentioned. `get_entity` on a name then returns every memory, episode, and related entity for it, which is what makes "tell me everything relevant to checkout-service" answerable in one call instead of a broad search.

Skills (`save_skill`/`search_skills`/`list_skills`/`get_skill`) are for *procedures*, not facts — "how to run the flaky-test triage for this repo," "the release steps for checkout-service," something you'd want done the same way next time rather than just remembered. A skill saved from one copilot is immediately visible to every other copilot connected to the same `library-id` — that's the mechanism, not something you need to engineer. Give a skill a `description` that states the trigger condition (*when* to reach for it), since that's what `search_skills` matches against, not just what it does.

ADRs (`save_adr`/`search_adrs`/`list_adrs`/`get_adr`) are for *decisions* — the architectural choices you'd otherwise re-argue from scratch in six months. Write the `context` as the problem and the forces in play, not a restatement of the decision: that's the field `search_adrs` leans on, and people search by the problem ("why aren't we using Postgres?") rather than by the answer. Record the `alternatives` and why each lost, since that's the part a plain memory throws away and the part that settles the argument when someone proposes a rejected option again. When a later decision reverses an earlier one, pass `supersedes` rather than saving a contradicting record — the older ADR is marked `superseded` and the two stay linked, so the log reads as a history instead of a pile.

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

For a consequential technical choice — a library, a data model, a protocol, an accepted
tradeoff — call save_adr instead of save_memory. Write context as the problem and the forces
that made the decision necessary, and record the alternatives that lost and why. When a later
decision reverses an earlier one, pass supersedes so the older ADR is linked and marked
superseded, rather than saving a record that contradicts it. Use memory_type "decision" only
for smaller local choices that don't belong in the project's decision log.

Pick memory_type deliberately, don't default everything to "fact":
  - task: outstanding/ongoing work, with blockers and absolute (not relative) dates.
  - decision: a choice that was made, plus why — not just the outcome.
  - preference: how the user likes something done, stated or demonstrated by correction.
  - reference: a pointer to where real information lives (tracker, dashboard, doc).
  - fact: objective durable info that doesn't fit the above.

Before saving a fact/preference/decision that might already exist, call search_memory on the
relevant connection first. If a stale near-duplicate turns up, forget_memory it and save the
corrected version rather than letting both stand. Don't re-save something search already
confirms is accurate.

When you learn something that fits one of these, call that connection's save_memory in the
same turn you learn it — don't wait to be asked. Tag entity_refs for every person/project/tool
the memory is meaningfully about (not just mentioned in passing), so get_entity can surface it
later from one lookup.

When you work out a non-obvious, reusable procedure (not one-off task state, but something
worth doing the same way next time), call that connection's save_skill, with a description
that states *when* to reach for it. Skills are visible to every copilot connected to that same
library-id, so a procedure learned in one tool is available in another without any manual
copying.

At the start of a task, call search_memory on whichever connection(s) are relevant before
assuming no prior context exists, search_skills before assuming there's no existing procedure
for it, and search_adrs before proposing an approach in an area that may already have a
decision on record — a superseded ADR still tells you what was tried and why it was dropped.

Don't save: anything derivable by reading the current code/files (architecture, conventions,
file paths — these drift out of sync with a memory the instant either changes), git history
or who-changed-what (git log/blame is authoritative), a bug's root cause or fix (the fix is in
the diff), one-off state only relevant to this conversation, or anything the user has asked
you not to keep.
```

## Where to paste it, per client

- **Claude Code**: `CLAUDE.md` at the repo root (project-scoped) or `~/.claude/CLAUDE.md` (applies to every project). Project-scoped is usually right for the `mem-port-project` guidance; put the personal/team paragraphs in the user-level file instead so they're not tied to one repo.
- **Cursor**: `.cursorrules` at the repo root, or Cursor Settings → Rules for a user-level rule that applies across projects.
- **Windsurf**: its rules file (`.windsurfrules` at the repo root, or the global rules panel in settings for a user-level rule).
- **Other MCP clients**: whatever the client calls its system-prompt/custom-instructions surface — the block above is plain text and doesn't depend on any Claude Code–specific syntax, so it pastes in unchanged.

## Tune it to your work

The three-vertical split is a starting point, not a fixed schema — nothing in mem-port enforces it. Adjust the categories, add more `library-id`s for other contexts (e.g. per-client if you consult), or collapse back to one if the separation isn't earning its keep.
