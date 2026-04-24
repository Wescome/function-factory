---
id: PRD-META-FUNCTION-SYNTHESIS
sourceCapabilityId: BC-META-FUNCTION-SYNTHESIS
sourceFunctionId: FP-META-FUNCTION-SYNTHESIS-EXECUTION
title: Function Synthesis from WorkGraphs
source_refs:
  - FP-META-FUNCTION-SYNTHESIS-EXECUTION
  - FP-META-FUNCTION-SYNTHESIS-CONTROL
  - FP-META-FUNCTION-SYNTHESIS-EVIDENCE
  - BC-META-FUNCTION-SYNTHESIS
  - PRS-META-FUNCTION-SYNTHESIS
  - SIG-META-WHITEPAPER-V4
explicitness: explicit
rationale: >
  The Factory compiles WorkGraphs (Stage 5 complete, multiple WorkGraphs on
  disk) but cannot produce code from them. Every Function remains at lifecycle
  state 'specified'. Gate 2 cannot evaluate without execution evidence. The
  closed loop (Stage 7 observability feeding Stage 1 signals) cannot activate
  because no Function has ever reached 'monitored'. This PRD specifies the
  function-synthesis capability that transforms compiled WorkGraphs into
  implemented Functions.

  Three co-specified Functions deliver the capability: EXECUTION owns the
  five-role topology orchestration and code production; CONTROL owns
  role-adherence enforcement and disagreement resolution; EVIDENCE owns
  trace capture, selection reporting, and acceptance evidence normalization.
  The PRD specifies all three as a single coordinated capability because
  their contracts are mutually dependent: EXECUTION produces the raw events
  that EVIDENCE captures and CONTROL audits.

  Binding modes are pluggable per DECISIONS 2026-04-24 (hybrid topology).
  The role contracts are the primary deliverable; binding-mode implementations
  are downstream Functions. The Architect fills the Critic role for this
  chain per the bootstrap carve-out (DECISIONS 2026-04-24).

  Authored from the approved spec chain: PRS-META-FUNCTION-SYNTHESIS,
  BC-META-FUNCTION-SYNTHESIS, three FunctionProposals (EXECUTION, CONTROL,
  EVIDENCE), whitepaper sections 3 and 9, ratified Zod schemas
  (ArchitectureCandidate, Stage6TraceLog, RoleAdherenceReport, Gate2Input),
  and per-role Read/Write field lists from the prompt pack.
---

# Function Synthesis from WorkGraphs

## Problem

The Factory's Stage 5 compiler produces WorkGraphs from PRDs. Nothing downstream transforms those specifications into running code, tests, configuration, and documentation. The pipeline is complete through specification but broken at production.

Every Function remains at lifecycle state 'specified' indefinitely. Gate 2 (acceptance review) cannot evaluate because it requires execution evidence that does not exist. Gate 3 (assurance coverage) is unreachable because no Function has reached 'monitored'. The closed loop -- Stage 7 observability feeding runtime signals back into Stage 1 -- cannot activate because the loop has never completed a single traversal. The Factory is a specification engine, not yet a production system.

The pressure is maximal. PRS-META-FUNCTION-SYNTHESIS rates strength, urgency, and confidence all at 1.0. Every downstream Factory concern -- acceptance, assurance, trust composition, trajectory-driven closure -- is blocked on the absence of a function-synthesis capability. Whitepaper section 11 non-negotiable number 6 requires three fail-closed Coverage Gates; Gate 2 cannot run without Stage 6 execution evidence. This is the forcing function.

The prior attempt to specify Stage 6 (PRD-META-HARNESS-EXECUTE, retracted 2026-04-19) miscast the capability as generic node dispatch. The retraction established that Gate 1 structural coverage does not imply conceptual correctness. This PRD is authored under the bootstrap carve-out: the Architect fills the Critic role, performing semantic-alignment review against whitepaper section 3 before compilation.

## Goal

Deliver the function-synthesis capability: a five-role topology with pluggable binding modes that reads a compiled WorkGraph plus an ArchitectureCandidate and produces a complete Function implementation -- source code, tests, configuration, and documentation.

