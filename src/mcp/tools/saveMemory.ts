import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StringRecordId, type Surreal } from "surrealdb";
import { resolveLibrary } from "../resolveLibrary.js";
import { createMentionEdges, resolveEntityRefs } from "../../db/entities.js";
import type { EmbeddingProvider } from "../../embeddings/provider.js";

const MEMORY_TYPES = ["fact", "preference", "decision", "task", "reference"] as const;

export function registerSaveMemory(server: McpServer, root: Surreal, embeddings: EmbeddingProvider): void {
  server.registerTool(
    "save_memory",
    {
      description: "Save a new memory to the library for later recall.",
      inputSchema: {
        content: z.string().min(1).describe("The memory content to save"),
        memory_type: z.enum(MEMORY_TYPES).optional().describe("Defaults to 'fact'"),
        importance: z.number().min(0).max(1).optional().describe("0-1, defaults to 0.5"),
        entity_refs: z.array(z.string()).optional().describe("Entity names this memory mentions; created if new"),
        source_episode_id: z.string().optional().describe("Record id of the episode this memory was derived from"),
      },
    },
    async (args, extra) => {
      const session = await resolveLibrary(extra, root);
      const embedding = await embeddings.embed(args.content);

      const [created] = await session.query<[Array<{ id: unknown }>]>(
        `CREATE memory CONTENT {
           content: $content,
           memory_type: $memory_type,
           importance: $importance,
           embedding: $embedding,
           source_episode: $source_episode
         }`,
        {
          content: args.content,
          memory_type: args.memory_type ?? "fact",
          importance: args.importance ?? 0.5,
          embedding,
          source_episode: args.source_episode_id ? new StringRecordId(args.source_episode_id) : undefined,
        }
      );

      const record = created[0];

      const entityIds = await resolveEntityRefs(session, args.entity_refs);
      await createMentionEdges(session, record.id, entityIds);

      return {
        content: [{ type: "text" as const, text: `Saved memory ${String(record.id)}` }],
      };
    }
  );
}
