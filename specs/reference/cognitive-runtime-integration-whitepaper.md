# Grounding the Function Factory in a Layered Cognitive Runtime: Seven Integration Points Between Autonomous Function Production and Governed Agentic Cognition

**Author:** Wislet J. Celestin, Koales.ai / WeOps Research
**Date:** 20 April 2026
**Status:** Integration whitepaper; companion to *The Function Factory* (v4, 2026-04-18) and *A Layered Cognitive Runtime for Agentic Systems* (preprint, 2026)

---

## Abstract

The Function Factory is an upstream-to-downstream compiler for trustworthy executable Functions: it converts environmental pressures into governed, verifiable, monitorable units of behavior through a seven-stage pipeline with three fail-closed Coverage Gates (Celestin, 2026). A companion paper introduces a layered cognitive runtime for agentic systems built on three linked constructs: the Cognitive Edge Fabric (CEF), a distributed layer of cheap, specialized, trainable nodes; a decision algebra D = (I, C, P, E, A, X, O, J, T) that makes runtime cognition explicit and typed; and Decision-Conditioned Escalation (DCE), a governed mechanism that authorizes local execution, frontier escalation, or human review according to calibrated uncertainty and policy constraints. This whitepaper identifies seven structural integration points where the cognitive runtime's constructs serve as formal foundations for Factory components that were previously specified informally. The integration is not additive -- "also use CEF alongside the Factory" -- but structural: CEF is how Stage 6 thinks; the decision algebra is Stage 6's shared state; DCE is the Verifier's escalation mechanism. The seven leverage points span model delegation, execution state, escalation, internal role decomposition, learning discipline, and continuous assurance monitoring. Together they reveal that the Factory and the cognitive runtime are the same architectural thesis expressed at two levels of abstraction: the Factory as the compiler, the cognitive runtime as the execution substrate.

---

## 1. Introduction

Two papers from the same research program describe the same problem from complementary vantage points.

The Function Factory whitepaper (Celestin, 2026a) specifies a seven-stage pipeline that converts environmental pressures into trustworthy executable Functions. It defines the canonical unit (Function), the compiler passes (Stages 1-5), the dark-factory execution topology (Stage 6), the simulation and runtime closure (Stage 7), the trust model (five-dimensional, weighted 30/25/20/15/10), the assurance dependency graph (five typed dependency edges), and the three Coverage Gates (Compile, Simulation, Assurance) that fail closed at each stage boundary. The whitepaper names six non-negotiables for a first build: lineage preservation, narrow-pass discipline, explicit invariants with detector specs, assurance dependency typing, trajectory-driven closure with a birth gate, and three Coverage Gates fail-closed (Factory whitepaper, section 11). It establishes the five-role agent topology for Stage 6 -- Planner, Coder, Critic, Tester, Verifier -- each operating as a state-transform contract with strict read access, write access, do-not rules, and an output contract (Factory whitepaper, section 3, line 69).

The cognitive runtime paper (2026b) formalizes how individual agentic stages execute internally. It introduces the Cognitive Edge Fabric as a middle intelligence layer between deterministic functions and frontier cognition (CEF paper, section 3). It defines a decision algebra D = (I, C, P, E, A, X, O, J, T) that turns implicit reasoning state into an explicit typed object (CEF paper, section 2). It specifies Decision-Conditioned Escalation as a governed abstention mechanism conditioned on uncertainty, competence, policy, and value-of-escalation (CEF paper, section 4). It proposes a bounded learning loop with five planes -- execute, telemetry, evaluate, train, release -- operating under "execute online, learn offline" discipline (CEF paper, section 5.3). And it defines a heterogeneous graph evaluation framework that models the runtime as a typed relational system of cases, nodes, policies, actions, and outcomes (CEF paper, section 7).

The relationship between these two papers is not adjacency. It is structural embedding. The Factory whitepaper specifies *what* Stage 6 must accomplish: a fixed topology of cooperating agents producing bounded patch proposals, critiques, validations, and terminal decisions under strict contracts. The cognitive runtime paper formalizes *how* such a topology executes: each role is a graph of typed cognitive nodes operating over shared decision state, with escalation governed by calibrated uncertainty rather than ad-hoc confidence thresholds.

This integration whitepaper makes that embedding explicit. It identifies seven points where constructs from the cognitive runtime paper serve as formal foundations for Factory components that the Factory whitepaper specified informally or left as stubs. At each point, the cognitive runtime paper supplies mathematical structure, type discipline, or evaluation methodology that the Factory needs and does not yet have. The integration is not optional enrichment; it is the missing formal layer beneath the Factory's governance claims.

The Concept of Operations (Celestin, 2026c) provides the operational context: seven operator roles, four system modes (Bootstrap, Steady-State, Degraded, Emergency), authority classes, and the Stage 6 I/O contract through which harnesses consume WorkGraphs and emit execution traces (ConOps, sections 3, 4, 9.4). The ratified decisions document (Celestin, 2026d) provides the governance substrate: the ArchitectureCandidate schema with per-role model binding, two-stage candidate selection (admissibility filter then nine-axis weighted scoring), three routing-table amendment classes (additive, substitutive, emergency), three disagreement resolution classes (repairable_local, architectural, governance), and the Verifier's terminal decision set (pass, patch, resample, interrupt, fail with requiresHumanApproval and humanApprovalPayload fields). These documents are cited throughout as authoritative sources alongside the two primary papers.

---

## 2. Cognitive Edge Fabric as the Factory's Minimum-Sufficient Model Delegation

The Factory's Stage 6 operates a five-role topology: Planner, Coder, Critic, Tester, Verifier (Factory whitepaper, section 3, line 69). Each role binds to a model through the `ArchitectureCandidate.model_binding` field, which is typed as `Record<RoleName, ModelIdentifier>` -- a per-role mapping from role name to provider/model/version tuple (ratified decisions, "ArchitectureCandidate field discipline"; Zod schema lines 354-355). The two-stage candidate selection process first filters for admissibility (hard constraint compliance, scope compliance, role policy compliance, trace completeness, compile viability -- all must pass), then scores admissible candidates on nine weighted axes with correctness_proxy at 0.30 and token_cost_efficiency at 0.04 (ratified decisions, "candidate admissibility and scoring").

This architecture already commits to minimum-sufficient model selection: each role can bind to a different model, and the scoring function penalizes unnecessary cost. But the mechanism operates at role granularity. A Planner that handles both trivial plan generation (reordering three independent nodes) and complex dependency analysis (resolving circular constraints across twelve coupled nodes) binds to the same model for both tasks.

