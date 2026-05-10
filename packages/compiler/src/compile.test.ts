/**
 * End-to-end compile test against the real IS-META-COHERENCE-VERIFICATION.md.
 *
 * This is the bootstrap proof- run the compiler against the first meta-Intent Specification,
 * assert that the pipeline produces a CoherenceVerificationReport on disk, and capture
 * whether that verdict is pass or fail. Either outcome is acceptable
 * for bootstrap- the artifact that matters is the Verification Report itself.
 */

import { describe, expect, it, beforeEach, afterEach } from "vitest"
import { mkdtemp, readFile, rm, writeFile, mkdir } from "node:fs/promises"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { parse as parseYaml } from "yaml"
import {
  CodingDomainAdapterContract,
  CodingTrellisRuntimeProfile,
  CoherenceVerificationReport,
  ExecutableSpecification,
} from "@factory/schemas"
import { compile } from "./compile.js"

// Path to the real meta-Intent Specification; resolved from the monorepo root.
// The test constructs a temporary workspace with the Intent Specification copied in
// so the test does not depend on the Intent Specification's actual filesystem location
// beyond what the harness copies over.
import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"

const THIS_DIR = dirname(fileURLToPath(import.meta.url))
// packages/compiler/src -> monorepo root is three dirs up
const MONOREPO_ROOT = join(THIS_DIR, "..", "..", "..")
const REAL_INTENT_SPECIFICATION_PATH = join(
  MONOREPO_ROOT,
  "specs",
  "intent-specifications",
  "IS-META-COHERENCE-VERIFICATION.md"
)

