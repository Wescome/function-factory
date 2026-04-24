/**
 * Local types for function-synthesis.
 *
 * Types here are candidates for promotion to @factory/schemas once
 * stabilized. Each type is annotated with the AC it supports.
 */

import { z } from "zod"

// ─── Role Names (AC 6, 7, 15) ─────────────────────────────────────────

export const RoleName = z.enum(["Planner", "Coder", "Critic", "Tester", "Verifier"])
export type RoleName = z.infer<typeof RoleName>

// ─── Terminal Verdict (AC 2, 3, 4) ────────────────────────────────────

export const TerminalVerdict = z.enum([
  "pass",
  "patch-exhausted",
  "resample-exhausted",
  "interrupt",
  "fail",
])
export type TerminalVerdict = z.infer<typeof TerminalVerdict>

// ─── Verifier Decision (the per-iteration decision) ───────────────────

export const VerifierDecision = z.enum(["pass", "patch", "resample", "interrupt", "fail"])
export type VerifierDecision = z.infer<typeof VerifierDecision>

// ─── Disagreement Class (AC 8) ────────────────────────────────────────

export const DisagreementClass = z.enum(["repairable_local", "architectural", "governance"])
export type DisagreementClass = z.infer<typeof DisagreementClass>

// ─── Inference Config (AC 2, 3) ───────────────────────────────────────

export const InferenceConfig = z.object({
  maxRepairLoops: z.number().int().nonnegative(),
  patchIterationCap: z.number().int().nonnegative(),
})
export type InferenceConfig = z.infer<typeof InferenceConfig>

// ─── Convergence Policy (AC 3) ────────────────────────────────────────

export const ConvergencePolicy = z.object({
  maxResampleBranches: z.number().int().nonnegative(),
})
export type ConvergencePolicy = z.infer<typeof ConvergencePolicy>

// ─── Tool Call Record (AC 10) ─────────────────────────────────────────

export const ToolCallRecord = z.object({
  role: RoleName,
  tool: z.string().min(1),
  input: z.record(z.string(), z.unknown()),
  output: z.record(z.string(), z.unknown()),
  timestamp: z.string().datetime(),
})
export type ToolCallRecord = z.infer<typeof ToolCallRecord>

// ─── Role Iteration Record (AC 10) ────────────────────────────────────

export const RoleIterationRecord = z.object({
  role: RoleName,
  iteration: z.number().int().nonnegative(),
  inputFields: z.array(z.string()),
  outputFields: z.array(z.string()),
  toolCalls: z.array(ToolCallRecord),
  durationMs: z.number().nonnegative(),
})
export type RoleIterationRecord = z.infer<typeof RoleIterationRecord>

// ─── Resample Node (AC 10) ────────────────────────────────────────────

export const ResampleNode = z.object({
  branchIndex: z.number().int().nonnegative(),
  roleIterations: z.array(RoleIterationRecord),
  terminalVerdict: TerminalVerdict.optional(),
})
export type ResampleNode = z.infer<typeof ResampleNode>

// ─── Validation Outcome (AC 10, 11) ───────────────────────────────────

export const ValidationOutcome = z.object({
  validationId: z.string().min(1),
  passed: z.boolean(),
  summary: z.string().min(1),
  details: z.record(z.string(), z.unknown()).optional(),
})
export type ValidationOutcome = z.infer<typeof ValidationOutcome>

// ─── Terminal Decision (AC 10) ────────────────────────────────────────

export const TerminalDecision = z.object({
  verdict: TerminalVerdict,
  rationale: z.string().min(1),
  repairLoopCount: z.number().int().nonnegative(),
  resampleBranchCount: z.number().int().nonnegative(),
})
export type TerminalDecision = z.infer<typeof TerminalDecision>

// ─── Human Approval Payload (AC escalation) ───────────────────────────

export const HumanApprovalPayload = z.object({
  reason: z.string().min(1),
  violationType: z.enum(["scope", "hard_constraint"]),
  requestedAction: z.enum(["approve", "reject", "amend"]),
})
export type HumanApprovalPayload = z.infer<typeof HumanApprovalPayload>

// ─── Synthesis Trace Log (AC 10) ──────────────────────────────────────
// TODO: promote to @factory/schemas — this is the synthesis-specific
// execution trace, distinct from the pipeline ExecutionTrace

export const SynthesisTraceLog = z.object({
  runId: z.string().min(1),
  workGraphId: z.string().min(1),
  architectureCandidateId: z.string().min(1),
  bindingModeName: z.string().min(1),
  roleIterations: z.array(RoleIterationRecord),
  resampleBranches: z.array(ResampleNode),
  validationOutcomes: z.array(ValidationOutcome),
  terminalDecision: TerminalDecision,
  generatedArtifactPaths: z.array(z.string()),
  startedAt: z.string().datetime(),
  completedAt: z.string().datetime(),
})
export type SynthesisTraceLog = z.infer<typeof SynthesisTraceLog>

