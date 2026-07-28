/**
 * Phase 6a freeze gate — the safety-critical core of spec-loop automation.
 * Pure, substrate-free (D6). Every check here was spiked before the 6a freeze.
 *
 * A derived spec is a PROPOSAL. The gate decides its fate structurally:
 *  - attenuation (INV-SPEC-ATTENUATED): authority can only shrink vs the parent.
 *  - prohibition inheritance (INV-SPEC-INTENT-ANCHORED, negative half): the root's
 *    forbidden set can only grow — catches intent drift structurally.
 *  - reversibility tier: autonomous effectful reach needs a human (INV-SPEC-DERIVED-GATED).
 *  - well-formedness + goal-clause mapping: positive-serve stays a HUMAN judgment,
 *    made inspectable by the mandatory mapping (never auto-certified).
 * All checks are set-inclusion → transitive → a human-authorized root bounds the
 * whole derivation tree (INV-SPEC-HUMAN-ROOT).
 */
import type { SpecificationContent, AcceptanceCriterion, PropertyFamily } from "../lineage/nodes";
import type { BehaviorDisposition } from "../disposition/ledger";
import { clauseIds } from "./coverage";

export type GateTier = "auto-admit" | "human-preapproval" | "reject";
export interface GateDecision {
  readonly tier: GateTier;
  readonly reasons: readonly string[];
}
/** Which connectors carry irreversible effects (a policy input, not a spec field). */
export interface GatePolicy {
  readonly effectful: readonly string[];
}

const asSet = (xs: readonly string[]) => new Set(xs);
const subset = (a: Set<string>, b: Set<string>) => [...a].every((x) => b.has(x));
const ungatedReach = (s: SpecificationContent) =>
  new Set([...s.connectors].filter((c) => !s.approvalGated.includes(c)));

/** INV-SPEC-ATTENUATED: ceiling not higher, no new connectors, no new autonomous reach.
 *
 * NOTE on `effectAttenuates` (effect/lattice.ts, BRIEF-KEEL-EFFECT-SIGNATURE-001):
 * deliberately NOT folded into this conjunction. `SpecificationContent`'s
 * ceiling is per-CONNECTOR (a name, e.g. "ledger"), never per-method — a spec
 * that includes "ledger" permits every method on it, child and parent alike.
 * A registry lookup keyed only by connector name would therefore compare the
 * exact same statically-registered class to itself on both sides of any
 * `attenuates()` call — a tautology, always true, not a real check. Wiring it
 * in anyway would be safety theater: code that LOOKS like it enforces
 * per-method narrowing but structurally cannot fail. `effectAttenuates`
 * becomes actionable the moment `SpecificationContent` gains a genuine
 * per-method restriction (not modeled today, and not added by this brief) —
 * until then it stays a tested, ready utility, used at the connector-registry
 * layer (EFFECT_SIGNATURES/requiresApprovalFor), not here. */
export function attenuates(child: SpecificationContent, parent: SpecificationContent): boolean {
  // ceiling is a single level today ("connectors-only"); equal satisfies "not higher".
  if (!subset(asSet(child.connectors), asSet(parent.connectors))) return false;
  if (!subset(ungatedReach(child), ungatedReach(parent))) return false;
  return true;
}

/** INV-SPEC-INTENT-ANCHORED (negative half): child.forbids ⊇ root.forbids. */
export function inheritsProhibitions(child: SpecificationContent, root: SpecificationContent): boolean {
  return subset(asSet(root.forbids ?? []), asSet(child.forbids ?? []));
}

/** PLAYBOOK-KEEL-SPANNING (INV-DECOMP-3), the exact positive dual of
 *  `inheritsProhibitions` above — same subset shape, opposite polarity and
 *  anchor: `forbids` may only GROW downward, anchored on the ROOT (the
 *  authority anchor); a spanning clause must be CARRIED downward, anchored on
 *  the PARENT (mirrors `attenuates`/`hasGoalMapping`'s parent-anchoring,
 *  PLAYBOOK-KEEL-COVERAGE's own correction — a spanning clause introduced at
 *  an intermediate derivation level scopes that level's children, not
 *  retroactively the whole tree from the root). `carried` is every clause id
 *  the child's OWN `acceptance` actually holds — presence, not satisfaction
 *  (INV-DECOMP-6 is a separate, composition-time check). */
