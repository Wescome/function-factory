/**
 * orchestrator.ts — the Orchestrator DO (composition root, Ring 2).
 * Wires the frozen ports to their adapters, dispatches via startFiber
 * (idempotency-keyed on the Specification id, D7), and closes the loop (M3):
 * on PAUSE it persists resume context; approve() replays via the port (D8).
 */
import { Agent } from "agents";
import { Workspace } from "@cloudflare/shell";
import { runLoop, resumeApproved, type RunPorts, type RunTerminal } from "../domain/loop/run";
import type { Specification, SpecificationContent, AcceptanceCriterion, ContentHash, AnyNode, DomainEvent, VerdictContent, ExecutionTraceContent } from "../domain/index";
import { checkFileOverlap, type FileOverlap } from "../domain/index";
// PLAYBOOK-KEEL-SCR-PORT-4: the review log's own vocabulary, reached from
// the composition layer only (SCR stays out of `src/domain/**`).
import type { Hunk, CheckOutcome } from "../scr/events";
import { seriesParentsFor } from "../domain/spec-loop/slice-change";
import { projectSlicesAsChanges, mergedTraceFor, type ReviewCoreLike } from "./slice-change-bridge";
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
import { LineageDoAdapter, computeSpecId } from "../adapters/persistence/lineage-do.adapter";
import { D1CrossRunAdapter } from "../adapters/persistence/d1-cross-run.adapter";
import { ScriptedModelAdapter } from "../adapters/model/scripted-model.adapter";
import { FixedCodeModelAdapter } from "../adapters/model/fixed-code.adapter";
import { GatewayModelAdapter, BUILTIN_CONNECTOR_DOCS } from "../adapters/model/gateway-model.adapter";
import { D1SkillStoreAdapter } from "../adapters/skill/d1-skill-store.adapter";
import { suiteIsMetamorphic, compileProgram, compileComposition, checkComposesAnchor, compileSeam, checkSeamAnchor, compileMetamorphic, type OracleAssertion } from "../adapters/oracle/suite";
import type { ModelPort } from "../domain/index";
import {
  proposeCandidate, challengeCandidate, surfaceCandidate, ratifyAndWrite, defaultBoundaryCases, mineScopeDerivedCases,
  type LiftCandidate, type PropertyFamily, type BehaviorDisposition, type DefeaterLegitimacy,
  type ChallengeCase, type SurfacePackage,
} from "../domain/index";

// PLAYBOOK-KEEL-PARALLEL-SLICE-001 (Track 1) — two confirmed TypeScript /
// Cloudflare-RPC-types findings, isolated empirically (each reproduced down
// to a minimal repro before landing on this shape):
//
// 1. `Pick<Orchestrator, K>` and `DurableObjectNamespace<Orchestrator>`
//    (typing the namespace against the full class directly) BOTH hit
//    TS2589 ("Type instantiation is excessively deep and possibly
//    infinite") once Cloudflare's RPC `Provider<T>` has to walk it --
//    `Pick` still forces TS to resolve the WHOLE class (~40 methods, plus
//    everything inherited from the Agent SDK) before it can narrow, so it
//    doesn't avoid the cost. Fix: `OrchestratorRpc` is its OWN standalone
//    interface, never derived from `Orchestrator`'s type. `Orchestrator
//    implements ... OrchestratorRpc` (the class declaration, below) still
//    gives a REAL compile-time check that the class's actual `admit`/
//    `result` signatures satisfy it -- catching drift -- without ever
//    asking the type-checker to synthesize a type over the full class.
// 2. A field typed `any` ALSO hits TS2589 -- NOT `unknown`'s failure mode
//    (`unknown` fails the `R extends Rpc.Serializable<R>` check outright,
//    collapsing to `never`, confirmed separately); `any`'s bivariant
//    distribution inside that SAME self-referential conditional
//    (`R extends Serializable<R>`, R on both sides) explodes instead of
//    collapsing. Isolated by re-adding `result()`'s fields one at a time:
//    every field is fine except `verdict`, and `verdict: any` is what
//    reintroduces TS2589 (`verdict: unknown` fails differently, to
//    `never`, per (a) above). Fix: `Json`, a concrete recursive union
//    with NO `any`/`unknown` anywhere in it -- VerdictContent.evidence's
//    real shape (arbitrary, oracle-supplied diagnostic data) is a JSON
//    value in practice, and unlike `any`/`unknown` this satisfies
//    `Serializable<T>` structurally without the depth blowup.
type JsonPrimitive = string | number | boolean | null;
type JsonArray = readonly JsonPrimitive[];
type JsonObject = { readonly [key: string]: JsonPrimitive | JsonArray | Readonly<Record<string, JsonPrimitive | JsonArray>> };
type Json = JsonPrimitive | JsonArray | JsonObject;

// `Rpc.DurableObjectBranded` supplies the nominal brand `DurableObjectNamespace`/
// `DurableObjectStub` require; `Orchestrator` already carries it via its own
// inheritance chain (Agent -> Server -> DurableObject), so nothing extra is
// needed at the call site for that part to typecheck.
// PLAYBOOK-KEEL-HANDOFF-001 (C2): the columns `evaluateReadiness`/
// `buildConsumesResults` (Orchestrator, below) read off a sibling row --
// never the full `derived_child` shape, so a caller only has to select
// what it actually needs.
interface SiblingRow {
  readonly run_id: string;
  readonly do_name: string;
  readonly serves_clause: string | null;
  readonly reported_state: string | null;
}

interface OrchestratorRpc extends Rpc.DurableObjectBranded {
  admit(content: SpecificationContent, parentDoName?: string): Promise<{ accepted: boolean; status: string; runId: string }>;
  result(): Promise<{ state: string | null; verdict: Json; executionId: string | null; nodeKinds: string[] } | null>;
  // PLAYBOOK-KEEL-PARALLEL-SLICE-001 (Track 2): a CHILD calls this on its
  // PARENT (the ONLY method here called in that direction, not the usual
  // parent-to-child one -- the namespace is symmetric, see childStub()'s
  // own comment).
  childCompleted(runId: string, terminalState: "ACCEPT" | "ESCALATE"): Promise<void>;
  // PLAYBOOK-KEEL-SLICE-FILES-001 (C1b, Track 2): this DO's own discovered
  // written-file set -- called BY join() on every recorded child, the SAME
  // cross-DO direction result() already reaches in.
  writtenFiles(): Promise<readonly string[]>;
  // PLAYBOOK-KEEL-SCR-PORT-4 (Track 1/2): the same cross-DO direction --
  // a parent reads each child's own recorded write HUNKS (the content
  // half `writtenFiles` cannot carry) and the identities that cleared its
  // approval gates, so the slice->Change projection can name a real
  // reviewer and carry real content.
  writtenHunks(): Promise<readonly Hunk[]>;
  approvers(): Promise<readonly string[]>;
  // PLAYBOOK-KEEL-SCR-PORT-4 (OD-PORT4-1): this DO's own last recorded
  // ExecutionTrace, same cross-DO direction as `writtenHunks`. The parent
  // needs it to re-run VERIFY over MERGED content: the assertions are
  // predicates over a trace, so re-running them requires this slice's real
  // trace to restate the merge over (see `mergedTraceFor`).
  executionTrace(): Promise<ExecutionTraceContent | null>;
}

