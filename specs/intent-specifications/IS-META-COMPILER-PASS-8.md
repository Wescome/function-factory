---
id: IS-META-COMPILER-PASS-8
sourceCapabilityId: BC-META-COMPILER-PASS-8
sourceFunctionId: FP-META-COMPILER-PASS-8
title: Compiler Pass 8 — Executable Specification Assembly
source_refs:
  - FP-META-COMPILER-PASS-8
  - BC-META-COMPILER-PASS-8
  - PRS-META-COMPILER-PASS-8
  - SIG-META-WHITEPAPER-V4
explicitness: explicit
rationale: >
  Third meta-Intent Specification authored under Factory discipline and the first
  specifying an execution Function (prior meta-Intent Specifications — Coherence Verification,
  detect_regression — specified control Functions). Derived
  authoritatively from whitepaper §4 for the eight-pass compiler
  pipeline; §3.2 for the execution Function type and its lifecycle
  obligations; §5 for the Executable Specification as a first-class Factory artifact
  that Stage 6 consumes; §6.2 for the Coherence Verification Verification Report precondition
  per §11's sixth non-negotiable; ConOps §3.4 for deterministic evaluation
  and audit replay; ConOps §7.2 for pass-failure remediation flow; the
  existing Executable Specification, Executable SpecificationNode, and Executable SpecificationEdge Zod schemas in
  packages/schemas/src/core.ts as the authoritative output shape.

  Authored now rather than earlier in the Bootstrap sequence because the
  MVP compiler's Passes 0–7 plus Coherence Verification had to be architecturally proven
  general before Pass 8's implementation was worth specifying. The
  compile of IS-META-DETECT-REGRESSION at 2026-04-19T15:18:09Z produced
  Coherence Verification: PASS on a non-self-referential Intent Specification, establishing that the
  pass-to-pass pipeline is not fitted to Coherence Verification's Intent Specification specifically. That
  evidence is the precondition for investing in Pass 8 — without it,
  Pass 8 would be built atop a potentially Gate-1-fitted pipeline and
  would inherit that fitting.

  This Intent Specification does not specify new schema additions. The Executable Specification,
  Executable SpecificationNode, Executable SpecificationNodeType, Executable SpecificationEdge schemas all exist
  unchanged in core.ts since initial import. Pass 8's work is in the
  derivation logic from validated intermediates to schema-conforming
  output, not in schema definition.
---

# Compiler Pass 8 — Executable Specification Assembly

## Problem

The Factory compiler's terminal pass is unimplemented. Per whitepaper §4, Stage 5 is an eight-pass pipeline- Pass 0 normalizes a raw Intent Specification into a IntentSpecificationDraft; Passes 1–5 derive the intermediate artifacts (atoms, contracts, invariants, dependencies, validations); Pass 6 performs cross-pass consistency checks; Pass 7 is Coherence Verification, which gates the transition to Pass 8; Pass 8 assembles the intermediates into a Executable Specification. The MVP compiler (commit fb5b3e8, 2026-04-19) implements Passes 0–7. Pass 8 is absent.

The practical consequence is that every compile to date has produced a Verification Report but never a Executable Specification. The three meta-Intent Specifications compiled so far — IS-META-COHERENCE-VERIFICATION, IS-META-DETECT-REGRESSION, and (by implication when this Intent Specification compiles) IS-META-COMPILER-PASS-8 itself — have all terminated at Pass 7 with a Verification Report, with their intermediates preserved on disk and not assembled into anything executable. No Factory-compiled artifact has been handed to Stage 6 for harness execution. No Function has moved from `designed` to `implemented` through Factory machinery, because the machinery that converts a specification into an executable form does not exist.

Beyond the immediate blockage, Pass 8's absence means that every downstream Factory concern that consumes Executable Specifications is unreachable- Stage 6 coding-agent topology, Stage 7 trust computation (`@factory/runtime`), the assurance graph's incident-propagation dependencies (`@factory/assurance-graph`). These downstream concerns have remained empty not because they are intrinsically hard but because there is no input for them to accept. Pass 8 is the unblock.

