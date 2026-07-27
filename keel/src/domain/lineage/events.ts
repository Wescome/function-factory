/**
 * events.ts — DOMAIN EVENTS.
 *
 * Each loop transition emits exactly one of these, and emitting it IS the
 * lineage append (D3: the state-machine runner and the lineage log are one
 * mechanism). Events are past-tense facts, immutable, content-addressed by the
 * node they reference.
 */

import type { ContentHash } from "./contract";
import type { VerdictOutcome } from "./nodes";

interface Base {
  readonly at: number;               // ClockPort.now() at emit; adapter-supplied
  readonly run: ContentHash;         // the Specification id this run is keyed on (D7)
}

/** INTENT: a run was admitted. `accepted:false` means idempotent no-op (D7). */
export interface RunAdmitted extends Base {
  readonly type: "RunAdmitted";
  readonly specification: ContentHash;
  readonly accepted: boolean;
}
export interface ActionGenerated extends Base {
  readonly type: "ActionGenerated";
  readonly action: ContentHash;
  readonly attempt: number;
}
export interface ExecutionRecorded extends Base {
  readonly type: "ExecutionRecorded";
  readonly trace: ContentHash;
}
/** EXECUTE -> PAUSE: an approval-gated call aborted the action (D8). */
export interface ActionPaused extends Base {
  readonly type: "ActionPaused";
  readonly trace: ContentHash;
  readonly executionId: string;
}
export interface VerdictEmitted extends Base {
  readonly type: "VerdictEmitted";
  readonly verdict: ContentHash;
  readonly outcome: VerdictOutcome;
  readonly attempt: number;
}
export interface AmendmentRequested extends Base {
  readonly type: "AmendmentRequested";
  readonly amendment: ContentHash;
  readonly attempt: number;
}
export interface RunAccepted extends Base {
  readonly type: "RunAccepted";
  readonly verdict: ContentHash;
}
export interface RunEscalated extends Base {
  readonly type: "RunEscalated";
  /** PLAYBOOK-KEEL-VERDICT-SET-001 (L1): "verifier-escalate" renamed
   *  "inconclusive" -- decide.ts's DecideOutcome reason, mirrored here. */
  readonly reason: "budget-exhausted" | "rejected" | "inconclusive" | "terminal-error";
  readonly verdict?: ContentHash;
}

export type DomainEvent =
  | RunAdmitted
  | ActionGenerated
  | ExecutionRecorded
  | ActionPaused
  | VerdictEmitted
  | AmendmentRequested
  | RunAccepted
  | RunEscalated;

export type DomainEventType = DomainEvent["type"];
