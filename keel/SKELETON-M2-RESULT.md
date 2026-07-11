# KEEL M2 — Walking Skeleton Result (Phase 3)

**Status: G3 = GREEN.** The thinnest real loop runs end-to-end on real workerd,
as adapters behind the M1-frozen ports. 14/14 tests pass (12 M1 contract tests
in workerd + 2 M2 skeleton tests).

```
npm run gate    # lint:deps && typecheck && test
```

## What G3 proves

A trivial connectors-only task (`echo 42`) admitted to the Orchestrator DO walks
the full loop:

```
INTENT     admit(spec) -> Specification node appended (content-addressed)
           dispatched via startFiber(idempotencyKey = spec.id)   [D7]
GENERATE   ScriptedModelAdapter -> code action -> Action node
EXECUTE    CodemodeExecutionAdapter runs it in a Dynamic Worker  [D5]
           echo.emit({value:42}) logged; ExecutionTrace node
VERIFY     RuntimeOracleAdapter runs an inline assertion in a
           Dynamic Worker (the S5-green path) -> Verdict node    [D2]
DECIDE     decide() -> pass -> ACCEPT
```

Asserted: terminal state `ACCEPT`, and the lineage chain
`Specification → Action → ExecutionTrace → Verdict` all present in DO SQLite.
Second test: a repeat `admit` of the same spec returns `accepted:false` with the
same run id — D7 idempotency, live.

## Structure (Clean/Hexagonal, enforced)

- `src/domain/**` — the M1 frozen ports + entities + `loop/run.ts` (the loop
  use-case). Substrate-free; D6 lint scans it and it stays clean.
- `src/adapters/**` — the port implementations, which MAY import the substrate:
  - `codemode/` — CodeExecutionPort, OraclePort, the echo connector, the shared
    runtime factory (reusing the M0-proven wiring: lazy runtime getter,
    `CodemodeRuntime` export, `worker_loaders` binding shape).
  - `persistence/lineage-do.adapter.ts` — LineageRepositoryPort over DO SQLite,
    append-only, SHA-256 content-addressing, canonical-JSON identity.
  - `model/scripted-model.adapter.ts` — a deterministic ModelPort stand-in.
- `src/composition/` — the Orchestrator DO wiring adapters to ports and
  dispatching via startFiber; the worker entry.

The domain never imports an adapter and never imports the substrate; the
composition root wires them. `grep -r cloudflare src/domain` is empty.

## Real type fixes this pass (adapters only — the frozen surface held)

- `codemode.reject` needs `{ seq, executionId }`, not just `executionId`
  (confirmed against the installed .d.ts).
- `Agent.sql` returns `T[]` with `(string|number|boolean|null)[]` values — the
  custom wrapper was dropped in favor of the base method, bound where the
  lineage adapter needs a callable.

None touched `src/domain`. The M1 freeze absorbed M2 without a shape change,
which is the freeze doing its job.

## Honestly not yet real (deferred, by design)

- **The model is scripted, not an LLM.** The skeleton proves loop wiring, not
  generation. The AI Gateway ModelPort adapter is Phase 4+.
- **The oracle checks one hardcoded criterion** (`result.value === 42`) rather
  than compiling acceptance criteria to assertions. Real oracle: later phase.
- **No AMEND/ESCALATE/PAUSE exercised end-to-end here** — the trivial task
  passes on attempt 1. The loop CODE handles all branches (see run.ts), and
  decide() is unit-tested exhaustively (M1); wiring the failing/gated paths
  through real adapters is M3 (Phase 4).
- Local workerd via Miniflare; no live-account deploy.

## Next: M3 (Phase 4) — close the loop

Wire AMEND (a failing oracle → re-generate with evidence), ESCALATE (budget
exhausted), and PAUSE (an approval-gated connector → abort-and-replay, D8)
through real adapters. Gate G4: a first-attempt failure converges via amend.
