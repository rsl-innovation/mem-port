import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StringRecordId, type Surreal } from "surrealdb";
import { resolveLibrary } from "../resolveLibrary.js";

export function registerForgetMemory(server: McpServer, root: Surreal): void {
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
      const session = await resolveLibrary(extra, root);
      const id = new StringRecordId(args.memory_id);

      if (args.hard) {
        await session.query(`DELETE $id`, { id });
        return {
          content: [{ type: "text" as const, text: `Permanently deleted ${args.memory_id}` }],
        };
      }

      await session.query(`UPDATE $id SET status = 'archived', updated_at = time::now()`, { id });
      return {
        content: [{ type: "text" as const, text: `Archived ${args.memory_id}` }],
      };
    }
  );
}
