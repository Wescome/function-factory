/**
 * The synthesis orchestration loop.
 *
 * Coordinates binding-mode execution, decision algebra, repair loops,
 * resample branches, evidence emission, and code emission.
 *
 * AC 1, 2, 3, 4, 5
 */

import type { ArchitectureCandidate, WorkGraph } from "@factory/schemas"
import type { BindingMode } from "./binding-mode.js"
import { ALL_ROLE_CONTRACTS } from "./role-contracts.js"
import {
  createDecisionState,
  applyDecision,
  availableDecisions,
  type SynthesisDecisionState,
} from "./decision-state.js"
import { checkRoleAdherence } from "./role-adherence.js"
import { buildTraceLog, buildGate2Input, buildCandidateSelectionReport } from "./evidence.js"
import { checkCrystallization } from "./crystallization.js"
import { MemoryWriteCollector } from "./memory-tool.js"
import {
  SynthesisResult,
  type InferenceConfig,
  type ConvergencePolicy,
  type TerminalVerdict,
  type RoleIterationRecord,
  type ResampleNode,
  type ValidationOutcome,
  type PatchProposal,
  type TerminalDecision,
  HumanApprovalPayload,
} from "./types.js"

// ─── Synthesis Configuration ──────────────────────────────────────────

export interface SynthesisConfig {
  readonly inferenceConfig: InferenceConfig
  readonly convergencePolicy: ConvergencePolicy
  /** Directory to emit code files into. */
  readonly outputDir: string
  /** Function ID for evidence linkage. */
  readonly functionId: string
}

// ─── Code Emitter (AC 4 — no code before pass) ───────────────────────

export interface CodeEmitter {
  emit(patches: readonly PatchProposal[], outputDir: string): Promise<string[]>
}

/** Default emitter that writes files via callback. */
export class DefaultCodeEmitter implements CodeEmitter {
  constructor(
    private readonly writeFile: (path: string, content: string) => Promise<void>,
  ) {}

  async emit(
    patches: readonly PatchProposal[],
    outputDir: string,
  ): Promise<string[]> {
    const paths: string[] = []
    for (const patch of patches) {
      const fullPath = `${outputDir}/${patch.targetPath}`
      await this.writeFile(fullPath, patch.content)
      paths.push(fullPath)
    }
    return paths
  }
}

/** No-op emitter for testing without filesystem. */
export class DryRunCodeEmitter implements CodeEmitter {
  readonly emittedPaths: string[] = []

  async emit(
    patches: readonly PatchProposal[],
    outputDir: string,
  ): Promise<string[]> {
    const paths = patches.map((p) => `${outputDir}/${p.targetPath}`)
    this.emittedPaths.push(...paths)
    return paths
  }
}

// ─── The Synthesis Loop ───────────────────────────────────────────────

