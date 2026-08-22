import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { resolveLibrary } from "../resolveLibrary.js";
import type { ServerDeps } from "../buildServer.js";
import { MEMORY_TYPES } from "../../interfaces/memories.interface.js";

export function registerSaveMemory(server: McpServer, deps: ServerDeps): void {
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
      const store = await resolveLibrary(extra, deps.store);
      const embedding = await deps.embeddings.embed(args.content);

      const id = await store.memories.create({
        content: args.content,
        memory_type: args.memory_type,
        importance: args.importance,
        embedding,
        source_episode_id: args.source_episode_id,
      });

      await store.graph.addMentions(id, await store.entities.resolveRefs(args.entity_refs));

      return {
        content: [{ type: "text" as const, text: `Saved memory ${id}` }],
      };
    }
  );
}
