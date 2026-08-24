import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { resolveLibrary } from "../resolveLibrary.js";
import type { ServerDeps } from "../buildServer.js";
import { registerAppTool } from "@modelcontextprotocol/ext-apps/server";
import { appToolMeta } from "../apps.js";
import { captionOf, formatTags, listResult } from "../view.js";

export function registerListSkills(server: McpServer, deps: ServerDeps): void {
  registerAppTool(
    server,
    "list_skills",
    {
      _meta: appToolMeta(),
      description:
        "List saved skills, newest first, optionally filtered by tag or source. Returns each skill's description and metadata, NOT its procedure body — read the descriptions to find the one you want, then call get_skill for that skill's steps.",
      inputSchema: {
        tag: z.string().optional().describe('Only include skills with this tag, e.g. "testing".'),
        source: z.string().optional().describe('Only include skills recorded by this exact source, e.g. "claude-code".'),
        limit: z.number().int().min(1).max(200).optional().describe("Maximum number of skills to return, newest first. Defaults to 20."),
      },
    },
    async (args, extra) => {
      const store = await resolveLibrary(extra, deps.store);

      const results = await store.skills.list({
        status: "active",
        tag: args.tag,
        source: args.source,
        limit: args.limit ?? 20,
      });

      return listResult(extra, results, {
        tool: "list_skills",
        heading: `Skills (${results.length})`,
        empty: "No skills saved in this library yet.",
        items: results.map((skill) => ({
          title: skill.name,
          subtitle: skill.description,
          meta: captionOf([formatTags(skill.tags), skill.source]),
        })),
      });
    }
  );
}
