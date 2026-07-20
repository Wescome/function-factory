import type { CodeExecutionPort, ExecutionOutcome, ActionContent, ExecutionTraceContent } from "../../domain/index";

// Degraded-mode stand-in: the code executor is unavailable. Every execute()
// returns an error outcome WITHOUT calling codemode — the run must fail closed
// (verify fails -> amend -> budget -> ESCALATE), never crash or false-ACCEPT.
// The OraclePort is a separate adapter and is NOT faulted, so verification and
// the read side keep serving.
export class FaultyExecutionAdapter implements CodeExecutionPort {
  private trace(): ExecutionTraceContent {
    return { executionId: "fault-" + Date.now(), status: "error", calls: [], egress: "none", error: "injected fault: code executor unavailable" };
  }
  async execute(_action: ActionContent): Promise<ExecutionOutcome> {
    return { status: "error", trace: this.trace() };
  }
  async approve(_executionId: string): Promise<ExecutionOutcome> {
    return { status: "error", trace: this.trace() };
  }
  async reject(_executionId: string): Promise<void> {}
}
