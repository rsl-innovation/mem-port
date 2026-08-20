import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { Surreal, SurrealSession } from "surrealdb";
import { resolveLibrary } from "../resolveLibrary.js";
import { createMentionEdges, resolveEntityRefs } from "../../db/entities.js";
import type { EmbeddingProvider } from "../../embeddings/provider.js";

interface ExistingSkill {
  id: unknown;
  name: string;
  description: string;
  content: string;
  tags: string[];
  source: string;
  created_at: unknown;
}

/**
 * Copy a skill's current fields to an archived row before it is overwritten.
 *
 * The library is shared across every copilot on this library-id, so an upsert
 * can replace work this session never saw. Keeping the prior version makes that
 * recoverable through get_skill by id — archived rows carry no embedding and are
 * filtered out of search_skills, list_skills and get_skill by name, so history
 * costs nothing at read time.
 */
async function archiveVersion(session: SurrealSession, previous: ExistingSkill): Promise<unknown> {
  const [rows] = await session.query<[Array<{ id: unknown }>]>(
    `CREATE skill CONTENT {
       name: $name,
       description: $description,
       content: $content,
       tags: $tags,
       source: $source,
       status: 'archived',
       created_at: $created_at
     }`,
    {
      name: previous.name,
      description: previous.description,
      content: previous.content,
      tags: previous.tags,
      source: previous.source,
      created_at: previous.created_at,
    }
  );
  return rows[0].id;
}

export function registerSaveSkill(server: McpServer, root: Surreal, embeddings: EmbeddingProvider): void {
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
      const session = await resolveLibrary(extra, root);
      const embedding = await embeddings.embed(`${args.name}\n${args.description}`);

      const fields = {
        name: args.name,
        description: args.description,
        content: args.content,
        tags: args.tags ?? [],
        source: args.source ?? "manual",
        embedding,
      };

      // A name is a skill's identity here — get_skill resolves by it, and this
      // matches how resolveEntityRefs already treats an entity name. Newest
      // first so that a library which accumulated duplicates before this became
      // an upsert resolves to one deterministically, rather than to whichever
      // row the storage engine happened to return.
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
      const [named] = await session.query<[Array<ExistingSkill & { status: string }>]>(
        `SELECT id, name, description, content, tags, source, status, created_at FROM skill
         WHERE name = $name
         ORDER BY created_at DESC`,
        { name: args.name }
      );
      const existing = named.filter((row) => row.status === "active");

      let recordId: unknown;
      let note: string;

      if (existing.length === 0) {
        const [created] = await session.query<[Array<{ id: unknown }>]>(
          `CREATE skill CONTENT {
             name: $name,
             description: $description,
             content: $content,
             tags: $tags,
             source: $source,
             embedding: $embedding
           }`,
          fields
        );
        recordId = created[0].id;
        note = `Saved skill ${String(recordId)}`;
      } else {
        const [current, ...duplicates] = existing;
        const archivedId = await archiveVersion(session, current);

        // Collapse any duplicates a pre-upsert save left behind, so the
        // invariant this tool now maintains — one active skill per name — holds
        // for libraries written before it did.
        for (const duplicate of duplicates) {
          await session.query(`UPDATE $id SET status = 'archived', updated_at = time::now()`, { id: duplicate.id });
        }

        await session.query(
          `UPDATE $id SET
             description = $description,
             content = $content,
             tags = $tags,
             source = $source,
             embedding = $embedding,
             updated_at = time::now()`,
          { id: current.id, ...fields }
        );

        // Mentions are replaced wholesale rather than merged: entity_refs
        // describes the revised skill, so a reference dropped from it should
        // disappear from the graph instead of lingering.
        await session.query(`DELETE $id->mentions`, { id: current.id });

        recordId = current.id;
        note =
          `Updated skill ${String(recordId)} (previous version archived as ${String(archivedId)})` +
          (duplicates.length > 0 ? `; archived ${duplicates.length} duplicate(s) of this name` : "");
      }

      const entityIds = await resolveEntityRefs(session, args.entity_refs);
      await createMentionEdges(session, recordId, entityIds);

      return {
        content: [{ type: "text" as const, text: note }],
      };
    }
  );
}
