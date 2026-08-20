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

      const session = await resolveLibrary(extra, root);

      // A name resolves to the LIVE skill only, or a superseded procedure could
      // come back reading as current. Reaching an archived version stays
      // possible, deliberately, by its id.
      //
      // Filter status in JS, not in the WHERE clause.
      //
      // `WHERE name = $name AND status = 'active'` returns NOTHING once two rows
      // share a name, even though each condition alone matches — verified
      // against a live library holding exactly one active and one archived 'dc':
      //   name only              -> ["archived", "active"]
      //   status only            -> the active row
      //   name AND status        -> []
      // The non-unique skill_name_idx is what the planner reaches for, and the
      // conjunction comes back empty across sessions. Since save_skill now
      // archives the version it replaces, duplicate names are the normal case,
      // so the compound form cannot be used anywhere on this table.
      let recordId: unknown;
      if (args.id) {
        recordId = new StringRecordId(args.id);
      } else {
        const [matches] = await session.query<[Array<{ id: unknown; status: string }>]>(
          `SELECT id, status FROM skill WHERE name = $name`,
          { name: args.name }
        );
        recordId = matches.find((row) => row.status === "active")?.id;
      }

      const [rows] = recordId
        ? await session.query<[SkillRow[]]>(
            `SELECT *, ->mentions->entity.{id, name} AS mentioned_entities FROM [<record<skill>> $id]`,
            { id: recordId }
          )
        : [[]];

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