Pass 8 is also the first place in the compiler where the distinction between compile-time reasoning and execution-time mechanics surfaces architecturally. Passes 0–7 operate on specification intermediates and produce a verification verdict; Pass 8 operates on the same intermediates but produces a structure whose semantics is "this is the shape of a runnable thing." The assembly logic is the first compiler work where the Factory has to commit to a specific way of translating abstract derivation relationships (contract derives from atom, invariant derives from contract, validation covers invariant) into concrete execution topology (node kinds, edge directionality, triggering order). That commitment is load-bearing because once Pass 8 exists, every downstream stage will read its output expecting that topology.

## Goal

Implement Pass 8 (`assemble_executable-specification`) as a deterministic pure function that takes the validated intermediates from compiler Passes 1–5 plus the Coherence Verification Verification Report from Pass 7 plus the source IntentSpecificationDraft, derives a Executable Specification conforming to the Executable Specification Zod schema in `packages/schemas/src/core.ts`, writes the Executable Specification to `specs/executable-specifications/ES-<IS-ID>.yaml`, and returns it to the compiler orchestrator. The pass refuses to run if the Coherence Verification Verification Report's `overall` is not `pass`. The pass is deterministic modulo emission timestamp. Every node in the emitted Executable Specification carries `source_refs` citing the intermediate(s) it was derived from; every edge resolves to nodes present in the same Executable Specification.

## Constraints

### Architectural constraints (inherited from the six non-negotiables)

Fail-closed discipline is absolute. Pass 8 refuses to execute if the Coherence Verification Verification Report cited as input has `overall: fail`. A fail-gated call produces no Executable Specification on disk, no Executable Specification return value, and a thrown error naming the failing Verification Report's ID so the compiler orchestrator can surface the refusal to the caller. There is no "best effort" Pass 8 run. There is no "generate the Executable Specification anyway so the user can see what would have emitted" mode. A Coherence Verification failure is a specification defect remediated upstream; Pass 8 exists downstream of the remediation, not alongside it.

Lineage preservation is absolute. Every Executable SpecificationNode emitted by Pass 8 carries in its own lineage (via source_refs on the enclosing Executable Specification artifact or per-node tracking — the exact mechanism is a Pass 8 implementation decision within schema constraints) the artifact IDs of the compiler intermediates that justified its emission. A Executable SpecificationNode representing an execution of a contract cites that contract's ID. A Executable SpecificationNode representing an evidence emission for an invariant cites that invariant's ID. A Executable SpecificationEdge between two nodes cites the dependency or covers-relationship that justified the edge's existence. Explicitness tags on the Executable Specification are `explicit` for fields derived directly from the intermediates and `inferred` only where Pass 8's derivation logic required cross-intermediate reasoning (e.g., inferring an edge from a covers-relationship between nodes that did not have an explicit Dependency between them).

Determinism is absolute. Given identical validated intermediates, an identical Coherence Verification Verification Report, and an identical source IntentSpecificationDraft, Pass 8 produces a Executable Specification whose content is byte-identical modulo the emission timestamp. Node ordering is deterministic (e.g., sorted by id). Edge ordering is deterministic. Any derivation logic that reads map entries or set iterators must sort before emission. This is the same audit-replay property the Coherence Verification Intent Specification required of its Verification Report, extended to the Executable Specification. A non-deterministic Pass 8 implementation is an implementation defect that triggers the Pass 8 skill's self-rewrite hook.

Narrow-pass discipline. Pass 8 assembles. It does not optimize (future compiler pass). It does not link across Executable Specifications (future Stage 5 enrichment). It does not execute (Stage 6). It does not validate execution-time properties (Stage 7). It reads five intermediate arrays plus one Verification Report plus one IntentSpecificationDraft, it writes one Executable Specification, it returns. A Pass 8 implementation that read anything outside that input set — the filesystem beyond writing the output, the network, memory — is scope violation.

### Operational constraints

Schema conformance is mandatory. The emitted Executable Specification validates against the Executable Specification Zod schema. If Pass 8 produces a Executable Specification that fails `Executable Specification.safeParse`, the failure is an implementation defect, not a specification defect — thrown as an error before file emission. The defensive re-validation parallels the `CoherenceVerificationReport.safeParse` check at the end of `runCoherenceVerification` and exists for the same reason- TypeScript types guarantee the shape; Zod refinements (e.g., minimum-one-node constraint) aren't captured in TS types.

