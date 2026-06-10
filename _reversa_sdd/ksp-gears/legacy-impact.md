# Legacy Impact — @factory/gears (Steps 34–44)

> Phase: ksp-gears | Steps: 34–44 | Completed: 2026-06-10

---

## Affected Files

| File affected | Component (from architecture.md) | Impact type | Severity |
|---|---|---|---|
| `packages/schemas/src/atom-directive.ts` | `@factory/schemas` — canonical type layer | regra-nova | HIGH — adds `skillRef` and `role` fields; consumers of AtomDirective must handle new required fields |
| `packages/schemas/src/index.ts` | `@factory/schemas` — barrel export | delta-de-contrato-externo | LOW — adds new exports, no breakage |
| `packages/schemas/src/gear-types.ts` | `@factory/schemas` — canonical type layer | regra-nova | MEDIUM — introduces `ToolPolicy`, `RoleModelBinding`, `SourceRef` as new canonical schema types |
| `packages/gears/package.json` | `@factory/gears` — new package | componente-novo | HIGH — new workspace package; must be wired into workers |
| `packages/gears/tsconfig.json` | `@factory/gears` — build config | componente-novo | LOW — build config only |
| `packages/gears/src/index.ts` | `@factory/gears` — barrel | componente-novo | MEDIUM — public API surface |
| `packages/gears/src/flue/agents.ts` | `@factory/gears/flue` — Agent profile registry | componente-novo | HIGH — replaces `deriveRole()` heuristic; consumers MUST use `PROFILE_BY_ROLE[directive.role]` directly |
| `packages/gears/src/flue/sandbox.ts` | `@factory/gears/flue` — Sandbox class | componente-novo | HIGH — replaces `@factory/harness-bridge` Sandbox; all outbound API key injection centralised here |
| `packages/gears/src/flue/index.ts` | `@factory/gears/flue` — flue barrel | componente-novo | LOW — barrel export |
| `packages/gears/src/gears/role.ts` | `@factory/gears/gears` — runtime role enum | componente-novo | MEDIUM — defines lowercase `RoleName` for runtime use |
| `packages/gears/src/gears/types.ts` | `@factory/gears/gears` — Gear registry types | componente-novo | HIGH — defines `Gear`, `GearFormula`, `GearMolecule` replacing Gas City Pack/Formula/Molecule vocabulary |
| `packages/gears/src/beads/types.ts` | `@factory/gears/beads` — ExecutionBead schema | componente-novo | HIGH — defines `ExecutionBead` mapping to `execution_beads` SQLite table; KSP-Bead Graph bridge type |
| `packages/gears/src/beads/coordinator-do.ts` | `@factory/gears/beads` — CoordinatorDO | componente-novo | CRITICAL — replaces Gas City FactoryStore DO; single writer per WorkGraph run; `writeAudit()` wired to D1; `recordOutcome()` wires LoopClosureService (Bridge Point 3) |
| `packages/gears/src/beads/hook.ts` | `@factory/gears/beads` — CoordinatorDO hooks | componente-novo | HIGH — replaces Gas City bead claim/release API; consumed by Conducting Agent |
| `packages/gears/src/beads/index.ts` | `@factory/gears/beads` — beads barrel | componente-novo | LOW — barrel export |
| `packages/gears/cloudflare.ts` | `@factory/gears` — Cloudflare DO class exports | componente-novo | HIGH — registers `CoordinatorDO` and `Sandbox` as Cloudflare DO classes |
| `packages/gears/wrangler.jsonc` | Cloudflare deployment | delta-de-contrato-externo | HIGH — adds D1_AUDIT, COORDINATOR_DO, ARTIFACT_GRAPH, BEAD_GRAPH, KV bindings to worker config |
| `packages/gears/types/flue-runtime.d.ts` | `@factory/gears` — type stubs | componente-novo | LOW — type stubs for @flue/runtime; replace when @flue/runtime publishes types |

---

## Preserved Rules (cross-referenced against domain.md)

The following domain rules from `domain.md` are fully preserved by this implementation:

| Rule | How preserved |
|---|---|
| **BR-01 Signal Idempotency** | CoordinatorDO does not touch Signal/D1-factory pipeline; only adds D1_AUDIT (new database binding) |
| **BR-02 Birth Gate** | CoordinatorDO is post-gate; only manages bead execution after WorkGraph compilation |
| **BR-03 Architect Approval Gate** | Unaffected; gate is in pipeline.ts WorkflowEntrypoint |
| **BR-05 Coherence Verification Fail-Closed** | Unaffected; gate is in ff-gates worker |
| **BR-07 Feedback Loop Depth Cap** | Unaffected; CoordinatorDO does not produce feedback signals |
| **BR-11 Graph Path Deprecated** | Aligned — CoordinatorDO replaces SynthesisCoordinator dispatch path |
| **KSP BR-KSP-14** | Step 41 (recordOutcome wiring) blocked until loop-closure Step 26 green — enforced |
| **KSP BR-KSP-16** | `initRun()` guard enforced in both `writeAudit()` and `recordOutcome()` |
| **KSP BR-KSP-17** | `writeAudit()` fully wired to D1 — not a stub |
| **Append-only invariant** | Bead state transitions are append-only: ready → in_progress → done/failed. No delete operations. |
| **@factory/ naming** | All imports use `@factory/loop-closure`, `@factory/factory-graph` — never `@koales/` |

---

## Components Retired (scope for Steps 47-48)

| Component | Replaced by |
|---|---|
| `@factory/harness-bridge` | `@factory/gears` |
| `@factory/runtime` (stub) | `@factory/gears` |
| Gas City Supervisor URL binding | `COORDINATOR_DO` binding |
| Gas City molecule/bead protocol | `CoordinatorDO` + `ExecutionBead` |
