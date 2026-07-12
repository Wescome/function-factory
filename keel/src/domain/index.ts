/**
 * index.ts — THE FROZEN DOMAIN SURFACE (M1 / Phase 2).
 *
 * This barrel is the public contract of the KEEL domain. Everything exported
 * here is frozen: adapters (Phase 3+) implement these ports and consume these
 * types, but do not change their shape. Nothing in this subtree imports the
 * Cloudflare substrate — enforced by scripts/lint-deps.mjs and the CI gate.
 */

// The lineage contract (Shared Kernel)
export type { ContentHash, EdgeKind, ProvenanceEdge, LineageNode, NodeInput } from "./lineage/contract";

// The SE-Onto entities
export type {
  AcceptanceCriterion, SpecificationContent, Specification,
  ActionContent, Action,
  ConnectorCall, PendingAction, ExecutionStatus, ExecutionTraceContent, ExecutionTrace,
  VerdictOutcome, VerdictContent, Verdict,
  AmendmentContent, Amendment,
  DecisionContent, Decision,
  DispositionContent, Disposition,
  AnyNode, NodeKind,
} from "./lineage/nodes";

// Domain events
export type {
  RunAdmitted, ActionGenerated, ExecutionRecorded, ActionPaused,
  VerdictEmitted, AmendmentRequested, RunAccepted, RunEscalated,
  DomainEvent, DomainEventType,
} from "./lineage/events";

// Driven ports
export type { ModelPort, GeneratedAction } from "./ports/model.port";
export type { CodeExecutionPort, ExecutionOutcome } from "./ports/code-execution.port";
export type { OraclePort, OracleSpec } from "./ports/oracle.port";
export type { LineageRepositoryPort } from "./ports/lineage-repository.port";
export type { RunDispatchPort, AdmitResult } from "./ports/run-dispatch.port";
export type { ConnectorRegistryPort, ConnectorRef } from "./ports/connector-registry.port";
export type { ClockPort, EntropyPort } from "./ports/determinism.port";

// The loop (typed data + pure policy)
export type { LoopState, Transition } from "./loop/state";
export { TRANSITIONS, TERMINAL, transitionsFrom, isTerminal } from "./loop/state";
export type { DecideInput, DecideOutcome } from "./loop/decide";
export { decide } from "./loop/decide";

// Replay / read-side (M4, additive)
export type { TimelineEntry, ReplaySnapshot, ReplayConsistency, CrossRunRecord, Terminal } from "./replay/projection";
export { eventToState, timeline, replayTo, verifyReplay, crossRunRecord } from "./replay/projection";
export type { QueryPort, CustodyView } from "./ports/query.port";
export type { CrossRunIndexPort, CrossRunListOptions } from "./ports/cross-run-index.port";

// Phase 6a spec-loop
export type { GateTier, GateDecision, GatePolicy } from "./spec-loop/gate";
export { freezeGate, attenuates, inheritsProhibitions, isReversible, isWellFormed, hasGoalMapping } from "./spec-loop/gate";
export type { Deriver } from "./spec-loop/derive";
export { templateDerive, templateDeriver } from "./spec-loop/derive";
export type { BacklogStatus, BacklogEntry, BacklogStore } from "./spec-loop/backlog";
export type { SpecLoopBound, SpecLoopCtx, SpecLoopSummary } from "./spec-loop/loop";
export { runSpecLoop } from "./spec-loop/loop";

// Phase 6b foreign-tool policy
export type { ForeignAllowlist, FieldSpec, SchemaFields, ResponseSchema, Projection } from "./foreign/policy";
export { isAllowedServer, projectResponse, hasDivergence } from "./foreign/policy";

// Improvement loop (BRIEF-KEEL-IMPROVE-001)
export type { ImprovableSurface, VerdictPair, ImprovementCandidate, ImprovementDecision, HarnessFixStat } from "./improve/gate";
export { IMPROVABLE_SURFACES, evaluateImprovement, wilsonInterval, ciSeparated, evaluateHarnessFix } from "./improve/gate";
export type { TraceSummary, ProcedureCandidate, ReplayResult, ProcedurePassResult } from "./improve/loop";
export { mineProcedures, evaluateProcedure, runProcedurePass } from "./improve/loop";
export type { AnchorTrace } from "./improve/policy";
export { pendingCandidates, curateRegressionSuite, procedureStillAddsValue } from "./improve/policy";

// Inbound MCP v1 (BRIEF-KEEL-INBOUND-001) — the menu + envelope enforcement
export type { RegisteredSpec, SpecRegistry, Principal, Admission } from "./inbound/envelope";
export { invocationAuditKey, resolveInvocation, visibleSpecs } from "./inbound/envelope";
export { DEFAULT_REGISTRY } from "./inbound/registry";

// Inbound policies (OD-IN-1/3/4/6): envelope granularity, quota, restriction
// validation, audit outcome-authoritativeness
export type { QuotaDecision, AuditStatus, InvocationAudit } from "./inbound/policy";
export { effectiveEnvelope, evaluateQuota, validateRestriction, resolveInvocationAudit } from "./inbound/policy";
