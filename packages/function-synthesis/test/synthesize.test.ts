/**
 * Integration tests for synthesize() — end-to-end synthesis.
 *
 * Covers AC 1, 2, 3, 4, 5, 13
 */

import { describe, it, expect } from "vitest"
import { synthesize, StubBindingMode, DryRunCodeEmitter, SynthesisResult } from "../src/index.js"
import {
  makeWorkGraph,
  makeCandidate,
  makePassConfig,
  makeFailConfig,
  makePatchThenFailConfig,
  makeSynthesisConfig,
  makeInferenceConfig,
  makeConvergencePolicy,
} from "./test-fixtures.js"

describe("synthesize", () => {
  // AC 1: WorkGraph with 3+ nodes → code files on disk
  it("AC 1: produces code files from a WorkGraph with 3+ nodes", async () => {
    const workGraph = makeWorkGraph()
    const candidate = makeCandidate()
    const bindingMode = new StubBindingMode(makePassConfig())
    const config = makeSynthesisConfig()
    const emitter = new DryRunCodeEmitter()

    const result = await synthesize(workGraph, candidate, bindingMode, config, emitter)

    expect(result.verdict).toBe("pass")
    expect(result.generatedArtifactPaths.length).toBeGreaterThanOrEqual(3)
    // Each file traces to a WorkGraph node via the plan
    for (const path of result.generatedArtifactPaths) {
      expect(path).toContain(config.outputDir)
    }
    // Verify the emitter recorded all paths
    expect(emitter.emittedPaths.length).toBe(3)
  })

  // AC 2: max_repair_loops = 2 → third patch forces non-patch verdict
  it("AC 2: enforces repair-loop bounds", async () => {
    const workGraph = makeWorkGraph()
    const candidate = makeCandidate()
    const bindingMode = new StubBindingMode(makePatchThenFailConfig())
    const config = makeSynthesisConfig({
      inferenceConfig: makeInferenceConfig({ maxRepairLoops: 2 }),
    })

    const result = await synthesize(workGraph, candidate, bindingMode, config)

    // After 2 patches, the third attempt should force a terminal verdict
    expect(result.verdict).not.toBe("pass")
    expect(result.traceLog.terminalDecision.repairLoopCount).toBeLessThanOrEqual(2)
  })

  // AC 3: resample-branch bounds enforced
  it("AC 3: enforces resample-branch bounds", async () => {
    const workGraph = makeWorkGraph()
    const candidate = makeCandidate()
    const bindingMode = new StubBindingMode({
      ...makePassConfig(),
      verifierDecisions: ["resample", "resample", "resample"],
    })
    const config = makeSynthesisConfig({
      convergencePolicy: makeConvergencePolicy({ maxResampleBranches: 1 }),
    })

    const result = await synthesize(workGraph, candidate, bindingMode, config)

    // After 1 resample, the second should be rejected and force terminal
    expect(["fail", "resample-exhausted"]).toContain(result.verdict)
    expect(result.traceLog.terminalDecision.resampleBranchCount).toBeLessThanOrEqual(1)
  })

  // AC 4: Verifier fail → no code on disk, but trace exists
  it("AC 4: does not write code on fail verdict", async () => {
    const workGraph = makeWorkGraph()
    const candidate = makeCandidate()
    const bindingMode = new StubBindingMode(makeFailConfig())
    const config = makeSynthesisConfig()
    const emitter = new DryRunCodeEmitter()

    const result = await synthesize(workGraph, candidate, bindingMode, config, emitter)

    expect(result.verdict).toBe("fail")
    expect(result.generatedArtifactPaths).toHaveLength(0)
    expect(emitter.emittedPaths).toHaveLength(0)
    // But trace exists
    expect(result.traceLog.runId).toBeTruthy()
    expect(result.traceLog.terminalDecision.verdict).toBe("fail")
  })

  // AC 5: deterministic mock → identical output on replay
  it("AC 5: produces deterministic output with deterministic binding mode", async () => {
    const workGraph = makeWorkGraph()
    const candidate = makeCandidate()
    const config = makeSynthesisConfig()

    const bindingMode1 = new StubBindingMode(makePassConfig())
    const emitter1 = new DryRunCodeEmitter()
    const result1 = await synthesize(workGraph, candidate, bindingMode1, config, emitter1)

    const bindingMode2 = new StubBindingMode(makePassConfig())
    const emitter2 = new DryRunCodeEmitter()
    const result2 = await synthesize(workGraph, candidate, bindingMode2, config, emitter2)

    // Verdicts must match
    expect(result1.verdict).toBe(result2.verdict)
    // Artifact paths must match
    expect(emitter1.emittedPaths).toEqual(emitter2.emittedPaths)
    // Repair/resample counts must match
    expect(result1.traceLog.terminalDecision.repairLoopCount)
      .toBe(result2.traceLog.terminalDecision.repairLoopCount)
    expect(result1.traceLog.terminalDecision.resampleBranchCount)
      .toBe(result2.traceLog.terminalDecision.resampleBranchCount)
  })

  // AC 13: pass and fail produce same evidence artifact count
  it("AC 13: emits same evidence artifact count for pass and fail", async () => {
    const workGraph = makeWorkGraph()
    const candidate = makeCandidate()
    const config = makeSynthesisConfig()

    const passResult = await synthesize(
      workGraph, candidate, new StubBindingMode(makePassConfig()), config,
    )
    const failResult = await synthesize(
      workGraph, candidate, new StubBindingMode(makeFailConfig()), config,
    )

    // Both produce traceLog, gate2Input, candidateSelectionReport
    expect(passResult.traceLog).toBeTruthy()
    expect(passResult.gate2Input).toBeTruthy()
    expect(passResult.candidateSelectionReport).toBeTruthy()
    expect(failResult.traceLog).toBeTruthy()
    expect(failResult.gate2Input).toBeTruthy()
    expect(failResult.candidateSelectionReport).toBeTruthy()
  })
})
