# Requirements — ksp-flue-workflow (.flue/workflows/atom-execution.ts)

> Module: `.flue/workflows/atom-execution.ts`
> Source spec: SPEC-FF-JUSTBASH-001-004
> doc_level: completo | Generated: 2026-06-10
> Package naming: `@factory/*` (former `@koales/*`), `ksp-sdk` (former `knowing-state-sdk`)

---

## 1. Functional Requirements

### FR-01: Flue Workflow Entry Point (Replaces CF Worker)

**Confidence:** 🟢 CONFIRMED — SPEC-FF-JUSTBASH-004, spec §"Why workflow, not Worker"

The module MUST expose a `run()` function conforming to `FlueContext<AtomExecutionPayload, Env>` as the Flue workflow entry point. This replaces the prior Conducting Agent CF Worker `POST /execute` handler. The workflow is the ONLY valid entry point for atom execution — a plain CF Worker fetch handler MUST NOT be used because `ctx.init()` is only available inside a Flue workflow `run({ init, payload })`.

**Source spec:** SPEC-FF-JUSTBASH-004, spec §"Why workflow, not Worker"

**MoSCoW:** MUST

---

### FR-02: Deterministic Coordinator DO Key (GD-002)

**Confidence:** 🟢 CONFIRMED — SPEC-FF-JUSTBASH-004, code comment "GD-002"

The workflow MUST derive a deterministic `runId` for each WorkGraph execution using:
```
runId = sha256(workGraphId + workGraphVersion).hex()
doId  = COORDINATOR_DO.idFromName(`coordinator:${runId}`)
```
This ensures idempotent DO identity across retries and re-invocations of the same WorkGraph run.

**MoSCoW:** MUST

---

### FR-03: initRun Before getNextReady (BR-KSP-16)

**Confidence:** 🟢 CONFIRMED — SPEC-FF-GEARS-001 §7b (Gap 6), SPEC-FF-JUSTBASH-003, domain.md BR-KSP-16

The workflow MUST call `POST /init` on the CoordinatorDO (triggering `initRun(runId, orgId)`) before any call to `getNextReady()` or `claimBead()`. The call MUST be idempotent — safe to invoke on every workflow invocation. `writeAudit()` and `recordOutcome()` on the DO require `runId` and `orgId` to be set; calling `getNextReady()` before `/init` is undefined behaviour.

**MoSCoW:** MUST

---

### FR-04: Bead Claim — Parse — Execute — Release/Fail Lifecycle

**Confidence:** 🟢 CONFIRMED — SPEC-FF-JUSTBASH-004, full `run()` body

The workflow MUST implement the following lifecycle:
1. Call `getNextReady(doStub, moleculeId)` — if no bead is available, return `{ status: 'complete' }`.
2. Parse `bead.payload` as `AtomDirective` using `safeParse`. On parse failure, call `failHook()` and return `{ status: 'error', reason: 'invalid-directive' }`.
3. On successful parse, call `executeWithRetry()` to run the agent session.
4. If `trace.outcome === 'success'`, call `releaseHook()`; otherwise call `failHook()`.
5. Return `{ status: 'executed', outcome: trace.outcome }`.

**MoSCoW:** MUST

---

### FR-05: Role-Based Agent Profile Selection (BR-KSP-19)

**Confidence:** 🟢 CONFIRMED — SPEC-FF-JUSTBASH-004, SPEC-FF-GEARS-001 §5/§8, domain.md BR-KSP-19

The workflow MUST select the `AgentProfile` using `PROFILE_BY_ROLE[directive.role]` directly. The `deriveRole()` heuristic (prefix matching on `skillRef`) is DELETED and MUST NOT be reimplemented. `directive.role` is the authoritative source, populated by the Mediation Agent compile step from `Gear.role`.

Profiles by role:
| Role | Model |
|------|-------|
| `planner` | `anthropic/claude-opus-4-6` |
| `coder` | `anthropic/claude-opus-4-6` |
| `critic` | `openai/gpt-5.5` |
| `tester` | `openai/gpt-5.5` |
| `verifier` | `openai/gpt-5.5` |

**MoSCoW:** MUST

---

### FR-06: Sandbox Selection — Container vs Virtual

**Confidence:** 🟢 CONFIRMED — SPEC-FF-JUSTBASH-004, `runFlueSession()` body

The workflow MUST select sandbox mode based on the directive:
- **CF Container sandbox** (`getSandbox(env.Sandbox, agentRunId)`): used when `directive.permittedTools.includes('git')` OR `directive.sandboxConfig.persistFilesystem === true`.
- **Virtual sandbox (just-bash)**: used otherwise — `createAgent()` with no `sandbox` field.

**MoSCoW:** MUST

---

### FR-07: Five Flue Bridge Points in runFlueSession()

