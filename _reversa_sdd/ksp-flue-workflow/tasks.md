# Tasks — ksp-flue-workflow (.flue/workflows/atom-execution.ts)

> Module: `.flue/workflows/atom-execution.ts`
> Source spec: SPEC-FF-JUSTBASH-001-004
> doc_level: completo | Generated: 2026-06-10
> Package naming: `@factory/*` (former `@koales/*`)

---

## Prerequisites

The following phases MUST be complete before any task in this module begins:

| Phase | Packages | Gate |
|-------|----------|------|
| Phase 1 | `@factory/artifact-graph`, `@factory/bead-graph` | `tsc --noEmit` |
| Phase 2 | `@factory/ksp-sdk` | `tsc --noEmit` |
| Phase 3 | `@factory/loop-closure` | tests pass (BR-KSP-14 HARD GATE) |
| Phase 4 | `@factory/factory-graph`, `@factory/gears` | `tsc --noEmit` |

Steps 1–8 below (through Step 8 / `cloudflare.ts` + `wrangler.jsonc`) proceed independently of Phase 3 (loop-closure). Only `coordinator-do.ts` Step 5b (`recordOutcome()`) requires Phase 3.

---

## Step 1: packages/schemas/src/atom-directive.ts — Add skillRef and role

**Corresponds to:** SPEC-FF-JUSTBASH-001 | Implementation sequence Step 1

**File:** `packages/schemas/src/atom-directive.ts`

**What to implement:**
Add two fields to the existing `AtomDirective` Zod object. All other fields remain unchanged:

```typescript
skillRef: z.string().min(1),
// declared skill name passed to session.skill()
// populated by Mediation Agent compile step from Gear.skillRef

role: z.enum(['planner', 'coder', 'critic', 'tester', 'verifier']),
// for PROFILE_BY_ROLE[directive.role] — replaces deriveRole() heuristic (deleted)
```

**Gate:** `tsc --noEmit` — zero errors before Step 2.

**Done criterion:** TypeScript compiles clean. `AtomDirective.safeParse({...skillRef: 'coding', role: 'coder'...})` succeeds.

**Confidence:** 🟢 SPEC-FF-JUSTBASH-001 — explicit field definitions with comments.

---

## Step 2: packages/gears/src/flue/sandbox.ts — CF Sandbox with outbound injection

**Corresponds to:** SPEC-FF-JUSTBASH-002 | Implementation sequence Step 2

**File:** `packages/gears/src/flue/sandbox.ts`

**What to implement:**
Extend `@cloudflare/sandbox` Sandbox with `outboundByHost` map:
- `api.anthropic.com` → inject `x-api-key: env.ANTHROPIC_API_KEY`
- `api.openai.com` → inject `Authorization: Bearer env.OPENAI_API_KEY`
- `api.deepseek.com` → inject `Authorization: Bearer env.DEEPSEEK_API_KEY`
- `api.github.com` → inject `Authorization: Bearer env.GITHUB_TOKEN`

Export from `cloudflare.ts` project root as `export { Sandbox } from '@factory/gears/flue'`.

**Gate:** `tsc --noEmit` — zero errors.

**Done criterion:** TypeScript compiles clean. `Sandbox.outboundByHost` keys resolve to inject functions.

**Confidence:** 🟢 SPEC-FF-JUSTBASH-002 — full implementation in spec.

---

## Step 3: packages/gears/src/flue/agents.ts — PROFILE_BY_ROLE map

**Corresponds to:** SPEC-FF-JUSTBASH-002 | Implementation sequence Step 3

**File:** `packages/gears/src/flue/agents.ts`

**What to implement:**
Define five `AgentProfile` constants using `defineAgentProfile` from `@flue/runtime`:
- `plannerProfile` — model: `anthropic/claude-opus-4-6`
- `coderProfile` — model: `anthropic/claude-opus-4-6`
- `criticProfile` — model: `openai/gpt-5.5`
- `testerProfile` — model: `openai/gpt-5.5`
- `verifierProfile` — model: `openai/gpt-5.5`

Export `PROFILE_BY_ROLE` const map and `RoleName` type.

Critical constraints:
- NO `sandbox` field on profiles — sandbox is set at `createAgent()` time.
- NO `skill` field on profiles — skills are workspace-discovered.

**Gate:** `tsc --noEmit` — zero errors.

**Done criterion:** `PROFILE_BY_ROLE['coder']` resolves to the coder profile. TypeScript compiles clean.

**Confidence:** 🟢 SPEC-FF-JUSTBASH-002 — full implementation including model assignments.

---

## Step 4: packages/gears/src/beads/types.ts — ExecutionBead Zod schema

