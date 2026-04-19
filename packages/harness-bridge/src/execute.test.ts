import { describe, it, expect } from "vitest"
import type { WorkGraph } from "@factory/schemas"
import { harnessExecute } from "./execute.js"
import { dryRunAdapter } from "./dry-run-adapter.js"
import type { HarnessAdapter } from "./types.js"

function makeWorkGraph(partial?: Partial<WorkGraph>): WorkGraph {
  return {
    id: "WG-META-FOO",
    source_refs: ["PRD-META-FOO"],
    explicitness: "explicit",
    rationale: "test",
    functionId: "FP-META-FOO",
    nodes: [
      { id: "CONTRACT-META-FOO-A", type: "execution", title: "a" },
      { id: "VAL-META-FOO-01", type: "evidence", title: "v" },
    ],
    edges: [],
    ...partial,
  }
}

function makeRegistry(...adapters: HarnessAdapter[]): Map<string, HarnessAdapter> {
  const m = new Map<string, HarnessAdapter>()
  for (const a of adapters) m.set(a.id, a)
  return m
}

function fixedClock(): () => Date {
  let tick = 0
  return () => new Date(Date.UTC(2026, 3, 19, 18, 0, tick++))
}

describe("harnessExecute — happy path with dry-run adapter", () => {
  it("dispatches every node and returns status completed (AC 1 + AC 7)", async () => {
    const wg = makeWorkGraph()
    const { log } = await harnessExecute({
      workgraph: wg,
      adapterId: "dry-run",
      registry: makeRegistry(dryRunAdapter),
      now: fixedClock(),
    })
    expect(log.status).toBe("completed")
    expect(log.nodes.map((n) => n.nodeId).sort()).toEqual([
      "CONTRACT-META-FOO-A",
      "VAL-META-FOO-01",
    ])
    expect(log.nodes.every((n) => n.status === "simulated")).toBe(true)
  })

  it("matches AC 5 ID format — EL-<WG-ID>-<ts> with hyphen-normalized timestamp", async () => {
    const wg = makeWorkGraph()
    const { log } = await harnessExecute({
      workgraph: wg,
      adapterId: "dry-run",
      registry: makeRegistry(dryRunAdapter),
      now: fixedClock(),
    })
    expect(log.id).toMatch(/^EL-WG-META-FOO-\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-\d{3}Z$/)
  })

  it("populates workGraphId, adapterId, and timestamp fields (AC 6)", async () => {
    const wg = makeWorkGraph()
    const { log } = await harnessExecute({
      workgraph: wg,
      adapterId: "dry-run",
      registry: makeRegistry(dryRunAdapter),
      now: fixedClock(),
    })
    expect(log.workGraphId).toBe("WG-META-FOO")
    expect(log.adapterId).toBe("dry-run")
    expect(log.timestamp).toMatch(/^2026-04-19T18:00:/)
  })

  it("per-node records have every required field (AC 7 + AC 8)", async () => {
    const wg = makeWorkGraph()
    const { log } = await harnessExecute({
      workgraph: wg,
      adapterId: "dry-run",
      registry: makeRegistry(dryRunAdapter),
      now: fixedClock(),
    })
    for (const n of log.nodes) {
      expect(n.nodeId).toBeTruthy()
      expect(n.status).toBe("simulated")
      expect(n.rationale).toBeTruthy()
      expect(n.startedAt).toBeTruthy()
      expect(n.completedAt).toBeTruthy()
    }
  })
})

describe("harnessExecute — adapter_unavailable path", () => {
  it("emits an ExecutionLog with status adapter_unavailable when adapter is missing (AC 2)", async () => {
    const wg = makeWorkGraph()
    const { log } = await harnessExecute({
      workgraph: wg,
      adapterId: "nonexistent",
      registry: makeRegistry(dryRunAdapter),
      now: fixedClock(),
    })
    expect(log.status).toBe("adapter_unavailable")
    expect(log.nodes).toEqual([])
    expect(log.rationale).toContain("nonexistent")
    expect(log.rationale).toContain("dry-run")
  })

  it("invokes zero nodes when adapter is missing", async () => {
    let executeCallCount = 0
    const spyAdapter: HarnessAdapter = {
      id: "spy",
      async execute() {
        executeCallCount++
        return { status: "completed", rationale: "spy" }
      },
    }
    const wg = makeWorkGraph()
    await harnessExecute({
      workgraph: wg,
      adapterId: "nonexistent",
      registry: makeRegistry(spyAdapter),
      now: fixedClock(),
    })
    expect(executeCallCount).toBe(0)
  })
})

