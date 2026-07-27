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
export type { GroundingGatePort } from "./ports/grounding-gate.port";
export type { JudgeGraderPort } from "./ports/judge-grader.port";
export type { BehaviorLedgerPort } from "./ports/behavior-ledger.port";
export type { LineageRepositoryPort } from "./ports/lineage-repository.port";
export type { RunDispatchPort, AdmitResult } from "./ports/run-dispatch.port";
export type { ConnectorRegistryPort, ConnectorRef } from "./ports/connector-registry.port";
export type { ClockPort, EntropyPort } from "./ports/determinism.port";

// The loop (typed data + pure policy)
export type { LoopState, Transition } from "./loop/state";
export { TRANSITIONS, TERMINAL, transitionsFrom, isTerminal } from "./loop/state";
export type { DecideInput, DecideOutcome } from "./loop/decide";
export { decide } from "./loop/decide";
// PLAYBOOK-KEEL-VERDICT-SET-001 (L1): the honest per-criterion -> overall
// verdict rollup -- not-applicable excluded from the tally, vacuous fails closed
export type { CriterionVerdictStatus } from "./loop/verdict-aggregate";
export { aggregateVerdict } from "./loop/verdict-aggregate";

// Grounding gate (PLAYBOOK-KEEL-GROUNDING-001, B1): two graders, one
// monotone score, seated before generate() -- pure core, substrate-free
export type {
  EvidenceType, OracleGradeLabel, JudgeGradeLabel, OracleGrade, JudgeGrade,
  GroundingWeights, CriterionOutcome, CriterionResult, OracleFactInput,
} from "./grounding/grader";
export {
  DEFAULT_GROUNDING_WEIGHTS, scoreCriterion, decideCriterion, gradeCriteria,
  aggregateGate, gradeOracleFact,
} from "./grounding/grader";

// Behavior disposition ledger (PLAYBOOK-KEEL-DISPOSITION-001, D1): classify
// every material behavior before its relation is graded -- distinct from
// the existing (approval-routing) Disposition node kind above, deliberately
// never sharing a symbol name with it.
export type { BehaviorDisposition, BehaviorLedgerEntry, RelationFamily } from "./disposition/ledger";
export { resolveDisposition, authorityMatches, familyMismatch, overlayDisposition } from "./disposition/ledger";

// Replay / read-side (M4, additive)
export type { TimelineEntry, ReplaySnapshot, ReplayConsistency, CrossRunRecord, Terminal } from "./replay/projection";
export { eventToState, timeline, replayTo, verifyReplay, crossRunRecord } from "./replay/projection";
export type { QueryPort, CustodyView } from "./ports/query.port";
export type { CrossRunIndexPort, CrossRunListOptions } from "./ports/cross-run-index.port";

// Phase 6a spec-loop
export type { GateTier, GateDecision, GatePolicy } from "./spec-loop/gate";
export {
  freezeGate, attenuates, inheritsProhibitions, inheritsSpanning, inheritsDisposition,
  isScopeAdmittable, inheritsApplicability, inheritsInvalidators, inheritsPreservationSet,
  isReversible, isWellFormed, hasGoalMapping,
} from "./spec-loop/gate";
export type { Deriver, DerivationEvidence } from "./spec-loop/derive";
export { templateDerive, templateDeriver } from "./spec-loop/derive";
export type { BacklogStatus, BacklogEntry, BacklogStore } from "./spec-loop/backlog";
export type { SpecLoopBound, SpecLoopCtx, SpecLoopSummary } from "./spec-loop/loop";
export { runSpecLoop } from "./spec-loop/loop";
// PLAYBOOK-KEEL-COVERAGE: derivation coverage — catches an omitted clause
// (untrusted deriver, set-level check) before anything is admitted.
export type { CoverageReport } from "./spec-loop/coverage";
export { clauseIds, checkCoverage } from "./spec-loop/coverage";
// PLAYBOOK-KEEL-DERIV-AMEND (INV-DECOMP-8): decide()'s exit policy, lifted
// to the decomposition level — consumes coverage/compose verdicts, does not
// re-implement them.
export type { CompositionLegVerdict, DecompDecisionInput, DecompDecision } from "./spec-loop/decide-decomp";
export { decideDecomp, failureToEvidence } from "./spec-loop/decide-decomp";

// Phase 6b foreign-tool policy
export type { ForeignAllowlist, FieldSpec, SchemaFields, ResponseSchema, Projection } from "./foreign/policy";
export { isAllowedServer, projectResponse, hasDivergence, projectFields } from "./foreign/policy";

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

// Effect signatures (BRIEF-KEEL-EFFECT-SIGNATURE-001): per-method effect
// declaration -> derived approval + reversibility, anchored to the trace
export type { EffectClass } from "./effect/lattice";
export { effectAttenuates } from "./effect/lattice";
export type { IdempotencyClass } from "./effect/idempotency";
export type { ErrorClass } from "./effect/errors";
export { classifyTerminal } from "./effect/errors";
export type { ReadRef, WriteRef, EffectSignature, IdempotenceProvenance } from "./effect/signature";
export { projectArgs } from "./effect/project-args";
export type { EffectVerdict } from "./effect/verify";
export { verifyEffect } from "./effect/verify";
export type { Attestation } from "./effect/registry";
export { EFFECT_SIGNATURES, effectSignatureFor, requiresApprovalFor, approvalForSignature, isRevertible, ATTESTED_IDEMPOTENT, attestedIdempotent } from "./effect/registry";

// OpenAPI import (BRIEF-KEEL-CONNECTOR-DESCRIPTOR-001): derive EffectSignature[]
// from an OpenAPI document — descriptive only, never admissive (INV-DESC-*)
export type { OpenApiSchema, OpenApiMediaType, OpenApiParameter, OpenApiRequestBody, OpenApiResponse, OpenApiOperation, OpenApiPathItem, OpenApiServer, OpenApiDocument } from "./effect/import/openapi";
export { openapiToSignatures } from "./effect/import/openapi";
export { statusToErrorClass } from "./effect/import/status-map";

// Skill selection + store (BRIEF-KEEL-SKILL-001): connector-doc/amend-prompt/
// procedure prompt surfaces, fronted by selection, gated by the built improve
// functions above — no new promotion mechanism
export type { SkillKind, SkillRecord, SkillStorePort } from "./skill/store";
export type { SkillConnectorDoc, SkillSelection, SelectSkillsOptions } from "./skill/select";
export { selectSkills } from "./skill/select";
