import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { resolveLibrary } from "../resolveLibrary.js";
import type { ServerDeps } from "../buildServer.js";

export function registerForgetSkill(server: McpServer, deps: ServerDeps): void {
  server.registerTool(
    "forget_skill",
    {
      description:
        "Forget a skill. Soft-archives by default (excluded from search_skills/list_skills, still recoverable); hard: true permanently deletes it.",
      inputSchema: {
        skill_id: z.string().min(1).describe('The record id of the skill to forget, e.g. "skill:abc123" (as returned by save_skill or search_skills).'),
        hard: z
          .boolean()
          .optional()
          .describe(
            "If true, permanently deletes the skill instead of soft-archiving it. Defaults to false — soft-archived skills are excluded from search_skills/list_skills but not destroyed."
          ),
      },
    },
    async (args, extra) => {
      const store = await resolveLibrary(extra, deps.store);

      if (args.hard) {
        await store.skills.remove(args.skill_id);
        return {
          content: [{ type: "text" as const, text: `Permanently deleted ${args.skill_id}` }],
        };
      }

      await store.skills.archive(args.skill_id);
      return {
        content: [{ type: "text" as const, text: `Archived ${args.skill_id}` }],
      };
    }
  );
}
