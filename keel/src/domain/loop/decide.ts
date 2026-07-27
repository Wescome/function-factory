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
import type { TriageRoute, TriageEscalateReason } from "../triage/classify";

export type DecideOutcome =
  | { readonly next: "ACCEPT" }
  | { readonly next: "AMEND"; readonly attempt: number }
  | { readonly next: "ESCALATE"; readonly reason: "budget-exhausted" | "rejected" | "inconclusive" | "terminal-error" | TriageEscalateReason };

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
  /** PLAYBOOK-KEEL-TRIAGE-001 (D2, OD-D2-4/Track C): a pre-computed triage
   *  route for a `fail` verdict — CALLER-supplied (this function classifies
   *  nothing; see triage/classify.ts's `routeTriage`). Only ever consulted
   *  when `verdict === "fail"`; a `{exit: "amend"}` route (or no route at
   *  all) falls through to the unchanged fail/amend/escalate path below
   *  (B.4, never-worse) — no caller populates this today, so this field
   *  changes zero production behavior until a classifier is wired. */
  readonly triage?: TriageRoute;
}

export function decide(i: DecideInput): DecideOutcome {
  if (i.approvalRejected) return { next: "ESCALATE", reason: "rejected" };
  if (i.terminalError && classifyTerminal(i.terminalError)) return { next: "ESCALATE", reason: "terminal-error" };
  if (i.verdict === "fail" && i.triage?.exit === "escalate") return { next: "ESCALATE", reason: i.triage.reason };

  switch (i.verdict) {
    case "pass":
      return { next: "ACCEPT" };
    // PLAYBOOK-KEEL-VERDICT-SET-001 (L1): "can't/won't judge as pass or
    // fail" -- the verifier's own escalate (grounding gate's aggregateGate,
    // still legitimate, out of scope for this playbook), the post-execution
    // oracle's inconclusive (the new, honest default for "can't judge"),
    // and a degenerate top-level not-applicable (B.4: every criterion
    // excluded/abstained -- a vacuous verdict is never an ACCEPT, so this
    // surfaces exactly like inconclusive, never silently). All three route
    // identically: immediate ESCALATE, never amendable (INV-L1-ABSTAIN-SURFACES).
    case "escalate":
    case "inconclusive":
    case "not-applicable":
      return { next: "ESCALATE", reason: "inconclusive" };
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
