# Gas City Harness Runtime Provider Architecture

Status: Draft architecture reference
Date: 2026-05-24
Lineage: specs/reference/ARCHITECTURE-ROADMAP-GAS-CITY-FACTORY.md; specs/reference/ADR-010-gas-city-supersedes-nlah.md; specs/reference/ADR-003a-pi-rpc-container-supersedes-003.md; workers/ff-pipeline/src/coordinator/pi-container.ts; workers/ff-pipeline/src/cf-workers.ts; workers/ff-pipeline/src/coordinator/sandbox-deps-factory.ts; /Users/wes/Downloads/Harness_Evaluator_Ontology_Guide_2026-05-19.html; /Users/wes/Downloads/Harness_Evaluator_Ontology_v0.1.0_2026-05-19.docx

## Decision

Gas City should generalize the current `PI_CONTAINER`, the Cloudflare Sandbox path, OpenShell-style policy runtimes, and other agent executors under a `Gas City Harness Runtime Provider` contract.

`GC_Container` is a useful implementation family, but it is too narrow to be the root architecture term. A container can host execution, but a Gas City runtime must also bind tools, context, state, lifecycle, evaluation, governance, and purpose.

Factory must not select, call, or depend on a provider directly. Factory dispatches coherent executable work to Gas City. Gas City selects and operates the runtime provider.

## Current Repo Grounding

The repo already has three partial runtime surfaces:

- `PI_CONTAINER` in `workers/ff-pipeline/wrangler.jsonc` and `workers/ff-pipeline/src/coordinator/pi-container.ts`.
- Pi RPC execution in `workers/ff-pipeline/pi-container/server.mjs`, reached through `PiContainerAdapter` in `workers/ff-pipeline/src/cf-workers.ts`.
- Generic Cloudflare Sandbox execution in `workers/ff-pipeline/src/coordinator/sandbox-deps-factory.ts` and `workers/ff-pipeline/src/coordinator/sandbox-role.ts`.

Those surfaces are Factory-shaped today. They use WorkerInput, harness stage names, R2 artifact writes, Factory adapter names, and compatibility fields that belong to the current ff-pipeline implementation.

ADR-010 supersedes the NLAH path and moves execution ownership to Gas City. Therefore these runtime surfaces should be extracted into a Gas City provider contract before they are folded into live city execution.

## Architecture

```text
Factory
  owns specification, coherence, amendment, persistence monitoring
  exposes dispatch and webhook boundaries
        |
        v
Gas City Supervisor / City
  owns sessions, beads, formulas, molecules, convergence, fidelity validation
        |
        v
Runtime Provider Registry
  selects a provider from formula, policy, city config, and capacity
        |
        v
Harness Runtime Provider
  pi-rpc | openshell | cloudflare-sandbox | codex | claude-code
  aider | opencode | browser | docker | k8s-job | future providers
        |
        v
Live Runtime
  container, process, sandbox, remote session, or orchestrated job
```

Factory and Gas City communicate over HTTP events. They do not share provider storage. Provider internals are below the Gas City boundary.

## Harness Tuple

The harness/evaluator ontology defines a harness as:

```text
H = (E, T, C, S, L, V, G, P)
```

Gas City must map every provider through that tuple:

| Slot | Meaning | Gas City provider obligation |
| --- | --- | --- |
| `E` | Execution loop | Run the formula step, provider loop, agent command, or job. |
| `T` | Tool registry | Declare and enforce allowed tools, filesystem, network, credentials, and model routes. |
| `C` | Context manager | Assemble prompts, inputs, compaction state, memory references, and replay context. |
| `S` | State store | Bind provider session state to Gas City Beads, Dolt history, R2 artifacts, DO state, or external session handles. |
| `L` | Lifecycle hooks | Start, health check, timeout, backpressure, restart, snapshot, restore, alarm, and destroy. |
| `V` | Evaluation interface | Emit evidence needed by fidelity validators and external evaluators. |
| `G` | Governance interface | Enforce policy, permissions, lineage, audit events, and failure semantics. |
| `P` | Purpose binding | Carry Factory intent, specification lineage, formula identity, bead purpose, and narrowed task scope. |

A provider that only exposes command execution is not a Gas City harness runtime provider. It is only an executor backend.

## Provider Contract

The provider contract should be explicit enough to support Pi, OpenShell, Cloudflare Sandbox, local Docker, k8s jobs, browser agents, Codex, Claude Code, Aider, OpenCode, and future executors without changing the Factory boundary.

Minimum provider capabilities:

- `createSession`: allocate a runtime session for a city, formula, molecule, or bead.
- `prepareWorkspace`: materialize inputs, files, dependency state, credentials, and policy.
- `executeStep`: run one formula step under a declared purpose and policy.
- `collectArtifacts`: return produced files, manifests, checksums, and declared outputs.
- `collectLogs`: return logs, stderr, stdout, trace spans, and model/tool usage.
- `collectPolicyEvents`: return allow, deny, escalation, and violation events.
- `snapshot`: capture runtime state when the provider supports it.
- `restore`: restore runtime state when replay or continuation is allowed.
- `status`: report health, readiness, provider version, image digest, and capacity.
- `restart`: restart a failed or stale runtime.
- `destroy`: release runtime resources and revoke temporary permissions.

Minimum execution request envelope:

```text
city_id
session_id
formula_id
formula_version
molecule_id
bead_id
step_name
role_name
purpose
inputs
declared_outputs
runtime_config
policy
context_refs
verifier_contract
idempotency_key
```

Minimum execution response envelope:

