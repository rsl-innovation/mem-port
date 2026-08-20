import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StringRecordId, type Surreal } from "surrealdb";
import { resolveLibrary } from "../resolveLibrary.js";
import { registerAppTool } from "@modelcontextprotocol/ext-apps/server";
import { appToolMeta } from "../apps.js";
import { captionOf, detailResult, formatTags, formatWhen } from "../view.js";

interface SkillRow {
  id: unknown;
  name: string;
  description: string;
  content: string;
  tags: string[];
  source: string;
  status: string;
  created_at: unknown;
  updated_at: unknown;
  mentioned_entities: Array<{ id: unknown; name: string }>;
}

export function registerGetSkill(server: McpServer, root: Surreal): void {
  registerAppTool(
    server,
    "get_skill",
    {
      _meta: appToolMeta(),
      description: "Get a skill by exact name or id, including the entities it mentions.",
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

      const session = await resolveLibrary(extra, root);

      const target = args.id ? `[<record<skill>> $id]` : `(SELECT VALUE id FROM skill WHERE name = $name LIMIT 1)`;

      const [rows] = await session.query<[SkillRow[]]>(
        `SELECT *, ->mentions->entity.{id, name} AS mentioned_entities FROM ${target}`,
        args.id ? { id: new StringRecordId(args.id) } : { name: args.name }
      );

      const skill = rows[0];
      if (!skill) {
        return {
          content: [{ type: "text" as const, text: "Skill not found" }],
          isError: true,
        };
      }

      const result = {
        id: String(skill.id),
        name: skill.name,
        description: skill.description,
        content: skill.content,
        tags: skill.tags,
        source: skill.source,
        status: skill.status,
        created_at: skill.created_at,
        updated_at: skill.updated_at,
        mentioned_entities: skill.mentioned_entities.map((e) => ({ id: String(e.id), name: e.name })),
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