export interface Env {
  // PLAYBOOK-KEEL-PARALLEL-SLICE-001 (Track 1): typed against
  // `OrchestratorRpc` (above) -- closes the `unknown` cast in childStub().
  // See that interface's comment for why NOT the full `Orchestrator` class.
  ORCHESTRATOR: DurableObjectNamespace<OrchestratorRpc>;
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
  // PLAYBOOK-KEEL-SCR-PORT-1: the review core's own, distinct DO (OD-PORT-3)
  // -- no RPC surface yet (see review-core.ts's own doc); typed here so
  // worker.ts can bind it correctly once PORT-2/3/4 give it real methods.
  REVIEW_CORE?: DurableObjectNamespace;
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
  // PLAYBOOK-KEEL-PARALLEL-SLICE-001: deterministic -- see scripted-model.adapter.ts.
  "stuck-fanout-test — sub-goal: return a result object with the field(s) described by: FAST marker",
  "stuck-fanout-test — sub-goal: return a result object with the field(s) described by: STUCK marker",
  // PLAYBOOK-KEEL-HANDOFF-001 (C2): deterministic -- see scripted-model.adapter.ts.
  "handoff-test — sub-goal: return a result object with the field(s) described by: UP marker",
  "handoff-test — sub-goal: return a result object with the field(s) described by: DOWN marker",
  "handoff-cycle-test — sub-goal: return a result object with the field(s) described by: CYCLE-A marker",
  "handoff-cycle-test — sub-goal: return a result object with the field(s) described by: CYCLE-B marker",
  "handoff-stuck-test — sub-goal: return a result object with the field(s) described by: UP marker",
  "handoff-stuck-test — sub-goal: return a result object with the field(s) described by: DOWN marker",
  // PLAYBOOK-KEEL-SLICE-FILES-001 (C1b): deterministic -- see scripted-model.adapter.ts.
  "seam-disjoint-test — sub-goal: return a result object with the field(s) described by: X marker",
  "seam-disjoint-test — sub-goal: return a result object with the field(s) described by: Y marker",
  "seam-overlap-test — sub-goal: return a result object with the field(s) described by: X marker",
  "seam-overlap-test — sub-goal: return a result object with the field(s) described by: Y marker",
  // PLAYBOOK-KEEL-SCR-PORT-4 (Track 2): two siblings that write DISJOINT
  // ANCHORED SECTIONS of the SAME file. C1b's floor still flags the file
  // overlap (correct -- two slices really are in one file), but the seam
  // replay now finds it composes cleanly. Without `state.writeSection`
  // (locked decision 1) this case could not exist: two whole-file writes
  // to one path always genuinely conflict, so the clean-merge branch had
  // nothing that could ever reach it.
  "seam-section-test — sub-goal: return a result object with the field(s) described by: X marker",
  "seam-section-test — sub-goal: return a result object with the field(s) described by: Y marker",
  // The negative twin: same file, SAME anchor, different content -- a real
  // INV-9 conflict that no ordering can resolve.
  "seam-collide-test — sub-goal: return a result object with the field(s) described by: X marker",
  "seam-collide-test — sub-goal: return a result object with the field(s) described by: Y marker",
  // PLAYBOOK-KEEL-SCR-PORT-4 (OD-PORT4-1): the same clean merge as
  // seam-section-test, judged by a suite each slice satisfies alone and
  // the merged content does not -- the fixture that proves the
  // merged-content VERIFY re-run can genuinely return `fail`.
  "seam-solo-test — sub-goal: return a result object with the field(s) described by: X marker",
  "seam-solo-test — sub-goal: return a result object with the field(s) described by: Y marker",
  // PLAYBOOK-KEEL-SCR-PORT-4 (Track 3): the capstone -- a real C2
  // dependency edge (DOWN dependsOn UP) AND a file overlap, in one run.
  "seam-handoff-test — sub-goal: return a result object with the field(s) described by: UP marker",
  "seam-handoff-test — sub-goal: return a result object with the field(s) described by: DOWN marker",
  "seam-handoff-collide-test — sub-goal: return a result object with the field(s) described by: UP marker",
  "seam-handoff-collide-test — sub-goal: return a result object with the field(s) described by: DOWN marker",
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

/**
 * PLAYBOOK-KEEL-PROPOSER-INTEGRATION-001: the Lift-Proposer's authoring
 * flow, wired upstream of run dispatch (OD-INT-1) — a DISTINCT surface from
 * admit()/approve() (OD-INT-3), never called by them and never calling
 * them. `actionCode` is the CALLER's — a real implementation to challenge
 * the candidate's family against (e.g. a prior accepted run's own code);
 * this playbook does not auto-fetch one from lineage (a disclosed scope
 * cut: keeps the wiring generic, and nothing in Track A/B requires it).
 * `cases` are ADDED to `defaultBoundaryCases()` (OD-INT-4) — PLAYBOOK-KEEL-
 * COUNTEREXAMPLE-GEN-001 names this the MODEL-PROPOSED tier: inputs only,
 * the model never decides an outcome or legitimacy (OD-RCG-3). A THIRD
 * tier, mined structurally from the OTHER relations already on `parent`
 * (`mineScopeDerivedCases`, no model risk), joins these two automatically
 * in `proposeLift` — nothing new for the caller to supply. `caseLegitimacy`
 * is a per-input override for a FAILING case's legitimacy — any input not
 * listed defaults to "unsettled" (fail-closed: this wiring never assumes a
 * failure is illegitimate/legitimate without an explicit signal, mirroring
 * challenge.ts's own "an unjudged failure is unsettled" default) —
 * unchanged by this playbook (OD-RCG-4).
 */
export interface LiftProposeInput {
  readonly parent: SpecificationContent;
  readonly root: SpecificationContent;
  readonly criterionId: string;
  readonly family: PropertyFamily;
  readonly disposition: BehaviorDisposition;
  readonly actionCode: string;
  readonly cases?: readonly number[];
  readonly caseLegitimacy?: Readonly<Record<number, DefeaterLegitimacy>>;
  readonly domainOwnerConfirmed?: boolean;
  readonly policy: GatePolicy;
}
export type LiftProposeResult =
  | { readonly surfaced: true; readonly package: SurfacePackage }
  | { readonly surfaced: false; readonly reason: string };
export type LiftApproveResult =
  | { readonly approved: true; readonly spec: SpecificationContent }
  | { readonly approved: false; readonly reason: string };

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
  /** PLAYBOOK-KEEL-SLICE-FILES-001 (C1b, Track 2, INV-SLICE-DISCOVERED): this
   *  child's own discovered written-file set — the union of every
   *  write-effectful `state.*` call's touched path(s), across every
   *  ExecutionTrace this child ever recorded. A plain observed set: never
   *  declared, never guessed, no rollback inference (see `writtenFiles()`'s
   *  own doc for why). Empty for a child that never wrote a file (or was
   *  never admitted at all — a C2 propagate-escalated held child). */
  readonly writtenFiles: readonly string[];
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

/**
 * PLAYBOOK-KEEL-SCR-PORT-4 (Track 2): what a seam replay attempt reports
 * back through `compose()`. Deliberately NOT named `seam*` alone: KEEL
 * already has an unrelated, older `seams` concept in `compose()` (suite
 * assertion seams -- "did the value threaded from an upstream child
 * survive being read downstream"), and the two must stay visibly
 * distinct. This one is about FILES colliding; that one is about VALUES
 * being threaded.
 *
 * Every variant is a refusal to compose. `resolved: true` does not mean
 * "the overlap is fine, carry on" -- it means the collision now has a
 * reviewable Change carrying the merged content, which a human must still
 * approve before it can land.
 */
export type SeamReplayOutcome =
  | { readonly resolved: true; readonly changeId: string; readonly changeIds: Readonly<Record<string, string>> }
  | { readonly resolved: false; readonly invariant: "INV-9"; readonly at: string; readonly changeId: string; readonly changeIds: Readonly<Record<string, string>> }
  | { readonly resolved: false; readonly reason: string };

export class Orchestrator extends Agent<Env> implements QueryPort, OrchestratorRpc {
  private readonly suites = new InMemorySuiteRegistry();
  private readonly recorder = new CallRecorder();
  private readonly memBacklog = new InMemoryBacklog();
  private __rt?: CodemodeHandle;
  private __ws?: Workspace;
  /** PLAYBOOK-KEEL-WORKSPACE-001 (B.2): one Workspace on the Orchestrator,
   *  backed by the DO's own SQLite. No R2 bucket is bound in wrangler.jsonc;
   *  files spill to inline SQLite storage under the (default 1.5MB)
   *  inlineThreshold, fine for this spike.
   *
   *  PLAYBOOK-KEEL-SLICE-FILES-001 (C1b, Track 1, INV-SLICE-ISOLATED)
   *  CONFIRMED, not built: this getter is already isolated per slice, for
   *  free, with no new infrastructure. Every C1/C2 derived child is admitted
   *  into its OWN Orchestrator DO instance (`derive()`'s `ctx.admit`, one
   *  `doName = derived-${crypto.randomUUID()}` per child — "one Specification
   *  per DO" has held since Phase 6a, OD-6a-5). `storage.sql` is THIS DO
   *  instance's own SQLite (a Cloudflare platform guarantee — never shared
   *  across DO instances), and `name: () => this.name` keys the Workspace by
   *  THIS DO's own addressing name (its `doName`) — a stable 1:1 key per
   *  admitted child, not literally the child's content-hash runId (the
   *  brief's own phrasing, "sub-spec id / child runId", is loose on this
   *  point — doName is what's actually available inside the child's own DO
   *  constructor, and it is 1:1 with the eventual runId regardless). Net:
   *  N slices already means N Workspace DOs, N disjoint disks — confirmed by
   *  reading the live C1/C2 admission path, not assumed. */
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
    // PLAYBOOK-KEEL-PROPOSER-INTEGRATION-001: one pending Lift-Proposer
    // candidate at a time, mirroring `pending_run`'s single-row pattern —
    // this DO's OWN authoring-time state, separate from run dispatch
    // (OD-INT-3). JSON blobs (candidate/parent/root/policy), same
    // convention `run_terminal.verdict` already uses.
    this.sql`CREATE TABLE IF NOT EXISTS pending_lift (id INTEGER PRIMARY KEY, candidate TEXT, parent TEXT, root TEXT, policy TEXT)`;
    // PLAYBOOK-KEEL-PARALLEL-SLICE-001 (Track 2): this run's OWN parent, if
    // it was admitted as a derived child (`admit()`'s `parentDoName`) --
    // one row, mirrors `pending_run`/`pending_lift`'s single-row pattern.
    this.sql`CREATE TABLE IF NOT EXISTS run_parent (id INTEGER PRIMARY KEY, parent_do_name TEXT)`;
    // PLAYBOOK-KEEL-SCR-PORT-4 (Track 1, locked decision 2): WHO cleared
    // this run's approval gate, and when. Append-only and multi-row (not
    // the single-row pattern above) because a run can PAUSE more than
    // once, and each clearing is its own fact — the log SCR's own log
    // will later be asked to name a reviewer from. Empty for every run
    // approved without an identity, which is the pre-PORT-4 behavior and
    // stays the default.
    this.sql`CREATE TABLE IF NOT EXISTS run_approval (id INTEGER PRIMARY KEY AUTOINCREMENT, approver_id TEXT NOT NULL, at INTEGER NOT NULL)`;
    // PLAYBOOK-KEEL-SCR-PORT-4 (Track 2/3): which ReviewCore DO and which
    // series this run projects its slices into, and the clause->changeId
    // map once it has. One row (`configureSeamReplay`), absent by default
    // -- and absent is what makes `compose()`'s overlap return
    // byte-identical to C1b's for every run that never arms this.
    this.sql`CREATE TABLE IF NOT EXISTS seam_replay (id INTEGER PRIMARY KEY, do_name TEXT, series_id TEXT, projected TEXT)`;
    // Track 2: has this child reported back yet (dedupe) -- and, Track 3,
    // whether its reaper already fired once (bounded-retry-then-escalate).
    // Migrated onto the EXISTING `derived_child` table (not a new one) so
    // join()/compose() keep reading the SAME rows they always have.
    this.ensureColumn("derived_child", "reported_state", "TEXT");
    this.ensureColumn("derived_child", "reap_schedule_id", "TEXT");
    this.ensureColumn("derived_child", "reap_attempts", "INTEGER NOT NULL DEFAULT 0");
    // Track 3: the child's own admitted content, so a re-admit-on-reap
    // needs nothing the caller has to keep around separately.
    this.ensureColumn("derived_child", "spec_content", "TEXT");
    // PLAYBOOK-KEEL-HANDOFF-001 (C2, Track 1): `depends_on` is this row's OWN
    // declared sibling servesClause ids (JSON array; NULL for a plain,
    // dependency-free child -- Track C, additive). `held` is 1 from the
    // moment a dependent child is first recorded (at FAN-OUT, never at
    // release -- see admit()'s ctx.admit closure) until it is actually
    // admitted (0 for every plain child, always). A held row's `run_id` is
    // a synthetic `held:<doName>` placeholder (never a real content hash --
    // the real hash isn't knowable until `consumesResults` is filled in at
    // release) until release re-keys it to the real, admitted spec's id
    // BEFORE ever calling admit() on it (closes the same race C1's own
    // `derive_state.in_progress` guard exists for: the row must be
    // findable under its REAL run_id before the child could possibly call
    // childCompleted with it).
    this.ensureColumn("derived_child", "depends_on", "TEXT");
    this.ensureColumn("derived_child", "held", "INTEGER NOT NULL DEFAULT 0");
    // Track 2: the compose result, persisted the moment completion-push
    // triggers it (not just computed fresh on the next `/compose` poll) --
    // makes "composed without polling" observable. Same shape `compose()`
    // already returns, JSON-blobbed like every other durable verdict here.
    this.sql`CREATE TABLE IF NOT EXISTS compose_result (id INTEGER PRIMARY KEY, payload TEXT, at INTEGER)`;
    // Track 3 (D.5): a child finishing just after it was reap-escalated is
    // a no-op (already resolved, never re-composes) but NOT a silent
    // drop -- durably recorded here for observability. Deliberately NOT a
    // new frozen-domain node kind: the domain lineage surface is frozen
    // (M1) and this playbook is adapter wiring, not a domain change; this
    // is adapter-side bookkeeping, the same tier `derived_child` and the
    // best-effort cross-run index already live at.
    this.sql`CREATE TABLE IF NOT EXISTS late_completion (run_id TEXT, terminal_state TEXT, reported_at INTEGER)`;
    // Track 2 correctness finding (caught live, not in the original
    // playbook text): guards `composeIfAllReported` against a fast
    // sibling's push racing ahead of `derive()`'s own admission loop --
    // see `derive()`'s comment for the full race.
    this.sql`CREATE TABLE IF NOT EXISTS derive_state (id INTEGER PRIMARY KEY, in_progress INTEGER NOT NULL DEFAULT 0)`;
  }

