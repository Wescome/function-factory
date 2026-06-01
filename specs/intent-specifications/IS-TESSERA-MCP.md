---
id: IS-TESSERA-MCP
version: 1
title: "Tessera MCP — JSON-RPC server exposing Tessera tools over HTTP"
sourceCapabilityId: BC-TESSERA-MCP
sourceFunctionId: FP-TESSERA-MCP
source_refs:
  - TESSERA-CF-SPEC
  - IS-TESSERA-ARANGO-SCHEMA
  - IS-TESSERA-INDEXER
  - IS-TESSERA-IMPACT
  - IS-TESSERA-SEARCH
explicitness: explicit
rationale: >
  TESSERA-CF-SPEC §7 specifies the MCP endpoint — `POST /mcp`, JSON-RPC 2.0 over
  HTTP, bearer auth — as the primary interface (UC-7). It is the transparent
  replacement for the local `localhost:4747` MCP server: a Claude Code config
  swap to the cloud URL is zero-code for the V1 tools (§7, "transparent swap").

  This IS scopes the V1 MCP tool surface to the set named in the task contract:
  `tessera_list_repos`, `tessera_impact`, `tessera_context`, `tessera_query`,
  `tessera_cypher` (read-only AQL pass-through), and `tessera_detect_changes`. It
  composes the impact (IS-TESSERA-IMPACT) and search (IS-TESSERA-SEARCH) routes
  behind JSON-RPC, adds `context` and `detect_changes` as new graph reads, and
  enforces bearer auth before any DB call. The 13-tool full surface (route_map,
  tool_map, shape_check, api_impact, plus V2 rename/group_*) is the broader §7
  scope; this IS delivers the named V1 core.
---

# Tessera MCP Server (WP-T3 MCP endpoint)

## JTBD

When an agent (Claude Code, GasCity) or a human needs graph intelligence over
the MCP protocol from anywhere — impact, context, search, raw query, change
detection — they want a single authenticated JSON-RPC endpoint that behaves
exactly like the local Tessera MCP server, so that swapping `localhost:4747` for
the cloud URL requires zero code change.

## Problem

Tessera's primary interface is MCP (UC-7): agents call `tessera_impact`,
`tessera_context`, `tessera_query` over JSON-RPC. The local server runs on
`localhost:4747` — unreachable from Cloudflare Workers and Containers, and
personal to one machine (TESSERA-CF-SPEC §1).

The impact and search logic now exist as HTTP routes (IS-TESSERA-IMPACT,
IS-TESSERA-SEARCH), but there is no MCP protocol layer in front of them, no
`context` or `detect_changes` graph reads, no `cypher` pass-through, no
`list_repos` enumeration, and no auth gate. Without this:
- No agent can reach Tessera over MCP from the cloud.
- The transparent `localhost:4747` → cloud swap is impossible.

The swap must be **transparent**: the V1 tools return identical results to the
local server (the config change is zero-code), and auth must reject before any DB
work so an unauthenticated probe never touches the graph.

## Goal

Implement `workers/tessera-worker/src/mcp.ts` and the Worker entrypoint
`workers/tessera-worker/src/index.ts`:

`POST /mcp` — MCP JSON-RPC 2.0 handler. Auth: `Authorization: Bearer
<TESSERA_QUERY_TOKEN>` required on every request, checked before any DB call.

V1 tools (implement all):
- `tessera_list_repos` — enumerate `tessera_meta`: name/commit/stats/indexed_at
  per repo.
- `tessera_impact` — delegate to IS-TESSERA-IMPACT.
- `tessera_context` — 360° view of a symbol: callers (INBOUND 1 hop), callees
  (OUTBOUND 1 hop), file location, kind, process membership.
- `tessera_query` — delegate to IS-TESSERA-SEARCH.
- `tessera_cypher` — read-only AQL pass-through; block
  INSERT/UPDATE/DELETE/DROP.
- `tessera_detect_changes` — map changed line ranges to overlapping symbols,
  return them plus their depth-1 upstream impact.

Tool names use the `tessera_` underscore prefix matching the Claude Code MCP
config format.

## Scope

**In scope:**
- `workers/tessera-worker/src/index.ts` — Worker entrypoint, route table
  (`/mcp`, plus the `/repos/:slug/*` routes from IS-TESSERA-IMPACT /
  IS-TESSERA-SEARCH / IS-TESSERA-INDEXER), 404 fallback.
- `workers/tessera-worker/src/mcp.ts` — MCP JSON-RPC 2.0 handler: `tools/list`,
  `tools/call`, error responses; bearer auth gate.
