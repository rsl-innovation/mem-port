import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { Surreal } from "surrealdb";
import { resolveLibrary } from "../resolveLibrary.js";
import type { EmbeddingProvider } from "../../embeddings/provider.js";

const MEMORY_TYPES = ["fact", "preference", "decision", "task", "reference"] as const;

interface MemoryRow {
  id: unknown;
  content: string;
  memory_type: string;
  importance: number;
  score: number;
}

export function registerSearchMemory(server: McpServer, root: Surreal, embeddings: EmbeddingProvider): void {
  server.registerTool(
    "search_memory",
    {
      description:
        "Semantically search memories by meaning, ranked by relevance. Call this proactively at the start of a task that could be informed by prior context — before assuming none exists, not only when the user asks you to recall something.",
      inputSchema: {
        query: z.string().min(1),
        memory_types: z.array(z.enum(MEMORY_TYPES)).optional(),
        limit: z.number().int().min(1).max(100).optional(),
        min_score: z.number().min(-1).max(1).optional().describe("Cosine similarity threshold, e.g. 0.3"),
      },
    },
    async (args, extra) => {
      const session = await resolveLibrary(extra, root);
      const queryVector = await embeddings.embed(args.query);

      const typeFilter = args.memory_types && args.memory_types.length > 0 ? "AND memory_type IN $types" : "";

      // Brute-force cosine similarity: no vector index yet (see build-order phase 3 —
      // an HNSW/DISKANN index is added later once library sizes justify it).
      const [rows] = await session.query<[MemoryRow[]]>(
        `SELECT id, content, memory_type, importance, vector::similarity::cosine(embedding, $queryVector) AS score
         FROM memory
         WHERE status = 'active' AND embedding != NONE ${typeFilter}
         ORDER BY score DESC
         LIMIT $limit`,
        {
          queryVector,
          types: args.memory_types,
          limit: args.limit ?? 10,
        }
      );

      const minScore = args.min_score;
      const results = rows
        .filter((row) => minScore === undefined || row.score >= minScore)
        .map((row) => ({
          id: String(row.id),
          content: row.content,
          memory_type: row.memory_type,
          importance: row.importance,
          score: row.score,
        }));

      return {
        content: [{ type: "text" as const, text: JSON.stringify(results, null, 2) }],
      };
    }
  );
}
