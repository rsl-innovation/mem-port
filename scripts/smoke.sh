#!/usr/bin/env bash
# Plain-curl smoke test against a running `mem-port serve` daemon.
# No Inspector/Node dependency — usable in CI. Assumes the daemon is already
# running (start it with `npx tsx src/cli.ts serve` or `mem-port serve`).
set -euo pipefail

PORT="${MEM_PORT_PORT:-8787}"
LIBRARY_ID="smoke-test-$$"
BASE_URL="http://127.0.0.1:${PORT}/mcp"

call() {
  curl -sf -X POST "$BASE_URL" \
    -H 'content-type: application/json' \
    -H 'accept: application/json, text/event-stream' \
    -H "library-id: ${LIBRARY_ID}" \
    -d "$1"
}

echo "== tools/list =="
call '{"jsonrpc":"2.0","id":1,"method":"tools/list"}' | grep -q '"name":"save_memory"' \
  && echo "ok: save_memory tool is registered" || { echo "FAIL: save_memory tool missing"; exit 1; }

echo "== save_memory =="
SAVE_RESULT=$(call '{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"save_memory","arguments":{"content":"smoke test memory about durable local storage","memory_type":"fact"}}}')
echo "$SAVE_RESULT" | grep -q 'Saved memory' \
  && echo "ok: memory saved" || { echo "FAIL: save_memory did not return a saved id: $SAVE_RESULT"; exit 1; }

echo "== search_memory =="
SEARCH_RESULT=$(call '{"jsonrpc":"2.0","id":3,"method":"tools/call","params":{"name":"search_memory","arguments":{"query":"local storage durability"}}}')
echo "$SEARCH_RESULT" | grep -q 'smoke test memory' \
  && echo "ok: semantic search found the saved memory" || { echo "FAIL: search_memory did not find it: $SEARCH_RESULT"; exit 1; }

echo
echo "Smoke test passed."
