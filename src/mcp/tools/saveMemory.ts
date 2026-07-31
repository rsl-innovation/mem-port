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
      description:
        "Save a durable memory (fact/preference/decision/task/reference) for later recall. Call this proactively whenever you learn something worth remembering about the user or their work — do not wait for an explicit 'remember this' request.",
      inputSchema: {
        content: z
          .string()
          .min(1)
          .describe(
            "The memory content, as a self-contained statement — it will be read later without this conversation's context. E.g. \"User prefers dark mode in all editors\" or \"Decided to use SurrealDB instead of Postgres because it combines graph and vector search in one embedded process.\""
          ),
        memory_type: z
          .enum(MEMORY_TYPES)
          .optional()
          .describe(
            "'fact' (objective info about the user/project), 'preference' (how the user likes things done), 'decision' (a choice made and why), 'task' (outstanding or ongoing work), or 'reference' (pointer to an external doc/resource). Defaults to 'fact'."
          ),
        importance: z
          .number()
          .min(0)
          .max(1)
          .optional()
          .describe("Subjective priority from 0 (trivial) to 1 (critical — a hard constraint or strong preference). Defaults to 0.5."),
        entity_refs: z
          .array(z.string())
          .optional()
          .describe(
            'Names of people, projects, or tools this memory is about, e.g. ["Alice", "checkout-service"]. Each is created as a new entity if it doesn\'t already exist, and linked to this memory so it shows up in get_entity.'
          ),
        source_episode_id: z
          .string()
          .optional()
          .describe(
            'The record id of the episode this memory was derived from, e.g. "episode:abc123" (as returned by save_episode). Omit if this memory wasn\'t derived from a specific recorded episode.'
          ),
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
