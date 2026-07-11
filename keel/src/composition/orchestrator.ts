/**
 * orchestrator.ts — the Orchestrator DO (composition root, Ring 2).
 * Wires the frozen ports to their adapters, dispatches via startFiber
 * (idempotency-keyed on the Specification id, D7), and closes the loop (M3):
 * on PAUSE it persists resume context; approve() replays via the port (D8).
 */
import { Agent } from "agents";
import { runLoop, resumeApproved, type RunPorts, type RunTerminal } from "../domain/loop/run";
import type { Specification, SpecificationContent, ContentHash, AnyNode, DomainEvent, VerdictContent } from "../domain/index";
import type { QueryPort, CustodyView, TimelineEntry, ReplaySnapshot, ReplayConsistency, CrossRunRecord } from "../domain/index";
import { timeline as projTimeline, replayTo as projReplayTo, verifyReplay as projVerifyReplay, crossRunRecord as projCrossRun } from "../domain/index";
import { runSpecLoop, templateDeriver } from "../domain/index";
import type { Deriver, GatePolicy, SpecLoopBound, SpecLoopCtx, SpecLoopSummary, BacklogStore, BacklogEntry, BacklogStatus } from "../domain/index";
import { InMemoryBacklog } from "../adapters/spec-loop/in-memory-backlog";
import { D1BacklogAdapter } from "../adapters/spec-loop/d1-backlog.adapter";
import { makeRuntime, type CodemodeHandle } from "../adapters/codemode/runtime";
import { EchoConnector } from "../adapters/codemode/echo.codemode";
import { BillingConnector } from "../adapters/codemode/billing.codemode";
import { GateConnector } from "../adapters/codemode/gate.codemode";
import { ForeignMcpConnector } from "../adapters/foreign/foreign-mcp.codemode";
import { FxConnector } from "../adapters/fx/fx.codemode";
import { GeoConnector } from "../adapters/geo/geo.codemode";
import { WeatherConnector } from "../adapters/weather/weather.codemode";
import { LedgerConnector } from "../adapters/ledger/ledger.codemode";
import { DoLedgerStore } from "../adapters/ledger/do-ledger.adapter";
import { foreignConnectorDoc } from "../adapters/foreign/mcp-call";
import { CallRecorder } from "../adapters/codemode/call-recorder";
import { CodemodeExecutionAdapter } from "../adapters/codemode/code-execution.adapter";
import { FaultyExecutionAdapter } from "../adapters/codemode/faulty-execution.adapter";
import { SuiteOracleAdapter } from "../adapters/oracle/suite-oracle.adapter";
import { InMemorySuiteRegistry } from "../adapters/oracle/suite";
import { LineageDoAdapter } from "../adapters/persistence/lineage-do.adapter";
import { D1CrossRunAdapter } from "../adapters/persistence/d1-cross-run.adapter";
import { ScriptedModelAdapter } from "../adapters/model/scripted-model.adapter";
import { FixedCodeModelAdapter } from "../adapters/model/fixed-code.adapter";
import { GatewayModelAdapter, BUILTIN_CONNECTOR_DOCS } from "../adapters/model/gateway-model.adapter";
import { suiteIsMetamorphic } from "../adapters/oracle/suite";
import type { ModelPort } from "../domain/index";

export interface Env {
  ORCHESTRATOR: DurableObjectNamespace;
  LOADER: unknown;
  // Real model via AI Gateway (optional). When AI_GATEWAY_URL + AI_API_KEY are
  // set, non-reserved intents use the real model; otherwise scripted. Local/CI
  // never sets these, so the deterministic suite always uses the scripted model.
  AI_GATEWAY_URL?: string;
  AI_MODEL?: string;
  AI_API_KEY?: string;
  DB?: D1Database; // cross-run index (optional; emission is skipped if absent)
  // Phase 6b: the allowlisted foreign MCP server. Optional; the foreign
  // connector is only wired in when set (mirrors the AI Gateway opt-in pattern).
  FOREIGN_MCP_URL?: string;
  [k: string]: unknown;
}

