/**
 * Tests for PiAgentBindingMode.
 *
 * All tests use mocked models — no real API calls.
 * Validates: interface compliance, beforeToolCall blocking,
 * afterToolCall capture, synthesis result shape, and role prompts.
 */

import { describe, it, expect } from "vitest"
import { PiAgentBindingMode, type ContractViolation } from "../src/pi-agent-binding.js"
import type { BindingMode } from "../src/binding-mode.js"
import { ALL_ROLE_CONTRACTS, PlannerContract, CoderContract, CriticContract, TesterContract, VerifierContract } from "../src/role-contracts.js"
import { makeWorkGraph, makeCandidate } from "./test-fixtures.js"
import { Agent, type Model, type BeforeToolCallResult } from "../src/pi-agent-mock.js"
import { getToolsForRole, getAllowedToolNames } from "../src/role-tools.js"
import { renderRolePrompt } from "../src/role-prompts.js"
import type { RoleName } from "../src/types.js"

// ─── Mock model factory ──────────────────────────────────────────────

function mockModelFactory(_provider: string, _modelId: string): Model {
  return {
    provider: _provider,
    modelId: _modelId,
    async generate(_prompt: string) {
      return {
        text: '{"role":"mock","artifact":"mock","status":"complete"}',
        usage: { inputTokens: 100, outputTokens: 50 },
      }
    },
  }
}

// ─── Tests ───────────────────────────────────────────────────────────

describe("PiAgentBindingMode", () => {
  it("implements the BindingMode interface", () => {
    const mode: BindingMode = new PiAgentBindingMode({
      modelFactory: mockModelFactory,
    })
    expect(mode.name).toBe("pi-agent")
    expect(typeof mode.execute).toBe("function")
  })

  it("synthesize() returns a valid BindingModeOutput", async () => {
    const mode = new PiAgentBindingMode({
      modelFactory: mockModelFactory,
    })
    const workGraph = makeWorkGraph()
    const candidate = makeCandidate()

    const result = await mode.execute(workGraph, candidate, ALL_ROLE_CONTRACTS, {
      repairLoopCount: 0,
      maxRepairLoops: 3,
      resampleBranchCount: 0,
      maxResampleBranches: 2,
    })

    // Structure validation
    expect(result.patchProposals).toBeDefined()
    expect(Array.isArray(result.patchProposals)).toBe(true)
    expect(result.validationOutcomes).toBeDefined()
    expect(Array.isArray(result.validationOutcomes)).toBe(true)
    expect(result.verifierDecision).toBeDefined()
    expect(result.roleIterations).toBeDefined()
    expect(result.roleIterations.length).toBe(5) // one per role
    expect(typeof result.requiresHumanApproval).toBe("boolean")
    expect(typeof result.scopeViolation).toBe("boolean")
    expect(typeof result.hardConstraintViolation).toBe("boolean")
  })

  it("produces roleIterations for all five roles in order", async () => {
    const mode = new PiAgentBindingMode({
      modelFactory: mockModelFactory,
    })
    const result = await mode.execute(makeWorkGraph(), makeCandidate(), ALL_ROLE_CONTRACTS, {
      repairLoopCount: 0,
      maxRepairLoops: 3,
      resampleBranchCount: 0,
      maxResampleBranches: 2,
    })

    const roles = result.roleIterations.map((r) => r.role)
    expect(roles).toEqual(["Planner", "Coder", "Critic", "Tester", "Verifier"])
  })

  it("produces patch proposals from execution nodes", async () => {
    const mode = new PiAgentBindingMode({
      modelFactory: mockModelFactory,
    })
    const workGraph = makeWorkGraph()
    const result = await mode.execute(workGraph, makeCandidate(), ALL_ROLE_CONTRACTS, {
      repairLoopCount: 0,
      maxRepairLoops: 3,
      resampleBranchCount: 0,
      maxResampleBranches: 2,
    })

    const executionNodes = workGraph.nodes.filter((n) => n.type === "execution")
    expect(result.patchProposals.length).toBe(executionNodes.length)
    for (const patch of result.patchProposals) {
      expect(patch.targetPath).toBeTruthy()
      expect(patch.content).toBeTruthy()
      expect(patch.workGraphNodeId).toBeTruthy()
      expect(patch.rationale).toBeTruthy()
    }
  })
})

