import { describe, expect, it } from "vitest"
import { renderPrdFromFunctionProposal } from "../src/render-prd.js"
import { validateRenderedPrdShape } from "../src/validate-prd-shape.js"
import deltaProposal from "./fixtures/fp-meta-capability-delta-engine.json" assert { type: "json" }
import semanticProposal from "./fixtures/fp-meta-semantic-review-execution.json" assert { type: "json" }
import archProposal from "./fixtures/fp-meta-architecture-candidate-execution.json" assert { type: "json" }

describe("renderPrdFromFunctionProposal bridge", () => {
  it("renders compiler-ready markdown for the delta engine proposal", () => {
    const rendered = renderPrdFromFunctionProposal({
      proposal: deltaProposal as never,
      sourceCapabilityId: "BC-META-COMPUTE-CAPABILITY-DELTA",
      sourceFunctionId: "FN-META-CAPABILITY-DELTA-ENGINE",
      sourceRefs: [
        "DEL-META-COMPUTE-CAPABILITY-DELTA",
        "FP-META-CAPABILITY-DELTA-ENGINE",
      ],
    })

    expect(rendered.id).toBe("PRD-META-CAPABILITY-DELTA-ENGINE")
    expect(rendered.markdown).toContain("## Problem")
  })

  it("renders compiler-ready markdown for the semantic review proposal", () => {
    const rendered = renderPrdFromFunctionProposal({
      proposal: semanticProposal as never,
      sourceCapabilityId: "BC-META-SEMANTICALLY-REVIEW-PRDS",
      sourceFunctionId: "FN-META-SEMANTIC-REVIEW-EXECUTION",
      sourceRefs: [
        "DEL-META-SEMANTICALLY-REVIEW-PRDS",
        "FP-META-SEMANTIC-REVIEW-EXECUTION",
      ],
    })

    expect(rendered.id).toBe("PRD-META-SEMANTIC-REVIEW-EXECUTION")
    expect(rendered.markdown).toContain("Semantic Review Execution Engine")
    expect(rendered.markdown).toContain("## Acceptance Criteria")
  })

  it("passes the lightweight shape validator for semantic review", () => {
    const rendered = renderPrdFromFunctionProposal({
      proposal: semanticProposal as never,
      sourceCapabilityId: "BC-META-SEMANTICALLY-REVIEW-PRDS",
      sourceFunctionId: "FN-META-SEMANTIC-REVIEW-EXECUTION",
      sourceRefs: [
        "DEL-META-SEMANTICALLY-REVIEW-PRDS",
        "FP-META-SEMANTIC-REVIEW-EXECUTION",
      ],
    })

    expect(() => validateRenderedPrdShape(rendered.markdown)).not.toThrow()
  })

  it("fails explicitly for unsupported proposals", () => {
    expect(() =>
      renderPrdFromFunctionProposal({
        proposal: {
          ...(semanticProposal as any),
          id: "FP-META-UNSUPPORTED"
        } as never,
        sourceCapabilityId: "BC-META-SEMANTICALLY-REVIEW-PRDS",
        sourceFunctionId: "FN-META-SEMANTIC-REVIEW-EXECUTION",
        sourceRefs: ["DEL-META-SEMANTICALLY-REVIEW-PRDS"],
      })
    ).toThrowError(
      "Initial PRD authoring bridge supports only FP-META-CAPABILITY-DELTA-ENGINE, FP-META-SEMANTIC-REVIEW-EXECUTION, and FP-META-ARCHITECTURE-CANDIDATE-EXECUTION"
    )
  })

  it("renders compiler-ready markdown for the architecture-candidate proposal", () => {
    const rendered = renderPrdFromFunctionProposal({
      proposal: archProposal as never,
      sourceCapabilityId: "BC-META-EMIT-ARCHITECTURE-CANDIDATES",
      sourceFunctionId: "FN-META-ARCHITECTURE-CANDIDATE-EXECUTION",
      sourceRefs: [
        "DEL-META-EMIT-ARCHITECTURE-CANDIDATES",
        "FP-META-ARCHITECTURE-CANDIDATE-EXECUTION",
      ],
    })

    expect(rendered.id).toBe("PRD-META-ARCHITECTURE-CANDIDATE-EXECUTION")
    expect(rendered.markdown).toContain("Architecture Candidate Execution Engine")
    expect(rendered.markdown).toContain("## Acceptance Criteria")
  })

  it("passes the lightweight shape validator for architecture-candidate", () => {
    const rendered = renderPrdFromFunctionProposal({
      proposal: archProposal as never,
      sourceCapabilityId: "BC-META-EMIT-ARCHITECTURE-CANDIDATES",
      sourceFunctionId: "FN-META-ARCHITECTURE-CANDIDATE-EXECUTION",
      sourceRefs: [
        "DEL-META-EMIT-ARCHITECTURE-CANDIDATES",
        "FP-META-ARCHITECTURE-CANDIDATE-EXECUTION",
      ],
    })

    expect(() => validateRenderedPrdShape(rendered.markdown)).not.toThrow()
  })
})
