---
id: PRD-META-HARNESS-EXECUTE
sourceCapabilityId: BC-META-HARNESS-EXECUTE
sourceFunctionId: FP-META-HARNESS-EXECUTE
title: Harness Execute (Stage 6 execution Function)
source_refs:
  - FP-META-HARNESS-EXECUTE
  - BC-META-HARNESS-EXECUTE
  - PRS-META-HARNESS-EXECUTE
  - SIG-META-WHITEPAPER-V4
explicitness: explicit
rationale: >
  Fourth meta-PRD authored under Factory discipline. First meta-PRD
  outside Stage 5 — specifies a Stage 6 Function. Derived authoritatively
  from whitepaper §6 for Stage 6's role as the WorkGraph consumer, §3.2
  for the execution Function type, §5 for the FunctionLifecycle state
  machine whose transitions Stage 6 surfaces (without owning), ConOps
  §3.4 for deterministic plan generation, ConOps §7.3 for adapter-
  boundary failure discipline. Authored after the bootstrap-stage-5-
  complete tag, which establishes that WorkGraphs exist on disk as the
  input this Function consumes.

  This PRD's compile will be the fourth non-self-referential evidence
  point for Gate 1's generality claim. The prior three compiles covered
  compile-time structural, runtime evidence-driven, and compile-time
  artifact-emission domains — all within Stage 5. This PRD is the first
  Stage 6 compile. Gate 1 passing here would strengthen the generality
  claim to cross-stage coverage.

  This PRD requires one schema addition: ExecutionLog with ArtifactId
  prefix `EL-`. The addition is a Class B schema change per ConOps §12.1
  and is flagged in the Schema additions required section below. The
  schema PR is sequenced to land before the harness_execute
  implementation PR, same paired-PR pattern as CONTRACT and the
  future DR-/POL- additions.
---

# Harness Execute (Stage 6 execution Function)

## Problem

Stage 5 compiles specifications into WorkGraphs. Stage 6 consumes those WorkGraphs and invokes their nodes in a runtime adapter so the specified behavior actually runs. The `bootstrap-stage-5-complete` tag marks the point at which Stage 5 produces WorkGraphs end-to-end; three WorkGraphs exist on disk under `specs/workgraphs/`. None of them has been executed. `@factory/harness-bridge` is an empty scaffold package with no adapter, no WorkGraph consumer, no runtime dispatch logic.

The immediate consequence is that Functions compiled through the Factory remain permanently in the `designed` FunctionLifecycle state. The state machine specifies transitions from `designed` to `in_progress` to `verified`, but the machinery that would trigger them — an actual execution run against a WorkGraph — does not exist. Every compiled WorkGraph is operationally inert. The Factory produces plans; nothing consumes them.

The wider consequence is that Stage 7 (trust computation), the assurance-graph package, and any Function-derived telemetry the whitepaper mentions are all unreachable. Stage 7 derives TrustSignals from observed execution; no execution has happened. The assurance-graph propagates incidents along WorkGraph edges; no incidents have occurred because no executions have produced any. Stage 6 is the forcing function for every downstream Factory concern to have any input to process.

Stage 6 is also the first place in the Factory where runtime boundary concerns surface architecturally. Passes 0–7 and Pass 8 all operate on in-memory specifications; they read files, write files, and compute. Stage 6 invokes runtimes that themselves invoke the outside world — making API calls, spawning processes, modifying file systems beyond the Factory's `specs/` tree. The adapter boundary is where the Factory's determinism guarantee changes shape: plan generation remains deterministic, but execution outcomes are inherently stateful. This PRD names that distinction explicitly so downstream stages can reason about which parts of Stage 6 are replayable and which aren't.

## Goal

Implement `harness_execute` as a pure-plan / adapter-dispatch Function. It takes a WorkGraph, a named HarnessAdapter identifier, and optional adapter configuration. It derives a deterministic execution plan (node dispatch order) from the WorkGraph. It invokes the adapter with that plan. It records per-node execution outcomes (status plus timing plus any adapter-emitted payload) as an ExecutionLog artifact. It returns the ExecutionLog path and the summary status.

