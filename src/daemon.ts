import http from "node:http";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { resolveConfig, type Config } from "./config.js";
import { authenticate, authorizeWorkspace, bearerFrom, type AuthFailure } from "./auth/authenticate.js";
import { bootstrapAdmin } from "./auth/bootstrap.js";
import type { ControlPlaneStore } from "./interfaces/admin.interface.js";
import { isReservedLibraryId } from "./db/libraryId.js";
import { ADMIN_PREFIX, handleAdminRequest } from "./admin/router.js";
import { closeRootConnection, getStoreProvider } from "./db/connection.js";
import type { StoreProvider } from "./interfaces/provider.interface.js";
import { buildServer, type ServerDeps } from "./mcp/buildServer.js";
import { readOnlyRequested } from "./mcp/readOnly.js";
import { LocalEmbeddingProvider } from "./embeddings/localProvider.js";

const MCP_PATH = "/mcp";

/**
 * A Secure cookie is never sent over plain HTTP, so marking one on a local
 * daemon would make the panel impossible to sign into. Everywhere else it is
 * exactly where the cookie would otherwise cross a network in the clear.
 */
function isLoopbackHost(host: string): boolean {
  return host === "127.0.0.1" || host === "localhost" || host === "::1";
}

export async function startDaemon(overrides: Partial<Config> = {}): Promise<http.Server> {
  const config = resolveConfig(overrides);
  // Built once per process, not per request: it owns the connection and the
  // per-library session cache, both of which would be pointless if rebuilt.
  const store = getStoreProvider(config);
  const embeddings = new LocalEmbeddingProvider(config.dataDir);
  const deps: ServerDeps = { store, embeddings, dataDir: config.dataDir };

  // Resolved once at startup rather than per request: it also proves the
  // database is reachable and, when auth is on, that an admin exists to
  // administer it -- both better discovered now than on the first call.
  const controlPlane = config.auth.mode === "required" ? await store.getControlPlane() : undefined;
  if (controlPlane) {
    await bootstrapAdmin(controlPlane, config.auth);
  }

  const httpServer = http.createServer((req, res) => {
    const path = (req.url ?? "").split("?")[0];

    if (path === ADMIN_PREFIX || path.startsWith(`${ADMIN_PREFIX}/`)) {
      // The panel exists only where there are accounts to administer. With
      // auth off there is no control plane, and serving a login screen backed
      // by nothing would be worse than saying it is not here.
      if (!controlPlane) {
        res.writeHead(404, { "content-type": "application/json" });
        res.end(JSON.stringify({ error: "admin panel is disabled because MEM_PORT_AUTH is off" }));
        return;
      }
      void handleAdminRequest(
        {
          cp: controlPlane,
          store,
          auth: config.auth,
          secureCookies: !isLoopbackHost(config.host),
          origin: process.env.MEM_PORT_PUBLIC_URL ?? "",
        },
        req,
        res
      );
      return;
    }

    if (req.method !== "POST" || path !== MCP_PATH) {
      res.writeHead(404, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: "not found" }));
      return;
    }

    void handleMcpRequest(deps, config, controlPlane, req, res);
  });

  await new Promise<void>((resolve, reject) => {
    httpServer.once("error", reject);
    httpServer.listen(config.port, config.host, () => resolve());
  });

  // eslint-disable-next-line no-console
  console.error(
    `mem-port listening on http://${config.host}:${config.port}${MCP_PATH} ` +
      `(store: ${config.store.driver}, auth: ${config.auth.mode}, data dir: ${config.dataDir})`
  );
  if (controlPlane) {
    console.error(`Admin panel at http://${config.host}:${config.port}${ADMIN_PREFIX}`);
  }
  if (!isLoopbackHost(config.host) && config.auth.mode === "off") {
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

/** What the door decided: turn the request away, or let it in at some level. */
type Admission = { ok: false; failure: AuthFailure } | { ok: true; readOnly: boolean };

/**
 * Decide whether a request runs at all, and with which tools, before any tool runs.
 *
 * Authorization happens here rather than inside the tool handlers because a
 * request carries exactly one library-id header, so the whole request is
 * already scoped to one workspace. Checking once at the door means no handler
 * can be added later that forgets to check — and the same applies to the
 * read/write level, which is why it is resolved here and handed to
 * `buildServer` rather than consulted tool by tool.
 *
 * Two independent sources can make a request read-only, and the more
 * restrictive wins: the member's grant (authoritative, set by an admin) and the
 * client's own `read-only` header (voluntary, set where the client is
 * configured). A client can therefore drop privileges it holds, and can never
 * claim any it does not.
 */
async function admitRequest(
  config: Config,
  controlPlane: ControlPlaneStore | undefined,
  req: http.IncomingMessage
): Promise<Admission> {
  const rawLibraryId = req.headers["library-id"];
  const libraryId = Array.isArray(rawLibraryId) ? rawLibraryId[0] : rawLibraryId;
  const clientAsked = readOnlyRequested(req.headers);

  // Refused for everyone, authenticated or not, and before anything else:
  // sanitizeLibraryId would throw on this too, but only once a tool is already
  // running, which surfaces as a 200 carrying a JSON-RPC error rather than as
  // the refusal it is.
  if (libraryId && isReservedLibraryId(libraryId)) {
    return {
      ok: false,
      failure: { reason: "forbidden", status: 403, message: `No access to workspace "${libraryId}"` },
    };
  }

  // With auth off, a missing or unknown library-id is still handled downstream
  // as a tool error, which is the long-standing behaviour for a local daemon.
  // There are no grants in this mode, so the client's own header is the only
  // thing that can make the connection read-only.
  if (!controlPlane) return { ok: true, readOnly: clientAsked };

  const auth = await authenticate(bearerFrom(req.headers.authorization), controlPlane);
  if (!auth.ok) return { ok: false, failure: auth.failure };

  if (!libraryId) {
    return {
      ok: false,
      failure: { reason: "forbidden", status: 403, message: 'Missing required "library-id" header' },
    };
  }

  const allowed = authorizeWorkspace(auth.principal, libraryId);
  if (!allowed.ok) return { ok: false, failure: allowed.failure };

  // Best effort: a failure to record usage must not fail the request.
  void controlPlane.touchKeyUsed(auth.principal.keyId).catch(() => undefined);
  return { ok: true, readOnly: allowed.access === "read" || clientAsked };
}

async function handleMcpRequest(
  deps: ServerDeps,
  config: Config,
  controlPlane: ControlPlaneStore | undefined,
  req: http.IncomingMessage,
  res: http.ServerResponse
): Promise<void> {
  const admission = await admitRequest(config, controlPlane, req);
  if (!admission.ok) {
    const { failure } = admission;
    const headers: Record<string, string> = { "content-type": "application/json" };
    if (failure.status === 401) {
      headers["www-authenticate"] = 'Bearer realm="mem-port"';
    }
    res.writeHead(failure.status, headers);
    res.end(JSON.stringify({ error: failure.message }));
    return;
  }

  // Stateless mode: a fresh McpServer + transport per request, closing over the
  // library-id-resolved session inside tool handlers. Avoids a class of bugs
  // where a long-lived MCP session receives a different library-id on a later call.
  // It is also what makes the read-only tool set enforceable rather than
  // advisory: this server is built for this request and discarded after it.
  const server = buildServer(deps, { readOnly: admission.readOnly });
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
