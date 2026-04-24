/**
 * Shared test fixtures for function-synthesis tests.
 */

import type { ArchitectureCandidate, WorkGraph } from "@factory/schemas"
import type { StubBindingModeConfig } from "../src/binding-mode.js"
import type {
  PatchProposal,
  ValidationOutcome,
  RoleIterationRecord,
  InferenceConfig,
  ConvergencePolicy,
} from "../src/types.js"
import type { SynthesisConfig } from "../src/orchestrate.js"

// ─── Work Graph with 3+ nodes (AC 1) ─────────────────────────────────

export function makeWorkGraph(overrides?: Partial<WorkGraph>): WorkGraph {
  return {
    id: "WG-TEST-SYNTH-001",
    source_refs: ["PRD-TEST-001"],
    explicitness: "explicit" as const,
    rationale: "Test work graph for synthesis",
    functionId: "FP-TEST-FUNC-001",
    nodes: [
      { id: "node-1", type: "execution", title: "Implement core module" },
      { id: "node-2", type: "execution", title: "Implement validation layer" },
      { id: "node-3", type: "evidence", title: "Implement test suite" },
    ],
    edges: [
      { from: "node-1", to: "node-2" },
      { from: "node-2", to: "node-3" },
    ],
    ...overrides,
  }
}

// ─── Architecture Candidate ───────────────────────────────────────────

export function makeCandidate(overrides?: Partial<ArchitectureCandidate>): ArchitectureCandidate {
  return {
    id: "AC-TEST-CAND-001",
    source_refs: ["PRD-TEST-001", "WG-TEST-SYNTH-001"],
    explicitness: "explicit" as const,
    rationale: "Test architecture candidate",
    sourcePrdId: "PRD-TEST-001",
    sourceWorkGraphId: "WG-TEST-SYNTH-001",
    candidateStatus: "selected" as const,
    topology: {
      shape: "linear_chain" as const,
      summary: "Linear five-role topology",
    },
    modelBinding: {
      bindingMode: "fixed" as const,
      summary: "Fixed model binding for deterministic testing",
    },
    toolPolicy: {
      mode: "allowlist" as const,
      summary: "Allowlist tool policy",
    },
    convergencePolicy: {
      mode: "gated_iteration" as const,
      summary: "Gated iteration with repair loops",
    },
    ...overrides,
  }
}

// ─── Patch Proposals ──────────────────────────────────────────────────

export function makePatchProposals(): PatchProposal[] {
  return [
    {
      targetPath: "src/core.ts",
      content: "export function core() { return 'core'; }",
      workGraphNodeId: "node-1",
      rationale: "Implements core module from node-1",
    },
    {
      targetPath: "src/validation.ts",
      content: "export function validate() { return true; }",
      workGraphNodeId: "node-2",
      rationale: "Implements validation from node-2",
    },
    {
      targetPath: "test/core.test.ts",
      content: "import { test } from 'vitest'; test('core', () => {});",
      workGraphNodeId: "node-3",
      rationale: "Implements test suite from node-3",
    },
  ]
}

// ─── Validation Outcomes ──────────────────────────────────────────────

export function makeValidationOutcomes(): ValidationOutcome[] {
  return [
    {
      validationId: "val-compile",
      passed: true,
      summary: "TypeScript compilation succeeded",
    },
    {
      validationId: "val-test",
      passed: true,
      summary: "All tests passed",
    },
  ]
}

// ─── Role Iteration Records ──────────────────────────────────────────

export function makeRoleIterations(): RoleIterationRecord[] {
  const now = new Date().toISOString()
  return [
    {
      role: "Planner",
      iteration: 0,
      inputFields: ["workGraph", "activeCandidate", "repoContract"],
      outputFields: ["plan"],
      toolCalls: [],
      durationMs: 100,
    },
    {
      role: "Coder",
      iteration: 0,
      inputFields: ["plan", "workGraph", "activeCandidate"],
      outputFields: ["patchProposals"],
      toolCalls: [],
      durationMs: 200,
    },
    {
      role: "Critic",
      iteration: 0,
      inputFields: ["plan", "patchProposals", "workGraph"],
      outputFields: ["critique"],
      toolCalls: [],
      durationMs: 150,
    },
    {
      role: "Tester",
      iteration: 0,
      inputFields: ["plan", "patchProposals", "critique", "workGraph"],
      outputFields: ["validationOutcomes"],
      toolCalls: [],
      durationMs: 300,
    },
    {
      role: "Verifier",
      iteration: 0,
      inputFields: ["plan", "patchProposals", "critique", "validationOutcomes", "activeCandidate"],
      outputFields: ["decision"],
      toolCalls: [],
      durationMs: 50,
    },
  ]
}

// ─── Stub Binding Mode Configs ────────────────────────────────────────

export function makePassConfig(): StubBindingModeConfig {
  return {
    patchProposals: makePatchProposals(),
    validationOutcomes: makeValidationOutcomes(),
    verifierDecisions: ["pass"],
    roleIterations: makeRoleIterations(),
  }
}

export function makeFailConfig(): StubBindingModeConfig {
  return {
    patchProposals: makePatchProposals(),
    validationOutcomes: makeValidationOutcomes(),
    verifierDecisions: ["fail"],
    roleIterations: makeRoleIterations(),
  }
}

export function makePatchThenFailConfig(): StubBindingModeConfig {
  return {
    patchProposals: makePatchProposals(),
    validationOutcomes: makeValidationOutcomes(),
    verifierDecisions: ["patch", "patch", "patch"], // Third will be forced to non-patch
    roleIterations: makeRoleIterations(),
  }
}

// ─── Inference + Convergence Configs ──────────────────────────────────

export function makeInferenceConfig(overrides?: Partial<InferenceConfig>): InferenceConfig {
  return {
    maxRepairLoops: 3,
    patchIterationCap: 5,
    ...overrides,
  }
}

export function makeConvergencePolicy(overrides?: Partial<ConvergencePolicy>): ConvergencePolicy {
  return {
    maxResampleBranches: 2,
    ...overrides,
  }
}

export function makeSynthesisConfig(overrides?: Partial<SynthesisConfig>): SynthesisConfig {
  return {
    inferenceConfig: makeInferenceConfig(),
    convergencePolicy: makeConvergencePolicy(),
    outputDir: "/tmp/test-synthesis-output",
    functionId: "FP-TEST-FUNC-001",
    ...overrides,
  }
}
