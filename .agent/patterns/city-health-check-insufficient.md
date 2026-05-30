# Pattern: Gas City HTTP 200 Does Not Mean City Is Running

## Problem
A pre-warm loop polls `GET /v0/cities` (or any endpoint that returns HTTP 200)
and declares the Container ready. A dispatch immediately after succeeds with
`outcome: dispatched` — but the formula probe returns `city not found or not
running: factory`. The city is in `status: init_failed` or `adopting_sessions`
while the supervisor HTTP server is already up.

## Root Cause
Gas City's supervisor process starts and binds port 9443 (returning HTTP 200 on
`/v0/cities`) before it has finished initializing individual cities. The
`/v0/cities` endpoint returns HTTP 200 with an array of cities; each city entry
carries a `running: false` and `status: init_failed` (or intermediate status
like `adopting_sessions`, `starting_bead_store`). HTTP 200 only means "the
supervisor API is reachable," not "the factory city is ready to accept formulas."

## What the city goes through on startup
```
loading_config → starting_bead_store → resolving_formulas → adopting_sessions → running
```
Each phase takes seconds to minutes. The supervisor HTTP server is up from the
start. Formula dispatch fails until `running: true`.

## Solution

### Probe the formula endpoint, not /v0/cities
After `/v0/cities` returns HTTP 200, probe the specific formula endpoint the
dispatch will call:

```bash
# Pre-warm: city ready check
HTTP=$(curl -s -o /dev/null -w "%{http_code}" \
  -H "Authorization: Bearer $GC_TOKEN" \
  "$GC_BASE/v0/city/factory/formulas/factory-coding-v1?target=coder&scope_kind=city&scope_ref=factory")
# 200 = city running AND formula loaded
# 404 = city not running OR formula not registered
```

### Or check running field in /v0/cities response
```bash
RUNNING=$(curl -s -H "Authorization: Bearer $GC_TOKEN" "$GC_BASE/v0/cities" \
  | jq '.items[] | select(.name == "factory") | .running')
# true = city fully initialized
# false = still starting (check .status for phase)
```

### Wait loop pattern
```bash
for i in $(seq 1 40); do
  HTTP=$(curl ... "$GC_BASE/v0/city/factory/formulas/factory-coding-v1..." \
    -w "%{http_code}" -o /dev/null 2>/dev/null || echo "000")
  [[ "$HTTP" == "200" ]] && { echo "City ready"; break; }
  echo "  attempt $i: status=$HTTP"
  sleep 3
done
```

## Failure Modes by Status
| `status` | Meaning | Wait or act |
|----------|---------|-------------|
| `init_failed` | City startup failed permanently | Read `.error`, fix the cause |
| `loading_config` | Parsing city.toml | Wait |
| `starting_bead_store` | Initializing Dolt / file bead store | Wait (Dolt can take 10–30s) |
| `resolving_formulas` | Loading formula TOML files | Wait |
| `adopting_sessions` | Adopting running sessions from prior start | Wait (or investigate if >60s) |
| `running` | City operational | Dispatch |

## Known Instances
- **2026-05-30** — `dispatch-only.sh` pre-warm polled `/v0/cities` for HTTP 200.
  Container showed `status: 200` on attempt 1. Formula probe returned
  `city not found or not running: factory`. City was in `init_failed` (bead store
  failure). Dispatch still attempted → `timeout_call_1`. Fix: added formula probe
  step after HTTP 200 check, revealing the actual error.

## Applied In
- `scripts/ops/first-dispatch.sh` — formula probe step added 2026-05-30

## See Also
- `.agent/patterns/container-cold-boot-timeout.md` — cold boot is why the city is slow to start
- `.agent/patterns/gc-bd-provider-dolt-conflict.md` — one cause of `init_failed`
- `.agent/patterns/container-tool-version-mismatch.md` — another cause of `init_failed`
