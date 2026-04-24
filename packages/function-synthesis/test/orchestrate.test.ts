/**
 * Tests for orchestration loop.
 *
 * AC 2, 3, 4, 17
 */

import { describe, it, expect } from "vitest"
import {
  createDecisionState,
  availableDecisions,
  applyDecision,
  LifecycleTransition,
} from "../src/index.js"
import {
  makeInferenceConfig,
  makeConvergencePolicy,
} from "./test-fixtures.js"

describe("decision-state", () => {
  it("initial state has zero repair and resample counts", () => {
    const state = createDecisionState(
      makeInferenceConfig(),
      makeConvergencePolicy(),
    )
    expect(state.repairLoopCount).toBe(0)
    expect(state.resampleBranchCount).toBe(0)
    expect(state.currentLifecycle).toBe("in_progress")
  })

  it("AC 2: patch option removed when repair loop bound reached", () => {
    const state = createDecisionState(
      makeInferenceConfig({ maxRepairLoops: 2 }),
      makeConvergencePolicy(),
    )
    state.repairLoopCount = 2

    const available = availableDecisions(state)
    expect(available.has("patch")).toBe(false)
    expect(available.has("pass")).toBe(true)
    expect(available.has("fail")).toBe(true)
  })

  it("AC 3: resample option removed when resample bound reached", () => {
    const state = createDecisionState(
      makeInferenceConfig(),
      makeConvergencePolicy({ maxResampleBranches: 1 }),
    )
    state.resampleBranchCount = 1

    const available = availableDecisions(state)
    expect(available.has("resample")).toBe(false)
    expect(available.has("pass")).toBe(true)
  })

  it("applyDecision(pass) returns terminal pass and updates lifecycle", () => {
    const state = createDecisionState(
      makeInferenceConfig(),
      makeConvergencePolicy(),
    )
    const result = applyDecision(state, "pass")
    expect(result.terminal).toBe("pass")
    expect(result.state.currentLifecycle).toBe("implemented")
  })

  it("applyDecision(patch) increments repair count when within bounds", () => {
    const state = createDecisionState(
      makeInferenceConfig({ maxRepairLoops: 3 }),
      makeConvergencePolicy(),
    )
    const result = applyDecision(state, "patch")
    expect(result.terminal).toBeNull()
    expect(result.state.repairLoopCount).toBe(1)
  })

  it("applyDecision(patch) returns patch-exhausted when at bounds", () => {
    const state = createDecisionState(
      makeInferenceConfig({ maxRepairLoops: 2 }),
      makeConvergencePolicy(),
    )
    state.repairLoopCount = 2

    const result = applyDecision(state, "patch")
    expect(result.terminal).toBe("patch-exhausted")
  })

  it("applyDecision(fail) returns terminal fail", () => {
    const state = createDecisionState(
      makeInferenceConfig(),
      makeConvergencePolicy(),
    )
    const result = applyDecision(state, "fail")
    expect(result.terminal).toBe("fail")
    expect(result.state.currentLifecycle).toBe("failed")
  })

  // AC 17: lifecycle transition table is importable as typed value
  it("AC 17: LifecycleTransition is a typed importable constant", () => {
    expect(LifecycleTransition.specifiedToInProgress).toEqual({
      from: "specified",
      to: "in_progress",
    })
    expect(LifecycleTransition.inProgressToImplemented).toEqual({
      from: "in_progress",
      to: "implemented",
    })
    expect(LifecycleTransition.inProgressToFailed).toEqual({
      from: "in_progress",
      to: "failed",
    })
  })
})