export function inheritsSpanning(child: SpecificationContent, parent: SpecificationContent): boolean {
  const required = asSet(parent.spanning ?? []);
  const carried = asSet(child.acceptance.map((a) => a.id));
  return subset(required, carried);
}

/** PLAYBOOK-KEEL-DISPOSITION-001 (A.2/B.5, INV-DISP-CARRIED): the exact
 *  carried-scope pattern as `inheritsSpanning` above -- every `behaviorRef`
 *  this child's OWN criteria reference must resolve to SOME disposition:
 *  either the child carries its own entry, or the parent already does.
 *  Fail-closed (a behaviorRef neither carries) is a hard reject, same
 *  severity as dropping a spanning requirement -- a disposition is never
 *  silently re-guessed nor silently dropped. */
export function inheritsDisposition(child: SpecificationContent, parent: SpecificationContent): boolean {
  const parentRefs = asSet((parent.behaviorDispositions ?? []).map((d) => d.behaviorRef));
  const childRefs = asSet((child.behaviorDispositions ?? []).map((d) => d.behaviorRef));
  const referenced = child.acceptance.map((c) => c.behaviorRef).filter((r): r is string => !!r);
  return referenced.every((ref) => childRefs.has(ref) || parentRefs.has(ref));
}

/** PLAYBOOK-KEEL-RELATION-SCOPE-001 (B.4/OD-R1-3): admittability. A
 *  `property` criterion declaring ANY of `preservationSet`/`applicability`/
 *  `invalidators` but no `applicability` is not admittable -- it declared
 *  intent to scope but gave the oracle nothing to check applicability
 *  against. An UNSCOPED criterion (none of the three fields) is unaffected
 *  (Track C) -- this never rejects a plain `example` or an ordinary,
 *  unscoped `property` criterion. */
export function isScopeAdmittable(child: SpecificationContent): boolean {
  return child.acceptance.every((c) => {
    if (c.kind !== "property") return true;
    const declaresScope = !!(c.preservationSet?.length || c.applicability?.length || c.invalidators?.length);
    return !declaresScope || !!c.applicability?.length;
  });
}

/** PLAYBOOK-KEEL-RELATION-SCOPE-001 (B.5, "the three monotone directions,
 *  mirrored exactly"): applicability narrows like `attenuates`'s connectors
 *  -- child's declared conditions ⊆ parent's for the SAME criterion id (by
 *  id, since scope lives per-criterion, not per-spec like `spanning`/
 *  `forbids`). A criterion id the parent never carried has nothing to
 *  inherit FROM and is exempt (nothing this check is meant to catch). */
export function inheritsApplicability(child: SpecificationContent, parent: SpecificationContent): boolean {
  return child.acceptance.every((c) => {
    const p = parent.acceptance.find((x) => x.id === c.id);
    if (!p) return true;
    return subset(asSet(c.applicability ?? []), asSet(p.applicability ?? []));
  });
}

/** Invalidators may only GROW downward, per criterion id -- the exact
 *  positive dual of `inheritsApplicability`, same shape as `forbids` /
 *  `inheritsProhibitions` (grow, never drop). */
export function inheritsInvalidators(child: SpecificationContent, parent: SpecificationContent): boolean {
  return child.acceptance.every((c) => {
    const p = parent.acceptance.find((x) => x.id === c.id);
    if (!p) return true;
    return subset(asSet(p.invalidators ?? []), asSet(c.invalidators ?? []));
  });
}

/** A preserved variable must be CARRIED downward, per criterion id -- same
 *  shape as `spanning` / `inheritsSpanning` (carried, never dropped).
 *  Descriptive only (OD-R1-4): the oracle draws no verdict from this field
 *  yet, but a derived spec still can't silently drop a claim its parent
 *  made about what this relation preserves. */
export function inheritsPreservationSet(child: SpecificationContent, parent: SpecificationContent): boolean {
  return child.acceptance.every((c) => {
    const p = parent.acceptance.find((x) => x.id === c.id);
    if (!p) return true;
    return subset(asSet(p.preservationSet ?? []), asSet(c.preservationSet ?? []));
  });
}

