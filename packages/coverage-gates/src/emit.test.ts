import { describe, it, expect, beforeEach, afterEach } from "vitest"
import { mkdtemp, rm, readFile, readdir } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { parse as parseYaml } from "yaml"
import { emitCoherenceVerificationReport } from "./emit.js"
import { runCoherenceVerification } from "./coherence-verification.js"
import type { CoherenceVerificationInput } from "./coherence-verification.js"
import {
  makeAtom,
  makeContract,
  makeInvariant,
  makeValidation,
} from "./test-fixtures.js"

function passingInput(): CoherenceVerificationInput {
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
    prdId: "PRD-META-EMIT-TEST",
    mode: "bootstrap",
    atoms: [atom],
    contracts: [contract],
    invariants: [inv],
    dependencies: [],
    validations: [val],
  } as CoherenceVerificationInput
}

describe("emitCoherenceVerificationReport", () => {
  let workDir: string

  beforeEach(async () => {
    workDir = await mkdtemp(join(tmpdir(), "coherence-verification-emit-test-"))
  })

  afterEach(async () => {
    await rm(workDir, { recursive: true, force: true })
  })

  it("writes a YAML file whose name matches <id>.yaml", async () => {
    const report = runCoherenceVerification(passingInput(), "2026-04-19T00:00:00Z")
    const outDir = join(workDir, "specs", "coverage-reports")
    const path = await emitCoherenceVerificationReport(report, outDir)
    expect(path).toBe(join(outDir, `${report.id}.yaml`))

    const files = await readdir(outDir)
    expect(files).toEqual([`${report.id}.yaml`])
  })

  it("creates the destination directory if it does not exist", async () => {
    const report = runCoherenceVerification(passingInput(), "2026-04-19T00:00:00Z")
    // Deeply nested target that does not exist yet
    const outDir = join(workDir, "does", "not", "exist", "yet")
    const path = await emitCoherenceVerificationReport(report, outDir)
    const contents = await readFile(path, "utf8")
    expect(contents.length).toBeGreaterThan(0)
  })

  it("produces YAML that roundtrips to an equivalent object", async () => {
    const report = runCoherenceVerification(passingInput(), "2026-04-19T00:00:00Z")
    const path = await emitCoherenceVerificationReport(report, workDir)
    const contents = await readFile(path, "utf8")
    const roundtripped = parseYaml(contents)
    expect(roundtripped.id).toBe(report.id)
    expect(roundtripped.verification).toBe("coherence")
    expect(roundtripped.overall).toBe("pass")
    expect(roundtripped.prd_id).toBe("PRD-META-EMIT-TEST")
    expect(roundtripped.remediation).toBe("no remediation required")
  })

  it("YAML output contains key CoherenceVerificationReport fields", async () => {
    const report = runCoherenceVerification(passingInput(), "2026-04-19T00:00:00Z")
    const path = await emitCoherenceVerificationReport(report, workDir)
    const contents = await readFile(path, "utf8")
    expect(contents).toContain("verification: coherence")
    expect(contents).toContain("overall: pass")
    expect(contents).toContain("prd_id: PRD-META-EMIT-TEST")
    expect(contents).toContain("atom_coverage:")
    expect(contents).toContain("bootstrap_prefix_check:") // bootstrap mode
  })
})