**Confidence:** 🟢 CONFIRMED — SPEC-FF-JUSTBASH-004, `runFlueSession()` body; all APIs verified

The `runFlueSession()` function MUST use the verified Flue API in this sequence:
1. `PROFILE_BY_ROLE[directive.role]` — profile selection
2. `createAgent<TPayload, TEnv>(({ id, env }) => AgentRuntimeConfig)` — agent creation
3. `ctx.init(agent)` — harness initialization (only available inside Flue workflow `run()`)
4. `harness.fs.writeFile('AGENTS.md', agentsMd)` if `directive.envVars['AGENTS_MD']` is set
5. `harness.session('atom-{directiveId}')` — session open
6. `session.skill(directive.skillRef, { args: { instruction: directive.instruction } })` with `Promise.race([..., sleep(timeoutMs)])` — skill execution with timeout

**MoSCoW:** MUST

---

### FR-08: Retry Loop with Backoff and isolatedRetry

**Confidence:** 🟢 CONFIRMED — SPEC-FF-JUSTBASH-004, `executeWithRetry()` body

The `executeWithRetry()` function MUST implement:
- Loop from `attempt = 1` to `maxAttempts` (from `directive.retryPolicy`).
- If `attempt > 1`, sleep `backoffMs` before executing.
- On `outcome === 'success'`, return immediately.
- If `!isolatedRetry` OR `attempt >= maxAttempts`, break after the current attempt.
- Return the last `ConductingAgentTraceFragment` on exhaustion.

**MoSCoW:** MUST

---

### FR-09: Async evaluateSuccessCondition with Harness Parameter (BR-KSP-18)

**Confidence:** 🟢 CONFIRMED — SPEC-FF-JUSTBASH-004 (Gap 4), domain.md BR-KSP-18

`evaluateSuccessCondition(condition, result, harness)` MUST be async and MUST accept the `FlueHarness` instance as a third parameter. The `file-exists` condition type MUST use `harness.shell('test -f {path} && echo exists')` to check filesystem state. A synchronous implementation or one without the harness parameter breaks `file-exists`. All five condition types MUST be handled:

| Type | Algorithm |
|------|-----------|
| `exit-code` | `!result.timedOut` |
| `output-contains` | `result.stdout.includes(condition.substring)` |
| `output-matches` | `new RegExp(condition.pattern).test(result.stdout)` |
| `file-exists` | `harness.shell('test -f {path} && echo exists')` → `stdout.trim() === 'exists'` |
| `composite` | `Promise.all(condition.all.map(c => evaluateSuccessCondition(c, result, harness))).every(Boolean)` |

**MoSCoW:** MUST

---

### FR-10: stdout Truncation and R2 Overflow

**Confidence:** 🟢 CONFIRMED — SPEC-FF-JUSTBASH-004, `executeWithRetry()` body

After each session, the workflow MUST:
- Set `rawOutput = result.stdout.slice(0, 4096)`.
- If `result.stdout.length > 4096`, call `storeFullOutput(stdout, directiveId, env)` which writes to R2 with key `sandbox-output/{directiveId}/{Date.now()}.txt` and returns `r2://{key}` as `sandboxOutputRef`.
- If `result.stdout.length <= 4096`, `sandboxOutputRef` is `undefined`.

**MoSCoW:** MUST

---

### FR-11: ConductingAgentTraceFragment Output

**Confidence:** 🟢 CONFIRMED — SPEC-FF-JUSTBASH-004, `executeWithRetry()` body

Each attempt MUST produce a `ConductingAgentTraceFragment` with:
- `executionId`: `${beadId}-attempt-${attempt}`
- `directiveId`, `atomRef`, `workGraphVersion`, `repoId` — from directive
- `outcome`: `'timeout'` | `'success'` | `'failure'`
- `rawOutput`: truncated to 4096 chars
- `sandboxOutputRef`: R2 URI or `undefined`
- `durationMs`, `attemptNumber`, `producedAt` (ISO 8601)

**MoSCoW:** MUST

---

### FR-12: extractWorkspaceDelta Export

**Confidence:** 🟢 CONFIRMED — SPEC-FF-JUSTBASH-004, exported helper body

The module MUST export `extractWorkspaceDelta(harness, seedPaths: Set<string>)` as an async helper that:
1. Calls `harness.shell('find /workspace -type f 2>/dev/null')` to enumerate all current files.
2. For each new path (not in `seedPaths`), reads content via `harness.fs.readFile(vPath)` and records `{ virtualPath, kind: 'added', content }`.
3. For each `seedPath` no longer present, records `{ virtualPath: seedPath, kind: 'deleted' }`.

This closes the "capture filesystem diff" TODO from `on_failure.ts`.

**MoSCoW:** SHOULD

---

### FR-13: AtomDirective Schema — skillRef and role Fields

