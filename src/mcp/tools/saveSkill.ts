import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { resolveLibrary } from "../resolveLibrary.js";
import type { ServerDeps } from "../buildServer.js";
import { saveSkill } from "../../services/skills.js";

export function registerSaveSkill(server: McpServer, deps: ServerDeps): void {
  server.registerTool(
    "save_skill",
    {
      description:
        "Save a reusable skill — a self-contained procedure for a recurring task. Skills live in the same shared knowledge graph as memories and episodes, so any copilot connected to this library-id can recall and reuse one another's skills. Call this when you work out a non-obvious procedure worth doing the same way next time, not for one-off task state. Saving under a name that already exists REPLACES that skill rather than creating a second copy, so this is also how you revise one — pass the full revised procedure, not just the part that changed. The version it replaces is archived and still reachable by id.",
      inputSchema: {
        name: z
          .string()
          .min(1)
          .describe(
            'A short, distinctive title, e.g. "debug-flaky-test". This is the skill\'s identity: saving again under the same name updates that skill in place.'
          ),
        description: z
          .string()
          .min(1)
          .describe(
            "When to use this skill, as a trigger condition — e.g. \"Use when a test passes locally but fails intermittently in CI.\" search_skills matches against this field, so phrase it around the situation that should bring the skill to mind, not just a restatement of the name."
          ),
        content: z
          .string()
          .min(1)
          .describe(
            "The actual procedure, as self-contained instructions — it will be read later without this conversation's context. Steps, commands, gotchas, whatever's needed to actually do the thing."
          ),
        tags: z.array(z.string()).optional().describe('Free-form categories, e.g. ["testing", "ci"]. Omit if none apply.'),
        source: z
          .string()
          .optional()
          .describe(
            'Which copilot/tool this skill originated from, e.g. "claude-code", "cursor", "windsurf", or "manual" for something entered by hand. Defaults to "manual".'
          ),
        entity_refs: z
          .array(z.string())
          .optional()
          .describe(
            'Names of people, projects, or tools this skill is about, e.g. ["checkout-service"]. Each is created as a new entity if it doesn\'t already exist.'
          ),
      },
    },
    async (args, extra) => {
      const store = await resolveLibrary(extra, deps.store);

      const outcome = await saveSkill(store, deps.embeddings, args);

      const note = outcome.created
        ? `Saved skill ${outcome.id}`
        : `Updated skill ${outcome.id} (previous version archived as ${outcome.archivedVersionId})` +
          (outcome.collapsedDuplicates > 0
            ? `; archived ${outcome.collapsedDuplicates} duplicate(s) of this name`
            : "");

      return {
        content: [{ type: "text" as const, text: note }],
      };
    }
  );
}
