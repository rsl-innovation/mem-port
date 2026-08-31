import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { EmbeddingProvider } from "../embeddings/provider.js";
import type { StoreProvider } from "../interfaces/provider.interface.js";
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

/**
 * What a read-only connection is told instead.
 *
 * The default instructions are almost entirely "proactively call save_memory /
 * save_skill / save_adr". Handing those to a client that has none of those
 * tools would send it hunting for something that isn't there and reporting the
 * failure to the user, so the write half is not softened here — it is removed,
 * and the recall half is kept.
 */
const READ_ONLY_INSTRUCTIONS = `mem-port is a persistent, cross-session knowledge graph for this library-id. This connection is READ-ONLY: you can search and read everything in it, and you cannot change it. There are no save or forget tools, so don't look for them or promise the user that something will be remembered here.

Proactively call search_memory at the start of a task that could be informed by prior context, search_skills at the start of a task that might already have a known procedure, and search_adrs before proposing an approach or re-litigating a technical choice — a superseded ADR still tells you what was already tried and why it was dropped. Check before assuming none of these exist.

This library is shared, and someone else curates it: treat what you find as the team's accumulated context rather than notes from your own past sessions. get_entity, list_episodes, list_skills, list_adrs and get_skill/get_adr fill in the detail behind a search hit.

If the user asks you to remember something here, tell them plainly that this connection cannot write to this library and that the level is set by whoever administers it.`;

/**
 * What every tool needs, in one bag.
 *
 * Previously each `registerX` took its own subset of (root, embeddings,
 * dataDir) in one of four different argument shapes; a single deps object
 * means adding a dependency doesn't touch nineteen signatures.
 */
export interface ServerDeps {
  store: StoreProvider;
  embeddings: EmbeddingProvider;
  /** Where export_library writes bundle files. */
  dataDir: string;
}

export interface ServerOptions {
  /**
   * Withhold every tool that can change the library.
   *
   * Not registering a tool is the enforcement, not a hint: the daemon runs MCP
   * stateless, building a fresh server per HTTP request, so a `tools/call` for
   * a withheld tool reaches a server that never had it and comes back as an
   * unknown tool. There is no second server instance, and no session, on which
   * it could still exist.
   */
  readOnly?: boolean;
}

export function buildServer(deps: ServerDeps, options: ServerOptions = {}): McpServer {
  const readOnly = options.readOnly ?? false;
  const server = new McpServer(
    { name: "mem-port", version: VERSION },
    { instructions: readOnly ? READ_ONLY_INSTRUCTIONS : SERVER_INSTRUCTIONS }
  );

  // The single ui:// template every read tool points at via _meta.ui.resourceUri.
  registerAppUi(server);

  // Reads. export_library is here rather than below because it only reads the
  // library -- the file it writes is a bundle in the daemon's data dir, and
  // everything in it is already visible to anyone who can search.
  registerSearchMemory(server, deps);
  registerListEpisodes(server, deps);
  registerGetEntity(server, deps);
  registerExportLibrary(server, deps);
  registerSearchSkills(server, deps);
  registerListSkills(server, deps);
  registerGetSkill(server, deps);
  registerSearchAdrs(server, deps);
  registerListAdrs(server, deps);
  registerGetAdr(server, deps);

  if (readOnly) return server;

  // Writes.
  registerSaveMemory(server, deps);
  registerSaveEpisode(server, deps);
  registerRelateEntities(server, deps);
  registerForgetMemory(server, deps);
  registerImportLibrary(server, deps);
  registerSaveSkill(server, deps);
  registerForgetSkill(server, deps);
  registerSaveAdr(server, deps);
  registerForgetAdr(server, deps);

  return server;
}