describe("beforeToolCall enforcement (BLOCKS, not logs)", () => {
  it("blocks a Planner attempting writeFile (unauthorized tool)", () => {
    const mode = new PiAgentBindingMode({
      modelFactory: mockModelFactory,
    })
    const violations: ContractViolation[] = []
    const toolCallRecords: import("../src/types.js").ToolCallRecord[] = []
    const workGraph = makeWorkGraph()
    const candidate = makeCandidate()

    const agent = mode.createRoleAgent(
      PlannerContract,
      workGraph,
      candidate,
      toolCallRecords,
      violations,
    )

    // Attempt a tool call that the Planner is NOT allowed to make
    // The agent.prompt with attemptToolCall exercises the beforeToolCall hook
    return agent.prompt("test", { attemptToolCall: "writeFile" }).then((messages) => {
      // The tool call should have been BLOCKED
      expect(violations.length).toBe(1)
      expect(violations[0]!.role).toBe("Planner")
      expect(violations[0]!.toolName).toBe("writeFile")
      expect(violations[0]!.reason).toContain("do_not violation")
      expect(violations[0]!.reason).toContain("Planner attempted writeFile")

      // The message should show blocked
      const toolMsg = messages.find((m) => m.role === "tool")
      expect(toolMsg).toBeDefined()
      expect(toolMsg!.content).toContain("BLOCKED")
      expect(toolMsg!.toolCall?.output).toEqual(
        expect.objectContaining({ blocked: true }),
      )
    })
  })

  it("blocks a Critic attempting runTest (unauthorized tool)", () => {
    const mode = new PiAgentBindingMode({
      modelFactory: mockModelFactory,
    })
    const violations: ContractViolation[] = []
    const toolCallRecords: import("../src/types.js").ToolCallRecord[] = []

    const agent = mode.createRoleAgent(
      CriticContract,
      makeWorkGraph(),
      makeCandidate(),
      toolCallRecords,
      violations,
    )

    return agent.prompt("test", { attemptToolCall: "runTest" }).then((messages) => {
      expect(violations.length).toBe(1)
      expect(violations[0]!.role).toBe("Critic")
      expect(violations[0]!.toolName).toBe("runTest")
      expect(violations[0]!.reason).toContain("do_not violation")

      const toolMsg = messages.find((m) => m.role === "tool")
      expect(toolMsg!.toolCall?.output).toEqual(
        expect.objectContaining({ blocked: true }),
      )
    })
  })

  it("blocks a Tester attempting writeFile (unauthorized tool)", () => {
    const mode = new PiAgentBindingMode({
      modelFactory: mockModelFactory,
    })
    const violations: ContractViolation[] = []
    const toolCallRecords: import("../src/types.js").ToolCallRecord[] = []

    const agent = mode.createRoleAgent(
      TesterContract,
      makeWorkGraph(),
      makeCandidate(),
      toolCallRecords,
      violations,
    )

    return agent.prompt("test", { attemptToolCall: "writeFile" }).then((messages) => {
      expect(violations.length).toBe(1)
      expect(violations[0]!.role).toBe("Tester")
      expect(violations[0]!.reason).toContain("do_not violation")
    })
  })

  it("allows a Coder to call writeFile (authorized tool)", () => {
    const mode = new PiAgentBindingMode({
      modelFactory: mockModelFactory,
    })
    const violations: ContractViolation[] = []
    const toolCallRecords: import("../src/types.js").ToolCallRecord[] = []

    const agent = mode.createRoleAgent(
      CoderContract,
      makeWorkGraph(),
      makeCandidate(),
      toolCallRecords,
      violations,
    )

    return agent.prompt("test", { attemptToolCall: "writeFile" }).then(() => {
      // No violations - the tool call was allowed
      expect(violations.length).toBe(0)
    })
  })

  it("returns block: true with reason string (not just logging)", () => {
    const allowedNames = getAllowedToolNames("Planner")
    const toolName = "writeFile"

    // Directly test the hook logic
    expect(allowedNames.has(toolName)).toBe(false)

    // Simulate what beforeToolCall does
    const result: BeforeToolCallResult = allowedNames.has(toolName)
      ? { block: false }
      : { block: true, reason: `do_not violation: Planner attempted ${toolName}` }

    expect(result.block).toBe(true)
    expect(result.reason).toBeDefined()
    expect(result.reason).toContain("do_not violation")
  })
})

