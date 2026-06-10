# Session Handoff — 2026-06-10

## What Was Done This Session

### D1 Migration — COMPLETE & DEPLOYED
- `@factory/arango-client` renamed → `@factory/db-client` (PR #79)
- All AQL ported to SQL across all workers — autonomy-monitor, formula-compiler-adapter, webhook-receiver, ontology-loader (PRs #78, #81, #82)
- D1 database `ff-factory` provisioned (id: `6a72d5c3-bcbb-41e3-b29d-d8de5834c3b3`), schema applied
- All workers deployed: ff-gates, ff-pipeline, ff-gateway (PR #80)
- Full smoke test validated: `trace_id: baec63bd`, all 5 steps pass including webhook RELEASE bridge

### Pi-Container / GasCitySupervisor Hardening — MERGED
- PR #83: gc binary updated (41 commits), EXECUTE_TIMEOUT_MS 300s→480s, `/workspace` symlink cleanup, `auth.json` stub in Dockerfile
- PR #84: keepalive wiring in ff-pipeline — `POST /v0/keepalive/start` on dispatch, `/stop` on RELEASE + amendment_halted paths
- PR #85: `onStop()` made async in gascity-supervisor to prevent stale keepalive_refcount infinite loop

### Gas City E2E Status
- Smoke test: **PASSES** (5/5 steps including HMAC webhook)
- Live workflow: **init ✅ plan ✅ code ✅ verify ✅ release ❌**
- Release fails: `fidelity_fail_closed` — fidelity validator sends `bead_id: do-XXXX` (release bead) to ff-pipeline, but dispatch_log only has the source dispatch bead → 409 `orphan_bead`
- Root fix needed: `molecule.go:Attach` in gascity must propagate `gc.source_bead_id` from workflow root to all child step beads (1-line fix)
- Code step output: 139-byte stub — `git` not in pi-container image, `/workspace` not found for code step

### Pi-Container / Gas City Runtime — SUNSET
**User confirmed: pi-container/gascity coding runtime has never worked and is being replaced with a new design.**
- Do NOT continue debugging pi-container workspace seeding, git availability, or the Gas City coding pipeline
- The `fidelity_fail_closed` / `molecule.go` fix is the only Gas City fix still needed (for the RELEASE webhook path)

### Reversa Re-Extraction — STARTED BUT NOT COMPLETED
- User requested fresh Reversa run on function-factory before providing new specs
- Scout was partially initiated — `inventory.md` header updated but full re-extraction not done
- **Next session should complete the re-extraction or use workflow to run all 6 phases**

---

## Open Work

### P0 — molecule.go source_bead_id fix (gascity repo)
**File:** `/Users/wes/Developer/gascity/internal/molecule/molecule.go` lines ~263–272 (Attach loop)
**Fix:**
```go
if srcID := root.Metadata["gc.source_bead_id"]; srcID != "" {
    step.Metadata["gc.source_bead_id"] = srcID
}
```
This must be in the gascity binary, then the binary (`gc-linux-amd64`) must be rebuilt and copied to `workers/gascity-supervisor/gc-linux-amd64`, and gascity-supervisor redeployed.

### New Design Specs — NOT STARTED
User wants to replace the pi-container/gascity coding runtime with a new design. Next session:
1. Complete Reversa re-extraction on function-factory (run `/reversa` — all 6 phases)
2. Use `/reversa-forward <description>` to spec the new design
3. The `_reversa_sdd/` from June 8 is partially updated but stale — needs full re-run

### Open PRs
- **#74** — 4 agent packages + knowing-state-sdk + AtomDirective schema (`feat/agent-infrastructure-packages`)
- **#75** — Linear integration specs (`feat/linear-integration-specs`)

---

## Key Facts

### Infrastructure
- D1 database: `ff-factory`, id `6a72d5c3-bcbb-41e3-b29d-d8de5834c3b3`, region ENAM
- D1 tables: `documents(collection, key, json, created_at)` + `edges`
- All workers live at `*.koales.workers.dev`
- Tokens in `/tmp/`: `gc_token.txt` (OPERATOR_TOKEN), `gc_supervisor_token.txt` (GC_BEARER_TOKEN), `gc_hmac_secret.txt` (GC_HMAC_SECRET)

### SQL Pattern (never use json_each in subqueries — D1 bug)
```typescript
// ✅ Correct
db.queryOne<{ json: string }>(
  `SELECT json FROM documents WHERE collection='x' AND json_extract(json,'$.field')=? LIMIT 1`,
  [value]
).then(row => row ? JSON.parse(row.json) as T : null)

// ❌ Wrong — json_each in correlated subquery fails silently in D1
// Use LIKE '%value%' instead with post-filter
```

### Tessera CLI
Always run before any edits to function-factory:
```bash
/Users/wes/Developer/tessera/tessera/dist/cli/index.js impact <symbol> --repo function-factory
```

### implement workflow
Use for all code changes:
```bash
# Works — inline args (not scriptPath + args, that's broken)
Workflow({ scriptPath: "/Users/wes/Developer/function-factory/.claude/workflows/implement.js" })
# But args don't pass via scriptPath — use inline script instead
```

### Gas City workflow step results (latest run do-6982)
- init: ✅ pass
- plan: ✅ pass (keepalive working — DO no longer evicts)
- code: ✅ pass (but produces 139-byte stub — git missing, /workspace not seeded for code step)
- verify: ✅ pass (verifies the stub — doesn't catch it)
- release: ❌ fidelity_fail_closed (orphan_bead 409 — wrong bead_id sent to webhook)
- workflow root: ✅ completed (despite release fail — Gas City considers it done)
