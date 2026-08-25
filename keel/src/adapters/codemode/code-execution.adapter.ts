import type { CodeExecutionPort, ExecutionOutcome } from "../../domain/index";
import type { ActionContent, ExecutionTraceContent } from "../../domain/index";
import { isRevertible } from "../../domain/index";
import type { CodemodeHandle } from "./runtime";
import type { CallRecorder } from "./call-recorder";

export class CodemodeExecutionAdapter implements CodeExecutionPort {
  constructor(private readonly rt: CodemodeHandle, private readonly opts: { wrapMr?: boolean; recorder?: CallRecorder } = {}) {}

  async execute(action: ActionContent): Promise<ExecutionOutcome> {
    // For metamorphic tasks the action is a compute BODY; wrap it and run once
    // with a sample input so the trace is a normal single execution. The oracle
    // does the real multi-probe check.
    const code = this.opts.wrapMr
      ? `const compute = (value) => { ${action.code} }; return compute(1);`
      : action.code;
    const out = await this.rt.tool().execute({ code }, undefined);
    const recorded = this.opts.recorder?.drain() ?? [];
    const terminalError = this.opts.recorder?.drainTerminalError();
    return this.toOutcome(out, recorded, terminalError);
  }
  async approve(executionId: string): Promise<ExecutionOutcome> {
    const out = await this.rt.approve({ executionId }); // D8: replays, runs approved call
    // Same fix as execute(): any connector calls made during/after the replay
    // (e.g. a read that follows the now-approved write) ARE recorded by the
    // CallRecorder, but were never drained here — so anchored oracles that
    // check trace.calls (fx@v1, geo@v1, ledger@v1, fxrate@v1) saw an empty
    // array on a post-approval trace even when the real calls happened.
    const recorded = this.opts.recorder?.drain() ?? [];
    const terminalError = this.opts.recorder?.drainTerminalError();
    return this.toOutcome(out, recorded, terminalError);
  }
  async reject(executionId: string): Promise<void> {
    // codemode's reject needs the pending seq; the skeleton has one gated call.
    // A real adapter threads the seq from the pending action.
    await this.rt.reject({ seq: 0, executionId });
  }

  /** PLAYBOOK-KEEL-WRITE-ROLLBACK-001: codemode's native rollback -- walks
   *  the execution's own tool-call log backward and calls each applied
   *  tool's `revert` (INV-RB-ATOMIC's "reverse order" comes from codemode
   *  itself, not hand-rolled here). `rollback()` always marks the execution
   *  `rolled_back`, whether or not anything was actually revertible -- so
   *  completeness is checked afterward: every log entry for a (connector,
   *  method) the registry declares `revertible` must have actually flipped
   *  to `"reverted"`, or the revert didn't cleanly complete (C.3
   *  fail-closed). Workspace-only (INV-RB-LEDGER-UNTOUCHED): this never
   *  calls the lineage repo. */
  async revertAttempt(executionId: string): Promise<{ readonly reverted: boolean }> {
    await this.rt.rollback({ executionId });
    const executions = await this.rt.executions(500);
    const exec = executions.find((e) => e.id === executionId);
    if (!exec) return { reverted: false }; // can't verify -> fail closed
    // codemode only flips status to "rolled_back" when something actually
    // got reverted -- an ordinary run with nothing revertible (no write
    // declared a `revert`) stays "completed"/"error", which is correct and
    // NOT a failure. The real signal is per-entry: any (connector, method)
    // the registry declares revertible that is still "applied" (not
    // "reverted") after rollback() is an incomplete revert (C.3 fail-closed).
    const incomplete = exec.log.some(
      (entry) => isRevertible(entry.connector, entry.method) && entry.state !== "reverted",
    );
    return { reverted: !incomplete };
  }

  private toOutcome(out: {
    status: "completed" | "paused" | "error";
    executionId: string;
    result?: unknown;
    pending?: { executionId: string; seq: number; connector: string; method: string; args: unknown }[];
    error?: string;
    logs?: string[];
  }, recorded: readonly import("../../domain/index").ConnectorCall[] = [], terminalError?: import("../../domain/index").ErrorClass): ExecutionOutcome {
    // completed connector calls (with responses) come from the recorder; pending
    // (gated) calls come from codemode's out.pending.
    const pendingCalls = (out.pending ?? []).map((p) => ({ seq: p.seq, connector: p.connector, method: p.method, args: p.args }));
    const calls = recorded.length ? [...recorded] : pendingCalls;
    // terminalError rides on the trace regardless of codemode's own status —
    // BRIEF-KEEL-EFFECT-SIGNATURE-001 v1.3: the emitter classifies without
    // throwing, so the execution typically still completes normally; the
    // classification is what makes decide() ESCALATE, not a crash.
    const base = { executionId: out.executionId, calls, egress: "connector-only" as const, terminalError };
    if (out.status === "completed") {
      const trace: ExecutionTraceContent = { ...base, status: "completed", result: out.result };
      return { status: "completed", trace };
    }
    if (out.status === "paused") {
      const trace: ExecutionTraceContent = { ...base, status: "paused", pending: out.pending ?? [] };
      return { status: "paused", trace };
    }
    const trace: ExecutionTraceContent = { ...base, status: "error", error: out.error ?? "unknown" };
    return { status: "error", trace };
  }
}
