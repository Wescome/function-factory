/**
 * PLAYBOOK-KEEL-WRITE-ROLLBACK-001 (D.3): revertAttempt()'s completeness
 * check, unit-tested against a mocked `rt` handle (same pattern as
 * approve-drain.test.ts) -- rollback() and this completeness read must
 * agree on the ONE log codemode keeps per execution.
 */
import { describe, it, expect } from "vitest";
import { CodemodeExecutionAdapter } from "../src/adapters/codemode/code-execution.adapter";
import type { CodemodeHandle } from "../src/adapters/codemode/runtime";

function fakeRt(log: { connector: string; method: string; state: string }[], status: string): CodemodeHandle {
  return {
    rollback: async () => {},
    executions: async () => [{
      id: "e1", code: "", status, log, createdAt: 0, updatedAt: 0,
    }],
  } as unknown as CodemodeHandle;
}

describe("revertAttempt() -- replay-consistent completeness", () => {
  it("a fully-reverted write-effectful log -> reverted: true", async () => {
    const rt = fakeRt([
      { connector: "state", method: "writeFile", state: "reverted" },
      { connector: "state", method: "readFile", state: "applied" }, // a read; never expected to revert
    ], "rolled_back");
    const adapter = new CodemodeExecutionAdapter(rt);
    expect(await adapter.revertAttempt("e1")).toEqual({ reverted: true });
  });

  it("a write-effectful entry left 'applied' (revert failed) -> reverted: false (C.3 fail-closed)", async () => {
    const rt = fakeRt([
      { connector: "state", method: "writeFile", state: "applied" }, // still applied -- revert didn't happen
    ], "completed"); // status never even flipped
    const adapter = new CodemodeExecutionAdapter(rt);
    expect(await adapter.revertAttempt("e1")).toEqual({ reverted: false });
  });

  it("nothing revertible in the log (e.g. an echo-only run) -> reverted: true, even though status never becomes rolled_back", async () => {
    const rt = fakeRt([
      { connector: "echo", method: "emit", state: "applied" },
    ], "completed");
    const adapter = new CodemodeExecutionAdapter(rt);
    expect(await adapter.revertAttempt("e1")).toEqual({ reverted: true });
  });

  it("D.5: git.push left 'applied' does NOT count as incomplete -- never un-push (INV-RB-VIRTUAL-ONLY)", async () => {
    const rt = fakeRt([
      { connector: "state", method: "writeFile", state: "reverted" },
      { connector: "git", method: "push", state: "applied" }, // push has no revert by design -- stays applied forever
    ], "rolled_back");
    const adapter = new CodemodeExecutionAdapter(rt);
    expect(await adapter.revertAttempt("e1")).toEqual({ reverted: true });
  });

  it("an execution codemode can't find -> reverted: false (can't verify, fail closed)", async () => {
    const rt = { rollback: async () => {}, executions: async () => [] } as unknown as CodemodeHandle;
    const adapter = new CodemodeExecutionAdapter(rt);
    expect(await adapter.revertAttempt("missing")).toEqual({ reverted: false });
  });
});