The Cognitive Edge Fabric refines this to sub-role granularity. The CEF's architectural principle is that most reasoning should be pushed into cheap, local, specialized nodes, with frontier models invoked only through governed escalation (CEF paper, section 3, "Layered architecture"). The layered stack places deterministic functions at the bottom, the Cognitive Edge Fabric in the middle, and frontier cognition at the top (CEF paper, section 3.1). Each CEF node is a typed partial transformation over decision state: N_k : D_partial -> D'_partial (CEF paper, section 2.2, equation 3).

Applied to the Factory, each of the five roles can be internally decomposed into a CEF graph. Consider the Planner role. Its declared read set is: specEnvelope, workGraph, targetNodeIds, activeCandidate, repoContract, validationOutcomes (prompt pack, "Planner" section). Its write set is: plan. Internally, this role performs at least four distinguishable cognitive operations:

1. **Pattern recognition**: reading the workGraph topology and targetNodeIds to identify the structural shape of the required work (a CEF Pattern node reading context C and evidence E).
2. **Constraint interpretation**: reading activeCandidate's convergence_policy and tool_policy to determine what the plan is allowed to propose (a CEF Constraint node reading policy P and pruning the action space).
3. **Dependency resolution**: analyzing the workGraph's edge set to determine execution ordering (a CEF Routing node estimating posterior over feasible action orderings).
4. **Plan assembly**: composing the resolved ordering into a structured plan artifact (a CEF Execution node bridging cognition to output).

Operations 1 and 4 are routine for most WorkGraphs. Operations 2 and 3 can be complex when the WorkGraph contains coupled nodes with conflicting constraints or when the activeCandidate's convergence_policy imposes unusual bounds. Under a flat model binding, all four operations use the same model. Under CEF decomposition, operations 1 and 4 can execute on a cheap local model (the CEF's middle layer), while operations 2 and 3 escalate to a more capable model only when Decision-Conditioned Escalation fires -- when uncertainty is high, the conformal action set is non-singleton, or the value of escalation exceeds its cost.

