# Ontology for Orientation Agents in Function-Factory

## 1. Core definition

An **Orientation Agent** is a factory-level agent that interprets telemetry-derived signals, updates the factory’s self-description layer, and produces Meta-Artifacts that guide bounded self-evolution.

It does not simply execute tasks.

It answers:

> What is happening to the factory?
> What does it mean?
> What should the factory learn about itself?
> What kind of mutation is justified?

---

# 2. Ontology purpose

The ontology gives Orientation Agents a shared language for:

```text
Telemetry → Signals → Interpretation → Meta-Artifacts → Evolution Decisions
```

It defines the entities needed to describe:

1. Factory behavior
2. Factory failures
3. Factory drift
4. Factory learning
5. Factory mutation proposals
6. Governance boundaries
7. Evidence and traceability

---

# 3. Top-level ontology

```text
FunctionFactoryOntology
├── FactoryObject
├── TelemetryObservation
├── Signal
├── OrientationAssessment
├── MetaArtifact
├── EvolutionHypothesis
├── MutationProposal
├── GovernanceConstraint
├── EvaluationResult
├── FactoryMemory
└── FactoryVersion
```

---

# 4. Core classes

## A. FactoryObject

Anything inside the factory that can be observed, evaluated, changed, or governed.

```text
FactoryObject
├── IntentCompiler
├── CompilerPass
├── WorkGraph
├── WorkGraphNode
├── NodeContract
├── PromptTemplate
├── ToolBinding
├── ModelRoute
├── PolicyRule
├── Validator
├── EvaluationHarness
├── ArchitectureCandidate
├── Capability
└── RuntimeEnvironment
```

Example:

```json
{
  "object_type": "WorkGraphNode",
  "object_id": "node.contract_extractor",
  "factory_version": "ff.v0.4.2",
  "owner_layer": "compiler_passes",
  "current_status": "unstable"
}
```

---

## B. TelemetryObservation

Raw or semi-structured evidence from factory execution.

```text
TelemetryObservation
├── RuntimeMetric
├── TraceEvent
├── ValidationFailure
├── PolicyDecision
├── ModelExecutionResult
├── HumanCorrection
├── CriticFinding
├── TestResult
├── CostObservation
├── LatencyObservation
└── DriftMeasurement
```

Telemetry is what happened.

Signal is what mattered.

---

## C. Signal

A typed interpretation of telemetry.

```text
Signal
├── PromptDriftSignal
├── ContractFragilitySignal
├── PassInefficiencySignal
├── ModelMismatchSignal
├── EvidenceGapSignal
├── WorkGraphInstabilitySignal
├── CapabilityGapSignal
├── PolicyFrictionSignal
├── RegressionRiskSignal
├── LearningOpportunitySignal
└── GovernanceViolationSignal
```

Minimal schema:

```json
{
  "signal_id": "sig_001",
  "signal_type": "ContractFragilitySignal",
  "source_observations": ["obs_991", "obs_992"],
  "affected_factory_objects": ["node.contract_extractor"],
  "severity": "high",
  "confidence": 0.88,
  "time_window": "2026-04-21/2026-04-28",
  "orientation_status": "requires_assessment"
}
```

---

## D. OrientationAssessment

The interpretive product of an Orientation Agent.

This is the heart of the ontology.

```text
OrientationAssessment
├── SituationFrame
├── CausalDiagnosis
├── RiskInterpretation
├── OpportunityInterpretation
├── CapabilityInterpretation
├── DriftInterpretation
├── GovernanceInterpretation
└── EvolutionRecommendation
```

Example:

```json
{
  "assessment_id": "oa_001",
  "generated_by": "orientation_agent.contract_health",
  "input_signals": ["sig_001", "sig_002"],
  "situation_frame": "Contract extraction is brittle under ambiguous PRDs",
  "causal_diagnosis": "Prompt lacks explicit invariant ownership rules",
  "risk_interpretation": "Downstream WorkGraph assembly produces invalid dependencies",
  "recommended_meta_artifacts": [
    "PromptPatch",
    "ContractAmendment",
    "EvaluationHarnessUpdate"
  ]
}
```

