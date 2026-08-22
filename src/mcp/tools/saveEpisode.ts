import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { resolveLibrary } from "../resolveLibrary.js";
import type { ServerDeps } from "../buildServer.js";

export function registerSaveEpisode(server: McpServer, deps: ServerDeps): void {
  server.registerTool(
    "save_episode",
    {
      description: "Record a raw episode (an interaction/event) — the source material memories get derived from.",
      inputSchema: {
        title: z.string().min(1).describe("A short label for this episode, e.g. \"Kickoff call with Alice\"."),
        content: z
          .string()
          .min(1)
          .describe(
            "What happened, as a self-contained summary or transcript excerpt — this is the raw material memories can later be derived from via save_memory's source_episode_id."
          ),
        source: z
          .string()
          .min(1)
          .describe("Which copilot/agent recorded this, e.g. \"claude-code\", \"cursor\", \"windsurf\", or \"manual\" for something entered by hand."),
        occurred_at: z
          .string()
          .datetime()
          .optional()
          .describe("ISO 8601 timestamp of when this happened, e.g. \"2026-07-31T09:00:00Z\". Defaults to the current time if omitted."),
        entity_refs: z
          .array(z.string())
          .optional()
          .describe(
            'Names of people, projects, or tools this episode involves, e.g. ["Alice", "mem-port"]. Each is created as a new entity if it doesn\'t already exist.'
          ),
      },
    },
    async (args, extra) => {
      const store = await resolveLibrary(extra, deps.store);
      const embedding = await deps.embeddings.embed(`${args.title}\n${args.content}`);

      const id = await store.episodes.create({
        title: args.title,
        content: args.content,
        source: args.source,
        occurred_at: args.occurred_at,
        embedding,
      });

      await store.graph.addMentions(id, await store.entities.resolveRefs(args.entity_refs));

      return {
        content: [{ type: "text" as const, text: `Saved episode ${id}` }],
      };
    }
  );
}
