import { App, applyDocumentTheme, applyHostFonts, applyHostStyleVariables } from "@modelcontextprotocol/ext-apps";
import { renderDetail, renderList, renderMessage, viewFrom } from "./render.js";

/**
 * The mem-port MCP App: one renderer for all nine read tools.
 *
 * Runs inside the host's sandboxed iframe. It never talks to the daemon —
 * everything it draws arrives on the tool result the host pushes in, so there
 * is no second code path that could disagree with the text block the model saw.
 */

const root = document.getElementById("root") as HTMLElement;

/**
 * Adopt the host's own palette, font and weights.
 *
 * This is what keeps the panel from looking like a foreign widget: on a host
 * that publishes its tokens, every colour and the typeface come from that
 * host's design system rather than from our approximation of it. The CSS
 * fallbacks only apply where a host publishes nothing.
 */
function applyHostStyling(context: Record<string, any> | undefined): void {
  if (!context) return;

  applyDocumentTheme(context.theme === "dark" ? "dark" : "light");

  const variables = context.styles?.variables;
  if (variables) applyHostStyleVariables(variables);

  const fonts = context.styles?.css?.fonts;
  if (fonts) applyHostFonts(fonts);
}

const app = new App({ name: "mem-port", version: "1.0.0" });

app.ontoolresult = (result) => {
  const view = viewFrom(result);
  if (!view) {
    root.replaceChildren(renderMessage("No results to display."));
    return;
  }
  root.replaceChildren(view.kind === "list" ? renderList(view) : renderDetail(view));
};

app.onhostcontextchanged = (context) => applyHostStyling(context as Record<string, any>);

void app.connect().then(() => applyHostStyling(app.getHostContext() as Record<string, any> | undefined));