// ─── Contract Surface Check (AC 6, 7) ─────────────────────────────────

export const ContractSurfaceVerdict = z.enum(["pass", "fail", "unknown"])
export type ContractSurfaceVerdict = z.infer<typeof ContractSurfaceVerdict>

export const ContractSurfaceCheck = z.object({
  surface: z.enum(["read_access", "write_access", "do_not", "output_semantics"]),
  verdict: ContractSurfaceVerdict,
  violations: z.array(z.string()),
})
export type ContractSurfaceCheck = z.infer<typeof ContractSurfaceCheck>

// ─── Role Adherence Entry (AC 6) ──────────────────────────────────────

export const RoleAdherenceEntry = z.object({
  role: RoleName,
  checks: z.array(ContractSurfaceCheck).length(4),
  overallCompliant: z.boolean(),
})
export type RoleAdherenceEntry = z.infer<typeof RoleAdherenceEntry>

// ─── Role Adherence Report (AC 6, 7, 9) ──────────────────────────────

export const RoleAdherenceReport = z.object({
  synthesisRunId: z.string().min(1),
  entries: z.array(RoleAdherenceEntry).min(1),
  semanticIntentUnverified: z.literal(true),
  overallCompliant: z.boolean(),
  timestamp: z.string().datetime(),
})
export type RoleAdherenceReport = z.infer<typeof RoleAdherenceReport>

// ─── Gate 2 Input (AC 11) ─────────────────────────────────────────────
// TODO: promote to @factory/schemas — normalized acceptance evidence

export const Gate2Input = z.object({
  synthesisRunId: z.string().min(1),
  functionId: z.string().min(1),
  workGraphId: z.string().min(1),
  architectureCandidateId: z.string().min(1),
  artifactPaths: z.array(z.string()),
  validationOutcomes: z.array(ValidationOutcome),
  compileSummary: z.string().min(1),
  testSummary: z.string().min(1),
  scopeViolation: z.boolean(),
  constraintViolation: z.boolean(),
  repairLoopCount: z.number().int().nonnegative(),
  resampleSummary: z.string().min(1),
  provenance: z.object({
    bindingModeName: z.string().min(1),
    promptPackVersion: z.string().min(1),
    toolPolicyHash: z.string().min(1),
    modelBindingHash: z.string().min(1),
    startedAt: z.string().datetime(),
    completedAt: z.string().datetime(),
  }),
})
export type Gate2Input = z.infer<typeof Gate2Input>

// ─── Candidate Selection Report (AC 12) ───────────────────────────────
// TODO: promote to @factory/schemas

export const SynthesisCandidateSelectionReport = z.object({
  synthesisRunId: z.string().min(1),
  candidateId: z.string().min(1),
  topology: z.string().min(1),
  modelBinding: z.string().min(1),
  objectiveScores: z.record(z.string(), z.number()),
  selectionReason: z.string().min(1),
  timestamp: z.string().datetime(),
})
export type SynthesisCandidateSelectionReport = z.infer<typeof SynthesisCandidateSelectionReport>

// ─── Patch Proposal (Coder output) ────────────────────────────────────

export const PatchProposal = z.object({
  targetPath: z.string().min(1),
  content: z.string(),
  workGraphNodeId: z.string().min(1),
  rationale: z.string().min(1),
})
export type PatchProposal = z.infer<typeof PatchProposal>

// ─── Synthesis Result (public API return type) ────────────────────────

export const SynthesisResult = z.object({
  runId: z.string().min(1),
  verdict: TerminalVerdict,
  generatedArtifactPaths: z.array(z.string()),
  traceLog: SynthesisTraceLog,
  roleAdherenceReport: RoleAdherenceReport,
  gate2Input: Gate2Input,
  candidateSelectionReport: SynthesisCandidateSelectionReport,
  requiresHumanApproval: z.boolean(),
  humanApprovalPayload: HumanApprovalPayload.optional(),
})
export type SynthesisResult = z.infer<typeof SynthesisResult>

// ─── Memory Write Record (AC 19) ──────────────────────────────────────

export const MemoryWriteRecord = z.object({
  layer: z.string().min(1),
  key: z.string().min(1),
  content: z.string().min(1),
  sourceRefs: z.array(z.string().min(1)).min(1),
  timestamp: z.string().datetime(),
})
export type MemoryWriteRecord = z.infer<typeof MemoryWriteRecord>

// ─── Crystallization Proposal (AC 18) ─────────────────────────────────

export const CrystallizationProposal = z.object({
  synthesisRunId: z.string().min(1),
  pattern: z.string().min(1),
  proposedArtifactPath: z.string().min(1),
  sourceRefs: z.array(z.string().min(1)).min(1),
  timestamp: z.string().datetime(),
})
export type CrystallizationProposal = z.infer<typeof CrystallizationProposal>
