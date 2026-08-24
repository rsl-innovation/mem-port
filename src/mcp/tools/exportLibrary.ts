import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { libraryIdOf, resolveLibrary } from "../resolveLibrary.js";
import type { ServerDeps } from "../buildServer.js";
import { exportBundle } from "../../port/exportBundle.js";
import { MEMORY_TYPES } from "../../interfaces/memories.interface.js";

export function registerExportLibrary(server: McpServer, deps: ServerDeps): void {
  server.registerTool(
    "export_library",
    {
      description: "Export this library to a portable .memport.json bundle file — for backup, moving to a new machine, or sharing with someone else.",
      inputSchema: {
        memory_types: z
          .array(z.enum(MEMORY_TYPES))
          .optional()
          .describe('Only export memories of these types, e.g. ["decision", "reference"]. Omit to export all memory types.'),
        since: z
          .string()
          .datetime()
          .optional()
          .describe("ISO 8601 timestamp — only export memories created at or after this time. Omit to export the full history."),
      },
    },
    async (args, extra) => {
      const store = await resolveLibrary(extra, deps.store);
      const libraryId = libraryIdOf(extra);

      const hasScope = args.memory_types || args.since;
      const bundle = await exportBundle(
        store,
        libraryId,
        { id: deps.embeddings.id, dimensions: deps.embeddings.dimensions },
        hasScope ? { memoryTypes: args.memory_types, since: args.since } : undefined
      );

      const exportsDir = path.join(deps.dataDir, "exports");
      await mkdir(exportsDir, { recursive: true });
      const fileName = `${libraryId.replace(/[^a-zA-Z0-9_-]/g, "_")}-${Date.now()}.memport.json`;
      const filePath = path.join(exportsDir, fileName);
      await writeFile(filePath, JSON.stringify(bundle, null, 2), "utf-8");

      return {
        content: [
          {
            type: "text" as const,
            text: `Exported ${bundle.entities.length} entities, ${bundle.episodes.length} episodes, ${bundle.memories.length} memories, ${bundle.skills.length} skills, ${bundle.adrs.length} ADRs to ${filePath}`,
          },
        ],
      };
    }
  );
}