The same decomposition applies to every role. The Coder's patch generation has a routine component (applying well-known patterns to standard node types like `test` or `docs`) and a complex component (generating novel implementations for `domain_model` or `adapter` node types with unusual repoContract constraints). The Critic's review has a mechanical component (checking that patchProposals do not violate workGraph scope boundaries) and a judgment component (assessing whether the implementation satisfies the specEnvelope's semantic intent). The Tester's validation planning has a deterministic component (mapping invariants to scenario types) and an uncertain component (designing negative tests that could plausibly violate the invariant). The Verifier's terminal decision is the most consequential and is treated separately in section 4.

The integration point is precise: the Factory's `ArchitectureCandidate.model_binding` field specifies the *outer* model assignment per role; the CEF provides the *inner* decomposition that determines how much of each role's work actually requires that outer model. The routing-table YAML (ratified decisions, "routing-table amendment discipline") already classifies amendments into three governance classes -- additive (Class A), substitutive (Class B), emergency (Class C). CEF sub-node configuration within a role is a Class A amendment: it adds internal routing without changing any existing default. This means CEF integration does not require new governance machinery; it fits within the amendment discipline the Factory already ratified.

The economic consequence is direct. The Factory whitepaper positions the system as harness-agnostic: "the WorkGraph and node prompt pack are designed to be read by any compliant harness" (Factory whitepaper, section 9, line 206). The CEF makes harness-agnosticism deeper. Not only can the Factory delegate to any harness, but within each role invocation, the CEF layer can route sub-tasks to different model tiers without the harness needing to know. The harness sees a single role invocation; the CEF layer inside that invocation decides how much frontier reasoning the role actually needs.

---

## 3. Decision Algebra as Stage 6's Shared Execution State

The cognitive runtime paper defines a decision algebra as a nine-element tuple:

D = (I, C, P, E, A, X, O, J, T)

where I is intent, C is context, P is policy, E is evidence, A is authority, X is action, O is outcome, J is justification, and T is time (CEF paper, section 2.1, equation 2). Each node in the runtime is a typed partial transformation over this state: N_k : D_partial -> D'_partial. A node declares its read set and write set; it does not have access to the full state except where explicitly granted (CEF paper, section 2.2, equations 3-4).

The Factory's Stage 6 prompt pack already implements an informal version of this algebra. Each role has a declared read set and write set specified in the prompt pack (prompt pack, sections "Planner" through "Verifier"):

- **Planner** reads: specEnvelope, workGraph, targetNodeIds, activeCandidate, repoContract, validationOutcomes. Writes: plan.
- **Coder** reads: plan, workGraph, activeCandidate, repoContract, editScopes, repoContext. Writes: patchProposals.
- **Critic** reads: plan, patchProposals, workGraph, specEnvelope, repoContract. Writes: critique.
- **Tester** reads: plan, patchProposals, critique, workGraph, scenarioManifest, toolResults. Writes: validationPlan, validationOutcomes.
- **Verifier** reads: plan, patchProposals, critique, validationOutcomes, repairLoopCount, maxRepairLoops, scopeViolation, hardConstraintViolation, activeCandidate. Writes: decision, requiresHumanApproval, humanApprovalPayload.

These read/write declarations map directly onto the decision algebra's elements:

| Prompt pack field | Decision algebra element | Rationale |
|---|---|---|
| specEnvelope | I (intent) | The spec envelope carries the Function's compressed intent: what it is for, its contract, its invariants |
| workGraph, targetNodeIds, editScopes, repoContext | C (context) | The operational state the role must act within |
| activeCandidate (convergence_policy, tool_policy) | P (policy) | Constraints, obligations, and escalation rules governing this execution |
| validationOutcomes, toolResults, critique | E (evidence) | Observations and derived signals relevant to the current decision |
| activeCandidate (model_binding, inference_config) | A (authority) | What actions are authorized for the current role and candidate |
| plan, patchProposals, validationPlan | X (action) | Proposed or selected executable actions |
| decision (pass/patch/resample/interrupt/fail) | O (outcome) | The observed result after execution |
| requiresHumanApproval, humanApprovalPayload | J (justification) | The provenance record supporting the terminal decision |
| repairLoopCount, maxRepairLoops | T (time) | Sequence position and iteration bounds |

The mapping reveals that the prompt pack's read/write fields are the decision algebra's read/write domains expressed as JSON field names rather than mathematical symbols. Each role's turn produces a partial update to the shared decision state, exactly as the algebra specifies: N_k : D_partial -> D'_partial (CEF paper, section 2.2).

The formal contribution is threefold.

**First, governance becomes a type-safety property.** The Factory whitepaper requires that Stage 6 nodes "behave like small pure functions over shared state" and "do not share memory, hidden assumptions, or cross-cutting ambient context" (Factory whitepaper, section 3, line 69). The decision algebra makes this requirement formally enforceable. The write-domain discipline from the CEF paper states that nodes may not silently alter policy or authority unless explicitly designated as policy or authority nodes (CEF paper, section 2.4, equations 7-8). In Factory terms: the Coder may not alter the activeCandidate's convergence_policy; the Tester may not alter the tool_policy; only the Verifier may write the terminal decision. These constraints are currently enforced by prompt instructions and validated post-hoc by the RoleAdherenceReport (ratified decisions, Zod schema for RoleAdherenceReport, which checks read_access, write_access, do_not, and output_semantics per role). The decision algebra makes them a structural property of the state model itself: unauthorized writes are type violations, not behavioral observations.

**Second, the algebra makes the feasible action space explicit.** The CEF paper defines the feasible action set as X(z) = {x | x satisfies policy P and authority A}, where z = (I, C, E, P, A) (CEF paper, section 2.3, equations 5-6). In Factory terms: the Verifier's feasible action set is {pass, patch, resample, interrupt, fail} -- five terminal verdicts constrained by the activeCandidate's convergence_policy (stop_on_first_pass, require_verifier_pass, require_trace_completeness, max_candidate_evaluations, max_resample_branches). The Verifier does not distribute probability mass over actions that violate the convergence policy; the policy shapes the decision surface itself. This is the CEF paper's central governance claim: "policy and authority shape the decision surface itself" (CEF paper, section 2.3).

**Third, the algebra enables replay and audit.** The Factory's Stage6TraceLog (ratified decisions, Zod schema lines 424-452) records role iterations with read_fields and write_fields per iteration. With the decision algebra as the shared state model, each role iteration's read/write record becomes a partial decision state diff: D_before and D_after for each turn. This makes it possible to replay a Stage 6 execution by composing the sequence of partial updates D_final = N_m . N_{m-1} . ... . N_1(D_0) (CEF paper, section 2.2, equation 4), verifying that no role violated its write domain and that the final state is consistent with the terminal decision. The algebra converts Stage 6 replay from log inspection to algebraic verification.

---

## 4. Decision-Conditioned Escalation as the Verifier's Mechanism

The Factory's Verifier role makes the most consequential decision in Stage 6: it chooses among pass, patch, resample, interrupt, or fail, and determines whether requiresHumanApproval is true (prompt pack, "Verifier" section; ratified decisions, TerminalDecision Zod schema). The current specification treats this as a binary escalation: the Verifier either passes the candidate autonomously or sets requiresHumanApproval to true with a humanApprovalPayload explaining why. The mechanism is a flag, not a function.

Decision-Conditioned Escalation replaces this binary flag with a continuous, calibrated, multi-signal mechanism. The CEF paper defines a composite escalation score (CEF paper, section 4.7, equation 11):

S_esc(z) = w_H * H_hat(X|z) + w_M * (1 - M(z)) + w_E * U_epistemic(z) + w_C * 1[|Gamma_alpha(z)| > 1] + w_R * R(z) - w_V * C_local(z)

where H_hat is normalized Shannon entropy over the feasible action posterior, M is the top-two margin, U_epistemic is epistemic uncertainty, Gamma_alpha is the conformal action set, R is a risk/consequence weight, C_local is local competence, and the w coefficients are policy-tunable (CEF paper, section 4.7). Escalation fires when S_esc(z) > tau or when mandatory escalation rules are triggered by policy (CEF paper, section 4.7, equation 12).

Applied to the Factory's Verifier, the mapping is direct.

**Normalized entropy maps to decision confidence.** The Verifier's feasible action set is X(z) = {pass, patch, resample, interrupt, fail}. When the Verifier has high confidence in "pass," the posterior is concentrated: H_hat is low, M is high, and the escalation score is low. When the evidence is ambiguous -- validationOutcomes show mixed results, the critique identifies unresolved concerns, repairLoopCount is near maxRepairLoops -- the posterior is diffuse: H_hat is high, M is low, and the escalation score rises. The normalized entropy H_hat(X|z) = H(X|z) / log|X(z)| (CEF paper, section 4.2, equations 7-8) accounts for the fact that the Verifier has five actions, not two, which means raw entropy comparisons across different action-set sizes are misleading without normalization.

**Conformal action sets formalize the repair-loop bound.** The CEF paper's conformal prediction construct produces a set Gamma_alpha(z) of actions whose coverage is controlled at level 1 - alpha under exchangeability assumptions (CEF paper, section 4.5). In Factory terms: when the conformal action set is {pass}, the Verifier can act locally. When the conformal set is {pass, patch}, there is meaningful uncertainty about whether the candidate needs revision; the Verifier may still act if the convergence policy says cost is low. When the conformal set is {pass, patch, resample, interrupt}, the Verifier is fundamentally uncertain and should escalate. The size of the conformal set is an indicator of how many repair iterations the situation might require -- a non-singleton set that includes "resample" suggests the current candidate family may be wrong, which maps to the "architectural" disagreement class (ratified decisions, "disagreement resolution").

**The three disagreement classes map to DCE's escalation outcomes.** The ratified decisions define three classes of Verifier-Gate 2 disagreement (ratified decisions, "disagreement resolution"):
- **repairable_local**: narrow defect, current candidate reusable, bounded remediation session permitted.
- **architectural**: wrong candidate family, new selection required, blind replay forbidden.
- **governance**: scope or hard-constraint conflict, no autonomous retry, routes to human approval or Architect review.

The CEF paper defines four escalation outcomes: local_execute, frontier_escalate, human_escalate, safe_default (CEF paper, section 4.8, equation 13). The mapping is:
- repairable_local corresponds to local_execute with a patch action: the Verifier writes "patch" and the repair loop continues within the current candidate.
- architectural corresponds to frontier_escalate: the current local routing (candidate family) has failed, and a higher-capability selection process must run.
- governance corresponds to human_escalate: the situation exceeds autonomous authority.

DCE's continuous score replaces the binary requiresHumanApproval flag with a calibrated gradient. The Factory can define policy thresholds:
- S_esc < tau_local: Verifier acts autonomously (pass or patch).
- tau_local <= S_esc < tau_frontier: Verifier escalates to candidate resampling (new candidate family).
- tau_frontier <= S_esc < tau_human: Verifier escalates to Architect semantic review.
- S_esc >= tau_human: mandatory human approval.

These thresholds are policy-tunable and versioned, matching the CEF paper's governed policy model where P = P_domain union P_escalation (CEF paper, section 5, equation 14). In the Factory's terms, these thresholds live in the routing-table YAML as per-node-type escalation configuration, governed under the three amendment classes (ratified decisions, "routing-table amendment discipline").

**Value-of-escalation prevents unnecessary human interrupts.** The CEF paper defines V_frontier(z) = E[L_local|z] - E[L_frontier|z] and requires V_frontier(z) > Cost_frontier(z) for escalation to be economically justified (CEF paper, section 4.6, equations 9-10). In Factory terms: a Verifier that is mildly uncertain about a `docs` node type (low consequence, cheap to repair) should not escalate to human review. A Verifier that is mildly uncertain about a `migration` node type (high consequence, expensive to repair) should. The value-of-escalation term makes this distinction formal rather than leaving it to prompt engineering.

The repair-loop bounds -- repairLoopCount and maxRepairLoops from the Stage6TraceLog (ratified decisions, lines 438-439) -- gain a formal interpretation through DCE. Each repair iteration is an opportunity to re-evaluate S_esc(z) with updated evidence. If the score decreases after a patch iteration (the evidence is converging), the Verifier continues locally. If the score increases or plateaus (the evidence is not converging), the Verifier escalates. The maximum repair loop count becomes a policy backstop, not the primary escalation trigger: DCE fires before the hard limit in cases where continued local iteration has negative expected value.

---

## 5. Node Taxonomy Refines the Five-Role Topology Internally

The CEF paper defines eight node types, each corresponding to a repeatable decision role within the cognitive fabric (CEF paper, section 3.2):

1. **Pattern nodes**: read contextual and evidentiary fields, produce structured signals from raw observations.
2. **Compression nodes**: reduce entropy by transforming broad context into compact decision-relevant features.
3. **Constraint nodes**: interpret policy bundles and restrict the feasible action set.
4. **Authority nodes**: interpret the current authority envelope, determine what actions are authorized.
5. **Routing nodes**: estimate the posterior over feasible actions, compute uncertainty and competence signals.
6. **Execution nodes**: bridge cognition to deterministic capability, invoke the function layer.
7. **Justification nodes**: collect metrics, triggered rules, and selected actions into a trace record.
8. **Temporal nodes**: update recency, sequence position, event windows, and learning-loop triggers.

The Factory's five roles are not primitive. Each role performs multiple cognitive operations that map onto distinct node types. The mapping below decomposes each role into its constituent CEF sub-operations.

**Planner decomposition.** The Planner reads specEnvelope, workGraph, targetNodeIds, activeCandidate, repoContract, and validationOutcomes; it writes plan. Internally:
- A Pattern node extracts the structural shape of the workGraph: node types, edge topology, target subset.
- A Compression node reduces the specEnvelope and repoContract into the decision-relevant features: what constraints the plan must honor, what the repo already provides.
- A Constraint node reads the activeCandidate's convergence_policy (stop_on_first_pass, max_resample_branches) and tool_policy to bound what the plan may propose.
- A Routing node produces the execution ordering: which target nodes first, which edges create dependencies, which nodes can execute in parallel.
- An Execution node assembles the plan artifact from the resolved ordering and writes it.
- A Justification node records the plan's derivation trace for the Stage6TraceLog.

**Coder decomposition.** The Coder reads plan, workGraph, activeCandidate, repoContract, editScopes, repoContext; it writes patchProposals. Internally:
- A Pattern node reads the plan and identifies the specific code changes required for each target node.
- A Compression node reduces repoContext to the relevant file scope per edit.
- A Constraint node reads editScopes and tool_policy to bound what files the Coder may touch and what tools it may invoke.
- An Authority node checks whether the proposed edit is within the Coder's write domain (write_repo, write_filesystem per the tool_policy).
- An Execution node generates the patch.
- A Justification node records the patch derivation and any uncertainty.

**Critic decomposition.** The Critic reads plan, patchProposals, workGraph, specEnvelope, repoContract; it writes critique. Internally:
- A Pattern node identifies structural defects: scope violations, missing validations, invariant risks.
- A Compression node reduces the patchProposals to the relevant diff surface for each concern.
- A Constraint node checks patchProposals against the specEnvelope's invariants and the repoContract's behavioral promises.
- A Justification node compiles the critique with specific artifact references for each defect.

**Tester decomposition.** The Tester reads plan, patchProposals, critique, workGraph, scenarioManifest, toolResults; it writes validationPlan and validationOutcomes. Internally:
- A Pattern node maps invariants to scenario types (positive tests, negative tests, edge cases).
- A Constraint node reads the scenarioManifest to ensure scenario completeness: every branch in the workGraph must be exercised.
- An Execution node runs the test suite and collects toolResults.
- A Temporal node records test execution timing for the Stage6TraceLog.

**Verifier decomposition.** The Verifier reads plan, patchProposals, critique, validationOutcomes, repairLoopCount, maxRepairLoops, scopeViolation, hardConstraintViolation, activeCandidate; it writes decision, requiresHumanApproval, humanApprovalPayload. Internally:
- A Pattern node reads validationOutcomes and critique to identify the overall quality signal.
- A Compression node reduces the evidence to a decision-relevant summary: pass rate, defect severity, constraint satisfaction.
- A Constraint node reads the convergence_policy to determine which verdicts are feasible.
- An Authority node checks whether the current situation exceeds autonomous authority (scopeViolation, hardConstraintViolation).
- A Routing node is the DCE mechanism itself (section 4): it estimates the posterior over feasible verdicts and decides whether to act locally or escalate.
- A Justification node writes the terminal decision rationale and, if escalating, the humanApprovalPayload.
- A Temporal node records repairLoopCount and updates the iteration position.

This decomposition enables mixed-model execution within a single role, as described in section 2. The Pattern and Compression sub-nodes for most roles are routine operations amenable to cheap local models. The Routing and Authority sub-nodes require more judgment and may escalate to frontier models. The Constraint and Justification sub-nodes are largely deterministic (policy lookup, trace assembly) and may not require a language model at all.

The write-domain discipline from the CEF paper (section 2.4, equations 7-8) maps directly to the Factory's RoleAdherenceReport (ratified decisions, Zod schema for RoleAdherenceReport). The CEF paper states: "Nodes may not silently alter policy or authority unless they are explicitly designated policy or authority nodes" (CEF paper, section 2.4). In Factory terms: a Coder sub-node of type Constraint must not alter the convergence_policy; a Tester sub-node of type Execution must not alter the tool_policy. The RoleAdherenceReport's per-surface checks (read_access, write_access, do_not, output_semantics) are the Factory's enforcement of the CEF's write-domain discipline at the role level. The node taxonomy extends this enforcement to the sub-role level: each sub-node has its own declared write set within the role's overall write domain, creating a two-level type-safety hierarchy.

---

## 6. Bounded Learning Loop as "Execute Online, Learn Offline" for Candidate Lineage

The CEF paper defines a bounded learning loop with five planes (CEF paper, section 5.3, Figure 4):

1. **Runtime execution**: nodes process cases and emit telemetry.
2. **Telemetry capture**: execution traces, uncertainty signals, and outcome records are collected.
3. **Evaluation**: telemetry is assessed against frozen regression sets and policy-sensitive slices.
4. **Training**: candidate updates are produced from evaluation results.
5. **Release**: updates pass shadow and canary stages before promotion.

The key principle is "execute online, learn offline": no local node mutates itself during live execution (CEF paper, section 5.3). Telemetry compounds into evaluation data; evaluation produces candidate improvements; improvements are released through a controlled promotion pipeline. This separation is what makes learning compatible with governance: runtime behavior is deterministic for a given node version, and version changes are auditable events.

The Factory's candidate lineage system implements the same five-plane structure, though it was not originally described in these terms.

**Plane 1: Runtime execution.** Stage 6 executes a WorkGraph using a selected ArchitectureCandidate. The candidate specifies the topology, model binding, inference config, tool policy, and convergence policy (ratified decisions, ArchitectureCandidate Zod schema). The execution is bounded: repairLoopCount is tracked against maxRepairLoops; resample branches are tracked against max_resample_branches (ratified decisions, Stage6TraceLog, lines 438-439; ConvergencePolicy, lines 299-305).

**Plane 2: Telemetry capture.** The Stage6TraceLog records every role iteration (started_at, completed_at, read_fields, write_fields, output_artifact_paths), every tool call (tool_name, args_digest, outcome), every resample branch (branch_id, parent_branch_id, candidate_id, reason, status), and the terminal decision (verdict, rationale, requires_human_approval, disagreement_class) (ratified decisions, Stage6TraceLog Zod schema, lines 424-452). The Gate2Input normalizes this telemetry into a structured handoff artifact (ratified decisions, Gate2Input Zod schema, lines 490-526).

**Plane 3: Evaluation.** Gate 2 evaluates the telemetry against the three simulation coverage checks: scenario coverage (every workGraph branch exercised), invariant exercise (every invariant has a negative test), and required-validation pass rate (100% required) (Factory whitepaper, section 6.3). The candidate's objective scores -- correctness_proxy, test_pass_rate, regression_avoidance, compile_success_robustness, lineage_reliability, latency_efficiency, token_cost_efficiency, patch_economy, consistency_with_past_choices -- are computed from Gate 2 evidence (ratified decisions, ObjectiveScores Zod schema).

**Plane 4: Training.** The candidate lineage system is the Factory's training plane. The ratified decisions specify a confidence-weighted cold-start policy for lineage_reliability (ratified decisions, "cold-start policy for lineage_reliability"): below 5 observations, the axis is excluded and remaining weights renormalized; between 5 and 19 observations, a shrunk estimate blends a neutral prior (0.50) with observed reliability; above 20 observations, full weight applies. This is precisely the CEF paper's principle: learning compounds over time and becomes load-bearing as evidence accumulates, rather than being imposed prematurely.

The scoring engine's separation doctrine -- "YAML decides what families are plausible; TypeScript decides how they are evaluated; lineage decides how much the past should matter; Gate 2 decides whether the result is accepted" (ratified decisions, section F) -- is a Factory-specific expression of "execute online, learn offline." The YAML routing table and TypeScript evaluation logic are frozen during execution (online). Lineage updates happen post-execution (offline). Gate 2's verdict is the controlled release gate.

**Plane 5: Release.** Routing-table amendments follow the three-class governance discipline (ratified decisions, "routing-table amendment discipline"):
- **Class A (additive)**: a new candidate family is added. Required: paired PR, DECISIONS entry.
- **Class B (substitutive)**: an existing default changes. Required: paired PR, DECISIONS entry, Architect Semantic Review, golden-corpus rerun.
- **Class C (emergency)**: temporary override for confirmed regression. Required: fast-path PR, DECISIONS entry, explicit expiry, mandatory follow-up review.

Class A is the CEF's shadow stage: a new candidate family enters the system but does not change defaults. Class B is the canary-to-promotion transition: the default changes, but only after regression testing against the golden corpus. Class C is the CEF's emergency rollback: a live regression forces a temporary route change with mandatory follow-up.

The CEF paper's bounded learning loop supplies the formal structure that unifies these Factory mechanisms. Without the loop model, the Factory's candidate lineage, scoring engine, cold-start policy, and amendment classes appear as separate governance mechanisms. With the loop model, they are five planes of a single learning discipline: execution produces telemetry, telemetry feeds evaluation, evaluation produces candidate improvements, improvements are released through controlled governance classes. No candidate mutates during execution; all mutation happens through the amendment pipeline.

This mapping also clarifies what the Factory has not yet formalized: the evaluation plane's regression sets. The CEF paper specifies "frozen regression sets and policy-sensitive slices" (CEF paper, section 5.3). The Factory's golden corpus (ratified decisions, "initial golden corpus composition") is the first regression set: deterministic real-function fixture, routing-diversity fixture, governance-stress fixture, tool-policy-sensitive fixture. The bounded learning loop framework suggests that additional regression sets should be defined per candidate family as lineage accumulates, creating family-specific frozen benchmarks that candidate updates must pass before promotion -- a strengthening of the current golden-corpus-per-routing-table-change requirement.

---

## 7. Heterogeneous Graph Evaluation as Gate 3's Substrate

Gate 3 -- the Assurance Coverage Gate -- is the Factory's continuous monitoring gate. It runs per-Function, per-invariant, checking three properties: detector freshness (every invariant's detector has reported within its threshold), evidence source liveness (every named evidence source is emitting at expected cadence), and audit pipeline integrity (expected audit volume matches observed volume) (Factory whitepaper, section 6.4). Failure transitions the Function from `monitored` to `assurance_regressed`: a loss of visibility regression distinct from behavioral regression (Factory whitepaper, section 6.4; ConOps, Scenario E, section 7.5).

