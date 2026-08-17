# Contributing to mem-port

Thanks for your interest in mem-port.

## Code contributions are not open right now

**mem-port is not accepting outside pull requests at this time.**

The project is in early, fast-moving development, and its architecture is still
settling. Reviewing and merging external code carries a maintenance commitment
we can't honour properly yet, and we would rather say so plainly than leave
pull requests sitting unanswered for months.

This is about our current capacity, not about the quality of your work. Please
don't take a closed PR personally.

Unsolicited pull requests will be closed with a link to this document. If you
have already opened one, thank you for the effort — and sorry for the outcome.

## What is welcome

Plenty, and all of it genuinely useful:

### Bug reports

Easily the most valuable thing you can send us. mem-port runs against a local
SurrealDB store and a local embedding model across macOS, Linux, and Windows,
with a wide range of MCP clients — we cannot possibly test every combination.
If it breaks on your setup, we want to know.

[Open a bug report →](https://github.com/rsl-innovation/mem-port/issues/new?template=bug_report.yml)

### Feature requests

Tell us what you're trying to do and what's in the way. We may not build it, and
we may not build it soon, but knowing what people actually need shapes the
roadmap.

[Open a feature request →](https://github.com/rsl-innovation/mem-port/issues/new?template=feature_request.yml)

### Questions and setup problems

If mem-port won't connect to your client, that is worth reporting — connection
problems are usually either a real bug or a documentation gap, and both are ours
to fix. See the **Gotchas** section of the [README](README.md) first; the most
common issue by far is trying to reach a localhost server from a browser-based
chat session, which cannot work.

### Security vulnerabilities

Do **not** open a public issue. See [SECURITY.md](SECURITY.md) for private
reporting.

## Writing a good bug report

The issue template asks for these, and they matter:

- **mem-port version** — `mem-port --version`
- **Node version** — `node --version` (mem-port requires Node >= 22)
- **Operating system**
- **MCP client** — Claude Code, Claude Desktop, Cursor, ChatGPT desktop, etc.
- **What you expected, and what happened instead**
- **Daemon output** — mem-port logs to stderr; that output is often the whole
  answer

A report that lets us reproduce the problem is worth ten that describe it.

## For maintainers

Development setup, the test suite, and the release process are documented in the
**Development** section of the [README](README.md). In short:

```bash
npm install
npm run dev        # daemon via tsx, no build step
npm test
npm run typecheck
```

Releases are automated — `npm version <bump>` then `git push --follow-tags`.
Never `npm publish` by hand.

## Code of Conduct

Participation in this project is governed by the
[Code of Conduct](CODE_OF_CONDUCT.md). That applies to issues and discussions
just as much as it would to pull requests.

## If this changes

We expect to open up contributions once the architecture stabilizes. When that
happens, this document will change and it will be announced in the release
notes. Watching the repo is the best way to hear about it.