Executable Specification ID format is constrained. Per the Executable Specification Zod schema, the id starts with `ES-`. Pass 8 emits `ES-<IS-subject>` where `<IS-subject>` is the source Intent Specification's ID with the `IS-` prefix stripped (same derivation as contract IDs after the CONTRACT-prefix paired PR). For `IS-META-COMPILER-PASS-8` this yields `ES-META-COMPILER-PASS-8`. No timestamp suffix. Unlike Verification Reports (which accumulate in specs/verification-reports/ and are append-only historical artifacts), Executable Specifications are latest-known-good- rerunning Pass 8 against the same Intent Specification overwrites the Executable Specification on disk. The emitted Executable Specification therefore reflects the most recent successful compile of its source Intent Specification.

Node-type assignment follows a deterministic rule set. The Executable SpecificationNodeType enum is `interface | execution | control | evidence`. Pass 8's assignment rules are- a node derived from a Contract of kind `behavior` is type `execution`; a node derived from a Contract of kind `invariant` is type `control`; a node derived from an Invariant standalone (not via a contract) is type `control`; a node derived from a ValidationSpec is type `evidence`; a node representing a contract of kind `api` or `schema` is type `interface`. These rules are an implementation constraint, not a schema constraint; violating them produces a Executable Specification that validates against the Zod schema but is semantically miscategorized. The Pass 8 skill must document the rule set explicitly.