- `tessera_list_repos`, `tessera_context`, `tessera_cypher`,
  `tessera_detect_changes` — implemented here.
- `tessera_impact`, `tessera_query` — delegated to IS-TESSERA-IMPACT /
  IS-TESSERA-SEARCH.

**Out of scope:**
- Impact traversal logic (IS-TESSERA-IMPACT).
- BM25 search logic (IS-TESSERA-SEARCH).
- Schema / indexer (their own IS files).
- V2 tools `rename`, `group_list`, `group_sync` — these return the explicit "not
  available in cloud V1" MCP error (§7, AC-MCP-2), but their implementation is
  V2.
- The full 13-tool surface's `route_map`, `tool_map`, `shape_check`,
  `api_impact` — broader §7 scope; not in this IS's named V1 set. (They may
  return the not-available error or be added in a follow-up IS; this IS does not
  block on them.)
- Semantic `query` input (V2, §6.3).
- Process enrichment in `context`/`detect_changes` — V2-deferred (§4.3); V1
  returns empty process membership.

## Acceptance Criteria

### Auth (AC-AUTH*)

**AC-AUTH1.** Every `POST /mcp` request requires `Authorization: Bearer
<TESSERA_QUERY_TOKEN>`. A missing or invalid token → **401 before any DB call**
(before resolving symbols, before any AQL). Comparison is constant-time.

**AC-AUTH2.** A valid token proceeds to JSON-RPC dispatch. The token is read-only
scope (G1) — no MCP tool in this IS mutates ArangoDB.

### JSON-RPC protocol (AC-RPC*)

**AC-RPC1.** `POST /mcp` speaks JSON-RPC 2.0. `tools/list` returns the V1 tool
descriptors; `tools/call` dispatches to the named tool.

**AC-RPC2.** An unknown tool name → a JSON-RPC **error response** (MCP error
object), NOT an HTTP 404 and NOT a 500. The response carries a JSON-RPC `error`
with a clear message naming the unknown tool.

**AC-RPC3.** A malformed JSON-RPC envelope → a JSON-RPC error response with the
appropriate code (e.g. -32600 invalid request / -32700 parse error), not an
unhandled 500.

**AC-RPC4.** V2 tools (`rename`, `group_list`, `group_sync`) return the explicit
"not available in cloud V1" structured MCP error — never a 500 or a wrong answer
(AC-MCP-2). The swap degrades explicitly, never silently (§7).

### Tools (AC-TOOL*)

**AC-TOOL1 — `tessera_list_repos`.** Reads all `tessera_meta` documents and
returns, per repo: `name` (full repo), `slug`, `commit`, `stats`
(`nodeCount`/`edgeCount`), and `indexed_at`. Includes index-status (e.g. DLQ /
last-job state) so ops can see a failed index (IS-TESSERA-INDEXER AC-R3, UC-8).

**AC-TOOL2 — `tessera_impact`.** Delegates to the IS-TESSERA-IMPACT route with
`{ target, repo, direction?, maxDepth? }`. Returns the impact result (risk,
impactedCount, depth-grouped impacted set). The `repo` argument is mapped to
`slug` via `tessera_meta` / `slugForRepo`.

**AC-TOOL3 — `tessera_context`.** Given a symbol `name` (and `repo`), returns:
- **callers** — INBOUND 1 hop over `tessera_edges_{slug}`.
- **callees** — OUTBOUND 1 hop.
- **file location** — `filePath`, `startLine`/`endLine`.
- **kind**.
- **process membership** — via `STEP_IN_PROCESS` edges to `Process` nodes (V1:
  process detection is V2-deferred, so this is empty until V2, §4.3; the field is
  present and returns `[]`).
Reads `tessera_nodes_{slug}` + `tessera_edges_{slug}`. Ambiguous names resolve to
ranked candidates (§5.3), same as impact.

**AC-TOOL4 — `tessera_query`.** Delegates to the IS-TESSERA-SEARCH route with
`{ query, repo, limit?, kinds? }`. Returns ranked symbol definitions.

**AC-TOOL5 — `tessera_cypher`.** A read-only query pass-through to ArangoDB AQL.
It **blocks** any query containing `INSERT`, `UPDATE`, `REMOVE`, `REPLACE`,
`DELETE`, or `DROP` (and the Cypher write keywords `CREATE`, `SET`, `MERGE`) —
write attempts are rejected at parse time with a JSON-RPC error, before
execution (G1, §7.1). The AQL issued is read-only. Arbitrary/unsupported input
returns `unsupported_in_cloud_v1` with an AQL-equivalent hint where applicable
(§7.1).

