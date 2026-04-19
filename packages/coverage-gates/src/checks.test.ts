import { describe, it, expect } from "vitest"
import {
  checkAtomCoverage,
  checkInvariantCoverage,
  checkValidationCoverage,
  checkDependencyClosure,
  checkBootstrapPrefix,
  type Gate1Input,
} from "./checks.js"
import {
  makeAtom,
  makeContract,
  makeDetector,
  makeInvariant,
  makeDependency,
  makeValidation,
} from "./test-fixtures.js"

function baseInput(overrides: Partial<Gate1Input> = {}): Gate1Input {
  return {
    prdId: "PRD-META-TEST",
    mode: "bootstrap",
    atoms: [],
    contracts: [],
    invariants: [],
    dependencies: [],
    validations: [],
    ...overrides,
  } as Gate1Input
}

describe("checkAtomCoverage", () => {
  it("passes when every atom is referenced downstream", () => {
    const atom = makeAtom("ATOM-META-A")
    const contract = makeContract("INV-META-C1", ["ATOM-META-A"])
    const input = baseInput({ atoms: [atom], contracts: [contract] })
    const result = checkAtomCoverage(input)
    expect(result.status).toBe("pass")
    expect(result.orphan_atoms).toEqual([])
  })

  it("flags orphan atoms with no downstream references", () => {
    const atomA = makeAtom("ATOM-META-A")
    const atomB = makeAtom("ATOM-META-B")
    const contract = makeContract("INV-META-C1", ["ATOM-META-A"])
    const input = baseInput({ atoms: [atomA, atomB], contracts: [contract] })
    const result = checkAtomCoverage(input)
    expect(result.status).toBe("fail")
    expect(result.orphan_atoms).toEqual(["ATOM-META-B"])
  })

  it("recognizes references via source_refs, not just derivedFromAtomIds", () => {
    const atom = makeAtom("ATOM-META-A")
    // Contract derives from a different atom but cites ATOM-META-A in source_refs
    const contract = makeContract("INV-META-C1", ["ATOM-META-Z"], {
      source_refs: ["ATOM-META-A", "ATOM-META-Z"],
    })
    const input = baseInput({ atoms: [atom], contracts: [contract] })
    const result = checkAtomCoverage(input)
    expect(result.status).toBe("pass")
  })

  it("recognizes references via validation coversAtomIds", () => {
    const atom = makeAtom("ATOM-META-A")
    const validation = makeValidation("VAL-META-V1", {
      coversAtomIds: ["ATOM-META-A"],
    })
    const input = baseInput({ atoms: [atom], validations: [validation] })
    const result = checkAtomCoverage(input)
    expect(result.status).toBe("pass")
  })

  it("sorts orphan_atoms deterministically", () => {
    const atoms = [
      makeAtom("ATOM-META-C"),
      makeAtom("ATOM-META-A"),
      makeAtom("ATOM-META-B"),
    ]
    const result = checkAtomCoverage(baseInput({ atoms }))
    expect(result.orphan_atoms).toEqual([
      "ATOM-META-A",
      "ATOM-META-B",
      "ATOM-META-C",
    ])
  })
})

