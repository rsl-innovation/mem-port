import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { resolveLibrary } from "../resolveLibrary.js";
import type { ServerDeps } from "../buildServer.js";

export function registerForgetMemory(server: McpServer, deps: ServerDeps): void {
  server.registerTool(
    "forget_memory",
    {
      description:
        "Forget a memory. Soft-archives by default (excluded from search, still recoverable); hard: true permanently deletes it.",
      inputSchema: {
        memory_id: z
          .string()
          .min(1)
          .describe('The record id of the memory to forget, e.g. "memory:abc123" (as returned by save_memory or search_memory).'),
        hard: z
          .boolean()
          .optional()
          .describe(
            "If true, permanently deletes the memory instead of soft-archiving it. Defaults to false — soft-archived memories are excluded from search_memory but not destroyed."
          ),
      },
    },
    async (args, extra) => {
      const store = await resolveLibrary(extra, deps.store);

      if (args.hard) {
        await store.memories.remove(args.memory_id);
        return {
          content: [{ type: "text" as const, text: `Permanently deleted ${args.memory_id}` }],
        };
      }

      await store.memories.archive(args.memory_id);
      return {
        content: [{ type: "text" as const, text: `Archived ${args.memory_id}` }],
      };
    }
  );
}
