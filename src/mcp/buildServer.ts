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

export function buildServer(root: Surreal, embeddings: EmbeddingProvider, dataDir: string): McpServer {
  const server = new McpServer({ name: "mem-port", version: "0.1.0" });

  registerSaveMemory(server, root, embeddings);
  registerSearchMemory(server, root, embeddings);
  registerSaveEpisode(server, root, embeddings);
  registerListEpisodes(server, root);
  registerGetEntity(server, root);
  registerRelateEntities(server, root);
  registerForgetMemory(server, root);
  registerExportLibrary(server, root, embeddings, dataDir);
  registerImportLibrary(server, root);

  return server;
}
