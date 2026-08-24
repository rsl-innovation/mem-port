import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { resolveLibrary } from "../resolveLibrary.js";
import type { ServerDeps } from "../buildServer.js";
import { formatAdrNumber } from "../format.js";
import { registerAppTool } from "@modelcontextprotocol/ext-apps/server";
import { appToolMeta } from "../apps.js";
import { detailResult } from "../view.js";

export function registerGetEntity(server: McpServer, deps: ServerDeps): void {
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

      const store = await resolveLibrary(extra, deps.store);

      const entity = await store.entities.detail(args.id ? { id: args.id } : { name: args.name! });
      if (!entity) {
        return {
          content: [{ type: "text" as const, text: "Entity not found" }],
          isError: true,
        };
      }

      const result = {
        id: entity.id,
        name: entity.name,
        entity_type: entity.entity_type,
        summary: entity.summary,
        attributes: entity.attributes,
        mentioned_by_memories: entity.mentioning_memories,
        mentioned_by_episodes: entity.mentioning_episodes,
        mentioned_by_skills: entity.mentioning_skills,
        mentioned_by_adrs: entity.mentioning_adrs.map((a) => ({
          id: a.id,
          number: a.number,
          adr: formatAdrNumber(a.number),
          title: a.title,
        })),
        related_entities: entity.related_entities.map((r) => ({
          relation_type: r.relation_type,
          name: r.name,
          id: r.id,
        })),
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
