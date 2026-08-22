import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { resolveLibrary } from "../resolveLibrary.js";
import type { ServerDeps } from "../buildServer.js";

export function registerForgetAdr(server: McpServer, deps: ServerDeps): void {
  server.registerTool(
    "forget_adr",
    {
      description:
        "Forget an ADR. Soft-archives by default (excluded from search_adrs/list_adrs, still recoverable); hard: true permanently deletes it. Prefer setting status to \"deprecated\" via a superseding ADR over forgetting one — a decision that was reversed is usually worth keeping on the record.",
      inputSchema: {
        adr_id: z.string().min(1).describe('The record id of the ADR to forget, e.g. "adr:x9k2" (as returned by save_adr or search_adrs).'),
        hard: z
          .boolean()
          .optional()
          .describe(
            "If true, permanently deletes the ADR instead of soft-archiving it. Defaults to false — soft-archived ADRs are excluded from search_adrs/list_adrs but not destroyed."
          ),
      },
    },
    async (args, extra) => {
      const store = await resolveLibrary(extra, deps.store);

      if (args.hard) {
        // Clear inbound supersede links first, or the delete leaves newer ADRs
        // pointing at a record that no longer exists.
        await store.adrs.clearSupersedesPointingAt(args.adr_id);
        await store.adrs.remove(args.adr_id);
        return {
          content: [{ type: "text" as const, text: `Permanently deleted ${args.adr_id}` }],
        };
      }

      await store.adrs.archive(args.adr_id);
      return {
        content: [{ type: "text" as const, text: `Archived ${args.adr_id}` }],
      };
    }
  );
}