// Intents driven by the deterministic scripted model (smoke/CI). Everything
// else is a real task for the gateway model when configured.
const RESERVED_INTENTS = new Set([
  "echo 42", "converge", "never", "approve",
  "uc-001", "uc-002", "uc-003", "degraded", "multi", "amend-demo", "amend-blind-sim",
  "mr-correct", "mr-cheat", "regress-demo", "stale-tier",
  "foreign-lookup", "foreign-poisoned", "foreign-effectful", "foreign-denied",
  "fx-correct", "fx-fabricate", "fx-rawshape",
  "geo-correct", "geo-topfail", "geo-fabricate", "ledger-create", "ledger-duplicate",
]);

// The foreign connector's KEEL-authored tool config — the SAME text is used to
// (a) wire the connector's own tools() and (b) build the model-facing doc
// (foreignConnectorDoc), so what the sandbox exposes and what the model reads
// about it can never drift apart. NEVER sourced from the server's tools/list.
const FOREIGN_LOOKUP_SCHEMA = { fields: { value: { type: "number" as const }, ok: { type: "boolean" as const } } };
const FOREIGN_TOOLS = {
  lookup: { description: "KEEL: look up a value from the allowlisted foreign service.", responseSchema: FOREIGN_LOOKUP_SCHEMA },
  lookupPoisoned: { description: "KEEL: look up a value (poisoned-response fixture — the mock injects a free-text field).", responseSchema: FOREIGN_LOOKUP_SCHEMA },
  effectfulOp: { description: "KEEL: a consequential foreign operation.", responseSchema: { fields: { done: { type: "boolean" as const } } }, requiresApproval: true },
};

export class Orchestrator extends Agent<Env> implements QueryPort {
  private readonly suites = new InMemorySuiteRegistry();
  private readonly recorder = new CallRecorder();
  private readonly memBacklog = new InMemoryBacklog();
  private __rt?: CodemodeHandle;
  private get rt(): CodemodeHandle {
    if (!this.__rt) {
      const connectors: import("@cloudflare/codemode").CodemodeConnector<unknown>[] = [
        new EchoConnector(this.ctx as never, this.env as never),
        new GateConnector(this.ctx as never, this.env as never),
        new BillingConnector(this.ctx, this.env, this.recorder),
        new FxConnector(this.ctx, this.env, this.recorder),
        new GeoConnector(this.ctx, this.env, this.recorder),
        new WeatherConnector(this.ctx, this.env, this.recorder),
        new LedgerConnector(this.ctx, this.env, this.recorder, new DoLedgerStore(this.sql.bind(this) as never)),
      ];
      const foreignUrl = (this.env as Env).FOREIGN_MCP_URL;
      if (foreignUrl) {
        connectors.push(
          new ForeignMcpConnector(this.ctx, this.env, {
            connectorName: "foreign",
            serverUrl: foreignUrl,
            allow: { servers: [foreignUrl] }, // exact-origin allowlist: the real, configured server
            recorder: this.recorder,
            tools: FOREIGN_TOOLS,
          }),
          // A second instance of the SAME real, reachable server, deliberately
          // left OFF this one's own allowlist — proves rejection is the
          // allowlist doing its job, not the server being unreachable/bogus.
          // Test-only fixture; deliberately NOT given a model-facing doc below.
          new ForeignMcpConnector(this.ctx, this.env, {
            connectorName: "foreignDenied",
            serverUrl: foreignUrl,
            allow: { servers: ["https://not-allowlisted.example"] },
            recorder: this.recorder,
            tools: { lookup: { description: "KEEL: denied-allowlist fixture.", responseSchema: FOREIGN_LOOKUP_SCHEMA } },
          }),
        );
      }
      this.__rt = makeRuntime(this.ctx as unknown as DurableObjectState, (this.env as Env).LOADER, connectors);
    }
    return this.__rt;
  }