describe("checkInvariantCoverage", () => {
  it("passes when every invariant has validation and well-formed detector", () => {
    const inv = makeInvariant("INV-META-A")
    const val = makeValidation("VAL-META-V1", {
      coversInvariantIds: ["INV-META-A"],
    })
    const input = baseInput({ invariants: [inv], validations: [val] })
    const result = checkInvariantCoverage(input)
    expect(result.status).toBe("pass")
    expect(result.invariants_missing_validation).toEqual([])
    expect(result.invariants_missing_detector).toEqual([])
  })

  it("flags invariants without covering validation", () => {
    const inv = makeInvariant("INV-META-A")
    const input = baseInput({ invariants: [inv], validations: [] })
    const result = checkInvariantCoverage(input)
    expect(result.status).toBe("fail")
    expect(result.invariants_missing_validation).toEqual(["INV-META-A"])
  })

  it("flags invariants with malformed detector (empty direct_rules)", () => {
    const inv = makeInvariant("INV-META-A", {
      detector: makeDetector({ direct_rules: [] as never }),
    })
    const val = makeValidation("VAL-META-V1", {
      coversInvariantIds: ["INV-META-A"],
    })
    const input = baseInput({ invariants: [inv], validations: [val] })
    const result = checkInvariantCoverage(input)
    expect(result.status).toBe("fail")
    expect(result.invariants_missing_detector).toEqual(["INV-META-A"])
  })

  it("flags invariants with malformed detector (empty regression_policy)", () => {
    const inv = makeInvariant("INV-META-A", {
      detector: makeDetector({ regression_policy: {} as never }),
    })
    const val = makeValidation("VAL-META-V1", {
      coversInvariantIds: ["INV-META-A"],
    })
    const input = baseInput({ invariants: [inv], validations: [val] })
    const result = checkInvariantCoverage(input)
    expect(result.status).toBe("fail")
    expect(result.invariants_missing_detector).toEqual(["INV-META-A"])
  })

  it("reports both missing-validation and missing-detector simultaneously", () => {
    const inv1 = makeInvariant("INV-META-A") // missing validation
    const inv2 = makeInvariant("INV-META-B", {
      detector: makeDetector({ direct_rules: [] as never }),
    })
    const val = makeValidation("VAL-META-V1", {
      coversInvariantIds: ["INV-META-B"],
    })
    const input = baseInput({ invariants: [inv1, inv2], validations: [val] })
    const result = checkInvariantCoverage(input)
    expect(result.status).toBe("fail")
    expect(result.invariants_missing_validation).toEqual(["INV-META-A"])
    expect(result.invariants_missing_detector).toEqual(["INV-META-B"])
  })
})

describe("checkValidationCoverage", () => {
  it("passes when every validation has ≥1 covers* entry", () => {
    const val = makeValidation("VAL-META-V1", {
      coversAtomIds: ["ATOM-META-A"],
    })
    const result = checkValidationCoverage(baseInput({ validations: [val] }))
    expect(result.status).toBe("pass")
    expect(result.validations_covering_nothing).toEqual([])
  })

  it("flags validations with all covers* arrays empty", () => {
    const val = makeValidation("VAL-META-V1")
    const result = checkValidationCoverage(baseInput({ validations: [val] }))
    expect(result.status).toBe("fail")
    expect(result.validations_covering_nothing).toEqual(["VAL-META-V1"])
  })

  it("accepts coverage via any of the three covers* arrays", () => {
    const v1 = makeValidation("VAL-META-V1", {
      coversAtomIds: ["ATOM-META-A"],
    })
    const v2 = makeValidation("VAL-META-V2", {
      coversContractIds: ["INV-META-C1"],
    })
    const v3 = makeValidation("VAL-META-V3", {
      coversInvariantIds: ["INV-META-I1"],
    })
    const result = checkValidationCoverage(
      baseInput({ validations: [v1, v2, v3] })
    )
    expect(result.status).toBe("pass")
  })
})

