import { headerFlag, type FlagHeaders } from "./format.js";

/**
 * The client's own read-only switch, set next to `library-id` where the MCP
 * client is configured:
 *
 *     "headers": { "library-id": "team-kb", "read-only": "1" }
 *
 * This is the client restricting *itself* — useful for a CI job, a shared
 * screen, or a copilot you would rather not have writing into a curated
 * library. It can only ever remove tools: a member whose grant says `read`
 * stays read-only no matter what this header says, because the grant is
 * resolved separately and the more restrictive of the two wins.
 *
 * Unlike the `mcp-apps` surface toggle there is no environment variable here.
 * A daemon-wide read-only switch would be a deployment-level claim the control
 * plane already expresses per member, and having two answers to "can this
 * write?" is how they end up disagreeing.
 */
export const READ_ONLY_HEADER = "read-only";

/** Whether a request's own headers ask for a read-only tool set. Off unless asked. */
export function readOnlyRequested(headers: FlagHeaders): boolean {
  return headerFlag(headers, READ_ONLY_HEADER, [], false);
}
