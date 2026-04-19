/**
 * End-to-end compile test against the real PRD-META-GATE-1-COMPILE-COVERAGE.md.
 *
 * This is the bootstrap proof- run the compiler against the first meta-PRD,
 * assert that the pipeline produces a Gate1Report on disk, and capture
 * whether that verdict is pass or fail. Either outcome is acceptable
 * for bootstrap- the artifact that matters is the Coverage Report itself.
 */

import { describe, expect, it, beforeEach, afterEach } from "vitest"
import { mkdtemp, readFile, rm, writeFile, mkdir } from "node:fs/promises"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { parse as parseYaml } from "yaml"
import { Gate1Report } from "@factory/schemas"
import { compile } from "./compile.js"

// Path to the real meta-PRD; resolved from the monorepo root.
// The test constructs a temporary workspace with the PRD copied in
// so the test does not depend on the PRD's actual filesystem location
// beyond what the harness copies over.
import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"

const THIS_DIR = dirname(fileURLToPath(import.meta.url))
// packages/compiler/src -> monorepo root is three dirs up
const MONOREPO_ROOT = join(THIS_DIR, "..", "..", "..")
const REAL_PRD_PATH = join(
  MONOREPO_ROOT,
  "specs",
  "prds",
  "PRD-META-GATE-1-COMPILE-COVERAGE.md"
)

describe("compile- end-to-end against PRD-META-GATE-1-COMPILE-COVERAGE", () => {
  let workDir: string
  let prdPath: string
  let coverageReportsDir: string

  beforeEach(async () => {
    workDir = await mkdtemp(join(tmpdir(), "compile-e2e-"))
    const prdsDir = join(workDir, "specs", "prds")
    await mkdir(prdsDir, { recursive: true })
    prdPath = join(prdsDir, "PRD-META-GATE-1-COMPILE-COVERAGE.md")
    // Read the real PRD and copy it into the test workspace.
    const realPrdContent = readFileSync(REAL_PRD_PATH, "utf8")
    await writeFile(prdPath, realPrdContent, "utf8")
    coverageReportsDir = join(workDir, "specs", "coverage-reports")
  })

  afterEach(async () => {
    await rm(workDir, { recursive: true, force: true })
  })

  it("produces a Gate1Report that validates against the Zod schema", async () => {
    const result = await compile(prdPath, {
      timestamp: "2026-04-19T00:00:00Z",
      coverageReportsDir,
    })
    const parsed = Gate1Report.safeParse(result.report)
    expect(parsed.success).toBe(true)
  })

  it("emits the Coverage Report as YAML to the configured directory", async () => {
    const result = await compile(prdPath, {
      timestamp: "2026-04-19T00:00:00Z",
      coverageReportsDir,
    })
    const onDisk = await readFile(result.reportPath, "utf8")
    expect(onDisk.length).toBeGreaterThan(0)
    const roundtrip = parseYaml(onDisk)
    expect(roundtrip.gate).toBe(1)
    expect(roundtrip.prd_id).toBe("PRD-META-GATE-1-COMPILE-COVERAGE")
  })

  it("compiles in bootstrap mode by default (PRD-META- prefix)", async () => {
    const result = await compile(prdPath, {
      timestamp: "2026-04-19T00:00:00Z",
      coverageReportsDir,
    })
    expect(result.mode).toBe("bootstrap")
    expect(result.report.checks.bootstrap_prefix_check).toBeDefined()
  })

  it("produces non-empty intermediates from Passes 1–5", async () => {
    const result = await compile(prdPath, {
      timestamp: "2026-04-19T00:00:00Z",
      coverageReportsDir,
    })
    // Per PRD structure- 15 AC + 5-8 constraints + 5 metrics ≈ 25-28 atoms
    expect(result.intermediates.atoms.length).toBeGreaterThanOrEqual(20)
    expect(result.intermediates.contracts.length).toBeGreaterThan(0)
    expect(result.intermediates.invariants.length).toBeGreaterThan(0)
    expect(result.intermediates.validations.length).toBeGreaterThan(0)
    // MVP emits no dependencies
    expect(result.intermediates.dependencies.length).toBe(0)
  })

  it("every invariant has ≥1 covering validation", async () => {
    const result = await compile(prdPath, {
      timestamp: "2026-04-19T00:00:00Z",
      coverageReportsDir,
    })
    for (const inv of result.intermediates.invariants) {
      const covering = result.intermediates.validations.filter((v) =>
        v.coversInvariantIds.includes(inv.id)
      )
      expect(covering.length).toBeGreaterThanOrEqual(1)
    }
  })

  it("every atom is referenced by ≥1 downstream artifact", async () => {
    const result = await compile(prdPath, {
      timestamp: "2026-04-19T00:00:00Z",
      coverageReportsDir,
    })
    const referenced = new Set<string>()
    for (const c of result.intermediates.contracts) {
      for (const id of c.derivedFromAtomIds) referenced.add(id)
      for (const id of c.source_refs) referenced.add(id)
    }
    for (const inv of result.intermediates.invariants) {
      for (const id of inv.derivedFromAtomIds) referenced.add(id)
      for (const id of inv.source_refs) referenced.add(id)
    }
    for (const v of result.intermediates.validations) {
      for (const id of v.coversAtomIds) referenced.add(id)
      for (const id of v.source_refs) referenced.add(id)
    }
    for (const atom of result.intermediates.atoms) {
      expect(referenced.has(atom.id)).toBe(true)
    }
  })

  it("report remediation is non-empty", async () => {
    const result = await compile(prdPath, {
      timestamp: "2026-04-19T00:00:00Z",
      coverageReportsDir,
    })
    expect(result.report.remediation.length).toBeGreaterThan(0)
  })

  it("is deterministic- two compiles with the same timestamp produce the same report", async () => {
    const resultA = await compile(prdPath, {
      timestamp: "2026-04-19T00:00:00Z",
      coverageReportsDir,
    })
    // Second compile — force different workdir to avoid file collision
    const workDir2 = await mkdtemp(join(tmpdir(), "compile-e2e-"))
    try {
      const prdsDir2 = join(workDir2, "specs", "prds")
      await mkdir(prdsDir2, { recursive: true })
      const prdPath2 = join(prdsDir2, "PRD-META-GATE-1-COMPILE-COVERAGE.md")
      await writeFile(prdPath2, readFileSync(REAL_PRD_PATH, "utf8"), "utf8")
      const coverageReportsDir2 = join(workDir2, "specs", "coverage-reports")
      const resultB = await compile(prdPath2, {
        timestamp: "2026-04-19T00:00:00Z",
        coverageReportsDir: coverageReportsDir2,
      })
      expect(resultB.report.overall).toBe(resultA.report.overall)
      expect(resultB.report.checks).toEqual(resultA.report.checks)
      expect(resultB.report.source_refs).toEqual(resultA.report.source_refs)
    } finally {
      await rm(workDir2, { recursive: true, force: true })
    }
  })
})