  private ensureSchema() {
    this.sql`CREATE TABLE IF NOT EXISTS run_terminal (id INTEGER PRIMARY KEY, state TEXT, verdict TEXT, execution_id TEXT)`;
    this.sql`CREATE TABLE IF NOT EXISTS pending_run (id INTEGER PRIMARY KEY, action_id TEXT, execution_id TEXT, attempt INTEGER)`;
  }

  private repo() { return new LineageDoAdapter(this.sql.bind(this) as never); }

  private model(intent: string, mr = false): ModelPort {
    const env = this.env as Env;
    if (env.AI_GATEWAY_URL && env.AI_API_KEY && !RESERVED_INTENTS.has(intent)) {
      const connectorDocs = [...BUILTIN_CONNECTOR_DOCS];
      // OD-6b-4: a live model can't autonomously pick the foreign connector
      // unless its doc is in the prompt. Built from the SAME FOREIGN_TOOLS
      // config the connector itself uses — KEEL-authored text, never the
      // server's own tools/list (foreignConnectorDoc has no path to that text).
      if (env.FOREIGN_MCP_URL) {
        connectorDocs.push(foreignConnectorDoc("foreign", Object.entries(FOREIGN_TOOLS).map(([method, t]) => ({
          method, description: t.description, responseSchema: t.responseSchema,
        }))));
      }
      return new GatewayModelAdapter({
        url: env.AI_GATEWAY_URL,
        model: env.AI_MODEL ?? "gpt-4o-mini",
        apiKey: env.AI_API_KEY,
        connectorDocs,
        metamorphic: mr,
      });
    }
    return new ScriptedModelAdapter();
  }

  private ports(opts: { degraded?: boolean; intent: string; oracleRef?: string }): RunPorts {
    const wrapMr = opts.oracleRef ? suiteIsMetamorphic(opts.oracleRef) : false;
    return {
      model: this.model(opts.intent, wrapMr),
      // Degraded mode: fault-inject the executor. Oracle stays real so
      // verification keeps serving; the run must fail closed to ESCALATE.
      exec: opts.degraded ? new FaultyExecutionAdapter() : new CodemodeExecutionAdapter(this.rt, { wrapMr, recorder: this.recorder }),
      oracle: new SuiteOracleAdapter(this.rt, this.suites),
      repo: this.repo(),
      now: () => Date.now(),
    };
  }

  /** Fan this run's cross-run record to the shared D1 index. Secondary read
   *  model: env-gated, and a failure here never breaks the run (INV-A). */
  private async emitCrossRun(): Promise<void> {
    const env = this.env as Env;
    if (!env.DB) return;
    try {
      const rec = await this.crossRun();
      if (rec.runId) await new D1CrossRunAdapter(env.DB).record(rec);
    } catch {
      // the per-run lineage is the source of truth; the index is best-effort
    }
  }

  private persistTerminal(res: RunTerminal) {
    if (res.state === "PAUSE") {
      this.sql`INSERT OR REPLACE INTO pending_run (id, action_id, execution_id, attempt) VALUES (1, ${res.action}, ${res.executionId}, ${res.attempt})`;
      this.sql`INSERT OR REPLACE INTO run_terminal (id, state, verdict, execution_id) VALUES (1, 'PAUSE', NULL, ${res.executionId})`;
    } else {
      const verdict = "verdict" in res ? res.verdict ?? null : null;
      this.sql`INSERT OR REPLACE INTO run_terminal (id, state, verdict, execution_id) VALUES (1, ${res.state}, ${JSON.stringify(verdict)}, NULL)`;
    }
  }