  /** PLAYBOOK-KEEL-PARALLEL-SLICE-001 (Track 2): idempotent `ALTER TABLE ...
   *  ADD COLUMN` for an EXISTING table -- `CREATE TABLE IF NOT EXISTS`
   *  alone never adds a column to a table a live DO already created before
   *  this playbook (`derived_child` has real rows in production). Mirrors
   *  the SAME `addColumnIfNotExists` pattern the agents SDK itself uses for
   *  its own schema migrations (`cf_agents_schedules`). `table`/`column`
   *  are always internal, hardcoded constants -- never user input -- so
   *  raw string interpolation into the statement (PRAGMA/ALTER TABLE don't
   *  accept bound identifiers) is safe. */
  private ensureColumn(table: string, column: string, type: string) {
    const exec = this.storageSqlExec();
    const cols = exec<{ name: string }>(`PRAGMA table_info(${table})`).toArray();
    if (!cols.some((c) => c.name === column)) {
      exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${type}`);
    }
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

  /** INTENT + idempotent admission (D7).
   *
   *  PLAYBOOK-KEEL-PARALLEL-SLICE-001 (Track 2): `parentDoName` is additive
   *  and optional -- absent for every human `POST /admit` (Track C:
   *  byte-for-byte unchanged). `derive()`'s auto-admit and
   *  `disposeBacklog()`'s human-approved admit both now pass `this.name`
   *  (the PARENT's own addressing name, from the Agent SDK) here so a
   *  derived child can call back on completion (`childCompleted`, below) --
   *  a run DO is addressed by an arbitrary caller-chosen name, never by its
   *  own `runId`, so the child has no way to reach its parent without
   *  being handed this explicitly (confirmed against live source before
   *  building this — the parked "if run DOs are idFromName(runId)"
   *  question in the playbook's own Track A.3 resolves to: they are not). */
  async admit(content: SpecificationContent, parentDoName?: string): Promise<{ accepted: boolean; status: string; runId: string }> {
    this.ensureSchema();
    const repo = this.repo();
    const spec = await repo.append<Specification>({ kind: "Specification", content, provenance: [] });
    await repo.emit({ type: "RunAdmitted", at: Date.now(), run: spec.id, specification: spec.id, accepted: true });
    if (parentDoName) this.sql`INSERT OR REPLACE INTO run_parent (id, parent_do_name) VALUES (1, ${parentDoName})`;

    // PLAYBOOK-KEEL-TYPING-001: typed directly against the base Agent's real
    // startFiber (agent-primitives.check.ts is the signature reference) --
    // the upgrade's startFiber scare (a real removal would have compiled
    // clean through the old `as unknown as` cast) must not be possible again.
    const handle = await this.startFiber("run", async () => {
      const res = await runLoop(spec, await this.ports({ degraded: content.intent === "degraded", intent: content.intent, connectors: content.connectors, oracleRef: content.oracleRef, runSuite: content.runSuite, grounding: content.grounding }));
      await this.emitCrossRun();
      this.persistTerminal(res);
      // PLAYBOOK-KEEL-PARALLEL-SLICE-001 (Track 2): completion-push wake --
      // only for a run that WAS a derived child (parentDoName recorded) and
      // only on a TERMINAL state (ACCEPT/ESCALATE); a PAUSE hasn't finished
      // and reports nothing yet (it will, on its own eventual ACCEPT/ESCALATE
      // after approval). Fire-and-continue: a callback failure (parent DO
      // unreachable, evicted namespace, etc.) must not fail THIS child's own
      // admit() — the reaper (Track 3) is the fail-closed backstop for a
      // push that never lands.
      if (parentDoName && (res.state === "ACCEPT" || res.state === "ESCALATE")) {
        try {
          await this.childStub(parentDoName).childCompleted(spec.id, res.state);
        } catch (e) {
          console.error(`childCompleted push to parent "${parentDoName}" failed for run ${spec.id}`, e);
        }
      }
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
   *  lineage — INV-A, the lineage graph is the source of truth.
   *
   *  PLAYBOOK-KEEL-SCR-PORT-4 (Track 1, locked decision 2): `approverId`
   *  is additive and optional. Omitted — every pre-PORT-4 caller, and
   *  every existing test — behaves byte-identically: nothing is recorded,
   *  and `approvers()` stays empty. Supplied, it records WHO cleared this
   *  gate, so the slice→Change bridge can open the resulting Change with
   *  that identity in `requiredReviewers` and sign an `approve` verdict
   *  with it.
   *
   *  Deliberately NOT defaulted to a literal ("human", the actor id, the
   *  DO's name). SCR's log is signed and append-only; a verdict signed by
   *  an identity that never approved anything is a forged review, and
   *  eliminating exactly that class of dishonesty is what PORT-3.5 was
   *  for. An unknown approver is representable only as ABSENT, and the
   *  bridge fails closed on absence rather than inventing a name. */
  async approve(approverId?: string): Promise<{ resumed: boolean; state?: string }> {
    this.ensureSchema();
    const pend = [...this.sql<{ action_id: string; execution_id: string; attempt: number }>`
      SELECT action_id, execution_id, attempt FROM pending_run WHERE id = 1`][0];
    if (!pend) return { resumed: false };
    if (approverId) {
      this.sql`INSERT INTO run_approval (approver_id, at) VALUES (${approverId}, ${Date.now()})`;
    }

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
  /** PLAYBOOK-KEEL-JOIN: widened to also expose `result()` — mirrors
   *  `worker.ts`'s `Stub`, which already reads cross-DO. No new method
   *  added to the DO by this widening.
   *
   *  PLAYBOOK-KEEL-PARALLEL-SLICE-001 (Track 1): `env.ORCHESTRATOR` is now
   *  `DurableObjectNamespace<Orchestrator>` (Env, above) — the RPC stub
   *  this returns is compiler-checked against the Orchestrator's OWN public
   *  method signatures, no `unknown` cast, no hand-narrowed shape. The
   *  ORCHESTRATOR namespace is symmetric (`idFromName` reaches a DO in
   *  either direction), so a CHILD calling `this.childStub(parentDoName)`
   *  to reach its parent (Track 2's `childCompleted`) uses this exact same
   *  method — "child" names the common case (parent addressing a child),
   *  not a directional restriction. */
  private childStub(name: string): DurableObjectStub<OrchestratorRpc> {
    const env = this.env as Env;
    const ns = env.ORCHESTRATOR;
    return ns.get(ns.idFromName(name));
  }

  /** Deadline math (Track 3, B.4): NOT a magic number -- a per-attempt
   *  ceiling times the child's OWN declared `attemptBudget`, deterministic
   *  and per-child. The ceiling itself (how long one attempt is allowed to
   *  run: GENERATE -> EXECUTE -> VERIFY, including a live model call and a
   *  sandboxed execution) has no existing config to derive from anywhere
   *  in this codebase -- a disclosed, reasonable constant. */
  private readonly REAP_PER_ATTEMPT_CEILING_MS = 5 * 60 * 1000;

  /** PLAYBOOK-KEEL-JOIN: remember a derived child durably, in the ROOT's own
   *  DO — the source of truth for the join. Called from every place a
   *  derived spec gets admitted into its own DO (derive()'s auto-admit
   *  branch, and disposeBacklog()'s human-approved branch) — both already
   *  had all four values in hand; this was the only piece missing.
   *  PLAYBOOK-KEEL-COMPOSE (FU-DECOMP-1): `oracleRef` recorded per row, taken
   *  from the CHILD's own spec — never assumed equal to the root's.
   *
   *  PLAYBOOK-KEEL-PARALLEL-SLICE-001 (Track 3): now takes the CHILD's full
   *  `spec` (not just its two fields) -- `spec_content` is stored so
   *  `reapStuckChildren` can re-admit the SAME content without either call
   *  site having to keep it around separately, and `spec.attemptBudget`
   *  derives this child's own reap deadline. Schedules the reaper the
   *  moment the child is recorded (B.4: per-child, not per-join -- one
   *  slow child never blocks scheduling for the others). */
  /** PLAYBOOK-KEEL-HANDOFF-001 (C2): `dependsOn` is additive and optional --
   *  absent (the default) for `disposeBacklog()`'s human-approved admission
   *  (a disclosed, unchanged scope cut: C2's holding is `derive()`'s
   *  auto-admit path only) and for any plain child, byte-identical to
   *  before this playbook. Present only for a dependency-bearing child that
   *  was ALREADY ready at the moment it was first considered (its
   *  dependencies were satisfied by a PRIOR attempt's already-accepted
   *  siblings, e.g. under `deriveAmend`'s re-derivation) -- the common
   *  hold-then-release path re-keys a row directly (see
   *  `releaseSettledHeldChildren`), never through this method. */
  private async recordDerivedChild(runId: string, doName: string, spec: SpecificationContent, parentRunId: string, dependsOn?: readonly string[]): Promise<void> {
    this.sql`INSERT OR REPLACE INTO derived_child (run_id, do_name, serves_clause, parent_run_id, oracle_ref, spec_content, depends_on, held) VALUES (${runId}, ${doName}, ${spec.servesClause ?? null}, ${parentRunId}, ${spec.oracleRef}, ${JSON.stringify(spec)}, ${dependsOn?.length ? JSON.stringify(dependsOn) : null}, 0)`;
    await this.scheduleReapFor(runId, doName, this.REAP_PER_ATTEMPT_CEILING_MS * spec.attemptBudget);
  }

  /** Track 3: schedule (or re-schedule, on retry) this ONE child's reap
   *  check, storing the schedule id so it can be cancelled the moment the
   *  child reports (`childCompleted`) without waiting for every sibling. */
  private async scheduleReapFor(runId: string, doName: string, deadlineMs: number): Promise<void> {
    const sched = await this.schedule(new Date(Date.now() + deadlineMs), "reapStuckChildren", { runId, doName });
    this.sql`UPDATE derived_child SET reap_schedule_id = ${sched.id} WHERE run_id = ${runId}`;
  }

  /** Track 3: cancel THIS child's reap schedule -- called the moment it
   *  reports (`childCompleted`), whether or not its siblings have yet. A
   *  child that reports before its deadline needs no reaping; letting the
   *  schedule fire anyway would be a wasted (harmless but sloppy) wake. */
  private async cancelReapFor(runId: string): Promise<void> {
    const row = [...this.sql<{ reap_schedule_id: string | null }>`SELECT reap_schedule_id FROM derived_child WHERE run_id = ${runId}`][0];
    if (row?.reap_schedule_id) await this.cancelSchedule(row.reap_schedule_id);
  }

  /** PLAYBOOK-KEEL-HANDOFF-001 (C2, INV-HANDOFF-DECLARED/-PROPAGATE): "no
   *  row yet" and "row exists but not yet ACCEPT" are the SAME "not
   *  satisfied" -- release is driven entirely by the LATER `childCompleted`/
   *  reap event (`releaseSettledHeldChildren`, below), never by which order
   *  `runSpecLoop` happens to process this batch's candidates in. ANY
   *  declared dependency that has already failed (a real ESCALATE, or the
   *  reaper's own 'ESCALATED' sentinel) propagates immediately -- a child
   *  is never left holding on a upstream that will never arrive. */
  private evaluateReadiness(dependsOn: readonly string[], siblingRows: readonly SiblingRow[]): "ready" | "hold" | "escalate" {
    const states = dependsOn.map((dep) => siblingRows.find((r) => r.serves_clause === dep)?.reported_state ?? null);
    if (states.some((s) => s === "ESCALATE" || s === "ESCALATED")) return "escalate";
    if (states.every((s) => s === "ACCEPT")) return "ready";
    return "hold";
  }

  /** PLAYBOOK-KEEL-HANDOFF-001 (C2): the REFERENCE (never the materialized
   *  artifact -- see `consumesResults`'s own doc, nodes.ts) each satisfied
   *  dependency resolves to, keyed by the upstream's OWN servesClause. Only
   *  ever called once `evaluateReadiness` has already returned "ready" for
   *  the SAME `dependsOn`/`siblingRows` pair, so every lookup here is
   *  guaranteed to find a row. */
  /** PLAYBOOK-KEEL-SCR-PORT-4 (Track 3): additive grounding. The
   *  `runId`/`doName` reference is unchanged and always present —
   *  everything C2 shipped keeps working byte-identically, and an
   *  upstream whose Change has not landed (the common case, since release
   *  normally fires the moment the upstream reaches ACCEPT, long before
   *  anything lands) resolves to exactly today's shape.
   *
   *  What is new: when the upstream slice HAS been projected into the
   *  review log and that Change HAS landed, the edge also carries the
   *  landed sha and `provenanceOf`'s answer for it — which Change, which
   *  revision, which revision hash, which reviewers.
   *
   *  A downstream must ground on `provenance.revisionHash` /
   *  `provenance.reviewers`, never on a git ref. THE FAILURE MODE: if a
   *  downstream builds on the wrong upstream, the `consumesResults` edge
   *  resolved past `provenanceOf` to raw git. `provenanceOf` answers from
   *  the sealed `LandAuthorised` event and deliberately never consults
   *  git, because git history is rewritten and is not evidence. A ref
   *  cannot tell you who reviewed what; this can. */
  private async buildConsumesResults(
    dependsOn: readonly string[],
    siblingRows: readonly SiblingRow[],
  ): Promise<Record<string, NonNullable<SpecificationContent["consumesResults"]>[string]>> {
    const out: Record<string, NonNullable<SpecificationContent["consumesResults"]>[string]> = {};
    const core = this.reviewCoreStub();
    const projected = await this.projectedChanges();
    for (const dep of dependsOn) {
      const row = siblingRows.find((r) => r.serves_clause === dep);
      if (!row) continue;
      const base = { runId: row.run_id, doName: row.do_name };
      const changeId = projected[dep];
      if (!core || !changeId) { out[dep] = base; continue; }
      try {
        const landedSha = await core.landedShaOf(changeId);
        if (!landedSha) { out[dep] = base; continue; }
        const provenance = await core.provenanceOf(landedSha);
        out[dep] = provenance ? { ...base, landedSha, provenance } : { ...base, landedSha };
      } catch {
        // Grounding is additive: a review core that cannot be reached
        // must never break C2's own (already correct) reference edge.
        out[dep] = base;
      }
    }
    return out;
  }

  /** PLAYBOOK-KEEL-HANDOFF-001 (C2, Track 2/3): re-evaluate every currently
   *  HELD sibling of `parentRunId` against the latest recorded state.
   *  Called from the SAME two events that already drive every other Track-2/
   *  3 reaction -- `childCompleted` (a real completion) and
   *  `reapStuckChildren`'s escalate/late-pull branches (a reap-driven
   *  resolution) -- no new trigger invented, reusing C1's own shipped wake.
   *
   *  A fixpoint over the held set: a RELEASED child never itself resolves
   *  synchronously here (its own completion is a later, separate event that
   *  will call back into this same method again) -- but a PROPAGATED
   *  escalation IS a synchronous local write, so a multi-hop escalation
   *  chain (A -> B -> C, A fails) resolves fully within one pass instead of
   *  waiting for an event a never-admitted child could never produce.
   *
   *  Re-keys a held row from its `held:<doName>` placeholder to the REAL
   *  admitted spec's id BEFORE calling admit() on it (never after) --
   *  otherwise an unusually fast child could call childCompleted with its
   *  real id before this method's own UPDATE ran, and childCompleted's
   *  "unrecognized runId" fail-safe would silently swallow it. */
  private async releaseSettledHeldChildren(parentRunId: string): Promise<void> {
    const rootNode = await this.findRoot();
    const rootId = rootNode?.id ?? parentRunId;
    for (;;) {
      const rows = [...this.sql<SiblingRow & { spec_content: string | null; depends_on: string | null; held: number }>`
        SELECT run_id, do_name, serves_clause, reported_state, spec_content, depends_on, held
        FROM derived_child WHERE parent_run_id = ${parentRunId}`];
      const held = rows.filter((r) => r.held === 1);
      if (held.length === 0) return;
      let changed = false;
      for (const row of held) {
        const dependsOn: string[] = row.depends_on ? JSON.parse(row.depends_on) : [];
        const readiness = this.evaluateReadiness(dependsOn, rows);
        if (readiness === "hold") continue;
        changed = true;
        if (readiness === "escalate") {
          this.sql`UPDATE derived_child SET reported_state = 'ESCALATED', held = 0 WHERE run_id = ${row.run_id}`;
          continue;
        }
        const spec = row.spec_content ? (JSON.parse(row.spec_content) as SpecificationContent) : null;
        if (!spec) {
          // Defensive only -- every held row is recorded WITH its own
          // spec_content at fan-out (admit()'s ctx.admit closure); this
          // should never be reachable, but a held row that could never be
          // admitted must still resolve rather than hang forever.
          this.sql`UPDATE derived_child SET reported_state = 'ESCALATED', held = 0 WHERE run_id = ${row.run_id}`;
          continue;
        }
        const consumesResults = await this.buildConsumesResults(dependsOn, rows);
        const specWithRefs: SpecificationContent = { ...spec, consumesResults };
        const realRunId = await computeSpecId(specWithRefs);
        this.sql`UPDATE derived_child SET run_id = ${realRunId}, held = 0, spec_content = ${JSON.stringify(specWithRefs)} WHERE run_id = ${row.run_id}`;
        await this.scheduleReapFor(realRunId, row.do_name, this.REAP_PER_ATTEMPT_CEILING_MS * specWithRefs.attemptBudget);
        try {
          await this.childStub(row.do_name).admit(specWithRefs, this.name);
        } catch (e) {
          console.error(`release-admit of "${row.do_name}" (run ${realRunId}) failed`, e);
        }
        await this.recordDependsOn(realRunId, parentRunId, rootId);
      }
      if (!changed) return;
    }
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
        const dependsOn = spec.dependsOnClauses ?? [];

        if (dependsOn.length === 0) {
          // Byte-identical to before this playbook (Track C, additive) --
          // no dependency declared, admit immediately.
          const { runId } = await this.childStub(doName).admit(spec, this.name);
          idOf.set(spec, runId);
          admittedRuns.push({ doName, runId, servesClause: spec.servesClause });
          await this.recordDerivedChild(runId, doName, spec, parentId);
          await this.recordDependsOn(runId, parentId, rootNode.id);
          return;
        }

        // PLAYBOOK-KEEL-HANDOFF-001 (C2, Track 1, INV-HANDOFF-DECLARED): a
        // dependency IS declared -- evaluate readiness against whatever
        // this parent's OTHER children have already recorded. checkDependencyGraph
        // (runSpecLoop, before ctx.admit is ever called) already guarantees
        // every dependsOnClauses id names a real SIBLING in this SAME batch
        // -- a truly dangling reference fails the whole batch upstream and
        // never reaches here.
        const siblingRows = [...this.sql<SiblingRow>`
          SELECT run_id, do_name, serves_clause, reported_state FROM derived_child WHERE parent_run_id = ${parentId}`];
        const readiness = this.evaluateReadiness(dependsOn, siblingRows);

        if (readiness === "escalate") {
          // An upstream this child depends on has ALREADY failed
          // (INV-HANDOFF-PROPAGATE) -- record this child as escalated too,
          // WITHOUT ever admitting it. The placeholder id is fine here
          // since nothing was ever admitted under it -- no inbound
          // childCompleted will ever need to find this row by a real id.
          const placeholderId = `held:${doName}`;
          this.sql`INSERT OR REPLACE INTO derived_child
            (run_id, do_name, serves_clause, parent_run_id, oracle_ref, spec_content, depends_on, held, reported_state)
            VALUES (${placeholderId}, ${doName}, ${spec.servesClause ?? null}, ${parentId}, ${spec.oracleRef ?? null}, ${JSON.stringify(spec)}, ${JSON.stringify(dependsOn)}, 0, 'ESCALATED')`;
          return;
        }

        if (readiness === "hold") {
          // The held-at-fan-out anchor (mirrors C1's own derive_state.
          // in_progress principle): recorded HERE, inside the SAME
          // in_progress-bracketed pass fan-out already uses -- never
          // deferred to release time -- so composeIfAllReported's
          // completeness check always sees the full, monotonic row set for
          // this generation, whether a child is held or immediate. No reap
          // scheduled for a held child -- it is transitively bounded by its
          // own upstream's reaper (releaseSettledHeldChildren reacts the
          // moment that upstream resolves, one way or the other).
          const placeholderId = `held:${doName}`;
          this.sql`INSERT OR REPLACE INTO derived_child
            (run_id, do_name, serves_clause, parent_run_id, oracle_ref, spec_content, depends_on, held, reported_state)
            VALUES (${placeholderId}, ${doName}, ${spec.servesClause ?? null}, ${parentId}, ${spec.oracleRef ?? null}, ${JSON.stringify(spec)}, ${JSON.stringify(dependsOn)}, 1, NULL)`;
          return;
        }

        // ready -- every declared dependency was ALREADY satisfied at the
        // moment this candidate was first considered (a re-derivation whose
        // prior-attempt siblings already reported ACCEPT under the SAME
        // content-addressed rows). Admit now, with the satisfied upstreams'
        // references attached (consumesResults is a REFERENCE only).
        const consumesResults = await this.buildConsumesResults(dependsOn, siblingRows);
        const specWithRefs: SpecificationContent = { ...spec, consumesResults };
        const { runId } = await this.childStub(doName).admit(specWithRefs, this.name);
        idOf.set(spec, runId);
        admittedRuns.push({ doName, runId, servesClause: spec.servesClause });
        await this.recordDerivedChild(runId, doName, specWithRefs, parentId, dependsOn);
        await this.recordDependsOn(runId, parentId, rootNode.id);
      },
    };

    // PLAYBOOK-KEEL-PARALLEL-SLICE-001 (Track 2 correctness finding, caught
    // live): a FAST child's fiber can race ahead and call childCompleted
    // WHILE this loop is still admitting its SIBLINGS (each ctx.admit
    // round-trips to a different DO; the runtime can interleave an
    // inbound RPC during that await). Without a guard, `composeIfAllReported`
    // sees only the rows recorded SO FAR, treats that incomplete set as
    // "everyone reported", and composes/persists prematurely -- the FINAL
    // compose still eventually runs correctly once every child reports
    // for real (compose_result is INSERT OR REPLACE, one row), but a
    // caller reading `lastCompose` in between could observe a stale,
    // too-early snapshot claiming the fan-out is done. `derive_state`
    // brackets the whole admission loop so no compose is attempted until
    // every child THIS derive() call is producing has actually been
    // recorded -- then checks once more at the end, in case every child
    // (fast ones) already finished while derive() was still running.
    this.sql`INSERT OR REPLACE INTO derive_state (id, in_progress) VALUES (1, 1)`;
    try {
      const summary = await runSpecLoop(root, ctx);
      return { ...summary, admittedRuns };
    } finally {
      this.sql`INSERT OR REPLACE INTO derive_state (id, in_progress) VALUES (1, 0)`;
      await this.composeIfAllReported();
    }
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
      // PLAYBOOK-KEEL-SLICE-FILES-001 (C1b, Track 2): the SAME cross-DO pull
      // result() already does, run alongside it -- writtenFiles() is
      // similarly safe to call on a never-admitted (C2 propagate-escalated
      // held) child, returning an empty set rather than throwing.
      const [r, writtenFiles] = await Promise.all([
        this.childStub(row.do_name).result(),
        this.childStub(row.do_name).writtenFiles(),
      ]);
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
        writtenFiles,
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
  async compose(): Promise<{ ready: boolean; clauses: readonly ComposeClauseVerdict[]; seams: readonly ComposeClauseVerdict[]; fileOverlaps?: readonly FileOverlap[]; seamResolution?: SeamReplayOutcome } | { error: string }> {
    const j = await this.join();
    if ("error" in j) return j;
    if (!j.ready) return { ready: false, clauses: [], seams: [] }; // cannot compose an unfinished tree — no partial composition

    // PLAYBOOK-KEEL-SLICE-FILES-001 (C1b, Track 3, INV-SLICE-SEAM-FLOOR): a
    // NEW gate in front of the existing result-composition logic below --
    // additive, that logic is untouched. Two children that touched the SAME
    // file are an unresolved overlap; the floor refuses to compose past it
    // (surfaced here, never merged in parallel). Sequenced-merge resolution
    // and richer auto-sequencing are named fast-follows, not built here.
    const overlapReport = checkFileOverlap(j.children.map((c) => ({ id: c.servesClause ?? c.runId, writtenFiles: c.writtenFiles })));
    if (!overlapReport.ok) {
      // PLAYBOOK-KEEL-SCR-PORT-4 (Track 2): the floor above still refuses
      // to compose past an overlap -- that never changes, and the return
      // below is byte-identical to C1b's when nothing is wired
      // (test/slice-files.test.ts asserts on it exactly). What is new is
      // that an overlap is no longer necessarily the END of the story:
      // when a ReviewCore series is configured for this run, the
      // overlapping slices' hunks get replayed through the review log's
      // own conflict oracle, and either resolve into a real merge-point
      // Change or come back with a NAMED INV-9 conflict. Both are strictly
      // more than "refused"; neither lets anything compose.
      const seamResolution = await this.attemptSeamReplay(j.children, overlapReport.overlaps);
      return seamResolution
        ? { ready: false, clauses: [], seams: [], fileOverlaps: overlapReport.overlaps, seamResolution }
        : { ready: false, clauses: [], seams: [], fileOverlaps: overlapReport.overlaps };
    }

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

  // --- PLAYBOOK-KEEL-SCR-PORT-4 (Track 2/3): the slice -> Change wiring ----

  /** The `ReviewCore` stub this run projects its slices into, or
   *  `undefined` when nothing is wired -- which is the default and keeps
   *  `compose()` byte-identical to C1b for every existing run. */
  private reviewCoreStub(): (ReviewCoreLike & {
    openSeries(actorId: string, targetRef: string, targetSha: string): Promise<string>;
    // OD-PORT4-1: the merged content BEFORE anything is written, so the
    // VERIFY oracle that lives on THIS DO can actually be shown what it is
    // being asked to judge. Read-only; `resolveSeam` re-derives the same
    // merge through the same rebaser.
    previewSeam(seriesId: string, ordered: { changeId: string; hunks: Hunk[] }[]): Promise<
      { ok: true; resolved: Hunk[] } | { ok: false; invariant: "INV-9"; at: string; changeId: string }
    >;
    resolveSeam(actorId: string, seriesId: string, ordered: { changeId: string; hunks: Hunk[] }[], opts?: { requiredReviewers?: string[]; checkOutcome?: CheckOutcome }): Promise<
      { ok: true; resolvedChangeId: string } | { ok: false; invariant: "INV-9"; at: string; changeId: string }
    >;
    snapshot(seriesId: string): Promise<{ openOrder: string[] }>;
    // Track 3: the grounding hop -- changeId -> landed sha -> provenance.
    landedShaOf(changeId: string): Promise<string | null>;
    provenanceOf(sha: string): Promise<NonNullable<NonNullable<SpecificationContent["consumesResults"]>[string]["provenance"]> | null>;
  }) | undefined {
    const ns = (this.env as Env).REVIEW_CORE;
    const row = [...this.sql<{ do_name: string }>`SELECT do_name FROM seam_replay WHERE id = 1`][0];
    if (!ns || !row?.do_name) return undefined;
    return ns.get(ns.idFromName(row.do_name)) as unknown as ReturnType<Orchestrator["reviewCoreStub"]>;
  }

  /** PLAYBOOK-KEEL-SCR-PORT-4 (Track 2/3): arm this run's slice->Change
   *  projection against a REAL `ReviewCore` series. Explicit and opt-in:
   *  a run that never calls this behaves exactly as it did before PORT-4,
   *  overlap floor included. `seriesId` is a series the caller already
   *  opened on that ReviewCore (`openSeries` locally, or
   *  `openExternalSeries` against real infra).
   *
   *  `projected` is an OPTIONAL, already-known clause -> changeId map. It
   *  exists because the projection is not always this run's to perform:
   *  an upstream slice can have been projected and LANDED by an earlier
   *  pass (which is precisely the situation in which Track 3's provenance
   *  grounding has anything to ground on). Supplying it makes those
   *  Changes resolvable here without re-opening them in an append-only
   *  log. Omitted, the projection happens on the first `compose()` that
   *  hits an overlap, exactly as Track 2 describes. */
  async configureSeamReplay(doName: string, seriesId: string, projected?: Record<string, string>): Promise<void> {
    this.ensureSchema();
    this.sql`INSERT OR REPLACE INTO seam_replay (id, do_name, series_id, projected) VALUES (1, ${doName}, ${seriesId}, ${projected ? JSON.stringify(projected) : null})`;
  }

  /** Read-back for the projection: clause -> SCR change id, once
   *  `attemptSeamReplay` has run. Empty before that. */
  async projectedChanges(): Promise<Readonly<Record<string, string>>> {
    this.ensureSchema();
    const row = [...this.sql<{ projected: string | null }>`SELECT projected FROM seam_replay WHERE id = 1`][0];
    return row?.projected ? (JSON.parse(row.projected) as Record<string, string>) : {};
  }

  /**
   * Project every finished slice into the configured review series as a
   * Change, then replay the OVERLAPPING ones through the review log's own
   * conflict oracle.
   *
   * Returns `undefined` when nothing is wired, which is what keeps
   * `compose()`'s existing overlap return byte-identical.
   *
   * The projection runs at most once per run: its clause -> changeId map
   * is persisted, and a second `compose()` (they are pull reads, called
   * freely, and `composeIfAllReported` calls one itself) reuses it rather
   * than opening a duplicate set of Changes in an append-only log.
   *
   * ORDER comes from `Model.openOrder`, read back off the review log
   * after the projection -- never recomputed here. That is the whole
   * "one graph, not two" discipline made operational: this method's own
   * opinion about ordering is that it doesn't have one.
   *
   * OD-PORT4-1 lands here, in three steps that cannot be collapsed:
   * `previewSeam` produces the merged content without writing anything,
   * `verifyMergedContent` re-runs VERIFY over it in this DO's own oracle
   * sandbox, and `resolveSeam` records the outcome that run ACTUALLY
   * produced. The check the review log ends up carrying is therefore an
   * observation, never a default -- and when nothing could be observed,
   * no check is recorded at all and `land()` refuses on INV-4.
   */
  /**
   * OD-PORT4-1, the half that has to be REAL: re-run VERIFY over the
   * MERGED content and report what it actually said.
   *
   * The principal's decision is "the check (VERIFY) re-runs automatically
   * on the merged content (it's an oracle, cheap), and a fresh Approver
   * verdict is required before the resolved Change lands." The verdict
   * half is `resolveSeam`'s (it records none, so `land()` refuses until a
   * human signs one). This is the check half, and it is the one thing
   * `ReviewCore` structurally cannot do for itself: KEEL's VERIFY oracle
   * is `this.rt.tool().execute` over a suite's compiled assertions, and it
   * lives on THIS DO.
   *
   * The SAME mechanism, not a parallel one. `SuiteOracleAdapter.verify`
   * runs `compileProgram(trace, assertions)` in `this.rt.tool().execute`
   * and maps the sandbox's per-criterion answer to pass/fail; so does
   * this, per contributing clause, against that clause's OWN resolved
   * suite (`derived_child.oracle_ref` — never assumed equal to the
   * root's, same discipline `join()` already follows) and against
   * `mergedTraceFor`'s restatement of its trace over the merged hunks.
   * `compose()`'s own two oracle call sites (`compileComposition`,
   * `compileSeam`) have the identical shape, completed-guard included.
   *
   * Returns `undefined` — meaning "no check", not "a failing check" —
   * whenever ANY contributing clause could not be judged: no trace, no
   * assertion in its suite, an assertion that does not declare itself
   * `mergeSensitive` (so re-running it says nothing about the merge —
   * see the gate below), a sandbox that did not complete, or a
   * sandbox result that is neither pass nor fail. That is
   * `SuiteOracleAdapter`'s own rule (unverifiable is not a fail,
   * PLAYBOOK-KEEL-VERDICT-SET-001 L1) meeting `CheckOutcome`'s two-value
   * vocabulary: there is no way to write "inconclusive" into the review
   * log, so the log stays silent and `land()` refuses on INV-4. Silence
   * is the honest encoding of "nobody verified this."
   *
   * An OBSERVED `fail` on any clause is returned as `fail` even when
   * another clause was unverifiable. A failure that really was observed is
   * a fact worth recording, and recording it blocks the land either way.
   */
  private async verifyMergedContent(
    clauses: readonly string[],
    merged: readonly Hunk[],
  ): Promise<CheckOutcome | undefined> {
    // No clauses is not a clean sheet, it is an empty observation.
    if (clauses.length === 0) return undefined;

    const rows = new Map(
      [...this.sql<{ serves_clause: string | null; do_name: string; oracle_ref: string | null }>`
        SELECT serves_clause, do_name, oracle_ref FROM derived_child`]
        .filter((r) => !!r.serves_clause)
        .map((r) => [r.serves_clause!, r]),
    );

    let anyUnverifiable = false;
    let anyFail = false;
    for (const clause of clauses) {
      const row = rows.get(clause);
      const suite = row?.oracle_ref ? this.suites.resolve(row.oracle_ref) : null;
      const assertion = suite?.assertions.find((a) => a.criterionId === clause);
      if (!assertion) { anyUnverifiable = true; continue; }
      // The second honesty gate, and the reason the first one was not
      // enough. Running an assertion over `mergedTraceFor`'s restatement
      // is a REAL oracle run, but a real run of a merge-BLIND assertion
      // answers a question about the slice, not about the merge:
      // `mergedTraceFor` substitutes the writes and copies
      // `result`/`status`/`egress` verbatim (it cannot do otherwise —
      // nothing re-executed), so an assertion reading only `trace.result`
      // returns the verdict it already returned for the slice alone.
      // Recording that as the merged-content check would launder a
      // per-slice pass into a claim nobody checked.
      //
      // `mergeSensitive` is the assertion author's DECLARED statement that
      // this assertion reads what was WRITTEN. Absent, the clause joins
      // the same "could not be judged" path as a missing trace or an
      // incomplete sandbox: `undefined`, no check recorded, `land()`
      // refuses on INV-4. Additive and fail-closed — this can only ever
      // turn a would-be `pass` into silence, never a `fail` into a pass.
      //
      // Gated PER CLAUSE, not per suite: `verifyMergedContent` runs exactly
      // ONE assertion per clause (the one matching `criterionId`), so a
      // suite-level test would let a merge-blind clause contribute a `pass`
      // on the strength of a merge-sensitive SIBLING — the same laundering
      // one level up.
      if (!assertion.mergeSensitive) { anyUnverifiable = true; continue; }
      const trace = await this.childStub(row!.do_name).executionTrace();
      if (!trace) { anyUnverifiable = true; continue; }

      const out = await this.rt.tool().execute(
        { code: compileProgram(mergedTraceFor(trace, merged), [assertion]) },
        undefined,
      );
      const res = out.status === "completed" ? (out.result as { results?: Record<string, string> }) : {};
      const status = res.results?.[clause];
      if (status === "fail") anyFail = true;
      else if (status !== "pass") anyUnverifiable = true;
    }

    if (anyFail) return "fail";
    if (anyUnverifiable) return undefined;
    return "pass";
  }

  private async attemptSeamReplay(
    children: readonly JoinChildReport[],
    overlaps: readonly FileOverlap[],
  ): Promise<SeamReplayOutcome | undefined> {
    this.ensureSchema();
    const core = this.reviewCoreStub();
    const row = [...this.sql<{ series_id: string; projected: string | null }>`SELECT series_id, projected FROM seam_replay WHERE id = 1`][0];
    if (!core || !row) return undefined;
    const seriesId = row.series_id;

    try {
      // Each slice's own recorded content and approval identities, pulled
      // through the SAME cross-DO surface `join()` already uses.
      const specs = new Map<string, SpecificationContent>();
      for (const r of this.sql<{ serves_clause: string | null; spec_content: string | null }>`
        SELECT serves_clause, spec_content FROM derived_child`) {
        if (r.serves_clause && r.spec_content) specs.set(r.serves_clause, JSON.parse(r.spec_content) as SpecificationContent);
      }
      const hunksByClause = new Map<string, Hunk[]>();
      const approvalByClause = new Map<string, { approverId: string; approved: boolean } | undefined>();
      for (const c of children) {
        if (!c.servesClause) continue;
        const stub = this.childStub(c.doName);
        const [hunks, approvers] = await Promise.all([stub.writtenHunks(), stub.approvers()]);
        hunksByClause.set(c.servesClause, [...hunks]);
        const gated = (specs.get(c.servesClause)?.approvalGated ?? []).length > 0;
        if (!gated) { approvalByClause.set(c.servesClause, undefined); continue; }
        const approverId = approvers[0];
        if (!approverId) {
          // Fail-closed, and the ONE case this whole design refuses to
          // paper over: the slice was approval-gated, so a human really
          // did clear it, but nobody recorded WHO. There is no honest
          // name to open the Change under and none to sign a verdict
          // with, and inventing one would forge a signed review. Refuse
          // the projection instead, and say exactly what is missing.
          return {
            resolved: false,
            reason: `slice ${c.servesClause} is approval-gated but no approver identity was recorded — call approve(approverId) so the review log can name a real reviewer`,
          };
        }
        approvalByClause.set(c.servesClause, { approverId, approved: true });
      }

      // One graph: C2's own declared edges become the Changes' parents.
      const parentsByClause = new Map(
        seriesParentsFor([...specs.values()]).map((p) => [p.servesClause, p.parentClauses]),
      );

      let changeIds: Record<string, string> = row.projected ? JSON.parse(row.projected) : {};
      if (!row.projected) {
        const landings = await projectSlicesAsChanges(
          core,
          seriesId,
          children.filter((c) => !!c.servesClause),
          (c) => hunksByClause.get(c.servesClause!) ?? [],
          {
            actorId: this.name,
            parentClausesOf: (c) => parentsByClause.get(c.servesClause!) ?? [],
            approvalOf: (c) => approvalByClause.get(c.servesClause!),
          },
        );
        changeIds = Object.fromEntries(landings.map((l) => [l.servesClause, l.changeId]));
        this.sql`UPDATE seam_replay SET projected = ${JSON.stringify(changeIds)} WHERE id = 1`;
      }

      // The overlapping clauses only -- ordered by the review log's own
      // `Model.openOrder`, which is the single source of truth for the
      // order this series composes in.
      const overlapping = new Set(overlaps.flatMap((o) => o.children));
      const openOrder = (await core.snapshot(seriesId)).openOrder;
      const orderedClauses: string[] = [];
      const ordered = openOrder
        .map((changeId) => {
          const clause = Object.keys(changeIds).find((k) => changeIds[k] === changeId);
          if (!clause || !overlapping.has(clause)) return null;
          orderedClauses.push(clause);
          return { changeId, hunks: hunksByClause.get(clause) ?? [] };
        })
        .filter((x): x is { changeId: string; hunks: Hunk[] } => !!x);
      if (ordered.length < 2) {
        return { resolved: false, reason: "the overlapping slices did not project to two or more Changes" };
      }

      // OD-PORT4-1, in the order the decision actually requires: MERGE,
      // then CHECK the merged content, then record. `previewSeam` writes
      // nothing, so a conflict here is the same INV-9 state `resolveSeam`
      // would have returned -- reported without opening anything, which
      // is what `resolveSeam` does on a conflict too.
      const preview = await core.previewSeam(seriesId, ordered);
      if (!preview.ok) {
        return { resolved: false, invariant: preview.invariant, at: preview.at, changeId: preview.changeId, changeIds };
      }

      // The check is whatever the oracle ACTUALLY returned over the merged
      // content -- `undefined` included, which records no check at all and
      // leaves `land()` to refuse on INV-4. Nothing here defaults, and
      // nothing here assumes.
      const checkOutcome = await this.verifyMergedContent(orderedClauses, preview.resolved);

      const res = await core.resolveSeam(this.name, seriesId, ordered, { checkOutcome });
      return res.ok
        ? { resolved: true, changeId: res.resolvedChangeId, changeIds }
        : { resolved: false, invariant: res.invariant, at: res.at, changeId: res.changeId, changeIds };
    } catch (e) {
      // A seam replay that itself fails must never take `compose()` down:
      // the overlap floor's own refusal is already correct and already
      // returned alongside this. Surfaced, not swallowed.
      return { resolved: false, reason: `seam replay failed: ${e instanceof Error ? e.message : String(e)}` };
    }
  }

  /** PLAYBOOK-KEEL-PARALLEL-SLICE-001 (Track 2, B.3/B.6): completion-push
   *  wake. Called BY a derived child (via `this.childStub(parentDoName)` —
   *  symmetric, same method a parent uses to reach a child) the moment
   *  ITS OWN run reaches a terminal state (`admit()`, above). Dedupes by
   *  `runId` against `derived_child` (already-reported is a no-op — Track
   *  3's idempotent-late-completion-after-reap case lands here too, same
   *  code path, no special casing needed). When EVERY recorded child has
   *  reported, runs the SAME `compose()` this DO already exposes via
   *  `POST /compose` — no new composition logic, no new admission path —
   *  and persists the result (`compose_result`) so it's observable without
   *  a caller having to poll `/compose` themselves (the whole point of the
   *  push: the parent does the work the moment it CAN, not on next ask).
   *  `join()`/`compose()`'s own pull-read stays exactly as it was — this
   *  is purely the WAKE, not a replacement for the read (Track 2's own
   *  instruction: additive, do not rip out the existing JOIN). */
  async childCompleted(runId: string, terminalState: "ACCEPT" | "ESCALATE"): Promise<void> {
    this.ensureSchema();
    const row = [...this.sql<{ reported_state: string | null; parent_run_id: string | null }>`SELECT reported_state, parent_run_id FROM derived_child WHERE run_id = ${runId}`][0];
    if (!row) return; // an unrecognized runId -- fail-safe no-op, never throws back at the reporting child
    if (row.reported_state !== null) {
      // Track 3 (D.5): idempotent late-completion-after-reap -- a no-op
      // for compose (already resolved), but NOT a silent drop.
      this.sql`INSERT INTO late_completion (run_id, terminal_state, reported_at) VALUES (${runId}, ${terminalState}, ${Date.now()})`;
      return;
    }
    this.sql`UPDATE derived_child SET reported_state = ${terminalState} WHERE run_id = ${runId}`;
    // Track 3: THIS child reported for real -- its own reaper is moot the
    // moment it does, regardless of whether siblings are still pending.
    await this.cancelReapFor(runId);
    // PLAYBOOK-KEEL-HANDOFF-001 (C2, Track 2): the SAME event that already
    // drove `composeIfAllReported` now ALSO releases (or propagate-
    // escalates) any HELD sibling waiting on this one -- before the
    // completeness check, so a newly-released/escalated row is already
    // reflected in it.
    if (row.parent_run_id) await this.releaseSettledHeldChildren(row.parent_run_id);
    await this.composeIfAllReported();
  }

  /** Track 3 (B.4/B.5): fires per-child, at the budget-derived deadline.
   *
   *  PLAYBOOK-KEEL-PARALLEL-SLICE-001 correctness finding (caught live,
   *  not in the original playbook text): checks the child's REAL state via
   *  the existing PULL read (`childStub().result()`, the same one join()
   *  uses) BEFORE assuming it's actually stuck. A push CAN be dropped (the
   *  child's own admit()-fiber can race ahead of `recordDerivedChild`
   *  finishing, or a transient RPC failure) -- if the pull shows the child
   *  already reached ACCEPT/ESCALATE, this is really just a late/missed
   *  `childCompleted`, handled the SAME way (record, cancel, maybe
   *  compose), never re-admitted for nothing. Only a GENUINELY unfinished
   *  child falls through to the actual reap:
   *  First firing (`reap_attempts === 0`, "it may have hit a transient"):
   *  re-admit the SAME recorded content once, through the exact same
   *  `childStub().admit()` path derive()/disposeBacklog() already use --
   *  `admit()`'s own idempotency (D7, keyed on the spec's content hash) is
   *  what makes "poke it again" safe rather than a duplicate run -- and
   *  schedule a second deadline. Second firing (still silent): fail-closed
   *  -- mark this child ESCALATED (a sentinel distinct from a real
   *  ACCEPT/ESCALATE the child itself reported) rather than retry forever;
   *  `join()`'s own pull-read of an escalated child still correctly shows
   *  its OWN real state (it genuinely never finished), so `compose()`
   *  still honestly reports not-ready — reap unblocks the WAIT, it never
   *  fabricates a result. A late `childCompleted` after escalation is
   *  still caught by the `reported_state !== null` dedupe above, exactly
   *  like any other already-reported case (INV: no special casing). */
  async reapStuckChildren(payload: { runId: string; doName: string }): Promise<void> {
    this.ensureSchema();
    const row = [...this.sql<{ reported_state: string | null; reap_attempts: number; spec_content: string | null; parent_run_id: string | null }>`
      SELECT reported_state, reap_attempts, spec_content, parent_run_id FROM derived_child WHERE run_id = ${payload.runId}`][0];
    if (!row || row.reported_state !== null) return; // reported (or reaped away) since this schedule was set -- nothing to do

    const real = await this.childStub(payload.doName).result();
    if (real?.state === "ACCEPT" || real?.state === "ESCALATE") {
      // The push never landed (a race or a transient), but the child
      // genuinely finished -- the pull read is the source of truth here,
      // same as join()'s own. Handle it exactly like childCompleted would.
      await this.cancelReapFor(payload.runId);
      this.sql`UPDATE derived_child SET reported_state = ${real.state} WHERE run_id = ${payload.runId}`;
      if (row.parent_run_id) await this.releaseSettledHeldChildren(row.parent_run_id);
      await this.composeIfAllReported();
      return;
    }

    if (row.reap_attempts === 0) {
      this.sql`UPDATE derived_child SET reap_attempts = 1 WHERE run_id = ${payload.runId}`;
      if (row.spec_content) {
        try {
          await this.childStub(payload.doName).admit(JSON.parse(row.spec_content), this.name);
        } catch (e) {
          console.error(`reap re-admit of "${payload.doName}" (run ${payload.runId}) failed`, e);
        }
      }
      const content = row.spec_content ? (JSON.parse(row.spec_content) as SpecificationContent) : undefined;
      await this.scheduleReapFor(payload.runId, payload.doName, this.REAP_PER_ATTEMPT_CEILING_MS * (content?.attemptBudget ?? 1));
      return;
    }

    // PLAYBOOK-KEEL-HANDOFF-001 (C2, Track 3, INV-HANDOFF-PROPAGATE): the
    // second silent deadline fail-closes this child AND cascades that
    // failure to every held sibling that consumes it -- the SAME mechanism
    // childCompleted's own real-completion path already reuses, so a stuck
    // upstream unblocks its downstreams exactly like a reported one does,
    // never leaving them held forever waiting on an event that a genuinely
    // stuck child will never produce.
    this.sql`UPDATE derived_child SET reported_state = 'ESCALATED' WHERE run_id = ${payload.runId}`;
    if (row.parent_run_id) await this.releaseSettledHeldChildren(row.parent_run_id);
    await this.composeIfAllReported();
  }

  /** Shared by `childCompleted` and `reapStuckChildren`'s escalate path:
   *  once every recorded child has EITHER genuinely reported OR been
   *  reap-escalated, run the SAME `compose()` this DO already exposes via
   *  `POST /compose` — no new composition logic, no new admission path —
   *  and persist the result (`compose_result`) so it's observable without
   *  a caller having to poll `/compose` themselves (the whole point of the
   *  push: the parent does the work the moment it CAN, not on next ask).
   *  `join()`/`compose()`'s own pull-read stays exactly as it was — this
   *  is purely the WAKE, not a replacement for the read (Track 2's own
   *  instruction: additive, do not rip out the existing JOIN). */
  private async composeIfAllReported(): Promise<void> {
    // Never while derive() is still admitting this generation's siblings
    // (the race this table exists to close, see derive()'s own comment) --
    // derive() itself re-checks once more the moment it finishes, so a
    // deferral here is never a lost check, only a correctly-timed one.
    const inProgress = [...this.sql<{ in_progress: number }>`SELECT in_progress FROM derive_state WHERE id = 1`][0];
    if (inProgress?.in_progress === 1) return;

    const all = [...this.sql<{ reported_state: string | null }>`SELECT reported_state FROM derived_child`];
    const allReported = all.length > 0 && all.every((r) => r.reported_state !== null);
    if (!allReported) return;
    const result = await this.compose();
    this.sql`INSERT OR REPLACE INTO compose_result (id, payload, at) VALUES (1, ${JSON.stringify(result)}, ${Date.now()})`;
  }

  /** Read-only: the compose result completion-push already produced, if
   *  any -- lets a caller observe "did it compose yet" without triggering
   *  `/compose`'s own (re-)computation. `null` before every child has
   *  reported. */
  async lastCompose(): Promise<{ readonly payload: unknown; readonly at: number } | null> {
    this.ensureSchema();
    const row = [...this.sql<{ payload: string; at: number }>`SELECT payload, at FROM compose_result WHERE id = 1`][0];
    return row ? { payload: JSON.parse(row.payload), at: row.at } : null;
  }

  /** Read-only: every idempotent late-completion this DO has recorded
   *  (Track 3, D.5) -- a child that reported after its reap already
   *  escalated it. Observability only; never re-triggers compose. */
  async lateCompletions(): Promise<readonly { runId: string; terminalState: string; reportedAt: number }[]> {
    this.ensureSchema();
    return [...this.sql<{ run_id: string; terminal_state: string; reported_at: number }>`SELECT run_id, terminal_state, reported_at FROM late_completion`]
      .map((r) => ({ runId: r.run_id, terminalState: r.terminal_state, reportedAt: r.reported_at }));
  }

  /** Read-only: `derived_child`'s Track 2/3 bookkeeping (reported_state,
   *  reap_attempts) alongside the fields `join()` already exposes --
   *  diagnosis without a re-read (per the playbook's own "diagnose from
   *  the log, not from a re-read"): a hang is almost always a child that
   *  never called back (reported_state still null past its deadline) or a
   *  parent still polling instead of hibernating (this endpoint existing
   *  at all is the proof it doesn't have to). */
  async debugFanout(): Promise<{
    readonly children: readonly {
      runId: string; doName: string; servesClause: string | null; reportedState: string | null;
      reapAttempts: number; reapScheduleId: string | null;
      // PLAYBOOK-KEEL-HANDOFF-001 (C2): "diagnose from the log, not from a
      // re-read" -- a hang now can ALSO be a held child whose declared
      // dependency never resolves; these two fields make that visible the
      // same way reportedState/reapAttempts already make a stuck fan-out
      // visible.
      held: boolean; dependsOn: readonly string[];
    }[];
    readonly lastCompose: { readonly payload: unknown; readonly at: number } | null;
    readonly lateCompletions: readonly { runId: string; terminalState: string; reportedAt: number }[];
  }> {
    this.ensureSchema();
    const rows = [...this.sql<{ run_id: string; do_name: string; serves_clause: string | null; reported_state: string | null; reap_attempts: number; reap_schedule_id: string | null; depends_on: string | null; held: number }>`
      SELECT run_id, do_name, serves_clause, reported_state, reap_attempts, reap_schedule_id, depends_on, held FROM derived_child`];
    return {
      children: rows.map((r) => ({
        runId: r.run_id, doName: r.do_name, servesClause: r.serves_clause,
        reportedState: r.reported_state, reapAttempts: r.reap_attempts, reapScheduleId: r.reap_schedule_id,
        held: r.held === 1, dependsOn: r.depends_on ? JSON.parse(r.depends_on) : [],
      })),
      lastCompose: await this.lastCompose(),
      lateCompletions: await this.lateCompletions(),
    };
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
      const { runId } = await this.childStub(doName).admit(entry.spec, this.name);
      // PLAYBOOK-KEEL-JOIN: a human-approved derived child is still a child
      // of this root's derivation tree — not just derive()'s auto-admit
      // branch. Omitting it here would leave the exact silent gap this
      // playbook exists to close, just reached via a different door.
      await this.recordDerivedChild(runId, doName, entry.spec, parentId);
      await this.recordDependsOn(runId, parentId, rootNode.id);
      return { disposed: true, doName, runId };
    }
    return { disposed: true };
  }

  // `verdict: Json` (not `unknown`/`any`) matches `OrchestratorRpc.result()`
  // above -- see that interface's comment for why (Track 1 finding).
  async result(): Promise<{ state: string | null; verdict: Json; executionId: string | null; nodeKinds: string[] } | null> {
    this.ensureSchema();
    // PLAYBOOK-KEEL-HANDOFF-001 (C2) correctness finding (caught live, not
    // in the original playbook text): `lineage_nodes` is created by
    // `repo()` (LineageDoAdapter's own constructor), not by `ensureSchema`
    // above -- every pre-C2 caller of `result()` was always reached on a DO
    // that had already gone through `admit()` at least once (which calls
    // `repo()`), so this table always happened to already exist. C2's
    // propagate-escalate path (`releaseSettledHeldChildren`) is the FIRST
    // case where `derived_child` can hold a row for a DO that was NEVER
    // admitted at all -- join()'s pull-read of that row's `result()` then
    // hit a bare `SELECT ... FROM lineage_nodes` on a table that was never
    // created, crashing instead of returning the documented `null`. `repo()`
    // is idempotent (`CREATE TABLE IF NOT EXISTS`), so calling it here is a
    // no-op on every OTHER (already-admitted) caller.
    this.repo();
    const rows = [...this.sql<{ state: string; verdict: string; execution_id: string | null }>`SELECT state, verdict, execution_id FROM run_terminal WHERE id = 1`];
    const kinds = [...this.sql<{ kind: string }>`SELECT kind FROM lineage_nodes`].map((r) => r.kind);
    const r = rows[0];
    if (!r) return kinds.length ? { state: null, verdict: null, executionId: null, nodeKinds: kinds } : null;
    return { state: r.state, verdict: JSON.parse(r.verdict ?? "null"), executionId: r.execution_id, nodeKinds: kinds };
  }

  /** PLAYBOOK-KEEL-SLICE-FILES-001 (C1b, Track 2, INV-SLICE-DISCOVERED): the
   *  union of every write-effectful `state.*` call's touched path(s), across
   *  EVERY `ExecutionTrace` this run ever recorded (every attempt) -- a
   *  plain OBSERVED set, never declared/guessed, and deliberately no
   *  rollback inference: the playbook's own text is "a plain observed set —
   *  path in, no inference," so this does NOT try to exclude a later-
   *  reverted attempt's writes (PLAYBOOK-KEEL-WRITE-ROLLBACK-001 reverts a
   *  discarded attempt's WORKSPACE content, but its ExecutionTrace node
   *  still honestly records what was attempted — that recorded fact is what
   *  this reads, not a re-derivation of current Workspace state).
   *  `mv` touches BOTH `src` (removed) and `dest` (created); `cp` touches
   *  ONLY `dest` (the connector's own doc: "src is untouched by cp").
   *
   *  `repo()` first, same fix as `result()` above -- a C2 propagate-
   *  escalated held child can be queried here having never been admitted at
   *  all, so `lineage_nodes` may not exist yet without this. */
  async writtenFiles(): Promise<readonly string[]> {
    this.ensureSchema();
    const repo = this.repo();
    const nodes = await repo.loadRun();
    const files = new Set<string>();
    for (const n of nodes) {
      if (n.kind !== "ExecutionTrace") continue;
      const calls = (n.content as ExecutionTraceContent).calls ?? [];
      for (const c of calls) {
        if (c.connector !== "state") continue;
        const args = c.args as Record<string, unknown> | undefined;
        // PLAYBOOK-KEEL-SCR-PORT-4 (Track 2): `writeSection` joins the
        // path-bearing writes here. It touches ONE anchored region rather
        // than the whole file, but it is still a write to that PATH, and
        // this set is what `checkFileOverlap` reads -- a sub-file write
        // that didn't report its path would make the overlap invisible
        // and the whole seam-resolution branch unreachable. Overlap
        // detection stays at file granularity (correct: two slices in one
        // file is exactly the thing worth looking at); whether that
        // overlap is a real conflict is decided at ANCHOR granularity,
        // later, by `replaySeam`.
        if (c.method === "writeFile" || c.method === "rm" || c.method === "writeSection") {
          if (typeof args?.path === "string") files.add(args.path);
        } else if (c.method === "mv") {
          if (typeof args?.src === "string") files.add(args.src);
          if (typeof args?.dest === "string") files.add(args.dest);
        } else if (c.method === "cp") {
          if (typeof args?.dest === "string") files.add(args.dest);
        }
      }
    }
    return [...files].sort();
  }

  /** PLAYBOOK-KEEL-SCR-PORT-4 (Track 2): the same recorded writes
   *  `writtenFiles()` reads, as SCR HUNKS rather than as bare paths — the
   *  content half that a review log needs and a file list cannot carry.
   *  Same `ExecutionTrace.calls` scan, same `repo()` prelude (a C2
   *  propagate-escalated child may never have been admitted, so
   *  `lineage_nodes` may not exist yet), same observed-not-declared
   *  discipline.
   *
   *  `state.writeFile` maps to the single anchor `"file"`: a whole-file
   *  write really does claim the whole file, so it must conflict with
   *  anything else touching that path — and under the (path, anchor)
   *  conflict rule, `"file"` does exactly that against another `"file"`.
   *  `state.writeSection` maps to its own declared anchor, which is the
   *  entire point of adding it (PORT-4, locked decision 1): two slices on
   *  disjoint sections of one file now produce hunks that genuinely
   *  compose, so the clean-merge branch of `replaySeam` is reachable at
   *  all.
   *
   *  Last write to a (path, anchor) wins, first write fixes its position
   *  — `Map.set`, the same rule `replaySeam`'s union and the composer's
   *  own materialisation use. Across ATTEMPTS that is the honest reading:
   *  the newest recorded content for a region is what that region was
   *  last left as. */
  async writtenHunks(): Promise<readonly Hunk[]> {
    this.ensureSchema();
    const repo = this.repo();
    const nodes = await repo.loadRun();
    const hunks = new Map<string, Hunk>();
    for (const n of nodes) {
      if (n.kind !== "ExecutionTrace") continue;
      const calls = (n.content as ExecutionTraceContent).calls ?? [];
      for (const c of calls) {
        if (c.connector !== "state") continue;
        const args = c.args as Record<string, unknown> | undefined;
        if (typeof args?.path !== "string" || typeof args?.content !== "string") continue;
        const anchor =
          c.method === "writeFile" ? "file"
          : c.method === "writeSection" && typeof args.anchor === "string" ? args.anchor
          : null;
        if (anchor === null) continue;
        hunks.set(`${args.path} ${anchor}`, { path: args.path, anchor, content: args.content });
      }
    }
    return [...hunks.values()];
  }

  /** PLAYBOOK-KEEL-SCR-PORT-4 (OD-PORT4-1): this run's LAST recorded
   *  `ExecutionTrace` — the same "newest recorded fact wins across
   *  attempts" reading `writtenHunks()` above applies to content, applied
   *  to the trace those hunks came off, and the same `repo()` prelude for
   *  the same reason (a C2 propagate-escalated child may never have been
   *  admitted, so `lineage_nodes` may not exist yet).
   *
   *  `null` for a run that never executed. That is a real answer and the
   *  caller must treat it as one: a merged-content VERIFY with no trace to
   *  restate is a VERIFY that did not run, which records no check at all
   *  rather than a guess (see `verifyMergedContent`). */
  async executionTrace(): Promise<ExecutionTraceContent | null> {
    this.ensureSchema();
    const repo = this.repo();
    const nodes = await repo.loadRun();
    let last: ExecutionTraceContent | null = null;
    for (const n of nodes) if (n.kind === "ExecutionTrace") last = n.content as ExecutionTraceContent;
    return last;
  }

  /** PLAYBOOK-KEEL-SCR-PORT-4 (Track 1, locked decision 2): every identity
   *  that cleared an approval gate on THIS run, oldest first. Empty for a
   *  run that never paused, and — deliberately — also for a run approved
   *  through `approve()` with no identity supplied. Absence here means
   *  "nobody is named", never "somebody generic": the slice->Change
   *  bridge fails closed on it rather than signing a verdict with an
   *  invented name (see slice-change-bridge.ts's own doc). */
  async approvers(): Promise<readonly string[]> {
    this.ensureSchema();
    return [...this.sql<{ approver_id: string }>`SELECT approver_id FROM run_approval ORDER BY id ASC`].map((r) => r.approver_id);
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

  // --- PLAYBOOK-KEEL-PROPOSER-INTEGRATION-001: the Lift-Proposer's -----------
  // authoring flow (B1 completion). Upstream of run dispatch (OD-INT-1) — a
  // DISTINCT surface (OD-INT-3): admit()/approve() are completely untouched,
  // so a run proceeds on whatever the spec already contains regardless of
  // any pending lift on this same DO (A.4/C.4).

  /** B.1/B.2: propose -> challenge -> surface, in one call. Runs the
   *  candidate's REAL family probe (compileMetamorphic, the same one
   *  SuiteOracleAdapter uses) via this DO's own sandboxed runtime — not a
   *  mock. A survivor is persisted as the one pending lift (mirrors
   *  `pending_run`'s single-row pattern) and returned as an approval
   *  request; nothing is written to any spec here (INV-LP-SURFACE-NOT-
   *  CERTIFY still holds — this method never calls ratifyAndWrite).
   *
   *  PLAYBOOK-KEEL-COUNTEREXAMPLE-GEN-001 (A.5): the case set is now three
   *  tiers, joined here between propose and challenge --
   *  `defaultBoundaryCases()` (base), `mineScopeDerivedCases` (structural,
   *  mined from every OTHER relation's R1 scope on `input.parent`, no
   *  model risk), and `input.cases` (the model-proposed tier, inputs
   *  only — unchanged from PLAYBOOK-KEEL-PROPOSER-INTEGRATION-001).
   *  `challengeCandidate` itself is untouched (Track C). */
  async proposeLift(input: LiftProposeInput): Promise<LiftProposeResult> {
    this.ensureSchema();
    const proposed = proposeCandidate(input.criterionId, input.family, input.disposition);
    if (!proposed.admitted) return { surfaced: false, reason: proposed.reason };

    const scopeDerivedCases = mineScopeDerivedCases(input.criterionId, input.parent.acceptance);
    const probes = [...new Set([...defaultBoundaryCases(), ...scopeDerivedCases, ...(input.cases ?? [])])];
    const criterion: AcceptanceCriterion = {
      id: input.criterionId, statement: "", kind: "property",
      family: proposed.candidate.family,
      applicability: proposed.candidate.applicability,
      invalidators: proposed.candidate.invalidators,
    };
    const assertion: OracleAssertion = { criterionId: input.criterionId, kind: "property", metamorphic: { probes } };
    const out = await this.rt.tool().execute({ code: compileMetamorphic(input.actionCode, [{ criterion, assertion }]) }, undefined);
    const res = out.status === "completed" ? (out.result as { results?: Record<string, readonly string[]> }) : {};
    const perProbe = res.results?.[input.criterionId] ?? probes.map(() => "fail" as const);

    const cases: readonly ChallengeCase[] = probes.map((probe, i) => {
      const status = perProbe[i];
      const passed = status === "pass" || status === "not-applicable";
      return passed ? { input: probe, passed: true } : { input: probe, passed: false, legitimacy: input.caseLegitimacy?.[probe] };
    });

    const challenged = challengeCandidate(proposed.candidate, cases);
    const surfaced = surfaceCandidate(challenged.candidate, input.domainOwnerConfirmed ?? false);
    if (!surfaced.ready) return { surfaced: false, reason: surfaced.reason };

    this.sql`INSERT OR REPLACE INTO pending_lift (id, candidate, parent, root, policy) VALUES (
      1, ${JSON.stringify(surfaced.surfaced.candidate)}, ${JSON.stringify(input.parent)}, ${JSON.stringify(input.root)}, ${JSON.stringify(input.policy)}
    )`;
    return { surfaced: true, package: surfaced.surfaced };
  }

  /** B.3/B.6: the authority's approval resumes through this touchpoint —
   *  the SOLE write path. Loads the one pending lift, calls `ratifyAndWrite`
   *  (through the real `freezeGate` — not exempt, D.7), and clears the
   *  pending record either way (resolved, successfully or not). Does NOT
   *  itself call admit() — dispatching a run against the lifted spec is a
   *  separate, subsequent action (OD-INT-3: this stays a distinct surface
   *  from run dispatch), matching C.2's "a subsequent run enforces it". */
  async approveLift(): Promise<LiftApproveResult> {
    this.ensureSchema();
    const row = [...this.sql<{ candidate: string; parent: string; root: string; policy: string }>`
      SELECT candidate, parent, root, policy FROM pending_lift WHERE id = 1`][0];
    if (!row) return { approved: false, reason: "no pending lift" };
    this.sql`DELETE FROM pending_lift WHERE id = 1`;

    const candidate = JSON.parse(row.candidate) as LiftCandidate;
    const parent = JSON.parse(row.parent) as SpecificationContent;
    const root = JSON.parse(row.root) as SpecificationContent;
    const policy = JSON.parse(row.policy) as GatePolicy;

    const written = ratifyAndWrite(candidate, { ratified: true }, parent, root, policy);
    if (!written.written) return { approved: false, reason: written.reason };
    return { approved: true, spec: written.spec };
  }

  /** B.3/C.3: an authority rejection resumes through the SAME touchpoint —
   *  clears the pending lift, writes nothing. */
  async rejectLift(): Promise<{ readonly rejected: boolean }> {
    this.ensureSchema();
    const row = [...this.sql<{ id: number }>`SELECT id FROM pending_lift WHERE id = 1`][0];
    if (!row) return { rejected: false };
    this.sql`DELETE FROM pending_lift WHERE id = 1`;
    return { rejected: true };
  }
}