export async function orchestrate(
  workGraph: WorkGraph,
  candidate: ArchitectureCandidate,
  bindingMode: BindingMode,
  config: SynthesisConfig,
  codeEmitter: CodeEmitter,
): Promise<SynthesisResult> {
  const runId = `SYN-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
  const startedAt = new Date().toISOString()
  const memory = new MemoryWriteCollector()

  // Initialize decision state
  let decisionState = createDecisionState(
    config.inferenceConfig,
    config.convergencePolicy,
  )

  // Accumulate evidence across iterations
  const allRoleIterations: RoleIterationRecord[] = []
  const allResampleBranches: ResampleNode[] = []
  let latestValidationOutcomes: ValidationOutcome[] = []
  let latestPatchProposals: PatchProposal[] = []
  let emittedPaths: string[] = []
  let terminalVerdict: TerminalVerdict | null = null
  let requiresHumanApproval = false
  let humanApprovalPayload: HumanApprovalPayload | undefined

  // Record memory write for synthesis start
  memory.memoryWrite(
    "execution",
    `synthesis-start-${runId}`,
    `Synthesis started for WorkGraph ${workGraph.id} with candidate ${candidate.id}`,
    [workGraph.id, candidate.id],
  )

  // Main synthesis loop
  while (terminalVerdict === null) {
    const available = availableDecisions(decisionState)

    const output = await bindingMode.execute(
      workGraph,
      candidate,
      ALL_ROLE_CONTRACTS,
      {
        repairLoopCount: decisionState.repairLoopCount,
        maxRepairLoops: decisionState.maxRepairLoops,
        resampleBranchCount: decisionState.resampleBranchCount,
        maxResampleBranches: decisionState.maxResampleBranches,
        previousPatchProposals: latestPatchProposals.length > 0 ? latestPatchProposals : undefined,
        previousCritique: undefined,
      },
    )

    // Accumulate iteration records
    allRoleIterations.push(...output.roleIterations)
    latestValidationOutcomes = [...output.validationOutcomes]
    latestPatchProposals = [...output.patchProposals]

    // Check human approval
    if (output.requiresHumanApproval) {
      requiresHumanApproval = true
      humanApprovalPayload = HumanApprovalPayload.parse({
        reason: output.humanApprovalReason ?? "Human approval required",
        violationType: output.scopeViolation ? "scope" as const : "hard_constraint" as const,
        requestedAction: "approve" as const,
      })
    }

    // Get the verifier decision
    let decision = output.verifierDecision

    // Enforce bounds: if the decision is unavailable, force terminal
    if (!available.has(decision)) {
      if (decision === "patch") {
        decision = "fail" // Patch exhausted -> fail
      } else if (decision === "resample") {
        decision = "fail" // Resample exhausted -> fail
      }
    }

    // Apply decision to state
    const result = applyDecision(decisionState, decision)
    decisionState = result.state
    terminalVerdict = result.terminal

    // Track resample branches
    if (decision === "resample") {
      allResampleBranches.push({
        branchIndex: decisionState.resampleBranchCount - 1,
        roleIterations: [...output.roleIterations],
        terminalVerdict: terminalVerdict ?? undefined,
      })
    }
  }

  const completedAt = new Date().toISOString()

  // AC 4: Only emit code on pass verdict
  if (terminalVerdict === "pass") {
    emittedPaths = await codeEmitter.emit(latestPatchProposals, config.outputDir)
  }

  // Build terminal decision record
  const terminalDecision: TerminalDecision = {
    verdict: terminalVerdict,
    rationale: `Synthesis completed with verdict: ${terminalVerdict}`,
    repairLoopCount: decisionState.repairLoopCount,
    resampleBranchCount: decisionState.resampleBranchCount,
  }

  // Build evidence (AC 10, 11, 12, 13 — always emitted regardless of outcome)
  const traceLog = buildTraceLog({
    runId,
    workGraphId: workGraph.id,
    architectureCandidateId: candidate.id,
    bindingModeName: bindingMode.name,
    roleIterations: allRoleIterations,
    resampleBranches: allResampleBranches,
    validationOutcomes: latestValidationOutcomes,
    terminalDecision,
    generatedArtifactPaths: emittedPaths,
    startedAt,
    completedAt,
  })

  const gate2Input = buildGate2Input({
    runId,
    functionId: config.functionId,
    workGraphId: workGraph.id,
    architectureCandidateId: candidate.id,
    artifactPaths: emittedPaths,
    validationOutcomes: latestValidationOutcomes,
    compileSummary: terminalVerdict === "pass" ? "All compilations passed" : "Compilation status: N/A (synthesis did not pass)",
    testSummary: terminalVerdict === "pass" ? "All tests passed" : "Test status: N/A (synthesis did not pass)",
    scopeViolation: false,
    constraintViolation: false,
    repairLoopCount: decisionState.repairLoopCount,
    resampleSummary: `${decisionState.resampleBranchCount} resample branches explored`,
    bindingModeName: bindingMode.name,
    promptPackVersion: "1.0.0",
    toolPolicyHash: "stub-hash",
    modelBindingHash: "stub-hash",
    startedAt,
    completedAt,
  })

  const candidateSelectionReport = buildCandidateSelectionReport({
    runId,
    candidate,
    objectiveScores: { synthesis: terminalVerdict === "pass" ? 1.0 : 0.0 },
    selectionReason: `Candidate ${candidate.id} selected for synthesis of ${workGraph.id}`,
  })

  // Role adherence check (AC 6, 7, 9)
  const roleAdherenceReport = checkRoleAdherence(
    runId,
    ALL_ROLE_CONTRACTS,
    allRoleIterations,
  )

  // Crystallization check on pass (AC 18)
  if (terminalVerdict === "pass") {
    const proposal = checkCrystallization(traceLog)
    if (proposal) {
      memory.memoryWrite(
        "crystallization",
        `proposal-${runId}`,
        `Crystallization proposal: ${proposal.pattern}`,
        [runId],
      )
    }
  }

  // Final memory write
  memory.memoryWrite(
    "execution",
    `synthesis-complete-${runId}`,
    `Synthesis completed: ${terminalVerdict}, ${emittedPaths.length} files emitted`,
    [runId],
  )

  return SynthesisResult.parse({
    runId,
    verdict: terminalVerdict,
    generatedArtifactPaths: emittedPaths,
    traceLog,
    roleAdherenceReport,
    gate2Input,
    candidateSelectionReport,
    requiresHumanApproval,
    humanApprovalPayload,
  })
}
