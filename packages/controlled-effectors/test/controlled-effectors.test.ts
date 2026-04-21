import { describe, expect, it } from "vitest"
import { emitEffectorArtifact } from "../src/emit-effector-artifact.js"
import { buildExecutionNodeRecord } from "../src/enrich-trace-records.js"

describe("controlled effectors", () => {
  it("emits a simulated allowed effector artifact", () => {
    const eff = emitEffectorArtifact({
      sourceWorkGraphId: "WG-META-ARCHITECTURE-CANDIDATE-EXECUTION",
      sourceArchitectureCandidateId: "AC-META-ARCHITECTURE-CANDIDATE-EXECUTION",
      sourceSelectionId: "ACS-META-ARCHITECTURE-CANDIDATE-EXECUTION",
      sourceAdmissionId: "RAD-META-ARCHITECTURE-CANDIDATE-EXECUTION-ALLOW",
      sourceExecutionStartId: "EXS-META-ARCHITECTURE-CANDIDATE-EXECUTION",
      targetNodeId: "N1",
      toolPolicyMode: "allowlist",
      requestedEffectorType: "file_write",
      sourceRefs: ["EXS-META-ARCHITECTURE-CANDIDATE-EXECUTION"],
    })

    expect(eff.id).toBe("EFF-N1")
    expect(eff.allowed).toBe(true)

    const rec = buildExecutionNodeRecord(eff)
    expect(rec.nodeId).toBe("N1")
    expect(rec.effectorArtifactId).toBe("EFF-N1")
  })

  it("fails closed when restricted policy blocks tool_call", () => {
    expect(() =>
      emitEffectorArtifact({
        sourceWorkGraphId: "WG-META-ARCHITECTURE-CANDIDATE-EXECUTION",
        sourceArchitectureCandidateId: "AC-META-ARCHITECTURE-CANDIDATE-EXECUTION",
        sourceSelectionId: "ACS-META-ARCHITECTURE-CANDIDATE-EXECUTION",
        sourceAdmissionId: "RAD-META-ARCHITECTURE-CANDIDATE-EXECUTION-ALLOW",
        sourceExecutionStartId: "EXS-META-ARCHITECTURE-CANDIDATE-EXECUTION",
        targetNodeId: "N2",
        toolPolicyMode: "restricted",
        requestedEffectorType: "tool_call",
        sourceRefs: ["EXS-META-ARCHITECTURE-CANDIDATE-EXECUTION"],
      })
    ).toThrow()
  })
})
