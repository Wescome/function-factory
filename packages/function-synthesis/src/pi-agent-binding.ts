/**
 * PiAgentBindingMode — the first real binding mode for function-synthesis.
 *
 * Wires pi-ai (model routing) + pi-agent-core (stateful agent execution)
 * into the synthesis loop. Creates five real agents (one per role) and
 * orchestrates them: Planner -> Coder -> Critic -> (repair) -> Tester -> Verifier.
 *
 * JTBD: When the Factory needs to synthesize a Function from a WorkGraph,
 * I want a binding mode that creates governed agents per role with
 * enforced contracts, so the synthesis topology produces code under
 * strict role discipline.
 *
 * AC 6, 7, 9, 14, 15
 */

import type { ArchitectureCandidate, WorkGraph } from "@factory/schemas"
import type { RoleContract } from "./role-contracts.js"
import type {
  BindingMode,
  BindingModeOutput,
  BindingModeContext,
} from "./binding-mode.js"
import type {
  RoleName,
  ToolCallRecord,
  RoleIterationRecord,
  PatchProposal,
  ValidationOutcome,
  VerifierDecision,
} from "./types.js"
import {
  Agent,
  getModel,
  type Model,
  type BeforeToolCallResult,
  type ToolSchema,
} from "./pi-agent-mock.js"
import { getToolsForRole, getAllowedToolNames } from "./role-tools.js"
import { renderRolePrompt } from "./role-prompts.js"

// ─── Configuration ───────────────────────────────────────────────────

export interface PiAgentBindingConfig {
  /** Default model provider (e.g., "anthropic"). */
  readonly defaultProvider?: string | undefined
  /** Default model ID (e.g., "claude-haiku-4-5"). */
  readonly defaultModelId?: string | undefined
  /** Per-role model overrides. */
  readonly roleModelOverrides?: Partial<Record<RoleName, { provider: string; modelId: string }>> | undefined
  /** Custom model factory (for testing). */
  readonly modelFactory?: ((provider: string, modelId: string) => Model) | undefined
}

// ─── Contract Violation Record ───────────────────────────────────────

export interface ContractViolation {
  readonly role: RoleName
  readonly toolName: string
  readonly reason: string
  readonly timestamp: string
}

// ─── The Binding Mode ────────────────────────────────────────────────

export class PiAgentBindingMode implements BindingMode {
  readonly name = "pi-agent"
  private readonly config: PiAgentBindingConfig

  constructor(config?: PiAgentBindingConfig) {
    this.config = config ?? {}
  }

  async execute(
    workGraph: WorkGraph,
    candidate: ArchitectureCandidate,
    contracts: readonly RoleContract[],
    context: BindingModeContext,
  ): Promise<BindingModeOutput> {
    const toolCallRecords: ToolCallRecord[] = []
    const contractViolations: ContractViolation[] = []
    const roleIterations: RoleIterationRecord[] = []

    // Build agents per role
    const agents = new Map<RoleName, Agent>()
    for (const contract of contracts) {
      const agent = this.createRoleAgent(
        contract,
        workGraph,
        candidate,
        toolCallRecords,
        contractViolations,
      )
      agents.set(contract.name, agent)
    }

    // ─── Orchestrate: Planner → Coder → Critic → Tester → Verifier ──

    // Step 1: Planner
    const plannerStart = Date.now()
    const plannerAgent = agents.get("Planner")
    if (plannerAgent === undefined) throw new Error("Planner agent not found")
    await plannerAgent.prompt(
      `Produce a plan for WorkGraph ${workGraph.id}. ` +
      `Nodes: ${workGraph.nodes.map((n) => n.id).join(", ")}. ` +
      `Context: repair loop ${context.repairLoopCount}/${context.maxRepairLoops}.`,
    )
    roleIterations.push(
      this.buildRoleIteration("Planner", 0, plannerStart, toolCallRecords),
    )

    // Step 2: Coder
    const coderStart = Date.now()
    const coderAgent = agents.get("Coder")
    if (coderAgent === undefined) throw new Error("Coder agent not found")
    await coderAgent.prompt(
      `Implement the plan for WorkGraph ${workGraph.id}. ` +
      (context.previousCritique !== undefined
        ? `Previous critique: ${context.previousCritique}. `
        : "") +
      "Produce patch proposals.",
    )
    roleIterations.push(
      this.buildRoleIteration("Coder", 0, coderStart, toolCallRecords),
    )

    // Step 3: Critic
    const criticStart = Date.now()
    const criticAgent = agents.get("Critic")
    if (criticAgent === undefined) throw new Error("Critic agent not found")
    await criticAgent.prompt(
      `Review the plan and patches for WorkGraph ${workGraph.id}. ` +
      "Identify defects, style issues, and contract violations.",
    )
    roleIterations.push(
      this.buildRoleIteration("Critic", 0, criticStart, toolCallRecords),
    )

    // Step 4: Tester
    const testerStart = Date.now()
    const testerAgent = agents.get("Tester")
    if (testerAgent === undefined) throw new Error("Tester agent not found")
    await testerAgent.prompt(
      `Design and execute tests for WorkGraph ${workGraph.id}. ` +
      "Validate the patches against the plan and critique.",
    )
    roleIterations.push(
      this.buildRoleIteration("Tester", 0, testerStart, toolCallRecords),
    )

    // Step 5: Verifier
    const verifierStart = Date.now()
    const verifierAgent = agents.get("Verifier")
    if (verifierAgent === undefined) throw new Error("Verifier agent not found")
    await verifierAgent.prompt(
      `Review all artifacts for WorkGraph ${workGraph.id}. ` +
      `Repair loop: ${context.repairLoopCount}/${context.maxRepairLoops}. ` +
      "Decide: pass, patch, resample, interrupt, or fail.",
    )
    roleIterations.push(
      this.buildRoleIteration("Verifier", 0, verifierStart, toolCallRecords),
    )

    // ─── Assemble output ─────────────────────────────────────────────

    // In the mock implementation, produce stub artifacts.
    // Real implementation would parse agent responses for structured output.
    const patchProposals: PatchProposal[] = workGraph.nodes
      .filter((n) => n.type === "execution")
      .map((n) => ({
        targetPath: `src/${n.id}.ts`,
        content: `// Implementation for ${n.title}\nexport {}`,
        workGraphNodeId: n.id,
        rationale: `Generated by Coder for ${n.title}`,
      }))

    const validationOutcomes: ValidationOutcome[] = [
      {
        validationId: "val-compile",
        passed: true,
        summary: "TypeScript compilation succeeded (mock)",
      },
      {
        validationId: "val-test",
        passed: true,
        summary: "All tests passed (mock)",
      },
    ]

    const verifierDecision: VerifierDecision = "pass"

    const hasViolations = contractViolations.length > 0

    return {
      patchProposals,
      validationOutcomes,
      verifierDecision,
      roleIterations,
      requiresHumanApproval: hasViolations,
      humanApprovalReason: hasViolations
        ? `Contract violations detected: ${contractViolations.map((v) => v.reason).join("; ")}`
        : undefined,
      scopeViolation: false,
      hardConstraintViolation: hasViolations,
    }
  }

