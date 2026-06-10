# Tasks — @factory/gears

> Module: ksp-gears | Package: `@factory/gears`
> doc_level: completo | Generated: 2026-06-10
> Source: SPEC-FF-GEARS-001 §14 + CLAUDE.md implementation sequence (Steps 34–44)

---

## Prerequisites

Before any task in this module begins, the following Phase 1–3 KSP packages must compile clean:

| Package | Gate |
|---------|------|
| `@factory/artifact-graph` | `tsc --noEmit` zero errors |
| `@factory/bead-graph` | `tsc --noEmit` zero errors |
| `@factory/ksp-sdk` | `tsc --noEmit` zero errors |
| `@factory/loop-closure` | `tsc --noEmit` zero errors + all five bridge-point tests passing |
| `@factory/factory-graph` | `tsc --noEmit` zero errors |

**Hard gate (BR-KSP-14):** Step 41 (LoopClosureService wiring) must NOT be implemented until `ksp-loop-closure` Step 26 is green.

Steps 34–40, 42–44 proceed independently of the loop-closure gate.

---

## Step 34: packages/schemas/src/atom-directive.ts — Add skillRef + role Fields

**File**: `packages/schemas/src/atom-directive.ts`

**What to implement:**
- Add `skillRef: z.string().min(1)` to the `AtomDirective` Zod schema
- Add `role: z.enum(['planner', 'coder', 'critic', 'tester', 'verifier'])` to the schema
- All existing fields remain unchanged (SPEC-CONDUCTING-AGENT-001 §1.2 canonical)
- `skillRef` is the declared skill name passed to `session.skill()` at workflow execution
- `role` is the authoritative role source, populated at compile time by the Mediation Agent from `Gear.role`

**Why:** `role` replaces the deleted `deriveRole()` heuristic. Without it the Flue workflow has no authoritative way to select the correct `AgentProfile`.

**Gate:** `tsc --noEmit` zero errors

**Done criterion:** `tsc --noEmit` exits 0 with no type errors in `packages/schemas/`.

**Confidence:** 🟢 (spec explicitly provides the exact Zod additions — SPEC-FF-GEARS-001 §5)

---

## Step 35: packages/gears/ Scaffold + package.json

**File**: `packages/gears/package.json` + directory scaffold

**What to implement:**
- Create `packages/gears/` directory tree matching the structure in design.md §2
- Create `package.json` with:
  - `name: "@factory/gears"`
  - `exports` pointing to `src/index.ts` (or compiled dist)
  - `peerDependencies` or `dependencies` for `@flue/runtime`, `@cloudflare/sandbox`, `@factory/schemas`, `@factory/loop-closure`, `@factory/factory-graph`
  - `devDependencies` for `typescript`, `zod`
- Create empty placeholder `src/index.ts` (will be replaced in Step 43)
- Add to `pnpm-workspace.yaml` if not already present

**Gate:** `pnpm install` completes without error; package appears in `pnpm list`

**Done criterion:** `pnpm install` exits 0; `packages/gears/` is recognized as a workspace package.

**Confidence:** 🟢 (package name and dependency list confirmed by SPEC-FF-GEARS-001 §10)

---

## Step 36: src/flue/sandbox.ts

**File**: `packages/gears/src/flue/sandbox.ts`

**What to implement:**
- Import `Sandbox as BaseSandbox` from `@cloudflare/sandbox`
- Create local `inject(req, header, value): Request` helper — creates new `Headers`, sets header, returns `new Request(req, { headers })`
- Export `class Sandbox extends BaseSandbox` with `static outboundByHost`:
  - `'api.anthropic.com'` → `inject(req, 'x-api-key', env.ANTHROPIC_API_KEY)`
  - `'api.openai.com'` → `inject(req, 'Authorization', \`Bearer ${env.OPENAI_API_KEY}\`)`
  - `'api.deepseek.com'` → `inject(req, 'Authorization', \`Bearer ${env.DEEPSEEK_API_KEY}\`)`
  - `'api.github.com'` → `inject(req, 'Authorization', \`Bearer ${env.GITHUB_TOKEN}\`)`
