import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { Surreal } from "surrealdb";
import { resolveLibrary } from "../resolveLibrary.js";
import { ADR_STATUSES, formatAdrNumber } from "../../db/adr.js";
import { a2uiList, captionOf, formatTags, formatWhen } from "../a2ui.js";

interface AdrRow {
  id: unknown;
  number: number;
  title: string;
  decision: string;
  status: string;
  tags: string[];
  source: string;
  supersedes: unknown | null;
  decided_at: unknown;
}

export function registerListAdrs(server: McpServer, root: Surreal): void {
  server.registerTool(
    "list_adrs",
    {
      description:
        "List the ADR log, newest decision first, optionally filtered by status, tag, or source. Use this to review what has already been decided in a project; use get_adr for the full context and consequences of one entry.",
      inputSchema: {
        status: z
          .enum(ADR_STATUSES)
          .optional()
          .describe('Only include ADRs in this lifecycle state, e.g. "accepted" for decisions currently in force. Omit to list all states.'),
        tag: z.string().optional().describe('Only include ADRs with this tag, e.g. "storage".'),
        source: z.string().optional().describe('Only include ADRs recorded by this exact source, e.g. "claude-code".'),
        limit: z
          .number()
          .int()
          .min(1)
          .max(200)
          .optional()
          .describe("Maximum number of ADRs to return, newest first. Defaults to 20."),
      },
    },
    async (args, extra) => {
      const session = await resolveLibrary(extra, root);

      const conditions: string[] = ["archived = false"];
      const bindings: Record<string, unknown> = { limit: args.limit ?? 20 };

      if (args.status) {
        conditions.push("status = $status");
        bindings.status = args.status;
      }
      if (args.tag) {
        conditions.push("tags CONTAINS $tag");
        bindings.tag = args.tag;
      }
      if (args.source) {
        conditions.push("source = $source");
        bindings.source = args.source;
      }

      const [rows] = await session.query<[AdrRow[]]>(
        `SELECT id, number, title, decision, status, tags, source, supersedes, decided_at FROM adr
         WHERE ${conditions.join(" AND ")}
         ORDER BY number DESC
         LIMIT $limit`,
        bindings
      );

      const results = rows.map((row) => ({
        id: String(row.id),
        number: row.number,
        adr: formatAdrNumber(row.number),
        title: row.title,
        decision: row.decision,
        status: row.status,
        tags: row.tags,
        source: row.source,
        supersedes: row.supersedes ? String(row.supersedes) : null,
        decided_at: row.decided_at,
      }));

      return {
        content: [
          { type: "text" as const, text: JSON.stringify(results, null, 2) },
          ...a2uiList(extra, {
            tool: "list_adrs",
            heading: `Decisions (${results.length})`,
            empty: "No decisions recorded in this library yet.",
            items: results.map((adr) => ({
              title: `${adr.adr} — ${adr.title}`,
              subtitle: adr.decision,
              meta: captionOf([adr.status, formatWhen(adr.decided_at), formatTags(adr.tags), adr.source]),
            })),
          }),
        ],
      };
    }
  );
}
