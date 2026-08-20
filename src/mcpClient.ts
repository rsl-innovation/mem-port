type TextBlock = { type: "text"; text: string };

/**
 * Read tools append an A2UI resource block after their text block (see
 * mcp/a2ui.ts), so content is no longer text-only. The text block stays first,
 * which is what callers here read.
 */
type ResourceBlock = { type: "resource"; resource: { uri: string; mimeType: string; text: string } };

interface ToolCallResult {
  content: Array<TextBlock | ResourceBlock>;
  isError?: boolean;
}

/** The text block a tool returned, ignoring any A2UI resource alongside it. */
export function firstText(result: ToolCallResult): string | undefined {
  return result.content.find((block): block is TextBlock => block.type === "text")?.text;
}

/**
 * A minimal MCP-over-HTTP client for the CLI's export/import subcommands.
 * Talks to a running `mem-port serve` daemon exactly like any other MCP
 * client would, over the same Streamable HTTP endpoint with the same
 * library-id header — no separate DB access path for the CLI.
 */
export async function callTool(
  port: number,
  libraryId: string,
  name: string,
  args: Record<string, unknown>
): Promise<ToolCallResult> {
  let res: Response;
  try {
    res = await fetch(`http://127.0.0.1:${port}/mcp`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        accept: "application/json, text/event-stream",
        "library-id": libraryId,
      },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: args } }),
    });
  } catch {
    throw new Error(`Couldn't reach mem-port daemon on port ${port}. Is it running? (npx mem-port serve)`);
  }

  if (!res.ok) {
    throw new Error(`mem-port daemon returned HTTP ${res.status}`);
  }

  const text = await res.text();
  const dataLine = text.split("\n").find((line) => line.startsWith("data: "));
  const payload = JSON.parse(dataLine ? dataLine.slice("data: ".length) : text) as {
    error?: { message: string };
    result?: ToolCallResult;
  };

  if (payload.error) {
    throw new Error(`MCP error: ${payload.error.message}`);
  }
  if (!payload.result) {
    throw new Error("Malformed MCP response: missing result");
  }
  if (payload.result.isError) {
    throw new Error(`Tool error: ${firstText(payload.result)}`);
  }

  return payload.result;
}
