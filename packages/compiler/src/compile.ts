/**
 * Compile orchestrator- reads a PRD file, runs Passes 0–7 in order,
 * emits a Gate 1 Coverage Report, and returns the aggregate result.
 *
 * IO is confined to this module (reading the PRD file, writing the
 * Coverage Report via emitGate1Report). Each individual pass is pure;
 * the orchestrator composes them.
 *
 * Timestamp is generated here — the one ISO-8601 timestamp used for
 * both the Coverage Report's `timestamp` field and its derived `id`
 * (via Gate 1's internal ID construction). This keeps Gate 1 itself
 * pure (no new Date() inside runGate1) while centralizing the clock
 * read in the orchestration layer per the prd-compiler SKILL's
 * "pure functions; side effects in named integration modules"
 * discipline.
 */

import { readFile } from "node:fs/promises"
import { dirname, resolve } from "node:path"
import type { WorkGraph } from "@factory/schemas"
import type { CompileResult, FactoryMode } from "./types.js"
import {
  assembleWorkgraph,
  consistencyCheck,
  deriveContracts,
  deriveDependencies,
  deriveInvariants,
  deriveValidations,
  determineMode,
  emitWorkgraph,
  extractAtoms,
  normalize,
  runGate1Pass,
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

  // Passes 0–5- produce the intermediates bundle.
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

  // Pass 6- consistency check (MVP no-op).
  consistencyCheck(intermediates)

  // Pass 7- Gate 1.
  const mode = options.mode ?? determineMode(normalized.draft.id)
  const timestamp = options.timestamp ?? new Date().toISOString()
  const coverageReportsDir =
    options.coverageReportsDir ?? defaultCoverageReportsDir(absolutePrdPath)

  const { report, reportPath } = await runGate1Pass(
    intermediates,
    mode,
    timestamp,
    coverageReportsDir
  )

  // Pass 8- assemble WorkGraph from validated intermediates if Gate 1
  // passed. On Gate 1 fail, workgraph and workgraphPath remain null;
  // the orchestrator still returns with the Coverage Report preserved
  // on disk per ConOps §7.2 step 2.
  let workgraph: WorkGraph | null = null
  let workgraphPath: string | null = null
  if (report.overall === "pass") {
    workgraph = assembleWorkgraph(
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
