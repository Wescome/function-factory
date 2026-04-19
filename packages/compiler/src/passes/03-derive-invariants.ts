/**
 * Pass 3- derive invariants.
 *
 * Each constraint-category atom that expresses a persistent property
 * (rather than a one-shot requirement) becomes an Invariant with a
 * DetectorSpec. The MVP uses a small set of hand-crafted invariant
 * templates keyed to phrase patterns that commonly appear in Factory
 * PRD constraint sections- determinism, fail-closed discipline,
 * lineage preservation, emission on every invocation.
 *
 * For atoms that do not match any template, no invariant is emitted
 * from that atom. The remaining invariants are still coverage-complete
 * via the constraint-category Contract from Pass 2; the atom is
 * "covered" without needing an invariant derived from it specifically.
 *
 * Invariant ID prefix- INV-, refined by the Invariant schema.
 */

import type {
  ArtifactId,
  Contract,
  DetectorSpec,
  Invariant,
  RequirementAtom,
} from "@factory/schemas"
import type { NormalizedPRD } from "../types.js"

interface InvariantTemplate {
  readonly tag: string
  readonly matches: (atom: RequirementAtom) => boolean
  readonly statement: string
  readonly detector: DetectorSpec
  readonly violationImpact: Invariant["violationImpact"]
}

const TEMPLATES: readonly InvariantTemplate[] = [
  {
    tag: "DETERMINISM",
    matches: (a) => /determinis|byte-identic/i.test(a.object),
    statement:
      "Gate 1 produces byte-identical Gate1Report contents for identical validated inputs modulo id and timestamp",
    detector: {
      name: "gate_1_determinism_detector",
      evidence_sources: ["build.test_output", "ci.regression_replay"],
      direct_rules: [
        "golden test mismatch between two runs of the same fixture",
      ],
      warning_rules: [],
      regression_policy: { direct_violation: "regressed" },
      incident_tags: ["determinism", "audit"],
    },
    violationImpact: "high",
  },
  {
    tag: "FAIL-CLOSED",
    matches: (a) =>
      /fail.?closed|partial pass is fail|soft.?warning/i.test(a.object),
    statement:
      "Gate 1 emits overall=fail whenever any active coverage check fails; there is no soft-warning mode",
    detector: {
      name: "gate_1_fail_closed_detector",
      evidence_sources: ["build.test_output"],
      direct_rules: [
        "Gate1Report with overall=pass and any check.status=fail",
      ],
      warning_rules: [],
      regression_policy: { direct_violation: "regressed" },
      incident_tags: ["fail_closed", "discipline"],
    },
    violationImpact: "high",
  },
  {
    tag: "LINEAGE",
    matches: (a) => /lineage|source_refs|rationale/i.test(a.object),
    statement:
      "Every Gate1Report's source_refs cites the PRD ID and every artifact ID referenced in failing check detail arrays",
    detector: {
      name: "gate_1_lineage_detector",
      evidence_sources: ["build.test_output", "audit.coverage_report_scan"],
      direct_rules: [
        "Gate1Report whose source_refs omits the compiled PRD ID",
        "Gate1Report whose source_refs omits a flagged artifact ID present in a failing check's detail array",
      ],
      warning_rules: [],
      regression_policy: { direct_violation: "regressed" },
      incident_tags: ["lineage", "audit"],
    },
    violationImpact: "high",
  },
  {
    tag: "EMISSION",
    matches: (a) =>
      /emit|emission|writes.+report|coverage report.+disk/i.test(a.object),
    statement:
      "Gate 1 writes a Coverage Report to specs/coverage-reports/ on every invocation, pass or fail, before returning control",
    detector: {
      name: "gate_1_emission_detector",
      evidence_sources: ["build.test_output", "ci.filesystem_snapshot"],
      direct_rules: [
        "Gate 1 invocation where coverage-reports directory contains no matching file after return",
      ],
      warning_rules: [],
      regression_policy: { direct_violation: "regressed" },
      incident_tags: ["emission", "audit"],
    },
    violationImpact: "medium",
  },
]

export function deriveInvariants(
  normalized: NormalizedPRD,
  atoms: readonly RequirementAtom[],
  contracts: readonly Contract[]
): Invariant[] {
  const { draft } = normalized
  const subject = draft.id.replace(/^PRD-/, "")
  const invariants: Invariant[] = []
  const emittedTags = new Set<string>()

  // The constraint-category Contract collects all constraint atoms;
  // link invariants to it for derivedFromContractIds.
  const constraintContract = contracts.find(
    (c) => c.id === `FN-${subject}-CONTRACT-CONSTRAINT`
  )
  const constraintContractIds: ArtifactId[] =
    constraintContract !== undefined ? [constraintContract.id] : []

  for (const atom of atoms) {
    if (atom.category !== "constraint") continue
    for (const template of TEMPLATES) {
      if (emittedTags.has(template.tag)) continue
      if (!template.matches(atom)) continue
      invariants.push({
        id: `INV-${subject}-${template.tag}` as ArtifactId,
        source_refs: [atom.id, draft.id],
        explicitness: "explicit",
        rationale: `Derived from constraint atom ${atom.id} matching template ${template.tag}`,
        scope: "workflow",
        statement: template.statement,
        violationImpact: template.violationImpact,
        derivedFromAtomIds: [atom.id],
        derivedFromContractIds: constraintContractIds,
        detector: template.detector,
      })
      emittedTags.add(template.tag)
    }
  }

  // Deterministic ordering- by id
  invariants.sort((a, b) => a.id.localeCompare(b.id))
  return invariants
}
