import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { resolveLibrary } from "../resolveLibrary.js";
import type { ServerDeps } from "../buildServer.js";
import { registerAppTool } from "@modelcontextprotocol/ext-apps/server";
import { appToolMeta } from "../apps.js";
import { captionOf, formatWhen, listResult } from "../view.js";

export function registerListEpisodes(server: McpServer, deps: ServerDeps): void {
  registerAppTool(
    server,
    "list_episodes",
    {
      _meta: appToolMeta(),
      description: "List recorded episodes, newest first, optionally filtered by source or time range.",
      inputSchema: {
        since: z
          .string()
          .datetime()
          .optional()
          .describe('ISO 8601 timestamp — only include episodes that occurred at or after this time, e.g. "2026-07-01T00:00:00Z".'),
        until: z.string().datetime().optional().describe("ISO 8601 timestamp — only include episodes that occurred at or before this time."),
        source: z.string().optional().describe('Only include episodes recorded by this exact source, e.g. "claude-code".'),
        limit: z.number().int().min(1).max(200).optional().describe("Maximum number of episodes to return, newest first. Defaults to 20."),
      },
    },
    async (args, extra) => {
      const store = await resolveLibrary(extra, deps.store);

      const results = await store.episodes.list({
        since: args.since,
        until: args.until,
        source: args.source,
        limit: args.limit ?? 20,
      });

      return listResult(extra, results, {
        tool: "list_episodes",
        heading: `Episodes (${results.length})`,
        empty: "No episodes recorded in this library yet.",
        items: results.map((episode) => ({
          title: episode.title,
          subtitle: episode.content,
          meta: captionOf([formatWhen(episode.occurred_at), episode.source]),
        })),
      });
    }
  );
}
