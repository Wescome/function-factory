/**
 * nodes.ts — THE SE-ONTO ENTITIES.
 *
 * KEEL's domain nouns, each a specialization of the lineage contract
 * (contract.ts). These content shapes encode what M0 confirmed on real workerd
 * (D5/D7/D8/D9); the Decision each clause serves is noted inline.
 */

import type { ContentHash, LineageNode } from "./contract";

// ---------------------------------------------------------------------------
// Specification — the normalized intent (INTENT state). Admission is idempotent
// on this node's id (D7).
// ---------------------------------------------------------------------------
export interface AcceptanceCriterion {
  readonly id: string;                 // e.g. "A1"
  readonly statement: string;
  readonly kind: "example" | "property";
}

export interface SpecificationContent {
  readonly intent: string;
  readonly acceptance: readonly AcceptanceCriterion[];
  /** D5: connectors-only ceiling. The permitted action space. */
  readonly connectors: readonly string[];
  readonly capabilityCeiling: "connectors-only";
  /** Which connectors require human approval before their effect runs (D8). */
  readonly approvalGated: readonly string[];
  /** Caller-configurable, set empirically per task (not inherited). */
  readonly attemptBudget: number;
  /** Reference to the frozen oracle suite the Verifier runs. */
  readonly oracleRef: string;

  // --- Phase 6a spec-loop (additive, optional; human-root specs omit these) ---
  /** Goal-level prohibitions (INV-SPEC-INTENT-ANCHORED, negative half). Separate
   *  from capability: a connector may be in the ceiling yet forbidden here. A
   *  derived spec must inherit all of its root's forbids (the set can only grow). */
  readonly forbids?: readonly string[];
  /** Which root goal-clause this derived spec serves. Mandatory for derived specs
   *  (makes positive-serve inspectable); absent on human-root specs. */
  readonly servesClause?: string;
  /** Derivation provenance (INV-SPEC-PROVENANCE): the parent (attenuation anchor)
   *  and the human-authorized root (prohibition + authority anchor). */
  readonly derivedFrom?: { readonly parent: string; readonly root: string };
  /** Opt-in: this spec's acceptance criteria are INDEPENDENT and may be
   *  decomposed into per-criterion sub-specs (OD-6a-6-adjacent). Absent/false =>
   *  no decomposition. An unsound split (coupled criteria) still fails SAFE — the
   *  isolated sub-goals escalate, never false-accept — so this is a
   *  correctness/efficiency opt-in, not a safety gate. */
  readonly decomposable?: boolean;
}
export type Specification = LineageNode<"Specification", SpecificationContent>;

// ---------------------------------------------------------------------------
// Action — model-generated code-as-action (GENERATE state).
// ---------------------------------------------------------------------------
export interface ActionContent {
  readonly code: string;
  readonly connectors: readonly string[];
  readonly attempt: number;            // 1-based
}
export type Action = LineageNode<"Action", ActionContent>;

// ---------------------------------------------------------------------------
// ExecutionTrace — the logged result of running an Action once (EXECUTE state).
// Shape mirrors codemode's real ProxyToolOutput tagged union (confirmed M0).
// ---------------------------------------------------------------------------
export interface ConnectorCall {
  readonly seq: number;
  readonly connector: string;
  readonly method: string;
  readonly args: unknown;
  /** The recorded response (E-A / INV-TRACE-COMPLETE). Additive, optional:
   *  pending calls have none; completed calls record what the connector returned
   *  — the runtime-discovered fact the model lacked at generation. */
  readonly response?: unknown;
}
export interface PendingAction extends ConnectorCall {
  readonly executionId: string;
}
export type ExecutionStatus = "completed" | "paused" | "error";

export interface ExecutionTraceContent {
  readonly executionId: string;
  readonly status: ExecutionStatus;
  /** Every connector call logged, in order — the replay log (D8). */
  readonly calls: readonly ConnectorCall[];
  /** Present iff status === "paused": approval-gated calls awaiting a human. */
  readonly pending?: readonly PendingAction[];
  readonly result?: unknown;
  readonly error?: string;
  /** D5: structural evidence the sandbox had no ambient network. */
  readonly egress: "none" | "connector-only";
}
export type ExecutionTrace = LineageNode<"ExecutionTrace", ExecutionTraceContent>;

// ---------------------------------------------------------------------------
// Verdict — the independent Verifier's judgment on a trace (VERIFY state).
// Inline verdict confirmed viable (D2, S5 green).
// ---------------------------------------------------------------------------
export type VerdictOutcome = "pass" | "fail" | "escalate";

export interface VerdictContent {
  readonly outcome: VerdictOutcome;
  /** Per-criterion results keyed by AcceptanceCriterion.id. */
  readonly results: Readonly<Record<string, "pass" | "fail">>;
  readonly evidence: unknown;
  readonly oracleRef: string;
  readonly attempt: number;
  readonly ms: number;
}
export type Verdict = LineageNode<"Verdict", VerdictContent>;

// ---------------------------------------------------------------------------
// Amendment — carries verdict evidence into the next attempt (AMEND state).
// ---------------------------------------------------------------------------
export interface AmendmentContent {
  readonly from: ContentHash;          // the failing Verdict
  readonly carries: readonly string[]; // evidence keys carried forward
  readonly attempt: number;            // the attempt this amendment opens
}
export type Amendment = LineageNode<"Amendment", AmendmentContent>;

// ---------------------------------------------------------------------------
// Decision + Disposition — governance (Part D). A Disposition AUTHORIZES.
// ---------------------------------------------------------------------------
export interface DecisionContent {
  readonly question: string;
  readonly options: readonly string[];
  readonly state: "open" | "resolved";
}
export type Decision = LineageNode<"Decision", DecisionContent>;

export interface DispositionContent {
  readonly decision: string;           // the chosen option
  readonly rationale: string;
  readonly by: string;
  readonly at: string;                 // ISO-8601
  readonly authorizes: string;         // what this unblocks
  readonly conditions?: readonly string[];
}
export type Disposition = LineageNode<"Disposition", DispositionContent>;

// ---------------------------------------------------------------------------
export type AnyNode =
  | Specification
  | Action
  | ExecutionTrace
  | Verdict
  | Amendment
  | Decision
  | Disposition;

export type NodeKind = AnyNode["kind"];
