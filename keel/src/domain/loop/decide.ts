/**
 * decide.ts — THE VERIFY-EXIT POLICY (pure).
 *
 * This is the "LoopController" folded into a pure function (ARCH-KEEL-000
 * changelog): it is not a component, just the decision the Orchestrator makes
 * when leaving VERIFY. No I/O, no model call, no state — a total function over
 * its input, exhaustive on VerdictOutcome.
 *
 * The attempt budget is caller-supplied (empirically set per task), never
 * inherited from anywhere.
 */

import type { VerdictOutcome } from "../lineage/nodes";
import type { ErrorClass } from "../effect/errors";
import { classifyTerminal } from "../effect/errors";

export type DecideOutcome =
  | { readonly next: "ACCEPT" }
  | { readonly next: "AMEND"; readonly attempt: number }
  | { readonly next: "ESCALATE"; readonly reason: "budget-exhausted" | "rejected" | "verifier-escalate" | "terminal-error" };

export interface DecideInput {
  readonly verdict: VerdictOutcome;
  /** attempts USED so far, 1-based (the attempt that just produced `verdict`). */
  readonly attempt: number;
  /** max attempts permitted for this run (from SpecificationContent). */
  readonly budget: number;
  /** set when a human refused an approval-gated action (PAUSE -> rejected). */
  readonly approvalRejected?: boolean;
  /** OD-EFFECT-6: a classified connector-call error, if this attempt's
   *  execution hit one. Only a TERMINAL class (classifyTerminal) short-
   *  circuits to ESCALATE here; an amend-worthy class (InvalidResponse,
   *  Conflict, RateLimited) falls through to the normal verdict-based path
   *  below — the caller is expected to have set `verdict: "fail"` for those,
   *  same as any other failed attempt. */
  readonly terminalError?: ErrorClass;
}

export function decide(i: DecideInput): DecideOutcome {
  if (i.approvalRejected) return { next: "ESCALATE", reason: "rejected" };
  if (i.terminalError && classifyTerminal(i.terminalError)) return { next: "ESCALATE", reason: "terminal-error" };

  switch (i.verdict) {
    case "pass":
      return { next: "ACCEPT" };
    case "escalate":
      // The verifier itself signalled escalate (e.g. unverifiable / out of scope).
      return { next: "ESCALATE", reason: "verifier-escalate" };
    case "fail":
      return i.attempt < i.budget
        ? { next: "AMEND", attempt: i.attempt + 1 }
        : { next: "ESCALATE", reason: "budget-exhausted" };
    default: {
      // Exhaustiveness guard: if VerdictOutcome grows, this fails to compile.
      const _never: never = i.verdict;
      return _never;
    }
  }
}
