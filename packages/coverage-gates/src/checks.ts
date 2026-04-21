/**
 * The five coverage checks Gate 1 performs on compiler intermediates.
 *
 * Each check is a pure function taking the full Gate 1 input bundle and
 * returning a structured result. No IO, no mutation of inputs, no
 * external state. Determinism is preserved by sorting ID arrays before
 * emission — identical inputs produce byte-identical outputs.
 *
 * The first four checks run in both Bootstrap and Steady-State modes.
 * The fifth (bootstrap_prefix_check) runs only in Bootstrap mode per
 * ConOps §4.1 Rule 2.
 */

import type {
  ArtifactId,
  FactoryMode,
  Gate1Report,
  RequirementAtom,
  Contract,
  Invariant,
  Dependency,
  ValidationSpec,
} from "@factory/schemas"
import { DetectorSpec } from "@factory/schemas"

/**
 * Union of every artifact type that can appear as a reference endpoint
 * in compiler intermediates. The Bootstrap prefix check walks these.
 */
export interface Gate1Input {
  readonly prdId: ArtifactId
  readonly mode: FactoryMode
  readonly atoms: readonly RequirementAtom[]
  readonly contracts: readonly Contract[]
  readonly invariants: readonly Invariant[]
  readonly dependencies: readonly Dependency[]
  readonly validations: readonly ValidationSpec[]
}

type Checks = Gate1Report["checks"]
type AtomCoverageResult = Checks["atom_coverage"]
type InvariantCoverageResult = Checks["invariant_coverage"]
type ValidationCoverageResult = Checks["validation_coverage"]
type DependencyClosureResult = Checks["dependency_closure"]
type BootstrapPrefixCheckResult = NonNullable<Checks["bootstrap_prefix_check"]>

// Regex matching valid ArtifactId with META- qualifier- e.g., ATOM-META-FOO,
// INV-META-BAR. The prefix list mirrors the ArtifactId regex in lineage.ts.
// LINEAGE: the prefix alternation in this regex must stay in sync with
// the ArtifactId prefix alternation in packages/schemas/src/lineage.ts.
// Any change to one requires a matching change to the other in the same PR.
const META_PREFIX_REGEX =
  /^(PRS|BC|FN|CONTRACT|FP|PRD|WG|INV|VAL|DEP|ATOM|CR|CTR|TRJ|PF|INC|DET|DEL|SIG|RGD)-META-/

/**
 * Check 1- every RequirementAtom is referenced by ≥1 downstream artifact.
 * Downstream means a Contract, Invariant, or ValidationSpec whose
 * source_refs, derivedFromAtomIds, or coversAtomIds contains the atom's ID.
 */
export function checkAtomCoverage(input: Gate1Input): AtomCoverageResult {
  const referenced = new Set<string>()
  for (const c of input.contracts) {
    for (const id of c.source_refs) referenced.add(id)
    for (const id of c.derivedFromAtomIds) referenced.add(id)
  }
  for (const i of input.invariants) {
    for (const id of i.source_refs) referenced.add(id)
    for (const id of i.derivedFromAtomIds) referenced.add(id)
  }
  for (const v of input.validations) {
    for (const id of v.source_refs) referenced.add(id)
    for (const id of v.coversAtomIds) referenced.add(id)
  }

  const orphans: ArtifactId[] = []
  for (const a of input.atoms) {
    if (!referenced.has(a.id)) orphans.push(a.id)
  }
  orphans.sort()

  return {
    status: orphans.length === 0 ? "pass" : "fail",
    details: [],
    orphan_atoms: orphans,
  }
}

/**
 * Check 2- every Invariant has both ≥1 covering ValidationSpec and a
 * well-formed DetectorSpec. Detector well-formedness is verified by
 * re-parsing the detector against the Zod schema — a defensive check
 * that catches cases where malformed detectors somehow reached Gate 1
 * despite earlier-pass validation.
 */
