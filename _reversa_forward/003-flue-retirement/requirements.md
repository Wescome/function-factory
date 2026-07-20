# Requirements — 003-flue-retirement

> Feature: Retire Flue (`@flue/runtime`) as the Factory's execution substrate; migrate atom execution to Cloudflare Agents SDK + Project Think (`@cloudflare/think`), Integration Option B.
> Source spec: `SPEC-FF-FLUE-RETIRE-001` (Decision recorded — implementation-ready, June 2026)
> Anchored on: `_reversa_sdd/architecture.md#KSP Layer`, `_reversa_sdd/ksp-gears/design.md`, `_reversa_sdd/ksp-flue-workflow/design.md`, `_reversa_sdd/domain.md#Flue Atom-Execution Rules`
> Supersedes: feature `002-gears-flue-wiring` (abandoned — it wired Flue in; this feature retires it)

---

## 1. JTBD

When the CoordinatorDO dispatches an atom for execution, I want the atom to run on Cloudflare's first-party agent substrate (Agents SDK + Project Think) instead of the experimental third-party Flue harness, so I can get crash-recoverable, production-supported execution while leaving the bead-graph governance layer untouched.

## 2. Context

Flue's unique contribution was the virtual sandbox (just-bash, zero cold-start) and the `init()` → `harness.session()` loop. Everything else credited to Flue (DO SQLite, AGENTS.md injection, role profiles, KV/D1 persistence, CoordinatorDO lifecycle) was Factory code calling Flue's session primitives 🟢 (spec §1; confirmed by `_reversa_sdd/ksp-flue-workflow/design.md#2.3` — the five bridge points are the only Flue-API touchpoints).

The decision is recorded: **Option B** — `ConductingAgent` is a Mastra `Agent`; Think is composed at the tool boundary, never extended by the agent. A companion `ThinkExecutor` DO (extends `Think<Env>`, no LLM loop) owns `runFiber()` crash recovery, the `@cloudflare/shell` workspace, and the sandbox binding, exposing them as DO RPC consumed by the Mastra agent's tools resolver (spec §5). 🟢 (D-1 resolved 2026-06-12)

Module ownership: `@factory/gears` is the sole Factory package that depends on `@mastra/core`, `@mastra/memory`, `@mastra/cloudflare-d1`. No other Factory package takes a Mastra dependency. 🟢 (D-3 resolved 2026-06-12)

Current Flue surface in the repo 🟢 (verified 2026-06-12):
- `packages/gears/src/flue/` — `agents.ts`, `index.ts`, `sandbox.ts`, `workflows/atom-execution.ts`, `workflows/atom-execution-do.ts`
- `@flue/runtime` imports in: `packages/gears/src/flue/agents.ts`, both workflow files, `workers/ff-pipeline/src/queue-handler.ts`, `trigger-synthesis-handler.ts`, `queue-bridge.test.ts` (3 dead `vi.mock` blocks, ~lines 72–94, already slated for deletion)

## 3. Functional Requirements

**FR-01 — Remove Flue entirely** 🟢 (spec §2, §6)
`pnpm remove @flue/runtime`; delete `packages/gears/src/flue/` (whole directory); remove every `init()` / `harness.session()` / `session.skill()` / `session.task()` / `session.prompt()` call site; drop `flue build --target cloudflare` from the build path. After removal, `grep -r "@flue/runtime"` over `packages/` and `workers/` returns zero hits outside historical docs.

**FR-02 — ConductingAgent as Mastra Agent** 🟢 (spec §5.2, D-3 resolved)
Create `packages/gears/src/agents/conducting-agent.ts` exporting `buildConductingAgent(directive, coordinatorDO, thinkExecutorDO, env): Agent`. `buildConductingAgent()` is called inside `ThinkExecutor.executeAtom()` — constructed locally within the ThinkExecutor DO isolate on every call, never serialized or passed across a DO boundary. `ThinkExecutor` holds all required bindings (`env.DB` for D1Store, `env.SANDBOX`, `env.LOADER`, `coordinatorDO` stub). Model from `MODEL_BY_ROLE[directive.role]`; instructions from `buildSystemPrompt(directive)`; tools resolved at runtime via `requestContext` from ThinkExecutor tool factories (`createWorkspaceTools` Tier 0, `createExecuteTool` Tier 1, `createSandboxTools` Tier 4); Mastra Memory (T3, D1Store) and the T2 input/output processor chains as specified.

