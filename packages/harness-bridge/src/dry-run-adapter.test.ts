import { describe, it, expect } from "vitest"
import { dryRunAdapter } from "./dry-run-adapter.js"

describe("dryRunAdapter", () => {
  it("has id 'dry-run'", () => {
    expect(dryRunAdapter.id).toBe("dry-run")
  })

  it("returns status simulated regardless of node type (AC 8- simulated only with dry-run)", async () => {
    const cases = [
      { id: "n1", type: "execution" as const, title: "e" },
      { id: "n2", type: "control" as const, title: "c" },
      { id: "n3", type: "evidence" as const, title: "v" },
      { id: "n4", type: "interface" as const, title: "i" },
    ]
    for (const node of cases) {
      const outcome = await dryRunAdapter.execute(node, {})
      expect(outcome.status).toBe("simulated")
      expect(outcome.rationale).toContain(node.id)
      expect(outcome.rationale).toContain(node.type)
    }
  })
})
