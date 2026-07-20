/**
 * orchestrator.ts — the Orchestrator Durable Object for the spike.
 *
 * Imports ONLY from ./substrate (the ACL) and ./connectors/* — the D6
 * dependency rule, enforced by scripts/lint-deps.mjs.
 *
 * REVISION NOTE (D7 resolved): the outer loop now dispatches via
 * `admit(specificationId)` -> `startRun(...)`, fire-and-forget and
 * idempotency-keyed on the Specification id. Because startFiber's own
 * promise need not wait for the body to finish (no live caller is assumed),
 * the body persists its own result to `run_result`; `result()` polls it back
 * out. `run()` is a convenience wrapper for checks (S2/S3/S7) that only care
 * about the connector/lineage behavior, not D7's idempotency semantics —
 * it admits with a fresh key each time and polls until the result lands.
 *
 * Prior finding (still true, now exercised correctly): `ctx.snapshot` is
 * non-null only on a genuine recovery re-entry after a TRUE eviction; there
 * is no other way to detect resume with the real FiberContext shape.
 */

import {
  OrchestratorBase,
  type CodeAction,
  type ExecutionTrace,
  type Verdict,
  type RunHandle,
} from "./substrate";
import { ProbeConnector } from "./connectors/probe.codemode";

export interface RunResult {
  recoveredFromSnapshot: unknown | null;
  realInvocations: number;
  trace: ExecutionTrace;
}

export class Orchestrator extends OrchestratorBase {
  private probe = new ProbeConnector(
    this.ctx as unknown as DurableObjectState,
    (this as unknown as { env: unknown }).env,
  );

  protected connectors() {
    return [this.probe];
  }

  // VERIFY: the actual WorkerLoader binding name from your wrangler.jsonc
  // (the commented-out `worker_loaders` entry there must be uncommented and
  // named to match this).
  protected loaderBinding(): unknown {
    return (this as unknown as { env: Record<string, unknown> }).env.LOADER;
  }

  /** Ensure the spike's tables exist once. */
  private ensureSchema() {
    this.sql`CREATE TABLE IF NOT EXISTS lineage (
      seq INTEGER PRIMARY KEY, kind TEXT NOT NULL, at INTEGER NOT NULL, ref TEXT
    )`;
    this.sql`CREATE TABLE IF NOT EXISTS run_result (
      id INTEGER PRIMARY KEY, recoveredFromSnapshot TEXT, realInvocations INTEGER, trace TEXT
    )`;
  }

  /**
   * D7 — the outer per-run loop. Fire-and-forget, idempotency-keyed on the
   * Specification id: a second admit() with the same id returns the
   * EXISTING fiber's status (isNew: false) rather than double-starting.
   * `ctx.snapshot` is non-null only when this dispatch is itself a recovery
   * re-entry after a real eviction.
   */
  async admit(specificationId: string): Promise<RunHandle> {
    this.ensureSchema();
    return this.startRun("probe-run", specificationId, async (ctx) => {
      const recoveredFromSnapshot = ctx.snapshot;

      this.appendEvent({ seq: 1, kind: "stepA", at: Date.now() });
      ctx.stash({ phase: "stepA", at: Date.now() });

      const action: CodeAction = {
        connectors: ["probe"],
        code: `
          const a = await probe.bump({ tag: "call1" });
          const b = await probe.bump({ tag: "call2" });
          return { a, b };
        `,
      };
      const trace = await this.execute(action);
      this.appendEvent({ seq: 2, kind: "executed", at: Date.now() });
      ctx.stash({ phase: "executed", at: Date.now() });

      this.sql`INSERT OR REPLACE INTO run_result (id, recoveredFromSnapshot, realInvocations, trace)
                VALUES (1, ${JSON.stringify(recoveredFromSnapshot)}, ${this.probe.__realInvocations()}, ${JSON.stringify(trace)})`;
    });
  }

  /** Poll the outer loop's persisted result — separate from admit()'s own
   *  quick-resolving dispatch promise, since the body runs fire-and-forget. */
  result(): RunResult | null {
    this.ensureSchema();
    const rows = [...(this.sql`SELECT recoveredFromSnapshot, realInvocations, trace FROM run_result WHERE id = 1` as unknown as
      { recoveredFromSnapshot: string | null; realInvocations: number; trace: string }[])];
    if (!rows.length) return null;
    const r = rows[0];
    return {
      recoveredFromSnapshot: JSON.parse(r.recoveredFromSnapshot ?? "null"),
      realInvocations: r.realInvocations,
      trace: JSON.parse(r.trace),
    };
  }

  /** Convenience for checks that don't test D7's idempotency/fire-and-forget
   *  semantics directly (S2, S3, S7): admit with a fresh key, poll briefly
   *  for the persisted result. */
  async run(): Promise<RunResult> {
    const specId = "adhoc-" + Date.now() + "-" + Math.random().toString(36).slice(2);
    await this.admit(specId);
    for (let i = 0; i < 50; i++) {
      const r = this.result();
      if (r) return r;
      await new Promise((res) => setTimeout(res, 10));
    }
    throw new Error("run(): fire-and-forget result not persisted within poll window");
  }

  /** S5 entrypoint: run an acceptance test at runtime against a tiny artifact. */
  async oracleProbe(): Promise<Verdict> {
    const artifact = { value: 41 };
    return this.runOracle(artifact, {
      name: "value-is-41",
      assertion: "artifact.value === 41",
    });
  }

  /** S4 entrypoint: prove the sandbox has no ambient network. */
  async egressProbe(): Promise<ExecutionTrace> {
    return this.execute({
      connectors: ["probe"],
      code: `
        let blocked = false;
        try { await fetch("https://example.com"); }   // must be blocked (globalOutbound default: null)
        catch { blocked = true; }
        const ok = await probe.bump({ tag: "via-connector" });  // connector egress must work + log
        return { blocked, ok };
      `,
    });
  }

  /** S8 entrypoint: approval-gated effect; returns the pending trace. */
  async approvalProbe(): Promise<ExecutionTrace> {
    return this.execute({
      connectors: ["probe"],
      code: `return await probe.mutate({ payload: "apply-me" });`, // requiresApproval -> pending
    });
  }
}

