import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerAppResource, RESOURCE_MIME_TYPE } from "@modelcontextprotocol/ext-apps/server";
import { surfaceEnabled, type Extra } from "./format.js";
import { APP_HTML } from "./ui/generated.js";
import type { View } from "./view.js";

/**
 * MCP Apps (`io.modelcontextprotocol/ui`) surface for the read tools.
 *
 * Spec: https://modelcontextprotocol.io/extensions/apps/overview
 *
 * Rather than attaching a rendered UI to the result, each read tool declares
 * `_meta.ui.resourceUri` in its *definition*, pointing at the single `ui://`
 * resource registered here. The host fetches that HTML — possibly before the
 * tool is even called — renders it in a sandboxed iframe, then pushes the tool
 * result in over postMessage.
 *
 * So the app is one generic renderer that has to work for all nine read tools,
 * and the per-call data reaches it on the result's `_meta` rather than in the
 * HTML. That is why there is one template here and not nine.
 */

/** One template for every read tool; the view model on the result decides what it draws. */
export const APP_RESOURCE_URI = "ui://mem-port/results.html";

/** Where the view model rides on the tool result, for the app to pick up. */
export const VIEW_META_KEY = "mem-port/view";

/** Per-client off switch, set next to `library-id` in the client's MCP config. */
const HEADER_NAME = "mcp-apps";

const ENV_VARS = ["MEM_PORT_MCP_APPS", "MCP_APPS"];

export function appsEnabled(extra: Extra): boolean {
  return surfaceEnabled(extra, HEADER_NAME, ENV_VARS);
}

/**
 * The `_meta` a read tool's *definition* carries. `registerAppTool` mirrors this
 * onto the deprecated `ui/resourceUri` key as well, for older hosts.
 */
export function appToolMeta(): { ui: { resourceUri: string } } {
  return { ui: { resourceUri: APP_RESOURCE_URI } };
}

/** The `_meta` a read tool's *result* carries: the view model the app renders. */
export function appViewMeta(extra: Extra, view: View): Record<string, unknown> | undefined {
  if (!appsEnabled(extra)) return undefined;
  return { [VIEW_META_KEY]: view };
}

/**
 * Serve the app HTML.
 *
 * The page is fully self-contained — the bundler inlines the ext-apps client
 * and the stylesheet into the markup — because the host renders it under a
 * deny-by-default CSP. Anything loaded from a separate origin would be blocked,
 * so `_meta.ui.csp` stays unset rather than granting permissions we don't use.
 */
export function registerAppUi(server: McpServer): void {
  registerAppResource(
    server,
    "mem-port results",
    APP_RESOURCE_URI,
    {
      description: "Renders mem-port memories, skills, ADRs and episodes as cards.",
      mimeType: RESOURCE_MIME_TYPE,
    },
    async () => ({
      contents: [{ uri: APP_RESOURCE_URI, mimeType: RESOURCE_MIME_TYPE, text: APP_HTML }],
    })
  );
}