---

## E. MetaArtifact

A factory self-description artifact that proposes or records how the factory should understand or alter itself.

```text
MetaArtifact
├── PromptPatch
├── ContractAmendment
├── PassRefactorBrief
├── RoutingPolicyPatch
├── EvaluationHarnessUpdate
├── ArchitectureCandidateDelta
├── GovernanceCaseFile
├── CapabilityBirthCertificate
├── FactoryMemoryUpdate
├── LineageUpdate
└── MutationProposal
```

Meta-Artifacts are not ordinary outputs.

They are **factory-changing knowledge objects**.

---

# 5. Orientation Agent ontology

## OrientationAgent

```text
OrientationAgent
├── SignalInterpreterAgent
├── DriftDiagnosisAgent
├── ContractHealthAgent
├── WorkGraphStabilityAgent
├── ModelRoutingAgent
├── PolicyFrictionAgent
├── CapabilityDiscoveryAgent
├── EvaluationDesignAgent
├── MemoryCuratorAgent
└── EvolutionGovernorAgent
```

Each agent has:

```json
{
  "agent_id": "orientation_agent.contract_health",
  "agent_role": "Detect contract fragility and propose contract-level evolution",
  "observes": ["ValidationFailure", "ContractFragilitySignal"],
  "produces": ["ContractAmendment", "PromptPatch", "EvaluationHarnessUpdate"],
  "cannot_directly_modify": ["production_factory"],
  "autonomy_level": "L2_Propose"
}
```

---

# 6. Key relationships

## A. Observation to signal

```text
TelemetryObservation
  produces
Signal
```

Example:

```text
ValidationFailure → ContractFragilitySignal
```

---

## B. Signal to assessment

```text
Signal
  interpreted_by
OrientationAgent
  produces
OrientationAssessment
```

---

## C. Assessment to Meta-Artifact

```text
OrientationAssessment
  recommends
MetaArtifact
```

---

## D. Meta-Artifact to mutation

```text
MetaArtifact
  may_authorize
FactoryMutation
```

Only after validation and governance.

---

## E. Mutation to version

```text
FactoryMutation
  creates
FactoryVersion
```

---

## F. Version to monitoring

```text
FactoryVersion
  monitored_by
TelemetryObservation
```

This closes the self-evolution loop.

---

# 7. Full semantic loop

```text
Factory Execution
→ TelemetryObservation
→ Signal
→ OrientationAssessment
→ MetaArtifact
→ GovernanceGate
→ SandboxMutation
→ EvaluationResult
→ FactoryVersion
→ FactoryMemory
→ New Factory Execution
```

---

# 8. Ontology as triples

You can express the ontology as RDF-style statements:

```text
obs_991 rdf:type ValidationFailure
obs_991 observed_on node.contract_extractor
obs_991 indicates ContractFragilitySignal

sig_001 rdf:type ContractFragilitySignal
sig_001 affects node.contract_extractor
sig_001 has_severity high
sig_001 interpreted_by orientation_agent.contract_health

orientation_agent.contract_health produces oa_001

oa_001 rdf:type OrientationAssessment
oa_001 diagnoses PromptUnderspecification
oa_001 recommends ma_001

ma_001 rdf:type ContractAmendment
ma_001 targets contract.contract_extractor.v1
ma_001 proposes_add_field invariant_owner
```

---

# 9. Decision algebra alignment

Map Orientation Agent reasoning to:

```text
D = ⟨I, C, P, E, A, X, O, J, T⟩
```

| Decision Algebra Element | Ontology Equivalent             |
| ------------------------ | ------------------------------- |
| I — Intent               | EvolutionIntent                 |
| C — Context              | SituationFrame                  |
| P — Policy               | GovernanceConstraint            |
| E — Evidence             | TelemetryObservation + Signal   |
| A — Authority            | AutonomyLevel + GovernanceGate  |
| X — Action               | MetaArtifact / MutationProposal |
| O — Outcome              | EvaluationResult                |
| J — Justification        | OrientationAssessment           |
| T — Time                 | TelemetryWindow / VersionWindow |