Edge derivation follows a deterministic rule set. A Executable SpecificationEdge is emitted for every Dependency in the input (from Pass 4's output). An edge is additionally emitted for every covers-relationship- a ValidationSpec's `coversInvariantIds` produces evidence-from-control edges; `coversContractIds` produces evidence-from-execution edges; `coversAtomIds` does not produce an edge because atoms are not nodes in the Executable Specification (atoms are specification-layer; Executable Specification is execution-layer). `derivedFromAtomIds` on contracts does not produce an edge for the same reason. An edge is additionally emitted for every contract's `derivedFromAtomIds` only implicitly, via the node's `source_refs`, not as a Executable SpecificationEdge.

### Scope constraints

Pass 8 operates on Factory-compiled specifications and emits Factory-consumable Executable Specifications. It does not observe Work Orders, commissioning purpose, the Constraint Chain Index, Purpose Over Execution enforcement, or the Purpose Integrity Index. These are We-layer concerns governed by WeOps per whitepaper §8 and §2.1, and explicitly out of scope for every Factory component including Pass 8. A Pass 8 implementation that referenced any of these would be an I/We collapse and must be rejected at Critic Agent review.

Pass 8 does not implement harness execution semantics. The Executable Specification it emits describes the topology of what executes; how the nodes get invoked, in what environment, with what runtime, is Stage 6's concern. Pass 8 does not pick a programming language, a container image, a scheduling mechanism, or any runtime detail. The Executable Specification is a declarative description; Stage 6 is the imperative consumer. An implementation that embedded runtime hints in nodes beyond what the Executable SpecificationNode schema prescribes is scope violation.

Pass 8 does not retroactively modify upstream intermediates. If Pass 8's assembly reveals a latent issue — a contract that doesn't cleanly map to a node type, a covers-relationship that produces a seemingly nonsensical edge — the pass does not mutate the intermediate to fix it. It emits the Executable Specification as derived, flags any surprising mapping via an UncertaintyEntry if the mechanism exists, and surfaces the issue as Pass 8's implementation output, not as a silent edit of Pass 1–5's outputs. Upstream passes are frozen at their point of Pass 6 consistency check success.

## Acceptance criteria

1. Given validated intermediates from Passes 1–5 and a Coherence Verification Verification Report with `overall: pass` and a source IntentSpecificationDraft, Pass 8 emits a Executable Specification to `specs/executable-specifications/ES-<IS-subject>.yaml` and returns the Executable Specification value. The emitted file path is returned to the caller as part of the orchestrator's result.

2. Given a Coherence Verification Verification Report with `overall: fail`, Pass 8 throws before any file is written. The error message names the Verification Report's ID and states "Pass 8 refuses to run on a failed Coherence Verification verdict."

3. Given an absent Coherence Verification Verification Report (Pass 7 was not run or its output was not provided), Pass 8 throws with an error message distinguishing this case from the Coherence Verification-failed case. The two failure modes are distinguishable because their remediations differ — one requires running Pass 7, the other requires fixing the Intent Specification.

4. The emitted Executable Specification validates against the `Executable Specification` Zod schema in `packages/schemas/src/core.ts`. A Executable Specification that fails schema validation is a Pass 8 implementation defect, is thrown as an error before file write, and triggers the assemble-executable-specification skill's self-rewrite hook.

5. The emitted Executable Specification's `id` field matches the pattern `^ES-<IS-subject>$` where IS-subject is the source IntentSpecificationDraft's ID with the `IS-` prefix stripped. For `IS-META-COMPILER-PASS-8` this is `ES-META-COMPILER-PASS-8`. No timestamp suffix in the Executable Specification ID.

6. The emitted Executable Specification's `functionId` field matches the source IntentSpecificationDraft's `sourceFunctionId` field. Every Executable Specification traces back to the FunctionProposal that motivated its compile.

7. Every Executable SpecificationNode in the emitted `nodes` array carries `source_refs` naming at least one Pass 1–5 intermediate artifact (a Contract ID, an Invariant ID, or a ValidationSpec ID). A node whose `source_refs` is empty is a Pass 8 implementation defect.

8. Every Executable SpecificationNode's `type` field is assigned by the deterministic rule set- behavior-kind Contract → execution; invariant-kind Contract → control; standalone Invariant → control; ValidationSpec → evidence; api-kind or schema-kind Contract → interface. A node whose type does not match the rule applied to its source is an implementation defect.

9. Every Executable SpecificationEdge's `from` and `to` resolve to nodes present in the same Executable Specification's `nodes` array. A dangling edge is a Pass 8 implementation defect and is caught by the Zod schema's Executable Specification refinements (or by a Pass 8 internal check before file emission if the schema does not refine this property).

10. Every Dependency in the Pass 4 output produces one Executable SpecificationEdge in the emitted Executable Specification. The edge's `from` and `to` correspond to the nodes derived from the Dependency's `from` and `to` artifact IDs respectively.

11. Every `coversInvariantIds` entry on a ValidationSpec produces one Executable SpecificationEdge from the validation-derived node to the invariant-derived node. Every `coversContractIds` entry produces one Executable SpecificationEdge from the validation-derived node to the contract-derived node. `coversAtomIds` entries do not produce edges because atoms are not Executable Specification nodes.

12. Given identical Pass 1–5 intermediates, an identical Coherence Verification Verification Report, and an identical source IntentSpecificationDraft, Pass 8 produces a Executable Specification whose serialized YAML content is byte-identical modulo the emission timestamp. This includes deterministic node ordering, deterministic edge ordering, deterministic serialization of every field, and deterministic handling of iteration order over maps and sets.

13. Given an existing Executable Specification file at the output path (from a prior compile of the same Intent Specification), Pass 8 overwrites it. No append-only behavior; no write-once conflict; no suffix-based disambiguation. The file on disk after Pass 8 returns reflects the current compile's Executable Specification exactly.

14. The emitted Executable Specification's `nodes` array is non-empty. A Intent Specification whose intermediates produced no nodes — no contracts, no invariants, no validations — would imply a Coherence Verification pass with no specification content to assemble, which should not be reachable in practice; if it somehow is, Pass 8 throws rather than emit an empty Executable Specification. The Zod schema's `z.array(Executable SpecificationNode).min(1)` refinement catches this automatically.

15. Pass 8 produces no mutations of its inputs. The Pass 1–5 intermediate arrays, the Coherence Verification Verification Report, and the IntentSpecificationDraft are read-only as seen from Pass 8. An implementation that sorted an input array in place, appended to an input array, or modified any input object field is a defect regardless of whether the mutation affects the emitted Executable Specification's content.

## Success metrics

Executable Specification schema-validation rate, per-compile. A Executable Specification that fails `Executable Specification.safeParse` at emission time is a Pass 8 implementation defect. Target- zero schema-validation failures across the Factory's operational lifetime. A single failure triggers the assemble-executable-specification skill's self-rewrite hook and a root-cause review per ConOps §10.1.

Determinism verification for Pass 8. Quarterly, a Pass 8 regression test replays a canonical set of intermediates through the current Pass 8 implementation and asserts byte-identical Executable Specification contents modulo emission timestamp. Any divergence is P0 per ConOps §10.3. This extends the Coherence Verification determinism regression test from "Verification Report determinism" to "Pass 8 Executable Specification determinism," and both run on the same quarterly schedule against the same canonical fixture.

Stage 6 acceptance rate. The fraction of Pass 8 Executable Specifications that the Stage 6 coding-agent topology accepts as a specification to implement. Target- 100% on the Functions that exist in the Factory's operational population. A Executable Specification that Stage 6 cannot accept is either a Pass 8 defect (emitted Executable Specification doesn't match Stage 6's expectations) or a Stage 6 defect (the coding topology expects something the schema didn't promise). Both are surfaced as Pass 8 / Stage 6 drift and resolved by a paired PR amending whichever contract needs amending.