The capability is delivered through three co-specified Functions. The execution Function (FP-META-FUNCTION-SYNTHESIS-EXECUTION) orchestrates the five-role topology (Planner, Coder, Critic, Tester, Verifier), manages the decision algebra state, enforces repair-loop bounds, handles calibrated escalation at the Verifier, and emits produced code artifacts to disk. The control Function (FP-META-FUNCTION-SYNTHESIS-CONTROL) enforces role-adherence contracts, resolves disagreements between the Verifier verdict and acceptance review, and governs binding-mode selection. The evidence Function (FP-META-FUNCTION-SYNTHESIS-EVIDENCE) captures execution traces, candidate selection rationale, and the normalized acceptance evidence bundle that Gate 2 consumes.

The role contracts are the primary deliverable. Each role is a typed state-transform interface with strict read access, write access, do-not rules, output contract, and a JSON-only footer. Roles behave like small pure functions over shared state. They do not share memory, hidden assumptions, or cross-cutting ambient context.

Binding modes are the secondary deliverable. The binding-mode interface allows the same role contracts to execute via external harness delegation (Claude Code, Cursor, or equivalent) or via in-Factory role execution where each role is a Factory-managed agent. Additional binding modes are permitted but not required at v1. Specific binding-mode implementations are downstream Functions, not part of this PRD.

## Constraints

### Role contract constraints

Each of the five roles has a typed contract specifying exactly what it reads, what it writes, what it must not do, and what its output artifact is. The contracts are derived from whitepaper section 3 and the prompt pack field lists.

Planner reads specEnvelope, workGraph, targetNodeIds, activeCandidate, repoContract, and validationOutcomes. Planner writes plan. Planner does not read or write code, does not execute tests, does not access tools beyond its read set. Planner's output is an execution plan that names which WorkGraph nodes to implement, in what order, with what constraints.

Coder reads plan, workGraph, activeCandidate, repoContract, editScopes, and repoContext. Coder writes patchProposals. Coder does not evaluate its own output, does not run tests, does not modify plan. Coder's output is bounded patch proposals against repository contracts.

Critic reads plan, patchProposals, workGraph, specEnvelope, and repoContract. Critic writes critique. Critic does not modify code, does not run tests, does not override the plan. Critic's output identifies defects, scope violations, missing validations, and invariant risks in the patch proposals.

Tester reads plan, patchProposals, critique, workGraph, scenarioManifest, and toolResults. Tester writes validationPlan and validationOutcomes. Tester does not modify code, does not modify the plan, does not override the critique. Tester selects and interprets validations, executing them via tool calls.

Verifier reads plan, patchProposals, critique, validationOutcomes, repairLoopCount, maxRepairLoops, scopeViolation, hardConstraintViolation, and activeCandidate. Verifier writes decision, requiresHumanApproval, and humanApprovalPayload. Verifier does not modify code, does not run tests, does not override the critique. Verifier chooses among pass, patch, resample, interrupt, or fail.

These contracts are typed interfaces conforming to the RoleName enum and validated by the RoleAdherenceReport schema. Semantic intent verification is acknowledged as unverifiable at runtime (RoleAdherenceReport.semantic_intent_unverified is always true); the four mechanically verifiable contract surfaces are read_access, write_access, do_not, and output_semantics.

### Binding-mode constraints

Binding modes are pluggable adapters that map role contracts onto concrete execution backends. No binding-mode-specific logic exists in the contract layer. The contract layer defines WHAT each role must do; the binding mode determines WHO does it.

At minimum two binding modes are architecturally supported: external delegation (where a harness like Claude Code or Cursor implements the full topology internally, receiving the WorkGraph and role contracts as input and returning produced code plus evidence) and in-Factory execution (where the Factory instantiates each role as a managed agent with its own context window, coordinating them through the shared state contract). Mixed delegation (some roles in-Factory, some external) is permitted but not required at v1.

The binding-mode interface accepts an ArchitectureCandidate (which carries topology, model_binding, inference_config, tool_policy, and convergence_policy) and a WorkGraph, and returns produced artifacts plus an execution trace. The ArchitectureCandidate determines which binding mode is selected through its topology and model_binding fields.

### Repair-loop constraints

Repair loops are bounded by the ArchitectureCandidate's inference_config.max_repair_loops field. A repair loop is triggered when the Verifier issues a patch decision. Each patch iteration increments repairLoopCount. When repairLoopCount reaches maxRepairLoops, the Verifier must choose among resample, interrupt, or fail -- patch is no longer available.

