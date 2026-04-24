/**
 * Evidence emission — Stage6TraceLog, CandidateSelectionReport, Gate2Input.
 *
 * Three artifacts emitted per synthesis, regardless of outcome.
 *
 * AC 10, 11, 12, 13
 */

import type { ArchitectureCandidate, WorkGraph } from "@factory/schemas"
import {
  SynthesisTraceLog,
  Gate2Input,
  SynthesisCandidateSelectionReport,
  type TerminalDecision,
  type RoleIterationRecord,
  type ResampleNode,
  type ValidationOutcome,
  type PatchProposal,
} from "./types.js"

// ─── Trace Log Builder (AC 10) ────────────────────────────────────────

export interface TraceLogInput {
  readonly runId: string
  readonly workGraphId: string
  readonly architectureCandidateId: string
  readonly bindingModeName: string
  readonly roleIterations: readonly RoleIterationRecord[]
  readonly resampleBranches: readonly ResampleNode[]
  readonly validationOutcomes: readonly ValidationOutcome[]
  readonly terminalDecision: TerminalDecision
  readonly generatedArtifactPaths: readonly string[]
  readonly startedAt: string
  readonly completedAt: string
}

export function buildTraceLog(input: TraceLogInput): SynthesisTraceLog {
  return SynthesisTraceLog.parse({
    runId: input.runId,
    workGraphId: input.workGraphId,
    architectureCandidateId: input.architectureCandidateId,
    bindingModeName: input.bindingModeName,
    roleIterations: [...input.roleIterations],
    resampleBranches: [...input.resampleBranches],
    validationOutcomes: [...input.validationOutcomes],
    terminalDecision: input.terminalDecision,
    generatedArtifactPaths: [...input.generatedArtifactPaths],
    startedAt: input.startedAt,
    completedAt: input.completedAt,
  })
}

// ─── Gate 2 Input Builder (AC 11) ─────────────────────────────────────

export interface Gate2InputBuilderInput {
  readonly runId: string
  readonly functionId: string
  readonly workGraphId: string
  readonly architectureCandidateId: string
  readonly artifactPaths: readonly string[]
  readonly validationOutcomes: readonly ValidationOutcome[]
  readonly compileSummary: string
  readonly testSummary: string
  readonly scopeViolation: boolean
  readonly constraintViolation: boolean
  readonly repairLoopCount: number
  readonly resampleSummary: string
  readonly bindingModeName: string
  readonly promptPackVersion: string
  readonly toolPolicyHash: string
  readonly modelBindingHash: string
  readonly startedAt: string
  readonly completedAt: string
}

export function buildGate2Input(input: Gate2InputBuilderInput): Gate2Input {
  return Gate2Input.parse({
    synthesisRunId: input.runId,
    functionId: input.functionId,
    workGraphId: input.workGraphId,
    architectureCandidateId: input.architectureCandidateId,
    artifactPaths: [...input.artifactPaths],
    validationOutcomes: [...input.validationOutcomes],
    compileSummary: input.compileSummary,
    testSummary: input.testSummary,
    scopeViolation: input.scopeViolation,
    constraintViolation: input.constraintViolation,
    repairLoopCount: input.repairLoopCount,
    resampleSummary: input.resampleSummary,
    provenance: {
      bindingModeName: input.bindingModeName,
      promptPackVersion: input.promptPackVersion,
      toolPolicyHash: input.toolPolicyHash,
      modelBindingHash: input.modelBindingHash,
      startedAt: input.startedAt,
      completedAt: input.completedAt,
    },
  })
}

// ─── Candidate Selection Report Builder (AC 12) ──────────────────────

export interface CandidateSelectionInput {
  readonly runId: string
  readonly candidate: ArchitectureCandidate
  readonly objectiveScores: Record<string, number>
  readonly selectionReason: string
}

export function buildCandidateSelectionReport(
  input: CandidateSelectionInput,
): SynthesisCandidateSelectionReport {
  return SynthesisCandidateSelectionReport.parse({
    synthesisRunId: input.runId,
    candidateId: input.candidate.id,
    topology: input.candidate.topology.summary,
    modelBinding: input.candidate.modelBinding.summary,
    objectiveScores: input.objectiveScores,
    selectionReason: input.selectionReason,
    timestamp: new Date().toISOString(),
  })
}
