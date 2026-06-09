import { describe, it, expect } from "vitest"
import type { ArtifactId } from "@factory/schemas"
import { ExecutableSpecification } from "@factory/schemas"
import { assembleExecutableSpecification } from "./08-assemble-executable-specification.js"
import { emitExecutableSpecification } from "./_executable-specification-emit.js"
import {
  makeAtom,
  makeContract,
  makeDependency,
  makeCoherenceVerificationReportPassing,
  makeInvariant,
  makeIntentSpecification,
  makeValidation,
} from "./_test-fixtures.js"

describe("Executable Specification Assembly", () => {
  it("happy path- passing Coherence Verification + intermediates produces a schema-valid ExecutableSpecification", () => {
    const intentSpecification = makeIntentSpecification()
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
    const executableSpecification = assembleExecutableSpecification(
      intentSpecification,
      atoms,
      contracts,
      invariants,
      deps,
      validations,
      makeCoherenceVerificationReportPassing()
    )
    expect(ExecutableSpecification.safeParse(executableSpecification).success).toBe(true)
    expect(executableSpecification.nodes.length).toBe(3 + 2 + 2)
  })

  it("refuses to run on failed Coherence Verification (criterion 2)", () => {
    expect(() =>
      assembleExecutableSpecification(
        makeIntentSpecification(),
        [],
        [makeContract()],
        [],
        [],
        [],
        makeCoherenceVerificationReportPassing({ overall: "fail" })
      )
    ).toThrow(/refuses to run/)
  })

  it("ExecutableSpecification id format- ES-<Intent Specification subject> (criterion 5)", () => {
    const intentSpecification = makeIntentSpecification({ id: "IS-META-FOO-BAR" as ArtifactId })
    const executableSpecification = assembleExecutableSpecification(
      intentSpecification,
      [],
      [makeContract()],
      [],
      [],
      [],
      makeCoherenceVerificationReportPassing()
    )
    expect(executableSpecification.id).toBe("ES-META-FOO-BAR")
  })

  it("functionId threading (criterion 6)", () => {
    const intentSpecification = makeIntentSpecification({
      sourceFunctionId: "FP-META-CUSTOM-FUNCTION" as ArtifactId,
    })
    const executableSpecification = assembleExecutableSpecification(
      intentSpecification,
      [],
      [makeContract()],
      [],
      [],
      [],
      makeCoherenceVerificationReportPassing()
    )
    expect(executableSpecification.functionId).toBe("FP-META-CUSTOM-FUNCTION")
  })

  it("node type assignment- behavior contract -> execution (criterion 8)", () => {
    const c = makeContract({
      id: "CONTRACT-META-FOO-B" as ArtifactId,
      kind: "behavior",
    })
    const executableSpecification = assembleExecutableSpecification(
      makeIntentSpecification(),
      [],
      [c],
      [],
      [],
      [],
      makeCoherenceVerificationReportPassing()
    )
    expect(executableSpecification.nodes.find((n) => n.id === c.id)?.type).toBe("execution")
  })

  it("node type assignment- invariant contract -> control", () => {
    const c = makeContract({
      id: "CONTRACT-META-FOO-I" as ArtifactId,
      kind: "invariant",
    })
    const executableSpecification = assembleExecutableSpecification(
      makeIntentSpecification(),
      [],
      [c],
      [],
      [],
      [],
      makeCoherenceVerificationReportPassing()
    )
    expect(executableSpecification.nodes.find((n) => n.id === c.id)?.type).toBe("control")
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
    const executableSpecification = assembleExecutableSpecification(
      makeIntentSpecification(),
      [],
      [cApi, cSchema],
      [],
      [],
      [],
      makeCoherenceVerificationReportPassing()
    )
    expect(executableSpecification.nodes.find((n) => n.id === cApi.id)?.type).toBe("interface")
    expect(executableSpecification.nodes.find((n) => n.id === cSchema.id)?.type).toBe("interface")
  })

  it("node type assignment- standalone invariant -> control, validation -> evidence", () => {
    const inv = makeInvariant({ id: "INV-META-FOO-X" as ArtifactId })
    const val = makeValidation({ id: "VAL-META-FOO-X" as ArtifactId })
    const executableSpecification = assembleExecutableSpecification(
      makeIntentSpecification(),
      [],
      [makeContract()],
      [inv],
      [],
      [val],
      makeCoherenceVerificationReportPassing()
    )
    expect(executableSpecification.nodes.find((n) => n.id === inv.id)?.type).toBe("control")
    expect(executableSpecification.nodes.find((n) => n.id === val.id)?.type).toBe("evidence")
  })

  it("dangling dependency endpoint throws (criterion 9)", () => {
    expect(() =>
      assembleExecutableSpecification(
        makeIntentSpecification(),
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
        makeCoherenceVerificationReportPassing()
      )
    ).toThrow(/not present in node set/)
  })

  it("each Dependency produces one ExecutableSpecificationEdge (criterion 10)", () => {
    const c1 = makeContract({ id: "CONTRACT-META-FOO-A" as ArtifactId })
    const c2 = makeContract({
      id: "CONTRACT-META-FOO-B" as ArtifactId,
      kind: "invariant",
    })
    const dep = makeDependency(c1.id, c2.id)
    const executableSpecification = assembleExecutableSpecification(
      makeIntentSpecification(),
      [],
      [c1, c2],
      [],
      [dep],
      [],
      makeCoherenceVerificationReportPassing()
    )
    expect(executableSpecification.edges.filter((e) => e.from === c1.id && e.to === c2.id).length).toBe(1)
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
    const executableSpecification = assembleExecutableSpecification(
      makeIntentSpecification(),
      [],
      [c],
      [inv],
      [],
      [val],
      makeCoherenceVerificationReportPassing()
    )
    expect(executableSpecification.edges.some((e) => e.from === val.id && e.to === inv.id)).toBe(true)
    expect(executableSpecification.edges.some((e) => e.from === val.id && e.to === c.id)).toBe(true)
    expect(executableSpecification.edges.some((e) => e.to.startsWith("ATOM-"))).toBe(false)
  })

  it("determinism- identical inputs produce deep-equal output (criterion 12)", () => {
    const intentSpecification = makeIntentSpecification()
    const contracts = [
      makeContract({ id: "CONTRACT-META-FOO-B" as ArtifactId }),
      makeContract({ id: "CONTRACT-META-FOO-A" as ArtifactId }),
    ]
    const report = makeCoherenceVerificationReportPassing()
    const executableSpecificationA = assembleExecutableSpecification(intentSpecification, [], contracts, [], [], [], report)
    const executableSpecificationB = assembleExecutableSpecification(intentSpecification, [], contracts, [], [], [], report)
    expect(executableSpecificationB).toEqual(executableSpecificationA)
    // Reorder contracts; output must still be deep-equal post-sort.
    const wgC = assembleExecutableSpecification(
      intentSpecification,
      [],
      [contracts[1]!, contracts[0]!],
      [],
      [],
      [],
      report
    )
    expect(wgC).toEqual(executableSpecificationA)
  })

  it("ExecutableSpecification source_refs aggregates Intent Specification + report + intermediates, sorted, deduplicated", () => {
    const intentSpecification = makeIntentSpecification()
    const contract = makeContract()
    const report = makeCoherenceVerificationReportPassing()
    const executableSpecification = assembleExecutableSpecification(intentSpecification, [], [contract], [], [], [], report)
    expect(executableSpecification.source_refs).toContain(intentSpecification.id)
    expect(executableSpecification.source_refs).toContain(report.id)
    expect(executableSpecification.source_refs).toContain(contract.id)
    // sorted
    const sorted = [...executableSpecification.source_refs].sort()
    expect(executableSpecification.source_refs).toEqual(sorted)
    // deduplicated
    expect(new Set(executableSpecification.source_refs).size).toBe(executableSpecification.source_refs.length)
  })

  it("no input mutation (criterion 15)", () => {
    const contracts = Object.freeze([makeContract(), makeContract({ id: "CONTRACT-META-FOO-A" as ArtifactId })])
    const invariants = Object.freeze([makeInvariant()])
    const snapshot = JSON.stringify({ contracts, invariants })
    assembleExecutableSpecification(
      makeIntentSpecification(),
      [],
      contracts,
      invariants,
      [],
      [],
      makeCoherenceVerificationReportPassing()
    )
    expect(JSON.stringify({ contracts, invariants })).toBe(snapshot)
  })

  it("empty nodes throws (criterion 14)", () => {
    expect(() =>
      assembleExecutableSpecification(
        makeIntentSpecification(),
        [],
        [],
        [],
        [],
        [],
        makeCoherenceVerificationReportPassing()
      )
    ).toThrow(/invalid Executable Specification/)
  })
})
