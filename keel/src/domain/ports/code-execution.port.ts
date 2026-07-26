/**
 * code-execution.port.ts — CodeExecutionPort (driven).
 * EXECUTE. Backed by codemode + a Dynamic Worker (adapter). Encodes D5 and D8.
 */
import type { ActionContent, ExecutionTraceContent } from "../lineage/nodes";

export type ExecutionOutcome =
  | { readonly status: "completed"; readonly trace: ExecutionTraceContent }
  | { readonly status: "paused"; readonly trace: ExecutionTraceContent }
  | { readonly status: "error"; readonly trace: ExecutionTraceContent };

export interface CodeExecutionPort {
  /**
   * Run one code action exactly once. D5: connectors-only — the only effects
   * are connector calls, which is what makes the run replayable. The sandbox
   * has no ambient network (globalOutbound:null), confirmed M0/S4.
   */
  execute(action: ActionContent): Promise<ExecutionOutcome>;

  /**
   * Approve a paused (approval-gated) action.
   *
   * D8 — PAUSE IS ABORT-AND-REPLAY, NOT A MID-FUNCTION SUSPEND. On approval the
   * entire action re-runs: prior connector calls replay from the durable log as
   * no-ops, and only the newly-approved call executes for real.
   *
   * INVARIANT (binding on every Action author): any effect placed before an
   * approval gate MUST be a connector call (logged, replayed as a no-op) or
   * idempotent. A non-logged, non-idempotent effect before a gate fires twice.
   */
  approve(executionId: string): Promise<ExecutionOutcome>;

  /** Reject a paused action; the gated effect never runs. Caller escalates. */
  reject(executionId: string): Promise<void>;

  /**
   * PLAYBOOK-KEEL-WRITE-ROLLBACK-001: revert a (failed) attempt's
   * write-effectful calls in reverse order -- the connector's own `revert`,
   * never a second gate. Called by the loop on AMEND (before the next
   * attempt regenerates) and on ESCALATE (INV-RB-VIRTUAL-ONLY: reverts the
   * virtual Workspace only; a landed `git.push` is never undone). ACCEPT
   * never calls this -- its effects are kept.
   *
   * `reverted: false` signals the revert did not cleanly complete (a write
   * that declared `revertible` is still applied afterward) -- the caller
   * (`run.ts`, C.3) treats this as fail-closed: an AMEND whose revert can't
   * complete becomes an ESCALATE rather than regenerating atop a
   * half-reverted scratch.
   */
  revertAttempt(executionId: string): Promise<{ readonly reverted: boolean }>;
}