- Define `interface Env` with all four key fields

**Note:** Per-role gating is NOT in this class. It is in `toolPolicy` at the application layer (GD-005).

**Gate:** `tsc --noEmit` zero errors

**Done criterion:** `tsc --noEmit` exits 0 with no type errors.

**Confidence:** 🟢 (exact implementation provided in SPEC-FF-GEARS-001 §6)

---

## Step 37: src/flue/agents.ts

**File**: `packages/gears/src/flue/agents.ts`

**What to implement:**
- Import `{ defineAgentProfile }` from `@flue/runtime` and `type { AgentProfile }` from `@flue/runtime`
- Export five `AgentProfile` constants: `plannerProfile`, `coderProfile`, `criticProfile`, `testerProfile`, `verifierProfile`
  - `plannerProfile`: `model: 'anthropic/claude-opus-4-6'`, `instructions: 'You are the Factory planner. Execute the assigned atom instruction.'`
  - `coderProfile`: `model: 'anthropic/claude-opus-4-6'`, instructions for coder role
  - `criticProfile`, `testerProfile`, `verifierProfile`: `model: 'openai/gpt-5.5'`, role-appropriate instructions
- Export `const PROFILE_BY_ROLE` as `const` object mapping role string to profile
- Export `type RoleName = keyof typeof PROFILE_BY_ROLE`
- Skills are workspace-discovered from `.agents/skills/` — NO SKILL.md imports here
- NO `deriveRole()` function anywhere in this file

**Note:** `sandbox` is NOT set on a profile. It is set at `createAgent()` time.

**Gate:** `tsc --noEmit` zero errors

**Done criterion:** `tsc --noEmit` exits 0; `PROFILE_BY_ROLE['planner']` resolves to `plannerProfile` at type level.

**Confidence:** 🟢 (exact API and values provided in SPEC-FF-GEARS-001 §6)

---

## Step 38: src/gears/types.ts

**File**: `packages/gears/src/gears/types.ts`

**What to implement:**
- Import from `zod` and `@factory/schemas` (for `RoleName`, `RoleModelBinding`, `ToolPolicy`, `SourceRef`)
- Define and export Zod schemas + inferred types for:
  - `Gear` — fields: `id` (GEAR-* hash), `name`, `role: RoleName`, `modelBinding: RoleModelBinding`, `skillRef`, `toolPolicy: ToolPolicy`, `beadType`, `source_refs: SourceRef[]`
  - `GearFormula` — fields: `id` (FORMULA-*), `name`, `gearIds: string[]`, `edges: Array<{ from, to, type }>`, `source_refs`
  - `GearMolecule` — fields: `id` (MOLECULE-*), `formulaId`, `runId`, `beadIds: string[]`, `status: 'active' | 'done' | 'failed'`, `source_refs`

**Gate:** `tsc --noEmit` zero errors

**Done criterion:** `tsc --noEmit` exits 0.

**Confidence:** 🟢 (type definitions provided in SPEC-FF-GEARS-001 §4)

---

## Step 39: src/beads/types.ts — ExecutionBead Zod Schema (§7a)

**File**: `packages/gears/src/beads/types.ts`

**What to implement:**
- Import `{ z }` from `zod`
- Define and export:
  - `ExecutionBeadStatus = z.enum(['ready', 'in_progress', 'done', 'failed'])`
  - `ExecutionBead = z.object({...})` matching the `execution_beads` SQLite table exactly:
    - `id: z.string()`
    - `molecule_id: z.string()`
    - `gear_id: z.string()`
    - `node_id: z.string()`
    - `status: ExecutionBeadStatus`
    - `assigned_to: z.string().nullable()`
    - `attempt_count: z.number().int()`
    - `payload: z.string().nullable()` — JSON: AtomDirective
    - `result: z.string().nullable()` — JSON: ConductingAgentTraceFragment
    - `created_at: z.number().nullable()`
    - `updated_at: z.number().nullable()`
  - Export TypeScript types: `type ExecutionBead = z.infer<typeof ExecutionBead>` and `type ExecutionBeadStatus = z.infer<typeof ExecutionBeadStatus>`

