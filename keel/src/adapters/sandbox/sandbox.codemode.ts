// PLAYBOOK-KEEL-RUN-SUITE-001 (A3, Tier 4): runs a real repository's real
// test suite in a Cloudflare Sandbox container, projects the result into
// KEEL's one verdict shape (SandboxOracleAdapter reads this connector's own
// recorded call), and governs it as a logged connector call like any other
// -- NOT a CodeExecutionPort (B.4). A real, external, one-way effect (like
// git.push): no `revert` declared, same INV-RB-VIRTUAL-ONLY reasoning.
//
// Real API confirmed against the installed package (A.4) -- do not assume
// from docs: `getSandbox(ns, id, opts?): Sandbox`, `sandbox.gitCheckout(url,
// {branch?, targetDir?, depth?})` (NOT `gitClone` -- the playbook's assumed
// name), `sandbox.exec(command, {cwd?, timeout?, env?})`, `sandbox.destroy()`.
import { CodemodeConnector, type ConnectorTools } from "@cloudflare/codemode";
import { getSandbox, type Sandbox } from "@cloudflare/sandbox";
import { requiresApprovalFor } from "../../domain/index";
import type { CallRecorder } from "../codemode/call-recorder";
import { parseSimulationResult } from "./verdict-projection";

const DEFAULT_TEST_COMMAND = "npm install && npm test";

export class SandboxConnector extends CodemodeConnector<unknown> {
  constructor(
    ctx: unknown,
    env: unknown,
    private readonly ns: DurableObjectNamespace<Sandbox>,
    private readonly rec?: CallRecorder,
  ) {
    super(ctx as never, env as never);
  }
  override name() { return "sandbox"; }
  override tools(): ConnectorTools {
    const ns = this.ns, rec = this.rec;
    return {
      runSuite: {
        description: "sandbox.runSuite({repo, testCommand?, branch?}) => {passed, failures[]}. Clones the repo into a fresh, per-run container and runs its real test suite. Write-effectful, approval-gated.",
        requiresApproval: requiresApprovalFor("sandbox", "runSuite"),
        execute: async (a: unknown) => {
          const { repo, testCommand, branch } = (a ?? {}) as { repo: string; testCommand?: string; branch?: string };
          // INV-RUN-BLAST-SCOPED (OD-RUN-3): a fresh Sandbox per run, keyed
          // on a random id so no two runs (or two attempts) ever share one.
          const sandbox = getSandbox(ns, crypto.randomUUID());
          try {
            const checkout = await sandbox.gitCheckout(repo, { branch, depth: 1 });
            const cmd = testCommand ?? DEFAULT_TEST_COMMAND;
            const exec = await sandbox.exec(cmd, { cwd: checkout.targetDir });
            const sim = parseSimulationResult(exec);
            const r = { passed: sim.passed, failures: sim.failures, exitCode: exec.exitCode };
            rec?.record("sandbox", "runSuite", { repo, testCommand: cmd, branch }, r);
            return r;
          } finally {
            // Per-run ephemeral: dispose regardless of outcome.
            await sandbox.destroy();
          }
        },
      },
    };
  }
}