**FR-03 — ThinkExecutor companion DO** 🟢 (spec §5.3)
Create `packages/gears/src/agents/think-executor.ts`: `class ThinkExecutor extends Think<Env>` with **no LLM loop**. Owns `runFiber('atom-execution', …)` with `ctx.stash({atomId, runId})` checkpointing, the durable workspace, and the sandbox binding. `executeAtom()` constructs the ConductingAgent locally (see FR-02), wraps `mastraAgent.generate()` in the durable fiber, evaluates `successCondition` against the workspace, and reports to CoordinatorDO via `/release` or `/fail`. `onFiberRecovered` does NOT re-run the atom — recovery defers to CoordinatorDO's stale-bead alarm 🟢 (spec §5.3; consistent with SM-6 in `_reversa_sdd/state-machines.md`).

**FR-04 — Bridge-point parity** 🟢 (`_reversa_sdd/ksp-flue-workflow/design.md#2.3`)
Each of the five Flue bridge points must have an explicit replacement: (1) `PROFILE_BY_ROLE[directive.role]` → `MODEL_BY_ROLE[directive.role]` — no `deriveRole()`, `directive.role` used directly; (2) sandbox-vs-virtual agent creation → execution-ladder tier selection (workspace/codemode/sandbox tools); (3) `init(agent)` → `runFiber()` durable fiber; (4) AGENTS.md injection via `harness.fs.writeFile` → Think `configureSession()` skill mechanism; (5) `harness.session()` + `session.skill(skillRef)` → `session.withSkill(skillRef)` reading the same `.agents/skills/<name>/SKILL.md` paths. **No skill content changes** (spec §7).

**FR-05 — CoordinatorDO untouched** 🟢 (spec §2, §8)
`seedBeads()`, `writeConsentBead()`, `writeAudit()`, `claimHook()`, `releaseHook()`, `failHook()`, `initRun()`, stale-bead alarm: zero changes. BR-FLUE-02 (seed-before-`getNextReady()`) still binds the new caller 🟢 (`_reversa_sdd/domain.md#BR-FLUE-02`).

**FR-06 — ff-pipeline call-site migration** 🟢 (repo scan; `_reversa_sdd/domain.md#BR-FLUE-06`)
Update `queue-handler.ts` and `trigger-synthesis-handler.ts` to dispatch via the new path. BR-FLUE-06 survives: handler modules keep type-only static imports; runtime CF dependencies (`@factory/gears`, `@cloudflare/*`) deferred via `await import()`. Delete the 3 dead `@flue/runtime` `vi.mock` blocks in `queue-bridge.test.ts`. Note: removing `@flue/runtime` eliminates the original `ERR_UNSUPPORTED_ESM_URL_SCHEME` root cause behind the 6 broken ff-pipeline test files — this migration should unblock them, but fixing those files stays out of scope (see §6).

**FR-07 — Package and wrangler changes** 🟢 (spec §6)
Add `agents`, `@cloudflare/think`, `@cloudflare/shell`, `@cloudflare/codemode`, `@cloudflare/worker-bundler`. wrangler.jsonc: DO bindings for `ConductingAgent` (+ existing `Sandbox`), migration tag `v2` with `new_sqlite_classes: ["ConductingAgent"]`, `worker_loaders` binding `LOADER` for Tier 1 codemode.

**FR-08 — AtomDirective stability** 🟢 (spec §2, §7)
`AtomDirective` schema unchanged except `skillRef` now resolves to Think skills. No consumer of the schema outside the execution path changes.

**FR-09 — Wire Mastra T2 processors into `buildConductingAgent()`** 🟢 (spec §5.2, D-1 resolved)
`inputProcessors` chain: `UnicodeNormalizer` → `PromptInjectionDetector` → `ModerationProcessor` → `PIIDetector`. `outputProcessors` chain: `ConsentBeadAuditProcessor` → `ToolCallFilter` → `BatchPartsProcessor` → `PIIDetector`. No decision remaining on processor placement — this step is implementation-only.

**FR-10 — Linear cleanup** 🟡 (spec §10 step 9)
Update WEO-7, WEO-8, WEO-9, WEO-12, WEO-15 — they reference Flue/Gas City execution paths that no longer exist after this feature.

## 4. Non-Functional Requirements

**NFR-01 — Durability (primary motivation)** 🟢
`runFiber()` stash/recovery must survive Worker eviction mid-LLM-stream: kill test required, `onFiberRecovered` fires, atom completes via re-dispatch (spec §9, §10 step 8). This is strictly stronger than Flue's session loop.

**NFR-02 — Fail-closed consent (I4)** 🟢 (D-2 resolved)
`ConsentBeadAuditProcessor` in Mastra `outputProcessors` is the authoritative I4 enforcement point. Mastra's `processOutputStep` runs after the LLM response is received but before the tool call is dispatched — the tool has not executed yet. `ThinkExecutor` has no LLM call lifecycle (it owns no LLM loop), so no Think-layer hook exists at this boundary. Enforcement chain: `ConsentBeadAuditProcessor` (writes ConsentBead + throws on denied) → `ToolCallFilter` (secondary hard gate) → tool executor (never reached if either threw). Fail-closed is structural and single-layer in Mastra `outputProcessors`. The `ThinkExecutor` workspace/sandbox tools execute only what Mastra's processor chain has already cleared.

