import { describe, expect, it } from "vitest"
import { renderPrdFromFunctionProposal } from "../src/render-prd.js"
import { validateRenderedPrdShape } from "../src/validate-prd-shape.js"
import proposal from "./fixtures/fp-meta-capability-delta-engine.json" assert { type: "json" }

describe("renderPrdFromFunctionProposal narrow bridge", () => {
  it("renders compiler-ready markdown for the supported proposal", () => {
    const rendered = renderPrdFromFunctionProposal({
      proposal: proposal as never,
      sourceCapabilityId: "BC-META-COMPUTE-CAPABILITY-DELTA",
      sourceFunctionId: "FN-META-CAPABILITY-DELTA-ENGINE",
      sourceRefs: [
        "DEL-META-COMPUTE-CAPABILITY-DELTA",
        "FP-META-CAPABILITY-DELTA-ENGINE",
      ],
    })

    expect(rendered.id).toBe("PRD-META-CAPABILITY-DELTA-ENGINE")
    expect(rendered.filename).toBe("PRD-META-CAPABILITY-DELTA-ENGINE.md")
    expect(rendered.markdown).toContain("## Problem")
    expect(rendered.markdown).toContain("## Acceptance Criteria")
  })

  it("passes the lightweight shape validator", () => {
    const rendered = renderPrdFromFunctionProposal({
      proposal: proposal as never,
      sourceCapabilityId: "BC-META-COMPUTE-CAPABILITY-DELTA",
      sourceFunctionId: "FN-META-CAPABILITY-DELTA-ENGINE",
      sourceRefs: [
        "DEL-META-COMPUTE-CAPABILITY-DELTA",
        "FP-META-CAPABILITY-DELTA-ENGINE",
      ],
    })

    expect(() => validateRenderedPrdShape(rendered.markdown)).not.toThrow()
  })

  it("fails explicitly for unsupported proposals", () => {
    expect(() =>
      renderPrdFromFunctionProposal({
        proposal: {
          ...(proposal as any),
          id: "FP-META-UNSUPPORTED"
        } as never,
        sourceCapabilityId: "BC-META-COMPUTE-CAPABILITY-DELTA",
        sourceFunctionId: "FN-META-CAPABILITY-DELTA-ENGINE",
        sourceRefs: ["DEL-META-COMPUTE-CAPABILITY-DELTA"],
      })
    ).toThrowError(
      "Initial PRD authoring bridge supports only FP-META-CAPABILITY-DELTA-ENGINE"
    )
  })
})
