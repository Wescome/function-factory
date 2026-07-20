/**
 * substrate.ts — THE ANTI-CORRUPTION LAYER (D6, spike form)
 *
 * This is the ONLY file permitted to import @cloudflare/codemode or `agents`.
 * Every experimental, version-volatile API call lives here behind a stable
 * domain-shaped interface.
 *
 * REVISION NOTE (this pass — D7 resolved): adds startFiber-backed dispatch
 * per the resolved fiber-primitive Disposition (ARCH-KEEL-000 Part D, D7):
 *
 *   The outer Orchestrator loop runs on startFiber(name, fn, {idempotencyKey}),
 *   not runFiber. runFiber's try/finally unconditionally finalizes on ANY
 *   exit (including a thrown error) — it cannot itself survive as a
 *   recoverable interrupted fiber. startFiber is fire-and-forget, backed by
 *   its own durable ledger (cf_agents_fibers), and its idempotencyKey means a
 *   repeat start with the same key returns the EXISTING fiber's status rather
 *   than double-starting — this is the dispatch-idempotency guard on
 *   admission (INTENT), with no separate Claim node and no external lock.
 *
 *   runFiber is retained for bounded, immediate-result operations inside a
 *   single decide() pass where the caller IS still waiting — the canonical
 *   case is the OraclePort verification call, wrapped below in runOracle().
 *
 *   VERIFY: startFiber's exact return shape is modeled here as
 *   { id, isNew, status } from the Disposition's BEHAVIORAL description
 *   (repeat calls with the same idempotencyKey return the existing fiber's
 *   status) — confirm exact field names against the installed .d.ts.
 *   listFibers()/inspectFiber() are likewise modeled from the Disposition's
 *   mention of them, not independently read from source here.
 *
 * Prior-pass fixes (still in effect, verified against agents@0.17.3 /
 * @cloudflare/codemode@0.4.2 directly):
 *   1. FiberContext has NO unstash(). Real shape:
 *        { id, signal, stash(data: unknown): void, snapshot: unknown | null }
 *   2. createCodemodeRuntime(...) has NO .run({code}). Real path:
 *        runtime.tool().execute({ code }, ctx) -> ProxyToolOutput (tagged union)
 *   3. Connectors extend the CodemodeConnector base class, not a bare class.
 *
 * `globalOutbound: null` lives on DynamicWorkerExecutorOptions and IS the
 * documented default, so S4's guarantee holds without setting it explicitly.
 *
 *   grep -n "VERIFY" src/substrate.ts   # what's still unconfirmed
 */

import { Agent } from "agents";
import {
  createCodemodeRuntime,
  DynamicWorkerExecutor,
  type CodemodeConnector,
} from "@cloudflare/codemode";

import type { ProbeConnector } from "./connectors/probe.codemode";

/** Stable shape the domain code depends on. Adapters below fill it in. */
export interface Substrate {
  /** D7 — the outer per-run loop. Fire-and-forget, idempotency-keyed: a
   *  repeat call with the same key returns the EXISTING fiber's status
   *  rather than double-starting. The body's own result is NOT this call's
   *  return value (the caller need not be waiting) — it is persisted by the
   *  body itself and read back separately (see Orchestrator.result()). */
  startRun(name: string, idempotencyKey: string, body: (ctx: FiberCtx) => Promise<void>): Promise<RunHandle>;
  /** Bounded, immediate-result operation inside a single decide() pass.
   *  Resumes after TRUE eviction only — a thrown error inside the fiber body
   *  does NOT leave a recoverable state (its finally always finalizes). */
  runFiber<T>(name: string, body: (ctx: FiberCtx) => Promise<T>): Promise<T>;
  /** D7 introspection: the framework's own fiber ledger. INV-A: plumbing
   *  only — never a domain-facing source of truth. Exposed here solely so
   *  the spike can observe it; domain code should not depend on this shape. */
  listFibers(): unknown[];
  inspectFiber(id: string): unknown;
  /** Append a governance event transactionally with the current transition. */
  appendEvent(e: LineageEvent): void;
  /** Read the ordered event log (single-writer, DO SQLite). */
  events(): LineageEvent[];
  /** Execute one code action in a Dynamic Worker via codemode. */
  execute(action: CodeAction): Promise<ExecutionTrace>;
  /** Run an acceptance test against an artifact AT RUNTIME in a Dynamic Worker. */
  runOracle(artifact: unknown, test: OracleTest): Promise<Verdict>;
  /** Introspect bindings — used by the independence check (S6). */
  bindingNames(): string[];
}

