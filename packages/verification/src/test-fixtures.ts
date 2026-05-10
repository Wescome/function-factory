/**
 * Factory functions for constructing valid Factory artifacts for tests.
 *
 * Each factory returns a minimum-valid artifact with sensible defaults;
 * overrides merge on top. IDs are typed as the branded ArtifactId via
 * cast — tests are responsible for passing valid ID strings matching
 * the lineage.ts regex (`<PREFIX>-[A-Z0-9][A-Z0-9-]*`).
 */

import type {
  RequirementAtom,
  Contract,
  Invariant,
  Dependency,
  ValidationSpec,
  DetectorSpec,
  ArtifactId,
} from "@factory/schemas"

export function makeAtom(
  id: string,
  overrides: Partial<RequirementAtom> = {}
): RequirementAtom {
  return {
    id: id as ArtifactId,
    source_refs: [],
    explicitness: "explicit",
    rationale: "test fixture",
    category: "business_rule",
    subject: "test subject",
    action: "test action",
    object: "test object",
    conditions: [],
    qualifiers: [],
    successCondition: null,
    ...overrides,
  }
}

export function makeContract(
  id: string,
  derivedFromAtomIds: string[],
  overrides: Partial<Contract> = {}
): Contract {
  return {
    id: id as ArtifactId,
    source_refs: derivedFromAtomIds as ArtifactId[],
    explicitness: "explicit",
    rationale: "test fixture",
    kind: "behavior",
    statement: "test contract statement",
    producerHint: null,
    consumerHints: [],
    derivedFromAtomIds: derivedFromAtomIds as ArtifactId[],
    ...overrides,
  }
}

export function makeDetector(
  overrides: Partial<DetectorSpec> = {}
): DetectorSpec {
  return {
    name: "test_detector",
    evidence_sources: ["telemetry.test"],
    direct_rules: ["count(violation) > 0"],
    warning_rules: [],
    regression_policy: { direct_violation: "regressed" },
    incident_tags: [],
    ...overrides,
  }
}

export function makeInvariant(
  id: string,
  overrides: Partial<Invariant> = {}
): Invariant {
  return {
    id: id as ArtifactId,
    source_refs: [],
    explicitness: "explicit",
    rationale: "test fixture",
    scope: "workflow",
    statement: "test invariant",
    violationImpact: "medium",
    derivedFromAtomIds: [],
    derivedFromContractIds: [],
    detector: makeDetector(),
    ...overrides,
  }
}

export function makeDependency(
  id: string,
  from: string,
  to: string,
  overrides: Partial<Dependency> = {}
): Dependency {
  return {
    id: id as ArtifactId,
    source_refs: [],
    explicitness: "explicit",
    rationale: "test fixture",
    from: from as ArtifactId,
    to: to as ArtifactId,
    type: "implements",
    ...overrides,
  }
}

export function makeValidation(
  id: string,
  overrides: Partial<ValidationSpec> = {}
): ValidationSpec {
  return {
    id: id as ArtifactId,
    source_refs: [],
    explicitness: "explicit",
    rationale: "test fixture",
    kind: "unit",
    statement: "test validation",
    targetRefs: [],
    coversAtomIds: [],
    coversContractIds: [],
    coversInvariantIds: [],
    priority: "required",
    ...overrides,
  }
}
