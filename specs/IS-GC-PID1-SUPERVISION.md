# IS-GC-PID1-SUPERVISION
# Add tini PID-1 supervision to Gas City Container

## Problem
`entrypoint.sh` ends with `exec gc supervisor run`, making the Gas City supervisor
PID 1. When `gc supervisor run` exits for any reason (OOM, unrecovered panic,
startup failure), Cloudflare sees PID 1 die and restarts the entire Container.
This wipes the ephemeral filesystem — bead store, Dolt data, all in-flight
formula execution state.

## Solution
Install `tini` as a minimal init (PID 1). `tini` properly reaps zombie processes,
forwards signals to the supervised process, and restarts it on exit. If
`gc supervisor run` crashes, `tini` restarts it without triggering a Container
restart. The filesystem survives.

## Change 1: Dockerfile

In the `RUN apt-get install` block, add `tini` to the package list:

```dockerfile
RUN apt-get update && apt-get install -y --no-install-recommends \
      curl ca-certificates netcat-openbsd unzip bash openssl tini \
    && ...
```

Change the final `ENTRYPOINT` line from:
```dockerfile
ENTRYPOINT ["/entrypoint.sh"]
```
to:
```dockerfile
ENTRYPOINT ["/usr/bin/tini", "--", "/entrypoint.sh"]
```

## Change 2: entrypoint.sh

Remove `set -e` — with tini as PID 1, the entrypoint is a setup script, not
the supervised process. Setup failures should still abort via explicit `|| exit 1`
guards where critical, but `set -e` causes the entire setup to abort on any
non-zero exit including harmless ones (e.g. `dolt config` already-set errors).

Change the final line from:
```sh
exec gc supervisor run
```
to:
```sh
exec gc supervisor run 2>&1 | tee /tmp/gc-supervisor.log &
GC_PID=$!
wait $GC_PID
```

Actually — simpler: just remove `exec` so tini sees gc exit and can restart:
```sh
gc supervisor run
```

With tini as PID 1 and `gc supervisor run` as a child process (not exec'd),
tini will restart the child when it exits. entrypoint.sh becomes the supervised
script tini runs.

**Correct entrypoint pattern with tini:**

entrypoint.sh does setup then runs the supervisor without `exec`:
```sh
#!/bin/sh
# setup steps (mkdir, cp, dolt config) ...
dolt --data-dir /data/dolt sql-server -H 127.0.0.1 -P 3306 >/tmp/dolt.log 2>&1 &
gc supervisor run
```

tini (PID 1) sees `gc supervisor run` exit and re-runs entrypoint.sh. Since the
setup steps are idempotent (`cp`, `mkdir -p`), re-running them on restart is safe.

## Files to change

- `/Users/wes/eai/examples/factory/weops-gascity/stage/supervisor/Dockerfile`
  - Add `tini` to apt-get install list
  - Change `ENTRYPOINT` to use tini

- `/Users/wes/eai/examples/factory/weops-gascity/stage/supervisor/entrypoint.sh`
  - Remove `set -e`
  - Remove `exec` before `gc supervisor run` (last line)

## Commit message
`fix(supervisor): add tini PID-1 supervision so gc supervisor run can restart without wiping Container`

## References
- `.agent/patterns/ephemeral-container-store.md`
- SE finding 2026-05-29: `entrypoint.sh:2,35` — `set -e` + `exec gc supervisor run` as PID 1
