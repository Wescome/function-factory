import type { ConnectorCall, ErrorClass } from "../../domain/index";

/** Records completed connector call I/O (E-A). Drained by the execution adapter
 *  after each run. Single-writer per DO run, so a shared instance is safe. */
export class CallRecorder {
  private calls: ConnectorCall[] = [];
  private seq = 0;
  private terminalError?: ErrorClass;

  record(connector: string, method: string, args: unknown, response: unknown): void {
    this.calls.push({ seq: this.seq++, connector, method, args, response });
  }

  /** BRIEF-KEEL-EFFECT-SIGNATURE-001 v1.3: a connector adapter classifies a
   *  failure it just observed (a disallowed server, a recorded 401/403, a
   *  schema-divergent response, a uniqueness violation) and reports the
   *  class here instead of throwing — the class is data on the trace, not a
   *  crash. Classification stays the connector's job (it knows the backend
   *  error); routing stays decide()'s (it knows the loop) — this method does
   *  neither, it's just the channel between them. Last write wins within one
   *  attempt (there is one terminalError slot per trace, not a list). */
  setTerminalError(cls: ErrorClass): void {
    this.terminalError = cls;
  }

  drain(): ConnectorCall[] {
    const out = this.calls;
    this.calls = [];
    this.seq = 0;
    return out;
  }

  /** Drained alongside `calls` — reset so a stale class from a prior attempt
   *  never leaks onto a later, unrelated attempt's trace. */
  drainTerminalError(): ErrorClass | undefined {
    const out = this.terminalError;
    this.terminalError = undefined;
    return out;
  }
}