So every Orientation Assessment should be decision-shaped.

---

# 10. Required ontology modules

## Module 1: Factory Structure Ontology

Describes what exists.

```text
FactoryObject
has_contract
has_prompt
has_model_route
has_policy
has_validator
has_runtime_trace
```

---

## Module 2: Telemetry Ontology

Describes what happened.

```text
TelemetryObservation
has_metric
has_trace
has_failure_mode
has_cost
has_latency
has_confidence
```

---

## Module 3: Signal Ontology

Describes what matters.

```text
Signal
has_type
has_severity
has_confidence
has_scope
has_trigger_condition
affects_factory_object
```

---

## Module 4: Orientation Ontology

Describes what it means.

```text
OrientationAssessment
frames_situation
diagnoses_cause
estimates_risk
identifies_opportunity
recommends_meta_artifact
```

---

## Module 5: Meta-Artifact Ontology

Describes how the factory learns.

```text
MetaArtifact
targets_factory_object
proposes_change
requires_validation
has_rollback_condition
has_expected_effect
```

---

## Module 6: Evolution Governance Ontology

Describes what may change.

```text
GovernanceGate
permits
blocks
requires_review
requires_test
requires_canary
requires_rollback
```

---

## Module 7: Factory Memory Ontology

Describes what the factory remembers.

```text
FactoryMemory
stores_pattern
stores_failure_case
stores_success_case
stores_mutation_history
stores_lineage
```

---

# 11. Orientation Agent types

## 1. Signal Interpreter Agent

Purpose:

```text
Convert telemetry-derived signals into meaningful factory-level interpretations.
```

Consumes:

```text
Signal
TelemetryObservation
FactoryObject
```

Produces:

```text
OrientationAssessment
```

---

## 2. Drift Diagnosis Agent

Purpose:

```text
Detect divergence between intended factory behavior and observed behavior.
```

Detects:

```text
IntentDrift
PromptDrift
CapabilityDrift
PolicyDrift
ModelRouteDrift
WorkGraphDrift
```

Produces:

```text
DriftInterpretation
GovernanceCaseFile
MutationProposal
```

---

## 3. Contract Health Agent

Purpose:

```text
Evaluate whether node contracts remain valid, complete, and composable.
```

Produces:

```text
ContractAmendment
PromptPatch
EvaluationHarnessUpdate
```

---

## 4. Capability Discovery Agent

Purpose:

```text
Identify repeated workarounds that should become reusable Functions.
```

Produces:

```text
CapabilityBirthCertificate
ArchitectureCandidateDelta
FunctionSpecificationDraft
```

---

## 5. Model Routing Agent

Purpose:

```text
Detect whether models/tools are misaligned with task type, risk, cost, or quality.
```

Produces:

```text
RoutingPolicyPatch
ModelRouteEvaluation
EscalationRuleUpdate
```

---

## 6. Policy Friction Agent

Purpose:

```text
Detect where governance policies block useful work or allow risky work.
```

Produces:

```text
PolicyPatch
GovernanceCaseFile
ExceptionPatternReport
```

---

## 7. Evaluation Design Agent

Purpose:

```text
Turn recurring failures into new tests, fixtures, golden traces, and regression suites.
```

Produces:

```text
EvaluationHarnessUpdate
GoldenTraceSet
RegressionFixture
```

---

## 8. Memory Curator Agent

Purpose:

```text
Decide what factory experience becomes durable factory knowledge.
```

Produces:

```text
FactoryMemoryUpdate
LineageUpdate
PatternLibraryEntry
```

---

## 9. Evolution Governor Agent

Purpose:

```text
Authorize bounded factory evolution.
```

Consumes:

```text
MetaArtifact
GovernanceConstraint
EvaluationResult
RiskAssessment
```

Produces:

```text
ApproveSandboxMutation
ApproveCanaryMutation
RejectMutation
RequestMoreEvidence
RollbackDecision
```

---

# 12. Core ontology schema

```json
{
  "ontology_name": "FunctionFactoryOrientationOntology",
  "version": "0.1.0",
  "core_classes": [
    "FactoryObject",
    "TelemetryObservation",
    "Signal",
    "OrientationAgent",
    "OrientationAssessment",
    "MetaArtifact",
    "GovernanceGate",
    "FactoryMutation",
    "EvaluationResult",
    "FactoryMemory",
    "FactoryVersion"
  ],
  "core_relations": [
    "observes",
    "produces",
    "interprets",
    "affects",
    "targets",
    "recommends",
    "requires_validation",
    "authorizes",
    "mutates",
    "creates_version",
    "records_lineage"
  ]
}
```

---

# 13. Minimal JSON-LD-style model

```json
{
  "@context": {
    "ff": "https://function-factory.dev/ontology#",
    "prov": "http://www.w3.org/ns/prov#"
  },
  "@type": "ff:OrientationAssessment",
  "@id": "ff:oa_001",
  "ff:generatedBy": "ff:orientation_agent.contract_health",
  "ff:interpretsSignal": "ff:sig_contract_fragility_001",
  "ff:affectsFactoryObject": "ff:node.contract_extractor",
  "ff:situationFrame": "Contract extraction is brittle under ambiguous PRDs",
  "ff:causalDiagnosis": "Prompt lacks invariant ownership extraction rule",
  "ff:recommendedMetaArtifact": [
    "ff:prompt_patch_001",
    "ff:contract_amendment_001",
    "ff:evaluation_harness_update_001"
  ],
  "prov:wasDerivedFrom": [
    "ff:trace_8831",
    "ff:trace_8840",
    "ff:trace_8872"
  ]
}
```

---

# 14. Practical storage model

Use three layers:

```text
1. Event store
   Raw telemetry, traces, logs

2. Semantic graph
   Signals, agents, assessments, meta-artifacts, lineage

3. Versioned artifact registry
   Prompts, contracts, policies, WorkGraphs, ArchitectureCandidates
```

Recommended graph shape:

```text
(:TelemetryObservation)-[:INDICATES]->(:Signal)
(:Signal)-[:INTERPRETED_BY]->(:OrientationAgent)
(:OrientationAgent)-[:PRODUCES]->(:OrientationAssessment)
(:OrientationAssessment)-[:RECOMMENDS]->(:MetaArtifact)
(:MetaArtifact)-[:TARGETS]->(:FactoryObject)
(:MetaArtifact)-[:REQUIRES]->(:EvaluationHarness)
(:EvaluationResult)-[:SUPPORTS]->(:FactoryMutation)
(:FactoryMutation)-[:CREATES]->(:FactoryVersion)
```

---

# 15. Example: full ontology instance

```text
Telemetry:
schema validation failed in contract_extractor 38% of runs

Signal:
ContractFragilitySignal

Orientation Agent:
ContractHealthAgent

Assessment:
The contract extractor is underspecified around invariant ownership and dependency direction.

Meta-Artifacts:
PromptPatch
ContractAmendment
EvaluationHarnessUpdate

Governance:
Sandbox only; production promotion requires golden trace pass.

Mutation:
contract_extractor.v1.2 → contract_extractor.v1.3

Memory:
Store failure pattern as reusable contract-fragility case.
```

---

# 16. Design principle

The Orientation Ontology should enforce one rule:

> No factory self-mutation without a typed signal, a traceable assessment, a Meta-Artifact, a validation plan, and a rollback condition.

That is what makes self-autonomous evolution governable.

---

# 17. The clean conceptual stack

```text
Telemetry Layer
What happened?

Signal Layer
What matters?

Orientation Layer
What does it mean?

Meta-Artifact Layer
What should change?

Governance Layer
What is allowed to change?

Mutation Layer
What changed?

Memory Layer
What did the factory learn?
```

---

# Final framing

The **Ontology for Orientation Agents** is the semantic control layer of Function-Factory.