**Confidence:** 🟢 CONFIRMED — SPEC-FF-JUSTBASH-001, schema additions

`packages/schemas/src/atom-directive.ts` MUST add two fields to the existing `AtomDirective` Zod schema:
- `skillRef: z.string().min(1)` — the declared skill name passed to `session.skill()`; populated by Mediation Agent compile step from `Gear.skillRef`.
- `role: z.enum(['planner', 'coder', 'critic', 'tester', 'verifier'])` — role for `PROFILE_BY_ROLE` lookup; replaces `deriveRole()`.

All other existing fields remain unchanged.

**MoSCoW:** MUST

---

### FR-14: Sandbox Outbound API Key Injection

**Confidence:** 🟢 CONFIRMED — SPEC-FF-JUSTBASH-002, `sandbox.ts`

`packages/gears/src/flue/sandbox.ts` MUST extend `@cloudflare/sandbox` Sandbox with `outboundByHost` injection rules:
- `api.anthropic.com` → inject `x-api-key: ANTHROPIC_API_KEY`
- `api.openai.com` → inject `Authorization: Bearer OPENAI_API_KEY`
- `api.deepseek.com` → inject `Authorization: Bearer DEEPSEEK_API_KEY`
- `api.github.com` → inject `Authorization: Bearer GITHUB_TOKEN`

**MoSCoW:** MUST

---

### FR-15: Package Cleanup — Delete Retired Stubs

**Confidence:** 🟢 CONFIRMED — SPEC-FF-JUSTBASH-004 Implementation sequence steps 10–11

After `atom-execution.ts` passes `tsc --noEmit`, the following MUST be deleted:
- `packages/harness-bridge/` — replaced by `@flue/runtime` direct
- `packages/runtime/` — replaced by `@flue/runtime` direct

The `.agent/skills/` directory MUST be renamed to `.agents/skills/` so `flue dev` discovers skills correctly.

**MoSCoW:** MUST

---

## 2. Non-Functional Requirements

### NFR-01: Performance — Timeout Enforced at Skill Level

**Confidence:** 🟢 CONFIRMED — SPEC-FF-JUSTBASH-004, `Promise.race` in `runFlueSession()`

Skill execution MUST be raced against `sleep(directive.timeoutMs)`. If the sleep resolves first, `timedOut` is set to `true` and `stdout` is `''`. The `outcome` is then `'timeout'`. This prevents unbounded agent execution from blocking the workflow indefinitely.

---

### NFR-02: Idempotency — DO Init is Safe to Re-call

**Confidence:** 🟢 CONFIRMED — SPEC-FF-GEARS-001 §7b, code comment "idempotent"

The `POST /init` call to CoordinatorDO MUST be idempotent — calling it multiple times with the same `[runId, repoId]` arguments produces no side effects beyond the first call. This makes it safe to call on every workflow invocation without coordination.

---

### NFR-03: Availability — Fail-Closed Bead Lifecycle

**Confidence:** 🟢 CONFIRMED — SPEC-FF-GEARS-001 §7b, domain.md SM-6

On any error during parse or execution, the bead MUST be transitioned to `failed` via `failHook()`. A bead that cannot be parsed or executed MUST NOT remain in `in_progress` state. The CoordinatorDO stalled-bead alarm (5-minute interval) re-queues any `in_progress` bead not updated in >5 minutes — this is a safety net, not the primary failure path.

---

### NFR-04: Security — API Keys Injected at Sandbox Boundary

**Confidence:** 🟢 CONFIRMED — SPEC-FF-JUSTBASH-002, `sandbox.ts`