export function checkInvariantCoverage(
  input: Gate1Input
): InvariantCoverageResult {
  const missingValidation: ArtifactId[] = []
  const missingDetector: ArtifactId[] = []

  for (const inv of input.invariants) {
    const hasValidation = input.validations.some((v) =>
      v.coversInvariantIds.includes(inv.id)
    )
    if (!hasValidation) missingValidation.push(inv.id)

    const detectorResult = DetectorSpec.safeParse(inv.detector)
    if (!detectorResult.success) missingDetector.push(inv.id)
  }

  missingValidation.sort()
  missingDetector.sort()

  const pass = missingValidation.length === 0 && missingDetector.length === 0
  return {
    status: pass ? "pass" : "fail",
    details: [],
    invariants_missing_validation: missingValidation,
    invariants_missing_detector: missingDetector,
  }
}

/**
 * Check 3- every ValidationSpec covers ≥1 atom, contract, or invariant.
 * A validation whose covers* arrays are all empty is a dead test.
 */
export function checkValidationCoverage(
  input: Gate1Input
): ValidationCoverageResult {
  const dead: ArtifactId[] = []
  for (const v of input.validations) {
    const total =
      v.coversAtomIds.length +
      v.coversContractIds.length +
      v.coversInvariantIds.length
    if (total === 0) dead.push(v.id)
  }
  dead.sort()

  return {
    status: dead.length === 0 ? "pass" : "fail",
    details: [],
    validations_covering_nothing: dead,
  }
}

/**
 * Check 4- every Dependency's from and to resolve to an artifact ID
 * present in the compiler intermediates. Dangling endpoints mean the
 * assurance graph is incomplete.
 */
export function checkDependencyClosure(
  input: Gate1Input
): DependencyClosureResult {
  const known = new Set<string>()
  for (const a of input.atoms) known.add(a.id)
  for (const c of input.contracts) known.add(c.id)
  for (const i of input.invariants) known.add(i.id)
  for (const d of input.dependencies) known.add(d.id)
  for (const v of input.validations) known.add(v.id)

  const dangling: ArtifactId[] = []
  for (const dep of input.dependencies) {
    if (!known.has(dep.from) || !known.has(dep.to)) dangling.push(dep.id)
  }
  dangling.sort()

  return {
    status: dangling.length === 0 ? "pass" : "fail",
    details: [],
    dangling_dependencies: dangling,
  }
}

/**
 * Check 5 (Bootstrap mode only)- every artifact ID referenced anywhere
 * in the compiler intermediates carries the META- qualifier after its
 * type prefix. Enforces ConOps §4.1 Rule 2 at compile time.
 *
 * Walks the PRD ID, every artifact's own ID, and every ID nested inside
 * source_refs, derivedFromAtomIds, derivedFromContractIds, coversAtomIds,
 * coversContractIds, coversInvariantIds, targetRefs, from, to, and any
 * optional functionId references on Invariants.
 */
export function checkBootstrapPrefix(
  input: Gate1Input
): BootstrapPrefixCheckResult {
  const seen = new Set<string>()

  const check = (id: string): void => {
    if (!META_PREFIX_REGEX.test(id)) seen.add(id)
  }

  check(input.prdId)

  for (const a of input.atoms) {
    check(a.id)
    for (const ref of a.source_refs) check(ref)
  }
  for (const c of input.contracts) {
    check(c.id)
    for (const ref of c.source_refs) check(ref)
    for (const ref of c.derivedFromAtomIds) check(ref)
  }
  for (const i of input.invariants) {
    check(i.id)
    for (const ref of i.source_refs) check(ref)
    if (i.functionId !== undefined) check(i.functionId)
    for (const ref of i.derivedFromAtomIds) check(ref)
    for (const ref of i.derivedFromContractIds) check(ref)
  }
  for (const d of input.dependencies) {
    check(d.id)
    for (const ref of d.source_refs) check(ref)
    check(d.from)
    check(d.to)
  }
  for (const v of input.validations) {
    check(v.id)
    for (const ref of v.source_refs) check(ref)
    for (const ref of v.targetRefs) check(ref)
    for (const ref of v.coversAtomIds) check(ref)
    for (const ref of v.coversContractIds) check(ref)
    for (const ref of v.coversInvariantIds) check(ref)
  }

  const nonMeta = Array.from(seen).sort() as ArtifactId[]

  return {
    status: nonMeta.length === 0 ? "pass" : "fail",
    details: [],
    non_meta_artifact_ids: nonMeta,
  }
}