It lets the factory observe itself, interpret itself, describe itself, and evolve itself through governed Meta-Artifacts.

The Orientation Agent does not merely react to failures.

It maintains the factory’s self-understanding.

That is the shift:

> Function-Factory becomes not only a system that builds functions, but a system that learns what kind of factory it is becoming.




# PromptPacts / Context Engineering Design

## Core idea

**PromptPacts** are governed agreements between an agent, its context, its tools, and its expected behavior.

They define:

```text
What context is allowed
What context is required
How context must be shaped
What the prompt must produce
What obligations the agent must obey
How failures become signals
```

In Function-Factory terms:

> **PromptPacts are the contract layer for context-dependent cognition.**

They sit between:

```text
Telemetry Signals
→ Orientation Assessment
→ PromptPact
→ Context Package
→ Agent Execution
→ Trace
→ Meta-Artifact
```

---

# 1. Why PromptPacts exist

Normal prompts are brittle because they mix:

```text
instruction
context
policy
examples
schema
memory
tool permissions
quality expectations
```

PromptPacts separate these into governed components.

A prompt becomes less like a message and more like a **runtime contract**.

---

# 2. PromptPact definition

A **PromptPact** is a versioned, testable, governed specification that defines how an agent should use context to perform a bounded cognitive function.

```text
PromptPact = ⟨Purpose, Role, Context, Constraints, Tools, Output, Evidence, Evaluation, Failure, Evolution⟩
```

---

# 3. PromptPact schema

```json
{
  "prompt_pact_id": "pp.contract_extractor.v1.0",
  "name": "Contract Extractor PromptPact",
  "factory_version": "ff.v0.5.0",
  "owner_agent": "agent.contract_extractor",
  "purpose": "Extract executable node contracts from a FactoryReadyIntentBundle.",
  "autonomy_level": "L2_propose",

  "context_contract": {
    "required_context": [
      "FactoryReadyIntentBundle",
      "IntentBoundary",
      "FunctionalRequirements",
      "NonFunctionalRequirements",
      "KnownConstraints"
    ],
    "optional_context": [
      "PriorSimilarContracts",
      "ArchitectureCandidate",
      "PolicyBundle"
    ],
    "forbidden_context": [
      "UnverifiedUserProfile",
      "UncitedExternalClaims",
      "UnscopedMemory"
    ],
    "context_window_policy": {
      "priority_order": [
        "current_intent",
        "explicit_constraints",
        "policy",
        "schema",
        "examples",
        "memory"
      ],
      "compression_strategy": "semantic_summary_with_trace_refs",
      "max_context_tokens": 12000
    }
  },

  "instruction_contract": {
    "role": "You are a narrow contract extraction node.",
    "must_do": [
      "Extract atomic node contracts only",
      "Preserve requirement traceability",
      "Flag ambiguity instead of inventing missing details",
      "Return valid JSON matching the output schema"
    ],
    "must_not_do": [
      "Design implementation code",
      "Change the user intent",
      "Add capabilities not supported by evidence"
    ]
  },

  "output_contract": {
    "schema_ref": "schema.node_contract.v1",
    "required_fields": [
      "node_id",
      "purpose",
      "inputs",
      "outputs",
      "preconditions",
      "postconditions",
      "invariants",
      "dependencies",
      "validation_rules",
      "trace_refs"
    ],
    "format": "json"
  },

  "tool_contract": {
    "allowed_tools": [
      "schema_validator",
      "trace_lookup",
      "policy_checker"
    ],
    "forbidden_tools": [
      "production_mutation_tool"
    ]
  },

  "evidence_contract": {
    "minimum_trace_refs_per_contract": 1,
    "unsupported_claim_policy": "mark_as_assumption",
    "citation_required": true
  },

  "failure_contract": {
    "failure_modes": [
      "missing_required_field",
      "invalid_json",
      "unsupported_inference",
      "ambiguous_requirement",
      "policy_conflict"
    ],
    "on_failure": [
      "emit_signal",
      "produce_repair_hint",
      "do_not_mutate_factory"
    ]
  },

  "evaluation_contract": {
    "validators": [
      "json_schema_validation",
      "traceability_check",
      "policy_compliance_check",
      "contract_completeness_check"
    ],
    "success_metrics": {
      "schema_validity_rate": ">= 0.95",
      "traceability_rate": ">= 0.90",
      "unsupported_claim_rate": "<= 0.03"
    }
  },

  "evolution_contract": {
    "telemetry_inputs": [
      "validation_failures",
      "critic_repairs",
      "human_corrections",
      "downstream_graph_errors"
    ],
    "evolution_signals": [
      "PromptDriftSignal",
      "ContractFragilitySignal",
      "EvidenceGapSignal"
    ],
    "allowed_meta_artifacts": [
      "PromptPatch",
      "ContextPolicyPatch",
      "EvaluationHarnessUpdate"
    ]
  }
}
```

