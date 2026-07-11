import type { CodeExecutionPort, ExecutionOutcome } from "../../domain/index";
import type { ActionContent, ExecutionTraceContent } from "../../domain/index";
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
    return this.toOutcome(out, recorded);
  }
  async approve(executionId: string): Promise<ExecutionOutcome> {
    const out = await this.rt.approve({ executionId }); // D8: replays, runs approved call
    // Same fix as execute(): any connector calls made during/after the replay
    // (e.g. a read that follows the now-approved write) ARE recorded by the
    // CallRecorder, but were never drained here — so anchored oracles that
    // check trace.calls (fx@v1, geo@v1, ledger@v1, fxrate@v1) saw an empty
    // array on a post-approval trace even when the real calls happened.
    const recorded = this.opts.recorder?.drain() ?? [];
    return this.toOutcome(out, recorded);
  }
  async reject(executionId: string): Promise<void> {
    // codemode's reject needs the pending seq; the skeleton has one gated call.
    // A real adapter threads the seq from the pending action.
    await this.rt.reject({ seq: 0, executionId });
  }

  private toOutcome(out: {
    status: "completed" | "paused" | "error";
    executionId: string;
    result?: unknown;
    pending?: { executionId: string; seq: number; connector: string; method: string; args: unknown }[];
    error?: string;
    logs?: string[];
  }, recorded: readonly import("../../domain/index").ConnectorCall[] = []): ExecutionOutcome {
    // completed connector calls (with responses) come from the recorder; pending
    // (gated) calls come from codemode's out.pending.
    const pendingCalls = (out.pending ?? []).map((p) => ({ seq: p.seq, connector: p.connector, method: p.method, args: p.args }));
    const calls = recorded.length ? [...recorded] : pendingCalls;
    const base = { executionId: out.executionId, calls, egress: "connector-only" as const };
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
