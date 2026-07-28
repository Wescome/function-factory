/**
 * orchestrator.ts — the Orchestrator DO (composition root, Ring 2).
 * Wires the frozen ports to their adapters, dispatches via startFiber
 * (idempotency-keyed on the Specification id, D7), and closes the loop (M3):
 * on PAUSE it persists resume context; approve() replays via the port (D8).
 */
import { Agent } from "agents";
import { Workspace } from "@cloudflare/shell";
import { runLoop, resumeApproved, type RunPorts, type RunTerminal } from "../domain/loop/run";
import type { Specification, SpecificationContent, ContentHash, AnyNode, DomainEvent, VerdictContent } from "../domain/index";
import type { QueryPort, CustodyView, TimelineEntry, ReplaySnapshot, ReplayConsistency, CrossRunRecord } from "../domain/index";
import { timeline as projTimeline, replayTo as projReplayTo, verifyReplay as projVerifyReplay, crossRunRecord as projCrossRun } from "../domain/index";
import { runSpecLoop, templateDeriver, requiresApprovalFor, decideDecomp, failureToEvidence } from "../domain/index";
import type { Deriver, DerivationEvidence, GatePolicy, SpecLoopBound, SpecLoopCtx, SpecLoopSummary, BacklogStore, BacklogEntry, BacklogStatus, DecompDecision } from "../domain/index";
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
import { WorkspaceStateConnector, WorkspaceGitConnector } from "../adapters/workspace/workspace.codemode";
import { SandboxConnector } from "../adapters/sandbox/sandbox.codemode";
import type { Sandbox } from "@cloudflare/sandbox";
import { StoreConnector } from "../adapters/ledger/store.codemode";
import { DoLedgerStore } from "../adapters/ledger/do-ledger.adapter";
import { foreignConnectorDoc } from "../adapters/foreign/mcp-call";
import { CallRecorder } from "../adapters/codemode/call-recorder";
import { CodemodeExecutionAdapter } from "../adapters/codemode/code-execution.adapter";
import { FaultyExecutionAdapter } from "../adapters/codemode/faulty-execution.adapter";
import { SuiteOracleAdapter } from "../adapters/oracle/suite-oracle.adapter";
import { SandboxOracleAdapter } from "../adapters/oracle/sandbox-oracle.adapter";
import { GroundingGateAdapter } from "../adapters/grounding/grounding-gate.adapter";
import { ScriptedJudgeAdapter } from "../adapters/grounding/scripted-judge.adapter";
import { InMemorySuiteRegistry } from "../adapters/oracle/suite";
import { LineageDoAdapter } from "../adapters/persistence/lineage-do.adapter";
import { D1CrossRunAdapter } from "../adapters/persistence/d1-cross-run.adapter";
import { ScriptedModelAdapter } from "../adapters/model/scripted-model.adapter";
import { FixedCodeModelAdapter } from "../adapters/model/fixed-code.adapter";
import { GatewayModelAdapter, BUILTIN_CONNECTOR_DOCS } from "../adapters/model/gateway-model.adapter";
import { D1SkillStoreAdapter } from "../adapters/skill/d1-skill-store.adapter";
import { suiteIsMetamorphic, compileComposition, checkComposesAnchor, compileSeam, checkSeamAnchor } from "../adapters/oracle/suite";
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
  // PLAYBOOK-KEEL-WRITE-ROLLBACK-001 (B.3): server-side-only auth for
  // git.push. Optional; injected into the git connector's push calls so
  // generated code never supplies or sees a token. Absent locally/CI.
  GIT_PUSH_TOKEN?: string;
  // PLAYBOOK-KEEL-RUN-SUITE-001 (A3, Tier 4): the Sandbox container
  // binding. Optional -- Tier 4 is scoped to code + wiring here; deploying
  // a real container (Dockerfile, wrangler `containers` config, Docker
  // locally to test) is its own infra decision, not made by this playbook.
  // Absent -> the sandbox connector isn't wired in and `runSuite`-routed
  // specs escalate (no recorded call to verify against), same fail-closed
  // shape SandboxOracleAdapter already gives a malformed/missing call.
  SANDBOX?: DurableObjectNamespace<Sandbox>;
  [k: string]: unknown;
}

