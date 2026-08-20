import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { DateTime, type Surreal } from "surrealdb";
import { resolveLibrary } from "../resolveLibrary.js";
import { a2uiList, captionOf, formatWhen } from "../a2ui.js";

interface EpisodeRow {
  id: unknown;
  title: string;
  content: string;
  source: string;
  occurred_at: unknown;
}

export function registerListEpisodes(server: McpServer, root: Surreal): void {
  server.registerTool(
    "list_episodes",
    {
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
      const session = await resolveLibrary(extra, root);

      const conditions: string[] = [];
      const bindings: Record<string, unknown> = { limit: args.limit ?? 20 };

      if (args.since) {
        conditions.push("occurred_at >= $since");
        bindings.since = new DateTime(args.since);
      }
      if (args.until) {
        conditions.push("occurred_at <= $until");
        bindings.until = new DateTime(args.until);
      }
      if (args.source) {
        conditions.push("source = $source");
        bindings.source = args.source;
      }

      const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";

      const [rows] = await session.query<[EpisodeRow[]]>(
        `SELECT id, title, content, source, occurred_at FROM episode
         ${whereClause}
         ORDER BY occurred_at DESC
         LIMIT $limit`,
        bindings
      );

      const results = rows.map((row) => ({
        id: String(row.id),
        title: row.title,
        content: row.content,
        source: row.source,
        occurred_at: row.occurred_at,
      }));

      return {
        content: [
          { type: "text" as const, text: JSON.stringify(results, null, 2) },
          ...a2uiList(extra, {
            tool: "list_episodes",
            heading: `Episodes (${results.length})`,
            empty: "No episodes recorded in this library yet.",
            items: results.map((episode) => ({
              title: episode.title,
              subtitle: episode.content,
              meta: captionOf([formatWhen(episode.occurred_at), episode.source]),
            })),
          }),
        ],
      };
    }
  );
}
