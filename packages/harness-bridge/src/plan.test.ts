import { describe, it, expect } from "vitest"
import type { WorkGraph } from "@factory/schemas"
import { derivePlan } from "./plan.js"

function makeWorkGraph(partial?: Partial<WorkGraph>): WorkGraph {
  return {
    id: "WG-META-FOO",
    source_refs: ["PRD-META-FOO"],
    explicitness: "explicit",
    rationale: "test",
    functionId: "FP-META-FOO",
    nodes: [
      { id: "CONTRACT-META-FOO-B", type: "execution", title: "b" },
      { id: "CONTRACT-META-FOO-A", type: "execution", title: "a" },
      { id: "VAL-META-FOO-01", type: "evidence", title: "v" },
    ],
    edges: [],
    ...partial,
  }
}

describe("derivePlan", () => {
  it("sorts nodes alphabetically by id (deterministic plan)", () => {
    const wg = makeWorkGraph()
    const plan = derivePlan(wg)
    expect(plan.map((n) => n.id)).toEqual([
      "CONTRACT-META-FOO-A",
      "CONTRACT-META-FOO-B",
      "VAL-META-FOO-01",
    ])
  })

  it("does not mutate input nodes array", () => {
    const wg = makeWorkGraph()
    const originalOrder = wg.nodes.map((n) => n.id)
    derivePlan(wg)
    expect(wg.nodes.map((n) => n.id)).toEqual(originalOrder)
  })

  it("produces identical plans across invocations (determinism)", () => {
    const wg = makeWorkGraph()
    const p1 = derivePlan(wg).map((n) => n.id)
    const p2 = derivePlan(wg).map((n) => n.id)
    expect(p1).toEqual(p2)
  })
})
