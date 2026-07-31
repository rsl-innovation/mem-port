import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { Surreal } from "surrealdb";
import { resolveLibrary } from "../resolveLibrary.js";
import { createMentionEdges, resolveEntityRefs } from "../../db/entities.js";
import type { EmbeddingProvider } from "../../embeddings/provider.js";

export function registerSaveSkill(server: McpServer, root: Surreal, embeddings: EmbeddingProvider): void {
  server.registerTool(
    "save_skill",
    {
      description:
        "Save a reusable skill — a self-contained procedure for a recurring task. Skills live in the same shared knowledge graph as memories and episodes, so any copilot connected to this library-id can recall and reuse one another's skills. Call this when you work out a non-obvious procedure worth doing the same way next time, not for one-off task state.",
      inputSchema: {
        name: z.string().min(1).describe("A short, distinctive title, e.g. \"debug-flaky-test\"."),
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
      const session = await resolveLibrary(extra, root);
      const embedding = await embeddings.embed(`${args.name}\n${args.description}`);

      const [created] = await session.query<[Array<{ id: unknown }>]>(
        `CREATE skill CONTENT {
           name: $name,
           description: $description,
           content: $content,
           tags: $tags,
           source: $source,
           embedding: $embedding
         }`,
        {
          name: args.name,
          description: args.description,
          content: args.content,
          tags: args.tags ?? [],
          source: args.source ?? "manual",
          embedding,
        }
      );

      const record = created[0];

      const entityIds = await resolveEntityRefs(session, args.entity_refs);
      await createMentionEdges(session, record.id, entityIds);

      return {
        content: [{ type: "text" as const, text: `Saved skill ${String(record.id)}` }],
      };
    }
  );
}
