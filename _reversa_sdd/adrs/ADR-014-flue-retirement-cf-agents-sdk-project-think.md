# ADR-014: Retire @flue/runtime — Migrate Atom Execution to CF Agents SDK + Project Think (Option B)

**Date**: 2026-06-12
**Status**: Accepted
**Confidence**: 🟢 CONFIRMADO

## Context

`@flue/runtime` (v0.11.0) was the sole third-party, non-Cloudflare-native dependency in the Factory's execution substrate. It provided:
1. A durable session harness (`init()` → `harness.session()` loop)
2. Workspace primitives (file I/O over Workers Sandbox or D1)
3. `FlueAtomExecutionWorkflow` DO: the durable wrapper around atom execution

Flue was integrated via ADR-013 (merged ff-flue worker into `@factory/gears`). However, Flue signals remained problematic:
- No production SLA, experimental status, ~3.8K GitHub stars
- No Cloudflare support contract — sole third-party runtime dep in a 100% CF-native stack
- Cloudflare released Project Think (`@cloudflare/think`), a first-party DO-backed agent harness that replaces Flue's session and durability primitives

Two migration options were evaluated:
- **Option A**: `ConductingAgent extends Think<Env>` — Think owns LLM loop; Mastra only for T1/T4 tool factories
- **Option B**: `ConductingAgent` is a Mastra `Agent`; `ThinkExecutor extends Think<Env>` owns only durability substrate

## Decision

**Adopt Option B.**

`ConductingAgent` is a Mastra `Agent` (`@mastra/core`). It owns: LLM routing via `MODEL_BY_ROLE`, Mastra `inputProcessors`/`outputProcessors` (I4 enforcement), D1-backed observational memory (`@mastra/memory` + `@mastra/cloudflare-d1`), and the async tools resolver.

`ThinkExecutor extends Think<Env>` is the durable execution substrate. It owns: `runFiber()` crash recovery, workspace (`WorkspaceLike`), sandbox binding, and `onFiberRecovered()`. It does **not** own an LLM loop.

The boundary: `ThinkExecutor.executeAtom(directive)` constructs a `ConductingAgent` locally (inside `runFiber()`), calls `agent.generate()`, evaluates the success condition, then POSTs `/release` or `/fail` to `CoordinatorDO`. `CoordinatorDO` is looked up from `this.env.COORDINATOR_DO` — DO stubs cannot cross Worker RPC boundaries.

Queue dispatch: `ff-pipeline` queue consumer POSTs `atomSpec` (JSON-serialized `AtomDirective`) to `ThinkExecutor` at `/execute-atom` via HTTP (not RPC). DO naming: `think-${executableSpecificationId}-${atomId}`.

## Why Option B over Option A

Option A would route all model calls through Think's lifecycle hooks (`beforeToolCall`, `afterToolCall`), bypassing Mastra's processor chain. This would break:
- **I4 enforcement**: `ConsentBeadAuditProcessor` in Mastra `outputProcessors` fires after LLM response, before tool dispatch — the only correct enforcement moment. Think has no equivalent pre-dispatch hook.
- **T3 Observational Memory**: Mastra memory configuration (D1Store, model-by-input-tokens compressor) is in the Agent, not the substrate.
- **Model routing**: Mastra's `MODEL_BY_ROLE` would need to be reimplemented in Think's `getModel()`.

## Consequences

**Positive:**
- `@flue/runtime` fully removed from the codebase — zero imports remaining
- Execution substrate is 100% Cloudflare-native (`@cloudflare/think`, `@cloudflare/shell`, `@cloudflare/codemode`, `@cloudflare/sandbox`, CF Workers AI bindings)
- I4 enforcement is structurally guaranteed: `ConsentBeadAuditProcessor` in Mastra `outputProcessors` is the single authoritative enforcement point; fail-closed
- Mastra owns all LLM orchestration concerns; Think owns all durability concerns — clean separation
- kimi-k2.6 gateway bypass (`BR-FLUE-04`) preserved: `MODEL_BY_ROLE['coder']` uses direct Workers AI binding, not AI Gateway

**Negative / Constraints:**
- `session.withSkill(skillRef)` (Flue's path-based skill invocation) has no direct equivalent in `@cloudflare/think`. CF Agents SDK uses a registry model (`getSkills(): SkillSource[]`). Any Factory code relying on path-based skill invocation must migrate to `SkillSource` / R2 loader (tracked separately, not blocking this feature).
- `ThinkExecutor.executeAtom()` constructs a new `ConductingAgent` on every call — Agent is not cached across requests. This is intentional (directive-scoped construction) and matches how Mastra Agents are designed to be used.

## References

- ADR-013: ff-flue merge into @factory/gears
- SPEC-FF-FLUE-RETIRE-001 (Option B decision)
- `_reversa_forward/003-flue-retirement/investigation.md §2-8`
- `packages/gears/src/agents/think-executor.ts` — ThinkExecutor implementation
- `packages/gears/src/agents/conducting-agent.ts` — ConductingAgent implementation
- `packages/gears/src/processors/consent-bead-audit-processor.ts` — I4 enforcement
- `_reversa_sdd/domain.md#BR-FLUE-04` — kimi-k2.6 gateway bypass requirement
