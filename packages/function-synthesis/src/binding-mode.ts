/**
 * Pluggable binding-mode interface for function synthesis.
 *
 * Binding modes are adapters that map role contracts onto concrete execution
 * backends. No binding-mode-specific logic exists in the contract layer.
 *
 * AC 14, 15
 */

import type { ArchitectureCandidate, WorkGraph } from "@factory/schemas"
import type { RoleContract } from "./role-contracts.js"
import type {
  SynthesisTraceLog,
  PatchProposal,
  ValidationOutcome,
  VerifierDecision,
  RoleIterationRecord,
} from "./types.js"

// ─── Binding Mode Output ──────────────────────────────────────────────

export interface BindingModeOutput {
  readonly patchProposals: readonly PatchProposal[]
  readonly validationOutcomes: readonly ValidationOutcome[]
  readonly verifierDecision: VerifierDecision
  readonly roleIterations: readonly RoleIterationRecord[]
  readonly requiresHumanApproval: boolean
  readonly humanApprovalReason?: string | undefined
  readonly scopeViolation: boolean
  readonly hardConstraintViolation: boolean
}

// ─── Binding Mode Interface ───────────────────────────────────────────

export interface BindingMode {
  readonly name: string
  execute(
    workGraph: WorkGraph,
    candidate: ArchitectureCandidate,
    contracts: readonly RoleContract[],
    context: BindingModeContext,
  ): Promise<BindingModeOutput>
}

// ─── Context passed to binding modes per iteration ────────────────────

export interface BindingModeContext {
  readonly repairLoopCount: number
  readonly maxRepairLoops: number
  readonly resampleBranchCount: number
  readonly maxResampleBranches: number
  readonly previousPatchProposals?: readonly PatchProposal[] | undefined
  readonly previousCritique?: string | undefined
}

// ─── Stub Binding Mode (AC 5 — deterministic testing) ─────────────────

export interface StubBindingModeConfig {
  readonly patchProposals: readonly PatchProposal[]
  readonly validationOutcomes: readonly ValidationOutcome[]
  /** Sequence of decisions for successive calls. Cycles if exhausted. */
  readonly verifierDecisions: readonly VerifierDecision[]
  readonly roleIterations?: readonly RoleIterationRecord[]
  readonly scopeViolation?: boolean
  readonly hardConstraintViolation?: boolean
  readonly requiresHumanApproval?: boolean
  readonly humanApprovalReason?: string | undefined
}

export class StubBindingMode implements BindingMode {
  readonly name = "stub"
  private callCount = 0

  constructor(private readonly config: StubBindingModeConfig) {}

  async execute(
    _workGraph: WorkGraph,
    _candidate: ArchitectureCandidate,
    _contracts: readonly RoleContract[],
    _context: BindingModeContext,
  ): Promise<BindingModeOutput> {
    const decisionIndex = this.callCount % this.config.verifierDecisions.length
    const decision = this.config.verifierDecisions[decisionIndex]
    if (decision === undefined) {
      throw new Error("StubBindingMode: no verifier decisions configured")
    }
    this.callCount++

    return {
      patchProposals: this.config.patchProposals,
      validationOutcomes: this.config.validationOutcomes,
      verifierDecision: decision,
      roleIterations: this.config.roleIterations ?? [],
      requiresHumanApproval: this.config.requiresHumanApproval ?? false,
      humanApprovalReason: this.config.humanApprovalReason,
      scopeViolation: this.config.scopeViolation ?? false,
      hardConstraintViolation: this.config.hardConstraintViolation ?? false,
    }
  }

  /** Reset call counter for replay testing. */
  reset(): void {
    this.callCount = 0
  }
}