// Intents driven by the deterministic scripted model (smoke/CI). Everything
// else is a real task for the gateway model when configured.
const RESERVED_INTENTS = new Set([
  "echo 42", "converge", "never", "approve",
  "uc-001", "uc-002", "uc-003", "degraded", "multi", "amend-demo", "amend-blind-sim",
  "mr-correct", "mr-cheat", "family-scalar-demo", "regress-demo", "stale-tier",
  "foreign-lookup", "foreign-poisoned", "foreign-effectful", "foreign-denied", "foreign-upsert",
  "fx-correct", "fx-fabricate", "fx-rawshape",
  "geo-correct", "geo-topfail", "geo-fabricate",
  "store-ensure", "store-append-create", "store-append-duplicate",
  "workspace-read-test",
  "wr-clean-test",
  "run-real-suite-test",
  // PLAYBOOK-KEEL-COMPOSE-ANCHOR: templateDerive rewrites a child's intent to
  // "<parent.intent> — sub-goal: ... <clause statement>" — these are the
  // exact rewritten strings for the deterministic anchor-test fixture, so the
  // live worker exercises the same scripted (non-model) path the vitest
  // suite does, no real-model variance in the demo.
  "compose-anchor-test — sub-goal: return a result object with the field(s) described by: R1 marker",
  "compose-anchor-test — sub-goal: return a result object with the field(s) described by: R2 marker",
  "compose-anchor-test — sub-goal: return a result object with the field(s) described by: R2 marker mismatch",
  // PLAYBOOK-KEEL-SEAM: same discipline, for the seam-anchor-test fixture
  // and the "both legs together" fixture riding on compose-anchor-test.
  "seam-anchor-test — sub-goal: return a result object with the field(s) described by: S1 marker",
  "seam-anchor-test — sub-goal: return a result object with the field(s) described by: S2 marker match",
  "seam-anchor-test — sub-goal: return a result object with the field(s) described by: S2 marker mismatch",
  "compose-anchor-test — sub-goal: return a result object with the field(s) described by: S1 marker",
  "compose-anchor-test — sub-goal: return a result object with the field(s) described by: S2 marker mismatch",
  // PLAYBOOK-KEEL-SPANNING: deterministic — see scripted-model.adapter.ts.
  "spanning-anchor-test — sub-goal: return a result object with the field(s) described by: A1 marker",
  "spanning-anchor-test — sub-goal: return a result object with the field(s) described by: A9 marker",
  "spanning-anchor-test — sub-goal: return a result object with the field(s) described by: A2 marker (spanning, never satisfied)",
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
  // BRIEF-KEEL-CONNECTOR-DESCRIPTOR-001 v1.1 live milestone: a merged foreign
  // PUT (write-idempotent, by-claim) — `requiresApproval` is DERIVED, not
  // hand-set like `effectfulOp` above, so it PAUSEs (unattested) or
  // auto-executes (attested) purely off `registry.ts`'s provenance/attestation
  // table (INV-DESC-FOREIGN-IDEMPOTENCE-UNOWNED, live).
  upsertRecord: {
    description: "KEEL: upsert a record by id (foreign-claimed idempotent).",
    responseSchema: { fields: { ok: { type: "boolean" as const } } },
    requiresApproval: requiresApprovalFor("foreign", "upsertRecord"),
  },
};

/** PLAYBOOK-KEEL-JOIN: one derived child's read-back. Judges nothing — see
 *  `Orchestrator.join()`. `observed` is an explicit present/absent pair
 *  (never coalesced to `null`/`{}`) so "not finished" (`terminal: null`),
 *  "no observe declared for this clause" (`observable: false`), and "observe
 *  declared but produced nothing" (`observable: true`, `observed.present:
 *  false`) stay three distinguishable states, not one silence. */
export interface JoinChildReport {
  readonly runId: string;
  readonly doName: string;
  readonly servesClause: string | null;
  readonly parentRunId: string;
  readonly terminal: string | null;
  readonly outcome: string | null;
  readonly observable: boolean;
  readonly observed: { readonly present: true; readonly value: unknown } | { readonly present: false };
  /** PLAYBOOK-KEEL-DERIV-AMEND: this child's OWN spanning-uncheckable ids
   *  (PLAYBOOK-KEEL-SPANNING-CHECKABILITY, `evidence.spanningUncheckable`
   *  from its own verdict) — a per-run detail `join()` didn't surface
   *  before, needed here so a decomposition-level re-derivation can carry it
   *  forward as `DerivationEvidence`. Empty (never absent) when the child
   *  hasn't finished or has no verdict. */
  readonly spanningUncheckable: readonly string[];
}

/** PLAYBOOK-KEEL-COMPOSE: one parent cross-cut clause's verdict. `outputs` is
 *  what was composed — the produced values the relation read, keyed by
 *  servesClause — never an expected answer (INV-ORACLE-BLIND holds up-leg).
 *  `unverifiable` covers both "a required child's clause isn't observable"
 *  (the vacuity gate) and "the sandbox didn't complete" — never a pass. */
export interface ComposeClauseVerdict {
  readonly criterionId: string;
  readonly outcome: "pass" | "fail" | "unverifiable" | "error";
  readonly reason?: string;
  readonly outputs: Record<string, unknown>;
}

/** PLAYBOOK-KEEL-DERIV-AMEND: one re-derivation attempt's full record —
 *  every input `decideDecomp` saw, plus its decision and the evidence that
 *  PRODUCED this attempt (not the evidence it produces for the next one) —
 *  so a human (or a report) can read the whole sequence: what failed, what
 *  was carried forward, what happened next. */
export interface DerivAmendAttempt {
  readonly attempt: number;
  readonly derivationEscalated: boolean;
  readonly coverageGap?: readonly string[];
  readonly clauses: readonly ComposeClauseVerdict[];
  readonly seams: readonly ComposeClauseVerdict[];
  readonly evidenceUsed: DerivationEvidence | undefined;
  readonly decision: DecompDecision;
}

export class Orchestrator extends Agent<Env> implements QueryPort {
  private readonly suites = new InMemorySuiteRegistry();
  private readonly recorder = new CallRecorder();
  private readonly memBacklog = new InMemoryBacklog();
  private __rt?: CodemodeHandle;
  private __ws?: Workspace;
  /** PLAYBOOK-KEEL-WORKSPACE-001 (B.2): one Workspace on the Orchestrator,
   *  backed by the DO's own SQLite — not keyed per slice (a later playbook).
   *  No R2 bucket is bound in wrangler.jsonc; files spill to inline SQLite
   *  storage under the (default 1.5MB) inlineThreshold, fine for this spike. */
  private get workspace(): Workspace {
    if (!this.__ws) {
      const storage = this.ctx.storage;
      this.__ws = new Workspace({ sql: storage.sql, name: () => this.name });
    }
    return this.__ws;
  }
  /** The raw `SqlStorage.exec` (positional params, preserves `rowsWritten`)
   *  — DoLedgerStore.ensure's atomicity proof needs `rowsWritten` off the
   *  cursor, which `this.sql`'s tagged-template convenience wrapper discards. */
  private storageSqlExec() {
    const storage = this.ctx.storage;
    return storage.sql.exec.bind(storage.sql) as <T = Record<string, unknown>>(query: string, ...bindings: unknown[]) => { toArray(): T[]; rowsWritten: number };
  }
  private get rt(): CodemodeHandle {
    if (!this.__rt) {
      const connectors: import("@cloudflare/codemode").CodemodeConnector<unknown>[] = [
        new EchoConnector(this.ctx as never, this.env as never),
        new GateConnector(this.ctx as never, this.env as never),
        new BillingConnector(this.ctx, this.env, this.recorder),
        new FxConnector(this.ctx, this.env, this.recorder),
        new GeoConnector(this.ctx, this.env, this.recorder),
        new WeatherConnector(this.ctx, this.env, this.recorder),
        new WorkspaceStateConnector(this.ctx, this.env, this.workspace, this.recorder),
        new WorkspaceGitConnector(this.ctx, this.env, this.workspace, this.recorder, (this.env as Env).GIT_PUSH_TOKEN),
        new StoreConnector(this.ctx, this.env, this.recorder, new DoLedgerStore(this.storageSqlExec())),
      ];
      // PLAYBOOK-KEEL-RUN-SUITE-001: conditional like the foreign connector
      // below -- SANDBOX is absent locally/CI and absent from the deployed
      // worker's own config today (no real container is provisioned by
      // this playbook). A runSuite-routed spec without it fails closed
      // (SandboxOracleAdapter finds no recorded call -> escalate).
      const sandboxNs = (this.env as Env).SANDBOX;
      if (sandboxNs) {
        connectors.push(new SandboxConnector(this.ctx, this.env, sandboxNs, this.recorder));
      }
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
      this.__rt = makeRuntime(this.ctx, (this.env as Env).LOADER, connectors);
    }
    return this.__rt;
  }

  private ensureSchema() {
    this.sql`CREATE TABLE IF NOT EXISTS run_terminal (id INTEGER PRIMARY KEY, state TEXT, verdict TEXT, execution_id TEXT)`;
    this.sql`CREATE TABLE IF NOT EXISTS pending_run (id INTEGER PRIMARY KEY, action_id TEXT, execution_id TEXT, attempt INTEGER)`;
    // PLAYBOOK-KEEL-JOIN: the source of truth for the join — the root's own
    // DO, not the best-effort cross-run index (D1). derive()'s doName exists
    // only transiently otherwise (returned in the HTTP response, persisted
    // nowhere) and is unrecoverable once that response is gone.
    // PLAYBOOK-KEEL-COMPOSE (FU-DECOMP-1, landed): `oracle_ref` recorded per
    // child, not assumed equal to the root's. `join()`/`compose()` resolve
    // each child's suite against ITS OWN recorded ref — an untrusted deriver
    // that re-points a child's oracleRef no longer gets silently read against
    // the wrong suite.
    this.sql`CREATE TABLE IF NOT EXISTS derived_child (run_id TEXT PRIMARY KEY, do_name TEXT, serves_clause TEXT, parent_run_id TEXT, oracle_ref TEXT)`;
  }

  private repo() { return new LineageDoAdapter(this.sql.bind(this) as never); }

  /** BRIEF-KEEL-SKILL-001: fetched ONCE per run (here), never re-fetched per
   *  attempt — GatewayModelAdapter's own `generate()` re-runs `selectSkills`
   *  fresh on every attempt, but only over this already-fetched, frozen row
   *  set. An absent env.DB (no skill store configured) is legal — empty
   *  rows, selection falls back to BUILTIN docs only (non-breaking). */
  private async skillRows(connectors: readonly string[], intent: string) {
    const env = this.env as Env;
    if (!env.DB) return [];
    try {
      return await new D1SkillStoreAdapter(env.DB).activeFor(connectors, intent);
    } catch {
      return []; // the skill store is a read-side convenience; never break a run over it
    }
  }

  private async model(intent: string, connectors: readonly string[], mr = false): Promise<ModelPort> {
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
        skillRows: await this.skillRows(connectors, intent),
      });
    }
    return new ScriptedModelAdapter();
  }

  private async ports(opts: { degraded?: boolean; intent: string; connectors: readonly string[]; oracleRef?: string; runSuite?: SpecificationContent["runSuite"]; grounding?: boolean }): Promise<RunPorts> {
    const wrapMr = opts.oracleRef ? suiteIsMetamorphic(opts.oracleRef) : false;
    return {
      model: await this.model(opts.intent, opts.connectors, wrapMr),
      // Degraded mode: fault-inject the executor. Oracle stays real so
      // verification keeps serving; the run must fail closed to ESCALATE.
      exec: opts.degraded ? new FaultyExecutionAdapter() : new CodemodeExecutionAdapter(this.rt, { wrapMr, recorder: this.recorder }),
      // PLAYBOOK-KEEL-RUN-SUITE-001 (B.3, INV-RUN-ROUTE-MEASURED): routed by
      // the spec's OWN declared `runSuite` field, never a model judgment.
      // Absent -> the oracle, byte-for-byte unchanged (B.5, D.6).
      oracle: opts.runSuite ? new SandboxOracleAdapter() : new SuiteOracleAdapter(this.rt, this.suites),
      // PLAYBOOK-KEEL-GROUNDING-001 (Track C): opt-in like runSuite above.
      // Absent -> undefined -> groundingGate() in run.ts is a no-op, the
      // loop is byte-for-byte unchanged (D.6).
      groundingGate: opts.grounding ? new GroundingGateAdapter(this.suites, new ScriptedJudgeAdapter()) : undefined,
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

    // PLAYBOOK-KEEL-TYPING-001: typed directly against the base Agent's real
    // startFiber (agent-primitives.check.ts is the signature reference) --
    // the upgrade's startFiber scare (a real removal would have compiled
    // clean through the old `as unknown as` cast) must not be possible again.
    const handle = await this.startFiber("run", async () => {
      const res = await runLoop(spec, await this.ports({ degraded: content.intent === "degraded", intent: content.intent, connectors: content.connectors, oracleRef: content.oracleRef, runSuite: content.runSuite, grounding: content.grounding }));
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

    const res = await resumeApproved(specNode, await this.ports({ intent: specNode.content.intent, connectors: specNode.content.connectors, oracleRef: specNode.content.oracleRef, runSuite: specNode.content.runSuite, grounding: specNode.content.grounding }), {
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
  // "billing" dropped (BRIEF-KEEL-EFFECT-SIGNATURE-001 v1.2): getTier is a pure
  // read, no effectful method — this now matches what effect-signature
  // derivation would produce. The connector itself is NOT removed (test/
  // stale-assumption.test.ts depends on it as its whole test subject); only
  // this policy-level classification changes.
  private readonly SPEC_LOOP_POLICY: GatePolicy = { effectful: ["gate"] };
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
  /** PLAYBOOK-KEEL-JOIN: widened to also expose `result()` — the cast is the
   *  only thing that was ever hiding it; `result()` already exists and is
   *  public (mirrors `worker.ts`'s `Stub`, which already reads cross-DO). No
   *  new method added to the DO. */
  private childStub(name: string): {
    admit(c: unknown): Promise<{ runId: string }>;
    result(): Promise<{ state: string | null; verdict: unknown; executionId: string | null; nodeKinds: string[] } | null>;
  } {
    const env = this.env as Env;
    const ns = env.ORCHESTRATOR;
    return ns.get(ns.idFromName(name)) as unknown as {
      admit(c: unknown): Promise<{ runId: string }>;
      result(): Promise<{ state: string | null; verdict: unknown; executionId: string | null; nodeKinds: string[] } | null>;
    };
  }

  /** PLAYBOOK-KEEL-JOIN: remember a derived child durably, in the ROOT's own
   *  DO — the source of truth for the join. Called from every place a
   *  derived spec gets admitted into its own DO (derive()'s auto-admit
   *  branch, and disposeBacklog()'s human-approved branch) — both already
   *  had all four values in hand; this was the only piece missing.
   *  PLAYBOOK-KEEL-COMPOSE (FU-DECOMP-1): `oracleRef` recorded per row, taken
   *  from the CHILD's own spec — never assumed equal to the root's. */
  private recordDerivedChild(runId: string, doName: string, servesClause: string | undefined, parentRunId: string, oracleRef: string): void {
    this.sql`INSERT OR REPLACE INTO derived_child (run_id, do_name, serves_clause, parent_run_id, oracle_ref) VALUES (${runId}, ${doName}, ${servesClause ?? null}, ${parentRunId}, ${oracleRef})`;
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
  /** PLAYBOOK-KEEL-DERIV-AMEND: `evidence` is additive — absent (the
   *  default) on every existing caller, byte-identical to before this
   *  playbook. Present only when `deriveAmend()` re-derives after a failed
   *  composition leg; threaded to `runSpecLoop` (which threads it to every
   *  `deriver.derive` call this pass) via `SpecLoopCtx.evidence`.
   *  `templateDerive` ignores it, so re-deriving under it is idempotent —
   *  the same content, the same `run_id`s, safely re-admitted via
   *  `recordDerivedChild`'s `INSERT OR REPLACE`. */
  async derive(evidence?: DerivationEvidence): Promise<(SpecLoopSummary & { admittedRuns: { doName: string; runId: string; servesClause?: string }[] }) | { error: string }> {
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
      derive: (parent, r, ev) => {
        const parentId = idOf.get(parent) ?? rootNode.id;
        // Stamp derivedFrom here, before the gate/backlog ever see the
        // candidate, so a later backlog disposal can record the same link
        // without needing separate parent-tracking state.
        return templateDeriver.derive(parent, r, ev).map((c) => ({ ...c, derivedFrom: { parent: parentId, root: rootNode.id } }));
      },
    };

    const ctx: SpecLoopCtx = {
      deriver,
      policy: this.SPEC_LOOP_POLICY,
      backlog: this.backlogFor(rootNode.id),
      bound: this.SPEC_LOOP_BOUND,
      leaseMs: this.SPEC_LOOP_LEASE_MS,
      now: () => Date.now(),
      evidence,
      admit: async (spec, parent) => {
        const parentId = idOf.get(parent) ?? rootNode.id;
        const doName = `derived-${crypto.randomUUID()}`;
        const { runId } = await this.childStub(doName).admit(spec);
        idOf.set(spec, runId);
        admittedRuns.push({ doName, runId, servesClause: spec.servesClause });
        this.recordDerivedChild(runId, doName, spec.servesClause, parentId, spec.oracleRef);
        await this.recordDependsOn(runId, parentId, rootNode.id);
      },
    };

    const summary = await runSpecLoop(root, ctx);
    return { ...summary, admittedRuns };
  }

  /** PLAYBOOK-KEEL-JOIN: read back what the derived children produced. Judges
   *  NOTHING (no composition verdict — that is the next playbook, and it
   *  cannot be written until this one gives it inputs). `derived_child` (this
   *  DO's own SQLite) is the source of truth; the best-effort cross-run index
   *  is never consulted for this.
   *  PLAYBOOK-KEEL-COMPOSE (FU-DECOMP-1, landed): the suite is resolved PER
   *  CHILD, from that row's own recorded `oracle_ref` — not assumed equal to
   *  the root's. `templateDerive` never re-points a child's oracleRef, so an
   *  honest derivation tree sees no behavior change; an untrusted deriver that
   *  DID re-point one now gets that child read against its own real suite,
   *  not silently mis-read against the root's. */
  async join(): Promise<{ ready: boolean; children: readonly JoinChildReport[] } | { error: string }> {
    this.ensureSchema();
    const rootNode = await this.findRoot();
    if (!rootNode) return { error: "no human-authored root Specification found for this run" };

    const rows = [...this.sql<{ run_id: string; do_name: string; serves_clause: string | null; parent_run_id: string; oracle_ref: string | null }>`
      SELECT run_id, do_name, serves_clause, parent_run_id, oracle_ref FROM derived_child`];

    const children = await Promise.all(rows.map(async (row): Promise<JoinChildReport> => {
      const r = await this.childStub(row.do_name).result();
      const terminal = r?.state ?? null;
      const verdict = (r?.verdict ?? null) as VerdictContent | null;
      const outcome = verdict?.outcome ?? null;
      const evidence = verdict?.evidence as { observed?: Record<string, unknown>; spanningUncheckable?: string[] } | undefined;

      // Does THIS CHILD's own suite's assertion for its clause declare
      // `observe` or `metamorphic` at all? Independent of whether the run
      // finished — it's a property of the suite, not of the trace. A clause
      // whose assertion has neither is NOT COMPOSABLE, regardless of outcome
      // (compileProgram emits an observed entry only when `observe` is set;
      // metamorphic assertions always emit one).
      const suite = row.oracle_ref ? this.suites.resolve(row.oracle_ref) : null;
      const assertion = row.serves_clause ? suite?.assertions.find((a) => a.criterionId === row.serves_clause) : undefined;
      const observable = !!(assertion?.observe || assertion?.metamorphic);

      const observedKey = row.serves_clause;
      const hasObserved = observedKey != null && !!evidence?.observed && Object.prototype.hasOwnProperty.call(evidence.observed, observedKey);
      const observed: JoinChildReport["observed"] = hasObserved
        ? { present: true, value: evidence!.observed![observedKey!] }
        : { present: false };

      return {
        runId: row.run_id,
        doName: row.do_name,
        servesClause: row.serves_clause,
        parentRunId: row.parent_run_id,
        terminal,
        outcome,
        observable,
        observed,
        spanningUncheckable: evidence?.spanningUncheckable ?? [],
      };
    }));

    // Readiness: every recorded child has finished. Zero children (derive()
    // never ran, or the root wasn't decomposable) is deliberately NOT "ready"
    // — there is nothing to join, which is a different thing from "joined
    // successfully."
    const ready = children.length > 0 && children.every((c) => c.terminal !== null);
    return { ready, children };
  }

  /** PLAYBOOK-KEEL-COMPOSE: the up-leg. Coverage proved every clause was
   *  claimed; join() gathered what each child produced; THIS asks whether the
   *  children's outputs actually compose into the PARENT's requirement — the
   *  question that stays open even when every child is individually correct
   *  (two lines of arithmetic: 14.01 per-line vs 14.00 per-subtotal, both
   *  right, the invoice wrong). Judges the whole against the PARENT clause
   *  only, never children against each other directly — the relation is
   *  anchored on the parent's `composes` assertion (option A: a third compile
   *  path beside compileProgram/compileMetamorphic, resolved from the SAME
   *  suite `join()` already keys everything by servesClause against — no new
   *  admission path, no second gather). Runs in the same independent sandbox
   *  every other oracle runs in (`rt.tool().execute`) — no model judges its
   *  own composition. */
  async compose(): Promise<{ ready: boolean; clauses: readonly ComposeClauseVerdict[]; seams: readonly ComposeClauseVerdict[] } | { error: string }> {
    const j = await this.join();
    if ("error" in j) return j;
    if (!j.ready) return { ready: false, clauses: [], seams: [] }; // cannot compose an unfinished tree — no partial composition

    const rootNode = await this.findRoot();
    if (!rootNode) return { error: "no human-authored root Specification found for this run" };
    const root = rootNode.content as SpecificationContent;
    // PLAYBOOK-KEEL-SEAM: no early "nothing declared" short-circuit here
    // anymore — a suite can declare seams with no composes clause at all (or
    // vice versa), so `suiteComposes` alone can no longer stand in for "there
    // is nothing to do here." Both loops below naturally no-op on an empty
    // filter/flatMap, so this is a simplification, not a behavior change for
    // any suite that declares neither.
    const suite = this.suites.resolve(root.oracleRef);
    const composesAssertions = suite?.assertions.filter((a) => !!a.composes) ?? [];

    // What each child actually produced, keyed by servesClause — the ONLY
    // input the relation ever sees (INV-ORACLE-BLIND up-leg: values, never
    // an expected answer).
    const outputs: Record<string, unknown> = {};
    const byClause = new Map<string, JoinChildReport>();
    for (const c of j.children) {
      if (c.servesClause == null) continue;
      byClause.set(c.servesClause, c);
      if (c.observed.present) outputs[c.servesClause] = c.observed.value;
    }

    const clauses: ComposeClauseVerdict[] = [];
    for (const a of composesAssertions) {
      const composes = a.composes!;
      // The vacuity gate, one level up from coverage's: every clause this
      // relation NEEDS must be observable AND actually observed. Missing any
      // one → unverifiable, named — never evaluate the relation over silence.
      const missing = composes.requires.find((clauseId) => {
        const child = byClause.get(clauseId);
        return !child || !child.observable || !child.observed.present;
      });
      if (missing) {
        clauses.push({
          criterionId: a.criterionId,
          outcome: "unverifiable",
          reason: `clause ${missing} has no observed value to compose over`,
          outputs,
        });
        continue;
      }
      // PLAYBOOK-KEEL-COMPOSE-ANCHOR: the vacuity gate above only checked the
      // clauses `requires` DECLARES. Nothing stopped the relation from also
      // reading a clause `requires` never listed — evaluating over a
      // possibly-undefined operand and returning a spurious pass/fail. This
      // closes that: the relation's actual operands must be a subset of
      // `requires` (checked AFTER vacuity — missing data is the more
      // actionable message when an assertion is both vacuous and malformed).
      const anchor = checkComposesAnchor(a);
      if (!anchor.ok) {
        clauses.push({ criterionId: a.criterionId, outcome: "error", reason: anchor.reason, outputs });
        continue;
      }
      // Same independent sandbox every oracle runs in; same completed-guard
      // as suite-oracle.adapter.ts's two call sites — a sandbox that did not
      // complete is unverifiable, never a pass.
      const out = await this.rt.tool().execute({ code: compileComposition(outputs, a) }, undefined);
      const res = out.status === "completed" ? (out.result as { results?: Record<string, string> }) : {};
      const status = res.results?.[a.criterionId];
      clauses.push({
        criterionId: a.criterionId,
        outcome: status === "pass" ? "pass" : status === "fail" ? "fail" : out.status === "completed" ? "error" : "unverifiable",
        outputs,
      });
    }

    // PLAYBOOK-KEEL-SEAM (INV-DECOMP-5): a DISTINCT question from the
    // composes loop above — not "do the outputs jointly satisfy a parent
    // relation" but "did the value threaded from an upstream child survive
    // being read by a downstream one." A tree can pass one leg and fail the
    // other; never folded into a `composes` relation. `seams` is a list on
    // ONE assertion, so unlike `composes` (one relation per assertion, keyed
    // by that assertion's own criterionId) there is no single id per
    // declared seam — synthesized here as `<assertion id>[<upstream>-><downstream>]`.
    const seamDeclarations = (suite?.assertions ?? []).flatMap((owner) => (owner.seams ?? []).map((seam) => ({ owner, seam })));
    const seams: ComposeClauseVerdict[] = [];
    for (const { owner, seam } of seamDeclarations) {
      const criterionId = `${owner.criterionId}[${seam.upstream}->${seam.downstream}]`;
      const up = byClause.get(seam.upstream);
      const down = byClause.get(seam.downstream);
      // The vacuity gate, seam form: BOTH sides must be observed. A seam
      // over silence is not a check — the same rule composes's `requires`
      // enforces, applied to the two named operands instead of a declared set.
      if (!up || !up.observable || !up.observed.present) {
        seams.push({ criterionId, outcome: "unverifiable", reason: `upstream clause ${seam.upstream} has no observed value to anchor the seam on`, outputs: {} });
        continue;
      }
      if (!down || !down.observable || !down.observed.present) {
        seams.push({ criterionId, outcome: "unverifiable", reason: `downstream clause ${seam.downstream} has no observed value to check`, outputs: {} });
        continue;
      }
      // The anchor law: the relation must reference `upstream` (the
      // recorded output), or it's checking only the downstream child's
      // unverified claim — gameable, malformed, never a judgment.
      const anchor = checkSeamAnchor(seam.relation);
      const seamOutputs = { upstream: up.observed.value, downstream: down.observed.value };
      if (!anchor.ok) {
        seams.push({ criterionId, outcome: "error", reason: anchor.reason, outputs: seamOutputs });
        continue;
      }
      const out = await this.rt.tool().execute({ code: compileSeam(criterionId, up.observed.value, down.observed.value, seam.relation) }, undefined);
      const res = out.status === "completed" ? (out.result as { results?: Record<string, string> }) : {};
      const status = res.results?.[criterionId];
      seams.push({
        criterionId,
        outcome: status === "pass" ? "pass" : status === "fail" ? "fail" : out.status === "completed" ? "error" : "unverifiable",
        outputs: seamOutputs,
      });
    }

    return { ready: true, clauses, seams };
  }

  /** PLAYBOOK-KEEL-DERIV-AMEND (INV-DECOMP-8): `decide()` lifted to the
   *  DECOMPOSITION level — closes the loop A1–A9 left open. Every detection
   *  built so far (coverage gap, cross-cut fail, seam fail, spanning-
   *  uncheckable) flowed nowhere: `runSpecLoop` escalated to a human and
   *  stopped; `compose()`'s verdicts had no consumer. This is the wrapper —
   *  `runSpecLoop` and `compose()` had NO common caller before this playbook
   *  (verified: `derive()` calls `runSpecLoop` at :503(ish); `compose()` is
   *  only ever reached via its own `/compose` route) — that missing seam
   *  IS the finding this playbook's own orientation anticipated, so this
   *  method is where it now lives.
   *
   *  `templateDerive` ignores `evidence`, so under it this is an HONEST
   *  BOUNDED NO-OP: a failing decomposition re-derives to the IDENTICAL
   *  tree, fails identically, and escalates once `budget` is exhausted —
   *  never an infinite loop, never a silent repair that didn't happen. The
   *  day a model deriver is admitted over the `Deriver` port, the same
   *  structure becomes a functional repair with zero rework.
   *
   *  Re-derivation under `templateDerive` is idempotent (same content, same
   *  `run_id`s, re-admitted via `recordDerivedChild`'s `INSERT OR REPLACE`)
   *  and therefore instantaneous once the FIRST attempt's children have
   *  actually finished executing — so this loops synchronously through every
   *  remaining attempt once attempt 1 is ready. Only attempt 1 can come back
   *  "pending" (children still running); the caller re-calls this method
   *  later, exactly the same `/derive` + poll `/join` pattern already used
   *  everywhere else — no new persisted attempt-state, no in-DO sleep
   *  (Durable Objects cannot reliably self-delay). */
  async deriveAmend(budget: number): Promise<
    | { readonly status: "done"; readonly decision: DecompDecision; readonly attempts: readonly DerivAmendAttempt[] }
    | { readonly status: "pending"; readonly attempt: number; readonly attempts: readonly DerivAmendAttempt[] }
    | { readonly error: string }
  > {
    // CORRECTION, found live: `derive()`'s admit callback mints a FRESH
    // `derived-${crypto.randomUUID()}` DO name on every call — including a
    // re-derivation. Re-derivation under `templateDerive` is content-
    // identical (same `run_id`), but NOT the same DO instance, so it is NOT
    // instantaneous — every attempt's children are brand-new DOs that must
    // actually execute. The original design here assumed otherwise (an
    // idempotent, instant re-derivation) and called this method itself
    // repeatedly as the "wait" mechanism, which — combined with that wrong
    // assumption — silently spawned an ever-growing, never-converging set of
    // children instead of waiting for one attempt's own. Fixed: wait
    // INTERNALLY (bounded busy-poll) for each attempt's own children before
    // moving on, so one call to this method drives the whole bounded loop
    // to a real ACCEPT/ESCALATE, calling `derive()` exactly once per
    // attempt. `status: "pending"` is now only a defensive fallback if an
    // attempt's children genuinely never finish within the wait bound —
    // not the normal calling convention.
    const maxWaitIterations = 150;
    const waitIntervalMs = 200;

    let attempt = 1;
    let evidence: DerivationEvidence | undefined = undefined;
    const attempts: DerivAmendAttempt[] = [];

    while (true) {
      const summary = await this.derive(evidence); // exactly once per attempt — fresh children
      if ("error" in summary) return summary;

      let j = await this.join();
      for (let i = 0; i < maxWaitIterations && !("error" in j) && !j.ready; i++) {
        await new Promise((resolve) => setTimeout(resolve, waitIntervalMs));
        j = await this.join();
      }
      if ("error" in j) return j;
      if (!j.ready) {
        return { status: "pending", attempt, attempts }; // this attempt's children never finished in time
      }

      const comp = await this.compose();
      if ("error" in comp) return comp;

      const decision = decideDecomp({
        derivationEscalated: summary.escalated,
        coverageGap: summary.coverageGap,
        clauses: comp.clauses,
        seams: comp.seams,
        attempt,
        budget,
      });
      attempts.push({
        attempt,
        derivationEscalated: summary.escalated,
        coverageGap: summary.coverageGap,
        clauses: comp.clauses,
        seams: comp.seams,
        evidenceUsed: evidence,
        decision,
      });

      if (decision.next !== "RE-DERIVE") {
        return { status: "done", decision, attempts };
      }

      const spanningUncheckable = j.children.flatMap((c) => c.spanningUncheckable);
      evidence = failureToEvidence({ coverageGap: summary.coverageGap, clauses: comp.clauses, seams: comp.seams }, spanningUncheckable);
      attempt = decision.attempt;
    }
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
    this.ensureSchema();
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
      // PLAYBOOK-KEEL-JOIN: a human-approved derived child is still a child
      // of this root's derivation tree — not just derive()'s auto-admit
      // branch. Omitting it here would leave the exact silent gap this
      // playbook exists to close, just reached via a different door.
      this.recordDerivedChild(runId, doName, entry.spec.servesClause, parentId, entry.spec.oracleRef);
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
