/**
 * Compile orchestrator- reads a PRD file, runs the compatibility pass pipeline,
 * emits a Coherence Verification Coverage Report, and returns the aggregate result.
 *
 * IO is confined to this module (reading the PRD file, writing the
 * Coverage Report via emitCoherenceVerificationReport). Each individual pass is pure;
 * the orchestrator composes them.
 *
 * Timestamp is generated here — the one ISO-8601 timestamp used for
 * both the Coverage Report's `timestamp` field and its derived `id`
 * (via Coherence Verification's internal ID construction). This keeps
 * Coherence Verification itself pure while centralizing the clock
 * read in the orchestration layer per the prd-compiler SKILL's
 * "pure functions; side effects in named integration modules"
 * discipline.
 */

import { readFile } from "node:fs/promises"
import { dirname, resolve } from "node:path"
import type { WorkGraph } from "@factory/schemas"
import type { CompileResult, FactoryMode } from "./types.js"
import {
  assembleExecutableSpecification,
  consistencyCheck,
  deriveContracts,
  deriveDependencies,
  deriveInvariants,
  deriveValidations,
  determineMode,
  emitWorkgraph,
  extractAtoms,
  normalize,
  runCoherenceVerificationPass,
} from "./passes/index.js"

export interface CompileOptions {
  /** Override Factory mode. Default- derived from PRD ID via determineMode. */
  readonly mode?: FactoryMode
  /** Destination directory for Coverage Reports. Default- <repo>/specs/coverage-reports. */
  readonly coverageReportsDir?: string
  /** Destination directory for WorkGraphs. Default- <repo>/specs/workgraphs. */
  readonly workgraphsDir?: string
  /** ISO-8601 timestamp for the Coverage Report. Default- current wall clock. */
  readonly timestamp?: string
}

export async function compile(
  prdPath: string,
  options: CompileOptions = {}
): Promise<CompileResult> {
  const absolutePrdPath = resolve(prdPath)
  const raw = await readFile(absolutePrdPath, "utf8")

  // Compatibility passes 0-5 produce the intermediates bundle.
  const normalized = normalize(raw, absolutePrdPath)
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
    prd: normalized.draft,
    atoms,
    contracts,
    invariants,
    dependencies,
    validations,
  }

  // Completeness preflight compatibility slot (legacy Pass 6, MVP no-op).
  consistencyCheck(intermediates)

  // Completeness Certification / Coherence Verification (legacy Pass 7).
  const mode = options.mode ?? determineMode(normalized.draft.id)
  const timestamp = options.timestamp ?? new Date().toISOString()
  const coverageReportsDir =
    options.coverageReportsDir ?? defaultCoverageReportsDir(absolutePrdPath)

  const { report, reportPath } = await runCoherenceVerificationPass(
    intermediates,
    mode,
    timestamp,
    coverageReportsDir
  )

  // Executable Specification Assembly. The historical compatibility label is
  // "Pass 8 assemble WorkGraph"; ontology Pass 8 is future Instruction Tuning.
  // On failure, workgraph and workgraphPath remain null; the orchestrator still
  // returns with the Coverage Report preserved on disk per ConOps §7.2 step 2.
  let workgraph: WorkGraph | null = null
  let workgraphPath: string | null = null
  if (report.overall === "pass") {
    workgraph = assembleExecutableSpecification(
      normalized.draft,
      atoms,
      contracts,
      invariants,
      dependencies,
      validations,
      report
    )
    const workgraphsDir =
      options.workgraphsDir ?? defaultWorkgraphsDir(absolutePrdPath)
    workgraphPath = await emitWorkgraph(workgraph, workgraphsDir)
  }

  return {
    report,
    reportPath,
    intermediates,
    mode,
    workgraph,
    workgraphPath,
  }
}

/**
 * Default Coverage Report destination- resolves <repo-root>/specs/coverage-reports
 * by walking up from the PRD file. The PRD is expected to live at
 * `<repo>/specs/prds/PRD-*.md`, so two levels up from the PRD is the
 * repo root.
 */
function defaultCoverageReportsDir(prdAbsolutePath: string): string {
  const prdsDir = dirname(prdAbsolutePath)
  const specsDir = dirname(prdsDir)
  return resolve(specsDir, "coverage-reports")
}

/**
 * Default WorkGraph destination- resolves <repo-root>/specs/workgraphs
 * by walking up from the PRD file. Same walk logic as
 * defaultCoverageReportsDir.
 */
function defaultWorkgraphsDir(prdAbsolutePath: string): string {
  const prdsDir = dirname(prdAbsolutePath)
  const specsDir = dirname(prdsDir)
  return resolve(specsDir, "workgraphs")
}
