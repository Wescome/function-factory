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
import type { SpecificationContent } from "../lineage/nodes";
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