**Cross-reference:** `ExecutionBead.id` maps to `CommitBead.content.artifact_graph_execution_id` in the Bead Graph. `ExecutionBead.result` maps to the `ExecutionTrace` node in the artifact graph written by `LoopClosureService`.

**Gate:** `tsc --noEmit` zero errors

**Done criterion:** `tsc --noEmit` exits 0; schema fields match the SQL table column names exactly.

**Confidence:** 🟢 (exact schema provided in SPEC-FF-GEARS-001 §7a)

---

## Step 40: src/beads/coordinator-do.ts — initRun() + writeAudit() Wired (Step 5a Only)

**File**: `packages/gears/src/beads/coordinator-do.ts`

**What to implement (Step 5a — NO LoopClosureService yet):**
- Import `{ DurableObject }` from `'cloudflare:workers'`
- Import `type { ConductingAgentTraceFragment }` from conducting-agent types
- Import `type { ExecutionBead }` from `'./types.js'`
- Define `interface Env` with `D1_AUDIT: D1Database`, `ARTIFACT_GRAPH`, `BEAD_GRAPH`, `KV` (all present even if recordOutcome is stubbed)
- Export `class CoordinatorDO extends DurableObject<Env>` with:
  - `private sql: SqlStorage`
  - `private runId: string = ''`
  - `private orgId: string = ''`
  - Constructor: `ctx.blockConcurrencyWhile` restoring runId/orgId from storage; calls `this.migrate()`
  - `private migrate(): void` — `CREATE TABLE IF NOT EXISTS` for both SQLite tables
  - `async initRun(runId, orgId): Promise<void>` — sets properties + `ctx.storage.put`
  - `async alarm(): Promise<void>` — re-hooks stalled beads, re-arms alarm
  - `async claimBead(beadId, agentId): Promise<ExecutionBead | null>` — atomic CAS UPDATE RETURNING
  - `async releaseBead(beadId, agentId, result): Promise<void>` — UPDATE done, writeAudit, recordOutcome
  - `async failBead(beadId, agentId, result): Promise<void>` — UPDATE failed, writeAudit, recordOutcome
  - `async getNextReady(moleculeId): Promise<ExecutionBead | null>` — dependency-aware SELECT
  - `private async writeAudit(beadId, agentId, verdict): Promise<void>` — D1 INSERT (fully implemented, not a stub)
  - `private async recordOutcome(...): Promise<void>` — **stub at this step**: early return if `!this.runId || !this.orgId` (will be wired in Step 41)
  - `async fetch(req): Promise<Response>` — POST /init, /claim, /release, /fail, /next routing

**Critical ordering invariant (FR-06, BR-KSP-16):** `initRun()` must be called before `writeAudit()` or `recordOutcome()` produce meaningful output. The guard `if (!this.runId || !this.orgId) return` in both methods enforces this without throwing.

**writeAudit() is NOT a stub (BR-KSP-17):** The D1 write must be fully implemented in this step. No TODO comment. No no-op placeholder.

**Gate:** `tsc --noEmit` zero errors

**Done criterion:** `tsc --noEmit` exits 0; `writeAudit()` makes a real `D1_AUDIT.prepare(...).bind(...).run()` call at the TypeScript level.

**Confidence:** 🟢 (full implementation provided in SPEC-FF-GEARS-001 §7b)

---

## Step 41: src/beads/coordinator-do.ts — Add recordOutcome() + LoopClosureService Wiring (Step 5b)

**File**: `packages/gears/src/beads/coordinator-do.ts` (update)

**Dependency gate:** DO NOT implement until `ksp-loop-closure` Step 26 is green (all five bridge-point tests passing). This is a hard sequencing gate (BR-KSP-14, domain.md).

