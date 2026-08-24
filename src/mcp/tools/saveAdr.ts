import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { resolveLibrary } from "../resolveLibrary.js";
import type { ServerDeps } from "../buildServer.js";
import { ADR_STATUSES } from "../../interfaces/adrs.interface.js";
import { formatAdrNumber } from "../format.js";
import { saveAdr } from "../../services/adrs.js";

export function registerSaveAdr(server: McpServer, deps: ServerDeps): void {
  server.registerTool(
    "save_adr",
    {
      description:
        "Record an architectural decision — a consequential technical choice whose reasoning will matter later. ADRs live in the same shared knowledge graph as memories and skills, so any copilot connected to this library-id can recall why something was decided. Call this when a choice is made between real alternatives (a library, a data model, a protocol, a tradeoff), not for routine implementation details. Prefer this over save_memory for decisions: it keeps the problem framing, the rejected options, and the supersede chain that a plain memory loses.",
      inputSchema: {
        title: z
          .string()
          .min(1)
          .describe('A short statement of the decision, e.g. "Use SurrealDB for embedded storage".'),
        context: z
          .string()
          .min(1)
          .describe(
            "The situation and forces that made this decision necessary — the problem, constraints, and pressures in play. search_adrs matches heavily against this, because people usually search by the problem (\"why aren't we using Postgres?\") rather than the answer."
          ),
        decision: z.string().min(1).describe("What was actually decided, stated plainly and in the active voice."),
        consequences: z
          .string()
          .optional()
          .describe("What this makes easier, harder, or impossible afterwards — including the costs knowingly accepted."),
        alternatives: z
          .string()
          .optional()
          .describe("Options considered and rejected, with the reason each lost. Omit if there were no real contenders."),
        status: z
          .enum(ADR_STATUSES)
          .optional()
          .describe(
            'Lifecycle state. "proposed" for a decision still under discussion, "accepted" once it is in force, "deprecated" for one no longer followed. Defaults to "proposed". You do not need to set "superseded" by hand — passing \'supersedes\' on a newer ADR sets it automatically.'
          ),
        supersedes: z
          .union([z.string(), z.number().int()])
          .optional()
          .describe(
            'The earlier ADR this one replaces — a record id ("adr:x9k2"), a number (3), or its display form ("ADR-0003"). The earlier ADR is automatically marked "superseded".'
          ),
        tags: z.array(z.string()).optional().describe('Free-form categories, e.g. ["storage", "infra"]. Omit if none apply.'),
        source: z
          .string()
          .optional()
          .describe(
            'Which copilot/tool recorded this ADR, e.g. "claude-code", "cursor", or "manual" for something entered by hand. Defaults to "manual".'
          ),
        decided_at: z
          .string()
          .datetime()
          .optional()
          .describe("ISO 8601 timestamp of when the decision was made. Defaults to now — set it when back-filling an older decision."),
        entity_refs: z
          .array(z.string())
          .optional()
          .describe(
            'Names of people, projects, or systems this decision concerns, e.g. ["checkout-service"]. Each is created as a new entity if it doesn\'t already exist.'
          ),
      },
    },
    async (args, extra) => {
      const store = await resolveLibrary(extra, deps.store);

      const outcome = await saveAdr(store, deps.embeddings, args);

      const supersedeNote = outcome.supersededId ? `, superseding ${outcome.supersededId}` : "";
      return {
        content: [
          {
            type: "text" as const,
            text: `Saved ${formatAdrNumber(outcome.number)} (${outcome.id})${supersedeNote}`,
          },
        ],
      };
    }
  );
}