API keys (`ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, `DEEPSEEK_API_KEY`, `GITHUB_TOKEN`) MUST be injected at the CF Container sandbox outbound boundary, not passed as workflow payload fields. Keys are read from `Env` bindings (Cloudflare Secrets). The agent session MUST NOT receive raw key values in its instruction or skill args.

---

### NFR-05: Build Order — Phase 5 Constraint

**Confidence:** 🟢 CONFIRMED — architecture.md KSP Layer §Package Build Order

`.flue/workflows/atom-execution.ts` is a Phase 5 artifact in the KSP build order. It MUST NOT be implemented until Phase 4 packages (`@factory/factory-graph`, `@factory/gears`) pass `tsc --noEmit`. Specifically, `@factory/gears/flue` (sandbox, agents) and `@factory/gears/beads` (hook, coordinator-do) must be available before the workflow can import them.

---

### NFR-06: Type Safety — tsc --noEmit Gate on Every Step

**Confidence:** 🟢 CONFIRMED — SPEC-FF-JUSTBASH-004, implementation sequence gates

Every implementation step MUST pass `tsc --noEmit` with zero errors before proceeding to the next step. No step is gated on tests only — TypeScript clean compilation is the primary gate.

---

## 3. Acceptance Criteria

### AC-01: Happy Path — Atom Executes Successfully

**Given** a workflow invocation with a valid `AtomExecutionPayload` (repoId, agentId, workGraphId, workGraphVersion, moleculeId),  
**And** a `ready` bead exists in the CoordinatorDO for the given moleculeId,  
**And** the bead payload is a valid `AtomDirective` with `role: 'coder'` and `skillRef: 'coding'`,  
**And** the Flue session completes within `directive.timeoutMs` and the `successCondition` evaluates to `true`,  
**When** the Flue workflow `run()` is invoked,  
**Then** the workflow calls `POST /init` on CoordinatorDO before `getNextReady()`,  
**And** calls `releaseHook(doStub, bead.id, agentId, JSON.stringify(trace))`,  
**And** returns `{ status: 'executed', outcome: 'success' }`.

---

### AC-02: Failure Path — AtomDirective Parse Error

**Given** a bead payload that does NOT conform to `AtomDirective` schema (e.g. missing `skillRef` field),  
**When** the workflow calls `AtomDirective.safeParse(bead.payload)`,  
**Then** `safeParse` returns `{ success: false }`,  
**And** the workflow calls `failHook(doStub, bead.id, agentId, JSON.stringify({ error: 'invalid-directive', issues: ... }))`,  
**And** returns `{ status: 'error', reason: 'invalid-directive' }`,  
**And** the bead is left in `failed` state in CoordinatorDO.

---

### AC-03: Happy Path — No Ready Bead (Molecule Complete)

**Given** a workflow invocation where `getNextReady(doStub, moleculeId)` returns `null` (all beads done or no ready beads),  
**When** `run()` is called,  
**Then** the workflow returns `{ status: 'complete' }` without calling `executeWithRetry()`.

---

### AC-04: Failure Path — Skill Timeout

**Given** a valid `AtomDirective` with `timeoutMs: 5000` and `retryPolicy.maxAttempts: 1`,  
**And** the Flue session's `session.skill()` does not respond within 5000ms,  
**When** the `Promise.race([session.skill(...), sleep(5000)])` resolves via the sleep,  
**Then** `timedOut` is `true`, `outcome` is `'timeout'`,  
**And** `failHook()` is called with a `ConductingAgentTraceFragment` where `outcome === 'timeout'`,  
**And** the workflow returns `{ status: 'executed', outcome: 'timeout' }`.

---

### AC-05: Happy Path — file-exists SuccessCondition

**Given** a directive with `successCondition: { type: 'file-exists', path: '/workspace/output.ts' }`,  
**And** the agent session creates that file,  
**When** `evaluateSuccessCondition()` is called,  
**Then** `harness.shell('test -f /workspace/output.ts && echo exists')` is called,  
**And** the result `stdout.trim() === 'exists'` evaluates to `true`,  
**And** `outcome` is `'success'`.

---

## 4. MoSCoW Summary

| Requirement | Priority | Rationale |
|-------------|----------|-----------|
| FR-01: Flue workflow entry (no CF Worker) | MUST | Architectural constraint — `ctx.init()` only in Flue workflow |
| FR-02: Deterministic DO key (GD-002) | MUST | Idempotency across retries |
| FR-03: initRun before getNextReady | MUST | `writeAudit()` + `recordOutcome()` require run context |
| FR-04: Bead lifecycle (claim/parse/exec/release) | MUST | Core execution contract |
| FR-05: PROFILE_BY_ROLE (no deriveRole) | MUST | Eliminating silent misrouting |
| FR-06: Sandbox selection (container vs virtual) | MUST | Cost + capability gating |
| FR-07: Five Flue bridge points | MUST | Verified API only — no alternative |
| FR-08: Retry loop with backoff | MUST | Resilience requirement |
| FR-09: Async evaluateSuccessCondition + harness | MUST | file-exists requires harness |
| FR-10: stdout truncation + R2 overflow | MUST | Payload size constraint |
| FR-11: ConductingAgentTraceFragment | MUST | Output contract for CoordinatorDO |
| FR-12: extractWorkspaceDelta | SHOULD | Closes on_failure TODO; useful for diff-based retry |
| FR-13: skillRef + role schema fields | MUST | Schema prerequisite for entire spec |
| FR-14: Sandbox API key injection | MUST | Security requirement |
| FR-15: Delete harness-bridge + runtime stubs | MUST | Clean dependency graph post-migration |
| NFR-01: Timeout at skill level | MUST | Performance |
| NFR-02: Idempotent DO init | MUST | Availability |
| NFR-03: Fail-closed bead lifecycle | MUST | Availability |
| NFR-04: API keys at sandbox boundary | MUST | Security |
| NFR-05: Phase 5 build order | MUST | Prevents premature implementation |
| NFR-06: tsc --noEmit gate per step | MUST | Type safety |
