import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { Surreal } from "surrealdb";
import type { EmbeddingProvider } from "../embeddings/provider.js";
import { VERSION } from "../version.js";
import { registerAppUi } from "./apps.js";
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
import { registerSaveAdr } from "./tools/saveAdr.js";
import { registerSearchAdrs } from "./tools/searchAdrs.js";
import { registerListAdrs } from "./tools/listAdrs.js";
import { registerGetAdr } from "./tools/getAdr.js";
import { registerForgetAdr } from "./tools/forgetAdr.js";

const SERVER_INSTRUCTIONS = `mem-port is a persistent, cross-session knowledge graph for this library-id — not a scratch pad you write to only when asked.

Proactively call save_memory whenever you learn a durable fact, preference, decision, or task about the user or their work, in the same turn you learn it — don't wait for an explicit "remember this." Link related people/projects/tools via entity_refs so context stays connected in the graph.

Proactively call save_skill when you work out a non-obvious, reusable procedure — the kind of thing worth doing the same way next time, not one-off task state. Skills are shared across every copilot connected to this library-id, so a procedure learned in one tool is available in another.

Proactively call save_adr when a consequential technical choice gets made — a library, a data model, a protocol, an accepted tradeoff — capturing the problem that forced it and the options rejected, not just the outcome. Use save_adr rather than save_memory for decisions like these; when a later decision reverses an earlier one, pass 'supersedes' so the chain stays intact instead of leaving two contradictory records.

Proactively call search_memory at the start of a task that could be informed by prior context, search_skills at the start of a task that might already have a known procedure, and search_adrs before proposing an approach or re-litigating a technical choice — a superseded ADR still tells you what was already tried and why it was dropped. Check before assuming none of these exist.

Don't save: information already derivable from the current codebase/files, one-off task state that's only relevant to this conversation, or anything the user has asked you not to keep.`;

export function buildServer(root: Surreal, embeddings: EmbeddingProvider, dataDir: string): McpServer {
  const server = new McpServer({ name: "mem-port", version: VERSION }, { instructions: SERVER_INSTRUCTIONS });

  // The single ui:// template every read tool points at via _meta.ui.resourceUri.
  registerAppUi(server);

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
  registerSaveAdr(server, root, embeddings);
  registerSearchAdrs(server, root, embeddings);
  registerListAdrs(server, root);
  registerGetAdr(server, root);
  registerForgetAdr(server, root);

  return server;
}
