/**
 * Five typed role-contract interfaces for the synthesis topology.
 *
 * Each role is a typed state-transform with strict read/write/do-not/output
 * constraints derived from PRD-META-FUNCTION-SYNTHESIS constraints section.
 *
 * AC 6, 7, 9, 15, 16
 */

import type { RoleName } from "./types.js"

// ─── Role Contract type ───────────────────────────────────────────────

export interface RoleContract {
  readonly name: RoleName
  readonly reads: readonly string[]
  readonly writes: readonly string[]
  readonly doNot: readonly string[]
  readonly outputArtifact: string
}

// ─── The five role contracts ──────────────────────────────────────────

export const PlannerContract: RoleContract = {
  name: "Planner",
  reads: [
    "specEnvelope",
    "workGraph",
    "targetNodeIds",
    "activeCandidate",
    "repoContract",
    "validationOutcomes",
  ],
  writes: ["plan"],
  doNot: [
    "read or write code",
    "execute tests",
    "access tools beyond its read set",
  ],
  outputArtifact: "plan",
} as const

export const CoderContract: RoleContract = {
  name: "Coder",
  reads: [
    "plan",
    "workGraph",
    "activeCandidate",
    "repoContract",
    "editScopes",
    "repoContext",
  ],
  writes: ["patchProposals"],
  doNot: [
    "evaluate its own output",
    "run tests",
    "modify plan",
  ],
  outputArtifact: "patchProposals",
} as const

export const CriticContract: RoleContract = {
  name: "Critic",
  reads: [
    "plan",
    "patchProposals",
    "workGraph",
    "specEnvelope",
    "repoContract",
  ],
  writes: ["critique"],
  doNot: [
    "modify code",
    "run tests",
    "override the plan",
  ],
  outputArtifact: "critique",
} as const

export const TesterContract: RoleContract = {
  name: "Tester",
  reads: [
    "plan",
    "patchProposals",
    "critique",
    "workGraph",
    "scenarioManifest",
    "toolResults",
  ],
  writes: ["validationPlan", "validationOutcomes"],
  doNot: [
    "modify code",
    "modify the plan",
    "override the critique",
  ],
  outputArtifact: "validationOutcomes",
} as const

export const VerifierContract: RoleContract = {
  name: "Verifier",
  reads: [
    "plan",
    "patchProposals",
    "critique",
    "validationOutcomes",
    "repairLoopCount",
    "maxRepairLoops",
    "scopeViolation",
    "hardConstraintViolation",
    "activeCandidate",
  ],
  writes: ["decision", "requiresHumanApproval", "humanApprovalPayload"],
  doNot: [
    "modify code",
    "run tests",
    "override the critique",
  ],
  outputArtifact: "decision",
} as const

// ─── All contracts ────────────────────────────────────────────────────

export const ALL_ROLE_CONTRACTS: readonly RoleContract[] = [
  PlannerContract,
  CoderContract,
  CriticContract,
  TesterContract,
  VerifierContract,
] as const

/**
 * Look up a contract by role name.
 */
export function getRoleContract(name: RoleName): RoleContract {
  const contract = ALL_ROLE_CONTRACTS.find((c) => c.name === name)
  if (!contract) {
    throw new Error(`Unknown role: ${name}`)
  }
  return contract
}
