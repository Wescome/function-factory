import { describe, it, expect } from "vitest"
import { runGate1, type Gate1Input } from "./gate-1.js"
import { Gate1Report } from "@factory/schemas"
import {
  makeAtom,
  makeContract,
  makeInvariant,
  makeValidation,
} from "./test-fixtures.js"

const TIMESTAMP = "2026-04-19T00:00:00Z"

function passingInput(mode: Gate1Input["mode"] = "bootstrap"): Gate1Input {
  const atom = makeAtom("ATOM-META-A")
  const contract = makeContract("INV-META-C1", ["ATOM-META-A"])
  const inv = makeInvariant("INV-META-I1", {
    derivedFromAtomIds: ["ATOM-META-A"],
  })
  const val = makeValidation("VAL-META-V1", {
    coversInvariantIds: ["INV-META-I1"],
    coversAtomIds: ["ATOM-META-A"],
    coversContractIds: ["INV-META-C1"],
  })
  return {
    prdId: "PRD-META-EXAMPLE",
    mode,
    atoms: [atom],
    contracts: [contract],
    invariants: [inv],
    dependencies: [],
    validations: [val],
  } as Gate1Input
}

describe("runGate1", () => {
  it("produces a Gate1Report that validates against the Zod schema", () => {
    const report = runGate1(passingInput(), TIMESTAMP)
    const parsed = Gate1Report.safeParse(report)
    expect(parsed.success).toBe(true)
  })

  it("emits overall=pass when every check passes", () => {
    const report = runGate1(passingInput(), TIMESTAMP)
    expect(report.overall).toBe("pass")
    expect(report.remediation).toBe("no remediation required")
  })

  it("emits overall=fail when any check fails (orphan atom)", () => {
    const input = passingInput()
    const extra = makeAtom("ATOM-META-ORPHAN")
    const modified = { ...input, atoms: [...input.atoms, extra] } as Gate1Input
    const report = runGate1(modified, TIMESTAMP)
    expect(report.overall).toBe("fail")
    expect(report.checks.atom_coverage.status).toBe("fail")
    expect(report.checks.atom_coverage.orphan_atoms).toEqual([
      "ATOM-META-ORPHAN",
    ])
    expect(report.remediation).not.toBe("no remediation required")
    expect(report.remediation).toContain("ATOM-META-ORPHAN")
  })

  it("includes bootstrap_prefix_check when mode is bootstrap", () => {
    const report = runGate1(passingInput("bootstrap"), TIMESTAMP)
    expect(report.checks.bootstrap_prefix_check).toBeDefined()
    expect(report.checks.bootstrap_prefix_check?.status).toBe("pass")
  })

  it("omits bootstrap_prefix_check when mode is steady_state", () => {
    const report = runGate1(passingInput("steady_state"), TIMESTAMP)
    expect(report.checks.bootstrap_prefix_check).toBeUndefined()
  })

  it("flags non-META references in bootstrap mode", () => {
    const input = passingInput("bootstrap")
    const offender = makeAtom("ATOM-VERTICAL-NOT-META")
    const modified = {
      ...input,
      atoms: [...input.atoms, offender],
      // Need a validation to cover it or atom_coverage will also fail.
      // To isolate bootstrap check behavior, reference it from source_refs.
      contracts: [
        ...input.contracts,
        makeContract("INV-META-C2", ["ATOM-VERTICAL-NOT-META"]),
      ],
    } as Gate1Input
    const report = runGate1(modified, TIMESTAMP)
    expect(report.overall).toBe("fail")
    expect(report.checks.bootstrap_prefix_check?.status).toBe("fail")
    expect(
      report.checks.bootstrap_prefix_check?.non_meta_artifact_ids
    ).toContain("ATOM-VERTICAL-NOT-META")
  })

  it("does not run prefix check in steady_state even with non-META IDs", () => {
    const input = passingInput("steady_state")
    const offender = makeAtom("ATOM-VERTICAL-NOT-META")
    const modified = {
      ...input,
      atoms: [...input.atoms, offender],
      contracts: [
        ...input.contracts,
        makeContract("INV-META-C2", ["ATOM-VERTICAL-NOT-META"]),
      ],
    } as Gate1Input
    const report = runGate1(modified, TIMESTAMP)
    expect(report.checks.bootstrap_prefix_check).toBeUndefined()
    expect(report.overall).toBe("pass")
  })

  it("populates source_refs with PRD ID and every failing artifact ID", () => {
    const input = passingInput()
    const extra = makeAtom("ATOM-META-ORPHAN")
    const modified = { ...input, atoms: [...input.atoms, extra] } as Gate1Input
    const report = runGate1(modified, TIMESTAMP)
    expect(report.source_refs).toContain("PRD-META-EXAMPLE")
    expect(report.source_refs).toContain("ATOM-META-ORPHAN")
  })

  it("source_refs is deterministically sorted", () => {
    const input = passingInput()
    const orphanB = makeAtom("ATOM-META-ZZZ")
    const orphanA = makeAtom("ATOM-META-AAA")
    const modified = {
      ...input,
      atoms: [...input.atoms, orphanB, orphanA],
    } as Gate1Input
    const report = runGate1(modified, TIMESTAMP)
    const sorted = [...report.source_refs].sort()
    expect(report.source_refs).toEqual(sorted)
  })

  it("is deterministic — byte-identical reports modulo timestamp", () => {
    const input = passingInput()
    const reportA = runGate1(input, TIMESTAMP)
    const reportB = runGate1(input, TIMESTAMP)
    expect(reportA).toEqual(reportB)
  })

  it("produces different ids for different timestamps, same content otherwise", () => {
    const input = passingInput()
    const reportA = runGate1(input, "2026-04-19T00:00:00Z")
    const reportB = runGate1(input, "2026-04-19T01:00:00Z")
    expect(reportA.id).not.toBe(reportB.id)
    expect(reportA.timestamp).not.toBe(reportB.timestamp)
    // Everything else should match.
    expect(reportA.checks).toEqual(reportB.checks)
    expect(reportA.overall).toBe(reportB.overall)
    expect(reportA.prd_id).toBe(reportB.prd_id)
  })

  it("Coverage Report ID starts with CR- and embeds the PRD ID", () => {
    const report = runGate1(passingInput(), TIMESTAMP)
    expect(report.id).toMatch(/^CR-PRD-META-EXAMPLE-GATE1-/)
  })

  it("replaces colons in timestamp so the ID matches ArtifactId regex", () => {
    const report = runGate1(passingInput(), "2026-04-19T12:34:56Z")
    expect(report.id).not.toContain(":")
    expect(Gate1Report.safeParse(report).success).toBe(true)
  })

  it("sets explicitness to 'explicit' (checks derive literally from inputs)", () => {
    const report = runGate1(passingInput(), TIMESTAMP)
    expect(report.explicitness).toBe("explicit")
  })

  it("rationale is substantive and mentions PRD ID and mode", () => {
    const report = runGate1(passingInput("bootstrap"), TIMESTAMP)
    expect(report.rationale).toContain("PRD-META-EXAMPLE")
    expect(report.rationale).toContain("bootstrap")
    expect(report.rationale.length).toBeGreaterThan(10)
  })

  it("aggregates multiple simultaneous failures into overall=fail with all details", () => {
    const input = passingInput()
    const orphan = makeAtom("ATOM-META-ORPHAN")
    const deadVal = makeValidation("VAL-META-DEAD")
    const modified = {
      ...input,
      atoms: [...input.atoms, orphan],
      validations: [...input.validations, deadVal],
    } as Gate1Input
    const report = runGate1(modified, TIMESTAMP)
    expect(report.overall).toBe("fail")
    expect(report.checks.atom_coverage.status).toBe("fail")
    expect(report.checks.validation_coverage.status).toBe("fail")
    expect(report.remediation).toContain("Atom coverage")
    expect(report.remediation).toContain("Validation coverage")
  })
})
