import { describe, expect, it } from "vitest"
import {
  CodingDomainAdapterContract,
  CodingTrellisRuntimeProfile,
  certifyTrellisExecutionPacket,
  type ArchitectureCandidate,
  type ExecutableSpecification,
  type RuntimeAdmissionArtifact,
} from "@factory/schemas"
import { tuneInstructions, type InstructionTuningInput } from "./instruction-tuning.js"

const executableSpecification: ExecutableSpecification = {
  id: "WG-TRELLIS-CODING-AGENT",
  functionId: "FN-TRELLIS-CODING-AGENT",
  source_refs: ["PRD-TRELLIS-CODING-AGENT"],
  explicitness: "explicit",
  rationale: "Fixture executable specification for Instruction Tuning.",
  nodes: [
    {
      id: "plan",
      type: "control",
      title: "Plan implementation",
      implements: "REQ-TRELLIS-PLAN",
    },
    {
      id: "implement",
      type: "execution",
      title: "Implement changes",
      implements: "REQ-TRELLIS-IMPLEMENT",
    },
    {
      id: "verify",
      type: "evidence",
      title: "Verify changes",
      implements: "REQ-TRELLIS-VERIFY",
    },
  ],
  edges: [
    {
      from: "plan",
      to: "implement",
      dependencyType: "informs",
    },
    {
      from: "implement",
      to: "verify",
      dependencyType: "informs",
    },
  ],
}

const selectedArchitectureCandidate: ArchitectureCandidate = {
  id: "AC-TRELLIS-CODING-AGENT",
  sourcePrdId: "PRD-TRELLIS-CODING-AGENT",
  sourceExecutableSpecificationId: executableSpecification.id,
  candidateStatus: "selected",
  topology: {
    shape: "linear_chain",
    summary: "Plan, implement, verify.",
  },
  modelBinding: {
    bindingMode: "policy_selected",
    summary: "Runtime selects the model per profile policy.",
  },
  toolPolicy: {
    mode: "restricted",
    summary: "Tool access is mediated through packet bindings.",
  },
  convergencePolicy: {
    mode: "gated_iteration",
    summary: "Repairs require evidence and recertification when policy fails.",
  },
  source_refs: [executableSpecification.id],
  explicitness: "explicit",
  rationale: "Selected fixture candidate.",
}

const runtimeAdmission: RuntimeAdmissionArtifact = {
  id: "RAD-TRELLIS-CODING-AGENT",
  sourceExecutableSpecificationId: executableSpecification.id,
  sourceArchitectureCandidateId: selectedArchitectureCandidate.id,
  sourceSelectionId: "ACS-TRELLIS-CODING-AGENT",
  decision: "allow",
  reason: "Fixture admission permits execution.",
  source_refs: [executableSpecification.id, selectedArchitectureCandidate.id],
  explicitness: "explicit",
  rationale: "Admitted for test execution.",
}

const baseInput: InstructionTuningInput = {
  executableSpecification,
  selectedArchitectureCandidate,
  runtimeAdmission,
  domainAdapterContract: CodingDomainAdapterContract,
  runtimeProfile: CodingTrellisRuntimeProfile,
  generatedAt: "2026-05-10T21:45:00.000Z",
}

describe("tuneInstructions", () => {
  it("emits a certified Trellis Execution Packet from selected runtime inputs", () => {
    const result = tuneInstructions(baseInput)

    expect(result.status).toBe("emitted")
    if (result.status !== "emitted") return
    expect(result.packet.id).toMatch(/^TEP-/)
    expect(result.packet.roles.map((role) => role.roleId)).toEqual([
      "role-plan",
      "role-implement",
      "role-verify",
    ])
    expect(certifyTrellisExecutionPacket(result.packet).valid).toBe(true)
  })

  it("is deterministic for identical inputs", () => {
    const resultA = tuneInstructions(baseInput)
    const resultB = tuneInstructions(baseInput)

    expect(resultA.status).toBe("emitted")
    expect(resultB.status).toBe("emitted")
    if (resultA.status !== "emitted" || resultB.status !== "emitted") return
    expect(resultB.packet.audit.packetHash).toBe(resultA.packet.audit.packetHash)
    expect(resultB.packet).toEqual(resultA.packet)
  })

  it("blocks when required inputs are absent", () => {
    const result = tuneInstructions({
      executableSpecification,
      generatedAt: baseInput.generatedAt,
    })

    expect(result.status).toBe("blocked")
    if (result.status !== "blocked") return
    expect(result.diagnostics[0]?.code).toBe("instruction-tuning:missing-input")
  })

  it("blocks denied runtime admission", () => {
    const result = tuneInstructions({
      ...baseInput,
      runtimeAdmission: {
        ...runtimeAdmission,
        decision: "deny",
      },
    })

    expect(result.status).toBe("blocked")
    if (result.status !== "blocked") return
    expect(result.diagnostics[0]?.code).toBe("instruction-tuning:runtime-admission-denied")
  })

  it("blocks dangling executable dependencies", () => {
    const result = tuneInstructions({
      ...baseInput,
      executableSpecification: {
        ...executableSpecification,
        edges: [
          {
            from: "plan",
            to: "missing",
            dependencyType: "informs",
          },
        ],
      },
    })

    expect(result.status).toBe("blocked")
    if (result.status !== "blocked") return
    expect(result.diagnostics[0]?.code).toBe("instruction-tuning:dangling-edge")
  })

  it("blocks non-selected architecture candidates", () => {
    const result = tuneInstructions({
      ...baseInput,
      selectedArchitectureCandidate: {
        ...selectedArchitectureCandidate,
        candidateStatus: "proposed",
      },
    })

    expect(result.status).toBe("blocked")
    if (result.status !== "blocked") return
    expect(result.diagnostics[0]?.code).toBe("instruction-tuning:architecture-candidate-not-selected")
  })
})