Gate 3 is currently the least formalized of the three gates. Gates 1 and 2 have concrete evaluation formulas: Gate 1 checks atom coverage, invariant coverage, validation coverage, and dependency closure against WorkGraph artifacts; Gate 2 checks scenario coverage, invariant exercise, and required-validation pass rate against simulation results (Factory whitepaper, sections 6.2-6.3). Gate 3, by contrast, checks temporal properties (freshness, liveness, cadence) that are harder to specify as static formulas because they depend on the evolving relationship between Functions, detectors, evidence sources, and the infrastructure that connects them.

The CEF paper's heterogeneous graph evaluation framework provides the formal substrate Gate 3 needs. The framework models the runtime as a heterogeneous graph with nine node types (CEF paper, section 7.2):

- case
- decision_state
- local_node
- frontier_node
- policy
- authority
- action
- outcome
- telemetry_cluster

Connected by typed edges: instantiates, evaluated_by, bounded_by, authorized_by, proposes, escalates_to, produces, observed_as (CEF paper, section 7.2).

The Factory's assurance dependency graph (Factory whitepaper, section 5) maps onto this schema with domain-specific node and edge types:

| CEF graph node type | Factory equivalent |
|---|---|
| case | Function (a specific Function instance being monitored) |
| decision_state | Invariant health (the computed 0.0-1.0 score per invariant) |
| local_node | Detector (the invariant health detector with direct rules, warning rules, evidence sources) |
| frontier_node | Incident Responder or Architect (the human escalation targets) |
| policy | Coverage Gate formula (the specific gate that governs the Function) |
| authority | Authority class (read, routine write, reviewed write, controlled write per ConOps section 5.1) |
| action | Lifecycle transition (monitored -> assurance_regressed, or monitored -> regressed) |
| outcome | Coverage Report (the Gate 3 verdict per evaluation cycle) |
| telemetry_cluster | Evidence source (the telemetry stream, audit topic, or incident channel the detector reads) |

