/**
 * @factory/function-synthesis — public API
 *
 * Synthesizes a compiled WorkGraph + ArchitectureCandidate into a
 * complete Function implementation through a five-role topology
 * with pluggable binding modes.
 */

// ─── Types ────────────────────────────────────────────────────────────
export {
  RoleName,
  TerminalVerdict,
  VerifierDecision,
  DisagreementClass,
  InferenceConfig,
  ConvergencePolicy,
  ToolCallRecord,
  RoleIterationRecord,
  ResampleNode,
  ValidationOutcome,
  TerminalDecision,
  HumanApprovalPayload,
  SynthesisTraceLog,
  ContractSurfaceVerdict,
  ContractSurfaceCheck,
  RoleAdherenceEntry,
  RoleAdherenceReport,
  Gate2Input,
  SynthesisCandidateSelectionReport,
  PatchProposal,
  SynthesisResult,
  MemoryWriteRecord,
  CrystallizationProposal,
} from "./types.js"

// ─── Role Contracts ───────────────────────────────────────────────────
export type { RoleContract } from "./role-contracts.js"
export {
  PlannerContract,
  CoderContract,
  CriticContract,
  TesterContract,
  VerifierContract,
  ALL_ROLE_CONTRACTS,
  getRoleContract,
} from "./role-contracts.js"

// ─── Binding Modes ────────────────────────────────────────────────────
export type { BindingMode, BindingModeOutput, BindingModeContext, StubBindingModeConfig } from "./binding-mode.js"
export { StubBindingMode } from "./binding-mode.js"

// ─── Decision State ───────────────────────────────────────────────────
export {
  LifecycleTransition,
  createDecisionState,
  availableDecisions,
  applyDecision,
} from "./decision-state.js"
export type { SynthesisDecisionState, LifecycleTransitionKey } from "./decision-state.js"

// ─── Role Adherence ───────────────────────────────────────────────────
export { checkRoleAdherence, injectDoNotViolation } from "./role-adherence.js"

// ─── Disagreement ─────────────────────────────────────────────────────
export type { DisagreementConditions, DisagreementResolution } from "./disagreement.js"
export { resolveDisagreement } from "./disagreement.js"

// ─── Evidence ─────────────────────────────────────────────────────────
export { buildTraceLog, buildGate2Input, buildCandidateSelectionReport } from "./evidence.js"

// ─── Memory ───────────────────────────────────────────────────────────
export { MemoryWriteCollector } from "./memory-tool.js"

// ─── Crystallization ──────────────────────────────────────────────────
export { checkCrystallization } from "./crystallization.js"

// ─── Orchestration ────────────────────────────────────────────────────
export type { SynthesisConfig, CodeEmitter } from "./orchestrate.js"
export { DefaultCodeEmitter, DryRunCodeEmitter, orchestrate } from "./orchestrate.js"

// ─── Top-level convenience ────────────────────────────────────────────

import type { ArchitectureCandidate, WorkGraph } from "@factory/schemas"
import type { BindingMode } from "./binding-mode.js"
import type { SynthesisConfig } from "./orchestrate.js"
import type { CodeEmitter } from "./orchestrate.js"
import { orchestrate } from "./orchestrate.js"
import { DryRunCodeEmitter } from "./orchestrate.js"

/**
 * Synthesize a Function from a compiled WorkGraph and ArchitectureCandidate.
 *
 * This is the primary public API entry point.
 */
export async function synthesize(
  workGraph: WorkGraph,
  candidate: ArchitectureCandidate,
  bindingMode: BindingMode,
  config: SynthesisConfig,
  codeEmitter?: CodeEmitter,
): Promise<import("./types.js").SynthesisResult> {
  return orchestrate(
    workGraph,
    candidate,
    bindingMode,
    config,
    codeEmitter ?? new DryRunCodeEmitter(),
  )
}
