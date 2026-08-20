import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StringRecordId, type Surreal } from "surrealdb";
import { resolveLibrary } from "../resolveLibrary.js";
import { formatAdrNumber } from "../../db/adr.js";
import { registerAppTool } from "@modelcontextprotocol/ext-apps/server";
import { appToolMeta } from "../apps.js";
import { detailResult } from "../view.js";

interface EntityRow {
  id: unknown;
  name: string;
  entity_type: string;
  summary: string | null;
  attributes: Record<string, unknown>;
  mentioning_memories: Array<{ id: unknown; content: string }>;
  mentioning_episodes: Array<{ id: unknown; title: string }>;
  mentioning_skills: Array<{ id: unknown; name: string }>;
  mentioning_adrs: Array<{ id: unknown; number: number; title: string }>;
}

interface RelatedRow {
  relation_type: string;
  name: string;
  id: unknown;
}

export function registerGetEntity(server: McpServer, root: Surreal): void {
  registerAppTool(
    server,
    "get_entity",
    {
      _meta: appToolMeta(),
      description: "Get an entity by name or id, along with memories/episodes that mention it and related entities.",
      inputSchema: {
        name: z.string().optional().describe("Exact entity name to look up, e.g. \"Alice\". Provide this or 'id', not both."),
        id: z
          .string()
          .optional()
          .describe(
            'Exact entity record id, e.g. "entity:abc123" (as returned by save_memory/save_episode/relate_entities). Provide this or \'name\', not both.'
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

      const target = args.id
        ? `[<record<entity>> $id]`
        : `(SELECT VALUE id FROM entity WHERE name = $name LIMIT 1)`;

      const [entityRows] = await session.query<[EntityRow[]]>(
        `SELECT
           *,
           <-mentions<-memory.{id, content} AS mentioning_memories,
           <-mentions<-episode.{id, title} AS mentioning_episodes,
           <-mentions<-skill.{id, name} AS mentioning_skills,
           <-mentions<-adr.{id, number, title} AS mentioning_adrs
         FROM ${target}`,
        args.id ? { id: new StringRecordId(args.id) } : { name: args.name }
      );

      const entity = entityRows[0];
      if (!entity) {
        return {
          content: [{ type: "text" as const, text: "Entity not found" }],
          isError: true,
        };
      }

      const [related] = await session.query<[RelatedRow[]]>(
        `SELECT relation_type, out.name AS name, out.id AS id FROM relates_to WHERE in = $entity`,
        { entity: entity.id }
      );

      const result = {
        id: String(entity.id),
        name: entity.name,
        entity_type: entity.entity_type,
        summary: entity.summary,
        attributes: entity.attributes,
        mentioned_by_memories: entity.mentioning_memories.map((m) => ({ id: String(m.id), content: m.content })),
        mentioned_by_episodes: entity.mentioning_episodes.map((e) => ({ id: String(e.id), title: e.title })),
        mentioned_by_skills: entity.mentioning_skills.map((s) => ({ id: String(s.id), name: s.name })),
        mentioned_by_adrs: entity.mentioning_adrs.map((a) => ({
          id: String(a.id),
          number: a.number,
          adr: formatAdrNumber(a.number),
          title: a.title,
        })),
        related_entities: related.map((r) => ({ relation_type: r.relation_type, name: r.name, id: String(r.id) })),
      };

      return detailResult(extra, result, {
        tool: "get_entity",
        key: result.name,
        title: result.name,
        subtitle: result.entity_type,
        sections: [
          { label: "Summary", value: result.summary },
          {
            label: "Related entities",
            value: result.related_entities.map((r) => `${r.relation_type}: ${r.name}`).join("\n"),
          },
          { label: "Memories", value: result.mentioned_by_memories.map((m) => m.content).join("\n") },
          { label: "Episodes", value: result.mentioned_by_episodes.map((e) => e.title).join("\n") },
          { label: "Skills", value: result.mentioned_by_skills.map((s) => s.name).join("\n") },
          { label: "Decisions", value: result.mentioned_by_adrs.map((a) => `${a.adr} — ${a.title}`).join("\n") },
        ],
      });
    }
  );
}
