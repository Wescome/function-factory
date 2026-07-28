/**
 * nodes.ts — THE SE-ONTO ENTITIES.
 *
 * KEEL's domain nouns, each a specialization of the lineage contract
 * (contract.ts). These content shapes encode what M0 confirmed on real workerd
 * (D5/D7/D8/D9); the Decision each clause serves is noted inline.
 */

import type { ContentHash, LineageNode } from "./contract";
import type { ErrorClass } from "../effect/errors";
import type { BehaviorDisposition } from "../disposition/ledger";

/** PLAYBOOK-KEEL-FAMILY-001 (R4, B.1): a typed vocabulary of `property`
 *  relation shapes, each carrying exactly what its probe needs
 *  (compileMetamorphic, suite.ts) -- a family must be RUNNABLE, not just
 *  nameable (OD-R4-1/OD-R4-2). Every expression field (`expected`,
 *  `transform`) is a JS boolean/value expression over `input`, the SAME
 *  operand convention `applicability`/`invalidators`/`metamorphic.relation`
 *  already use.
 *
 *  Design decisions disclosed (the playbook gives the shape, not every
 *  probe detail): `expected`/`transform` reference `input` only (the
 *  family's probe supplies `output` itself -- see suite.ts); `invariance`
 *  and `idempotence` each call `compute` a second time (transformed input /
 *  the first output fed back in) and compare structurally (JSON-stable);
 *  `monotonicity` sorts the probes by `input` first, then walks ADJACENT-ON-
 *  SORTED (equivalent to checking every pair, not just consecutive ones, for
 *  a total order -- a corrected design: comparing adjacent-in-GIVEN-order
 *  without sorting first can miss a violation between two probes that
 *  weren't adjacent in the order they happened to arrive in, e.g. probes
 *  [3, 1, 2] would never directly compare 2 and 3); `bounded`'s `baseline`
 *  means "no worse than" == `output >= baseline` (higher-is-better, undirected
 *  in the brief -- disclosed default). */
export type PropertyFamily =
  | { readonly kind: "equality"; readonly expected?: string }
  | { readonly kind: "invariance"; readonly transform: string }
  | { readonly kind: "monotonicity"; readonly order: "asc" | "desc" }
  | { readonly kind: "idempotence" }
  | { readonly kind: "bounded"; readonly lo?: number; readonly hi?: number; readonly baseline?: number };

