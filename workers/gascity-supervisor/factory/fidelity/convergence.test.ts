// Tests for the convergence loop decision logic (FV-16..FV-18a).
// The decision is deterministic and pure; it does not run the molecule itself —
// it tells the supervisor whether to re-run, emit a terminal revise, or proceed.
//
// Run: bun test factory/fidelity/convergence.test.ts

import { describe, expect, test } from "bun:test"
import { decideConvergence } from "./convergence.ts"
import type { StepVerdict } from "./types.ts"

function verdict(over: Partial<StepVerdict>): StepVerdict {
  return {
    outcome: "revise",
    remediation: "fix it",
    gate_class: "revision",
    checks: [],
    failing_count: 1,
    ...over,
  }
}

describe("FV-16 re-run condition", () => {
  test("revise + Revision gate + below depth → rerun", () => {
    const d = decideConvergence(verdict({ gate_class: "revision" }), {
      factory_attempt: 1,
      max_amendment_depth: 3,
      prior_failing_count: undefined,
    })
    expect(d.action).toBe("rerun")
    expect(d.next_attempt).toBe(2)
    expect(d.remediation_to_inject).toBe("fix it")
  })

  test("revise + Pre-flight gate + below depth → rerun", () => {
    const d = decideConvergence(verdict({ gate_class: "preflight" }), {
      factory_attempt: 1,
      max_amendment_depth: 3,
    })
    expect(d.action).toBe("rerun")
  })

  test("approved → emit_release approved (no rerun)", () => {
    const d = decideConvergence(verdict({ outcome: "approved", remediation: "", gate_class: undefined, failing_count: 0 }), {
      factory_attempt: 1,
      max_amendment_depth: 3,
    })
    expect(d.action).toBe("emit_release")
    expect(d.outcome).toBe("approved")
  })
})

describe("FV-18 terminal verdicts bypass the loop", () => {
  test("Abort gate → emit_release revise, no rerun", () => {
    const d = decideConvergence(verdict({ gate_class: "abort" }), {
      factory_attempt: 1,
      max_amendment_depth: 3,
    })
    expect(d.action).toBe("emit_release")
    expect(d.outcome).toBe("revise")
    expect(d.remediation).toBe("fix it")
  })

  test("Escalation gate → emit_release revise flagged, no rerun", () => {
    const d = decideConvergence(verdict({ gate_class: "escalation" }), {
      factory_attempt: 1,
      max_amendment_depth: 3,
    })
    expect(d.action).toBe("emit_release")
    expect(d.outcome).toBe("revise")
    expect(d.escalated).toBe(true)
  })
})

describe("FV-18a depth exhaustion", () => {
  test("Revision gate but factory_attempt >= max → terminal revise with depth notice", () => {
    const d = decideConvergence(verdict({ gate_class: "revision" }), {
      factory_attempt: 3,
      max_amendment_depth: 3,
    })
    expect(d.action).toBe("emit_release")
    expect(d.outcome).toBe("revise")
    // carries underlying remediation AND depth-exceeded notice
    expect(d.remediation).toContain("fix it")
    expect(d.remediation.toLowerCase()).toContain("depth")
    expect(d.remediation).toContain("3")
  })

  test("at depth, the limit-reaching factory_attempt is emitted (not re-run)", () => {
    const d = decideConvergence(verdict({ gate_class: "preflight" }), {
      factory_attempt: 3,
      max_amendment_depth: 3,
    })
    expect(d.action).toBe("emit_release")
    expect(d.next_attempt).toBeUndefined()
  })
})

describe("FV-17 escalate-early when issue count does not decrease", () => {
  test("failing_count not decreasing across iterations → terminal revise early", () => {
    const d = decideConvergence(verdict({ gate_class: "revision", failing_count: 2 }), {
      factory_attempt: 2,
      max_amendment_depth: 5,
      prior_failing_count: 2, // did not decrease
    })
    expect(d.action).toBe("emit_release")
    expect(d.outcome).toBe("revise")
    expect(d.escalated_early).toBe(true)
  })

  test("failing_count decreasing → still rerun", () => {
    const d = decideConvergence(verdict({ gate_class: "revision", failing_count: 1 }), {
      factory_attempt: 2,
      max_amendment_depth: 5,
      prior_failing_count: 3, // decreased
    })
    expect(d.action).toBe("rerun")
  })

  test("first iteration (no prior count) → rerun, not escalated early", () => {
    const d = decideConvergence(verdict({ gate_class: "revision", failing_count: 2 }), {
      factory_attempt: 1,
      max_amendment_depth: 5,
      prior_failing_count: undefined,
    })
    expect(d.action).toBe("rerun")
  })
})