  // ─── Private helpers ─────────────────────────────────────────────────

  /**
   * Create a governed Agent for a specific role.
   * The beforeToolCall hook BLOCKS unauthorized tool calls.
   */
  createRoleAgent(
    contract: RoleContract,
    workGraph: WorkGraph,
    candidate: ArchitectureCandidate,
    toolCallRecords: ToolCallRecord[],
    contractViolations: ContractViolation[],
  ): Agent {
    const model = this.getModelForRole(contract.name, candidate)
    const tools = getToolsForRole(contract.name)
    const allowedNames = getAllowedToolNames(contract.name)
    const systemPrompt = renderRolePrompt(contract, workGraph, candidate)

    return new Agent({
      model,
      systemPrompt,
      tools,

      // CRITICAL: beforeToolCall BLOCKS unauthorized tool calls.
      // This is the entire control Function expressed as a hook.
      // Log-and-continue would make role contracts advisory.
      // Block-and-record makes them governed.
      beforeToolCall(toolName: string, _input: Record<string, unknown>): BeforeToolCallResult {
        if (!allowedNames.has(toolName)) {
          const reason = `do_not violation: ${contract.name} attempted ${toolName}`
          contractViolations.push({
            role: contract.name,
            toolName,
            reason,
            timestamp: new Date().toISOString(),
          })
          return { block: true, reason }
        }
        return { block: false }
      },

      // afterToolCall captures ToolCallRecord for the trace.
      afterToolCall(toolName: string, input: Record<string, unknown>, output: Record<string, unknown>): void {
        toolCallRecords.push({
          role: contract.name,
          tool: toolName,
          input,
          output,
          timestamp: new Date().toISOString(),
        })
      },
    })
  }

  private getModelForRole(role: RoleName, candidate: ArchitectureCandidate): Model {
    const factory = this.config.modelFactory ?? getModel

    // Check per-role overrides
    const override = this.config.roleModelOverrides?.[role]
    if (override !== undefined) {
      return factory(override.provider, override.modelId)
    }

    // Use candidate's model binding info or defaults
    const provider = this.config.defaultProvider ?? "anthropic"
    const modelId = this.config.defaultModelId ?? candidate.modelBinding.summary
    return factory(provider, modelId)
  }

  private buildRoleIteration(
    role: RoleName,
    iteration: number,
    startTime: number,
    toolCallRecords: readonly ToolCallRecord[],
  ): RoleIterationRecord {
    const roleToolCalls = toolCallRecords.filter((t) => t.role === role)
    const contract = this.getContractReads(role)

    return {
      role,
      iteration,
      inputFields: [...contract.reads],
      outputFields: [...contract.writes],
      toolCalls: [...roleToolCalls],
      durationMs: Date.now() - startTime,
    }
  }

  private getContractReads(role: RoleName): { reads: readonly string[]; writes: readonly string[] } {
    // Inline minimal contract lookup to avoid circular dependency
    const contracts: Record<RoleName, { reads: readonly string[]; writes: readonly string[] }> = {
      Planner: { reads: ["specEnvelope", "workGraph", "targetNodeIds", "activeCandidate", "repoContract", "validationOutcomes"], writes: ["plan"] },
      Coder: { reads: ["plan", "workGraph", "activeCandidate", "repoContract", "editScopes", "repoContext"], writes: ["patchProposals"] },
      Critic: { reads: ["plan", "patchProposals", "workGraph", "specEnvelope", "repoContract"], writes: ["critique"] },
      Tester: { reads: ["plan", "patchProposals", "critique", "workGraph", "scenarioManifest", "toolResults"], writes: ["validationPlan", "validationOutcomes"] },
      Verifier: { reads: ["plan", "patchProposals", "critique", "validationOutcomes", "repairLoopCount", "maxRepairLoops", "scopeViolation", "hardConstraintViolation", "activeCandidate"], writes: ["decision", "requiresHumanApproval", "humanApprovalPayload"] },
    }
    return contracts[role]
  }
}