---

# 4. Context Engineering layer

Context Engineering is the discipline that decides:

```text
What context enters the prompt
What gets excluded
What gets compressed
What order it appears in
What authority each context item has
How context is traced
How context failure becomes a signal
```

It should be treated as its own factory subsystem.

```text
Context Engineering Pipeline
├── Context Discovery
├── Context Qualification
├── Context Prioritization
├── Context Compression
├── Context Binding
├── Context Packaging
├── Context Validation
└── Context Telemetry
```

---

# 5. Context Package schema

Every agent should receive a structured **Context Package**, not a random blob.

```json
{
  "context_package_id": "ctxpkg_001",
  "for_prompt_pact": "pp.contract_extractor.v1.0",
  "factory_run_id": "run_2026_04_28_001",

  "context_items": [
    {
      "context_id": "ctx.intent_bundle",
      "type": "FactoryReadyIntentBundle",
      "authority": "primary",
      "freshness": "current_run",
      "source_ref": "fri_001",
      "compression": "none",
      "trust_level": "verified"
    },
    {
      "context_id": "ctx.policy_bundle",
      "type": "PolicyBundle",
      "authority": "binding",
      "freshness": "factory_version",
      "source_ref": "policy.factory.v3",
      "compression": "summary_with_clause_refs",
      "trust_level": "verified"
    }
  ],

  "excluded_context": [
    {
      "context_id": "ctx.unscoped_memory",
      "reason": "not authorized by PromptPact"
    }
  ],

  "context_budget": {
    "max_tokens": 12000,
    "used_tokens": 8420,
    "reserved_output_tokens": 2000
  },

  "context_integrity": {
    "required_context_present": true,
    "forbidden_context_absent": true,
    "trace_refs_complete": true
  }
}
```

---

# 6. PromptPacts vs prompts

| Layer       | Old Way                 | PromptPact Way                  |
| ----------- | ----------------------- | ------------------------------- |
| Instruction | Free-form prompt        | Versioned instruction contract  |
| Context     | Dumped into prompt      | Qualified context package       |
| Output      | “Please format as JSON” | Schema-governed output contract |
| Tools       | Implicit                | Tool permission contract        |
| Evidence    | Optional                | Required evidence contract      |
| Failure     | Retry manually          | Emits typed signal              |
| Evolution   | Prompt tweaking         | Governed PromptPatch            |

---

# 7. PromptPact ontology extension

Add these classes to the Orientation Ontology:

```text
PromptPact
├── ContextContract
├── InstructionContract
├── OutputContract
├── ToolContract
├── EvidenceContract
├── FailureContract
├── EvaluationContract
└── EvolutionContract
```

Relationships:

```text
OrientationAgent uses PromptPact
PromptPact requires ContextPackage
ContextPackage contains ContextItem
ContextItem has AuthorityLevel
ContextItem has TrustLevel
PromptPact produces PromptTrace
PromptTrace emits Signal
Signal generates PromptPatch
PromptPatch updates PromptPact
```

---

# 8. Context authority levels

Not all context is equal.

