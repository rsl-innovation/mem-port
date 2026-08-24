import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { resolveLibrary } from "../resolveLibrary.js";
import type { ServerDeps } from "../buildServer.js";
import { ADR_STATUSES } from "../../interfaces/adrs.interface.js";
import { formatAdrNumber } from "../format.js";
import { registerAppTool } from "@modelcontextprotocol/ext-apps/server";
import { appToolMeta } from "../apps.js";
import { captionOf, formatScore, formatTags, listResult } from "../view.js";

export function registerSearchAdrs(server: McpServer, deps: ServerDeps): void {
  registerAppTool(
    server,
    "search_adrs",
    {
      _meta: appToolMeta(),
      description:
        "Semantically search architectural decision records, ranked by relevance. Call this proactively before re-litigating a technical choice or proposing an approach in an area that may already have a decision on record — a superseded or deprecated ADR is itself useful context about what was already tried.",
      inputSchema: {
        query: z
          .string()
          .min(1)
          .describe(
            'A natural-language description of the problem or area you\'re considering — matched against each ADR\'s title, context, and decision, not keyword-matched. E.g. "how do we store embeddings?" matches an ADR about choosing a vector database even with no shared words.'
          ),
        status: z
          .enum(ADR_STATUSES)
          .optional()
          .describe('Restrict results to one lifecycle state, e.g. "accepted" for decisions currently in force. Omit to search all states.'),
        tags: z
          .array(z.string())
          .optional()
          .describe('Restrict results to ADRs having at least one of these tags, e.g. ["storage"]. Omit to search across all tags.'),
        limit: z.number().int().min(1).max(100).optional().describe("Maximum number of results to return. Defaults to 10."),
        min_score: z
          .number()
          .min(-1)
          .max(1)
          .optional()
          .describe(
            "Minimum cosine similarity to include, from -1 (unrelated) to 1 (identical meaning). Omit to return the top results regardless of score; set e.g. 0.3 to filter out weakly-related noise."
          ),
      },
    },
    async (args, extra) => {
      const store = await resolveLibrary(extra, deps.store);
      const queryVector = await deps.embeddings.embed(args.query);

      const rows = await store.adrs.search(queryVector, {
        status: args.status,
        tags: args.tags,
        limit: args.limit ?? 10,
      });

      const minScore = args.min_score;
      const results = rows
        .filter((row) => minScore === undefined || row.score >= minScore)
        .map((row) => ({
          id: row.id,
          number: row.number,
          adr: formatAdrNumber(row.number),
          title: row.title,
          context: row.context,
          decision: row.decision,
          consequences: row.consequences,
          status: row.status,
          tags: row.tags,
          score: row.score,
        }));

      return listResult(extra, results, {
        tool: "search_adrs",
        heading: `Decisions for "${args.query}" (${results.length})`,
        empty: "No decisions matched that query.",
        items: results.map((adr) => ({
          title: `${adr.adr} — ${adr.title}`,
          subtitle: adr.decision,
          meta: captionOf([formatScore(adr.score), adr.status, formatTags(adr.tags)]),
        })),
      });
    }
  );
}
