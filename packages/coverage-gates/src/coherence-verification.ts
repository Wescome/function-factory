/**
 * Coherence Verification orchestrator- composes the five coverage checks,
 * assembles a CoherenceVerificationReport conforming to the Zod schema, and validates the output
 * before returning.
 *
 * Pure function with no side effects. File emission is handled by
 * `emitCoherenceVerificationReport` in emit.ts so the core logic stays testable with
 * synchronous inputs and outputs.
 *
 * Determinism- identical validated inputs produce byte-identical
 * CoherenceVerificationReport contents modulo the `id` (timestamp-suffixed) and
 * `timestamp` fields. This is load-bearing for audit per PRD
 * acceptance criterion 11 and ConOps §3.4.
 */

import type { ArtifactId, CoherenceVerificationReport } from "@factory/schemas"
import { CoherenceVerificationReport as CoherenceVerificationReportSchema } from "@factory/schemas"
import {
  type CoherenceVerificationInput,
  checkAtomCoverage,
  checkInvariantCoverage,
  checkValidationCoverage,
  checkDependencyClosure,
  checkBootstrapPrefix,
} from "./checks.js"
import { generateRemediation } from "./remediation.js"

export type { CoherenceVerificationInput } from "./checks.js"
export type { CoherenceVerificationReport } from "@factory/schemas"

/**
 * Run Coherence Verification against validated compiler intermediates.
 *
 * @param input - Compiler intermediates plus PRD ID and Factory mode.
 * @param timestamp - ISO-8601 timestamp to embed in the report.
 *                    Caller owns timestamp generation to preserve purity
 *                    (Coherence Verification makes no `new Date()` calls).
 * @returns A CoherenceVerificationReport that passes CoherenceVerificationReport.safeParse.
 * @throws If the constructed report fails Zod validation, indicating a
 *         Coherence Verification implementation defect.
 */
export function runCoherenceVerification(
  input: CoherenceVerificationInput,
  timestamp: string,
): CoherenceVerificationReport {
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
    rationale: `Coherence Verification evaluation for ${input.prdId} in ${input.mode} mode`,
    verification: "coherence" as const,
    prd_id: input.prdId,
    timestamp,
    overall,
    checks,
    remediation,
  }

  const parsed = CoherenceVerificationReportSchema.safeParse(candidate)
  if (!parsed.success) {
    // Coherence Verification produced a report that does not conform to its own output
    // schema. This is an implementation defect, not a specification
    // defect; throwing here surfaces it loudly rather than letting a
    // malformed report propagate. Per Coherence Verification self-
    // rewrite hook, a recurring instance of this class of failure would
    // trigger skill revision.
    throw new Error(
      `Coherence Verification produced an invalid Coverage Report- ${parsed.error.message}`
    )
  }
  return parsed.data
}

/**
 * Construct the Coverage Report ID per the current persisted naming convention-
 * `CR-<PRD-ID>-GATE1-<timestamp>`, with colons and dots in the timestamp
 * replaced by hyphens so the result matches the ArtifactId regex.
 */
function coverageReportId(prdId: ArtifactId, timestamp: string): ArtifactId {
  const safeTs = timestamp.replace(/[:.]/g, "-")
  return `CR-${prdId}-GATE1-${safeTs}` as ArtifactId
}

type Checks = CoherenceVerificationReport["checks"]

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
