/**
 * Remediation text generation for Gate 1 Coverage Reports.
 *
 * Per PRD-META-GATE-1-COMPILE-COVERAGE acceptance criterion 14- on pass,
 * remediation is the literal string "no remediation required". On fail,
 * remediation names each failing check, the specific artifact IDs that
 * failed, and the upstream remediation per ConOps §7.2 Scenario B.
 */

import type { Gate1Report } from "@factory/schemas"

type Checks = Gate1Report["checks"]
type Overall = Gate1Report["overall"]

export function generateRemediation(checks: Checks, overall: Overall): string {
  if (overall === "pass") return "no remediation required"

  const sections: string[] = []

  if (checks.atom_coverage.status === "fail") {
    const ids = checks.atom_coverage.orphan_atoms
    sections.push(
      `Atom coverage- ${plural(ids.length, "orphan atom")} (${ids.join(", ")}). ` +
        `Per ConOps §7.2 Scenario B step 3- either add a downstream Contract, ` +
        `Invariant, or ValidationSpec that references each atom, or move the ` +
        `atom(s) to the PRD's outOfScope list with rationale.`
    )
  }

  if (checks.invariant_coverage.status === "fail") {
    const missingV = checks.invariant_coverage.invariants_missing_validation
    const missingD = checks.invariant_coverage.invariants_missing_detector
    if (missingV.length > 0) {
      sections.push(
        `Invariant coverage (missing validation)- ${plural(
          missingV.length,
          "invariant"
        )} (${missingV.join(", ")}). Per ConOps §7.2 Scenario B step 4- ` +
          `author a ValidationSpec whose coversInvariantIds contains each ID. ` +
          `The invariant-authoring skill governs the work.`
      )
    }
    if (missingD.length > 0) {
      sections.push(
        `Invariant coverage (missing detector)- ${plural(
          missingD.length,
          "invariant"
        )} (${missingD.join(", ")}). Per ConOps §7.2 Scenario B step 5- ` +
          `author a well-formed DetectorSpec with named evidence_sources, ` +
          `non-empty direct_rules, and populated regression_policy. If the ` +
          `evidence source does not yet exist, remediation is upstream at the ` +
          `telemetry/audit layer, not at the PRD layer.`
      )
    }
  }

  if (checks.validation_coverage.status === "fail") {
    const ids = checks.validation_coverage.validations_covering_nothing
    sections.push(
      `Validation coverage- ${plural(ids.length, "dead validation")} ` +
        `(${ids.join(", ")}). Per ConOps §7.2 Scenario B step 6- either ` +
        `backmap each validation to ≥1 atom, contract, or invariant via ` +
        `coversAtomIds / coversContractIds / coversInvariantIds, or remove ` +
        `the validation if redundant.`
    )
  }

  if (checks.dependency_closure.status === "fail") {
    const ids = checks.dependency_closure.dangling_dependencies
    sections.push(
      `Dependency closure- ${plural(ids.length, "dangling dependency", "dangling dependencies")} ` +
        `(${ids.join(", ")}). Per ConOps §7.2 Scenario B step 7- resolve ` +
        `each endpoint by adding the missing artifact or removing the ` +
        `dependency if spurious.`
    )
  }

  if (checks.bootstrap_prefix_check?.status === "fail") {
    const ids = checks.bootstrap_prefix_check.non_meta_artifact_ids
    sections.push(
      `Bootstrap prefix check- ${plural(ids.length, "non-META artifact ID")} ` +
        `(${ids.join(", ")}). Per ConOps §4.1 Rule 2- re-prefix each artifact ` +
        `ID with META- (e.g., ATOM-FOO → ATOM-META-FOO), or hold the PRD ` +
        `until the Bootstrap → Steady-State transition per ConOps §11.`
    )
  }

  return sections.join("\n\n")
}

function plural(n: number, singular: string, pluralForm?: string): string {
  const form = n === 1 ? singular : pluralForm ?? `${singular}s`
  return `${n} ${form}`
}