describe("harnessExecute — schema validation at the boundary (AC 3)", () => {
  it("throws when the workgraph fails WorkGraph.safeParse", async () => {
    const badWg = { id: "NOT-A-WG", nodes: [] }
    await expect(
      harnessExecute({
        workgraph: badWg,
        adapterId: "dry-run",
        registry: makeRegistry(dryRunAdapter),
        now: fixedClock(),
      })
    ).rejects.toThrow(/schema validation failed/)
  })
})

describe("harnessExecute — summary status derivation (AC 9)", () => {
  it("marks summary status failed when any per-node record is failed", async () => {
    const failingAdapter: HarnessAdapter = {
      id: "failing",
      async execute(node) {
        if (node.id === "VAL-META-FOO-01") {
          return { status: "failed", rationale: "intentional test failure" }
        }
        return { status: "completed", rationale: "ok" }
      },
    }
    const wg = makeWorkGraph()
    const { log } = await harnessExecute({
      workgraph: wg,
      adapterId: "failing",
      registry: makeRegistry(failingAdapter),
      now: fixedClock(),
    })
    expect(log.status).toBe("failed")
  })

  it("marks summary status failed when any per-node record is unknown", async () => {
    const unknownAdapter: HarnessAdapter = {
      id: "unknown-returner",
      async execute() {
        return { status: "unknown", rationale: "could not infer outcome" }
      },
    }
    const wg = makeWorkGraph()
    const { log } = await harnessExecute({
      workgraph: wg,
      adapterId: "unknown-returner",
      registry: makeRegistry(unknownAdapter),
      now: fixedClock(),
    })
    expect(log.status).toBe("failed")
  })

  it("records node as failed when adapter throws (no exception propagates to caller)", async () => {
    const throwingAdapter: HarnessAdapter = {
      id: "throwing",
      async execute() {
        throw new Error("adapter explosion")
      },
    }
    const wg = makeWorkGraph()
    const { log } = await harnessExecute({
      workgraph: wg,
      adapterId: "throwing",
      registry: makeRegistry(throwingAdapter),
      now: fixedClock(),
    })
    expect(log.status).toBe("failed")
    expect(log.nodes.every((n) => n.status === "failed")).toBe(true)
    expect(log.nodes[0]!.rationale).toContain("adapter explosion")
  })
})

describe("harnessExecute — determinism (AC 10)", () => {
  it("plan fields (nodeId order, adapterId, workGraphId) are identical across invocations", async () => {
    const wg = makeWorkGraph()
    const r1 = await harnessExecute({
      workgraph: wg,
      adapterId: "dry-run",
      registry: makeRegistry(dryRunAdapter),
      now: fixedClock(),
    })
    const r2 = await harnessExecute({
      workgraph: wg,
      adapterId: "dry-run",
      registry: makeRegistry(dryRunAdapter),
      now: fixedClock(),
    })
    expect(r1.log.nodes.map((n) => n.nodeId)).toEqual(
      r2.log.nodes.map((n) => n.nodeId)
    )
    expect(r1.log.adapterId).toBe(r2.log.adapterId)
    expect(r1.log.workGraphId).toBe(r2.log.workGraphId)
  })
})

describe("harnessExecute — input immutability (AC 13)", () => {
  it("does not mutate the input WorkGraph", async () => {
    const wg = makeWorkGraph()
    const originalNodeOrder = wg.nodes.map((n) => n.id)
    await harnessExecute({
      workgraph: wg,
      adapterId: "dry-run",
      registry: makeRegistry(dryRunAdapter),
      now: fixedClock(),
    })
    expect(wg.nodes.map((n) => n.id)).toEqual(originalNodeOrder)
  })
})