**NFR-03 — Model routing preserves the kimi-k2.6 gateway bypass** 🟢 (`_reversa_sdd/domain.md#BR-FLUE-04`)
The AI Gateway's SSE handling breaks kimi-k2.6 streams. Whatever `MODEL_BY_ROLE` resolves to for the coder role must keep a direct Workers AI binding (`gateway: false` equivalent) — this is a confirmed production failure mode, not a preference.

**NFR-04 — Non-fatal R2 output storage** 🟢 (`_reversa_sdd/domain.md#BR-FLUE-05`)
Full-output writes to `WORKSPACE_BUCKET` stay non-fatal in the new path.

**NFR-05 — Clean import graphs** 🟢 (`_reversa_sdd/domain.md#BR-FLUE-06`)
Node test environments must keep importing handler modules without CF-runtime resolution errors.

## 5. Acceptance Criteria

**AC-1 (happy path, end-to-end atom)**
Given a seeded run in CoordinatorDO and a valid `AtomDirective`, When `/execute` dispatches and `ThinkExecutor.executeAtom()` constructs the ConductingAgent locally, runs the fiber to completion with `successCondition` satisfied, Then CoordinatorDO receives `/release` with the bead result, a D1 audit row exists, and no `@flue/runtime` code executed (spec §10 step 7).

**AC-2 (durability)**
Given an atom mid-LLM-stream, When the Worker is evicted, Then `onFiberRecovered` fires, the atom is NOT re-run by ThinkExecutor, the stale-bead alarm re-dispatches, and the atom completes (spec §10 step 8).

**AC-3 (failure path)**
Given an atom whose `successCondition` evaluates false, When the fiber completes, Then CoordinatorDO receives `/fail` with `beadId` and the bead transitions per SM-6 (no silent success).

**AC-4 (clean cut)**
Given steps 1–2 of the implementation order are done, When `tsc --noEmit` runs, Then the only errors are missing-Flue imports (the signal), and after FR-02/FR-03/FR-06, zero errors repo-wide.

**AC-5 (skill parity)**
Given an `AtomDirective` with a `skillRef` that worked under Flue, When the same directive runs under Think, Then the same `SKILL.md` content is loaded with no path or content changes (spec §7).

**AC-6 (I4 enforcement — ConsentBead)**
Given an atom with a `permittedTools` allowlist, When the ConductingAgent attempts a tool call not in the allowlist, Then `ConsentBeadAuditProcessor` throws before the tool executor is reached, and the fiber reports failure to CoordinatorDO — the tool never executes.

## 6. Out of Scope

- Fixing the 6 pre-existing broken ff-pipeline test files (handoff todo #5) — unblocked by this feature, executed separately.
- tessera-shared schema / Source Graph / Loop Closure BP6 chain (handoff todos #1–4) — independent track.
- Any change to SPEC-KSP-* packages, Mastra T1/T4 layers, D1/KV/R2 storage, or ArangoDB (spec §8).
- Mastra-on-Reversa investigation.

## 7. Open Points

All three original open points resolved in clarification session 2026-06-12. No open points remain.

## 8. Esclarecimentos

### Sessão 2026-06-12

- **Q:** Is Option A/B (Mastra T2 processor placement) a remaining decision, or fully resolved?
  **R:** Option B is fully decided. Step 6 in spec §10 contains stale wording. Rewritten as FR-09: "Wire Mastra T2 processors into `buildConductingAgent()` inputProcessors/outputProcessors." No decision remaining.

- **Q:** Which layer is authoritative for fail-closed consent (I4) — Mastra `outputProcessors` or Think `beforeToolCall()`?
  **R:** Mastra `outputProcessors` is the sole authoritative enforcement point. `ThinkExecutor` has no LLM call lifecycle and therefore no `beforeToolCall()` hook. Enforcement chain: `ConsentBeadAuditProcessor` → `ToolCallFilter` → tool executor (single-layer, structural). Reflected in NFR-02 and new AC-6.

- **Q:** Where is `buildConductingAgent()` constructed — can it be passed across a DO boundary?
  **R:** Constructed inside `ThinkExecutor.executeAtom()` on every call. Never serialized. `ThinkExecutor` DO holds all required bindings. `@factory/gears` is the sole Mastra-dependent Factory package. Reflected in FR-02, FR-03, and §2 context.

## 9. Confidence Summary

🟢 dominant — all three open points resolved, spec is implementation-ready with verified CF API references (v0.12.4, May 2026), and the SDD patch of 2026-06-11 confirms the current Flue surface. 🟡 on FR-10 (Linear issue contents not re-verified). 🔴 none.