// ---------------------------------------------------------------------------
// Specification — the normalized intent (INTENT state). Admission is idempotent
// on this node's id (D7).
// ---------------------------------------------------------------------------
export interface AcceptanceCriterion {
  readonly id: string;                 // e.g. "A1"
  readonly statement: string;
  readonly kind: "example" | "property";
  /** PLAYBOOK-KEEL-DISPOSITION-001 (A.1): which behavior this criterion
   *  grounds -- the behavior ledger (behavior-ledger.port.ts) classifies
   *  BY this ref, not by criterion id (many criteria may ground the same
   *  behavior). Additive/optional: absent, this criterion is untouched by
   *  the disposition ledger (Track C, byte-for-byte). */
  readonly behaviorRef?: string;
  /** PLAYBOOK-KEEL-RELATION-SCOPE-001 (R1), `property`-only, all additive/
   *  optional -- an `example` criterion is a single case, not scoped:
   *
   *  - `preservationSet`: variable names this relation claims to preserve.
   *    Descriptive + inherited (⊇ parent's, CARRIED like `spanning`); the
   *    oracle draws no verdict from it yet -- enforcement ("did these
   *    change") is R3 (OD-R1-4).
   *  - `applicability`: JS boolean expressions, evaluated over the SAME
   *    `(input, output)` operands metamorphic/composes/seams relations
   *    already use (OD-R1-1) -- ALL must hold for this relation to apply to
   *    a probed input; false excludes that input from the tally
   *    (`not-applicable`). Inherits ⊆ parent's (NARROWS, mirrors
   *    `attenuates`'s connectors, OD-R1-3) -- a child may apply to fewer
   *    cases than its parent, never more.
   *  - `invalidators`: JS boolean expressions, same operands; ANY firing
   *    makes a probed input `inconclusive` (surfaced) rather than
   *    evaluated. Inherits ⊇ parent's (may only GROW, mirrors `forbids` /
   *    `inheritsProhibitions`) -- a child may add an invalidator, never
   *    drop one the parent declared.
   *
   *  Admittability (OD-R1-3): a `property` criterion declaring ANY of these
   *  three but no `applicability` is a `freezeGate` hard-reject
   *  (`isScopeAdmittable`, spec-loop/gate.ts). An UNSCOPED relation (none of
   *  these fields) runs unconditionally, exactly as before this playbook
   *  (Track C). */
  readonly preservationSet?: readonly string[];
  readonly applicability?: readonly string[];
  readonly invalidators?: readonly string[];
  /** PLAYBOOK-KEEL-FAMILY-001 (R4), `property`-only, additive/opt-in
   *  (INV-R4-ADDITIVE): a typed relation shape alongside R1's scope.
   *  Absent -> the relation is untyped/opaque re-probed code, exactly as
   *  before this playbook (`compileMetamorphic`'s existing path, Track C).
   *  When present, it is the *evaluate* step inside R1's per-probe order
   *  (applicability -> invalidator -> evaluate, B.3) and its disposition
   *  (via `behaviorRef`) constrains which family is admissible
   *  (`freezeGate`'s `familyAdmissibleForDisposition`, closing D1's
   *  OD-DISP-4 -- was a surfaced warning, now a hard reject). */
  readonly family?: PropertyFamily;
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
  /** Which PARENT goal-clause this derived spec serves (PLAYBOOK-KEEL-COVERAGE:
   *  corrected from "root" — `templateDerive` writes it from `parent.acceptance`,
   *  and the gate's anchor check (`hasGoalMapping`) resolves it against the
   *  parent, not the root. At depth 1 parent === root so this was never
   *  exercised; deeper, only parent-anchoring is correct — attenuation is
   *  already transitive, so parent-anchoring composes up to the root anyway).
   *  Mandatory for derived specs (makes positive-serve inspectable); absent on
   *  human-root specs. */
  readonly servesClause?: string;
  /** Derivation provenance (INV-SPEC-PROVENANCE): the parent (attenuation anchor)
   *  and the human-authorized root (prohibition + authority anchor). */
  readonly derivedFrom?: { readonly parent: string; readonly root: string };
  /** PLAYBOOK-KEEL-SPANNING (INV-DECOMP-3): ids of THIS spec's OWN acceptance
   *  clauses that are cross-cutting — a positive obligation every child this
   *  spec spans must carry, the exact dual of `forbids` (which may only grow
   *  downward; this may only be CARRIED downward, never dropped). Absent/empty
   *  means no spanning clauses declared here — never inferred. Scope is
   *  fail-closed: an unscoped (absent-scope) spanning clause is inherited by
   *  every child, never by none (OD-DECOMP-3). Deriver-declared, gate-checked
   *  (OD-DECOMP-2) — `templateDerive` carries these into every child's
   *  `acceptance`; `inheritsSpanning` (gate.ts) rejects a child that drops
   *  one. Presence only — whether a child's RESULT satisfies the spanning
   *  clause is INV-DECOMP-6, a separate, composition-time build. */
  readonly spanning?: readonly string[];
  /** Opt-in: this spec's acceptance criteria are INDEPENDENT and may be
   *  decomposed into per-criterion sub-specs (OD-6a-6-adjacent). Absent/false =>
   *  no decomposition. An unsound split (coupled criteria) still fails SAFE — the
   *  isolated sub-goals escalate, never false-accept — so this is a
   *  correctness/efficiency opt-in, not a safety gate. */
  readonly decomposable?: boolean;
  /** PLAYBOOK-KEEL-RUN-SUITE-001 (B.3, INV-RUN-ROUTE-MEASURED): a real
   *  repo's declared test command -- presence routes verification to the
   *  Sandbox instead of the self-contained oracle (OD-RUN-4). Measured from
   *  the spec, never a model judgment: the router reads this field, it
   *  never infers "should this run in a container" from the generated code
   *  or the model's own claim. Absent/undefined -> the oracle, unchanged
   *  (INV-RUN-ORACLE-PRIMARY, D.6). */
  readonly runSuite?: { readonly repo: string; readonly testCommand?: string };
  /** PLAYBOOK-KEEL-GROUNDING-001 (Track C): opt-in, additive, like
   *  `runSuite?` above -- presence seats the grounding gate before
   *  `generate()` (run.ts). Absent/false -> the loop runs exactly as
   *  today, byte-for-byte (D.6). */
  readonly grounding?: boolean;
  /** PLAYBOOK-KEEL-DISPOSITION-001 (B.1/B.5): this spec's OWN carried
   *  classification for the behaviors its criteria reference via
   *  `behaviorRef` -- mirrors `spanning`'s carried-set pattern exactly
   *  (A.2): a derived child that doesn't carry its own entry for a
   *  behaviorRef inherits the parent's, fail-closed (INV-DISP-CARRIED,
   *  `inheritsDisposition` in spec-loop/gate.ts) -- never re-guessed. Local
   *  entries here are checked before the external BehaviorLedgerPort.
   *  `authority` only matters for `intentionally-change` (B.3): the root
   *  spec id/hash authorized to decide it. */
  readonly behaviorDispositions?: readonly {
    readonly behaviorRef: string;
    readonly disposition: BehaviorDisposition;
    readonly authority?: string;
    readonly rationale?: string;
  }[];
}
export type Specification = LineageNode<"Specification", SpecificationContent>;