  /** INTENT + idempotent admission (D7). */
  async admit(content: SpecificationContent): Promise<{ accepted: boolean; status: string; runId: string }> {
    this.ensureSchema();
    const repo = this.repo();
    const spec = await repo.append<Specification>({ kind: "Specification", content, provenance: [] });
    await repo.emit({ type: "RunAdmitted", at: Date.now(), run: spec.id, specification: spec.id, accepted: true });

    const handle = await (this as unknown as {
      startFiber(name: string, fn: (raw: unknown) => Promise<void>, opts: { idempotencyKey: string }): Promise<{ accepted: boolean; status: string }>;
    }).startFiber("run", async () => {
      const res = await runLoop(spec, this.ports({ degraded: content.intent === "degraded", intent: content.intent, oracleRef: content.oracleRef }));
      await this.emitCrossRun();
      this.persistTerminal(res);
    }, { idempotencyKey: spec.id });

    return { accepted: handle.accepted, status: handle.status, runId: spec.id };
  }

  /** Improvement-loop replay (BRIEF-KEEL-IMPROVE-001): re-run a CRYSTALLIZED
   *  procedure — fixed code, no model call — through the SAME anchored oracle
   *  this DO's normal runs use. Synchronous (awaited directly, not startFiber)
   *  since the caller needs the verdict immediately to feed evaluateProcedure.
   *  This DO is meant to be a fresh, dedicated replay instance (one per
   *  candidate), so it still holds to one-Specification-per-DO. */
  async replayProcedure(content: SpecificationContent, code: string): Promise<{ accepted: boolean; attempts: number; effectful: boolean }> {
    this.ensureSchema();
    const repo = this.repo();
    const spec = await repo.append<Specification>({ kind: "Specification", content, provenance: [] });
    await repo.emit({ type: "RunAdmitted", at: Date.now(), run: spec.id, specification: spec.id, accepted: true });

    const wrapMr = content.oracleRef ? suiteIsMetamorphic(content.oracleRef) : false;
    const ports: RunPorts = {
      model: new FixedCodeModelAdapter(code, content.connectors),
      exec: new CodemodeExecutionAdapter(this.rt, { wrapMr, recorder: this.recorder }),
      oracle: new SuiteOracleAdapter(this.rt, this.suites),
      repo,
      now: () => Date.now(),
    };
    const res = await runLoop(spec, ports);
    this.persistTerminal(res);
    const attempts = "verdict" in res && res.verdict ? res.verdict.attempt : content.attemptBudget;
    // INV-IMPROVE-EFFECT-HUMAN wiring: detect effectful either declaratively
    // (approvalGated non-empty) or structurally (replay actually stalled at
    // PAUSE — replay never auto-approves, so this is the observable symptom).
    const effectful = content.approvalGated.length > 0 || res.state === "PAUSE";
    return { accepted: res.state === "ACCEPT", attempts, effectful };
  }

  /** AMENDMENT A2 (OD-IMP-2): the human-authorized replay for an effectful
   *  (`disposition:"human"`) candidate. The human authorizes the EFFECT (by
   *  triggering this call at all); the oracle still gates CORRECTNESS (the run
   *  must independently verify-ACCEPT after the approval, same as any other
   *  replay). This DO is a fresh, dedicated replay instance with its own
   *  isolated storage (including its own LedgerConnector store, via
   *  DoLedgerStore(this.sql...) in the connector list) — the effect performed
   *  here to let the oracle judge it never touches production state. */
  async replayProcedureWithApproval(content: SpecificationContent, code: string): Promise<{ accepted: boolean; attempts: number }> {
    this.ensureSchema();
    const repo = this.repo();
    const spec = await repo.append<Specification>({ kind: "Specification", content, provenance: [] });
    await repo.emit({ type: "RunAdmitted", at: Date.now(), run: spec.id, specification: spec.id, accepted: true });

    const wrapMr = content.oracleRef ? suiteIsMetamorphic(content.oracleRef) : false;
    const ports: RunPorts = {
      model: new FixedCodeModelAdapter(code, content.connectors),
      exec: new CodemodeExecutionAdapter(this.rt, { wrapMr, recorder: this.recorder }),
      oracle: new SuiteOracleAdapter(this.rt, this.suites),
      repo,
      now: () => Date.now(),
    };
    let res = await runLoop(spec, ports);
    if (res.state === "PAUSE") {
      res = await resumeApproved(spec, ports, { action: res.action, executionId: res.executionId, attempt: res.attempt });
    }
    this.persistTerminal(res);
    const attempts = "verdict" in res && res.verdict ? res.verdict.attempt : content.attemptBudget;
    return { accepted: res.state === "ACCEPT", attempts };
  }

