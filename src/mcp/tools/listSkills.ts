import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { Surreal } from "surrealdb";
import { resolveLibrary } from "../resolveLibrary.js";
import { registerAppTool } from "@modelcontextprotocol/ext-apps/server";
import { appToolMeta } from "../apps.js";
import { captionOf, formatTags, listResult } from "../view.js";

interface SkillRow {
  id: unknown;
  name: string;
  description: string;
  content: string;
  tags: string[];
  source: string;
  created_at: unknown;
}

export function registerListSkills(server: McpServer, root: Surreal): void {
  registerAppTool(
    server,
    "list_skills",
    {
      _meta: appToolMeta(),
      description: "List saved skills, newest first, optionally filtered by tag or source.",
      inputSchema: {
        tag: z.string().optional().describe('Only include skills with this tag, e.g. "testing".'),
        source: z.string().optional().describe('Only include skills recorded by this exact source, e.g. "claude-code".'),
        limit: z.number().int().min(1).max(200).optional().describe("Maximum number of skills to return, newest first. Defaults to 20."),
      },
    },
    async (args, extra) => {
      const session = await resolveLibrary(extra, root);

      const conditions: string[] = ["status = 'active'"];
      const bindings: Record<string, unknown> = { limit: args.limit ?? 20 };

      if (args.tag) {
        conditions.push("tags CONTAINS $tag");
        bindings.tag = args.tag;
      }
      if (args.source) {
        conditions.push("source = $source");
        bindings.source = args.source;
      }

      const [rows] = await session.query<[SkillRow[]]>(
        `SELECT id, name, description, content, tags, source, created_at FROM skill
         WHERE ${conditions.join(" AND ")}
         ORDER BY created_at DESC
         LIMIT $limit`,
        bindings
      );

      const results = rows.map((row) => ({
        id: String(row.id),
        name: row.name,
        description: row.description,
        content: row.content,
        tags: row.tags,
        source: row.source,
        created_at: row.created_at,
      }));

      return listResult(extra, results, {
        tool: "list_skills",
        heading: `Skills (${results.length})`,
        empty: "No skills saved in this library yet.",
        items: results.map((skill) => ({
          title: skill.name,
          subtitle: skill.description,
          meta: captionOf([formatTags(skill.tags), skill.source]),
        })),
      });
    }
  );
}
