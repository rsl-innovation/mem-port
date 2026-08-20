import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StringRecordId, type Surreal } from "surrealdb";
import { resolveLibrary } from "../resolveLibrary.js";
import { formatAdrNumber } from "../../db/adr.js";
import { a2uiDetail, captionOf, formatTags, formatWhen } from "../a2ui.js";

interface AdrRow {
  id: unknown;
  number: number;
  title: string;
  context: string;
  decision: string;
  consequences: string | null;
  alternatives: string | null;
  status: string;
  supersedes: unknown | null;
  tags: string[];
  source: string;
  archived: boolean;
  decided_at: unknown;
  created_at: unknown;
  updated_at: unknown;
  mentioned_entities: Array<{ id: unknown; name: string }>;
}

interface AdrLinkRow {
  id: unknown;
  number: number;
  title: string;
  status?: string;
}

export function registerGetAdr(server: McpServer, root: Surreal): void {
  server.registerTool(
    "get_adr",
    {
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

      const session = await resolveLibrary(extra, root);

      const target = args.id ? `[<record<adr>> $id]` : `(SELECT VALUE id FROM adr WHERE number = $number LIMIT 1)`;

      const [rows] = await session.query<[AdrRow[]]>(
        `SELECT *, ->mentions->entity.{id, name} AS mentioned_entities FROM ${target}`,
        args.id ? { id: new StringRecordId(args.id) } : { number: args.number }
      );

      const adr = rows[0];
      if (!adr) {
        return {
          content: [{ type: "text" as const, text: "ADR not found" }],
          isError: true,
        };
      }

      let supersedes: AdrLinkRow | null = null;
      if (adr.supersedes) {
        const [linked] = await session.query<[AdrLinkRow[]]>(`SELECT id, number, title, status FROM $id`, {
          id: adr.supersedes,
        });
        supersedes = linked[0] ?? null;
      }

      const [supersededBy] = await session.query<[AdrLinkRow[]]>(
        `SELECT id, number, title FROM adr WHERE supersedes = $id`,
        { id: adr.id }
      );

      const result = {
        id: String(adr.id),
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
        supersedes: supersedes
          ? { id: String(supersedes.id), number: supersedes.number, adr: formatAdrNumber(supersedes.number), title: supersedes.title }
          : null,
        superseded_by: supersededBy.map((row) => ({
          id: String(row.id),
          number: row.number,
          adr: formatAdrNumber(row.number),
          title: row.title,
        })),
        mentioned_entities: adr.mentioned_entities.map((e) => ({ id: String(e.id), name: e.name })),
      };

      return {
        content: [
          { type: "text" as const, text: JSON.stringify(result, null, 2) },
          ...a2uiDetail(extra, {
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
          }),
        ],
      };
    }
  );
}
