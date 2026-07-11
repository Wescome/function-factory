# KEEL — Cross-Run D1 Index Result (post-v1, final item)

**Status: GREEN \u2014 live-confirmed on the real deployment.** The last post-v1
item. Tested on local Miniflare D1 AND verified on the live D1 database
(`keel-crossrun`, `d5175ea9-...`): `/runs` returned two runs across separate DOs,
newest-first, `?terminal=ACCEPT` filtering correctly \u2014 `echo 42` (1 attempt,
ACCEPT) and `converge` (2 attempts, ACCEPT, with an Amendment node). Deployed
clean, no 501/502.
33/33 tests pass (32 prior + 1 new cross-run test). Unlike deploy/gateway, D1
runs in the local Workers runtime, so cross-run aggregation is proven here, not
just handed off.

## What was built

The per-run `crossRunRecord` projection (built + unit-tested in M4) is now fanned
out to a shared D1 index queryable across all runs:

- `src/domain/ports/cross-run-index.port.ts` — `CrossRunIndexPort` (driven,
  additive; the D4 "CQRS read side / D1 projection"). Substrate-free.
- `src/adapters/persistence/d1-cross-run.adapter.ts` — D1 implementation.
  `CREATE TABLE IF NOT EXISTS` on first use (no migration file); upsert keyed on
  runId (idempotent, last-write-wins).
- `src/composition/orchestrator.ts` — `emitCrossRun()` runs on terminal
  (ACCEPT/ESCALATE/PAUSE), **env-gated** (skipped if no `DB` binding) and
  **best-effort** (a D1 failure never breaks the run — the per-run lineage is
  the source of truth, INV-A). Emitted before the terminal is made visible, so
  a visible terminal implies the run is indexed.
- `src/composition/worker.ts` — `GET /runs` (optional `?terminal=` filter)
  queries the index across all runs.

## Tested (test/cross-run.test.ts, real D1)

Three separate runs (separate DOs) → one shared D1 index:

| Run | Terminal | Attempts | Index row |
|---|---|---|---|
| converge | ACCEPT | ≥2 | terminal ACCEPT, Amendment count ≥1 |
| never (budget 2) | ESCALATE | 2 | terminal ESCALATE, attempts 2 |
| echo 42 | ACCEPT | 1 | terminal ACCEPT, attempts 1 |

`?terminal=ACCEPT` filter returns only accepted runs. Aggregation across DOs
confirmed.

## Live provisioning

`D1-PLAYBOOK.md`: `wrangler d1 create keel-crossrun`, drop the real
`database_id` into `wrangler.jsonc`, redeploy, then `GET /runs` returns real
model-generated runs indexed across the whole deployment.

## No frozen-shape change (still)

`CrossRunIndexPort` is additive; no existing frozen shape moved.
`grep -r cloudflare src/domain` empty. **Nine** consecutive integrations now
(M2–M5, real oracle, deploy, real model, cross-run D1) with the frozen surface
never moving.

## Post-v1 list: complete

Real oracle ✓ · live deploy ✓ · real model (live) ✓ · D1 cross-run index ✓.
What remains is Phase 6 (spec-loop backlog automation + the MCP foreign-executor
boundary) — genuinely new scope, not a v1 gap.
