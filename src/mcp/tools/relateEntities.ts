import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { resolveLibrary } from "../resolveLibrary.js";
import type { ServerDeps } from "../buildServer.js";

export function registerRelateEntities(server: McpServer, deps: ServerDeps): void {
  server.registerTool(
    "relate_entities",
    {
      description: "Create a directed relation between two entities (creating either entity if it doesn't exist yet).",
      inputSchema: {
        from_entity: z.string().min(1).describe("Name of the source entity, e.g. \"Alice\". Created if it doesn't already exist."),
        to_entity: z.string().min(1).describe("Name of the target entity, e.g. \"checkout-service\". Created if it doesn't already exist."),
        relation_type: z
          .string()
          .min(1)
          .describe(
            "The relationship from from_entity to to_entity, e.g. \"leads\", \"depends_on\", \"part_of\", \"similar_to\". Free text — pick whatever verb best describes it."
          ),
        attributes: z
          .record(z.string(), z.unknown())
          .optional()
          .describe('Arbitrary extra metadata on this relation, e.g. { "since": "2026-01" }.'),
      },
    },
    async (args, extra) => {
      const store = await resolveLibrary(extra, deps.store);

      const [fromId, toId] = await store.entities.resolveRefs([args.from_entity, args.to_entity]);

      const id = await store.graph.relate(fromId, toId, {
        relation_type: args.relation_type,
        attributes: args.attributes,
      });

      return {
        content: [{ type: "text" as const, text: `Created relation ${id}` }],
      };
    }
  );
}