The Factory's five dependency types (execution, evidence, policy, shared invariant, shared adapter) from the assurance dependency graph (Factory whitepaper, section 5) map onto the CEF's typed edges. An execution dependency is an instantiates edge (one Function instantiates another's capability). An evidence dependency is an observed_as edge (one Function's evidence is consumed by another's detector). A shared-invariant dependency is a bounded_by edge (both Functions are bounded by the same invariant's health). A shared-adapter dependency is an evaluated_by edge (both Functions are evaluated through the same integration substrate).

With this mapping, three concrete Gate 3 operations become expressible as heterogeneous graph computations.

**Drift detection.** A detector that has gone silent is a local_node with no recent telemetry_cluster edges. In the graph representation, detector freshness is a node-level temporal feature: the time since the last observed_as edge was created between the detector node and a telemetry_cluster node. Gate 3's freshness check becomes a graph query: find all local_node entities of type Detector where max(edge.timestamp for edge in observed_as edges) < freshness_threshold. The GraphSAGE framework (Hamilton et al., 2017; cited in CEF paper section 7.4) provides inductive neighborhood aggregation that generalizes to new detectors without retraining -- critical because new Functions produce new detectors continuously.

**Competence monitoring.** Over time, a detector may degrade: its direct rules may become stale as the Function's behavior evolves, or its evidence sources may drift in schema. The CEF paper's competence-surface learning task (CEF paper, section 7.3, task 3) estimates which local node is best suited for a new region of cases. Applied to Gate 3: which detectors are reliably detecting violations versus which are producing false negatives? The heterogeneous graph framework enables this by learning detector-level features from the neighborhood of outcome nodes (Coverage Reports that cite the detector) and telemetry_cluster nodes (evidence sources the detector consumes). A detector whose neighborhood features diverge from the historical pattern is a candidate for staleness investigation.

