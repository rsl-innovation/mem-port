import { readFile } from "node:fs/promises";
import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { resolveLibrary } from "../resolveLibrary.js";
import type { ServerDeps } from "../buildServer.js";
import { bundleSchema } from "../../port/bundleSchema.js";
import { importBundle } from "../../port/importBundle.js";

export function registerImportLibrary(server: McpServer, deps: ServerDeps): void {
  server.registerTool(
    "import_library",
    {
      description: "Import a .memport.json bundle into this library.",
      inputSchema: {
        bundle_path: z
          .string()
          .optional()
          .describe(
            'Absolute path to a .memport.json file on disk (as returned by export_library), e.g. "/Users/me/Library/Application Support/mem-port/exports/personal-1234.memport.json". Provide this or \'bundle\', not both.'
          ),
        bundle: z
          .record(z.string(), z.unknown())
          .optional()
          .describe("The bundle's JSON contents directly, as an alternative to bundle_path — use when you already have the bundle in memory rather than as a file on disk."),
        mode: z
          .enum(["merge", "overwrite"])
          .default("merge")
          .describe(
            "'merge' dedupes against what's already in this library (entities by name+type, memories/episodes by content) and only adds what's new. 'overwrite' deletes everything in this library first, then imports the bundle fresh."
          ),
        on_conflict: z
          .enum(["skip", "update"])
          .optional()
          .describe(
            "In 'merge' mode, what to do when a record already exists: 'skip' leaves the existing record untouched (default), 'update' overwrites it with the bundle's version."
          ),
        dry_run: z
          .boolean()
          .optional()
          .describe("If true, reports what would be created/updated/skipped without writing anything — use to preview an import before committing to it."),
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

      const store = await resolveLibrary(extra, deps.store);
      const result = await importBundle(store, parsed.data, {
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