The Verifier's patch_iteration_cap (from inference_config) governs maximum patch attempts within a single repair loop. The convergence_policy.max_resample_branches governs maximum resample branches. Both bounds are hard limits enforced by the execution Function.

### Escalation constraints

The Verifier's terminal decision is a calibrated score, not a binary flag. The TerminalVerdict enum is pass, patch-exhausted, resample-exhausted, interrupt, or fail. Each verdict carries a rationale string.

Scope violations and hard-constraint violations trigger the human-approval escape valve. When requiresHumanApproval is true, the Verifier emits a HumanApprovalPayload specifying the reason, whether it is a scope or hard-constraint violation, and the requested action (approve, reject, or amend). No autonomous retry occurs on governance-class disagreements.

Disagreement between the Verifier's pass verdict and Gate 2's acceptance rejection follows three resolution classes per DECISIONS 2026-04-24: repairable_local (retry with targeted repair), architectural (no blind replay -- requires re-evaluation of the ArchitectureCandidate), and governance (routes to human approval with no autonomous retry).

### Evidence constraints

Every synthesis execution produces a Stage6TraceLog regardless of outcome (pass or fail). The trace includes per-role tool calls (ToolCallRecord), role iteration records (RoleIterationRecord), resample branches (ResampleNode), validation outcomes (ValidationOutcome), and a terminal decision (TerminalDecision).

AcceptanceEvidence is a normalized projection conforming to the Gate2Input schema. Gate 2 never reads raw traces directly; it consumes the Gate2Input bundle, which includes artifact paths, validation outcomes, compile and test summaries, scope and constraint violation flags, repair loop count, resample summary, and provenance (harness_command, prompt_pack_version, tool_policy_hash, model_binding_hash, timestamps).

Candidate lineage is updated on every selection. The CandidateSelectionReport records the paper trail for weighted selection audit and is immutable once written. Downstream outcomes live in lineage, not in the report.

### Lineage constraints

Produced code carries lineage back to the WorkGraph node that specified it. Every generated artifact path recorded in Stage6TraceLog.generated_artifact_paths traces to a specific WorkGraph node via the Planner's execution plan. The lineage chain is: Signal -> Pressure -> Capability -> FunctionProposal -> PRD -> WorkGraph -> WorkGraphNode -> produced code file.

### Memory constraints

Every memory write is a typed, auditable tool call per DECISIONS 2026-04-24 (GenericAgent adoption). The tool interface is memory_write(layer, key, content, source_refs), where source_refs traces the write back to the Function, gate, or execution event that produced it. No implicit or side-effect memory writes. Memory mutations are first-class artifacts subject to the same lineage-preservation discipline as every other Factory object.

### Crystallization constraints

Successful execution triggers a crystallization check. If the execution path contains a novel pattern not already captured by an existing invariant or template, a new reusable artifact is proposed (not auto-committed -- it enters the Critic review flow). Crystallized artifacts enter specs/ with full lineage back to the execution that produced them. The crystallization check triggers after Gate 3 passage, not as part of Gate 3 itself. Crystallization check logic belongs in the runtime layer, not in the coverage-gates layer.

### Emission constraints

The execution Function emits produced code files to disk. Emission is the final step after Verifier pass. No code is written to disk before the Verifier renders a pass verdict. Partial code from failed repair loops or abandoned resample branches is not emitted; it exists only in the trace log.

The evidence Function emits three artifacts per synthesis: ExecutionTrace (full Stage6TraceLog with resample tree), CandidateSelectionReport (weighted selection audit trail), and AcceptanceEvidence (normalized Gate2Input bundle). All three are emitted regardless of the terminal verdict. A synthesis that fails still produces evidence; the evidence shows why it failed.

## Acceptance criteria

### Execution Function (topology orchestration and code production)

1. Given a compiled WorkGraph and a selected ArchitectureCandidate, the execution Function instantiates the five-role topology under the candidate's specified binding mode and produces code files on disk. Test: provide a WorkGraph with at least three nodes; verify that code files appear at the expected paths and that each file traces to a WorkGraph node via the Planner's plan.

2. The execution Function enforces repair-loop bounds from inference_config.max_repair_loops. When repairLoopCount reaches the bound, the Verifier's patch option is removed from its available decisions. Test: set max_repair_loops to 2; trigger three consecutive Verifier patch decisions; verify the third iteration forces a non-patch terminal decision.

