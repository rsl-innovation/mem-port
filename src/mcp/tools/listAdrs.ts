import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { resolveLibrary } from "../resolveLibrary.js";
import type { ServerDeps } from "../buildServer.js";
import { ADR_STATUSES } from "../../interfaces/adrs.interface.js";
import { formatAdrNumber } from "../format.js";
import { registerAppTool } from "@modelcontextprotocol/ext-apps/server";
import { appToolMeta } from "../apps.js";
import { captionOf, formatTags, formatWhen, listResult } from "../view.js";

export function registerListAdrs(server: McpServer, deps: ServerDeps): void {
  registerAppTool(
    server,
    "list_adrs",
    {
      _meta: appToolMeta(),
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
      const store = await resolveLibrary(extra, deps.store);

      const rows = await store.adrs.list({
        status: args.status,
        tag: args.tag,
        source: args.source,
        limit: args.limit ?? 20,
      });

      const results = rows.map((row) => ({
        id: row.id,
        number: row.number,
        adr: formatAdrNumber(row.number),
        title: row.title,
        decision: row.decision,
        status: row.status,
        tags: row.tags,
        source: row.source,
        supersedes: row.supersedes_id ?? null,
        decided_at: row.decided_at,
      }));

      return listResult(extra, results, {
        tool: "list_adrs",
        heading: `Decisions (${results.length})`,
        empty: "No decisions recorded in this library yet.",
        items: results.map((adr) => ({
          title: `${adr.adr} — ${adr.title}`,
          subtitle: adr.decision,
          meta: captionOf([adr.status, formatWhen(adr.decided_at), formatTags(adr.tags), adr.source]),
        })),
      });
    }
  );
}