**Escalation-bottleneck analysis.** The Factory's incident propagation runs through the assurance dependency graph (Factory whitepaper, section 5; ConOps, section 6.4). In the heterogeneous graph representation, an incident is a cascade of action nodes (lifecycle transitions) triggered by a single outcome node (a Coverage Report with overall: fail). The graph structure reveals bottlenecks: a single shared-invariant node that connects to many Function nodes is a single point of failure whose regression cascades broadly. The CEF paper's graph-level metrics -- "change in frontier-traffic centrality over time" and "structural concentration of human review bottlenecks" (CEF paper, section 7.5) -- are directly applicable to Gate 3 analysis. A rising centrality score for an invariant node means more Functions depend on it; a rising human-escalation rate for a specific detector type means the detector's automated checks are insufficient.

The HGT (Heterogeneous Graph Transformer) framework (Hu et al., 2020; cited in CEF paper section 7.4) is particularly suited to Gate 3 because it uses node- and edge-type-specific parameters and temporal encoding for dynamic heterogeneous graphs. The Factory's assurance graph is dynamic: new Functions arrive, new detectors are registered, evidence sources come online and go offline, incidents create and resolve edges. HGT's temporal encoding captures these dynamics natively, enabling Gate 3 to reason about trends (this detector has been degrading over the past week) rather than only snapshots (this detector is stale right now).

The practical consequence is that Gate 3 moves from three independent temporal checks (freshness, liveness, cadence) to a unified graph-based continuous evaluation that captures the relational structure between Functions, invariants, detectors, and evidence sources. This is not a replacement for the three checks; they remain as the fail-closed floor. The graph evaluation is the ceiling: a richer diagnostic layer that detects systemic assurance degradation before individual detectors fail.

---

## 8. Implications for the Factory's v2 Governance Documents

The prior session that produced the ratified decisions document and the v2 governance refinements surfaced eleven specific insights for the Factory's next governance iteration. The cognitive runtime integration strengthens, subsumes, or enriches each of them. The eleven insights are enumerated below with their disposition under the integration.

**Insight 1: Minimum-sufficient model delegation, not single-harness binding.** The session established that Stage 6 delegates to the minimum-sufficient model that satisfies a Function's contract, policy constraints, and validation requirements -- not to Claude Code or any single harness. The `ArchitectureCandidate.model_binding` field (Record<RoleName, ModelIdentifier>) is the authoritative expression. **CEF enrichment**: the Cognitive Edge Fabric extends minimum-sufficient delegation from role-level to sub-role-level. Each role's internal CEF graph routes sub-tasks to the cheapest capable model, reducing frontier calls further (section 2 of this paper). The node taxonomy (section 5) provides the decomposition vocabulary.

**Insight 2: Per-role read/write contracts as first-class governance.** The prompt pack's read/write field declarations per role are the Factory's informal state model. **Decision algebra subsumption**: the decision algebra D = (I, C, P, E, A, X, O, J, T) formalizes these field declarations as typed partial transformations with write-domain discipline (section 3). The ad-hoc field-name-based state model is subsumed by a mathematical type system that makes governance a structural property rather than a prompt instruction.

**Insight 3: ArchitectureCandidate immutability and lineage separation.** The ratified decisions require that observed downstream outcomes not be stored as mutable fields on the candidate artifact; they belong in lineage artifacts linked by candidate ID. **Bounded learning loop alignment**: the five-plane learning loop (section 6) provides the formal justification: candidates are frozen during execution (plane 1) and only updated through the controlled release pipeline (plane 5). Immutability is not a convention; it is a structural requirement of the "execute online, learn offline" discipline.

