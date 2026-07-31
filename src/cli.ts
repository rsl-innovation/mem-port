#!/usr/bin/env node
import { parseArgs } from "node:util";
import { startDaemon } from "./daemon.js";
import { callTool } from "./mcpClient.js";

const USAGE = `Usage:
  mem-port serve [--port <port>] [--data-dir <dir>]
  mem-port export --library-id <id> [--port <port>] [--memory-types t1,t2] [--since <iso date>]
  mem-port import --library-id <id> --in <path> [--mode merge|overwrite] [--on-conflict skip|update] [--dry-run] [--port <port>]`;

async function main(): Promise<void> {
  const [, , command, ...rest] = process.argv;

  switch (command) {
    case "serve":
    case undefined: {
      const { values } = parseArgs({
        args: rest,
        options: {
          port: { type: "string" },
          "data-dir": { type: "string" },
        },
      });
      await startDaemon({
        port: values.port ? Number(values.port) : undefined,
        dataDir: values["data-dir"],
      });
      break;
    }

    case "export": {
      const { values } = parseArgs({
        args: rest,
        options: {
          "library-id": { type: "string" },
          port: { type: "string", default: "8787" },
          "memory-types": { type: "string" },
          since: { type: "string" },
        },
      });
      if (!values["library-id"]) {
        console.error(USAGE);
        process.exit(1);
      }
      const result = await callTool(Number(values.port), values["library-id"], "export_library", {
        memory_types: values["memory-types"]?.split(","),
        since: values.since,
      });
      console.log(result.content[0]?.text);
      break;
    }

    case "import": {
      const { values } = parseArgs({
        args: rest,
        options: {
          "library-id": { type: "string" },
          in: { type: "string" },
          mode: { type: "string", default: "merge" },
          "on-conflict": { type: "string" },
          "dry-run": { type: "boolean" },
          port: { type: "string", default: "8787" },
        },
      });
      if (!values["library-id"] || !values.in) {
        console.error(USAGE);
        process.exit(1);
      }
      const result = await callTool(Number(values.port), values["library-id"], "import_library", {
        bundle_path: values.in,
        mode: values.mode,
        on_conflict: values["on-conflict"],
        dry_run: values["dry-run"],
      });
      console.log(result.content[0]?.text);
      break;
    }

    default:
      console.error(`Unknown command: ${command}`);
      console.error(USAGE);
      process.exit(1);
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