describe("checkDependencyClosure", () => {
  it("passes when every dependency endpoint resolves", () => {
    const atom = makeAtom("ATOM-META-A")
    const inv = makeInvariant("INV-META-I1")
    const dep = makeDependency("DEP-META-D1", "ATOM-META-A", "INV-META-I1")
    const input = baseInput({
      atoms: [atom],
      invariants: [inv],
      dependencies: [dep],
    })
    // Invariant needs a validation for invariant_coverage to pass — irrelevant
    // here since we're testing dependency_closure in isolation.
    const result = checkDependencyClosure(input)
    expect(result.status).toBe("pass")
    expect(result.dangling_dependencies).toEqual([])
  })

  it("flags dependencies whose from endpoint is unresolved", () => {
    const inv = makeInvariant("INV-META-I1")
    const dep = makeDependency("DEP-META-D1", "ATOM-META-MISSING", "INV-META-I1")
    const input = baseInput({ invariants: [inv], dependencies: [dep] })
    const result = checkDependencyClosure(input)
    expect(result.status).toBe("fail")
    expect(result.dangling_dependencies).toEqual(["DEP-META-D1"])
  })

  it("flags dependencies whose to endpoint is unresolved", () => {
    const atom = makeAtom("ATOM-META-A")
    const dep = makeDependency("DEP-META-D1", "ATOM-META-A", "INV-META-MISSING")
    const input = baseInput({ atoms: [atom], dependencies: [dep] })
    const result = checkDependencyClosure(input)
    expect(result.status).toBe("fail")
    expect(result.dangling_dependencies).toEqual(["DEP-META-D1"])
  })
})

describe("checkBootstrapPrefix", () => {
  it("passes when every artifact ID carries a META- qualifier", () => {
    const atom = makeAtom("ATOM-META-A")
    const contract = makeContract("INV-META-C1", ["ATOM-META-A"])
    const inv = makeInvariant("INV-META-I1", {
      derivedFromContractIds: ["INV-META-C1"],
    })
    const input = baseInput({
      atoms: [atom],
      contracts: [contract],
      invariants: [inv],
    })
    const result = checkBootstrapPrefix(input)
    expect(result.status).toBe("pass")
    expect(result.non_meta_artifact_ids).toEqual([])
  })

  it("flags non-META artifact IDs on artifacts themselves", () => {
    const atom = makeAtom("ATOM-VERTICAL-A") // non-META ID
    const input = baseInput({ atoms: [atom] })
    const result = checkBootstrapPrefix(input)
    expect(result.status).toBe("fail")
    expect(result.non_meta_artifact_ids).toContain("ATOM-VERTICAL-A")
  })

  it("flags non-META IDs in source_refs", () => {
    const atom = makeAtom("ATOM-META-A", {
      source_refs: ["PRD-VERTICAL-NOT-META"],
    })
    const input = baseInput({ atoms: [atom] })
    const result = checkBootstrapPrefix(input)
    expect(result.status).toBe("fail")
    expect(result.non_meta_artifact_ids).toContain("PRD-VERTICAL-NOT-META")
  })

  it("flags non-META IDs in dependency endpoints", () => {
    const dep = makeDependency(
      "DEP-META-D1",
      "ATOM-VERTICAL-FROM",
      "INV-META-TO"
    )
    const input = baseInput({ dependencies: [dep] })
    const result = checkBootstrapPrefix(input)
    expect(result.status).toBe("fail")
    expect(result.non_meta_artifact_ids).toContain("ATOM-VERTICAL-FROM")
    expect(result.non_meta_artifact_ids).not.toContain("INV-META-TO")
  })

  it("flags non-META PRD ID", () => {
    const input = baseInput({ prdId: "PRD-VERTICAL-EXAMPLE" } as Gate1Input)
    const result = checkBootstrapPrefix(input)
    expect(result.status).toBe("fail")
    expect(result.non_meta_artifact_ids).toContain("PRD-VERTICAL-EXAMPLE")
  })

  it("deduplicates and sorts non-META IDs", () => {
    const atomA = makeAtom("ATOM-META-A", {
      source_refs: ["PRD-VERTICAL-Z"],
    })
    const atomB = makeAtom("ATOM-META-B", {
      source_refs: ["PRD-VERTICAL-Z", "PRD-VERTICAL-A"],
    })
    const input = baseInput({ atoms: [atomA, atomB] })
    const result = checkBootstrapPrefix(input)
    expect(result.non_meta_artifact_ids).toEqual([
      "PRD-VERTICAL-A",
      "PRD-VERTICAL-Z",
    ])
  })
})
