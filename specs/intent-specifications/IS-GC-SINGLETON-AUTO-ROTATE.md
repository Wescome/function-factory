---
id: IS-GC-SINGLETON-AUTO-ROTATE
version: 2
title: "Auto-rotate SUPERVISOR_SINGLETON with drain gate + pre-commit hook + npm script"
sourceCapabilityId: BC-GC-RUNTIME-OPS
source_refs:
  - _reversa_sdd/gascity-dispatch/design.md
  - .github/workflows/ci.yml (singleton-rotation-check, INV-11)
  - workers/gascity-supervisor/src/index.ts:4
explicitness: explicit
rationale: >
  SUPERVISOR_SINGLETON has been manually bumped 50 times. The CI job
  singleton-rotation-check (INV-11) already detects when rotation is required
  but fails the build rather than executing the fix. This IS automates the
  rotation: a shell script reads the current numeric suffix, increments it,
  and writes it back. A Husky pre-commit hook invokes the script automatically
  when Dockerfile or gc-linux-amd64 is staged. A root-level npm/pnpm script
  exposes it for manual invocation. No CI changes (ci.yml is agent-protected).
  The existing singleton-rotation-check CI gate is preserved as the safety net.
---

# Intent Specification: Auto-rotate SUPERVISOR_SINGLETON

## JTBD

When a developer stages a change to the Gas City supervisor Dockerfile or
binary, I want the singleton version suffix to increment automatically before
commit, so that the deployment always boots a fresh container without requiring
a separate manual edit-and-amend cycle.

## Problem

`SUPERVISOR_SINGLETON = "singleton-v50"` is a manual counter incremented by
the developer each time the Gas City container image changes. The CI job
`singleton-rotation-check` (INV-11) fails the PR if the image changed but the
suffix did not — but it does not fix the problem, only reports it. This has
resulted in 50 manual bumps and repeated CI failures during active Gas City
debugging. The fix is a script that executes what the developer was doing by
hand.

## Goal

1. `scripts/rotate-singleton.sh` — reads the current `singleton-vN` suffix
   from `workers/gascity-supervisor/src/index.ts`, increments N, writes it
   back. Idempotent if the file is already staged.

2. Root `package.json` — add `"rotate:singleton": "bash scripts/rotate-singleton.sh"`
   so developers can run `pnpm run rotate:singleton` manually.

3. `.husky/pre-commit` — extend the existing hook to detect staged changes to
   `workers/gascity-supervisor/Dockerfile` or
   `workers/gascity-supervisor/gc-linux-amd64`. If detected, call
   `rotate-singleton.sh` and `git add workers/gascity-supervisor/src/index.ts`
   so the updated constant is included in the commit.

## Scope

**In scope:**
- `scripts/rotate-singleton.sh` — NEW
- `package.json` (root) — add one script entry
- `.husky/pre-commit` — append detection + auto-rotation block

**Out of scope:**
- No changes to `workers/gascity-supervisor/src/index.ts` logic
- No changes to `.github/workflows/ci.yml` (agent-protected)
- No changes to `wrangler.jsonc` (agent-protected)
- No changes to the singleton-rotation-check CI gate — it remains the safety net

## Acceptance Criteria

### AC-S1: Script reads and increments correctly
`scripts/rotate-singleton.sh` must:
- Read the current suffix via `grep -oE 'singleton-v[0-9]+'`
- Extract the numeric part and increment by exactly 1
- Write the result back with `sed -i` (macOS-compatible: `sed -i ''`)
- Print `Rotated: singleton-vN → singleton-vM` to stdout
- Exit 0 on success, non-zero on failure

### AC-S2: Script is idempotent within a commit
Running the script twice in succession must produce N+1 (first run) and then
N+2 (second run) — not N+1 twice. (sed operates on current file content, so
this is naturally satisfied.)

### AC-S3: npm script wired
`pnpm run rotate:singleton` (or `npm run rotate:singleton`) must invoke
`scripts/rotate-singleton.sh` and exit with the same exit code.

### AC-H1: Hook detects Dockerfile change
When `workers/gascity-supervisor/Dockerfile` is staged, the pre-commit hook
must invoke the rotation script and re-stage `src/index.ts`.

### AC-H2: Hook detects binary change
When `workers/gascity-supervisor/gc-linux-amd64` is staged, same behavior.

### AC-H3: Hook is no-op when image unchanged
When neither file is staged, the hook must not modify `src/index.ts` or call
the rotation script.

### AC-H4: Hook preserves existing hook behavior
The pre-commit hook already runs lint/format/typecheck. The singleton block
must be appended, not replace existing content.

### AC-H5: Rotated file is included in the commit
After the hook runs, `git add workers/gascity-supervisor/src/index.ts` must
be called so the incremented constant lands in the same commit as the image
change.

### AC-V1: CI gate still passes
After the hook auto-rotates, the `singleton-rotation-check` CI job must pass
(NEW_SUFFIX ≠ OLD_SUFFIX).

## Drain Gate (v2 addition)

**Problem:** Rotating `singleton-vN → vN+1` orphans any molecule mid-execution
on `vN`. The outgoing DO's `keepalive_refcount` is still > 0, so
`onActivityExpired()` self-renews and `vN` never sleeps. All future
`/v0/keepalive/stop` calls route to `vN+1`, so `vN`'s refcount never reaches
zero — `vN` runs forever holding its bead-store lease, writing to R2/Dolt
concurrently with `vN+1`: split-brain.

**Fix:** Before mutating `SUPERVISOR_SINGLETON`, call `/__supervisor/fence` on
the **outgoing** singleton. This check must use the current suffix (before
rotation) — once redeployed, the new Worker routes to `vN+1` and `vN` is
unreachable via the normal request path.

**Implementation:** `rotate-singleton.sh` checks `GC_BASE` and
`GC_SUPERVISOR_TOKEN`. If both are set, it calls the fence endpoint and exits 1
if `active: true`. If either env var is absent, it logs a warning and proceeds
(offline/dev rotation allowed).

### AC-D1: Drain gate blocks active outgoing singleton
When `GC_BASE` and `GC_SUPERVISOR_TOKEN` are set and the fence returns
`{"active":true}`, the script MUST exit 1 with a human-readable error naming
the outgoing suffix and the refcount.

### AC-D2: Drain gate passes idle outgoing singleton
When the fence returns `{"active":false}`, the script MUST log the idle state
and proceed with rotation.

### AC-D3: Drain gate is skipped offline
When `GC_BASE` or `GC_SUPERVISOR_TOKEN` is absent, the script MUST log a
warning and proceed — no hard block for offline/dev use.

### AC-D4: Fence called before any sed mutation
The drain check MUST occur before any write to `index.ts`. A failed drain gate
leaves `index.ts` unmodified.

## Non-Goals

- Deriving the singleton name from content hash — future work, larger change
- Removing the manual escape hatch (`pnpm run rotate:singleton`) — keep it
- Zero-downtime DO migration — out of scope
- Automatic drain waiting / polling — operator decides when to retry
