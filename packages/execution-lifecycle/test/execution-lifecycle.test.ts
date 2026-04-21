import { describe, expect, it } from "vitest"
import { emitExecutionStart } from "../src/emit-execution-start.js"
import { emitExecutionTrace } from "../src/emit-execution-trace.js"
import { emitExecutionResult } from "../src/emit-execution-result.js"

describe("execution lifecycle", () => {
  it("emits EXS, EXT, EXR deterministically for the bootstrap path", () => {
    const exs = emitExecutionStart({
      sourceWorkGraphId: "WG-META-ARCHITECTURE-CANDIDATE-EXECUTION",
      sourceArchitectureCandidateId: "AC-META-ARCHITECTURE-CANDIDATE-EXECUTION",
      sourceSelectionId: "ACS-META-ARCHITECTURE-CANDIDATE-EXECUTION",
      sourceAdmissionId: "RAD-META-ARCHITECTURE-CANDIDATE-EXECUTION-ALLOW",
      radDecision: "allow",
      runId: "RUN-META-STAGE625-EXEC-001",
      sourceRefs: ["RAD-META-ARCHITECTURE-CANDIDATE-EXECUTION-ALLOW"],
    })

    const ext = emitExecutionTrace({
      sourceWorkGraphId: "WG-META-ARCHITECTURE-CANDIDATE-EXECUTION",
      sourceArchitectureCandidateId: "AC-META-ARCHITECTURE-CANDIDATE-EXECUTION",
      sourceSelectionId: "ACS-META-ARCHITECTURE-CANDIDATE-EXECUTION",
      sourceAdmissionId: "RAD-META-ARCHITECTURE-CANDIDATE-EXECUTION-ALLOW",
      sourceExecutionStartId: exs.id,
      runId: "RUN-META-STAGE625-EXEC-001",
      hasExecutionStart: true,
      traversedNodeIds: ["N1", "N2", "N3"],
      sourceRefs: [exs.id],
    })

    const exr = emitExecutionResult({
      sourceWorkGraphId: "WG-META-ARCHITECTURE-CANDIDATE-EXECUTION",
      sourceArchitectureCandidateId: "AC-META-ARCHITECTURE-CANDIDATE-EXECUTION",
      sourceSelectionId: "ACS-META-ARCHITECTURE-CANDIDATE-EXECUTION",
      sourceAdmissionId: "RAD-META-ARCHITECTURE-CANDIDATE-EXECUTION-ALLOW",
      runId: "RUN-META-STAGE625-EXEC-001",
      hasExecutionStart: true,
      sourceRefs: [ext.id],
    })

    expect(exs.id).toBe("EXS-META-ARCHITECTURE-CANDIDATE-EXECUTION")
    expect(ext.id).toBe("EXT-META-ARCHITECTURE-CANDIDATE-EXECUTION")
    expect(exr.id).toBe("EXR-META-ARCHITECTURE-CANDIDATE-EXECUTION")
    expect(exr.status).toBe("succeeded")
  })

  it("fails closed when admission is denied", () => {
    expect(() =>
      emitExecutionStart({
        sourceWorkGraphId: "WG-META-ARCHITECTURE-CANDIDATE-EXECUTION",
        sourceArchitectureCandidateId: "AC-META-ARCHITECTURE-CANDIDATE-EXECUTION",
        sourceSelectionId: "ACS-META-ARCHITECTURE-CANDIDATE-EXECUTION",
        sourceAdmissionId: "RAD-META-ARCHITECTURE-CANDIDATE-EXECUTION-DENY",
        radDecision: "deny",
        runId: "RUN-META-STAGE625-EXEC-001",
        sourceRefs: ["RAD-META-ARCHITECTURE-CANDIDATE-EXECUTION-DENY"],
      })
    ).toThrow()
  })
})