**Insight 4: Two-stage candidate selection (admissibility then weighted scoring).** The ratified decisions separate hard admissibility filters from nine-axis weighted scoring. **CEF alignment**: the CEF paper's feasible action space X(z) = {x | x satisfies P and A} (CEF paper, section 2.3) provides the formal basis for this separation. Admissibility is the feasible action space; weighted scoring is the posterior distribution over that space. The two stages are not a design choice; they are a mathematical consequence of separating constraint satisfaction from optimization.

**Insight 5: Three routing-table amendment classes (A/B/C).** The ratified decisions classify routing changes as additive, substitutive, or emergency with escalating governance requirements. **Bounded learning loop subsumption**: the three classes map directly onto the five-plane loop's release discipline (section 6): Class A is shadow introduction, Class B is canary-to-promotion, Class C is emergency rollback. The CEF paper's formal loop structure explains *why* these three classes are necessary and sufficient.

**Insight 6: Gate 3 as continuous assurance monitoring (stubbed).** Gate 3 was specified as three temporal checks (freshness, liveness, cadence) but lacked a formal substrate for relational evaluation. **Heterogeneous graph subsumption**: the CEF's heterogeneous graph framework (section 7) provides Gate 3 with a concrete implementation path: drift detection, competence monitoring, and escalation-bottleneck analysis as graph computations over the Factory's assurance dependency graph.

**Insight 7: Three disagreement resolution classes.** The ratified decisions define repairable_local, architectural, and governance as the three classes of Verifier-Gate 2 disagreement. **DCE enrichment**: Decision-Conditioned Escalation (section 4) maps these three classes to its escalation outcomes (local_execute, frontier_escalate, human_escalate) and replaces the binary routing between them with a continuous calibrated score. The disagreement classes remain as the governance vocabulary; DCE provides the mechanism that determines which class applies.

**Insight 8: Binary requiresHumanApproval flag.** The ratified decisions define this as a boolean on the TerminalDecision. **DCE subsumption**: the composite escalation score S_esc(z) replaces the binary flag with a continuous value whose thresholds are policy-tunable (section 4). The boolean remains as a derived property: requiresHumanApproval = (S_esc(z) >= tau_human), but the underlying mechanism is richer.

**Insight 9: Repair-loop bounds (repairLoopCount / maxRepairLoops).** The ratified decisions define hard iteration limits on the repair loop. **Conformal action sets enrichment**: the CEF's conformal prediction construct (CEF paper, section 4.5) formalizes when to stop repairing before the hard limit: a non-singleton conformal action set that persists across iterations indicates that continued repair has negative expected value (section 4). The hard limit becomes a policy backstop, not the primary stopping criterion.

**Insight 10: Golden corpus composition.** The ratified decisions define four fixture types for regression testing. **Bounded learning loop enrichment**: the five-plane loop (section 6) suggests that regression sets should be defined per candidate family as lineage accumulates, not just as a single golden corpus. Family-specific frozen benchmarks are a natural extension of the "evaluate against frozen regression sets" principle.

**Insight 11: Cold-start policy for lineage_reliability.** The ratified decisions define a phased confidence policy: exclude below 5 observations, shrunk estimate from 5-19, full weight above 20. **Bounded learning loop alignment**: this is a Factory-specific instance of the CEF paper's principle that local nodes learn in a bounded regime (CEF paper, section 3.3). The cold-start policy is the learning loop's early-lifecycle behavior: insufficient evidence means the axis contributes nothing; sufficient evidence means it becomes load-bearing. The CEF framework validates the policy's structure and suggests it should generalize to other scoring axes as well -- any axis with insufficient calibration data should be excluded and renormalized, not filled with a neutral prior.

---

## 9. What Remains Informal

Honesty about gaps is an architectural requirement, not a rhetorical concession. Five specific prerequisites must be met before the cognitive runtime integration described in this paper can move from structural mapping to production implementation.

**1. Stage 6 coordinator does not yet exist.** The Factory's `packages/stage-6-coordinator/` is referenced in the architecture but has no implementation. The CEF paper assumes a LangGraph-style shared-state graph runtime: state schemas, node functions that return partial updates, edges that determine execution order, and reducers that aggregate updates across branches (CEF paper, section 1; citing LangGraph graph API, StateGraph, and overview documentation). The Factory's current Stage 6 delegates to external harnesses (Claude Code, Cursor) via the WorkGraph and prompt pack (ConOps, section 9.4). The integration described in sections 2-5 of this paper -- CEF decomposition of roles, decision algebra as shared state, DCE as escalation mechanism, node taxonomy as internal structure -- requires an in-Factory coordinator that manages the decision state object, enforces write-domain discipline, and routes sub-tasks to appropriate model tiers. Without this coordinator, the cognitive runtime constructs remain formal mappings rather than executable code. The ratified decisions define observable triggers for when in-Factory execution becomes warranted: external harness unavailability, second harness introduction, Stage 6 availability requirements above 99.9%, or soft triggers including volume above 500, latency misses, manual intervention rate above 10%, and disagreement rate above 5% (ratified decisions, "observable trigger for A''->B reconsideration").

**2. Conformal prediction requires calibration data the Factory has not collected.** The DCE mechanism (section 4) depends on conformal action sets Gamma_alpha(z) with coverage controlled at level 1 - alpha (CEF paper, section 4.5; citing Angelopoulos and Bates, 2021). Conformal prediction requires exchangeable calibration data: a set of (input, action, outcome) triples from which to compute nonconformity scores. The Factory's candidate lineage system collects this data over time (Stage6TraceLog records per run), but the cold-start policy for lineage_reliability (ratified decisions, "cold-start policy") explicitly acknowledges that fewer than 5 observations per candidate family provides insufficient evidence. Conformal prediction at the Verifier level will require accumulating hundreds of calibrated (z, X, O) triples before the conformal sets are meaningful. Until then, the DCE score must operate without the conformal term -- setting w_C = 0 in the composite escalation score -- which reduces DCE to an entropy + margin + epistemic uncertainty + risk - competence signal. This is still richer than the binary requiresHumanApproval flag, but it lacks the distribution-free coverage guarantee that conformal prediction provides.

