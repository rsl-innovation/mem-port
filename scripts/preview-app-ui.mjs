#!/usr/bin/env node
/**
 * Render the MCP App UI to PNGs so it can be looked at without a live host.
 *
 * The panel normally only exists inside a host's iframe, driven by a tool
 * result over postMessage — which makes states like "16 results, second batch
 * revealed" or "dark theme, long query" impossible to inspect while building
 * them. This bundles the pure renderer with fixture data, drops it into the
 * real app.html, and screenshots it in Chrome at both themes.
 *
 *   node scripts/preview-app-ui.mjs [--out <dir>] [--width <px>]
 *
 * Development only; nothing here ships.
 */
import { build } from "esbuild";
import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const run = promisify(execFile);
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const uiDir = path.join(repoRoot, "src", "mcp", "ui");

const argv = process.argv.slice(2);
const arg = (name, fallback) => {
  const i = argv.indexOf(`--${name}`);
  return i === -1 ? fallback : argv[i + 1];
};

const outDir = path.resolve(arg("out", path.join(os.tmpdir(), "mem-port-preview")));
const width = Number(arg("width", 720));

const CHROME = [
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  "/Applications/Chromium.app/Contents/MacOS/Chromium",
];

async function chrome() {
  for (const bin of CHROME) {
    try {
      await fs.access(bin);
      return bin;
    } catch {
      /* try the next */
    }
  }
  throw new Error(`No Chrome found. Looked in:\n  ${CHROME.join("\n  ")}`);
}

// Fixtures deliberately use real shapes: a query long enough to wrap the
// heading, titles that run past one line, and enough results to page.
const FIXTURES = {
  "search-adrs": {
    kind: "list",
    tool: "search_adrs",
    heading:
      'Decisions for "web design decisions for website builds - typography, palette, motion, stack, design system" (16)',
    empty: "No decisions recorded yet.",
    items: [
      {
        title: "ADR-0014 — Serve A2UI surfaces from mem-port's read tools, on by default, as a second content block beside the unchanged text block",
        subtitle:
          "Every read tool appends an A2UI v1.0 EmbeddedResource AFTER its existing text block. The text block is unchanged and stays at index 0 — non-rendering clients see byte-identical behaviour, and the CLI/tests that read content[0].text keep working.",
        meta: "score 0.106 · accepted · mem-port, a2ui, mcp, protocol, ui, tools",
      },
      {
        title: "ADR-0005 — Build promotion eligibility as a new POC with HermiT central, rather than retrofitting a reasoner into retail-redistribution-poc",
        subtitle:
          "Start a NEW project for promotion eligibility and conflict detection, designed so the class hierarchy is an OUTPUT (defined classes) rather than an input, with HermiT doing real classification work.",
        meta: "score 0.088 · accepted · ontology, owl, reasoner, hermit, poc, agents, retail, handoff",
      },
      {
        title: "ADR-0003 — Include the context field in the ADR search embedding",
        subtitle:
          "Embed the concatenation of title, context, and decision for every ADR. Deliberately exclude consequences and alternatives.",
        meta: "score 0.068 · accepted · search, embeddings, adr, mem-port",
      },
      {
        title: "ADR-0006 — Model a promotion as a defined OWL class of qualifying baskets, not as an individual with properties",
        subtitle:
          "A promotion IS an owl:Class whose members are exactly the baskets that qualify for it, written with owl:equivalentClass plus restrictions. Not an individual.",
        meta: "score 0.061 · accepted · ontology, owl, hermit, poc, modelling",
      },
      {
        title: "ADR-0012 — Tag-triggered GitHub Actions releases with npm OIDC trusted publishing",
        subtitle:
          "Releases are cut by `npm version <bump>` + `git push --follow-tags`. A release.yml workflow triggers on v* tags.",
        meta: "score 0.054 · accepted · mem-port, release, ci, infra, npm",
      },
      {
        title: "ADR-0010 — Keep validity windows out of the reasoner as annotation properties",
        subtitle: "validFrom / validUntil are owl:AnnotationProperty values, so HermiT carries the triples and concludes nothing from them.",
        meta: "score 0.041 · accepted · ontology, temporal, modelling",
      },
      {
        title: "ADR-0002 — Renumber ADRs on import instead of preserving bundle numbers",
        subtitle: "Discard bundle numbers on import and assign fresh ones continuing the target library's sequence.",
        meta: "score 0.033 · accepted · port, import-export, adr, mem-port",
      },
    ],
  },
  "list-skills": {
    kind: "list",
    tool: "list_skills",
    heading: "Skills (3)",
    empty: "No skills saved in this library yet.",
    items: [
      {
        title: "serve-an-mcp-app-ui-from-an-mcp-server",
        subtitle:
          "Use when an MCP server's tool results should render as real UI in Claude, ChatGPT, Copilot or Cursor instead of showing the user raw JSON.",
        meta: "mcp, mcp-apps, ui, csp, bundling · claude-code",
      },
      {
        title: "rotate-api-keys",
        subtitle: "Use when a credential has leaked into a public repo",
        meta: "security, ops · claude-code",
      },
      {
        title: "debug-flaky-test",
        subtitle: "Use when a test passes locally but fails intermittently in CI",
        meta: "testing, ci · cursor",
      },
    ],
  },
  empty: {
    kind: "list",
    tool: "search_skills",
    heading: 'Skills for "deploying to kubernetes" (0)',
    empty: "No skills matched. Save one with save_skill once you work the procedure out.",
    items: [],
  },
  "get-skill": {
    kind: "detail",
    tool: "get_skill",
    key: "rotate-api-keys",
    title: "rotate-api-keys",
    subtitle: "Use when a credential has leaked into a public repo",
    sections: [
      {
        label: "Procedure",
        value:
          "1. Revoke the key at the provider immediately — before anything else.\n2. Issue a replacement and roll it out.\n3. Rotate anything derived from it (session tokens, signed URLs).\n4. Force-pushing the commit away is NOT enough. Assume every key that ever reached a public remote is compromised, including in deleted branches and in forks you do not control.\n5. Check provider access logs for use between leak and revocation.\n6. Record the incident with save_episode so the next person sees the timeline.",
      },
      { label: "Tags", value: "security, ops" },
      { label: "Mentions", value: "billing-service" },
      { label: "Recorded", value: "claude-code · active · 2026-08-21" },
    ],
  },
};

