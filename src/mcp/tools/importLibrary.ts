import { readFile } from "node:fs/promises";
import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { Surreal } from "surrealdb";
import { resolveLibrary } from "../resolveLibrary.js";
import { bundleSchema } from "../../port/bundleSchema.js";
import { importBundle } from "../../port/importBundle.js";

export function registerImportLibrary(server: McpServer, root: Surreal): void {
  server.registerTool(
    "import_library",
    {
      description: "Import a .memport.json bundle into this library.",
      inputSchema: {
        bundle_path: z.string().optional().describe("Path to a .memport.json file"),
        bundle: z.record(z.string(), z.unknown()).optional().describe("Inline bundle, alternative to bundle_path"),
        mode: z.enum(["merge", "overwrite"]).default("merge"),
        on_conflict: z.enum(["skip", "update"]).optional().describe("Defaults to 'skip'"),
        dry_run: z.boolean().optional(),
      },
    },
    async (args, extra) => {
      if (!args.bundle_path && !args.bundle) {
        return {
          content: [{ type: "text" as const, text: "Provide either 'bundle_path' or 'bundle'" }],
          isError: true,
        };
      }

      const raw = args.bundle_path ? JSON.parse(await readFile(args.bundle_path, "utf-8")) : args.bundle;
      const parsed = bundleSchema.safeParse(raw);
      if (!parsed.success) {
        return {
          content: [{ type: "text" as const, text: `Invalid bundle: ${parsed.error.message}` }],
          isError: true,
        };
      }

      const session = await resolveLibrary(extra, root);
      const result = await importBundle(session, parsed.data, {
        mode: args.mode,
        onConflict: args.on_conflict,
        dryRun: args.dry_run,
      });

      return {
        content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }],
      };
    }
  );
}