describe("compile- end-to-end against IS-META-COHERENCE-VERIFICATION", () => {
  let workDir: string
  let intentSpecificationPath: string
  let verificationReportsDir: string

  beforeEach(async () => {
    workDir = await mkdtemp(join(tmpdir(), "compile-e2e-"))
    const intentSpecificationsDir = join(workDir, "specs", "intent-specifications")
    await mkdir(intentSpecificationsDir, { recursive: true })
    intentSpecificationPath = join(intentSpecificationsDir, "IS-META-COHERENCE-VERIFICATION.md")
    // Read the real Intent Specification and copy it into the test workspace.
    const realIntentSpecificationContent = readFileSync(REAL_INTENT_SPECIFICATION_PATH, "utf8")
    await writeFile(intentSpecificationPath, realIntentSpecificationContent, "utf8")
    verificationReportsDir = join(workDir, "specs", "verification-reports")
  })

  afterEach(async () => {
    await rm(workDir, { recursive: true, force: true })
  })

  it("produces a CoherenceVerificationReport that validates against the Zod schema", async () => {
    const result = await compile(intentSpecificationPath, {
      timestamp: "2026-04-19T00:00:00Z",
      verificationReportsDir,
    })
    const parsed = CoherenceVerificationReport.safeParse(result.report)
    expect(parsed.success).toBe(true)
  })

  it("emits the Verification Report as YAML to the configured directory", async () => {
    const result = await compile(intentSpecificationPath, {
      timestamp: "2026-04-19T00:00:00Z",
      verificationReportsDir,
    })
    const onDisk = await readFile(result.reportPath, "utf8")
    expect(onDisk.length).toBeGreaterThan(0)
    const roundtrip = parseYaml(onDisk)
    expect(roundtrip.verification).toBe("coherence")
    expect(roundtrip.intent_specification_id).toBe("IS-META-COHERENCE-VERIFICATION")
  })

  it("compiles in bootstrap mode by default (IS-META- prefix)", async () => {
    const result = await compile(intentSpecificationPath, {
      timestamp: "2026-04-19T00:00:00Z",
      verificationReportsDir,
    })
    expect(result.mode).toBe("bootstrap")
    expect(result.report.checks.bootstrap_prefix_check).toBeDefined()
  })

  it("produces non-empty intermediates from Passes 1–5", async () => {
    const result = await compile(intentSpecificationPath, {
      timestamp: "2026-04-19T00:00:00Z",
      verificationReportsDir,
    })
    // Per Intent Specification structure- 15 AC + 5-8 constraints + 5 metrics ≈ 25-28 atoms
    expect(result.intermediates.atoms.length).toBeGreaterThanOrEqual(20)
    expect(result.intermediates.contracts.length).toBeGreaterThan(0)
    expect(result.intermediates.invariants.length).toBeGreaterThan(0)
    expect(result.intermediates.validations.length).toBeGreaterThan(0)
    // MVP emits no dependencies
    expect(result.intermediates.dependencies.length).toBe(0)
  })

  it("every invariant has ≥1 covering validation", async () => {
    const result = await compile(intentSpecificationPath, {
      timestamp: "2026-04-19T00:00:00Z",
      verificationReportsDir,
    })
    for (const inv of result.intermediates.invariants) {
      const covering = result.intermediates.validations.filter((v) =>
        v.coversInvariantIds.includes(inv.id)
      )
      expect(covering.length).toBeGreaterThanOrEqual(1)
    }
  })

  it("every atom is referenced by ≥1 downstream artifact", async () => {
    const result = await compile(intentSpecificationPath, {
      timestamp: "2026-04-19T00:00:00Z",
      verificationReportsDir,
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
    const result = await compile(intentSpecificationPath, {
      timestamp: "2026-04-19T00:00:00Z",
      verificationReportsDir,
    })
    expect(result.report.remediation.length).toBeGreaterThan(0)
  })

  it("is deterministic- two compiles with the same timestamp produce the same report", async () => {
    const resultA = await compile(intentSpecificationPath, {
      timestamp: "2026-04-19T00:00:00Z",
      verificationReportsDir,
    })
    // Second compile — force different workdir to avoid file collision
    const workDir2 = await mkdtemp(join(tmpdir(), "compile-e2e-"))
    try {
      const intentSpecificationsDir2 = join(workDir2, "specs", "intent-specifications")
      await mkdir(intentSpecificationsDir2, { recursive: true })
      const intentSpecificationPath2 = join(intentSpecificationsDir2, "IS-META-COHERENCE-VERIFICATION.md")
      await writeFile(intentSpecificationPath2, readFileSync(REAL_INTENT_SPECIFICATION_PATH, "utf8"), "utf8")
      const verificationReportsDir2 = join(workDir2, "specs", "verification-reports")
      const resultB = await compile(intentSpecificationPath2, {
        timestamp: "2026-04-19T00:00:00Z",
        verificationReportsDir: verificationReportsDir2,
      })
      expect(resultB.report.overall).toBe(resultA.report.overall)
      expect(resultB.report.checks).toEqual(resultA.report.checks)
      expect(resultB.report.source_refs).toEqual(resultA.report.source_refs)
      // Executable Specification Assembly determinism- Executable Specification deep-equal across compiles.
      expect(resultB.executableSpecification).toEqual(resultA.executableSpecification)
    } finally {
      await rm(workDir2, { recursive: true, force: true })
    }
  })

  it("Executable Specification Assembly emits an Executable Specification with ES-<Intent Specification subject> id on passing Coherence Verification", async () => {
    const result = await compile(intentSpecificationPath, {
      timestamp: "2026-04-19T00:00:00Z",
      verificationReportsDir,
    })
    expect(result.report.overall).toBe("pass")
    expect(result.executableSpecification).not.toBeNull()
    expect(result.executableSpecificationPath).not.toBeNull()
    expect(result.executableSpecification!.id).toBe("ES-META-COHERENCE-VERIFICATION")
    expect(result.executableSpecification!.functionId).toBe("FP-META-COHERENCE-VERIFICATION")
    expect(ExecutableSpecification.safeParse(result.executableSpecification).success).toBe(true)
  })

  it("Executable Specification Assembly ExecutableSpecification file on disk roundtrips through YAML", async () => {
    const result = await compile(intentSpecificationPath, {
      timestamp: "2026-04-19T00:00:00Z",
      verificationReportsDir,
    })
    expect(result.executableSpecificationPath).not.toBeNull()
    const onDisk = await readFile(result.executableSpecificationPath!, "utf8")
    expect(onDisk.length).toBeGreaterThan(0)
    const roundtrip = parseYaml(onDisk)
    expect(roundtrip.id).toBe(result.executableSpecification!.id)
    expect(roundtrip.functionId).toBe("FP-META-COHERENCE-VERIFICATION")
    expect(roundtrip.nodes.length).toBeGreaterThan(0)
  })

  it("Executable Specification Assembly ExecutableSpecification has non-empty nodes array (schema refinement)", async () => {
    const result = await compile(intentSpecificationPath, {
      timestamp: "2026-04-19T00:00:00Z",
      verificationReportsDir,
    })
    expect(result.executableSpecification!.nodes.length).toBeGreaterThanOrEqual(1)
  })

  it("runs Instruction Tuning when selected runtime inputs are supplied", async () => {
    const result = await compile(intentSpecificationPath, {
      timestamp: "2026-04-19T00:00:00Z",
      verificationReportsDir,
      instructionTuning: {
        selectedArchitectureCandidate: {
          id: "AC-META-COHERENCE-VERIFICATION",
          sourceIntentSpecificationId: "IS-META-COHERENCE-VERIFICATION",
          sourceExecutableSpecificationId: "ES-META-COHERENCE-VERIFICATION",
          candidateStatus: "selected",
          topology: {
            shape: "single_node",
            summary: "Fixture candidate for compiler Instruction Tuning.",
          },
          modelBinding: {
            bindingMode: "policy_selected",
            summary: "Runtime profile controls model binding.",
          },
          toolPolicy: {
            mode: "restricted",
            summary: "Packet tool policy controls access.",
          },
          convergencePolicy: {
            mode: "gated_iteration",
            summary: "Repairs are mediated by packet policy.",
          },
          source_refs: ["ES-META-COHERENCE-VERIFICATION"],
          explicitness: "explicit",
          rationale: "Test candidate.",
        },
        runtimeAdmission: {
          id: "RAD-META-COHERENCE-VERIFICATION",
          sourceExecutableSpecificationId: "ES-META-COHERENCE-VERIFICATION",
          sourceArchitectureCandidateId: "AC-META-COHERENCE-VERIFICATION",
          sourceSelectionId: "ACS-META-COHERENCE-VERIFICATION",
          decision: "allow",
          reason: "Fixture admission permits compiler packet generation.",
          source_refs: [
            "ES-META-COHERENCE-VERIFICATION",
            "AC-META-COHERENCE-VERIFICATION",
          ],
          explicitness: "explicit",
          rationale: "Test admission.",
        },
        domainAdapterContract: CodingDomainAdapterContract,
        runtimeProfile: CodingTrellisRuntimeProfile,
      },
    })

    expect(result.instructionTuningResult?.status).toBe("emitted")
    if (result.instructionTuningResult?.status !== "emitted") return
    expect(result.instructionTuningResult.packet.executableSpecificationId).toBe(
      result.executableSpecification!.id
    )
    expect(result.instructionTuningResult.packet.audit.packetHash).toBe(
      result.instructionTuningResult.packet.instructionTuning.outputPacketHash
    )
  })
})
