import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { Surreal } from "surrealdb";
import { resolveLibrary } from "../resolveLibrary.js";
import { ADR_STATUSES, formatAdrNumber } from "../../db/adr.js";
import { a2uiList, captionOf, formatScore, formatTags } from "../a2ui.js";
import type { EmbeddingProvider } from "../../embeddings/provider.js";

interface AdrRow {
  id: unknown;
  number: number;
  title: string;
  context: string;
  decision: string;
  consequences: string | null;
  status: string;
  tags: string[];
  score: number;
}

export function registerSearchAdrs(server: McpServer, root: Surreal, embeddings: EmbeddingProvider): void {
  server.registerTool(
    "search_adrs",
    {
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
      const session = await resolveLibrary(extra, root);
      const queryVector = await embeddings.embed(args.query);

      const statusFilter = args.status ? "AND status = $status" : "";
      const tagFilter = args.tags && args.tags.length > 0 ? "AND tags CONTAINSANY $tags" : "";

      const [rows] = await session.query<[AdrRow[]]>(
        `SELECT id, number, title, context, decision, consequences, status, tags,
                vector::similarity::cosine(embedding, $queryVector) AS score
         FROM adr
         WHERE archived = false AND embedding != NONE ${statusFilter} ${tagFilter}
         ORDER BY score DESC
         LIMIT $limit`,
        {
          queryVector,
          status: args.status,
          tags: args.tags,
          limit: args.limit ?? 10,
        }
      );

      const minScore = args.min_score;
      const results = rows
        .filter((row) => minScore === undefined || row.score >= minScore)
        .map((row) => ({
          id: String(row.id),
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

      return {
        content: [
          { type: "text" as const, text: JSON.stringify(results, null, 2) },
          ...a2uiList(extra, {
            tool: "search_adrs",
            heading: `Decisions for "${args.query}" (${results.length})`,
            empty: "No decisions matched that query.",
            items: results.map((adr) => ({
              title: `${adr.adr} — ${adr.title}`,
              subtitle: adr.decision,
              meta: captionOf([formatScore(adr.score), adr.status, formatTags(adr.tags)]),
            })),
          }),
        ],
      };
    }
  );
}
