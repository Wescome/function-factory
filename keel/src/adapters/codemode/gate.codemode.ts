// An approval-gated connector for M3. gate.commit is a consequential effect;
// calling it aborts the code action for human approval (D8).
import { CodemodeConnector } from "@cloudflare/codemode";

export class GateConnector extends CodemodeConnector<unknown> {
  override name() { return "gate"; }
  override tools() {
    return {
      commit: {
        description: "A consequential, approval-gated commit.",
        requiresApproval: true,
        execute: (args: unknown) => args,
      },
    };
  }
}
