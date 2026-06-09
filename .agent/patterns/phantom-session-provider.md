# Pattern: Phantom Session Provider (SOLVED)

## Problem
Gas City's session lifecycle contract requires `runtime.Provider.Start()` to be called before a formula bead can be claimed. When the city's `session.provider` is `cloudflare`, every formula step triggers a Cloudflare Sandbox cold boot (10–30s, billed) just to run a probe command and satisfy the lifecycle contract. The Sandbox is never used for actual execution — the harness registry (pi-rpc) handles that independently.

## Root Cause
Gas City's reconciler uses `session.provider.Start()` to transition a bead from assigned → active. The harness registry is a completely separate execution path (`maybeDispatchHarness` in `cmd_convoy_dispatch.go`). There is no first-class Gas City concept of "claim a bead without starting a session."

## Solution (APPLIED 2026-05-29)
**`provider = "noop"` on the agent.** A file-backed no-op session provider (`internal/runtime/noop/`) satisfies the `runtime.Provider` lifecycle contract by writing a local state file. Zero remote cost, zero cold boot, zero external service.

- New package: `Wescome/gascity internal/runtime/noop/` (commit `f05cb553`)
- Registered in `cmd/gc/providers.go` as `case "noop":`
- Applied in `city.toml`: `[[agent]] name = "coder" provider = "noop"`
- `workspace.start_command` (the `echo [factory-probe] ready` phantom) removed

## Domain Agnostic Requirement
This pattern applies to ALL domains, not just coding. Legal review steps, financial analysis steps, product spec steps — any formula step executed by the harness registry must use `provider = "noop"` to avoid per-step Sandbox cost.

## Architect + SE review
Both independently recommended Option 1 (noop provider). Option 2 (harness-native claim bypass) rejected — forks the bead state machine on a fragile whole-formula predicate.
