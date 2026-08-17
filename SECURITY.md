# Security Policy

## Supported versions

Only the latest published release receives security fixes.

| Version | Supported |
| ------- | --------- |
| 0.3.x   | Yes       |
| < 0.3   | No        |

mem-port is pre-1.0 and moves quickly. If you are running an older version,
upgrading to the latest release is the fix.

## Reporting a vulnerability

**Please do not report security vulnerabilities in public issues.**

Report privately through GitHub:

**[Report a vulnerability →](https://github.com/rsl-innovation/mem-port/security/advisories/new)**

(Also reachable from the repository's **Security** tab → **Report a
vulnerability**.) Only maintainers can see the report, and it gives us a private
space to work on a fix and coordinate disclosure with you.

### What to include

- The version affected — `mem-port --version`
- Your platform and Node version
- What an attacker can do, and what access they need to do it
- Steps to reproduce, ideally something we can run
- Anything you already know about a fix

### What to expect

- **Acknowledgement within 72 hours.** If you don't hear back, the report may
  have gone astray — please follow up.
- An assessment of severity and impact, shared with you.
- A fix released in a new version, with a GitHub Security Advisory published
  once users have had a reasonable chance to upgrade.
- Credit in the advisory, unless you'd rather stay anonymous.

We ask that you give us a reasonable window to ship a fix before disclosing
publicly. We'll keep you informed throughout rather than leaving you guessing.

## Threat model

Some context on what does and doesn't count as a vulnerability here.

**mem-port is a localhost daemon with no authentication, by design.** It binds
to `127.0.0.1` and trusts anything running locally on your machine. This is a
deliberate tradeoff for a personal memory store, and it is documented in the
README's **Known limitations**.

That means the following are **expected behavior**, not vulnerabilities:

- Any local process can reach the daemon and read or write memories. mem-port is
  not a security boundary between programs on your own computer.
- Memories are stored unencrypted at rest in the data directory. Protecting that
  directory is the operating system's job.
- Exported bundles contain your memories in readable form. Treat an export the
  way you would treat the data inside it.

The following **are** vulnerabilities and we want to hear about them:

- Anything that makes the daemon reachable from beyond `127.0.0.1`
- Cross-tenant leakage — one `library-id` reading, writing, or inferring another
  library's data. Tenancy isolation is a core guarantee and is covered by tests.
- Code execution triggered by importing a crafted bundle, or by any tool input
- Path traversal in export or import letting a caller read or write outside the
  data directory
- Anything that leaks memory contents into logs, error messages, or telemetry

## Known dependency advisories

`@huggingface/transformers` pulls in `onnxruntime-node` and `sharp`, which carry
known transitive advisories in ZIP and image parsing libraries with no upstream
fix available yet. `npm audit` will flag these.

mem-port never feeds untrusted input to those code paths — it uses the embedding
model only for text it has already accepted through its own tool interface. We
track these and will pick up fixes as they ship upstream. Reports that simply
restate `npm audit` output for these packages aren't likely to tell us something
new, but if you can show an actual exploit path through mem-port, that is very
much worth reporting.