**Corresponds to:** SPEC-FF-GEARS-001 §4 | Implementation sequence Step 4

**File:** `packages/gears/src/beads/types.ts`

**What to implement:**
Define the `ExecutionBead` Zod schema with fields for bead lifecycle management:
- `id` (string), `moleculeId` (string), `status` enum (`ready | in_progress | done | failed`)
- `payload` (string | undefined), `assignedTo` (string | undefined)
- `attempt_count` (number), `updated_at` (string — ISO 8601)

Export inferred TypeScript type `ExecutionBead`.

**Gate:** `tsc --noEmit` — zero errors before Step 5a.

**Done criterion:** TypeScript compiles clean. Schema validates a bead record correctly.

**Confidence:** 🟡 INFERRED — schema shape derived from CoordinatorDO SQL table definitions and `getNextReady()` return type in spec.

---

## Step 5a: packages/gears/src/beads/coordinator-do.ts — initRun() + writeAudit()

**Corresponds to:** SPEC-FF-JUSTBASH-003, SPEC-FF-GEARS-001 §7b (Gaps 1, 6) | Implementation sequence Step 5a

**File:** `packages/gears/src/beads/coordinator-do.ts`

**What to implement (Steps 1–2 — independent of Phase 3):**

1. **`initRun(runId: string, orgId: string)`** — stores `runId` and `orgId` as DO instance properties AND persists to DO storage (`ctx.storage.put()`). Idempotent — second call with same args is a no-op. Required: `writeAudit()` and `recordOutcome()` throw if called before `initRun()`.

2. **`writeAudit(beadId, gearId, agentId, verdict, attempt)`** — writes a row to D1 `bead_audit` table. Fields: `run_id`, `bead_id`, `gear_id`, `agent_id`, `verdict`, `attempt`, `ts`. NOT a stub — fully implemented D1 insert. (BR-KSP-17)

3. **`fetch()` handler gains `POST /init` route** — parses body as `[runId, orgId]`, calls `initRun()`, returns `200 OK`.

4. **Stalled-bead alarm** — `alarm()` fires every 5 minutes. Re-queues `in_progress` beads with `updated_at < (now - 5min)` → `status='ready', assigned_to=NULL`. Re-arms itself.

**Gate:** D1 audit row written on `releaseBead()` — verify with `wrangler d1 execute`.

**Done criterion:** `POST /init` returns 200. `releaseBead()` triggers `writeAudit()` and a row appears in D1 `bead_audit`.

**Confidence:** 🟢 SPEC-FF-GEARS-001 §7b, SPEC-FF-JUSTBASH-003 — explicit implementation requirements.

---

## Step 5b: packages/gears/src/beads/coordinator-do.ts — recordOutcome()

**Corresponds to:** SPEC-FF-GEARS-001 §7b (Gap 7, Bridge Point 3) | Implementation sequence Step 5b

**Prerequisite:** Phase 3 (`@factory/loop-closure`) tests passing (BR-KSP-14 HARD GATE).

**File:** `packages/gears/src/beads/coordinator-do.ts`

**What to implement:**
Add `recordOutcome()` wired to `LoopClosureService` (SPEC-KSP-LOOP-CLOSURE-001 Bridge Point 3):
- Writes `ExecutionTrace` node to the artifact graph.
- Writes `BuildOutcomeBead` to the Bead graph.
- On failure outcome: also writes `Divergence` node to the artifact graph.
- Called from `releaseBead()` and `failBead()`.

**Gate:** Integration test — `BuildOutcomeBead` written to BeadGraphDO; `ExecutionTrace` node present in ArtifactGraphDO.

**Done criterion:** On `releaseBead()`, both the D1 audit row (Step 5a) and `BuildOutcomeBead` are written. On `failBead()`, a `Divergence` node is also written.

**Confidence:** 🟡 INFERRED from SPEC-KSP-LOOP-CLOSURE-001 §2 Bridge Point 3 + CoordinatorDO integration requirements. Exact `LoopClosureService` method signatures depend on Phase 3 implementation.

---

## Step 6: packages/gears/src/beads/hook.ts — DO fetch wrappers

**Corresponds to:** SPEC-FF-GEARS-001 §7 | Implementation sequence Step 6

**File:** `packages/gears/src/beads/hook.ts`

**What to implement:**
Four exported async functions that wrap DO fetch calls:

```typescript
claimHook(stub: DurableObjectStub, beadId: string, agentId: string): Promise<ExecutionBead | null>
releaseHook(stub: DurableObjectStub, beadId: string, agentId: string, result: string): Promise<void>
failHook(stub: DurableObjectStub, beadId: string, agentId: string, result: string): Promise<void>
getNextReady(stub: DurableObjectStub, moleculeId: string): Promise<ExecutionBead | null>
```

