/**
 * PLAYBOOK-KEEL-WORKSPACE-001: proves generated code can reach a real
 * repository from inside the codemode isolate via the new state and git
 * connectors, and that the calls land on the trace in order.
 *
 * git.clone runs host-side (inside WorkspaceGitConnector.execute, NOT inside
 * the sandbox isolate) — confirmed by a standalone probe that plain `fetch`
 * works in this vitest-pool-workers environment; runtime.ts's "isolate has
 * no ambient network" (globalOutbound: null) governs code running INSIDE the
 * sandbox, not the connector's own execution context. So a real depth-1
 * clone of a tiny, stable public repo (octocat/Hello-World) is used directly
 * rather than a local fixture.
 */
import { describe, it, expect } from "vitest";
import { env } from "cloudflare:test";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function stubFor(name: string) {
  const ns = (env as { ORCHESTRATOR: DurableObjectNamespace }).ORCHESTRATOR;
  return ns.get(ns.idFromName(name)) as unknown as {
    admit(c: unknown): Promise<{ accepted: boolean; runId: string }>;
    result(): Promise<{ state: string | null; verdict: unknown } | null>;
    dumpNodes(): Promise<readonly { kind: string; content: unknown }[]>;
  };
}

const spec = {
  intent: "workspace-read-test",
  capabilityCeiling: "connectors-only" as const,
  acceptance: [
    { id: "A1", statement: "cloned into /repo", kind: "example" as const },
    { id: "A2", statement: "glob found files", kind: "example" as const },
    { id: "A3", statement: "readFile content matches the recorded call", kind: "example" as const },
  ],
  connectors: ["git", "state"],
  approvalGated: [],
  attemptBudget: 1,
  oracleRef: "workspace-read@v1",
  forbids: [],
  decomposable: false,
};

async function poll(stub: ReturnType<typeof stubFor>) {
  for (let i = 0; i < 150; i++) {
    const r = await stub.result();
    if (r && (r.state === "ACCEPT" || r.state === "ESCALATE")) return r;
    await sleep(200);
  }
  return stub.result();
}

describe("PLAYBOOK-KEEL-WORKSPACE-001 — workspace reads in the codemode runtime", () => {
  it("clones a real public repo, globs it, reads a file back -- the run ACCEPTs", async () => {
    const stub = stubFor("ws-read-1");
    await stub.admit(spec);
    const r = await poll(stub);
    expect(r?.state).toBe("ACCEPT");
  }, 30000);

  it("the trace records git.clone -> state.glob -> state.readFile in order, with real responses", async () => {
    const stub = stubFor("ws-read-2");
    await stub.admit(spec);
    await poll(stub);
    const nodes = await stub.dumpNodes();
    const trace = nodes.find((n) => n.kind === "ExecutionTrace")?.content as {
      calls: readonly { seq: number; connector: string; method: string; args: unknown; response?: unknown }[];
      result?: { content?: string; fileCount?: number };
    };
    expect(trace).toBeTruthy();

    const clone = trace.calls.find((c) => c.connector === "git" && c.method === "clone");
    const glob = trace.calls.find((c) => c.connector === "state" && c.method === "glob");
    const readFile = trace.calls.find((c) => c.connector === "state" && c.method === "readFile");

    expect(clone).toBeTruthy();
    expect(glob).toBeTruthy();
    expect(readFile).toBeTruthy();
    // ordered: clone before glob before readFile
    expect(clone!.seq).toBeLessThan(glob!.seq);
    expect(glob!.seq).toBeLessThan(readFile!.seq);

    expect(clone!.response).toMatchObject({ dir: "/repo" });
    expect(Array.isArray(glob!.response)).toBe(true);
    expect((glob!.response as unknown[]).length).toBeGreaterThan(0);
    expect(typeof readFile!.response).toBe("string");
    expect((readFile!.response as string).length).toBeGreaterThan(0);

    // the readFile response is real file content, threaded faithfully into the result
    expect(trace.result?.content).toBe(readFile!.response);
  }, 30000);
});
