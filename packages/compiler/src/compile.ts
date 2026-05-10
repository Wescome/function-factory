/**
 * Compile orchestrator- reads an Intent Specification file, runs the
 * transformation pipeline,
 * emits a Coherence Verification Verification Report, and returns the aggregate result.
 *
 * IO is confined to this module (reading the Intent Specification file, writing the
 * Verification Report via emitCoherenceVerificationReport). Each individual pass is pure;
 * the orchestrator composes them.
 *
 * Timestamp is generated here — the one ISO-8601 timestamp used for
 * both the Verification Report's `timestamp` field and its derived `id`
 * (via Coherence Verification's internal ID construction). This keeps
 * Coherence Verification itself pure while centralizing the clock
 * read in the orchestration layer per the intentSpecification-compiler SKILL's
 * "pure functions; side effects in named integration modules"
 * discipline.
 */

import { readFile } from "node:fs/promises"
import { dirname, resolve } from "node:path"
import type { ExecutableSpecification } from "@factory/schemas"
import type { CompileResult, FactoryMode } from "./types.js"
import {
  tuneInstructions,
  type InstructionTuningCompileOptions,
} from "./instruction-tuning.js"
import {
  assembleExecutableSpecification,
  consistencyCheck,
  deriveContracts,
  deriveDependencies,
  deriveInvariants,
  deriveValidations,
  determineMode,
  emitExecutableSpecification,
  extractAtoms,
  normalize,
  runCoherenceVerificationPass,
} from "./passes/index.js"

export interface CompileOptions {
  /** Override Factory mode. Default- derived from Intent Specification ID via determineMode. */
  readonly mode?: FactoryMode
  /** Destination directory for Verification Reports. Default- <repo>/specs/verification-reports. */
  readonly verificationReportsDir?: string
  /** Destination directory for Executable Specifications. Default- <repo>/specs/executable-specifications. */
  readonly executableSpecificationDir?: string
  /** ISO-8601 timestamp for the Verification Report. Default- current wall clock. */
  readonly timestamp?: string
  /** Optional Instruction Tuning input bundle. When present, emits or blocks a Trellis Execution Packet. */
  readonly instructionTuning?: InstructionTuningCompileOptions
}

export async function compile(
  intentSpecificationPath: string,
  options: CompileOptions = {}
): Promise<CompileResult> {
  const absoluteIntentSpecificationPath = resolve(intentSpecificationPath)
  const raw = await readFile(absoluteIntentSpecificationPath, "utf8")

  // Transformations 0-5 produce the intermediates bundle.
  const normalized = normalize(raw, absoluteIntentSpecificationPath)
  const atoms = extractAtoms(normalized)
  const contracts = deriveContracts(normalized, atoms)
  const invariants = deriveInvariants(normalized, atoms, contracts)
  const dependencies = deriveDependencies(normalized, atoms, contracts, invariants)
  const validations = deriveValidations(
    normalized,
    atoms,
    contracts,
    invariants,
    dependencies
  )

  const intermediates = {
    intentSpecification: normalized.draft,
    atoms,
    contracts,
    invariants,
    dependencies,
    validations,
  }

  // Completeness preflight slot (legacy Pass 6, MVP no-op).
  consistencyCheck(intermediates)

  // Completeness Certification / Coherence Verification (legacy Pass 7).
  const mode = options.mode ?? determineMode(normalized.draft.id)
  const timestamp = options.timestamp ?? new Date().toISOString()
  const verificationReportsDir =
    options.verificationReportsDir ?? defaultVerificationReportsDir(absoluteIntentSpecificationPath)

  const { report, reportPath } = await runCoherenceVerificationPass(
    intermediates,
    mode,
    timestamp,
    verificationReportsDir
  )

  // Executable Specification Assembly. The historical Pass 8 label names
  // structural assembly; ontology Pass 8 is future Instruction Tuning.
  // On failure, executableSpecification and executableSpecificationPath remain null; the orchestrator still
  // returns with the Verification Report preserved on disk per ConOps §7.2 step 2.
  let executableSpecification: ExecutableSpecification | null = null
  let executableSpecificationPath: string | null = null
  let instructionTuningResult: CompileResult["instructionTuningResult"] = null
  if (report.overall === "pass") {
    executableSpecification = assembleExecutableSpecification(
      normalized.draft,
      atoms,
      contracts,
      invariants,
      dependencies,
      validations,
      report
    )
    const executableSpecificationDir =
      options.executableSpecificationDir ?? defaultExecutableSpecificationsDir(absoluteIntentSpecificationPath)
    executableSpecificationPath = await emitExecutableSpecification(executableSpecification, executableSpecificationDir)
    if (options.instructionTuning) {
      instructionTuningResult = tuneInstructions({
        ...options.instructionTuning,
        executableSpecification,
        generatedAt: options.instructionTuning.generatedAt ?? timestamp,
      })
    }
  }

  return {
    report,
    reportPath,
    intermediates,
    mode,
    executableSpecification,
    executableSpecificationPath,
    instructionTuningResult,
  }
}

/**
 * Default Verification Report destination- resolves <repo-root>/specs/verification-reports
 * by walking up from the Intent Specification file. The Intent Specification is expected to live at
 * `<repo>/specs/intent-specifications/IS-*.md`, so two levels up from the Intent Specification is the
 * repo root.
 */
function defaultVerificationReportsDir(intentSpecificationAbsolutePath: string): string {
  const intentSpecificationsDir = dirname(intentSpecificationAbsolutePath)
  const specsDir = dirname(intentSpecificationsDir)
  return resolve(specsDir, "verification-reports")
}

/**
 * Default Executable Specification destination- resolves <repo-root>/specs/executable-specifications
 * by walking up from the Intent Specification file. Same walk logic as
 * defaultVerificationReportsDir.
 */
function defaultExecutableSpecificationsDir(intentSpecificationAbsolutePath: string): string {
  const intentSpecificationsDir = dirname(intentSpecificationAbsolutePath)
  const specsDir = dirname(intentSpecificationsDir)
  return resolve(specsDir, "executable-specifications")
}
