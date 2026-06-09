import {
  RunTranscript,
  type VerificationResultSummary,
  type RunTranscript as RunTranscriptType,
} from "./types.js"

export interface TerminalPipelineResult {
  status: string
  signalId?: string
  pressureId?: string
  capabilityId?: string
  proposalId?: string
  intentSpecificationId?: string
  executableSpecificationId?: string
  coherenceVerificationReport?: {
    verification?: string
    passed?: boolean
    executableSpecificationId?: string
    summary?: string
  }
  report?: unknown
  reason?: string
  synthesisResult?: {
    verdict: {
      decision: string
      confidence?: number
      reason?: string
    }
    tokenUsage?: number
    repairCount?: number
  }
  atomResults?: Record<string, unknown>
}

export interface BuildRunTranscriptInput {
  runId: string
  terminalResult: TerminalPipelineResult
  createdAt: string
  trellisExecutionPacketId?: string
  trellisExecutionPacketHash?: string
  repairLog?: RunTranscriptType["repair_log"]
  modelRoleTelemetry?: RunTranscriptType["model_role_telemetry"]
}

function collectSourceRefs(result: TerminalPipelineResult, packetId?: string): string[] {
  return [
    result.signalId,
    result.pressureId,
    result.capabilityId,
    result.proposalId,
    result.intentSpecificationId,
    result.executableSpecificationId,
    result.coherenceVerificationReport?.executableSpecificationId,
    packetId,
  ].filter((value): value is string => typeof value === "string" && value.length > 0)
}

function verificationResults(result: TerminalPipelineResult): VerificationResultSummary[] {
  const report = result.coherenceVerificationReport
  if (!report || typeof report.passed !== "boolean") return []
  return [{
    verification: report.verification ?? "coherence",
    passed: report.passed,
    summary: report.summary,
  }]
}

export function buildRunTranscript(input: BuildRunTranscriptInput): RunTranscriptType {
  const result = input.terminalResult
  const sourceRefs = collectSourceRefs(result, input.trellisExecutionPacketId)
  const transcript = {
    run_id: input.runId,
    signal_id: result.signalId,
    pressure_id: result.pressureId,
    capability_id: result.capabilityId,
    proposal_id: result.proposalId,
    intent_specification_id: result.intentSpecificationId,
    executable_specification_id: result.executableSpecificationId,
    trellis_execution_packet_id: input.trellisExecutionPacketId,
    trellis_execution_packet_hash: input.trellisExecutionPacketHash,
    verification_results: verificationResults(result),
    repair_count: result.synthesisResult?.repairCount ?? 0,
    repair_log: input.repairLog ?? [],
    atom_results: result.atomResults,
    model_role_telemetry: input.modelRoleTelemetry ?? [],
    final_verdict: {
      status: result.status,
      reason: result.reason ?? result.synthesisResult?.verdict.reason,
      synthesis_decision: result.synthesisResult?.verdict.decision,
      confidence: result.synthesisResult?.verdict.confidence,
    },
    terminal_state: result.status,
    source_refs: sourceRefs,
    explicitness: "inferred" as const,
    rationale: "Run transcript derived deterministically from the terminal pipeline result.",
    created_at: input.createdAt,
  }

  return RunTranscript.parse(transcript)
}
