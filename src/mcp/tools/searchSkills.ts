import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { Surreal } from "surrealdb";
import { resolveLibrary } from "../resolveLibrary.js";
import { registerAppTool } from "@modelcontextprotocol/ext-apps/server";
import { appToolMeta } from "../apps.js";
import { captionOf, formatScore, formatTags, listResult } from "../view.js";
import type { EmbeddingProvider } from "../../embeddings/provider.js";

interface SkillRow {
  id: unknown;
  name: string;
  description: string;
  tags: string[];
  source: string;
  score: number;
}

export function registerSearchSkills(server: McpServer, root: Surreal, embeddings: EmbeddingProvider): void {
  registerAppTool(
    server,
    "search_skills",
    {
      _meta: appToolMeta(),
      description:
        "Semantically search skills by the situation or task at hand, ranked by relevance. Call this proactively before starting a task that might already have a known procedure — before assuming you need to work it out from scratch. Returns each match's description and metadata, NOT its procedure body — pick the match you want from the descriptions, then call get_skill for that skill's steps.",
      inputSchema: {
        query: z
          .string()
          .min(1)
          .describe(
            "A natural-language description of the task or situation you're facing — matched against each skill's description (its trigger condition), not keyword-matched. E.g. \"CI test is flaky\" matches a skill described as \"Use when a test passes locally but fails intermittently in CI\" even with no shared words."
          ),
        tags: z
          .array(z.string())
          .optional()
          .describe('Restrict results to skills having at least one of these tags, e.g. ["testing"]. Omit to search across all tags.'),
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

      const tagFilter = args.tags && args.tags.length > 0 ? "AND tags CONTAINSANY $tags" : "";

      const [rows] = await session.query<[SkillRow[]]>(
        `SELECT id, name, description, tags, source, vector::similarity::cosine(embedding, $queryVector) AS score
         FROM skill
         WHERE status = 'active' AND embedding != NONE ${tagFilter}
         ORDER BY score DESC
         LIMIT $limit`,
        {
          queryVector,
          tags: args.tags,
          limit: args.limit ?? 10,
        }
      );

      const minScore = args.min_score;
      const results = rows
        .filter((row) => minScore === undefined || row.score >= minScore)
        .map((row) => ({
          id: String(row.id),
          name: row.name,
          description: row.description,
          tags: row.tags,
          source: row.source,
          score: row.score,
        }));

      return listResult(extra, results, {
        tool: "search_skills",
        heading: `Skills for "${args.query}" (${results.length})`,
        empty: "No skills matched that query.",
        items: results.map((skill) => ({
          title: skill.name,
          subtitle: skill.description,
          meta: captionOf([formatScore(skill.score), formatTags(skill.tags), skill.source]),
        })),
      });
    }
  );
}
