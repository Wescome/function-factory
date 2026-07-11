import type { ConnectorCall } from "../../domain/index";

/** Records completed connector call I/O (E-A). Drained by the execution adapter
 *  after each run. Single-writer per DO run, so a shared instance is safe. */
export class CallRecorder {
  private calls: ConnectorCall[] = [];
  private seq = 0;
  record(connector: string, method: string, args: unknown, response: unknown): void {
    this.calls.push({ seq: this.seq++, connector, method, args, response });
  }
  drain(): ConnectorCall[] {
    const out = this.calls;
    this.calls = [];
    this.seq = 0;
    return out;
  }
}