Orphan-node rate. A node in an emitted Executable Specification that has no inbound or outbound edges. Not a failure in principle (a node with no dependencies or validations is legitimate), but a rising rate of orphan nodes is a signal that either the upstream derivation passes aren't producing dependencies and covers-relationships (a Pass 4 / Pass 5 gap) or Pass 8's edge-derivation rule set is too narrow. Tracked quarterly; rising trend triggers review of the upstream derivation passes.

Compile-to-Executable Specification latency. Wall-clock time from Coherence Verification Verification Report emission to Executable Specification file write. Target- below 500 milliseconds on the meta-Intent Specifications. Pass 8 is not expected to be a compile-time bottleneck; a rising latency is an implementation concern warranting profiling but not an architectural concern.

## Out of scope

Executable Specification execution. Pass 8 emits a Executable Specification; Stage 6 executes it. A Pass 8 implementation that embedded execution logic, attempted to run the Executable Specification, or produced runtime artifacts alongside the Executable Specification is scope violation. The Executable Specification is a declarative description; its execution is the next stage's concern.

Cross-Executable Specification linking. Some Factory Functions will eventually reference other Functions (a control Function observing an execution Function's output). In a mature Factory, Pass 8 might produce Executable Specifications with edges pointing into other Executable Specifications' nodes. This Intent Specification does not specify that linking. Pass 8 per this Intent Specification produces a self-contained Executable Specification; cross-graph linking is deferred to a future Stage 5 enrichment specified in its own Intent Specification.

Executable Specification optimization. A mature compiler might produce a Executable Specification, then apply a Pass 9 optimization pass that merges redundant nodes, eliminates unreachable edges, or reorders for parallel execution. Pass 8 per this Intent Specification emits the Executable Specification naively from intermediates — one node per contract, one node per standalone invariant, one node per validation, edges per the rule set. No optimization, no fusion, no reordering for execution efficiency. The emitted Executable Specification is canonical, not optimal.

Executable Specification versioning or migration. When a Intent Specification evolves and its compiled Executable Specification differs from a previously emitted Executable Specification, Pass 8 per this Intent Specification simply overwrites the on-disk Executable Specification. No version history. No migration path for Stage 6 adapters that were executing against the previous Executable Specification. The git history of `specs/executable-specifications/` is the versioning mechanism; application-layer versioning is a future Factory concern.

Uncertainty entry emission. In a mature compiler, Pass 8 might emit UncertaintyEntry artifacts when its derivation logic encounters a case its rule set does not cleanly handle (e.g., a Contract of an unrecognized kind, an unusual covers-relationship topology). Pass 8 per this Intent Specification throws on such cases rather than emitting UncertaintyEntry, because the UncertaintyEntry emission infrastructure is itself not yet implemented in the MVP compiler (it was deferred from Pass 0 as well). When UncertaintyEntry emission lands as its own Factory capability, Pass 8 will be updated to use it; until then, the failure mode is "throw and let the orchestrator report."

Work Order governance, CCI, POE, PII, or any We-layer concept. Explicitly out of scope per whitepaper §8. A Pass 8 implementation that referenced any of these would be an I/We collapse.

## Shared ExecutionFunction shape

Pass 8 is the first execution Function the Factory has authored. Prior meta-Functions (Coherence Verification, detect_regression) are control Functions. Recording the shared shape of execution Functions here avoids drift when future execution Functions are specified.

An ExecutionFunction is a deterministic pure function of the form `(validated_inputs) => artifact` where `validated_inputs` is a tuple of Zod-validated input artifacts and `artifact` is a Zod-validated output artifact conforming to a schema in `packages/schemas/src/`. Three properties are invariant across execution Functions.

First, determinism over validated inputs. The same inputs produce the same output modulo emission-timestamp fields and id fields that embed the timestamp. Determinism is the basis of audit replay and quarterly regression verification.

Second, schema conformance over outputs. Every emitted artifact validates against its schema. Defensive re-validation at emission time (via `Schema.safeParse` on the constructed output) catches implementation drift before the artifact reaches disk. Schema-validation failure is an implementation defect, not a specification defect, and thrown as an error.

Third, write-semantics defined by the artifact type. Some Factory artifacts are append-only (Verification Reports — every compile produces a timestamped file, history preserved). Some are latest-known-good (Executable Specifications per this Intent Specification — rerun overwrites). The artifact's Intent Specification specifies which. An ExecutionFunction whose write-semantics diverges from its artifact's Intent Specification is a contract violation at the Factory-artifact-governance layer, separate from schema conformance.

The shape applies to Pass 8, and will apply to future execution Functions (e.g., a Function that produces Trajectory artifacts from Stage 7 telemetry, a Function that produces Incident artifacts from assurance-graph propagation) without modification.

## Integration with existing compiler orchestration

The compiler orchestrator in `packages/compiler/src/compile.ts` currently runs Passes 0–7 and returns a `CompileResult` containing the Coherence Verification Verification Report, the intermediates, the report path, and the mode. Pass 8's integration extends this without breaking the existing API surface.

After this Intent Specification's implementation, the orchestrator runs Pass 8 iff the Pass 7 (Coherence Verification) verdict is `pass`. On pass, Pass 8 executes and its output is added to the `CompileResult` as `executable-specification` and `executable-specificationPath` fields. On fail, Pass 8 is skipped (not thrown against), and the `CompileResult` has these fields as `null` or absent (the shape is a Pass 8 implementation detail within the `CompileResult` type). The orchestrator's existing behavior — emitting the Verification Report on every invocation, returning on fail — is preserved. Pass 8 is strictly additive at the orchestration layer.

The existing compiler tests (`packages/compiler/src/compile.test.ts`) are updated to assert on the presence of a Executable Specification on passing compiles and its absence on failing compiles. No existing test assertion is removed; assertions are added.

## Downstream artifacts Pass 8 will enable

A passing Pass 8 execution for any Intent Specification is the precondition for every downstream Factory stage that operates on Executable Specifications- Stage 6 Function synthesis (a coding-agent topology reading the Executable Specification as specification and producing the Function's implementation code), Stage 7 trust computation (`@factory/runtime` observing the executions and producing TrustSignals against each Function's Executable Specification topology), the assurance graph package (`@factory/assurance-graph` propagating incidents along Executable Specification edges once incidents exist to propagate).

The first Executable Specification Pass 8 will emit is `ES-META-COMPILER-PASS-8` itself — the implementation of Pass 8 compiled from this Intent Specification through a compiler whose Pass 8 is what this Intent Specification specifies. That is the second-order bootstrap proof- the Factory's first executable artifact is the pass that compiled the pass that compiled it. Coherence Verification's first bootstrap proof was "the verification is internally complete as specified." Pass 8's bootstrap proof is "the assembly logic produces a buildable artifact from its own specification." The latter proof depends on the former plus one additional execution of the additional pass.

Whether Pass 8's first compile produces a Executable Specification that Stage 6 can actually consume is a separate proof that depends on the Stage 6 coding-agent topology being implemented. That work is out of scope for this Intent Specification. What is in scope is- the Executable Specification validates against its schema, emits to disk, is byte-reproducible, and carries sufficient lineage to be auditable independently of whether Stage 6 happens to read it in the first iteration.

After Pass 8 lands, the Factory's pipeline is end-to-end architecturally complete through Stage 5. The remaining Factory work (Fidelity Verification, Persistence Verification, Stage 6 coding topology, runtime, assurance-graph) becomes population of architectural slots that now have input sources; prior to Pass 8 those slots had no input because no Factory compile ever produced a Executable Specification to hand them.
