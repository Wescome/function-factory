// Gas City fidelity validation — shared types.
//
// Implements IS-GC-FIDELITY-VALIDATION (FV-01..FV-23).
// Consumes the response envelope frozen by IS-GC-RUNTIME-PROVIDER-CONTRACT (AC-RS1).
// Produces the RELEASE payload accepted by the frozen Factory webhook receiver
// (webhook-receiver.ts GasCityCompletionPayload).
//
// This module declares only data shapes. No judgment, no LLM, no I/O.

/** Provider execution status (IS-GC-RUNTIME-PROVIDER-CONTRACT AC-RS1). */
export type ProviderStatus = "completed" | "failed" | "policy_violation" | "timeout" | "cancelled"

/** A single produced file in the response envelope (AC-RS1 artifacts[]). */
export interface Artifact {
  path: string
  size: number
  checksum: string
}

/** Manifest entry state (AC-RS3). */
export type ManifestState = "produced" | "missing" | "extra"

/** One declared-output-to-produced mapping (AC-RS3). */
export interface ManifestEntry {
  name: string
  state: ManifestState
  /** present iff state === "produced"; the externally-verifiable stop condition (FV-09 check 2/4). */
  checksum?: string
}

/** Policy event kinds (AC-LC6). */
export type PolicyEventKind = "allow" | "deny" | "escalation" | "violation"

/** A governance/policy event recorded by the provider (AC-LC6, AC-PI3). */
export interface PolicyEvent {
  kind: PolicyEventKind
  rule?: string
  path?: string
  resolved?: boolean
  /** three-layer write scope source (FF-CODING-ARCHITECTURE §3): "layer1" | "layer2" | "layer3". */
  source_layer?: "layer1" | "layer2" | "layer3"
}

/** Model usage; null for providers that do no inference (AC-RS6). */
export interface ModelUsage {
  model_id?: string
  tokens?: number
  cost?: number
}

/**
 * The provider execution response envelope (AC-RS1).
 * The validator's primary input. Fields the validator does not read are tolerated
 * but ignored (FV-06 — verdict depends only on checked fields).
 *
 * The envelope carries ONLY domain-neutral fields. Step-type-specific evidence (a
 * patch diff, a verifier outcome, a map-content flag, …) is normalized by the
 * domain adapter into `step_outputs` — a flat, opaque-to-the-validator map that
 * the configured per-step-type checks (fidelity-checks.toml) read by dot-path.
 * No coding concept lives in this type.
 */
export interface ResponseEnvelope {
  status: ProviderStatus
  provider_verdict?: unknown
  artifacts?: Artifact[]
  artifact_manifest?: ManifestEntry[]
  policy_events?: PolicyEvent[]
  model_usage?: ModelUsage | null
  runtime_identity?: { provider_id?: string; version?: string; image_digest?: string }
  session_archive_ref?: string | null
  /**
   * Reference to an internal provider verification report (AC-RS1, FV-12, FV-23).
   * Non-null when the provider ran self-verification (e.g. V-slot evaluation).
   * Used by the `verifier_report_present` configured check in fidelity-checks.toml.
   */
  verifier_report_ref?: string | null
  error?: { code?: string; message?: string } | null
  /**
   * Completion provenance (FV-09 check 4). When true, completion was claimed by a
   * provider self-report end-of-turn signal rather than established by the manifest.
   */
  completion_claimed_without_manifest?: boolean
  /**
   * Domain-adapter-normalized per-step evidence (FV-12). The validator never
   * interprets these fields by name; the configured checks (fidelity-checks.toml)
   * read them by `condition.field` dot-path. Keeping them here, not as named
   * fields, is what makes the validator domain-neutral.
   */
  step_outputs?: Record<string, unknown>
}

/** Four-gate taxonomy (FF-CODING-ARCHITECTURE §5.1; FV-13). */
export type GateClass = "preflight" | "revision" | "escalation" | "abort"

/** Binary verdict outcome (FV-05). No third state. */
export type Outcome = "approved" | "revise"

/** A single check's evaluation result (FV-23 records what was evaluated). */
export interface CheckResult {
  name: string
  result: "pass" | "fail" | "not-applicable"
  /** present iff result === "fail": the remediation fragment (FV-14). */
  remediation?: string
  /** present iff result === "fail": governs convergence (FV-13). */
  gate_class?: GateClass
}

/** A single step's verdict (FV-05 output schema). */
export interface StepVerdict {
  outcome: Outcome
  /** "" when approved; actionable instruction when revise (FV-14). */
  remediation: string
  /** gate class of the first failing check; undefined when approved (FV-13). */
  gate_class?: GateClass
  /** audit record of evaluated checks; stays in Gas City (FV-23). */
  checks: CheckResult[]
  /** count of failing checks — the escalate_early issue-count metric (FV-17, Q3). */
  failing_count: number
}

/** Validator inputs (FV-02 pure function signature). */
export interface ValidateInput {
  response: ResponseEnvelope
  /**
   * The raw step name from the formula step definition (FV-11). The validator does
   * NOT classify it into a fixed enum — the configured checks (CheckConfig) match
   * it by regex. Domain-neutral: any string is valid.
   */
  step_name: string
  /**
   * The per-step-type check table loaded from fidelity-checks.toml (FV-12, Q2).
   * Passed in at validate time, never imported at module scope — the validator
   * carries zero domain knowledge of its own.
   */
  check_config: CheckConfig
  /** prior step verdicts in the molecule, in step order (FV-08). */
  prior_step_verdicts: PriorStepVerdict[]
  /** declared output names from the request envelope (AC-RQ1 declared_outputs). */
  declared_outputs: string[]
  /**
   * True iff this step is the molecule terminator that emits the RELEASE webhook.
   * Drives the universal `all_prior_steps_approved` pre-flight (FV-08), which reads
   * prior_step_verdicts (not step_outputs) and therefore stays in code, not config.
   * Domain-neutral: "is this the last/release step" is a formula property, not a
   * coding concept.
   */
  is_release_step?: boolean
}

/** A predicate over a `step_outputs` field (FV-12). Parsed from fidelity-checks.toml. */
export interface CheckCondition {
  /** dot-path into step_outputs. */
  field: string
  /** one of the documented predicates (see fidelity-checks.toml header). */
  predicate: string
}

/** One configured per-step-type check (FV-12). Mirrors a [[check]] table in fidelity-checks.toml. */
export interface CheckSpec {
  /** case-insensitive regex matched against the step name (FV-11). */
  step_pattern: string
  check_id: string
  gate_class: GateClass
  condition: CheckCondition
  remediation: string
}

/** The loaded per-step-type check table (FV-12, Q2 — "lives in city configuration"). */
export interface CheckConfig {
  check: CheckSpec[]
}

/** A prior step's verdict for FV-08 molecule-AND. */
export interface PriorStepVerdict {
  /** step index in the molecule (lowest = earliest); FV-08 earliest-failing rule. */
  step_index: number
  step_name: string
  outcome: Outcome
  remediation: string
  gate_class?: GateClass
}