Each function issues a `POST` to the corresponding CoordinatorDO route (`/claim`, `/release`, `/fail`, `/next`) and handles the response.

**Gate:** `tsc --noEmit` — zero errors.

**Done criterion:** TypeScript compiles clean. Each function signature matches the spec exactly.

**Confidence:** 🟢 SPEC-FF-GEARS-001 §7 — signatures explicit.

---

## Step 7: packages/gears/src/index.ts — barrel export

**Corresponds to:** SPEC-FF-GEARS-001 | Implementation sequence Step 7

**File:** `packages/gears/src/index.ts`

**What to implement:**
Export everything from the gears sub-packages:
```typescript
export * from './flue/sandbox.js'
export * from './flue/agents.js'
export * from './beads/types.js'
export * from './beads/hook.js'
export * from './beads/coordinator-do.js'
```

**Gate:** `tsc --noEmit` — zero errors.

**Done criterion:** `import { PROFILE_BY_ROLE, claimHook, releaseHook, failHook, getNextReady } from '@factory/gears'` resolves without error.

**Confidence:** 🟢 Standard barrel pattern — implied by spec imports.

---

## Step 8: cloudflare.ts + wrangler.jsonc — bindings

**Corresponds to:** SPEC-FF-JUSTBASH-004 | Implementation sequence Step 8

**Files:** `cloudflare.ts`, `wrangler.jsonc`

**What to implement:**

`cloudflare.ts` — export Sandbox and wire the workflow route handler:
```typescript
export { Sandbox } from '@factory/gears/flue'
export { route as atomExecutionRoute } from './.flue/workflows/atom-execution.js'
```

