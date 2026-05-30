# Pattern: Gas City bd Provider Conflicts with Externally-Started Dolt

## Problem
The Gas City `bd` bead store provider (`beads.provider = "bd"` in `city.toml`)
fails to start Dolt with the error:

```
init: beads lifecycle: bead store: exec beads start:
dolt server could not start via gc helper (check .../dolt.log)
```

This happens even when the `dolt` binary is installed and on PATH.

## Root Cause
The `bd` provider uses `gc dolt-state start-managed` to start and manage its own
Dolt SQL server via a `gc helper` subprocess. If another process (e.g. an
`entrypoint.sh` background job) has already started Dolt on the same port (3306
by default), the `gc helper` starts a second Dolt that tries to bind the same
port. The second Dolt exits immediately with "address already in use". Gas City
sees the failed start and marks the city as `init_failed`.

The Dolt log confirms:
```
bad configuration: Failed to parse yaml file .../dolt-config.yaml ...
# or:
Error: listen tcp 127.0.0.1:3306: bind: address already in use
```

## Solution
**Do not start Dolt manually in `entrypoint.sh` when using `beads.provider = "bd"`.** 
The `bd` provider manages the full Dolt lifecycle — init, start, stop, recovery,
config. External Dolt starts conflict with it.

```sh
# entrypoint.sh — WRONG when beads.provider = "bd"
dolt --data-dir /data/dolt sql-server -H 127.0.0.1 -P 3306 >/tmp/dolt.log 2>&1 &  # ← REMOVE

# entrypoint.sh — CORRECT
# No manual dolt start. The bd provider manages it.
# Just ensure the dolt binary is on PATH and git + bd CLI are installed.
dolt config --global --add user.name "Gas City" >/dev/null 2>&1 || true
dolt config --global --add user.email "gc@gascity.local" >/dev/null 2>&1 || true
gc supervisor run
```

Also remove any `gc beads init --provider bd` call from the entrypoint — Gas City
initializes the bead store itself during city startup (`starting_bead_store` phase).
Manual init before `gc supervisor run` is redundant and can race.

## Additional Requirements for bd Provider
The `bd` provider requires three binaries beyond the base image (see
`.agent/patterns/container-missing-system-deps.md`): Dolt 2.x, `git`, and `bd`.

## Known Instances
- **2026-05-30** — `entrypoint.sh` started Dolt on port 3306 for "best-effort
  availability". After switching `beads.provider = "file"` → `"bd"`, the manual
  Dolt start conflicted with the bd provider's Dolt, causing every city start to
  fail. Fix: removed manual `dolt sql-server` from entrypoint.sh.

## Status
The `bd` provider still has an open issue: `adopting_sessions` phase hangs after
a successful bead store init. Suspected cause: `sp.ListRunning("")` in the
subprocess session provider blocks. Under investigation.

## See Also
- `.agent/patterns/container-missing-system-deps.md` — bd provider's required binaries
- `.agent/patterns/container-tool-version-mismatch.md` — Dolt version must match gc binary