**What to implement:**
- Add import: `import { LoopClosureService } from '@factory/loop-closure'`
- Add imports: `factoryDivergenceDetector`, `factoryHypothesisBuilder`, `factoryAmendmentVerifier`, `FactoryArtifactGraphDO`, `FactoryBeadGraphDO` from `'@factory/gears/factory-graph'` (or `@factory/factory-graph`)
- Implement `private async recordOutcome(beadId, agentId, resultJson, verdict)`:
  - Early return if `!this.runId || !this.orgId`
  - `const trace = JSON.parse(resultJson) as ConductingAgentTraceFragment`
  - `const ns = \`factory:${this.orgId}:${this.runId}\``
  - Construct `LoopClosureService` with:
    - `artifactGraphDO`: `this.env.ARTIFACT_GRAPH.get(this.env.ARTIFACT_GRAPH.idFromName(ns))`
    - `beadGraphDO`: `this.env.BEAD_GRAPH.get(this.env.BEAD_GRAPH.idFromName(this.orgId))`
    - `kvStore`: `this.env.KV`
    - `detectDivergences`: `factoryDivergenceDetector`
    - `buildHypothesis`: `factoryHypothesisBuilder`
    - `verifyAmendment`: `factoryAmendmentVerifier`
  - Call `await loopClosure.recordOutcome(beadId, beadId, { status: verdict === 'done' ? 'SUCCESS' : 'FAILURE', summary: trace.rawOutput?.slice(0, 500) ?? '', toolCallCount: 0 })`

**Integration test:** `BuildOutcomeBead` is written to the Bead Graph on `releaseBead()`; an `ExecutionTrace` node is written to the Artifact Graph by `LoopClosureService`.

**Gate:** Integration test: `BuildOutcomeBead` written; `ExecutionTrace` node in artifact graph

**Done criterion:** Integration test passes; both graph nodes observable after a `releaseBead()` call.

**Confidence:** 🟢 (exact implementation provided in SPEC-FF-GEARS-001 §7b)

---

## Step 42: src/beads/hook.ts

**File**: `packages/gears/src/beads/hook.ts`

**What to implement:**
- Import `type { ExecutionBead }` from `'./types.js'`
- Export four async functions (all accept `DurableObjectStub` as first arg):
  - `claimHook(stub, beadId, agentId): Promise<ExecutionBead | null>` — `POST /claim`, returns JSON
  - `releaseHook(stub, beadId, agentId, result): Promise<void>` — `POST /release`
  - `failHook(stub, beadId, agentId, result): Promise<void>` — `POST /fail`
  - `getNextReady(stub, moleculeId): Promise<ExecutionBead | null>` — `POST /next`, returns JSON

Each function calls `stub.fetch(new Request('https://do/path', { method: 'POST', body: JSON.stringify(args) }))` and parses the response.

**Gate:** `tsc --noEmit` zero errors

**Done criterion:** `tsc --noEmit` exits 0; all four function signatures match the types expected by `atom-execution.ts`.

**Confidence:** 🟢 (function signatures provided in SPEC-FF-GEARS-001 §7)

---

## Step 43: src/index.ts Barrel

**File**: `packages/gears/src/index.ts`

**What to implement:**
- Re-export public surface:
  ```typescript
  export * from './flue/agents.js'
  export * from './flue/sandbox.js'
  export * from './gears/types.js'
  export * from './beads/types.js'
  export * from './beads/coordinator-do.js'
  export * from './beads/hook.js'
  ```
- Do NOT export `src/skills/` internals (workspace-discovered, not imported)

**Gate:** `tsc --noEmit` zero errors

**Done criterion:** `tsc --noEmit` exits 0; `import { CoordinatorDO, PROFILE_BY_ROLE, Sandbox } from '@factory/gears'` resolves without type errors.

**Confidence:** 🟢 (barrel pattern matches package structure in SPEC-FF-GEARS-001 §3)

---

