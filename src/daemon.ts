import http from "node:http";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import type { Surreal } from "surrealdb";
import { resolveConfig, type Config } from "./config.js";
import { getRootConnection, closeRootConnection } from "./db/connection.js";
import { buildServer } from "./mcp/buildServer.js";
import { LocalEmbeddingProvider } from "./embeddings/localProvider.js";
import type { EmbeddingProvider } from "./embeddings/provider.js";

const MCP_PATH = "/mcp";

export async function startDaemon(overrides: Partial<Config> = {}): Promise<http.Server> {
  const config = resolveConfig(overrides);
  const root = await getRootConnection(config.dataDir);
  const embeddings = new LocalEmbeddingProvider(config.dataDir);

  const httpServer = http.createServer((req, res) => {
    if (req.method !== "POST" || req.url !== MCP_PATH) {
      res.writeHead(404, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: "not found" }));
      return;
    }

    void handleMcpRequest(root, embeddings, config.dataDir, req, res);
  });

  await new Promise<void>((resolve, reject) => {
    httpServer.once("error", reject);
    httpServer.listen(config.port, "127.0.0.1", () => resolve());
  });

  // eslint-disable-next-line no-console
  console.error(`mem-port listening on http://127.0.0.1:${config.port}${MCP_PATH} (data dir: ${config.dataDir})`);

  const shutdown = async (): Promise<void> => {
    await new Promise<void>((resolve) => httpServer.close(() => resolve()));
    await closeRootConnection();
    process.exit(0);
  };
  process.on("SIGINT", () => void shutdown());
  process.on("SIGTERM", () => void shutdown());

  return httpServer;
}

async function handleMcpRequest(
  root: Surreal,
  embeddings: EmbeddingProvider,
  dataDir: string,
  req: http.IncomingMessage,
  res: http.ServerResponse
): Promise<void> {
  // Stateless mode: a fresh McpServer + transport per request, closing over the
  // library-id-resolved session inside tool handlers. Avoids a class of bugs
  // where a long-lived MCP session receives a different library-id on a later call.
  const server = buildServer(root, embeddings, dataDir);
  const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });

  res.on("close", () => {
    void transport.close();
    void server.close();
  });

  try {
    await server.connect(transport);
    await transport.handleRequest(req, res);
  } catch (err) {
    if (!res.headersSent) {
      res.writeHead(500, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: err instanceof Error ? err.message : "internal error" }));
    }
  }
}
