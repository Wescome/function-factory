// Convergence loop decision logic.
//
// Implements IS-GC-FIDELITY-VALIDATION FV-16..FV-18a.
//
// This is a PURE decision function. It does NOT re-run the molecule itself; it
// tells the supervisor what to do next given a step verdict and the loop state:
//   - rerun:        re-run the molecule with remediation injected (FV-16/FV-17)
//   - emit_release: stop iterating and POST the RELEASE webhook (terminal /
//                   approved / depth-exceeded / escalate-early)
//
// Re-run mechanism granularity (spec Open Question 1): the implementation uses
// WHOLE-MOLECULE RESTART (full re-run from SEED with remediation injected) as the
// safe default while Gas City molecule re-entry capability is confirmed
// separately. The decision contract here is independent of that mechanism.

import type { GateClass, Outcome, StepVerdict } from "./types.ts"

export interface ConvergenceState {
  /** current dispatch attempt (1-indexed, FV-17). */
  factory_attempt: number
  /** GAS_CITY_MAX_AMENDMENT_DEPTH (default 3, GOVD D9). */
  max_amendment_depth: number
  /** failing-check count of the PRIOR iteration; undefined on the first iteration (FV-17 escalate-early). */
  prior_failing_count?: number
}

export type ConvergenceAction = "rerun" | "emit_release"

export interface ConvergenceDecision {
  action: ConvergenceAction
  /** present when action === "emit_release": the molecule verdict to POST. */
  outcome?: Outcome
  /** present when action === "emit_release": the remediation to carry (empty for approved). */
  remediation?: string
  /** present when action === "rerun": the next attempt counter (FV-17). */
  next_attempt?: number
  /** present when action === "rerun": the FV-14 remediation injected into the re-run (FV-17). */
  remediation_to_inject?: string
  /** true when the terminal revise is an Escalation gate (FV-13). */
  escalated?: boolean
  /** true when the loop stopped early because failing count did not decrease (FV-17). */
  escalated_early?: boolean
  /** true when the loop stopped because amendment depth was exhausted (FV-18a). */
  depth_exceeded?: boolean
}

const RERUNNABLE: GateClass[] = ["revision", "preflight"]

/**
 * Decide the next convergence action for a step verdict.
 */
export function decideConvergence(verdict: StepVerdict, state: ConvergenceState): ConvergenceDecision {
  // Approved → emit RELEASE approved (no rerun).
  if (verdict.outcome === "approved") {
    return { action: "emit_release", outcome: "approved", remediation: "" }
  }

  const gate = verdict.gate_class
  const remediation = verdict.remediation

  // FV-18 — Abort / Escalation are terminal for the attempt: no in-molecule rerun.
  if (gate === "abort") {
    return { action: "emit_release", outcome: "revise", remediation }
  }
  if (gate === "escalation") {
    return { action: "emit_release", outcome: "revise", remediation, escalated: true }
  }

  // From here gate is Revision or Pre-flight (rerunnable classes, FV-16).
  if (!gate || !RERUNNABLE.includes(gate)) {
    // Defensive: an unknown gate class is treated as terminal (fail-closed).
    return { action: "emit_release", outcome: "revise", remediation }
  }

  // FV-18a — depth exhaustion. Loop guard is >= (the limit-reaching attempt is emitted, not re-run).
  if (state.factory_attempt >= state.max_amendment_depth) {
    return {
      action: "emit_release",
      outcome: "revise",
      remediation: appendDepthNotice(remediation, state.factory_attempt, state.max_amendment_depth),
      depth_exceeded: true,
    }
  }

  // FV-17 — escalate early if the failing-check count did not decrease across iterations.
  if (
    state.prior_failing_count !== undefined &&
    verdict.failing_count >= state.prior_failing_count
  ) {
    return {
      action: "emit_release",
      outcome: "revise",
      remediation: appendNoProgressNotice(remediation),
      escalated_early: true,
    }
  }

  // FV-16/FV-17 — re-run the molecule with the remediation injected; advance the counter.
  return {
    action: "rerun",
    next_attempt: state.factory_attempt + 1,
    remediation_to_inject: remediation,
  }
}

function appendDepthNotice(remediation: string, attempt: number, max: number): string {
  return `${remediation} (Amendment depth exhausted: attempt ${attempt} of a maximum of ${max}. This molecule has not converged and is being escalated to the Factory amendment path.)`
}

function appendNoProgressNotice(remediation: string): string {
  return `${remediation} (The failing-check count did not decrease across attempts; the molecule is not converging and is being escalated to the Factory amendment path.)`
}
