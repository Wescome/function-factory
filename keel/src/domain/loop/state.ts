/**
 * state.ts — THE GOVERNED LOOP, AS TYPED DATA (D3).
 *
 * The state machine is declared data, not an implicit while-loop inside a
 * model's context. A thin runner (Phase 3, an adapter) interprets this table
 * over the durable fiber; each transition emits the domain event that is the
 * lineage append. This file is pure — no runner, no I/O.
 */

export type LoopState =
  | "INTENT"
  | "PLAN"
  | "GENERATE"
  | "EXECUTE"
  | "VERIFY"
  | "AMEND"
  | "PAUSE"
  | "ACCEPT"     // terminal (success)
  | "ESCALATE";  // terminal (deferred)

export const TERMINAL: readonly LoopState[] = ["ACCEPT", "ESCALATE"] as const;

/** A permitted transition. `guard` names the condition the runner checks; the
 *  VERIFY-exit guards are decided by decide() (decide.ts). */
export interface Transition {
  readonly from: LoopState;
  readonly to: LoopState;
  readonly guard: string;
}

/**
 * The transition table. Notes bind the M0 findings:
 *  - INTENT is entered via idempotent admit (D7); a non-accepted admit is a
 *    no-op that returns the existing run's status rather than re-entering.
 *  - EXECUTE -> PAUSE and PAUSE -> EXECUTE are the abort-and-replay pair (D8):
 *    PAUSE -> EXECUTE re-runs the whole action under replay, it is not a
 *    mid-function resume.
 *  - The three VERIFY exits are chosen by decide().
 */
export const TRANSITIONS: readonly Transition[] = [
  { from: "INTENT", to: "PLAN", guard: "spec-valid" },
  { from: "PLAN", to: "GENERATE", guard: "always" },
  { from: "GENERATE", to: "EXECUTE", guard: "code-parsed" },
  { from: "EXECUTE", to: "VERIFY", guard: "completed" },
  { from: "EXECUTE", to: "PAUSE", guard: "approval-gated" },      // D8
  { from: "PAUSE", to: "EXECUTE", guard: "approved-replay" },     // D8: replay-resume
  { from: "PAUSE", to: "ESCALATE", guard: "rejected" },
  { from: "VERIFY", to: "ACCEPT", guard: "decide:accept" },
  { from: "VERIFY", to: "AMEND", guard: "decide:amend" },
  { from: "VERIFY", to: "ESCALATE", guard: "decide:escalate" },
  { from: "AMEND", to: "GENERATE", guard: "always" },
] as const;

export function transitionsFrom(s: LoopState): readonly Transition[] {
  return TRANSITIONS.filter((t) => t.from === s);
}

export function isTerminal(s: LoopState): boolean {
  return TERMINAL.includes(s);
}