**AC-TOOL6 — `tessera_detect_changes`.** Given `{ changedFiles: [{ path,
addedLines, removedLines }] }` (and `repo`), finds nodes whose
`startLine`/`endLine` overlap the changed line ranges:
```aql
FOR n IN tessera_nodes_{slug}
  FILTER n.filePath == @path AND n.startLine <= @line AND n.endLine >= @line
  RETURN n
```
then returns the affected symbols plus their **depth-1 upstream impact** (via
IS-TESSERA-IMPACT, direction upstream, maxDepth 1). The caller supplies the diff
hunks — the Worker has no local git tree (§7.2).

### Tool naming (AC-NAME*)

**AC-NAME1.** All tool names use the `tessera_` underscore prefix
(`tessera_impact`, `tessera_context`, …), matching the Claude Code MCP config
format. `tools/list` advertises exactly these names.

### Transparent swap (AC-SWAP*)

**AC-SWAP1.** Pointing a Claude Code MCP config from `localhost:4747` to the
cloud `/mcp` URL is zero-code for the V1 tools: each returns results identical to
the local server for the same indexed commit (AC-MCP-1).

### Reference results (AC-REF*)

**AC-REF1.** A `tools/call` request
```json
{"jsonrpc":"2.0","method":"tools/call",
 "params":{"name":"tessera_impact",
           "arguments":{"target":"notifyWorkflowComplete","repo":"function-factory"}}}
```
returns the correct impact result (IS-TESSERA-IMPACT AC-REF1: risk LOW,
impactedCount 4, d=1 callers including `alarm`, `handleStageComplete`,
`handleForceComplete`).

**AC-REF2.** A request with no `Authorization` header → 401 **before any DB
call** (AC-AUTH1).

**AC-REF3.** A `tools/call` for an unknown tool name → a JSON-RPC error response
(not a 404, not a 500) (AC-RPC2).

## Environment dependencies

| Env var | wrangler.jsonc | Purpose |
|---------|----------------|---------|
| `TESSERA_QUERY_TOKEN` | secret | Bearer auth on `/mcp` and all query routes |
| `ARANGO_URL` | secret | ArangoDB connection URL |
| `ARANGO_USERNAME` | secret | ArangoDB user |
| `ARANGO_PASSWORD` | secret | ArangoDB password |
| `ARANGO_DATABASE` | var (`"function_factory"`) | ArangoDB database name |

The MCP layer reads the per-repo node/edge collections and `tessera_meta`. It
performs no writes (G1). It composes the impact and search routes and adds the
`context`, `cypher`, `detect_changes`, and `list_repos` reads.

## Non-negotiables

- Bearer auth (`TESSERA_QUERY_TOKEN`) checked **before any DB call**; missing /
  invalid → 401 (AC-AUTH1).
- Unknown tool → JSON-RPC error response, never a 404 or 500 (AC-RPC2).
- `tessera_cypher` is **read-only**: INSERT/UPDATE/DELETE/DROP (and Cypher
  CREATE/SET/MERGE) blocked at parse time, before execution (AC-TOOL5, G1, §7.1).
- No MCP tool in this IS mutates ArangoDB — the graph is read-only to agents
  (G1).
- Tool names use the `tessera_` underscore prefix (AC-NAME1).
- V2 tools degrade explicitly with a not-available MCP error, never silently
  (AC-RPC4, §7).
- The cloud swap is transparent for V1 tools — identical results to local
  (AC-SWAP1).

## Success Metrics

`POST /mcp` is a JSON-RPC 2.0 server exposing the V1 Tessera tools
(`tessera_list_repos`, `tessera_impact`, `tessera_context`, `tessera_query`,
`tessera_cypher`, `tessera_detect_changes`) with bearer auth enforced before any
database work. A `tools/call` for `tessera_impact` on `notifyWorkflowComplete`
returns the correct impact result; a request with no auth header is rejected with
401 before any DB call; and an unknown tool yields a JSON-RPC error response, not
a 404.

The endpoint is a transparent replacement for `localhost:4747`: pointing a Claude
Code MCP config at the cloud URL is zero-code for every V1 tool, each returning
results identical to the local server for the same indexed commit. `context`
returns a symbol's callers, callees, location, kind, and (V2-deferred) process
membership; `detect_changes` maps diff hunks to overlapping symbols and their
depth-1 upstream impact; `cypher` is a read-only AQL pass-through that blocks
every write keyword at parse time; and V2 tools degrade explicitly with a
not-available error. The graph stays read-only to agents throughout (G1).