## Step 44: Update cloudflare.ts + wrangler.jsonc (per SPEC-FF-GEARS-001 §11)

**Files**: `cloudflare.ts` (project root) + `wrangler.jsonc`

**What to implement in cloudflare.ts:**
```typescript
export { Sandbox }          from '@factory/gears/flue'
export { CoordinatorDO }    from '@factory/gears/beads'
export { MediationAgentDO } from '@factory/mediation-agent'
export { ArchitectAgentDO } from '@factory/architect-agent'
```

**What to add to wrangler.jsonc:**
- `migrations[].new_sqlite_classes` — add `"CoordinatorDO"`, `"Sandbox"`, `"FactoryArtifactGraphDO"`, `"FactoryBeadGraphDO"` (alongside existing classes)
- `containers[]` — add `{ "class_name": "Sandbox", "image": "./Dockerfile", "max_instances": 10 }`
- `durable_objects.bindings` — add `COORDINATOR_DO`, `ARTIFACT_GRAPH`, `BEAD_GRAPH`, `Sandbox` bindings
- `kv_namespaces` — add `{ "binding": "KV", "id": "<provision>" }`
- `d1_databases` — add `{ "binding": "D1_AUDIT", "database_name": "factory-bead-audit", "database_id": "<provision>" }`

**Removed env bindings** (previously in Conducting Agent):
- `GAS_CITY_SUPERVISOR_URL` — removed (replaced by `COORDINATOR_DO`)

**Gate:** `wrangler dev` starts without error

**Done criterion:** `wrangler dev` starts; `CoordinatorDO` and `Sandbox` are listed as DO classes in the Wrangler output.

**Confidence:** 🟢 (exact additions specified in SPEC-FF-GEARS-001 §11)

---

## Post-Gears Steps (Outside This Package)

The following steps depend on `@factory/gears` being complete but are implemented in other packages:

| Step | File | Dependency |
|------|------|-----------|
| ~45 | `.flue/workflows/atom-execution.ts` — Conducting Agent as Flue workflow | SPEC-FF-JUSTBASH-001-004; depends on Steps 34–44 |
| ~46 | `.agent/skills/` → `.agents/skills/` rename | `flue dev` discovers skills (GD-003) |
| ~47 | Delete `packages/harness-bridge/`, `packages/runtime/` | `tsc --noEmit` repo-wide |
| ~48 | Rewrite WEO-7, 8, 9, 12, 15 in Linear | Issues unblocked (GD-004) |

---

## Summary Table

| Step | File | Gate | Confidence | Blocked By |
|------|------|------|-----------|-----------|
| 34 | `packages/schemas/src/atom-directive.ts` | `tsc --noEmit` | 🟢 ✅ | None |
| 35 | `packages/gears/` scaffold + `package.json` | `pnpm install` | 🟢 ✅ | None |
| 36 | `src/flue/sandbox.ts` | `tsc --noEmit` | 🟢 ✅ | Step 35 |
| 37 | `src/flue/agents.ts` | `tsc --noEmit` | 🟢 ✅ | Step 35 |
| 38 | `src/gears/types.ts` | `tsc --noEmit` | 🟢 ✅ | Steps 34, 35 |
| 39 | `src/beads/types.ts` | `tsc --noEmit` | 🟢 ✅ | Step 35 |
| 40 | `src/beads/coordinator-do.ts` — initRun + writeAudit | `tsc --noEmit` | 🟢 ✅ | Steps 35, 39 |
| 41 | `src/beads/coordinator-do.ts` — recordOutcome + LoopClosureService | Integration test | 🟢 ✅ | ksp-loop-closure Step 26 |
| 42 | `src/beads/hook.ts` | `tsc --noEmit` | 🟢 ✅ | Steps 35, 39 |
| 43 | `src/index.ts` barrel | `tsc --noEmit` | 🟢 ✅ | Steps 36–42 |
| 44 | `cloudflare.ts` + `wrangler.jsonc` | `wrangler dev` starts | 🟢 ✅ | Step 43 |
