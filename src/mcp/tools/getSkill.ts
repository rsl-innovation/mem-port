import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { resolveLibrary } from "../resolveLibrary.js";
import type { ServerDeps } from "../buildServer.js";
import { registerAppTool } from "@modelcontextprotocol/ext-apps/server";
import { appToolMeta } from "../apps.js";
import { captionOf, detailResult, formatTags, formatWhen } from "../view.js";

export function registerGetSkill(server: McpServer, deps: ServerDeps): void {
  registerAppTool(
    server,
    "get_skill",
    {
      _meta: appToolMeta(),
      description:
        "Get a skill by exact name or id, including its full procedure body and the entities it mentions. Call this after search_skills or list_skills, which return descriptions only. A name resolves to the current version; earlier versions that save_skill replaced are reachable by id.",
      inputSchema: {
        name: z.string().optional().describe("Exact skill name to look up, e.g. \"debug-flaky-test\". Provide this or 'id', not both."),
        id: z
          .string()
          .optional()
          .describe(
            'Exact skill record id, e.g. "skill:abc123" (as returned by save_skill/search_skills/list_skills). Provide this or \'name\', not both.'
          ),
      },
    },
    async (args, extra) => {
      if (!args.name && !args.id) {
        return {
          content: [{ type: "text" as const, text: "Provide either 'name' or 'id'" }],
          isError: true,
        };
      }

      const store = await resolveLibrary(extra, deps.store);

      // A name resolves to the LIVE skill only, or a superseded procedure could
      // come back reading as current. Reaching an archived version stays
      // possible, deliberately, by its id.
      const id = args.id ?? (await store.skills.findByName(args.name!, { status: "active" }))[0]?.id;
      const skill = id ? await store.skills.getById(id) : null;

      if (!skill) {
        return {
          content: [{ type: "text" as const, text: "Skill not found" }],
          isError: true,
        };
      }

      const result = {
        id: skill.id,
        name: skill.name,
        description: skill.description,
        content: skill.content,
        tags: skill.tags,
        source: skill.source,
        status: skill.status,
        created_at: skill.created_at,
        updated_at: skill.updated_at,
        mentioned_entities: skill.mentioned_entities,
      };

      return detailResult(extra, result, {
        tool: "get_skill",
        key: result.name,
        title: result.name,
        subtitle: result.description,
        sections: [
          { label: "Procedure", value: result.content },
          { label: "Tags", value: formatTags(result.tags) },
          { label: "Mentions", value: result.mentioned_entities.map((e) => e.name).join(", ") },
          { label: "Recorded", value: captionOf([result.source, result.status, formatWhen(result.updated_at)]) },
        ],
      });
    }
  );
}
