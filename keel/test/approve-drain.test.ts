/** Regression for the #1 bug: approve() must drain the recorder, else post-approval
 *  trace.calls is empty and every anchored oracle silently mis-verifies on resume. */
import { describe, it, expect } from "vitest";
import { CodemodeExecutionAdapter } from "../src/adapters/codemode/code-execution.adapter";
import { CallRecorder } from "../src/adapters/codemode/call-recorder";
import type { CodemodeHandle } from "../src/adapters/codemode/runtime";

describe("#1 approve() drains the recorder", () => {
  it("a connector call recorded during the approved replay appears in trace.calls", async () => {
    const recorder = new CallRecorder();
    // simulate a connector call recorded during the approved replay
    const rt = {
      approve: async () => { recorder.record("ledger", "list", { key: "entity-1" }, [{ value: "active" }]);
        return { status: "completed" as const, executionId: "e1", result: { count: 1 } }; },
    } as unknown as CodemodeHandle;
    const adapter = new CodemodeExecutionAdapter(rt, { recorder });
    const out = await adapter.approve("e1");
    expect(out.status).toBe("completed");
    expect(out.trace.calls).toHaveLength(1);                 // was [] before the fix
    expect(out.trace.calls[0]!.connector).toBe("ledger");    // the anchored oracle can now see it
  });
});