`wrangler.jsonc` — declare bindings:
- `COORDINATOR_DO` — Durable Object binding to `CoordinatorDO` class
- `SANDBOX_OUTPUT_BUCKET` — R2 bucket binding
- `Sandbox` — Durable Object binding to `Sandbox` class
- Secrets: `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, `DEEPSEEK_API_KEY`, `GITHUB_TOKEN`
- Workflow route: `POST /workflows/atom-execution` → `atom-execution.ts run()`

**Gate:** `wrangler dev` starts without errors.

**Done criterion:** `wrangler dev` starts and `POST /workflows/atom-execution` is reachable (even before workflow logic is complete).

**Confidence:** 🟡 INFERRED — binding names from Env interface in SPEC-FF-JUSTBASH-004; exact wrangler.jsonc syntax is standard Cloudflare pattern.

---

## [X] Step 45: .flue/workflows/atom-execution.ts — main workflow

**Corresponds to:** SPEC-FF-JUSTBASH-004 | Implementation sequence Step 9 (renumbered Step 45 per CLAUDE.md)

**File:** `.flue/workflows/atom-execution.ts`

**What to implement:**

Full workflow file with the following exports and functions:

- `export const route: WorkflowRouteHandler` — passthrough `async (_c, next) => next()`
- `export async function run(ctx: FlueContext<AtomExecutionPayload, Env>)` — main entry (see Design §2.1)
- `export async function extractWorkspaceDelta(harness, seedPaths: Set<string>)` — VFS diff helper
- (internal) `async function executeWithRetry(...)` — retry loop with `ConductingAgentTraceFragment` output
- (internal) `async function runFlueSession(...)` — five Flue bridge points
- (internal) `async function evaluateSuccessCondition(...)` — ASYNC, takes `harness` param (BR-KSP-18)
- (internal) `async function storeFullOutput(...)` — R2 write
- (internal) `function sleep(ms)` — Promise timeout

Key invariants to enforce during implementation:
- `PROFILE_BY_ROLE[directive.role]` — never `deriveRole()` (BR-KSP-19)
- `evaluateSuccessCondition` is async with `harness` as third parameter (BR-KSP-18)
- `POST /init` on CoordinatorDO before `getNextReady()` (BR-KSP-16)
- `Promise.race([session.skill(...), sleep(directive.timeoutMs)])` for timeout enforcement

**Gate:** `tsc --noEmit` — zero errors.

**Done criterion:** TypeScript compiles clean. All exports resolve. `FlueContext`, `WorkflowRouteHandler`, `FlueHarness`, `FlueSession` types from `@flue/runtime` are satisfied.

**Confidence:** 🟢 SPEC-FF-JUSTBASH-004 — full implementation in spec with verified API annotations.

---

## [X] Step 46: .agent/skills/ → .agents/skills/ rename

**Corresponds to:** SPEC-FF-JUSTBASH-004 | Implementation sequence Step 10 (renumbered Step 46 per CLAUDE.md)

**What to implement:**
Rename directory `.agent/skills/` to `.agents/skills/`. Update any import paths or configuration references that depend on the old directory name.

**Gate:** HUMAN DEV CHECK — not an agent gate. `@flue/cli` is local dev tooling only; the coding agent does not run it.

**Done criterion:** `.agents/skills/` exists with correct content; `.agent/skills/` (old path) does not exist; `skill_loader.ts` references `.agents/skills`.

**Confidence:** 🟢 SPEC-FF-JUSTBASH-004 Implementation sequence Step 10 — explicit rename requirement.

---

## [X] Step 47: Delete packages/harness-bridge/ and packages/runtime/ stubs

**Corresponds to:** SPEC-FF-JUSTBASH-004 | Implementation sequence Step 11 (renumbered Step 47 per CLAUDE.md)

**What to implement:**
Delete both retired stub packages:
- `packages/harness-bridge/` — was an adapter shim; now replaced by `@flue/runtime` direct
- `packages/runtime/` — was a runtime stub; now replaced by `@flue/runtime` direct

Also update:
- `package.json` workspaces array — remove both packages
- Any `tsconfig.json` path aliases or project references pointing to these packages
- Any `wrangler.jsonc` or build config referencing them

**Gate:** `tsc --noEmit` repo-wide — zero errors.

**Done criterion:** `tsc --noEmit` passes with zero errors across the entire monorepo. No import resolves to `harness-bridge` or `packages/runtime`.

**Confidence:** 🟢 SPEC-FF-JUSTBASH-004 — explicit deletion requirement with tsc gate.

---

## [SKIP] Step 48: Rewrite WEO-7, 8, 9, 12, 15 in Linear — MANUAL, skip in automated run

**Corresponds to:** SPEC-FF-JUSTBASH-004 | Implementation sequence Step 12 (renumbered Step 48 per CLAUDE.md)

**What to implement:**
Update the following Linear issues to reflect the Flue workflow architecture:
- WEO-7 — update to reflect `atom-execution.ts` as replacement for Conducting Agent CF Worker
- WEO-8 — update to reflect `PROFILE_BY_ROLE` + `directive.role` replacing `deriveRole()`
- WEO-9 — update to reflect Gas City retirement / Coordinator DO as new bead lifecycle owner
- WEO-12 — update to reflect `@factory/gears` as replacement for `harness-bridge` + `runtime`
- WEO-15 — update to reflect `.agents/skills/` rename and Flue skill discovery

**Gate:** MANUAL — skip in automated run. Do NOT block on this.

**Done criterion:** ⚠️ MANUAL STEP — mark complete and proceed immediately. Linear updates are done by Wes post-deployment.

**Confidence:** 🟡 INFERRED — issue numbers from SPEC-FF-JUSTBASH-004 implementation sequence; exact issue content depends on current state of Linear.

---

## Implementation Sequence Summary

| Step | File | Gate | Confidence |
|------|------|------|-----------|
| 1 | `packages/schemas/src/atom-directive.ts` — `skillRef` + `role` fields | `tsc --noEmit` | 🟢 |
| 2 | `packages/gears/src/flue/sandbox.ts` | `tsc --noEmit` | 🟢 |
| 3 | `packages/gears/src/flue/agents.ts` | `tsc --noEmit` | 🟢 |
| 4 | `packages/gears/src/beads/types.ts` — `ExecutionBead` schema | `tsc --noEmit` | 🟡 |
| 5a | `coordinator-do.ts` — `initRun()` + `writeAudit()` wired to D1 | D1 audit row written | 🟢 |
| 5b | `coordinator-do.ts` — `recordOutcome()` wired to LoopClosure | `BuildOutcomeBead` written | 🟡 |
| 6 | `packages/gears/src/beads/hook.ts` | `tsc --noEmit` | 🟢 |
| 7 | `packages/gears/src/index.ts` — barrel | `tsc --noEmit` | 🟢 |
| 8 | `cloudflare.ts` + `wrangler.jsonc` | `wrangler dev` starts | 🟡 |
| **45** | `.flue/workflows/atom-execution.ts` | `tsc --noEmit` | 🟢 |
| **46** | `.agent/skills/` → `.agents/skills/` rename | fs: `.agents/skills/` exists, `.agent/skills/` gone, `skill_loader.ts` updated | 🟢 |
| **47** | Delete `packages/harness-bridge/`, `packages/runtime/` stubs | `tsc --noEmit` repo-wide | 🟢 |
| **48** | Rewrite WEO-7, 8, 9, 12, 15 in Linear | issues updated | 🟡 |

Steps 1–5a and 5b can proceed in parallel with Phase 3 (loop-closure) — only Step 5b blocks on Phase 3 completion.
