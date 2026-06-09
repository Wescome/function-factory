# Pattern: Container Tool Version Mismatch

## Problem
A Go binary embedded in a Container generates configuration for a tool (e.g. a
YAML config file, a SQL schema, a lock file) using fields that exist only in a
newer version of that tool. The Dockerfile pins an older version. The tool
starts, parses the generated config, and exits immediately with a parse error.
No useful error appears in the Container's HTTP response — the failure is silent
until you read the city/service status endpoint.

## Root Cause
The Go binary is built against a specific tool version (or against the tool's
latest API) and hard-codes config field names from that version. The Dockerfile
was last updated when an older tool version was current and was never bumped
when the binary was rebuilt. The mismatch is invisible at image build time.

## Solution
1. **Check `deps.env` in the upstream tool's repo** — projects like
   `gastownhall/gascity` maintain a canonical `deps.env` with pinned versions
   for every dependency the binary generates config for. Read it before pinning
   in any Dockerfile.
2. **Pin the Dockerfile to the same version** — match `DOLT_VERSION`,
   `BD_VERSION`, etc. to what `deps.env` requires.
3. **Read the error before debugging further** — when a city or service has
   `status: init_failed`, read the `.error` field. A yaml/config parse error
   is the first signal; the offending field names the version gap.

## Diagnostic
```bash
# Check city status for the error field
curl -H "Authorization: Bearer $GC_TOKEN" \
  "$GC_BASE/v0/cities" | jq '.items[].error'
# Look for: "field X not found in type Y" — that field was added in version N
```

## Known Instances
- **2026-05-30** — Gas City `gc` binary generates `dolt-config.yaml` with
  `back_log`, `max_connections_timeout_millis`, `auto_gc_behavior` (Dolt 2.x
  fields). Dockerfile pinned Dolt 1.44.4. City failed with yaml parse errors
  on every startup. Fix: `DOLT_VERSION=2.0.3` per `gastownhall/gascity/deps.env`.

## See Also
- `.agent/patterns/container-missing-system-deps.md` — the related missing-binary problem
