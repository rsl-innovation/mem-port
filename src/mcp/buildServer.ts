import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { Surreal } from "surrealdb";
import type { EmbeddingProvider } from "../embeddings/provider.js";
import { registerSaveMemory } from "./tools/saveMemory.js";
import { registerSearchMemory } from "./tools/searchMemory.js";
import { registerSaveEpisode } from "./tools/saveEpisode.js";
import { registerListEpisodes } from "./tools/listEpisodes.js";
import { registerGetEntity } from "./tools/getEntity.js";
import { registerRelateEntities } from "./tools/relateEntities.js";
import { registerForgetMemory } from "./tools/forgetMemory.js";
import { registerExportLibrary } from "./tools/exportLibrary.js";
import { registerImportLibrary } from "./tools/importLibrary.js";
import { registerSaveSkill } from "./tools/saveSkill.js";
import { registerSearchSkills } from "./tools/searchSkills.js";
import { registerListSkills } from "./tools/listSkills.js";
import { registerGetSkill } from "./tools/getSkill.js";
import { registerForgetSkill } from "./tools/forgetSkill.js";

const SERVER_INSTRUCTIONS = `mem-port is a persistent, cross-session knowledge graph for this library-id — not a scratch pad you write to only when asked.

Proactively call save_memory whenever you learn a durable fact, preference, decision, or task about the user or their work, in the same turn you learn it — don't wait for an explicit "remember this." Link related people/projects/tools via entity_refs so context stays connected in the graph.

Proactively call save_skill when you work out a non-obvious, reusable procedure — the kind of thing worth doing the same way next time, not one-off task state. Skills are shared across every copilot connected to this library-id, so a procedure learned in one tool is available in another.

Proactively call search_memory at the start of a task that could be informed by prior context, and search_skills at the start of a task that might already have a known procedure, before assuming neither exists.

Don't save: information already derivable from the current codebase/files, one-off task state that's only relevant to this conversation, or anything the user has asked you not to keep.`;

export function buildServer(root: Surreal, embeddings: EmbeddingProvider, dataDir: string): McpServer {
  const server = new McpServer({ name: "mem-port", version: "0.1.0" }, { instructions: SERVER_INSTRUCTIONS });

  registerSaveMemory(server, root, embeddings);
  registerSearchMemory(server, root, embeddings);
  registerSaveEpisode(server, root, embeddings);
  registerListEpisodes(server, root);
  registerGetEntity(server, root);
  registerRelateEntities(server, root);
  registerForgetMemory(server, root);
  registerExportLibrary(server, root, embeddings, dataDir);
  registerImportLibrary(server, root);
  registerSaveSkill(server, root, embeddings);
  registerSearchSkills(server, root, embeddings);
  registerListSkills(server, root);
  registerGetSkill(server, root);
  registerForgetSkill(server, root);

  return server;
}