/** PLAYBOOK-KEEL-FAMILY-001 (R4, B.1/OD-R4-2): a declared `family` must
 *  carry what its probe needs to be executable ("a shipped family is
 *  executable" -- INV-R4-TYPED-FAMILY) -- the same admittability
 *  discipline as `isScopeAdmittable` (declared intent to scope, but nothing
 *  to check against, is a hard reject; declared intent to type, but
 *  nothing to probe, is too). A criterion with no `family` is unaffected
 *  (INV-R4-ADDITIVE, Track C). */
export function isFamilyAdmittable(child: SpecificationContent): boolean {
  return child.acceptance.every((c) => {
    const f = c.family;
    if (!f) return true;
    switch (f.kind) {
      case "equality": return !!f.expected;
      case "invariance": return !!f.transform;
      case "monotonicity": return f.order === "asc" || f.order === "desc";
      case "idempotence": return true;
      case "bounded": return f.lo !== undefined || f.hi !== undefined || f.baseline !== undefined;
      default: {
        const _never: never = f;
        return _never;
      }
    }
  });
}

/** B.4: which `PropertyFamily["kind"]`s a disposition admits. `"any"` (
 *  intentionally-change: against the replacement requirement, any shape is
 *  fine) and `"none"` (deprecate: "absence" -- a deprecated behavior admits
 *  no TYPED family, only staying untyped/opaque or having none at all) are
 *  distinguished from an explicit kind set (preserve, improve). `unknown`
 *  is deliberately absent -- mirrors the retired `familyMismatch`'s own
 *  "never reaches grading" rule: nothing to constrain against yet. */
const DISPOSITION_ADMITS_FAMILY: Readonly<Partial<Record<BehaviorDisposition, ReadonlySet<PropertyFamily["kind"]> | "any" | "none">>> = {
  preserve: new Set(["equality", "invariance"]),
  improve: new Set(["bounded", "monotonicity"]),
  deprecate: "none",
  "intentionally-change": "any",
};

/** Resolves a criterion's disposition the same way `inheritsDisposition`
 *  already looks it up (child's own `behaviorDispositions` first, else the
 *  parent's) -- LOCAL to the spec content only, same limitation
 *  `inheritsDisposition` already has: a disposition that lives ONLY in the
 *  external `BehaviorLedgerPort` (never carried on either spec) is invisible
 *  to this pure, I/O-free gate, exactly as it already is for every other
 *  disposition check here. */
function resolvedDispositionOf(
  criterion: AcceptanceCriterion,
  child: SpecificationContent,
  parent: SpecificationContent,
): BehaviorDisposition | undefined {
  if (!criterion.behaviorRef) return undefined;
  const own = child.behaviorDispositions?.find((d) => d.behaviorRef === criterion.behaviorRef);
  if (own) return own.disposition;
  return parent.behaviorDispositions?.find((d) => d.behaviorRef === criterion.behaviorRef)?.disposition;
}

/** PLAYBOOK-KEEL-FAMILY-001 (R4, B.4/INV-R4-DISPOSITION-CONSTRAINS): closes
 *  D1's OD-DISP-4 -- what was a surfaced warning (`familyMismatch`,
 *  grounding-gate.adapter.ts, RETIRED by this playbook, "replace the
 *  warning, do not leave both") is now a `freezeGate` hard reject. A
 *  criterion with no `family` (untyped/opaque) is unconstrained
 *  (INV-R4-ADDITIVE); a criterion with no resolvable disposition (no
 *  `behaviorRef`, or an unresolved/`unknown` one) has nothing to constrain
 *  the family against yet, same as `familyMismatch`'s own "unknown never
 *  mismatches" rule. */
export function familyAdmissibleForDisposition(child: SpecificationContent, parent: SpecificationContent): boolean {
  return child.acceptance.every((c) => {
    if (!c.family) return true;
    const disposition = resolvedDispositionOf(c, child, parent);
    if (!disposition || disposition === "unknown") return true;
    const admits = DISPOSITION_ADMITS_FAMILY[disposition];
    if (!admits) return true;
    if (admits === "any") return true;
    if (admits === "none") return false;
    return admits.has(c.family.kind);
  });
}

