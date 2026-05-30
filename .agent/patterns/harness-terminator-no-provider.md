# Pattern: Harness Terminator — No Remote Provider

## Problem class

A formula's terminator step (Release / fidelity step) is given
`runtime_requirements` that map to a remote harness provider (`cloudflare-sandbox`,
`pi-rpc`). The step fails because the remote provider runs in a separate runtime
with no access to the molecule's accumulated evidence envelope, and the fidelity
validator returns `fail_closed` on empty input.

## Root cause

This is a category error. Gas City's fidelity validator does NOT run inside a
provider's sandbox. The supervisor runs `runFidelityValidator` (`harness_fidelity.go`)
as a **local subprocess** using evidence it holds in-process. The flow is:

1. `maybeDispatchHarness` calls `provider.ExecuteStep(req)` → gets back `resp`
2. For the terminator bead, calls `runFidelityValidator(ctx, store, bead, cfg, cityPath, resp, stderr)`
3. `buildFidelityJob` assembles `fidelity-job.json` **in Go, in supervisor memory**
   from `resp` (envelope: `status`, `artifact_manifest`, `step_outputs`, `policy_events`)
   and `bead.Metadata` (prior verdicts)
4. Writes `fidelity-job.json` to `rigRoot`
5. `exec.Command("bash", fidelityReleaseScriptPath)` — **supervisor-local subprocess**
6. Script validates job, POSTs RELEASE webhook

The script never touches the PI container workspace. It reads only the job
document the supervisor just wrote. Routing the terminator step to a remote
provider is always wrong: the provider runs something meaningless, returns an
empty envelope, and the validator fails closed on empty evidence.

## Solution

**E2 (current): `supervisor-local` no-op harness provider**

Add a `supervisor-local` provider to `city.toml` whose `ExecuteStep` is a no-op
that returns the accumulated molecule envelope. The harness registry selects it
for the terminator step; Gas City then runs `runFidelityValidator` locally as
designed.

```toml
# city.toml
[provider.supervisor-local]
# No URL — this provider is resolved in-process by the supervisor.
# All eight harness slots required (AC-REG4).
harness_slots = ["E", "T", "C", "S", "L", "V", "G", "P"]
capability_keys = ["fidelity_finalize"]
```

```toml
# factory-coding-v1.toml — Release step
runtime_requirements = ["fidelity_finalize"]
```

**E1 (long-term ideal):** Introduce `fidelity_finalize` as a canonical capability
key in the 12-key set (Gas City `internal/config/harness_provider.go`). The
supervisor recognizes the terminator natively without needing a `[provider.*]`
block at all. **Requires architecture gate** — amending the canonical key set is
an Architect decision, not an Engineer decision. See DECISIONS.md 2026-05-30.

## The real load-bearing change

`buildFidelityJob` (`harness_fidelity.go`) currently ships empty
`DeclaredOutputs` and `PriorStepVerdicts`. Even after routing is fixed, the
validator will fail closed without evidence. The supervisor must:

1. Accumulate each step's `ExecutionResponse` across the molecule (keyed by
   `step_ref` or bead metadata)
2. Pass the accumulated envelopes into `buildFidelityJob` to populate
   `DeclaredOutputs` and `PriorStepVerdicts`

This is the change that actually makes the verdict non-trivially `approved`.

## Signals that this pattern applies

- `gc.harness_fidelity_verdict: "fail_closed"` on a Release/terminator bead
- `gc.harness_provider_id` is a remote provider (`cloudflare-sandbox`, `pi-rpc`)
  on the terminator step
- `factory-coding-v1.toml` Release step has `command_exec` or `file_materialize`
  in `runtime_requirements` — these are coding-domain capabilities, not
  terminator capabilities

## Anti-patterns

- **Adding `command_exec`/`file_materialize` to pi-rpc capability keys.** The
  validator doesn't run inside pi-rpc. This routes an LLM turn to produce
  evidence the supervisor already has.
- **R2/KV artifact export between providers.** The validator reads the envelope,
  not raw workspace files. Cross-provider file transfer solves a non-problem.
- **Collapsing Release into Verify.** Violates IS-GC-FIDELITY-VALIDATION FV-03
  (evaluator structurally separate from worker) and FV-08 (molecule verdict =
  AND of prior step verdicts; terminator must be distinct).

## Source

Architect analysis 2026-05-30. Gas City source read:
`cmd/gc/harness_dispatch.go:189`, `cmd/gc/harness_fidelity.go:131`,
`examples/bd/assets/scripts/gc-beads-bd.sh`. Convoy evidence: gc-22 Release
`fail_closed` via `cloudflare-sandbox` while gc-19/20/21 (Plan/Code/Verify)
all `completed` via `pi-rpc`.

See DECISIONS.md "2026-05-30: Release step routing — E2 supervisor-local no-op
harness provider" for the approved decision.
