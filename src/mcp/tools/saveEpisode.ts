import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { DateTime, type Surreal } from "surrealdb";
import { resolveLibrary } from "../resolveLibrary.js";
import { createMentionEdges, resolveEntityRefs } from "../../db/entities.js";
import type { EmbeddingProvider } from "../../embeddings/provider.js";

export function registerSaveEpisode(server: McpServer, root: Surreal, embeddings: EmbeddingProvider): void {
  server.registerTool(
    "save_episode",
    {
      description: "Record a raw episode (an interaction/event) — the source material memories get derived from.",
      inputSchema: {
        title: z.string().min(1),
        content: z.string().min(1),
        source: z.string().min(1).describe("Which copilot/agent recorded this, e.g. 'claude-code'"),
        occurred_at: z.string().datetime().optional(),
        entity_refs: z.array(z.string()).optional(),
      },
    },
    async (args, extra) => {
      const session = await resolveLibrary(extra, root);
      const embedding = await embeddings.embed(`${args.title}\n${args.content}`);

      const [created] = await session.query<[Array<{ id: unknown }>]>(
        `CREATE episode CONTENT {
           title: $title,
           content: $content,
           source: $source,
           occurred_at: $occurred_at,
           embedding: $embedding
         }`,
        {
          title: args.title,
          content: args.content,
          source: args.source,
          occurred_at: args.occurred_at ? new DateTime(args.occurred_at) : undefined,
          embedding,
        }
      );

      const record = created[0];

      const entityIds = await resolveEntityRefs(session, args.entity_refs);
      await createMentionEdges(session, record.id, entityIds);

      return {
        content: [{ type: "text" as const, text: `Saved episode ${String(record.id)}` }],
      };
    }
  );
}
