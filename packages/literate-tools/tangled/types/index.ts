// Tangled from specs/reference/literate-canonical-reference.md
// Context: types
// Blocks: 8
// Generated: 2026-04-24T15:11:44.397Z
// DO NOT EDIT — edit the literate reference and re-run tangle.
// --- Block from line 116 (Part I -- What Is a Function?) ---
/**
 * The canonical unit of the Function Factory.
 * Aggregate root per whitepaper v4 Section 2.
 *
 * Every artifact the Factory produces is a Function.
 * Every artifact the Factory maintains is a Function.
 * When Functions degrade, the Factory produces new Functions.
 */
interface Function {
  /** What it is for, in compressed human-readable form. */
  intent: string;

  /** Signature, preconditions, postconditions, behavioral promises. */
  contract: Contract;

  /** Persistent truths it must preserve across all invocations. */
  invariants: Invariant[];

  /** Tests, scenarios, and property checks that prove contract and invariants hold. */
  validations: Validation[];

  /** The WorkGraph of nodes and edges that realizes it. */
  implementation: WorkGraph | null;

  /** Health, trust, freshness, incident links. */
  runtime_indicators: RuntimeIndicators;

  /** Current position in the lifecycle. */
  status: FunctionLifecycleState;
}

// --- Block from line 182 (Part I -- What Is a Function?) ---
/**
 * The eight lifecycle states of a Function.
 * Ordered by typical progression, not by enum value.
 */
type FunctionLifecycleState =
  | "designed"
  | "planned"
  | "in_progress"
  | "produced"
  | "accepted"
  | "monitored"
  | "regressed"
  | "retired";

// --- Block from line 201 (Part I -- What Is a Function?) ---
/**
 * A lifecycle transition: from one state to another,
 * triggered by a named event, guarded by a named condition.
 *
 * Naming principle 2: the trigger and guard describe what happens
 * in plain language. "Gate 2" becomes "scenarios_cover_invariants".
 */
interface LifecycleTransition {
  from: FunctionLifecycleState;
  to: FunctionLifecycleState;
  trigger: string;
  guard: string;
  responsible_context: string;
}

/**
 * The complete transition table for Function lifecycle.
 * This array IS the specification. If a transition fires that
 * is not in this array, the implementation is wrong.
 */
const LIFECYCLE_TRANSITIONS: LifecycleTransition[] = [
  {
    from: "designed",
    to: "planned",
    trigger: "architect_approves_function",
    guard: "function_proposal_has_valid_invariants_and_contracts",
    responsible_context: "Governance",
  },
  {
    from: "planned",
    to: "in_progress",
    trigger: "dark_factory_admits_workgraph",
    guard: "candidate_passes_admissibility_filter",
    responsible_context: "Execution",
  },
  {
    from: "in_progress",
    to: "produced",
    trigger: "dark_factory_completes_execution",
    guard: "verifier_verdict_is_pass",
    responsible_context: "Execution",
  },
  {
    from: "produced",
    to: "accepted",
    trigger: "acceptance_review_passes",
    guard: "scenarios_cover_invariants",
    responsible_context: "Assurance",
  },
  {
    from: "accepted",
    to: "monitored",
    trigger: "function_deployed_to_runtime",
    guard: "deployment_confirmed_and_telemetry_flowing",
    responsible_context: "Observability",
  },
  {
    from: "monitored",
    to: "regressed",
    trigger: "trusted_evidence_invalidated",
    guard: "invariant_health_below_threshold_or_critical_invariant_broken",
    responsible_context: "Assurance",
  },
  {
    from: "monitored",
    to: "regressed",
    trigger: "evidence_base_lost",
    guard: "evidence_base_intact_fails",
    responsible_context: "Assurance",
  },
  {
    from: "regressed",
    to: "in_progress",
    trigger: "remediation_initiated",
    guard: "new_candidate_selected_or_existing_candidate_patched",
    responsible_context: "Execution",
  },
  {
    from: "regressed",
    to: "retired",
    trigger: "architect_decides_to_retire",
    guard: "no_dependent_functions_in_monitored_state",
    responsible_context: "Governance",
  },
  // Any state can transition to retired by architect decision
  {
    from: "designed",
    to: "retired",
    trigger: "architect_decides_to_retire",
    guard: "always_true",
    responsible_context: "Governance",
  },
  {
    from: "planned",
    to: "retired",
    trigger: "architect_decides_to_retire",
    guard: "always_true",
    responsible_context: "Governance",
  },
  {
    from: "produced",
    to: "retired",
    trigger: "architect_decides_to_retire",
    guard: "always_true",
    responsible_context: "Governance",
  },
  {
    from: "accepted",
    to: "retired",
    trigger: "architect_decides_to_retire",
    guard: "always_true",
    responsible_context: "Governance",
  },
];

// --- Block from line 336 (Part I -- What Is a Function?) ---
/** CANONICAL-ONLY. Signature + preconditions + postconditions. */
interface Contract {
  id: string;
  signature: string;
  preconditions: string[];
  postconditions: string[];
  source_refs: SourceRef[];
}

// --- Block from line 351 (Part I -- What Is a Function?) ---
/** CANONICAL-ONLY. Persistent truth with runtime detection. */
interface Invariant {
  id: string;
  description: string;
  detector_spec: DetectorSpec;
  source_refs: SourceRef[];
}

/** CANONICAL-ONLY. Per-invariant runtime detector. */
interface DetectorSpec {
  /** Events that constitute a direct violation. */
  direct_rules: string[];
  /** Events that raise suspicion but are not violations. */
  warning_rules: string[];
  /** Telemetry and audit streams the detector reads. */
  evidence_sources: string[];
  /** How violations map to lifecycle transitions. */
  regression_policy: string;
}

// --- Block from line 377 (Part I -- What Is a Function?) ---
/** CANONICAL-ONLY. Test/scenario with backmap to what it proves. */
interface Validation {
  id: string;
  description: string;
  /** Backmaps to atoms, contracts, or invariants. */
  covers: SourceRef[];
  source_refs: SourceRef[];
}

// --- Block from line 393 (Part I -- What Is a Function?) ---
/** CANONICAL-ONLY. Compiled implementation graph. */
interface WorkGraph {
  id: string; // WG-*
  function_id: string;
  nodes: WorkGraphNode[];
  edges: WorkGraphEdge[];
  source_refs: SourceRef[];
}

/** CANONICAL-ONLY. A node in the WorkGraph. */
interface WorkGraphNode {
  id: string;
  type: NodeType;
  label: string;
}

/** CANONICAL-ONLY. An edge in the WorkGraph. */
interface WorkGraphEdge {
  from: string;
  to: string;
  label: string;
}

/** Nine WorkGraph node types. From ratified decisions lines 210-220. */
type NodeType =
  | "interface"
  | "domain_model"
  | "module"
  | "adapter"
  | "migration"
  | "test"
  | "docs"
  | "infra"
  | "refactor";

// --- Block from line 435 (Part I -- What Is a Function?) ---
/** Lineage reference string. From ratified decisions line 338. */
type SourceRef = string;