```text
status
provider_verdict
artifacts
artifact_manifest
logs
policy_events
model_usage
runtime_identity
session_archive_ref
verifier_report_ref
error
```

The provider verdict is not the molecule verdict. The provider can report that execution completed, failed, or violated policy. Gas City fidelity validation decides whether the molecule result is acceptable.

## Provider Families

`pi-rpc`
: Current `PI_CONTAINER` and Pi RPC server. Useful for real agent execution with model/tool capability probing, path guard, contract evaluation, and session archive capture.

`openshell`
: Policy-centered shell/runtime provider. Useful as a security and sandboxing layer, especially for command mediation, permissions, and runtime isolation.

`cloudflare-sandbox`
: Current generic Cloudflare Sandbox path. Useful for command/file execution, backup/restore, and short-lived dependency work in Cloudflare's container platform.

`codex`, `claude-code`, `aider`, `opencode`
: Agent-specific providers. Useful when the city needs a named coding agent with its native interaction model, but still requires Gas City policy and evidence envelopes.

`browser`
: Browser automation provider. Useful for UI verification, screenshots, web workflows, and live external interaction under a scoped policy.

`docker`
: Local or VPS Docker provider. Useful for development, deterministic replay, and simple non-Cloudflare deployment.

`k8s-job`
: Production-scale provider for the ADR-010 future target. Useful when Gas City moves from VPS/simple containers to orchestrated city execution.

## Ontology Constraints

The provider architecture must preserve these rules from the harness/evaluator ontology:

- Worker and evaluator are structurally separate. A provider cannot certify its own final correctness.
- Governance evaluation is not the same thing as quality evaluation. Both surfaces must be available.
- Purpose narrows across decomposition. Provider permissions must narrow with the bead or formula step.
- Provisioning is bounded by purpose. Runtime resources, tools, credentials, and network access must be justified by the step purpose.
- Compaction cannot destroy governance state. Governance state must live outside the model context window.
- Stop conditions must be externally verifiable. "The agent says it is done" is not sufficient.
- Rubrics are governed artifacts. Provider-local rubrics must have lineage and version.
- Evaluators are evaluated. Fidelity and governance validators must leave evidence for later review.

## Migration From Current Repo

1. Keep `PI_CONTAINER` working as the first compatibility provider.
2. Extract the provider request and response envelope from `PiContainerAdapter`, `PiContainer`, and `pi-container/server.mjs`.
3. Rename Factory-shaped terms at the Gas City boundary:
   - `WorkerInput` becomes formula-step execution input.
   - `HarnessState` becomes provider session state or city session state.
   - `stageName` becomes formula step name.
   - Factory adapter names become provider ids.
4. Preserve the useful Pi behavior:
   - singleton or bounded container lifecycle;
   - build/version mismatch restart;
   - backpressure;
   - stderr and session archive capture;
   - path guard;
   - contract evaluation;
   - tool capability probe.
5. Preserve the useful Cloudflare Sandbox behavior:
   - command execution;
   - file materialization;
   - git checkout;
   - backup/restore;
   - dependency preparation.
6. Add OpenShell as a provider or provider sublayer where its policy and shell mediation are stronger than the current Pi/Sandbox path.
7. Move canonical evidence ownership to Gas City. Cloudflare R2 may remain an implementation store, but Gas City owns the evidence envelope and Factory only receives Gas City events.
8. Retire NLAH/harness dispatch paths only after Formula execution, provider evidence, fidelity validation, and Factory webhook intake are proven end to end.

## Gaps To Close

- The live Gas City supervisor has health and city listing, but no city lifecycle or runtime provider has been proven yet.
- There is no provider registry schema for matching formula requirements to provider capability.
- There is no Gas City policy compiler from formula purpose and governance constraints into provider-specific controls.
- There is no provider evidence envelope that cleanly separates execution status from molecule verdict.
- There is no implemented fidelity-validator intake for provider evidence.
- There is no webhook proof from Gas City back into Factory for provider-backed molecule completion.
- There is no replay manifest tying runtime identity, provider version, inputs, policy, artifacts, and verifier reports together.

## Acceptance Criteria For The Next Implementation Spec

- A Formula step can declare required runtime capabilities without naming Factory internals.
- Gas City can select a provider from a registry using formula, policy, city config, and capacity.
- The selected provider runs in an isolated runtime or controlled remote session.
- Missing provider, missing policy, or missing verifier contract fails closed.
- Provider evidence includes execution logs, artifact manifest, policy events, runtime identity, and model/tool usage where available.
- Gas City fidelity validation consumes provider evidence and emits the molecule verdict separately from provider execution status.
- Factory sees only Gas City events and does not depend on Pi, OpenShell, Cloudflare Sandbox, or any provider-specific storage.

## Non-Goals

- Do not move Factory coherence verification into runtime providers.
- Do not make Pi the only Gas City runtime.
- Do not make OpenShell the root architecture. Use it where it closes policy and sandboxing gaps.
- Do not preserve NLAH as the production execution substrate.
- Do not let provider-local success become molecule success without external fidelity validation.

## Immediate Follow-On Artifacts

- `IS-GC-RUNTIME-PROVIDER-CONTRACT`: provider registry, request envelope, response envelope, lifecycle methods, and fail-closed behavior.
- `IS-GC-PROVIDER-POLICY-COMPILER`: translation from purpose, formula constraints, and governance policy into provider-specific controls.
- `IS-GC-PROVIDER-EVIDENCE-ENVELOPE`: artifacts, logs, runtime identity, policy events, verifier inputs, and replay manifest.