```text
Binding Context
Must be obeyed. Example: policy, schema, user constraint.

Primary Context
Defines the task. Example: intent bundle, PRD, work order.

Supporting Context
Useful but non-binding. Example: prior examples, architecture notes.

Memory Context
Historical pattern. Must be scoped.

Speculative Context
Hypotheses. Must be labeled.

Forbidden Context
Cannot be used.
```

This prevents memory and examples from overpowering current intent.

---

# 9. PromptPact lifecycle

```text
Draft
→ Validate
→ Sandbox
→ Active
→ Monitored
→ Drift Detected
→ Patch Proposed
→ Evaluated
→ Versioned
→ Deprecated
```

Every PromptPact should have:

```text
version
owner
allowed agents
input schemas
context rules
output schemas
failure signals
evaluation metrics
rollback rule
```

---

# 10. Failure signals from PromptPacts

PromptPacts generate factory telemetry.

| Failure                        | Signal                         |
| ------------------------------ | ------------------------------ |
| Missing required context       | ContextGapSignal               |
| Forbidden context included     | ContextContaminationSignal     |
| Output violates schema         | OutputContractViolationSignal  |
| Tool used outside permission   | ToolBoundaryViolationSignal    |
| Unsupported claim              | EvidenceGapSignal              |
| Repeated prompt repairs        | PromptDriftSignal              |
| Context too large              | ContextBudgetPressureSignal    |
| Memory overrode current intent | ContextAuthorityConflictSignal |

---

# 11. Meta-Artifacts generated

PromptPact failures create Meta-Artifacts:

```text
PromptPatch
ContextContractPatch
OutputSchemaPatch
ToolPermissionPatch
EvidenceRulePatch
ContextCompressionPolicy
EvaluationHarnessUpdate
MemoryScopingRule
```

Example:

```json
{
  "meta_artifact_type": "ContextContractPatch",
  "generated_from_signal": "sig_context_gap_001",
  "target": "pp.contract_extractor.v1.0",
  "proposed_change": {
    "add_required_context": ["DependencyMap"],
    "reason": "Downstream graph assembly fails when dependency direction is absent."
  },
  "validation_plan": [
    "replay_failed_traces",
    "schema_validation",
    "downstream_workgraph_integrity_check"
  ],
  "rollback_condition": "token_cost_increases_over_20_percent_without_validation_gain"
}
```

---

# 12. The key architecture

```text
Orientation Agent
   ↓
PromptPact Selection
   ↓
Context Engineering Engine
   ↓
Context Package
   ↓
Prompt Assembly
   ↓
Agent Execution
   ↓
Prompt Trace
   ↓
Signal Derivation
   ↓
Meta-Artifact Generation
   ↓
PromptPact Evolution
```

---

# 13. Minimal implementation objects

For coding agents, define these as first-class files:

```text
/promptpacts
  contract_extractor.promptpact.json
  workgraph_assembler.promptpact.json
  critic.promptpact.json
  verifier.promptpact.json

/context-policies
  context_authority_levels.yaml
  compression_rules.yaml
  memory_scoping_rules.yaml

/schemas
  promptpact.schema.json
  context_package.schema.json
  prompt_trace.schema.json
  prompt_patch.schema.json

/evals
  promptpact_golden_traces.jsonl
  context_integrity_tests.json
```

---

# 14. The crucial design rule

A prompt should never be edited directly.

It should evolve through:

```text
Prompt telemetry
→ Prompt-related signal
→ Orientation assessment
→ PromptPatch / ContextContractPatch
→ Eval replay
→ Versioned PromptPact
```

That gives you self-autonomous prompt evolution without prompt chaos.

---

# Final framing

**PromptPacts turn prompt engineering into governed cognitive contracting.**

**Context Engineering turns context from a blob into a controlled supply chain.**

Together, they become the factory’s self-description layer for agent cognition:

```text
PromptPacts define how agents should think.
Context Engineering defines what agents are allowed to think with.
Telemetry reveals where thinking failed.
Meta-Artifacts govern how thinking evolves.
```
