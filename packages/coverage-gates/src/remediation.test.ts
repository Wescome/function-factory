import { describe, it, expect } from "vitest"
import { generateRemediation } from "./remediation.js"
import type { Gate1Report } from "@factory/schemas"

type Checks = Gate1Report["checks"]

const passingChecks: Checks = {
  atom_coverage: { status: "pass", details: [], orphan_atoms: [] },
  invariant_coverage: {
    status: "pass",
    details: [],
    invariants_missing_validation: [],
    invariants_missing_detector: [],
  },
  validation_coverage: {
    status: "pass",
    details: [],
    validations_covering_nothing: [],
  },
  dependency_closure: {
    status: "pass",
    details: [],
    dangling_dependencies: [],
  },
}

describe("generateRemediation", () => {
  it("returns boilerplate string on overall=pass", () => {
    expect(generateRemediation(passingChecks, "pass")).toBe(
      "no remediation required"
    )
  })

  it("names orphan atoms and cites ConOps §7.2 step 3", () => {
    const checks: Checks = {
      ...passingChecks,
      atom_coverage: {
        status: "fail",
        details: [],
        orphan_atoms: ["ATOM-META-A", "ATOM-META-B"],
      },
    }
    const text = generateRemediation(checks, "fail")
    expect(text).toContain("Atom coverage")
    expect(text).toContain("ATOM-META-A")
    expect(text).toContain("ATOM-META-B")
    expect(text).toContain("ConOps §7.2")
  })

  it("reports missing-validation and missing-detector as separate sections", () => {
    const checks: Checks = {
      ...passingChecks,
      invariant_coverage: {
        status: "fail",
        details: [],
        invariants_missing_validation: ["INV-META-A"],
        invariants_missing_detector: ["INV-META-B"],
      },
    }
    const text = generateRemediation(checks, "fail")
    expect(text).toContain("missing validation")
    expect(text).toContain("INV-META-A")
    expect(text).toContain("missing detector")
    expect(text).toContain("INV-META-B")
    expect(text).toContain("invariant-authoring")
  })

  it("names dead validations and cites ConOps §7.2 step 6", () => {
    const checks: Checks = {
      ...passingChecks,
      validation_coverage: {
        status: "fail",
        details: [],
        validations_covering_nothing: ["VAL-META-DEAD"],
      },
    }
    const text = generateRemediation(checks, "fail")
    expect(text).toContain("Validation coverage")
    expect(text).toContain("VAL-META-DEAD")
    expect(text).toContain("step 6")
  })

  it("names dangling dependencies and cites ConOps §7.2 step 7", () => {
    const checks: Checks = {
      ...passingChecks,
      dependency_closure: {
        status: "fail",
        details: [],
        dangling_dependencies: ["DEP-META-D1"],
      },
    }
    const text = generateRemediation(checks, "fail")
    expect(text).toContain("Dependency closure")
    expect(text).toContain("DEP-META-D1")
    expect(text).toContain("step 7")
  })

  it("names non-META IDs and cites ConOps §4.1 Rule 2", () => {
    const checks: Checks = {
      ...passingChecks,
      bootstrap_prefix_check: {
        status: "fail",
        details: [],
        non_meta_artifact_ids: ["PRD-VERTICAL-EXAMPLE"],
      },
    }
    const text = generateRemediation(checks, "fail")
    expect(text).toContain("Bootstrap prefix")
    expect(text).toContain("PRD-VERTICAL-EXAMPLE")
    expect(text).toContain("§4.1")
  })

  it("combines multiple failures into a single multi-paragraph remediation", () => {
    const checks: Checks = {
      ...passingChecks,
      atom_coverage: {
        status: "fail",
        details: [],
        orphan_atoms: ["ATOM-META-A"],
      },
      validation_coverage: {
        status: "fail",
        details: [],
        validations_covering_nothing: ["VAL-META-DEAD"],
      },
    }
    const text = generateRemediation(checks, "fail")
    expect(text).toContain("Atom coverage")
    expect(text).toContain("Validation coverage")
    // Sections are separated by blank lines
    expect(text.split("\n\n").length).toBe(2)
  })

  it("uses singular vs plural noun forms correctly", () => {
    const singular = generateRemediation(
      {
        ...passingChecks,
        atom_coverage: {
          status: "fail",
          details: [],
          orphan_atoms: ["ATOM-META-A"],
        },
      },
      "fail"
    )
    expect(singular).toContain("1 orphan atom ")

    const plural = generateRemediation(
      {
        ...passingChecks,
        atom_coverage: {
          status: "fail",
          details: [],
          orphan_atoms: ["ATOM-META-A", "ATOM-META-B"],
        },
      },
      "fail"
    )
    expect(plural).toContain("2 orphan atoms ")
  })
})
