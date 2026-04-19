/**
 * Gate 1 orchestrator- composes the five coverage checks, assembles a
 * Gate1Report conforming to the Zod schema, and validates the output
 * before returning.
 *
 * Pure function with no side effects. File emission is handled by
 * `emitGate1Report` in emit.ts so the core logic stays testable with
 * synchronous inputs and outputs.
 *
 * Determinism- identical validated inputs produce byte-identical
 * Gate1Report contents modulo the `id` (timestamp-suffixed) and
 * `timestamp` fields. This is load-bearing for audit per PRD
 * acceptance criterion 11 and ConOps §3.4.
 */

import type { ArtifactId, Gate1Report as Gate1ReportType } from "@factory/schemas"
import { Gate1Report } from "@factory/schemas"
import {
  type Gate1Input,
  checkAtomCoverage,
  checkInvariantCoverage,
  checkValidationCoverage,
  checkDependencyClosure,
  checkBootstrapPrefix,
} from "./checks.js"
import { generateRemediation } from "./remediation.js"

export type { Gate1Input } from "./checks.js"

/**
 * Run Gate 1 against validated compiler intermediates.
 *
 * @param input - Compiler intermediates plus PRD ID and Factory mode.
 * @param timestamp - ISO-8601 timestamp to embed in the report.
 *                    Caller owns timestamp generation to preserve purity
 *                    (Gate 1 makes no `new Date()` calls).
 * @returns A Gate1Report that passes Gate1Report.safeParse.
 * @throws If the constructed report fails Zod validation, indicating a
 *         Gate 1 implementation defect.
 */
export function runGate1(input: Gate1Input, timestamp: string): Gate1ReportType {
  const atomCoverage = checkAtomCoverage(input)
  const invariantCoverage = checkInvariantCoverage(input)
  const validationCoverage = checkValidationCoverage(input)
  const dependencyClosure = checkDependencyClosure(input)
  const bootstrapPrefixCheck =
    input.mode === "bootstrap" ? checkBootstrapPrefix(input) : undefined

  const checks = {
    atom_coverage: atomCoverage,
    invariant_coverage: invariantCoverage,
    validation_coverage: validationCoverage,
    dependency_closure: dependencyClosure,
    ...(bootstrapPrefixCheck !== undefined && {
      bootstrap_prefix_check: bootstrapPrefixCheck,
    }),
  }

  const overall = allChecksPass(checks) ? "pass" : "fail"
  const remediation = generateRemediation(checks, overall)

  // source_refs on the Coverage Report- PRD compiled plus every failing
  // artifact ID across all checks. Sorted for determinism.
  const refs = new Set<ArtifactId>([input.prdId])
  for (const id of atomCoverage.orphan_atoms) refs.add(id)
  for (const id of invariantCoverage.invariants_missing_validation) refs.add(id)
  for (const id of invariantCoverage.invariants_missing_detector) refs.add(id)
  for (const id of validationCoverage.validations_covering_nothing) refs.add(id)
  for (const id of dependencyClosure.dangling_dependencies) refs.add(id)
  if (bootstrapPrefixCheck !== undefined) {
    for (const id of bootstrapPrefixCheck.non_meta_artifact_ids) refs.add(id)
  }
  const sourceRefs = Array.from(refs).sort() as ArtifactId[]

  const candidate = {
    id: coverageReportId(input.prdId, timestamp),
    source_refs: sourceRefs,
    explicitness: "explicit" as const,
    rationale: `Gate 1 compile coverage evaluation for ${input.prdId} in ${input.mode} mode`,
    gate: 1 as const,
    prd_id: input.prdId,
    timestamp,
    overall,
    checks,
    remediation,
  }

  const parsed = Gate1Report.safeParse(candidate)
  if (!parsed.success) {
    // Gate 1 produced a report that does not conform to its own output
    // schema. This is an implementation defect, not a specification
    // defect; throwing here surfaces it loudly rather than letting a
    // malformed report propagate. Per coverage-gate-1 SKILL.md self-
    // rewrite hook, a recurring instance of this class of failure would
    // trigger skill revision.
    throw new Error(
      `Gate 1 produced an invalid Coverage Report- ${parsed.error.message}`
    )
  }
  return parsed.data
}

/**
 * Construct the Coverage Report ID per the SKILL.md naming convention-
 * `CR-<PRD-ID>-GATE1-<timestamp>`, with colons and dots in the timestamp
 * replaced by hyphens so the result matches the ArtifactId regex.
 */
function coverageReportId(prdId: ArtifactId, timestamp: string): ArtifactId {
  const safeTs = timestamp.replace(/[:.]/g, "-")
  return `CR-${prdId}-GATE1-${safeTs}` as ArtifactId
}

type Checks = Gate1ReportType["checks"]

function allChecksPass(checks: Checks): boolean {
  if (checks.atom_coverage.status !== "pass") return false
  if (checks.invariant_coverage.status !== "pass") return false
  if (checks.validation_coverage.status !== "pass") return false
  if (checks.dependency_closure.status !== "pass") return false
  if (
    checks.bootstrap_prefix_check !== undefined &&
    checks.bootstrap_prefix_check.status !== "pass"
  ) {
    return false
  }
  return true
}
