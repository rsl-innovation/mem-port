import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { resolveLibrary } from "../resolveLibrary.js";
import type { ServerDeps } from "../buildServer.js";
import { registerAppTool } from "@modelcontextprotocol/ext-apps/server";
import { appToolMeta } from "../apps.js";
import { captionOf, formatScore, listResult } from "../view.js";
import { MEMORY_TYPES } from "../../interfaces/memories.interface.js";

export function registerSearchMemory(server: McpServer, deps: ServerDeps): void {
  registerAppTool(
    server,
    "search_memory",
    {
      _meta: appToolMeta(),
      description:
        "Semantically search memories by meaning, ranked by relevance. Call this proactively at the start of a task that could be informed by prior context — before assuming none exists, not only when the user asks you to recall something.",
      inputSchema: {
        query: z
          .string()
          .min(1)
          .describe(
            "A natural-language description of what you're looking for — this is semantic (meaning-based) search, not keyword matching, so full phrases work better than bare keywords. E.g. \"what editor theme does the user prefer\" matches a memory saying \"User prefers dark mode\" even with no shared words."
          ),
        memory_types: z
          .array(z.enum(MEMORY_TYPES))
          .optional()
          .describe('Restrict results to these memory_type values only, e.g. ["preference", "decision"]. Omit to search across all types.'),
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

      const rows = await store.memories.search(queryVector, {
        memory_types: args.memory_types,
        status: "active",
        limit: args.limit ?? 10,
      });

      const minScore = args.min_score;
      const results = rows
        .filter((row) => minScore === undefined || row.score >= minScore)
        .map((row) => ({
          id: row.id,
          content: row.content,
          memory_type: row.memory_type,
          importance: row.importance,
          score: row.score,
        }));

      return listResult(extra, results, {
        tool: "search_memory",
        heading: `Memories for "${args.query}" (${results.length})`,
        empty: "No memories matched that query.",
        items: results.map((memory) => ({
          title: memory.content,
          meta: captionOf([memory.memory_type, `importance ${memory.importance}`, formatScore(memory.score)]),
        })),
      });
    }
  );
}
