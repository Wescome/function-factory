# KEEL M1 — Freeze Record (Phase 2)

**Status: G2 = GREEN.** The domain contracts are frozen against confirmed
behavior from the M0 spike, not assumed behavior.

```
npm run gate    # lint:deps && typecheck && test
```
- **D6 import boundary: clean** — `src/domain` imports no Cloudflare substrate.
- **`grep -r cloudflare src/domain` → empty** (the master G2 check).
- **`tsc --noEmit` (strict, exactOptionalPropertyTypes, noUncheckedIndexedAccess): clean.**
- **12/12 contract tests pass.**

CI (`.github/workflows/ci.yml`) runs all three from commit one; a red gate
blocks the merge.

## What is frozen

The public surface is `src/domain/index.ts`. Adapters (Phase 3+) implement these
ports and consume these types; they do not change these shapes.

### The lineage contract (Shared Kernel) — `lineage/contract.ts`
Content-hash identity, provenance edges, append-only. The conserved invariant,
not a vocabulary. `ContentHash` is branded; nodes are immutable; `NodeInput` is
the pre-id shape a factory hands the repository.

### The SE-Onto entities — `lineage/nodes.ts`
`Specification, Action, ExecutionTrace, Verdict, Amendment, Decision,
Disposition`, each a `LineageNode` specialization. Content shapes encode the M0
findings (see below).

### Domain events — `lineage/events.ts`
The fact each transition emits; emitting IS the lineage append (D3).

### Driven ports — `ports/*.port.ts`
`ModelPort, CodeExecutionPort, OraclePort, LineageRepositoryPort,
RunDispatchPort, ConnectorRegistryPort, ClockPort/EntropyPort`.

### The loop — `loop/state.ts`, `loop/decide.ts`
The state machine as typed data (D3) and `decide()`, the folded LoopController
as a pure, exhaustive function with a caller-supplied budget.

## Which Decision each contract encodes

| Decision (M0 finding) | Where it's frozen |
|---|---|
| **D5** connectors-only ceiling | `SpecificationContent.capabilityCeiling`, `.connectors`; `CodeExecutionPort.execute` doc; `ConnectorRegistryPort` |
| **D7** startFiber idempotent dispatch | `RunDispatchPort.admit -> { accepted }`; `RunAdmitted` event. The primitive is an adapter detail — it does not appear in the domain. |
| **D8** PAUSE is abort-and-replay | `CodeExecutionPort.approve` doc + invariant; `ExecutionOutcome` "paused"; `ExecutionTraceContent.pending`/`.calls`; `state.ts` EXECUTE↔PAUSE pair; `ActionPaused` event |
| **D9** determinism capture not free from the fiber | `ports/determinism.port.ts` — ClockPort/EntropyPort named, shape-frozen, but v1-scoped out; capture belongs in the code action via codemode.step() |
| **D2** inline oracle viable (S5 green) | `OraclePort.verify -> Promise<Verdict>` — synchronous-style, no async/queued indirection required for v1 |
| **D4 / INV-A** lineage is the sole domain truth | `LineageRepositoryPort` is the only persistence path, append-only (no mutate/delete), and never surfaces the framework fiber ledger |
| **D3** state machine as typed data | `loop/state.ts` TRANSITIONS table; the runner (Phase 3) interprets it |

## What is explicitly NOT in this freeze

- **No adapters.** No codemode, no Agents SDK, no Dynamic Worker, no DO/D1/R2
  code. That is Phase 3 (M2, the walking skeleton). The domain compiling
  standalone with zero substrate deps is the point of G2.
- **No hashing implementation.** The lineage contract defines content-addressing
  as a rule; the repository adapter computes the hash on `append`.
- **No orchestrator-level determinism** beyond the named ClockPort/EntropyPort
  (D9, v1-deferred).

## Next: M2 (Phase 3, walking skeleton)

Implement the thinnest real loop — INTENT→GENERATE→EXECUTE→VERIFY→ACCEPT,
connectors-only — as adapters behind these frozen ports, reusing the M0 spike's
proven substrate wiring. Gate G3: one trivial task green end-to-end on real
workerd. The adapters go under `src/adapters/**`; the D6 lint already permits
that path and forbids the domain from following it.
