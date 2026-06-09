# Production Close — Codex Handoff

Date: 2026-06-01  
Status: Dispatch live. Observability live. Three tasks remain before production is clean.

---

## Task 1 — WP-DO-5: Strip Dolt + bd from Container

### Repos
- `Wescome/function-factory` — Dockerfile, entrypoint.sh, gc binary
- `Wescome/gascity` — adoption_barrier.go, city_runtime.go

### 1A. Dockerfile — remove Dolt + bd (function-factory)

File: `workers/gascity-supervisor/Dockerfile`

Remove the Dolt + bd install block (lines 4-10). Remove `EXPOSE 3306` (Dolt MySQL port).
Result after edit:

```dockerfile
FROM debian:bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends \
      curl ca-certificates netcat-openbsd unzip bash openssl tini git \
    # bun — single static binary; runs the deterministic fidelity validator CLI.
    && BUN_VERSION=1.3.13 \
    ...
```

### 1B. entrypoint.sh — remove Dolt setup (function-factory)

File: `workers/gascity-supervisor/entrypoint.sh`

Remove:
- `mkdir -p /data/dolt` (line 3 — keep the rest of that mkdir line)
- The `dolt config --global` block (lines ~19-20)
- `find_dolt_beads_dir()` function
- `configure_dolt_remote()` function
- The background push loop (`while true; do sleep 60; dolt push...done &`)
- The `NOTE: Do NOT start dolt sql-server` comment block

Keep everything else unchanged.

### 1C. adoption_barrier.go — no-op for DO provider (Wescome/gascity)

File: `cmd/gc/adoption_barrier.go`  
File: `cmd/gc/city_runtime.go` (caller at line 467)

The `adopting_sessions` startup phase must remain in the FSM. Only the Dolt-specific blocking ops need to go.

In `city_runtime.go`, find the `runAdoptionBarrier(...)` call. Wrap it:

```go
if cr.cfg.Beads.Provider == "do" {
    // DO bead store has no adoption wait — sessions are durable, no cold-start
} else {
    result, passed := runAdoptionBarrier(cr.cityPath, cr.cityBeadStore(), cr.sp, cr.cfg, cr.cityName, clock.Real{}, cr.stderr, false)
    // existing handling...
}
```

Do NOT delete `adoption_barrier.go` or its tests — the `bd` path stays intact.

### 1D. Rebuild + deploy

```bash
# In Wescome/gascity
GOOS=linux GOARCH=amd64 go build -o /path/to/function-factory/workers/gascity-supervisor/gc-linux-amd64 ./cmd/gc/
go test ./cmd/gc/... # must pass

# In function-factory
# Bump singleton in workers/gascity-supervisor/src/index.ts: singleton-v25 → singleton-v26
npx wrangler deploy  # from workers/gascity-supervisor/
```

### Acceptance
- Container image ~40MB smaller (no Dolt/bd download)
- `adopting_sessions` phase completes in < 100ms
- E2E smoke: `bash scripts/ops/smoke-test.sh` passes

---

## Task 2 — Fix two pre-existing gascity test failures (Wescome/gascity)

### 2A. `TestFidelityValidatorMissingWebhookURLNoPanic`

Find this test, read what it asserts, compare against the production default. Fix the expected value or the default — whichever is wrong. Do not skip or delete the test.

### 2B. `cmd/gc` config-watcher test hang

Run `go test ./cmd/gc/... -v -timeout 30s` and identify which test hangs. Root-cause: likely a goroutine that never exits (unclosed channel, missing `context.Cancel`, or `select` with no timeout). Fix the leak. Do not increase the timeout as the fix.

### Acceptance
`go test ./... ` passes with no hangs or failures (except pre-existing unrelated failures, if any — document them explicitly).

---

## Task 3 — Cancel stale handoff doc

File: `specs/reference/CODEX-HANDOFF-WP-DO-4.md`

Add to the top of the file:

```
Status: CANCELLED — 2026-06-01
Reason: ArangoDB for artifacts was never broken. Migration introduced schema
mismatches and compatibility shims with no benefit. Bead store on DO (WP-DO-1/2/3)
was the correct and sufficient fix. ArangoDB remains the artifact store.
```

Commit with message: `META: cancel WP-DO-4 — ArangoDB artifact migration was overreach`

---

## Commit messages

```
INFRA: WP-DO-5 strip Dolt+bd from Container, no-op adoption barrier for DO provider
META: cancel WP-DO-4 — ArangoDB artifact migration was overreach
```
