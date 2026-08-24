import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { resolveLibrary } from "../resolveLibrary.js";
import type { ServerDeps } from "../buildServer.js";
import { registerAppTool } from "@modelcontextprotocol/ext-apps/server";
import { appToolMeta } from "../apps.js";
import { captionOf, detailResult, formatAdrNumber, formatTags, formatWhen } from "../view.js";

export function registerGetAdr(server: McpServer, deps: ServerDeps): void {
  registerAppTool(
    server,
    "get_adr",
    {
      _meta: appToolMeta(),
      description:
        "Get one architectural decision record in full — context, decision, consequences, alternatives, the entities it concerns, and both ends of its supersede chain.",
      inputSchema: {
        number: z.number().int().optional().describe("The ADR's sequence number, e.g. 7 for ADR-0007. Provide this or 'id', not both."),
        id: z
          .string()
          .optional()
          .describe('Exact ADR record id, e.g. "adr:x9k2" (as returned by save_adr/search_adrs/list_adrs). Provide this or \'number\', not both.'),
      },
    },
    async (args, extra) => {
      if (args.number === undefined && !args.id) {
        return {
          content: [{ type: "text" as const, text: "Provide either 'number' or 'id'" }],
          isError: true,
        };
      }

      const store = await resolveLibrary(extra, deps.store);

      const adr = await store.adrs.getDetail(args.id ? { id: args.id } : { number: args.number! });
      if (!adr) {
        return {
          content: [{ type: "text" as const, text: "ADR not found" }],
          isError: true,
        };
      }

      const result = {
        id: adr.id,
        number: adr.number,
        adr: formatAdrNumber(adr.number),
        title: adr.title,
        context: adr.context,
        decision: adr.decision,
        consequences: adr.consequences,
        alternatives: adr.alternatives,
        status: adr.status,
        tags: adr.tags,
        source: adr.source,
        archived: adr.archived,
        decided_at: adr.decided_at,
        created_at: adr.created_at,
        updated_at: adr.updated_at,
        supersedes: adr.supersedes
          ? {
              id: adr.supersedes.id,
              number: adr.supersedes.number,
              adr: formatAdrNumber(adr.supersedes.number),
              title: adr.supersedes.title,
            }
          : null,
        superseded_by: adr.superseded_by.map((row) => ({
          id: row.id,
          number: row.number,
          adr: formatAdrNumber(row.number),
          title: row.title,
        })),
        mentioned_entities: adr.mentioned_entities,
      };

      return detailResult(extra, result, {
        tool: "get_adr",
        key: String(result.number),
        title: `${result.adr} — ${result.title}`,
        subtitle: captionOf([result.status, formatWhen(result.decided_at), formatTags(result.tags)]),
        sections: [
          { label: "Context", value: result.context },
          { label: "Decision", value: result.decision },
          { label: "Consequences", value: result.consequences },
          { label: "Alternatives", value: result.alternatives },
          { label: "Supersedes", value: result.supersedes ? `${result.supersedes.adr} — ${result.supersedes.title}` : null },
          {
            label: "Superseded by",
            value: result.superseded_by.map((a) => `${a.adr} — ${a.title}`).join("\n"),
          },
          { label: "Concerns", value: result.mentioned_entities.map((e) => e.name).join(", ") },
        ],
      });
    }
  );
}