  /** Approve a paused run (D8: replay-resume). Reloads spec + action from
   *  lineage — INV-A, the lineage graph is the source of truth. */
  async approve(): Promise<{ resumed: boolean; state?: string }> {
    this.ensureSchema();
    const pend = [...this.sql<{ action_id: string; execution_id: string; attempt: number }>`
      SELECT action_id, execution_id, attempt FROM pending_run WHERE id = 1`][0];
    if (!pend) return { resumed: false };

    const repo = this.repo();
    const nodes = await repo.loadRun();
    const specNode = nodes.find((n) => n.kind === "Specification") as Specification | undefined;
    if (!specNode) return { resumed: false };

    const res = await resumeApproved(specNode, this.ports({ intent: specNode.content.intent, oracleRef: specNode.content.oracleRef }), {
      action: pend.action_id as ContentHash,
      executionId: pend.execution_id,
      attempt: pend.attempt,
    });
    await this.emitCrossRun();
    this.persistTerminal(res);
    if (res.state !== "PAUSE") this.sql`DELETE FROM pending_run WHERE id = 1`;
    return { resumed: true, state: res.state };
  }

  // --- Phase 6a spec-loop (substrate wiring; the domain logic is frozen) -----
  private backlogFor(runId: string): BacklogStore {
    const env = this.env as Env;
    return env.DB ? new D1BacklogAdapter(env.DB, runId) : this.memBacklog;
  }

  private readonly SPEC_LOOP_BOUND: SpecLoopBound = { maxDepth: 3, maxFanout: 3, budget: 20 };
  private readonly SPEC_LOOP_POLICY: GatePolicy = { effectful: ["billing", "gate"] };
  private readonly SPEC_LOOP_LEASE_MS = 15 * 60 * 1000;

  /** The human-authored root: the one Specification with no derivedFrom
   *  (INV-SPEC-HUMAN-ROOT — never seed the loop from a derived spec). */
  private async findRoot(): Promise<Specification | undefined> {
    const repo = this.repo();
    const nodes = await repo.loadRun();
    return nodes.find((n) => n.kind === "Specification" && !(n.content as SpecificationContent).derivedFrom) as Specification | undefined;
  }

  /** A derived spec's own DO stub (its own name, its own single-Specification
   *  lineage) — NOT this DO. OD-6a-5: appending a derived spec into the ROOT's
   *  own lineage graph would give this DO multiple Specification nodes, which
   *  the four read methods (readRun/timeline/verifyReplay/crossRun) don't
   *  expect (they take nodes[0] of kind Specification). Root cause is the
   *  wiring, not the reads — so each derived spec runs as its own child run in
   *  its own DO instead, keeping "one Specification per DO" true everywhere. */
  private childStub(name: string): { admit(c: unknown): Promise<{ runId: string }> } {
    const env = this.env as Env;
    const ns = env.ORCHESTRATOR;
    return ns.get(ns.idFromName(name)) as unknown as { admit(c: unknown): Promise<{ runId: string }> };
  }

  /** Best-effort: record the derivation link in the cross-run index (D1),
   *  instead of as an in-DO edge that couldn't resolve across DO boundaries
   *  anyway. Independent of the child's OWN (untouched) emitCrossRun() call —
   *  whichever writes first, the other's ON CONFLICT UPDATE never clobbers it. */
  private async recordDependsOn(runId: string, parent: string, root: string): Promise<void> {
    const env = this.env as Env;
    if (!env.DB) return;
    try {
      await new D1CrossRunAdapter(env.DB).recordDependsOn(runId, parent, root);
    } catch {
      // the per-run lineage is the source of truth; the index is best-effort
    }
  }

