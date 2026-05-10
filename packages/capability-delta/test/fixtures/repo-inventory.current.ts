import type { RepoInventory } from "../../src/types.js"

/**
 * Grounded in the current repo architecture audit.
 */
export const repoInventoryCurrent: RepoInventory = {
  packages: {
    "@factory/schemas": "implemented",
    "@factory/compiler": "implemented",
    "@factory/coverage-gates": "implemented",
    "@factory/runtime": "stub",
    "@factory/assurance-graph": "stub",
    "@factory/harness-bridge": "missing"
  },
  schemas: [
    "ExternalSignal",
    "Pressure",
    "BusinessCapability",
    "FunctionProposal",
    "IntentSpecification",
    "RequirementAtom",
    "Contract",
    "Invariant",
    "Dependency",
    "ValidationSpec",
    "ExecutableSpecification",
    "TrustSignal",
    "Trajectory",
    "ProblemFrame",
    "Incident",
    "CoherenceVerificationReport",
    "FidelityVerificationReport",
    "PersistenceVerificationReport",
    "CommitTriageReport"
  ],
  artifactCounts: {
    signals: 1,
    pressures: 4,
    capabilities: 4,
    functions: 4,
    prds: 4,
    workgraphs: 4,
    coverageReports: 9,
    deltas: 0
  },
  runners: [
    "compiler",
    "gate-1"
  ],
  tests: {
    schemas: 39,
    compiler: 29,
    coverageGates: 50,
    runtime: 0,
    assuranceGraph: 0,
    capabilityDelta: 0
  },
  notes: [
    "Fidelity Verification and Persistence Verification report schemas exist without runnable implementations.",
    "ArchitectureCandidate schema and AC-* artifact family are absent.",
    "CapabilityDelta engine does not yet exist."
  ]
}
