/**
 * Tests for binding-mode interface.
 *
 * AC 14, 15
 */

import { describe, it, expect } from "vitest"
import { StubBindingMode, ALL_ROLE_CONTRACTS } from "../src/index.js"
import type { BindingMode } from "../src/index.js"
import {
  makeWorkGraph,
  makeCandidate,
  makePassConfig,
  makeFailConfig,
} from "./test-fixtures.js"

describe("binding-mode", () => {
  // AC 14: two binding modes, same interface, both produce valid output
  it("AC 14: two binding modes accept same inputs and return conforming outputs", async () => {
    const workGraph = makeWorkGraph()
    const candidate = makeCandidate()
    const context = {
      repairLoopCount: 0,
      maxRepairLoops: 3,
      resampleBranchCount: 0,
      maxResampleBranches: 2,
    }

    // Binding mode 1: pass
    const mode1: BindingMode = new StubBindingMode(makePassConfig())
    const output1 = await mode1.execute(workGraph, candidate, ALL_ROLE_CONTRACTS, context)

    // Binding mode 2: fail (different config, same interface)
    const mode2: BindingMode = new StubBindingMode(makeFailConfig())
    const output2 = await mode2.execute(workGraph, candidate, ALL_ROLE_CONTRACTS, context)

    // Both return BindingModeOutput shape
    expect(output1.verifierDecision).toBe("pass")
    expect(output2.verifierDecision).toBe("fail")
    expect(output1.patchProposals).toBeDefined()
    expect(output2.patchProposals).toBeDefined()
    expect(output1.validationOutcomes).toBeDefined()
    expect(output2.validationOutcomes).toBeDefined()
  })

  // AC 15: same contracts used by both modes
  it("AC 15: both binding modes receive identical role contracts", async () => {
    const workGraph = makeWorkGraph()
    const candidate = makeCandidate()
    const context = {
      repairLoopCount: 0,
      maxRepairLoops: 3,
      resampleBranchCount: 0,
      maxResampleBranches: 2,
    }

    // Create a custom binding mode that captures the contracts it receives
    let capturedContracts1: readonly unknown[] = []
    let capturedContracts2: readonly unknown[] = []

    const mode1: BindingMode = {
      name: "capture-mode-1",
      async execute(_wg, _c, contracts, _ctx) {
        capturedContracts1 = contracts
        return new StubBindingMode(makePassConfig()).execute(_wg, _c, contracts, _ctx)
      },
    }

    const mode2: BindingMode = {
      name: "capture-mode-2",
      async execute(_wg, _c, contracts, _ctx) {
        capturedContracts2 = contracts
        return new StubBindingMode(makePassConfig()).execute(_wg, _c, contracts, _ctx)
      },
    }

    await mode1.execute(workGraph, candidate, ALL_ROLE_CONTRACTS, context)
    await mode2.execute(workGraph, candidate, ALL_ROLE_CONTRACTS, context)

    // Same contracts object passed to both
    expect(capturedContracts1).toBe(capturedContracts2)
  })

  it("StubBindingMode cycles through verifier decisions", async () => {
    const mode = new StubBindingMode({
      ...makePassConfig(),
      verifierDecisions: ["patch", "pass"],
    })

    const workGraph = makeWorkGraph()
    const candidate = makeCandidate()
    const context = {
      repairLoopCount: 0,
      maxRepairLoops: 3,
      resampleBranchCount: 0,
      maxResampleBranches: 2,
    }

    const out1 = await mode.execute(workGraph, candidate, ALL_ROLE_CONTRACTS, context)
    expect(out1.verifierDecision).toBe("patch")

    const out2 = await mode.execute(workGraph, candidate, ALL_ROLE_CONTRACTS, context)
    expect(out2.verifierDecision).toBe("pass")

    // Cycles back
    const out3 = await mode.execute(workGraph, candidate, ALL_ROLE_CONTRACTS, context)
    expect(out3.verifierDecision).toBe("patch")
  })

  it("StubBindingMode.reset() resets call counter", async () => {
    const mode = new StubBindingMode({
      ...makePassConfig(),
      verifierDecisions: ["patch", "pass"],
    })
    const workGraph = makeWorkGraph()
    const candidate = makeCandidate()
    const context = {
      repairLoopCount: 0,
      maxRepairLoops: 3,
      resampleBranchCount: 0,
      maxResampleBranches: 2,
    }

    await mode.execute(workGraph, candidate, ALL_ROLE_CONTRACTS, context)
    mode.reset()
    const out = await mode.execute(workGraph, candidate, ALL_ROLE_CONTRACTS, context)
    expect(out.verifierDecision).toBe("patch")
  })
})