const entry = `
import { renderList, renderDetail } from ${JSON.stringify(path.join(uiDir, "render.ts"))};
const FIXTURES = ${JSON.stringify(FIXTURES)};
const view = FIXTURES[new URLSearchParams(location.search).get("v") ?? "search-adrs"];
const root = document.getElementById("root");
root.replaceChildren(view.kind === "list" ? renderList(view) : renderDetail(view));
if (location.search.includes("expand")) {
  // Reveal every batch, to check the fully-expanded state and final tally.
  let button;
  while ((button = root.querySelector("button.more"))) button.click();
}
`;

const entryFile = path.join(os.tmpdir(), `mem-port-preview-entry-${process.pid}.ts`);
await fs.writeFile(entryFile, entry);

const bundled = await build({
  entryPoints: [entryFile],
  bundle: true,
  format: "iife",
  target: "es2022",
  platform: "browser",
  write: false,
  logLevel: "warning",
});
await fs.rm(entryFile, { force: true });

const script = bundled.outputFiles[0].text.replace(/<\/script/gi, "<\\/script");
const shell = await fs.readFile(path.join(uiDir, "app.html"), "utf-8");

await fs.mkdir(outDir, { recursive: true });
const bin = await chrome();
const shots = [];

for (const name of Object.keys(FIXTURES)) {
  for (const theme of ["light", "dark"]) {
    for (const expand of name === "search-adrs" ? [false, true] : [false]) {
      const label = `${name}-${theme}${expand ? "-expanded" : ""}`;
      const query = `?v=${name}${expand ? "&expand=1" : ""}`;

      let page = shell.replace(
        "</body>",
        () => `  <script type="module">${script}</script>\n  </body>`
      );
      // The host sets data-theme; stand in for it, and paint the surface the
      // host would paint behind the transparent body.
      page = page.replace("<html lang=\"en\">", `<html lang="en" data-theme="${theme}">`);
      page = page.replace(
        "</head>",
        `<style>body{background:${theme === "dark" ? "#262624" : "#ffffff"};padding:16px}</style></head>`
      );

      const file = path.join(outDir, `${label}.html`);
      await fs.writeFile(file, page);

      await run(bin, [
        "--headless=new",
        "--disable-gpu",
        "--hide-scrollbars",
        "--force-device-scale-factor=2",
        `--window-size=${width},2400`,
        `--screenshot=${path.join(outDir, `${label}.png`)}`,
        `--virtual-time-budget=1200`,
        `file://${file}${query}`,
      ]);
      shots.push(`${label}.png`);
    }
  }
}

console.error(`${shots.length} screenshots in ${outDir}`);