3. The execution Function enforces resample-branch bounds from convergence_policy.max_resample_branches. When the bound is reached, the Verifier's resample option is removed. Test: set max_resample_branches to 1; trigger two resample decisions; verify the second is rejected and a terminal verdict is forced.

4. The execution Function does not write code to disk before the Verifier renders a pass verdict. Partial code from failed repair loops exists only in the trace log. Test: simulate a Verifier fail verdict after Coder output; verify no code files exist on disk; verify the Coder's patch proposals are recorded in the Stage6TraceLog.

5. Given identical WorkGraph and ArchitectureCandidate inputs, the execution Function produces deterministic output modulo timestamps and non-deterministic model inference. Test: with a deterministic mock binding mode, run the same inputs twice and verify identical output artifacts.

### Control Function (role-adherence and disagreement resolution)

6. Every synthesis execution produces a RoleAdherenceReport conforming to the RoleAdherenceReport Zod schema, with one RoleAdherenceEntry per active role. Each entry checks four contract surfaces: read_access, write_access, do_not, and output_semantics. Test: run a synthesis; parse the emitted RoleAdherenceReport with RoleAdherenceReport.safeParse; verify it succeeds and contains entries for all five roles.

7. The RoleAdherenceReport sets semantic_intent_unverified to true on every report. The four mechanically verifiable surfaces produce pass/fail/unknown verdicts with specific violation strings when a role accesses a field outside its contract. Test: configure a Coder that reads critique (a do-not violation); verify the RoleAdherenceReport records the violation on the Coder's do_not surface.

8. Disagreement resolution between Verifier pass and acceptance rejection classifies the disagreement as repairable_local, architectural, or governance. Repairable_local triggers targeted repair. Architectural prohibits blind replay and requires candidate re-evaluation. Governance routes to human approval. Test: for each disagreement class, provide matching conditions and verify the correct resolution procedure activates.

9. No binding mode bypasses role-adherence checking. Both external delegation and in-Factory execution produce RoleAdherenceReports. Test: run the same WorkGraph through two different binding modes; verify both produce conforming RoleAdherenceReports.

### Evidence Function (trace, selection, and acceptance evidence)

10. Every synthesis produces a Stage6TraceLog conforming to the Stage6TraceLog Zod schema, regardless of terminal verdict. The trace includes per-role tool calls, role iteration records, resample branches, validation outcomes, and the terminal decision. Test: run a synthesis that ends in fail; parse the emitted trace with Stage6TraceLog.safeParse; verify it succeeds and contains records for every role that executed.

11. Every synthesis produces an AcceptanceEvidence bundle conforming to the Gate2Input Zod schema. Gate 2 can evaluate the synthesis from the Gate2Input alone, without reading raw traces. Test: parse the emitted Gate2Input with Gate2Input.safeParse; verify it succeeds; verify all artifact paths resolve to files on disk; verify evidence.validation_outcomes is populated.

12. Every synthesis updates candidate lineage. The CandidateSelectionReport records the ArchitectureCandidate's id, topology, model_binding, objective_scores, and selection_reason. The report is immutable once written. Test: run two syntheses against different candidates; verify the lineage index contains two entries with distinct candidate IDs.

13. The three evidence artifacts (ExecutionTrace, CandidateSelectionReport, AcceptanceEvidence) are emitted regardless of terminal verdict. A failing synthesis produces the same evidence artifact count as a passing synthesis. Test: compare artifact counts between a pass and a fail synthesis; verify equality.

### Hybrid binding modes

14. The binding-mode interface accepts an ArchitectureCandidate and a WorkGraph and returns produced artifacts plus a Stage6TraceLog. At least two binding modes are supported: external delegation and in-Factory execution. Test: instantiate each binding mode; verify both accept the same ArchitectureCandidate and WorkGraph inputs and both return conforming outputs.

15. Binding modes are adapters with no binding-mode-specific logic in the contract layer. The role contracts (read/write/do-not/output) are identical regardless of which binding mode executes them. Test: extract the role contracts used by two different binding modes; verify structural identity.

### Naming-principle compliance

16. No function, type, constant, or file path in the implementation uses stage-number jargon ("stage-6", "stage6", "Stage6" as a name prefix). Names describe what happens: "synthesize", "roleContract", "bindingMode", "executionTrace". Test: grep the implementation directory for /[Ss]tage.?6/ in identifiers (excluding comments, documentation, and schema references to the ratified Stage6TraceLog type name).

