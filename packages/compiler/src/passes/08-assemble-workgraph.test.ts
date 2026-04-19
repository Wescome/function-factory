import { describe, it, expect } from "vitest"
import type { ArtifactId } from "@factory/schemas"
import { WorkGraph } from "@factory/schemas"
import { assembleWorkgraph } from "./08-assemble-workgraph.js"
import {
  makeAtom,
  makeContract,
  makeDependency,
  makeGate1ReportPassing,
  makeInvariant,
  makePRD,
  makeValidation,
} from "./_test-fixtures.js"

describe("assembleWorkgraph", () => {
  it("happy path- passing Gate 1 + intermediates produces a schema-valid WorkGraph", () => {
    const prd = makePRD()
    const atoms = [makeAtom()]
    const contracts = [
      makeContract({ id: "CONTRACT-META-FOO-BEHAVIOR" as ArtifactId, kind: "behavior" }),
      makeContract({ id: "CONTRACT-META-FOO-INVARIANT" as ArtifactId, kind: "invariant" }),
      makeContract({ id: "CONTRACT-META-FOO-API" as ArtifactId, kind: "api" }),
    ]
    const invariants = [
      makeInvariant({ id: "INV-META-FOO-A" as ArtifactId }),
      makeInvariant({ id: "INV-META-FOO-B" as ArtifactId }),
    ]
    const validations = [
      makeValidation({ id: "VAL-META-FOO-A" as ArtifactId }),
      makeValidation({ id: "VAL-META-FOO-B" as ArtifactId }),
    ]
    const deps = [
      makeDependency(
        "CONTRACT-META-FOO-BEHAVIOR" as ArtifactId,
        "CONTRACT-META-FOO-INVARIANT" as ArtifactId
      ),
    ]
    const wg = assembleWorkgraph(
      prd,
      atoms,
      contracts,
      invariants,
      deps,
      validations,
      makeGate1ReportPassing()
    )
    expect(WorkGraph.safeParse(wg).success).toBe(true)
    expect(wg.nodes.length).toBe(3 + 2 + 2)
  })

  it("refuses to run on failed Gate 1 (criterion 2)", () => {
    expect(() =>
      assembleWorkgraph(
        makePRD(),
        [],
        [makeContract()],
        [],
        [],
        [],
        makeGate1ReportPassing({ overall: "fail" })
      )
    ).toThrow(/refuses to run/)
  })

  it("WorkGraph id format- WG-<PRD subject> (criterion 5)", () => {
    const prd = makePRD({ id: "PRD-META-FOO-BAR" as ArtifactId })
    const wg = assembleWorkgraph(
      prd,
      [],
      [makeContract()],
      [],
      [],
      [],
      makeGate1ReportPassing()
    )
    expect(wg.id).toBe("WG-META-FOO-BAR")
  })

  it("functionId threading (criterion 6)", () => {
    const prd = makePRD({
      sourceFunctionId: "FP-META-CUSTOM-FUNCTION" as ArtifactId,
    })
    const wg = assembleWorkgraph(
      prd,
      [],
      [makeContract()],
      [],
      [],
      [],
      makeGate1ReportPassing()
    )
    expect(wg.functionId).toBe("FP-META-CUSTOM-FUNCTION")
  })

  it("node type assignment- behavior contract -> execution (criterion 8)", () => {
    const c = makeContract({
      id: "CONTRACT-META-FOO-B" as ArtifactId,
      kind: "behavior",
    })
    const wg = assembleWorkgraph(
      makePRD(),
      [],
      [c],
      [],
      [],
      [],
      makeGate1ReportPassing()
    )
    expect(wg.nodes.find((n) => n.id === c.id)?.type).toBe("execution")
  })

  it("node type assignment- invariant contract -> control", () => {
    const c = makeContract({
      id: "CONTRACT-META-FOO-I" as ArtifactId,
      kind: "invariant",
    })
    const wg = assembleWorkgraph(
      makePRD(),
      [],
      [c],
      [],
      [],
      [],
      makeGate1ReportPassing()
    )
    expect(wg.nodes.find((n) => n.id === c.id)?.type).toBe("control")
  })

  it("node type assignment- api contract -> interface, schema contract -> interface", () => {
    const cApi = makeContract({
      id: "CONTRACT-META-FOO-API" as ArtifactId,
      kind: "api",
    })
    const cSchema = makeContract({
      id: "CONTRACT-META-FOO-SCHEMA" as ArtifactId,
      kind: "schema",
    })
    const wg = assembleWorkgraph(
      makePRD(),
      [],
      [cApi, cSchema],
      [],
      [],
      [],
      makeGate1ReportPassing()
    )
    expect(wg.nodes.find((n) => n.id === cApi.id)?.type).toBe("interface")
    expect(wg.nodes.find((n) => n.id === cSchema.id)?.type).toBe("interface")
  })

  it("node type assignment- standalone invariant -> control, validation -> evidence", () => {
    const inv = makeInvariant({ id: "INV-META-FOO-X" as ArtifactId })
    const val = makeValidation({ id: "VAL-META-FOO-X" as ArtifactId })
    const wg = assembleWorkgraph(
      makePRD(),
      [],
      [makeContract()],
      [inv],
      [],
      [val],
      makeGate1ReportPassing()
    )
    expect(wg.nodes.find((n) => n.id === inv.id)?.type).toBe("control")
    expect(wg.nodes.find((n) => n.id === val.id)?.type).toBe("evidence")
  })

  it("dangling dependency endpoint throws (criterion 9)", () => {
    expect(() =>
      assembleWorkgraph(
        makePRD(),
        [],
        [makeContract()],
        [],
        [
          makeDependency(
            "CONTRACT-META-FOO-BEHAVIOR" as ArtifactId,
            "CONTRACT-META-DOES-NOT-EXIST" as ArtifactId
          ),
        ],
        [],
        makeGate1ReportPassing()
      )
    ).toThrow(/not present in node set/)
  })

  it("each Dependency produces one WorkGraphEdge (criterion 10)", () => {
    const c1 = makeContract({ id: "CONTRACT-META-FOO-A" as ArtifactId })
    const c2 = makeContract({
      id: "CONTRACT-META-FOO-B" as ArtifactId,
      kind: "invariant",
    })
    const dep = makeDependency(c1.id, c2.id)
    const wg = assembleWorkgraph(
      makePRD(),
      [],
      [c1, c2],
      [],
      [dep],
      [],
      makeGate1ReportPassing()
    )
    expect(wg.edges.filter((e) => e.from === c1.id && e.to === c2.id).length).toBe(1)
  })

  it("coversInvariantIds + coversContractIds produce edges; coversAtomIds does NOT (criterion 11)", () => {
    const c = makeContract({ id: "CONTRACT-META-FOO-A" as ArtifactId })
    const inv = makeInvariant({ id: "INV-META-FOO-A" as ArtifactId })
    const val = makeValidation({
      id: "VAL-META-FOO-A" as ArtifactId,
      coversInvariantIds: [inv.id],
      coversContractIds: [c.id],
      coversAtomIds: ["ATOM-META-FOO-DOES-NOT-EXIST" as ArtifactId],
    })
    const wg = assembleWorkgraph(
      makePRD(),
      [],
      [c],
      [inv],
      [],
      [val],
      makeGate1ReportPassing()
    )
    expect(wg.edges.some((e) => e.from === val.id && e.to === inv.id)).toBe(true)
    expect(wg.edges.some((e) => e.from === val.id && e.to === c.id)).toBe(true)
    expect(wg.edges.some((e) => e.to.startsWith("ATOM-"))).toBe(false)
  })

  it("determinism- identical inputs produce deep-equal output (criterion 12)", () => {
    const prd = makePRD()
    const contracts = [
      makeContract({ id: "CONTRACT-META-FOO-B" as ArtifactId }),
      makeContract({ id: "CONTRACT-META-FOO-A" as ArtifactId }),
    ]
    const report = makeGate1ReportPassing()
    const wgA = assembleWorkgraph(prd, [], contracts, [], [], [], report)
    const wgB = assembleWorkgraph(prd, [], contracts, [], [], [], report)
    expect(wgB).toEqual(wgA)
    // Reorder contracts; output must still be deep-equal post-sort.
    const wgC = assembleWorkgraph(
      prd,
      [],
      [contracts[1]!, contracts[0]!],
      [],
      [],
      [],
      report
    )
    expect(wgC).toEqual(wgA)
  })

  it("WorkGraph source_refs aggregates PRD + report + intermediates, sorted, deduplicated", () => {
    const prd = makePRD()
    const contract = makeContract()
    const report = makeGate1ReportPassing()
    const wg = assembleWorkgraph(prd, [], [contract], [], [], [], report)
    expect(wg.source_refs).toContain(prd.id)
    expect(wg.source_refs).toContain(report.id)
    expect(wg.source_refs).toContain(contract.id)
    // sorted
    const sorted = [...wg.source_refs].sort()
    expect(wg.source_refs).toEqual(sorted)
    // deduplicated
    expect(new Set(wg.source_refs).size).toBe(wg.source_refs.length)
  })

  it("no input mutation (criterion 15)", () => {
    const contracts = Object.freeze([makeContract(), makeContract({ id: "CONTRACT-META-FOO-A" as ArtifactId })])
    const invariants = Object.freeze([makeInvariant()])
    const snapshot = JSON.stringify({ contracts, invariants })
    assembleWorkgraph(
      makePRD(),
      [],
      contracts,
      invariants,
      [],
      [],
      makeGate1ReportPassing()
    )
    expect(JSON.stringify({ contracts, invariants })).toBe(snapshot)
  })

  it("empty nodes throws (criterion 14)", () => {
    expect(() =>
      assembleWorkgraph(
        makePRD(),
        [],
        [],
        [],
        [],
        [],
        makeGate1ReportPassing()
      )
    ).toThrow(/invalid WorkGraph/)
  })
})
