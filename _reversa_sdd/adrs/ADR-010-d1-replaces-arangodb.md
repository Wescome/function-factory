# ADR-010: Replace ArangoDB with Cloudflare D1 for All Operational State

> Retroactive ADR — decision implemented across PRs #78–#82, 2026-06-09
> Confidence: 🟢 CONFIRMED — d1-schema.sql, packages/db-client/src/index.ts, PR #80 commit message

---

## Status

**Accepted** (implemented)

---

## Context

Function Factory originally used ArangoDB (running in a CF Container Worker `ff-arango`) for all persistent storage: artifact graph, operational state, dispatch logs, and bead metadata. As the system matured, several forces pushed toward replacing it:

1. **Query errors in production** — All governor Q1-Q9 prefetch queries were written in AQL but running against a D1 (SQLite) backend. They threw syntax errors silently caught by `.catch(() => [])`, meaning every 15-minute governance cycle returned empty arrays. INV-5 lineage gap detection was marked "Implemented" but was dead (discovered in PR #78).

2. **AQL in D1 Workers** — The `arango-client` package had already been migrated internally to back Cloudflare D1 but kept the AQL wire protocol. This mismatch made every non-trivial query brittle.

3. **Container overhead** — ArangoDB running in a CF Container adds cold-start latency, a persistent external dependency, and an HTTP hop for every document access.

4. **D1 fits the operational data shape** — Dispatch logs, completion events, keepalive refcounts, and bead metadata are flat, time-bound operational records. They do not benefit from graph traversal. SQLite with `json_extract()` is sufficient.

---

## Decision

Replace ArangoDB with Cloudflare D1 (`ff-factory` database, id `6a72d5c3`) for **all worker operational state**. Specifically:

- All collections (specs_signals, dispatch_log, completion_events, fidelity_verdicts, specs_functions, etc.) are stored as rows in `documents(collection TEXT, key TEXT, json TEXT, created_at TEXT)`.
- Directed edges are stored in `edges(id TEXT, collection TEXT, from_id TEXT, to_id TEXT, data TEXT, created_at TEXT)`.
- All queries use SQLite syntax with `json_extract()` for field access and `?` positional placeholders.
- The `@factory/arango-client` package is renamed to `@factory/db-client` (PR #79, ~60 file change). The public API (`get`, `query`, `queryOne`, `save`, `update`, `saveEdge`, `ensureCollection`) is preserved. Consumers pass SQL with `?` placeholders instead of AQL.
- `traverse()` throws unconditionally. Any code requiring graph traversal must use recursive CTEs via `query()`.
- `ff-arango` Container Worker is retired as the primary storage backend.

**ArangoDB status post-migration:** ArangoDB references remain in `HotConfigLoader` and `DriftLedger` — these are the artifact graph collections (lineage_edges, drift_ledger) that span the full discovery pipeline. These are considered "artifact graph" workloads and were NOT migrated in this phase. The D1 migration covers operational state only.

> Note: ADR-0013 (LadybugDB closed-loop artifact graph, proposed in PR #78 commit) proposes replacing the remaining ArangoDB artifact graph with LadybugDB WASM in a CF Durable Object. That is a separate, future decision with 4 open architecture gates.

---

## Consequences

### Positive
- Queries execute inside the Worker process — no HTTP hop, no cold-start dependency on an external container.
- `json_extract()` is fast for the flat record shapes used in operational collections.
- D1's 8s query timeout budget is explicitly managed by `queryWithTimeout()` in autonomy-monitor, preventing hung Workers.
- Idempotency and conflict detection uses SQLite UNIQUE constraints and `409 conflict` error pattern matching.

### Negative / Constraints
- `traverse()` is gone. Any future code needing graph traversal must use recursive CTEs or denormalized fields.
- `json_each` in correlated subqueries is unsupported in D1 — must use `LIKE '%"value"%'` patterns instead (enforced in formula-compiler-adapter and ontology-loader).
- All consumers must use `{ json: string }` row shape and call `JSON.parse(row.json)` — raw column projection is not available without query rewrite.
- No migration system for D1 schema evolution. Schema changes require manual `wrangler d1 execute` or a migration script.
- The autonomy monitor caps all sweep queries at `LIMIT 100` per run — functions beyond that are deferred to the next cron cycle.

---

## Evidence

| Artifact | Notes |
|----------|-------|
| `workers/ff-pipeline/d1-schema.sql` | Canonical D1 schema (documents + edges tables, indexes) |
| `packages/db-client/src/index.ts` | D1-backed client; `traverse()` throws |
| `workers/ff-pipeline/src/gascity/autonomy-monitor.ts` | All SQL queries, `queryWithTimeout()`, LIMIT 100 caps |
| `workers/ff-pipeline/src/gascity/webhook-receiver.ts` | Single dispatch_log lookup via `json_extract(json,'$.gc_bead_id')` |
| PR #78 commit message | "silently returning empty arrays every 15-minute governance cycle" |
| PR #79 commit message | "~60 files" package rename |
| PR #80 commit message | D1 database_id `6a72d5c3` wired into ff-pipeline, ff-gates, ff-gateway |