**3. Heterogeneous graph evaluation requires a GNN training pipeline.** Gate 3's graph-based continuous evaluation (section 7) requires a pipeline for training GraphSAGE and HGT models on the Factory's assurance graph. The CEF paper references PyTorch Geometric's heterogeneous graph tooling (CEF paper, section 7.4; citing PyG hetero documentation), but the Factory has no Python ML pipeline. The Factory's implementation stack is TypeScript/bun (packages/schemas, packages/coverage-gates, packages/compiler, packages/candidate-selection are all TypeScript). Introducing a Python GNN training pipeline creates a cross-language dependency that must be managed. The practical path is to implement Gate 3's three temporal checks (freshness, liveness, cadence) as TypeScript-native checks -- which is sufficient for fail-closed monitoring -- and introduce the graph evaluation layer as an offline analytical capability that runs periodically (weekly or per-release), not as a real-time gate component. The graph analysis produces diagnostic reports for the Architect and Operator; the temporal checks remain the fail-closed enforcement.

**4. CEF node decomposition requires prompt engineering and evaluation infrastructure.** Decomposing each Factory role into CEF sub-nodes (section 5) is an architectural mapping, not an implementation. Making it work requires: (a) designing prompt templates for each sub-node type within each role; (b) defining the sub-state schema that each sub-node reads and writes; (c) implementing the local routing logic that decides which sub-nodes execute on cheap models versus frontier models; (d) evaluating whether the decomposed execution produces equivalent or better results than the monolithic role execution. This evaluation infrastructure -- a comparison framework between monolithic and decomposed role execution with quality metrics, cost metrics, and governance metrics -- does not exist. Building it is a prerequisite for CEF integration, not a consequence of it.

**5. Write-domain enforcement at the sub-role level is not implemented.** The RoleAdherenceReport (ratified decisions, Zod schema) checks read_access, write_access, do_not, and output_semantics per role. Extending this to sub-role level -- checking that a Pattern sub-node within the Coder role did not write to the plan field, for example -- requires either runtime interception of sub-node writes (expensive, requires coordinator infrastructure from gap 1) or post-hoc diff analysis of the decision state between sub-node invocations (cheaper, requires structured logging of sub-node boundaries). Neither mechanism exists.

These five gaps are implementation prerequisites, not architectural objections. The structural mappings in sections 2-7 hold regardless of whether the implementation exists today. The decision algebra is the right type system for Stage 6's shared state whether or not a coordinator enforces it at runtime. DCE is the right escalation mechanism whether or not conformal calibration data exists yet. The heterogeneous graph framework is the right substrate for Gate 3 whether or not a GNN pipeline is available. The gaps determine *when* the integration becomes operational, not *whether* it is architecturally sound.

---

## 10. Conclusion

The Function Factory and the layered cognitive runtime are complementary expressions of the same architectural thesis: intelligence in agentic systems should be distributed, typed, governed, and improved over time. The Factory governs what to build: environmental pressures are compiled through seven stages into trustworthy executable Functions whose invariants are monitored, whose trust is computed from evidence, and whose degradation triggers new Function proposals through closed-loop trajectory detection. The cognitive runtime governs how to think: a decision algebra types the reasoning state, a Cognitive Edge Fabric distributes cognition across cheap specialized nodes, Decision-Conditioned Escalation authorizes action based on calibrated uncertainty rather than ad-hoc confidence, and a bounded learning loop separates execution-time determinism from offline improvement. Integrating them produces a system that compiles reality -- converting pressures into Functions -- and executes with formal cognitive discipline -- routing each sub-task to the minimum-sufficient model, enforcing write-domain type safety on every state mutation, escalating through a continuous calibrated mechanism rather than a binary flag, and evaluating its own assurance graph as an evolving heterogeneous relational system. The seven integration points identified in this paper are not features to be added to the Factory; they are the formal foundations that the Factory's governance claims require.

---

## References

### Primary sources

- Celestin, W. J. (2026a). *The Function Factory: An Upstream-to-Downstream Compiler for Trustworthy Executable Functions.* Whitepaper v4, Koales.ai / WeOps Research, 18 April 2026. [Factory whitepaper]

- Anonymous preprint (2026b). *A Layered Cognitive Runtime for Agentic Systems: Cognitive Edge Fabric, Decision-Conditioned Escalation, and Heterogeneous Graph Evaluation.* Preprint, 2026. [CEF paper]

- Celestin, W. J. (2026c). *The Function Factory -- Concept of Operations.* Koales.ai Seed ConOps v1, 18 April 2026. [ConOps]

- Celestin, W. J. (2026d). *Ratified decisions: candidate admissibility and scoring, routing-table amendment discipline, disagreement resolution, observable triggers, golden corpus composition, ArchitectureCandidate field discipline, Stage 6 to Gate 2 contract, schema evolution, model-identifier versioning, cold-start lineage policy, routing-table validation.* Koales.ai / WeOps Research, April 2026. [Ratified decisions]

- Prompt pack: per-role read/write field declarations for Planner, Coder, Critic, Tester, Verifier. Thread artifact (03_prompt_pack.md), Function Factory design thread, April 2026.

### Cited from the CEF paper's bibliography

- Angelopoulos, A. N. and Bates, S. (2021). A gentle introduction to conformal prediction and distribution-free uncertainty quantification. arXiv:2107.07511.

- Guo, C., Pleiss, G., Sun, Y., and Weinberger, K. Q. (2017). On calibration of modern neural networks. In *Proc. ICML*.

- Geifman, Y. and El-Yaniv, R. (2017). Selective classification for deep neural networks. In *Proc. NeurIPS*.

- Hamilton, W. L., Ying, R., and Leskovec, J. (2017). Inductive representation learning on large graphs. In *Proc. NeurIPS*. [GraphSAGE]

- Hu, Z., Dong, Y., Wang, K., and Sun, Y. (2020). Heterogeneous graph transformer. In *Proc. WWW*. [HGT]

- PyTorch Geometric. Heterogeneous graph learning. https://pytorch-geometric.readthedocs.io/en/latest/notes/heterogeneous.html

- Sculley, D. et al. (2015). Hidden technical debt in machine learning systems. In *Advances in Neural Information Processing Systems*.

- Tabassi, E. et al. (2023). Artificial Intelligence Risk Management Framework (AI RMF 1.0). NIST AI 100-1.

- LangChain. Graph API overview, LangGraph overview, StateGraph reference. LangGraph documentation.

### Adjacent works cited in the Factory whitepaper

- Archon (Stanford, 2024). Architecture search over reasoning architectures for multi-model composition.

- StrongDM Dark Factory (2025). Autonomous software production via specs, agents, and scenario validation.

- Zhou et al. (2026). Externalization in LLM Agents. arXiv:2604.08224. Harness engineering: memory, skills, protocols.

- WeOps/WGSP Executive Whitepaper (WP-2026-EP-01). Koales.ai.