/** D7: the dispatch result of startRun. isNew=false is the load-bearing
 *  signal — it means the idempotencyKey matched an existing fiber and
 *  nothing new was started. */
export interface RunHandle { fiberId: string; isNew: boolean; status: string; }

/** Real FiberContext shape (agents@0.17.3). No unstash — stash() overwrites
 *  the whole checkpoint; `snapshot` is the last stashed value, populated only
 *  when this run is itself a recovery re-entry (else null). */
export interface FiberCtx {
  readonly id: string;
  readonly signal: AbortSignal;
  stash(data: unknown): void;
  readonly snapshot: unknown | null;
}

export interface CodeAction { code: string; connectors: string[]; }

/** Normalized view over the real ProxyToolOutput tagged union. */
export interface ExecutionTrace {
  ok: boolean;
  executionId: string;
  result?: unknown;
  pending?: { seq: number; connector: string; method: string; args: unknown }[];
  error?: string;
  raw: unknown;
}

export interface OracleTest { name: string; assertion: string; }
export interface Verdict { outcome: "pass" | "fail" | "escalate"; ms: number; evidence?: unknown; }
export interface LineageEvent { seq: number; kind: string; at: number; ref?: string; }

/**
 * OrchestratorBase — extend the Agents SDK Agent (the actor substrate; D1),
 * dispatched via startFiber for the outer loop (D7).
 */
export abstract class OrchestratorBase extends Agent<Env> implements Substrate {
  // --- D7: outer per-run loop, fire-and-forget, idempotency-keyed ------------
  async startRun(name: string, idempotencyKey: string, body: (ctx: FiberCtx) => Promise<void>): Promise<RunHandle> {
    // VERIFIED against agents@installed dist (agent-tool-types-*.d.ts +
    // index.js): StartFiberResult is `FiberInspection & { accepted: boolean }`
    // — field is `fiberId`, not `id`; "isNew" doesn't exist, the real signal
    // is `accepted` (true = a new fiber was just created; false = the call
    // matched an existing fiberId/idempotencyKey and returned its inspection
    // without starting anything new). The prior `{ id, isNew }` shape was
    // modeled from the Disposition text, not the SDK, and `isNew ?? true`
    // silently defaulted to true on every call — masking a real dedup miss.
    const handle = await (this as unknown as {
      startFiber(
        name: string,
        fn: (raw: { id: string; signal: AbortSignal; stash(d: unknown): void; snapshot: unknown | null }) => Promise<void>,
        opts: { idempotencyKey: string },
      ): Promise<{ fiberId: string; accepted: boolean; status?: string }>;
    }).startFiber(name, async (raw) => {
      const ctx: FiberCtx = { id: raw.id, signal: raw.signal, stash: (d) => raw.stash(d), snapshot: raw.snapshot };
      return body(ctx);
    }, { idempotencyKey });
    return { fiberId: handle.fiberId, isNew: handle.accepted, status: handle.status ?? "started" };
  }

  listFibers(): unknown[] {
    return (this as unknown as { listFibers?: () => unknown[] }).listFibers?.() ?? [];
  }
  inspectFiber(id: string): unknown {
    return (this as unknown as { inspectFiber?: (id: string) => unknown }).inspectFiber?.(id);
  }

  // --- bounded, immediate-result operation (D7) ------------------------------
  async runFiber<T>(name: string, body: (ctx: FiberCtx) => Promise<T>): Promise<T> {
    return super.runFiber(name, async (raw) => {
      const ctx: FiberCtx = {
        id: raw.id,
        signal: raw.signal,
        stash: (data) => raw.stash(data),
        snapshot: raw.snapshot,
      };
      return body(ctx);
    });
  }

  /**
   * Framework recovery hook (real signature: `Agent.onFiberRecovered`).
   * Fires when an interrupted fiber is detected after a TRUE eviction — never
   * for a normal throw. Default: record the recovery as a lineage event.
   */
  async onFiberRecovered(ctx: {
    id: string; name: string; snapshot: unknown | null; createdAt: number;
    recoveryReason: "interrupted"; [k: string]: unknown;
  }): Promise<void> {
    this.appendEvent({
      seq: -1, // caller-facing sequencing is domain-owned; -1 marks framework-sourced events
      kind: "fiber-recovered",
      at: Date.now(),
      ref: ctx.id,
    });
  }