// ---------------------------------------------------------------------------
// Action — model-generated code-as-action (GENERATE state).
// ---------------------------------------------------------------------------
export interface ActionContent {
  readonly code: string;
  readonly connectors: readonly string[];
  readonly attempt: number;            // 1-based
  /** BRIEF-KEEL-SKILL-001: which skill rows (id@version) were selected to
   *  produce THIS action, if any — additive/optional, exactly like
   *  `forbids?`/`response?` were added elsewhere. Frozen at GENERATE time
   *  (INV-SKILL-FROZEN): replay reads this back and never re-selects. */
  readonly skills?: readonly string[];
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
  /** OD-EFFECT-6: a classified connector-call error, if the execution adapter
   *  could classify one (see effect/errors.ts). Additive/optional — absent
   *  today for every existing connector, so no current path's behavior
   *  changes; decide() only acts on this when it's actually populated. */
  readonly terminalError?: ErrorClass;
  /** D5: structural evidence the sandbox had no ambient network. */
  readonly egress: "none" | "connector-only";
}
export type ExecutionTrace = LineageNode<"ExecutionTrace", ExecutionTraceContent>;

// ---------------------------------------------------------------------------
// Verdict — the independent Verifier's judgment on a trace (VERIFY state).
// Inline verdict confirmed viable (D2, S5 green).
// ---------------------------------------------------------------------------
/** PLAYBOOK-KEEL-VERDICT-SET-001 (L1, abstention half): widened so abstention
 *  is honest -- `inconclusive` (evidence incomplete / can't judge; the
 *  fail-closed default until R1's applicability exists) and `not-applicable`
 *  (a relation's own applicability says it doesn't apply to this case --
 *  R1-gated, unreachable until then). `escalate` is NOT retired: the
 *  grounding gate's own pre-generation verdict composition
 *  (grounding/grader.ts's `aggregateGate`, PLAYBOOK-KEEL-GROUNDING-001, out
 *  of scope for this playbook) legitimately still emits it. Going forward,
 *  the POST-EXECUTION oracles (SuiteOracleAdapter, SandboxOracleAdapter)
 *  emit `inconclusive` for "can't judge" instead of `escalate` -- never a
 *  false fail (an unverifiable criterion is not the same fact as a failed
 *  one) and never a silent pass. */
export type VerdictOutcome = "pass" | "fail" | "escalate" | "inconclusive" | "not-applicable";

export interface VerdictContent {
  readonly outcome: VerdictOutcome;
  /** Per-criterion results keyed by AcceptanceCriterion.id. Widened the same
   *  way as `outcome` (L1) -- `inconclusive`/`not-applicable` are now
   *  first-class per-criterion facts, not squashed into a false "fail". */
  readonly results: Readonly<Record<string, "pass" | "fail" | "inconclusive" | "not-applicable">>;
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
