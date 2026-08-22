import http from "node:http";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { resolveConfig, type Config } from "./config.js";
import { closeRootConnection, getStoreProvider } from "./db/connection.js";
import type { StoreProvider } from "./interfaces/provider.interface.js";
import { buildServer, type ServerDeps } from "./mcp/buildServer.js";
import { LocalEmbeddingProvider } from "./embeddings/localProvider.js";

const MCP_PATH = "/mcp";

export async function startDaemon(overrides: Partial<Config> = {}): Promise<http.Server> {
  const config = resolveConfig(overrides);
  // Built once per process, not per request: it owns the connection and the
  // per-library session cache, both of which would be pointless if rebuilt.
  const store = getStoreProvider(config);
  const embeddings = new LocalEmbeddingProvider(config.dataDir);
  const deps: ServerDeps = { store, embeddings, dataDir: config.dataDir };

  const httpServer = http.createServer((req, res) => {
    if (req.method !== "POST" || req.url !== MCP_PATH) {
      res.writeHead(404, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: "not found" }));
      return;
    }

    void handleMcpRequest(deps, req, res);
  });

  await new Promise<void>((resolve, reject) => {
    httpServer.once("error", reject);
    httpServer.listen(config.port, config.host, () => resolve());
  });

  // eslint-disable-next-line no-console
  console.error(
    `mem-port listening on http://${config.host}:${config.port}${MCP_PATH} ` +
      `(store: ${config.store.driver}, data dir: ${config.dataDir})`
  );
  if (config.host !== "127.0.0.1" && config.host !== "localhost") {
    console.error(
      `WARNING: bound to ${config.host}, which is reachable beyond this machine. ` +
        `mem-port has no authentication of its own — any caller that reaches this port can read and write ` +
        `any library by setting the library-id header. Only do this behind a platform auth layer or a private network.`
    );
  }

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
  deps: ServerDeps,
  req: http.IncomingMessage,
  res: http.ServerResponse
): Promise<void> {
  // Stateless mode: a fresh McpServer + transport per request, closing over the
  // library-id-resolved session inside tool handlers. Avoids a class of bugs
  // where a long-lived MCP session receives a different library-id on a later call.
  const server = buildServer(deps);
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
