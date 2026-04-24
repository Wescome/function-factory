/**
 * Decision algebra state management for synthesis.
 *
 * Tracks repair-loop count, resample-branch count, and available
 * decisions based on configured bounds from ArchitectureCandidate.
 *
 * AC 2, 3, 4, 17
 */

import type { VerifierDecision, TerminalVerdict, InferenceConfig, ConvergencePolicy } from "./types.js"

// ─── Lifecycle Transition Table (AC 17) ───────────────────────────────

export const LifecycleTransition = {
  specifiedToInProgress: { from: "specified", to: "in_progress" },
  inProgressToImplemented: { from: "in_progress", to: "implemented" },
  inProgressToFailed: { from: "in_progress", to: "failed" },
} as const

export type LifecycleTransitionKey = keyof typeof LifecycleTransition

// ─── Synthesis Decision State ─────────────────────────────────────────

export interface SynthesisDecisionState {
  repairLoopCount: number
  resampleBranchCount: number
  readonly maxRepairLoops: number
  readonly maxResampleBranches: number
  readonly patchIterationCap: number
  currentLifecycle: string
}

export function createDecisionState(
  inferenceConfig: InferenceConfig,
  convergencePolicy: ConvergencePolicy,
): SynthesisDecisionState {
  return {
    repairLoopCount: 0,
    resampleBranchCount: 0,
    maxRepairLoops: inferenceConfig.maxRepairLoops,
    maxResampleBranches: convergencePolicy.maxResampleBranches,
    patchIterationCap: inferenceConfig.patchIterationCap,
    currentLifecycle: LifecycleTransition.specifiedToInProgress.to,
  }
}

/**
 * Returns the set of decisions available to the Verifier
 * given the current state bounds.
 */
export function availableDecisions(state: SynthesisDecisionState): Set<VerifierDecision> {
  const decisions = new Set<VerifierDecision>(["pass", "interrupt", "fail"])

  if (state.repairLoopCount < state.maxRepairLoops) {
    decisions.add("patch")
  }

  if (state.resampleBranchCount < state.maxResampleBranches) {
    decisions.add("resample")
  }

  return decisions
}

/**
 * Apply a verifier decision to the state. Returns the updated state
 * and a terminal verdict if the synthesis should stop.
 */
export function applyDecision(
  state: SynthesisDecisionState,
  decision: VerifierDecision,
): { state: SynthesisDecisionState; terminal: TerminalVerdict | null } {
  const available = availableDecisions(state)

  switch (decision) {
    case "pass": {
      const updated: SynthesisDecisionState = {
        ...state,
        currentLifecycle: LifecycleTransition.inProgressToImplemented.to,
      }
      return { state: updated, terminal: "pass" }
    }

    case "patch": {
      if (!available.has("patch")) {
        // Patch exhausted — force terminal
        return {
          state: { ...state },
          terminal: "patch-exhausted",
        }
      }
      const updated: SynthesisDecisionState = {
        ...state,
        repairLoopCount: state.repairLoopCount + 1,
      }
      return { state: updated, terminal: null }
    }

    case "resample": {
      if (!available.has("resample")) {
        return {
          state: { ...state },
          terminal: "resample-exhausted",
        }
      }
      const updated: SynthesisDecisionState = {
        ...state,
        resampleBranchCount: state.resampleBranchCount + 1,
      }
      return { state: updated, terminal: null }
    }

    case "interrupt": {
      const updated: SynthesisDecisionState = {
        ...state,
        currentLifecycle: LifecycleTransition.inProgressToFailed.to,
      }
      return { state: updated, terminal: "interrupt" }
    }

    case "fail": {
      const updated: SynthesisDecisionState = {
        ...state,
        currentLifecycle: LifecycleTransition.inProgressToFailed.to,
      }
      return { state: updated, terminal: "fail" }
    }
    default: {
      const _exhaustive: never = decision
      throw new Error(`Unhandled decision: ${_exhaustive}`)
    }
  }
}
