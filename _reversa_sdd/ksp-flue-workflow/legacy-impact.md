# Legacy Impact — ksp-flue-workflow (.flue/workflows)

> Phase: ksp-flue-workflow (Steps 45–48)
> Generated: 2026-06-10
> Cross-referenced against: _reversa_sdd/architecture.md, _reversa_sdd/domain.md

---

## Files Affected

| File affected | Component (from architecture.md) | Impact type | Severity |
|---|---|---|---|
| `.flue/workflows/atom-execution.ts` | `AtomExecutor` DO / Conducting Agent CF Worker | componente-novo | HIGH — replaces entire CF Worker fetch handler with Flue workflow entrypoint |
| `.flue/types/flue-runtime.d.ts` | `@factory/gears` / Flue integration layer | componente-novo | MEDIUM — ambient type declarations enabling `@flue/runtime` API surface |
| `.flue/tsconfig.json` | Build infrastructure | componente-novo | LOW — TypeScript project config for `.flue/` workspace |
| `packages/schemas/src/atom-directive.ts` | `packages/schemas` (AtomDirective) | delta-de-contrato-externo | HIGH — adds `skillRef` (required, min(1)) and `role` (enum) fields; any existing `AtomDirective` payload without these fields will fail `safeParse()` |
| `packages/gears/src/beads/coordinator-do.ts` | `CoordinatorDO` in `@factory/gears` | regra-nova | HIGH — adds `initRun()`, `writeAudit()`, `POST /init` route, stalled-bead alarm; wires D1 audit log (BR-KSP-17) |
| `.agents/skills/` (renamed from `.agent/skills/`) | Flue skill discovery layer | delta-de-contrato-externo | LOW — Flue dev server now discovers skills from `.agents/skills/`; old `.agent/skills/` path is dead |
| `packages/harness-bridge/` (deleted) | `@factory/harness-bridge` adapter shim | componente-extinto | HIGH — all imports from `@factory/harness-bridge` must migrate to `@flue/runtime` direct imports |
| `packages/runtime/` (deleted) | `@factory/runtime` stub | componente-extinto | HIGH — all imports from `@factory/runtime` must migrate to `@flue/runtime` direct imports |
| `package.json` (root) | Monorepo workspace configuration | delta-de-contrato-externo | MEDIUM — workspaces array updated; pnpm filter `--filter harness-bridge` and `--filter runtime` no longer resolve |
| `cloudflare.ts` | CF Worker entrypoint / routing layer | regra-nova | MEDIUM — new export `atomExecutionRoute` wired from `.flue/workflows/atom-execution.js` |
| `wrangler.jsonc` | CF Worker bindings / deployment config | delta-de-contrato-externo | MEDIUM — `COORDINATOR_DO`, `SANDBOX_OUTPUT_BUCKET`, `Sandbox` DO bindings declared; secrets added |
| `packages/gears/src/flue/sandbox.ts` | `@factory/gears/flue` Sandbox | componente-novo | MEDIUM — extends `@cloudflare/sandbox` with `outboundByHost` API key injection map |
| `packages/gears/src/flue/agents.ts` | `@factory/gears/flue` agent profiles | componente-novo | MEDIUM — `PROFILE_BY_ROLE` map and `RoleName` type; replaces `deriveRole()` heuristic (BR-KSP-19) |
| `packages/gears/src/beads/types.ts` | `@factory/gears/beads` ExecutionBead schema | componente-novo | MEDIUM — `ExecutionBead` Zod schema shared between CoordinatorDO and workflow hook layer |
| `packages/gears/src/beads/hook.ts` | `@factory/gears/beads` DO fetch wrappers | componente-novo | MEDIUM — `claimHook`, `releaseHook`, `failHook`, `getNextReady` encapsulate all CoordinatorDO HTTP calls |
| `packages/gears/src/index.ts` | `@factory/gears` barrel export | regra-nova | LOW — new barrel; any consumer importing `@factory/gears` now sees the full flue + beads surface |

---

## Preserved Rules

The following domain rules from `_reversa_sdd/domain.md` are preserved unchanged by this phase:

| Rule ID | Rule | Preserved by |
|---------|------|-------------|
| BR-KSP-05 | Append-Only — Both Layers | `atom-execution.ts` never deletes or updates bead/artifact records; `coordinator-do.ts` uses `INSERT OR IGNORE` / append-only D1 writes |
| BR-KSP-16 | initRun() Before getNextReady() | `atom-execution.ts` calls `POST /init` on CoordinatorDO before `getNextReady()` (line 63–66 then line 69) |
| BR-KSP-17 | writeAudit() Is Not a Stub | `coordinator-do.ts` Step 5a implements full D1 `bead_audit` insert — not a no-op |
| BR-KSP-18 | evaluateSuccessCondition Is Async with Harness Parameter | `atom-execution.ts:evaluateSuccessCondition(condition, result, harness)` is async and accepts `FlueHarness` as third param |
| BR-KSP-19 | No deriveRole() — Use directive.role Directly | `atom-execution.ts:runFlueSession` uses `PROFILE_BY_ROLE[directive.role]` — no `deriveRole()` call exists |
| BR-01 | Signal Idempotency | No change to `ingest-signal.ts` or idempotency key computation |
| BR-05 | Coherence Verification is Fail-Closed | No change to `ff-gates` — CV gate is upstream of synthesis and unaffected |
| BR-11 | Graph Path Deprecated (harness path only) | `atom-execution.ts` is the harness path; it does not call the deprecated `/synthesize` route |
| BR-13 | Keepalive is Best-Effort | No change to `formula-compiler.ts` keepalive/start or `webhook-receiver.ts` keepalive/stop |
| BR-KSP-10 | Bridge Fields Are Optional, Invariants Unconditional | `coordinator-do.ts` writes beads without requiring bridge field presence; bridge fields are populated by LoopClosureService |
| BR-KSP-11 | Single Writer Per DO | `CoordinatorDO` is the sole write path for bead lifecycle; `atom-execution.ts` calls it via HTTP fetch only |