  /** Drive the meta-loop from this run's human-authored root. Each auto-admitted
   *  derived spec is admitted as its OWN run, in its OWN DO, via the exact same
   *  admit() entry point a human POST /admit uses — so it executes exactly like
   *  a human-admitted spec, including its own background execution and its own
   *  cross-run record. The derivation link itself is recorded in the cross-run
   *  index (D1), not as an in-DO edge (OD-6a-5). */
  async derive(): Promise<(SpecLoopSummary & { admittedRuns: { doName: string; runId: string; servesClause?: string }[] }) | { error: string }> {
    this.ensureSchema();
    const rootNode = await this.findRoot();
    if (!rootNode) return { error: "no human-authored root Specification found for this run" };
    const root = rootNode.content as SpecificationContent;

    // Content-object identity is preserved through runSpecLoop's BFS (the exact
    // `parent`/`cand` references it passes to deriver.derive/ctx.admit are the
    // same ones it received), so a WeakMap from content -> runId lets the
    // wiring recover real ids without changing the pure loop's signature.
    const idOf = new WeakMap<SpecificationContent, string>();
    idOf.set(root, rootNode.id);
    const admittedRuns: { doName: string; runId: string; servesClause?: string }[] = [];

    const deriver: Deriver = {
      derive: (parent, r) => {
        const parentId = idOf.get(parent) ?? rootNode.id;
        // Stamp derivedFrom here, before the gate/backlog ever see the
        // candidate, so a later backlog disposal can record the same link
        // without needing separate parent-tracking state.
        return templateDeriver.derive(parent, r).map((c) => ({ ...c, derivedFrom: { parent: parentId, root: rootNode.id } }));
      },
    };

    const ctx: SpecLoopCtx = {
      deriver,
      policy: this.SPEC_LOOP_POLICY,
      backlog: this.backlogFor(rootNode.id),
      bound: this.SPEC_LOOP_BOUND,
      leaseMs: this.SPEC_LOOP_LEASE_MS,
      now: () => Date.now(),
      admit: async (spec, parent) => {
        const parentId = idOf.get(parent) ?? rootNode.id;
        const doName = `derived-${crypto.randomUUID()}`;
        const { runId } = await this.childStub(doName).admit(spec);
        idOf.set(spec, runId);
        admittedRuns.push({ doName, runId, servesClause: spec.servesClause });
        await this.recordDependsOn(runId, parentId, rootNode.id);
      },
    };

    const summary = await runSpecLoop(root, ctx);
    return { ...summary, admittedRuns };
  }

  async listBacklog(): Promise<readonly BacklogEntry[]> {
    const rootNode = await this.findRoot();
    if (!rootNode) return [];
    const backlog = this.backlogFor(rootNode.id);
    await backlog.expireStale(Date.now()); // INV-SPEC-LEASED: fail-closed on read
    return backlog.listPending();
  }

  /** Human disposition of a deferred (human-preapproval) spec. "admitted" runs
   *  it the same way derive()'s auto-admit branch does: its own DO, its own
   *  admit(), the link recorded in the cross-run index (the candidate already
   *  carries derivedFrom, stamped by derive()'s wrapping deriver before it ever
   *  reached the backlog). */
  async disposeBacklog(id: string, status: BacklogStatus): Promise<{ disposed: boolean; doName?: string; runId?: string }> {
    const rootNode = await this.findRoot();
    if (!rootNode) return { disposed: false };
    const backlog = this.backlogFor(rootNode.id);
    const pending = await backlog.listPending();
    const entry = pending.find((e) => e.id === id);
    if (!entry) return { disposed: false };
    await backlog.dispose(id, status);
    if (status === "admitted") {
      const parentId = entry.spec.derivedFrom?.parent ?? rootNode.id;
      const doName = `derived-${crypto.randomUUID()}`;
      const { runId } = await this.childStub(doName).admit(entry.spec);
      await this.recordDependsOn(runId, parentId, rootNode.id);
      return { disposed: true, doName, runId };
    }
    return { disposed: true };
  }

