// Knowing-State Prosthesis SDK — generic interface
// SPEC-MEDIATION-AGENT-DO-001 §8, DECISIONS N+3
//
// Type parameters:
//   PolicyContent   — domain-specific policy/specification content
//   TrustContent    — domain-specific trust/verdict state
//   ExecutionContent — domain-specific execution record payload
//   OutcomeContent  — domain-specific outcome record payload
//
// Instantiations:
//   Factory repo DO: Policy=ArchitectureDecisionBead, Trust=PatternTrustBead,
//                    Execution=CommitBead, Outcome=BuildOutcomeBead
//   ComeFlow commerce: Policy=OrgPreferenceBead, Trust=VendorTrustBead,
//                      Execution=PurchaseBead, Outcome=OutcomeBead

import type { BeadId, KnowingState, AmendmentBead } from './types.js'

export class SessionNotInitialized extends Error {
  constructor(message = 'retrieveKnowingState() must be called before execution') {
    super(message)
    this.name = 'SessionNotInitialized'
  }
}

export interface KnowingStateSDK<
  PolicyContent,
  TrustContent,
  ExecutionContent,
  OutcomeContent,
> {
  /**
   * I2 — Retrieval enforcement.
   * Must be called before any execution write.
   * Throws SessionNotInitialized if called without valid session context.
   */
  retrieveKnowingState(category: string): Promise<KnowingState<TrustContent>>

  /**
   * Write an execution record. The executing agent is the primary writer.
   * Returns the BeadId of the written ExecutionBead.
   */
  writeExecutionBead(payload: ExecutionContent): Promise<BeadId>

  /**
   * Write an outcome record. Closes the execution loop.
   * Returns the BeadId of the written OutcomeBead.
   */
  writeOutcomeBead(
    executionBeadId: BeadId,
    outcome: OutcomeContent
  ): Promise<BeadId>

  /**
   * Retrieve open amendments (proposed modifications to the governing policy).
   * Consumed by the Commissioning Agent / governance layer.
   */
  getOpenAmendments(): Promise<AmendmentBead<PolicyContent>[]>
}