  // --- lineage event log (D4/S7) ---------------------------------------------
  appendEvent(e: LineageEvent): void {
    this.sql`INSERT INTO lineage (seq, kind, at, ref) VALUES (${e.seq}, ${e.kind}, ${e.at}, ${e.ref ?? null})`;
  }
  events(): LineageEvent[] {
    return this.sql`SELECT seq, kind, at, ref FROM lineage ORDER BY seq` as unknown as LineageEvent[];
  }

  // --- code-as-action (D5/S2/S3/S4/S8) ---------------------------------------
  protected abstract loaderBinding(): unknown; // -> env.LOADER (WorkerLoader)
  protected abstract connectors(): CodemodeConnector[];

  // Lazy, not a class field: base-class field initializers run BEFORE
  // derived-class field initializers (e.g. Orchestrator's `probe`), so an
  // eager `_runtime = createCodemodeRuntime({ connectors: this.connectors() })`
  // here would call the overridden connectors() while its own backing field
  // is still undefined. Deferring construction to first actual use sidesteps
  // the ordering entirely.
  private _runtime: ReturnType<typeof createCodemodeRuntime> | undefined;
  private get runtime() {
    if (!this._runtime) {
      this._runtime = createCodemodeRuntime({
        ctx: this.ctx as unknown as DurableObjectState,
        connectors: this.connectors(),
        executor: new DynamicWorkerExecutor({
          loader: this.loaderBinding() as never, // VERIFY: WorkerLoader type from your wrangler.jsonc binding
          // globalOutbound omitted -> defaults to null (fully isolated), the
          // documented default; S4 does not require setting it explicitly.
        }),
      });
    }
    return this._runtime;
  }

  private _codeTool: ReturnType<ReturnType<typeof createCodemodeRuntime>["tool"]> | undefined;
  private get codeTool() {
    if (!this._codeTool) this._codeTool = this.runtime.tool();
    return this._codeTool;
  }

  async execute(action: CodeAction): Promise<ExecutionTrace> {
    const out = await this.codeTool.execute({ code: action.code }, undefined);
    if (out.status === "completed") {
      return { ok: true, executionId: out.executionId, result: out.result, raw: out };
    }
    if (out.status === "paused") {
      return { ok: false, executionId: out.executionId, pending: out.pending, raw: out };
    }
    return { ok: false, executionId: out.executionId, error: out.error, raw: out };
  }

  // --- runtime oracle (D2/S5 — the pivotal check) ----------------------------
  /** D7: this is the canonical "bounded, immediate-result operation" — wrapped
   *  in runFiber (not startFiber) because the caller, still inside the outer
   *  loop's decide() pass, is actively waiting on this specific result before
   *  the pass can continue. */
  async runOracle(artifact: unknown, test: OracleTest): Promise<Verdict> {
    return this.runFiber("oracle-verify", async () => {
      const t0 = Date.now();
      const out = await this.codeTool.execute({
        code: `
          // runs inside the sandbox against the produced artifact
          const artifact = globalThis.__artifact;
          const pass = (${test.assertion});
          return { pass };
        `,
        // VERIFY: the real ProxyToolInput is just { code: string } — no
        // bindings field. Artifact injection must arrive through a connector
        // call, not a bindings passthrough; this inline reference is flagged,
        // not silently faked, until that connector path is wired.
      } as never, undefined);
      const pass = out.status === "completed" && (out.result as { pass?: boolean } | undefined)?.pass === true;
      return { outcome: pass ? "pass" : "fail", ms: Date.now() - t0, evidence: out };
    });
  }

  // --- independence introspection (S6) ---------------------------------------
  bindingNames(): string[] {
    return Object.keys((this as unknown as { env?: Record<string, unknown> }).env ?? {});
  }
}

// Minimal env shape; expand against wrangler.jsonc bindings.
export interface Env {
  ORCHESTRATOR: DurableObjectNamespace;
  // VERIFY: name this to match wrangler.jsonc's worker_loaders binding.
  LOADER?: unknown;
  [k: string]: unknown;
}

export type { ProbeConnector };