  async result(): Promise<{ state: string | null; verdict: unknown; executionId: string | null; nodeKinds: string[] } | null> {
    this.ensureSchema();
    const rows = [...this.sql<{ state: string; verdict: string; execution_id: string | null }>`SELECT state, verdict, execution_id FROM run_terminal WHERE id = 1`];
    const kinds = [...this.sql<{ kind: string }>`SELECT kind FROM lineage_nodes`].map((r) => r.kind);
    const r = rows[0];
    if (!r) return kinds.length ? { state: null, verdict: null, executionId: null, nodeKinds: kinds } : null;
    return { state: r.state, verdict: JSON.parse(r.verdict ?? "null"), executionId: r.execution_id, nodeKinds: kinds };
  }

  // --- QueryPort (M4, read side) --------------------------------------------
  private async loadNodesEvents(): Promise<{ nodes: readonly AnyNode[]; events: readonly DomainEvent[]; spec?: Specification }> {
    const repo = this.repo();
    const nodes = await repo.loadRun();
    const events = await (repo as unknown as { readEvents(): Promise<readonly DomainEvent[]> }).readEvents();
    const spec = nodes.find((n) => n.kind === "Specification") as Specification | undefined;
    return { nodes, events, spec };
  }

  async readRun(): Promise<CustodyView> {
    const { nodes, events, spec } = await this.loadNodesEvents();
    const terminal = events.some((e) => e.type === "RunAccepted") ? "ACCEPT"
      : events.some((e) => e.type === "RunEscalated") ? "ESCALATE"
      : events.some((e) => e.type === "ActionPaused") ? "PAUSE" : null;
    return {
      runId: spec ? spec.id : null,
      nodes: nodes.map((n) => ({ id: n.id, kind: n.kind })),
      events: events.length,
      terminal,
    };
  }

  async timeline(): Promise<readonly TimelineEntry[]> {
    const { events } = await this.loadNodesEvents();
    return projTimeline(events);
  }

  async replayTo(index: number): Promise<ReplaySnapshot> {
    const { nodes, events } = await this.loadNodesEvents();
    return projReplayTo(events, nodes, index);
  }

  async verifyReplay(): Promise<ReplayConsistency> {
    const { events, spec } = await this.loadNodesEvents();
    const budget = spec?.content.attemptBudget ?? 0;
    return projVerifyReplay(events, budget);
  }

  async crossRun(): Promise<CrossRunRecord> {
    const { nodes, events, spec } = await this.loadNodesEvents();
    return projCrossRun((spec?.id ?? ("" as ContentHash)), spec?.content.intent ?? "", events, nodes);
  }

  /** Read-only: full lineage node content (id, kind, content, provenance) for
   *  the run. Backs GET /debug/nodes — lets an operator see the exact code the
   *  model generated and every recorded artifact. Read-only; INV-A holds. */
  async dumpNodes(): Promise<readonly unknown[]> {
    const { nodes } = await this.loadNodesEvents();
    return nodes;
  }

  /** The most recent Verdict's content — lets callers see per-criterion results
   *  and the outcome the real oracle assigned. */
  async lastVerdict(): Promise<VerdictContent | null> {
    const { nodes, events } = await this.loadNodesEvents();
    const last = [...events].reverse().find((e) => e.type === "VerdictEmitted");
    if (!last || last.type !== "VerdictEmitted") return null;
    const n = nodes.find((x) => x.id === last.verdict);
    return n ? (n.content as VerdictContent) : null;
  }
}