17. The Function lifecycle transition table is an explicit typed artifact, not embedded in prose. Transitions relevant to function synthesis (specified -> in_progress -> implemented, or specified -> in_progress -> failed) are named in a typed enum or constant, not described only in comments. Test: verify the transition table is importable as a typed value.

### Crystallization and memory

18. On successful synthesis (Verifier pass verdict), a crystallization check runs. If the execution path contains a pattern not already captured by an existing invariant or template, a new reusable artifact is proposed via the Critic review flow. The proposed artifact carries lineage back to the synthesis that produced it. Test: run a synthesis with a novel pattern; verify a crystallization proposal is emitted with source_refs tracing to the synthesis run_id.

19. Every memory write during synthesis is a typed tool call through memory_write(layer, key, content, source_refs). No memory mutation occurs outside this interface. Test: instrument the memory_write interface; run a synthesis; verify all memory writes are captured with non-empty source_refs; verify no direct filesystem writes to .agent/memory/ occur outside the tool interface.

## Success metrics

A WorkGraph enters function synthesis and a complete Function exits with code on disk. Target: every WorkGraph that enters synthesis with a valid ArchitectureCandidate produces either code on disk (pass) or a complete evidence bundle explaining why not (fail). Zero silent failures where synthesis starts but produces neither code nor evidence.

Acceptance review receives normalized evidence from every synthesis. Target: 100% of syntheses produce a Gate2Input bundle that passes Gate2Input.safeParse. Gate 2 never needs to read raw traces.

Role-adherence compliance per role per synthesis. Target: 95% or higher compliance rate across all four mechanically verifiable contract surfaces (read_access, write_access, do_not, output_semantics). Compliance below 95% triggers a role-contract review.

Disagreement resolution follows the correct class-specific procedure. Target: zero governance-class disagreements resolved without human approval. Zero architectural disagreements resolved via blind replay.

Candidate lineage index grows by at least one entry per synthesis. Target: monotonically increasing lineage depth across syntheses. A synthesis that fails to update lineage is an evidence Function defect.

The execution trace is reproducible given the same WorkGraph, ArchitectureCandidate, and deterministic binding mode. Target: byte-identical traces (modulo timestamps) on replay with deterministic mocks. Non-reproducibility is an execution Function defect triggering root-cause review.

Crystallization proposals compound across syntheses. Target: at least one crystallization proposal per ten successful syntheses over the Factory's operational lifetime. A zero crystallization rate across twenty or more successful syntheses signals either that the check is not running or that the novel-pattern detector is miscalibrated.

## Out of scope

Gate 2 evaluator implementation. Gate 2 consumes the Gate2Input bundle that this PRD's evidence Function produces, but the evaluator logic that renders an acceptance verdict is a separate PRD. This PRD specifies what Gate 2 receives, not what Gate 2 does with it.

Gate 3 continuous monitoring. Gate 3 (assurance coverage) operates on deployed, monitored Functions. This PRD produces Functions at lifecycle state 'implemented', not 'monitored'. Gate 3's continuous detector-freshness and evidence-source-liveness checks are a separate PRD.

Specific binding-mode implementations. This PRD specifies the binding-mode interface -- what a binding mode accepts (ArchitectureCandidate + WorkGraph) and what it returns (produced artifacts + Stage6TraceLog). The implementation of any specific binding mode (Claude Code delegation adapter, Cursor delegation adapter, in-Factory agent orchestrator) is a downstream Function specified in its own PRD.

Second harness binding. Per DECISIONS 2026-04-24, the second binding-mode implementation is deferred until the first binding mode is proven in production. This PRD requires the interface to support at least two modes; it does not require both to be implemented simultaneously.

Architecture search (candidate generation and selection). The ArchitectureCandidate consumed by function synthesis is selected upstream. The architecture-search capability that generates, evaluates, and selects candidates is a separate capability chain. This PRD treats the ArchitectureCandidate as a provided input.

Work Order governance, CCI, POE, PII, or any We-layer concept. Explicitly out of scope per whitepaper section 8. Function synthesis is an I-layer activity. A synthesis implementation that referenced commissioning purpose or organizational governance would be an I/We collapse.

Cross-WorkGraph linking. A synthesis that references nodes from multiple WorkGraphs requires a cross-graph resolution mechanism not specified here. This PRD's synthesis operates on a single self-contained WorkGraph per invocation.
