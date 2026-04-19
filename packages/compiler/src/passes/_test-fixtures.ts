/**
 * Test fixture factories for compiler-pass tests.
 *
 * Private to the passes/ directory (leading underscore). Produces
 * minimal schema-valid artifacts that Pass 8 (and future passes)
 * can be tested against without reaching for the full compile
 * pipeline.
 */

import type { z } from "zod"
import { DependencyType } from "@factory/schemas"
import type {
  ArtifactId,
  Contract,
  Dependency,
  DetectorSpec,
  Gate1Report,
  Invariant,
  PRDDraft,
  RequirementAtom,
  ValidationSpec,
} from "@factory/schemas"

type DependencyTypeT = z.infer<typeof DependencyType>

const defaultDetector: DetectorSpec = {
  name: "test_detector",
  evidence_sources: ["test.source"],
  direct_rules: ["test rule"],
  warning_rules: [],
  regression_policy: { direct_violation: "regressed" },
  incident_tags: ["test"],
}

export function makePRD(overrides: Partial<PRDDraft> = {}): PRDDraft {
  return {
    id: "PRD-META-FOO" as ArtifactId,
    source_refs: ["FP-META-FOO" as ArtifactId],
    explicitness: "explicit",
    rationale: "test PRD",
    sourceCapabilityId: "BC-META-FOO" as ArtifactId,
    sourceFunctionId: "FP-META-FOO" as ArtifactId,
    title: "Test PRD",
    problem: "test problem",
    goal: "test goal",
    constraints: ["c1"],
    acceptanceCriteria: ["ac1"],
    successMetrics: ["sm1"],
    outOfScope: [],
    ...overrides,
  }
}

export function makeAtom(overrides: Partial<RequirementAtom> = {}): RequirementAtom {
  return {
    id: "ATOM-META-FOO-01" as ArtifactId,
    source_refs: ["PRD-META-FOO" as ArtifactId],
    explicitness: "explicit",
    rationale: "test atom",
    category: "acceptance",
    subject: "test",
    action: "shall",
    object: "do something",
    ...overrides,
  } as RequirementAtom
}

export function makeContract(overrides: Partial<Contract> = {}): Contract {
  return {
    id: "CONTRACT-META-FOO-BEHAVIOR" as ArtifactId,
    source_refs: ["PRD-META-FOO" as ArtifactId],
    explicitness: "explicit",
    rationale: "test contract",
    kind: "behavior",
    statement: "test contract statement",
    producerHint: null,
    consumerHints: [],
    derivedFromAtomIds: ["ATOM-META-FOO-01" as ArtifactId],
    ...overrides,
  }
}

export function makeInvariant(
  overrides: Partial<Invariant> = {}
): Invariant {
  return {
    id: "INV-META-FOO-01" as ArtifactId,
    source_refs: ["PRD-META-FOO" as ArtifactId],
    explicitness: "explicit",
    rationale: "test invariant",
    scope: "workflow",
    statement: "test invariant statement",
    violationImpact: "high",
    derivedFromAtomIds: [],
    derivedFromContractIds: [],
    detector: defaultDetector,
    ...overrides,
  }
}

export function makeDependency(
  from: ArtifactId,
  to: ArtifactId,
  type: DependencyTypeT = "validates",
  id: ArtifactId = "DEP-META-FOO-01" as ArtifactId
): Dependency {
  return {
    id,
    source_refs: ["PRD-META-FOO" as ArtifactId],
    explicitness: "explicit",
    rationale: "test dependency",
    from,
    to,
    type,
  }
}

export function makeValidation(
  overrides: Partial<ValidationSpec> = {}
): ValidationSpec {
  return {
    id: "VAL-META-FOO-01" as ArtifactId,
    source_refs: ["PRD-META-FOO" as ArtifactId],
    explicitness: "explicit",
    rationale: "test validation",
    kind: "unit",
    statement: "test validation statement",
    targetRefs: [],
    coversAtomIds: [],
    coversContractIds: [],
    coversInvariantIds: [],
    priority: "required",
    ...overrides,
  }
}

export function makeGate1ReportPassing(
  overrides: Partial<Gate1Report> = {}
): Gate1Report {
  return {
    id: "CR-PRD-META-FOO-GATE1-2026-04-19T00-00-00-000Z" as ArtifactId,
    source_refs: ["PRD-META-FOO" as ArtifactId],
    explicitness: "explicit",
    rationale: "test coverage report",
    gate: 1,
    prd_id: "PRD-META-FOO" as ArtifactId,
    timestamp: "2026-04-19T00:00:00.000Z",
    overall: "pass",
    checks: {
      atom_coverage: { status: "pass", details: [], orphan_atoms: [] },
      invariant_coverage: {
        status: "pass",
        details: [],
        invariants_missing_validation: [],
        invariants_missing_detector: [],
      },
      validation_coverage: {
        status: "pass",
        details: [],
        validations_covering_nothing: [],
      },
      dependency_closure: {
        status: "pass",
        details: [],
        dangling_dependencies: [],
      },
    },
    remediation: "no remediation required",
    ...overrides,
  }
}