The Function is fail-closed at the adapter boundary: if the named adapter cannot be loaded, the Function emits an ExecutionLog with status `adapter_unavailable` and does not invoke any node. It is narrow-scope: dispatches and records. It does not compute TrustSignals (Stage 7), transition Function lifecycle state (runtime package's state machine), or propagate incidents (assurance-graph). Its output is an input to those other Functions.

## Constraints

### Architectural constraints (inherited from the six non-negotiables)

Fail-closed discipline applies at the adapter boundary. An adapter that cannot be loaded — missing, misnamed, failed initialization — produces no node invocations and an ExecutionLog with `status: adapter_unavailable` naming the adapter identifier and the load failure reason. No nodes are dispatched on a fail-closed adapter load. A partial-execution mode that dispatched nodes before the adapter validated its configuration would violate this discipline and corrupt every downstream reasoning step that consumes the ExecutionLog.

Lineage preservation is absolute. Every ExecutionLog cites the source WorkGraph ID in `source_refs`, the adapter identifier used, and the ISO-8601 invocation timestamp. Every per-node execution record cites the WorkGraphNode ID being executed. Explicitness tags on the ExecutionLog are `explicit` for fields derived directly from the WorkGraph or from the adapter's own structured output, `inferred` for fields that required Stage 6's interpretation (e.g., inferring a composite failure status from heterogeneous per-node outcomes).

Determinism applies to execution plan generation, not execution outcome. Given identical WorkGraph and identical adapter identifier, `harness_execute` produces an identical execution plan — node dispatch order, invocation sequence, configuration passed per node. The outcomes of those invocations are not required to be deterministic across runs; adapter runtimes interact with the outside world and produce stateful effects. This distinguishes Stage 6's determinism guarantee from Stage 5's: Stage 5 is byte-identical across replays; Stage 6 is plan-identical across replays with outcome-non-identical by design. ConOps audit replay against the plan must succeed; audit replay against outcomes must account for runtime non-determinism.

Narrow-function discipline. `harness_execute` dispatches and records. It does not compute TrustSignals — that is Stage 7's concern. It does not transition FunctionLifecycle state — the state machine in `@factory/runtime` owns transitions; `harness_execute` may emit a transition hint as a separate artifact when the outcome is unambiguous, but the hint is advisory, not authoritative. It does not propagate incidents — `@factory/assurance-graph` owns that. It does not retry, does not roll back, does not compensate for adapter failures beyond recording them. Consumers react.

### Operational constraints

Adapter identifiers are canonical strings. The initial set is `dry-run`, `claude-code`, `cursor`. `dry-run` is the reference adapter: it accepts any schema-conformant WorkGraph, invokes no real runtime, produces an ExecutionLog with every node marked `status: simulated` and a rationale naming the simulated outcome. `claude-code` and `cursor` are placeholders for real adapters whose implementations are separate Functions derivable from the same Capability in subsequent PRDs. This PRD specifies the Function contract; specific adapter implementations are downstream.

Schema conformance is mandatory. The emitted ExecutionLog validates against the ExecutionLog Zod schema in `packages/schemas/src/execution.ts` (to be added per the paired schema PR referenced in the Schema additions required section). A schema-invalid ExecutionLog is an implementation defect, thrown as an error before file emission, triggering the harness_execute skill's self-rewrite hook.

ExecutionLog IDs are timestamped. Unlike WorkGraph IDs (which are latest-known-good per-PRD), ExecutionLogs accumulate — every invocation of `harness_execute` produces a distinct ExecutionLog, preserved in `specs/execution-logs/EL-<WorkGraph-ID>-<ISO-8601-timestamp>.yaml`. The timestamp suffix is load-bearing: replaying the same WorkGraph under the same adapter produces a new ExecutionLog (same plan, potentially different outcomes). Historical ExecutionLogs are not overwritten.

The emitted ExecutionLog's per-node records cover exactly the set of WorkGraphNodes in the source WorkGraph. A node not dispatched (because a prior node failed hard and the adapter aborted) is recorded with `status: skipped` plus rationale naming the upstream failure. A node that completed but emitted structured output has that output recorded in the node's `outcome` field, serialized as JSON-safe YAML.

### Scope constraints

`harness_execute` is scoped to one WorkGraph per invocation. Multi-WorkGraph coordination, cross-WorkGraph dispatch, and distributed execution are out of scope for this Function. A Function that executes multiple WorkGraphs is a separate Function derivable from the same Capability in a later PRD.

`harness_execute` does not interact with Work Orders, CCI, POE, PII, or any We-layer concept. Those are WeOps concerns per whitepaper §8 and §2.1. A `harness_execute` implementation that referenced any of them would be an I/We collapse and must be rejected at Critic Agent review.

`harness_execute` is scoped to execution of Factory-compiled WorkGraphs. A WorkGraph arriving from a non-Factory source (hand-written YAML, imported from an external tool) is not validated by this Function. Upstream validation is assumed; Gate 1 and Pass 8's defensive schema check are the authoritative validation points. Stage 6 trusts its input.

`harness_execute` does not own adapter implementation. The adapter pool is a registry keyed by adapter identifier; implementations live in subsequent PRs and are plugged into the registry via a mechanism the registry PRD specifies. This Function invokes whatever adapter the registry returns for the given identifier. A breaking adapter registry change is an upstream concern.

## Acceptance criteria

1. Given a schema-conformant WorkGraph, a valid adapter identifier for a loaded adapter, and optional adapter configuration, `harness_execute` derives a deterministic execution plan, invokes the adapter, records per-node outcomes, emits an ExecutionLog, and returns the ExecutionLog path plus the summary status.

2. Given an adapter identifier that does not correspond to a loaded adapter, `harness_execute` emits an ExecutionLog with `status: adapter_unavailable` naming the adapter identifier and the load failure reason in the rationale, invokes zero nodes, and returns.

3. Given a WorkGraph that fails `WorkGraph.safeParse` at the schema boundary, `harness_execute` throws before any adapter invocation. The error message names the schema validation failure. Upstream validation is assumed but a defensive check at this boundary catches corrupted inputs.

4. The emitted ExecutionLog validates against the `ExecutionLog` Zod schema. Schema-validation failure at emission time is an implementation defect, thrown as an error before file write, triggers the skill's self-rewrite hook.

5. The ExecutionLog `id` matches the pattern `^EL-<WorkGraph-ID>-<ISO-8601-timestamp>$` where the timestamp's colons and periods are hyphen-normalized (same pattern as Coverage Report IDs). For WorkGraph `WG-META-GATE-1-COMPILE-COVERAGE` invoked at `2026-04-19T18:00:00.000Z`, the ExecutionLog id is `EL-WG-META-GATE-1-COMPILE-COVERAGE-2026-04-19T18-00-00-000Z`.

6. The ExecutionLog `workGraphId` field matches the source WorkGraph's `id`. The ExecutionLog `adapterId` field matches the adapter identifier passed in. The ExecutionLog `timestamp` field matches the invocation timestamp.

7. Every per-node record in the ExecutionLog's `nodes` array cites a WorkGraphNode ID present in the source WorkGraph. Every WorkGraphNode in the source WorkGraph has exactly one corresponding per-node record in the ExecutionLog. No duplicates, no omissions.

8. Every per-node record has `status` in the enum `completed | failed | skipped | simulated | unknown`. `simulated` is used only when the adapter is `dry-run`. `unknown` is used only when the adapter returned without emitting a structured outcome for the node and the harness cannot infer one; `unknown` is treated as a failure from the summary's perspective.

9. The ExecutionLog's summary `status` is derived deterministically from the per-node statuses: `completed` iff every node is `completed` or `simulated`; `failed` iff any node is `failed` or `unknown`; `adapter_unavailable` iff that was the pre-invocation outcome. The summary is not hand-authored; it is mechanically derivable from the per-node records.

10. Given identical WorkGraph, identical adapter identifier, and identical adapter configuration, two invocations of `harness_execute` produce ExecutionLogs whose plan fields (`nodeDispatchOrder`, `adapterId`, `workGraphId`, per-node `nodeId` field ordering) are identical. Outcome fields (per-node `status`, `outcome` payload, timing) are not required to be identical; runtime non-determinism is expected.

11. The ExecutionLog is written to disk at `specs/execution-logs/EL-<WorkGraph-ID>-<ISO-8601-timestamp>.yaml` before `harness_execute` returns. The file exists with schema-valid content even in the `adapter_unavailable` case; absence of an ExecutionLog is never interpretable as "harness_execute did not run."

12. The ExecutionLog's `source_refs` contains the source WorkGraph's ID, the adapter identifier (as a string, not an ArtifactId since adapter identifiers are not Factory artifacts), and any configuration artifact IDs the adapter consumed. `source_refs` entries that are valid ArtifactIds satisfy the Lineage mixin constraint; adapter identifiers live in a parallel field `adapterId` to keep the Lineage discipline pure.

13. `harness_execute` does not modify its inputs. The WorkGraph argument, the adapter identifier, and the adapter configuration are read-only. An implementation that sorted an input array in place or mutated a field on the WorkGraph is a defect regardless of whether the mutation affects the emitted ExecutionLog's content.

14. `harness_execute` does not transition Function lifecycle state. It may emit a transition hint as a separate artifact in a future iteration; this PRD does not specify the hint artifact. The state machine in `@factory/runtime` remains the authoritative transition owner.

15. `harness_execute` does not compute TrustSignals. ExecutionLog outcomes are input to Stage 7's TrustSignal derivation, which is a separate Function specified in a separate PRD.

## Success metrics

Adapter load success rate. The fraction of `harness_execute` invocations whose adapter loads successfully. Target: above 99% quarterly. A rising unavailable rate is an operational issue (adapter registry drift, missing adapter implementation, configuration error) and is surfaced via the `harness_execute` skill's self-rewrite hook when it exceeds threshold.

ExecutionLog schema-validation rate. The fraction of emitted ExecutionLogs that validate against the Zod schema. Target: 100%. A single schema-validation failure is a P0 issue and triggers immediate Architect review per ConOps §10.3.

Per-node status distribution. Across emitted ExecutionLogs, the distribution of per-node statuses. `simulated` is expected to dominate while only the `dry-run` adapter is implemented. As real adapters land, the distribution shifts toward `completed` and `failed`; a persistently high `unknown` rate indicates an adapter implementation is returning under-specified outcomes and triggers a remediation PR against the adapter.

Plan-determinism verification. Quarterly, a canonical fixture of WorkGraph plus adapter is replayed through `harness_execute` and the resulting ExecutionLog's plan fields are asserted byte-identical to the committed fixture's plan. Outcome fields are not asserted because their non-determinism is by design; plan fields must remain stable. Plan drift is a P0 issue per ConOps §10.3.

Latency from WorkGraph emission to first ExecutionLog. Wall-clock time from a passing Pass 8 invocation (WorkGraph written to disk) to the first `harness_execute` invocation against it. Tracked as a Factory-operational metric, not a `harness_execute` correctness metric; a rising latency indicates either adapter-registry unavailability or harness-execute-orchestration drift. Threshold is architecturally soft.

## Out of scope

TrustSignal computation. `harness_execute` emits ExecutionLogs; Stage 7 derives TrustSignals from them. An implementation that computed or emitted TrustSignals alongside the ExecutionLog is scope violation and collapses Stage 6 with Stage 7.

FunctionLifecycle transitions. The state machine owns transitions. `harness_execute` may emit a transition-hint artifact in future iterations; this PRD does not specify the hint, and the current scope is "emit ExecutionLog only."

Incident correlation and assurance graph propagation. Incidents that arise from executions (per-node failures, adapter errors) are input to the assurance-graph package, which owns correlation and propagation. `harness_execute` does not link ExecutionLogs to incidents or traverse the assurance graph.

Multi-WorkGraph or distributed execution. Out of scope. A Function that dispatches nodes across multiple WorkGraphs or across multiple runtime environments is a separate Function derivable from the same Capability in a later PRD.

Adapter implementation. The `dry-run`, `claude-code`, and `cursor` adapter implementations are separate Functions. This PRD specifies the Function contract that all adapters honor; adapter-specific PRDs specify how each adapter satisfies the contract.

Retry, fallback, rollback. An adapter-invocation failure is recorded as `status: failed` in the per-node record. `harness_execute` does not retry the node, does not fall back to a different adapter, does not roll back prior nodes' effects. Those are separate Functions (retry Function, fallback Function, compensation Function) derivable from the same Capability.

Work Order governance, CCI, POE, PII, or any We-layer concept. Explicitly out of scope per whitepaper §8.

## Shared ExecutionFunction shape

`harness_execute` follows the ExecutionFunction shape documented in PRD-META-COMPILER-PASS-8's Shared ExecutionFunction shape section. One clarification specific to Stage 6: the shape's determinism property applies to plan generation, not execution outcome. Pass 8 satisfies the shape with byte-identical output modulo emission timestamp because its computation is pure-in-pure-out. `harness_execute` satisfies the shape with plan-identical output modulo emission timestamp; outcome fields are non-deterministic by runtime necessity. The shape itself does not require outcome determinism — only plan determinism — and is therefore unchanged by this Function's existence. Future execution Functions that invoke runtimes with their own state will follow the same relaxation.

## Schema additions required

This PRD requires one new schema in `packages/schemas/src/execution.ts`:

`ExecutionLog` extends `Lineage` with: `id` matching `^EL-`; `workGraphId: ArtifactId`; `adapterId: z.string().min(1)`; `timestamp: z.string().datetime()`; `status: z.enum(["completed", "failed", "adapter_unavailable", "partial"])` summarizing the overall invocation; `nodes: z.array(ExecutionNodeRecord).default([])` per-node records; optional `transitionHint: FunctionLifecycleTransitionHint.optional()` for the future transition-hint artifact.

`ExecutionNodeRecord` (nested schema): `nodeId: z.string().min(1)` matching a WorkGraphNode id; `status: z.enum(["completed", "failed", "skipped", "simulated", "unknown"])`; `outcome: z.record(z.string(), z.unknown()).optional()`; `startedAt: z.string().datetime().optional()`; `completedAt: z.string().datetime().optional()`; `rationale: z.string().min(1)` explaining the status verdict.

One prefix addition to the ArtifactId regex in `lineage.ts`: `EL` for ExecutionLogs. Paired-PR discipline: regex in `lineage.ts` and `META_PREFIX_REGEX` in `coverage-gates/checks.ts` update in lockstep, same pattern as the CONTRACT addition.

These are Class B architectural changes per ConOps §12.1 and require a DECISIONS.md entry before the implementation PR. The schema PR is sequenced to land before the `harness_execute` implementation PR, same paired-PR pattern as Pass 8's dependencies on the CONTRACT prefix and FactoryMode promotion.

## Integration with existing Factory infrastructure

Stage 6 is architecturally downstream of Stage 5. The compiler orchestrator does not invoke `harness_execute`; Stage 6 is a separate invocation triggered by a different driver (CLI, scheduler, or human). The orchestrator's boundary ends at Pass 8's WorkGraph emission. `harness_execute` reads from `specs/workgraphs/` (not from an in-process handoff) to preserve the stage boundary.

The adapter registry (out of scope for this PRD; future architectural slot) is the mechanism by which `harness_execute` resolves an adapter identifier to an adapter implementation. The registry is a separate Factory Function whose PRD will specify registration, unregistration, and per-adapter configuration shape.

The `@factory/runtime` package consumes ExecutionLogs (this Function's output) to derive TrustSignals and to drive FunctionLifecycle transitions. Its consumption is downstream and out of scope for this PRD; the ExecutionLog's schema is the contract.

## Downstream artifacts harness_execute will enable

The first ExecutionLog emitted by any `harness_execute` invocation against one of the three bootstrap-stage-5-complete WorkGraphs (`WG-META-GATE-1-COMPILE-COVERAGE`, `WG-META-DETECT-REGRESSION`, `WG-META-COMPILER-PASS-8`) is the first operational Factory telemetry artifact. It is the input to every Stage 7 TrustSignal computation, every assurance-graph incident correlation, and every future Function that reasons about Factory operational history.

A passing Gate 1 verdict on this PRD is the precondition for compiling `harness_execute` into a WorkGraph (via the now-landed Pass 8) and implementing it. The compiled WorkGraph will be `WG-META-HARNESS-EXECUTE`. When the implementation lands and executes against any of the three bootstrap WorkGraphs, the first emitted ExecutionLog establishes that Stage 6 is operational and Stage 7 has an input source.

After `harness_execute` lands, the Factory's pipeline is end-to-end through Stage 6. The architectural completeness claim extends one stage further: compile specifications to WorkGraphs (Stage 5) and execute WorkGraphs to ExecutionLogs (Stage 6). Stage 7's TrustSignal derivation is the next unblock, followed by the assurance-graph incident propagation.
