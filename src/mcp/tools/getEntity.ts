import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StringRecordId, type Surreal } from "surrealdb";
import { resolveLibrary } from "../resolveLibrary.js";

interface EntityRow {
  id: unknown;
  name: string;
  entity_type: string;
  summary: string | null;
  attributes: Record<string, unknown>;
  mentioning_memories: Array<{ id: unknown; content: string }>;
  mentioning_episodes: Array<{ id: unknown; title: string }>;
}

interface RelatedRow {
  relation_type: string;
  name: string;
  id: unknown;
}

export function registerGetEntity(server: McpServer, root: Surreal): void {
  server.registerTool(
    "get_entity",
    {
      description: "Get an entity by name or id, along with memories/episodes that mention it and related entities.",
      inputSchema: {
        name: z.string().optional(),
        id: z.string().optional(),
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
           <-mentions<-episode.{id, title} AS mentioning_episodes
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
        related_entities: related.map((r) => ({ relation_type: r.relation_type, name: r.name, id: String(r.id) })),
      };

      return {
        content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }],
      };
    }
  );
}