/** Reversible iff no autonomous (ungated) effectful reach. */
export function isReversible(child: SpecificationContent, policy: GatePolicy): boolean {
  const eff = asSet(policy.effectful);
  return ![...ungatedReach(child)].some((c) => eff.has(c));
}

/** Spec-level well-formedness (INV-SPEC-WELLFORMED). */
export function isWellFormed(child: SpecificationContent): boolean {
  return child.acceptance.length > 0 && child.capabilityCeiling === "connectors-only" && !!child.oracleRef;
}

/** Positive-serve is NOT auto-certified; a derived spec must at least MAP a
 *  clause, and the claim must ANCHOR to a real clause on `parent` — a
 *  `servesClause` that names no actual acceptance criterion is not a mapping,
 *  it's a string (PLAYBOOK-KEEL-COVERAGE). `freezeGate` still distinguishes
 *  ABSENT (no claim at all — human-preapproval, unchanged) from PRESENT-BUT-
 *  UNRESOLVABLE (a malformed proposal — reject) via `claimsMapping` below;
 *  this function answers the narrower "does it actually resolve" question. */
export function hasGoalMapping(child: SpecificationContent, parent: SpecificationContent): boolean {
  return typeof child.servesClause === "string" && child.servesClause.length > 0 && clauseIds(parent).has(child.servesClause);
}

/** Did the child make ANY positive-serve claim at all (resolving or not)?
 *  Distinguishes "said nothing" (human disposes) from "said something false"
 *  (reject) — `hasGoalMapping` alone can't tell those apart, since both are
 *  `false` under it. */
function claimsMapping(child: SpecificationContent): boolean {
  return typeof child.servesClause === "string" && child.servesClause.length > 0;
}

/**
 * The freeze gate. `parent` anchors attenuation; `root` anchors prohibitions and
 * human authority. Returns the admission tier. ("monitored" is a runtime property
 * of how an admitted spec executes, not a gate outcome.)
 */
export function freezeGate(
  child: SpecificationContent,
  parent: SpecificationContent,
  root: SpecificationContent,
  policy: GatePolicy,
): GateDecision {
  const hard: string[] = [];
  if (!isWellFormed(child)) hard.push("malformed spec");
  if (!attenuates(child, parent)) hard.push("amplifies capability (not attenuating)");
  if (!inheritsProhibitions(child, root)) hard.push("drops a root prohibition (intent drift)");
  if (!inheritsSpanning(child, parent)) hard.push("drops a spanning requirement (obligation drift)");
  if (!inheritsDisposition(child, parent)) hard.push("drops a behavior disposition (obligation drift)");
  if (!isScopeAdmittable(child)) hard.push("declares relation scope fields without applicability (not admittable)");
  if (!inheritsApplicability(child, parent)) hard.push("widens applicability beyond the parent's (obligation drift)");
  if (!inheritsInvalidators(child, parent)) hard.push("drops an invalidator (obligation drift)");
  if (!inheritsPreservationSet(child, parent)) hard.push("drops a preserved variable (obligation drift)");
  if (!isFamilyAdmittable(child)) hard.push("declares a relation family without the parameters its probe needs (not admittable)");
  if (!familyAdmissibleForDisposition(child, parent)) hard.push("relation family mismatches its behavior disposition (obligation drift)");
  // A present-and-unresolvable servesClause is a malformed proposal, not a
  // judgment call (PLAYBOOK-KEEL-COVERAGE) — absence is handled below, still
  // human-preapproval, unchanged.
  if (claimsMapping(child) && !hasGoalMapping(child, parent)) hard.push("servesClause does not resolve to a parent acceptance clause");
  if (hard.length) return { tier: "reject", reasons: hard };

  // Structurally admissible. Positive-serve mapping + reversibility set the tier.
  if (!hasGoalMapping(child, parent)) return { tier: "human-preapproval", reasons: ["no goal-clause mapping — human disposes positive-serve"] };
  if (!isReversible(child, policy)) return { tier: "human-preapproval", reasons: ["autonomous effectful reach — human pre-approval"] };
  return { tier: "auto-admit", reasons: ["attenuating, prohibition-inheriting, reversible, mapped"] };
}