describe("afterToolCall captures ToolCallRecord", () => {
  it("records tool calls in the trace after authorized execution", () => {
    const mode = new PiAgentBindingMode({
      modelFactory: mockModelFactory,
    })
    const violations: ContractViolation[] = []
    const toolCallRecords: import("../src/types.js").ToolCallRecord[] = []

    const agent = mode.createRoleAgent(
      CoderContract,
      makeWorkGraph(),
      makeCandidate(),
      toolCallRecords,
      violations,
    )

    return agent.prompt("test", { attemptToolCall: "readPlan" }).then(() => {
      expect(toolCallRecords.length).toBe(1)
      expect(toolCallRecords[0]!.role).toBe("Coder")
      expect(toolCallRecords[0]!.tool).toBe("readPlan")
      expect(toolCallRecords[0]!.timestamp).toBeTruthy()
      expect(typeof toolCallRecords[0]!.input).toBe("object")
      expect(typeof toolCallRecords[0]!.output).toBe("object")
    })
  })

  it("does NOT record blocked tool calls in afterToolCall", () => {
    const mode = new PiAgentBindingMode({
      modelFactory: mockModelFactory,
    })
    const violations: ContractViolation[] = []
    const toolCallRecords: import("../src/types.js").ToolCallRecord[] = []

    const agent = mode.createRoleAgent(
      PlannerContract,
      makeWorkGraph(),
      makeCandidate(),
      toolCallRecords,
      violations,
    )

    return agent.prompt("test", { attemptToolCall: "writeFile" }).then(() => {
      // Blocked tool calls should NOT appear in toolCallRecords
      // (they are recorded in violations instead)
      expect(toolCallRecords.length).toBe(0)
      expect(violations.length).toBe(1)
    })
  })
})

describe("Role tools per contract", () => {
  const roleToolExpectations: Record<RoleName, string[]> = {
    Planner: ["readWorkGraph", "readRepoContract", "readValidationOutcomes"],
    Coder: ["readPlan", "readWorkGraph", "readRepoContext", "writeFile", "readFile"],
    Critic: ["readPlan", "readPatches", "readWorkGraph", "readSpecEnvelope", "readRepoContract"],
    Tester: ["readPlan", "readPatches", "readCritique", "readWorkGraph", "runTest", "readToolResults"],
    Verifier: ["readAll", "writeDecision"],
  }

  for (const [role, expectedTools] of Object.entries(roleToolExpectations)) {
    it(`${role} has correct tool set`, () => {
      const tools = getToolsForRole(role as RoleName)
      const toolNames = tools.map((t) => t.name)
      expect(toolNames).toEqual(expectedTools)
    })
  }
})

describe("Role prompts", () => {
  const workGraph = makeWorkGraph()
  const candidate = makeCandidate()

  for (const contract of ALL_ROLE_CONTRACTS) {
    it(`${contract.name} prompt contains Read/Write/DoNot fields`, () => {
      const prompt = renderRolePrompt(contract, workGraph, candidate)

      // Contains role identity
      expect(prompt).toContain(contract.name)
      expect(prompt).toContain(contract.outputArtifact)

      // Contains read fields
      for (const field of contract.reads) {
        expect(prompt).toContain(field)
      }

      // Contains write fields
      for (const field of contract.writes) {
        expect(prompt).toContain(field)
      }

      // Contains do-not constraints
      for (const rule of contract.doNot) {
        expect(prompt).toContain(rule)
      }

      // Contains WorkGraph context
      expect(prompt).toContain(workGraph.id)

      // Contains candidate context
      expect(prompt).toContain(candidate.id)

      // Contains JSON footer instruction
      expect(prompt).toContain("JSON footer")
    })
  }
})
