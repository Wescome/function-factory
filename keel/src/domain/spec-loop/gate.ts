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

/** INV-SPEC-ATTENUATED: ceiling not higher, no new connectors, no new autonomous reach. */
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

/** Reversible iff no autonomous (ungated) effectful reach. */
export function isReversible(child: SpecificationContent, policy: GatePolicy): boolean {
  const eff = asSet(policy.effectful);
  return ![...ungatedReach(child)].some((c) => eff.has(c));
}

/** Spec-level well-formedness (INV-SPEC-WELLFORMED). */
export function isWellFormed(child: SpecificationContent): boolean {
  return child.acceptance.length > 0 && child.capabilityCeiling === "connectors-only" && !!child.oracleRef;
}

/** Positive-serve is NOT auto-certified; a derived spec must at least MAP a clause. */
export function hasGoalMapping(child: SpecificationContent): boolean {
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
  if (hard.length) return { tier: "reject", reasons: hard };

  // Structurally admissible. Positive-serve mapping + reversibility set the tier.
  if (!hasGoalMapping(child)) return { tier: "human-preapproval", reasons: ["no goal-clause mapping — human disposes positive-serve"] };
  if (!isReversible(child, policy)) return { tier: "human-preapproval", reasons: ["autonomous effectful reach — human pre-approval"] };
  return { tier: "auto-admit", reasons: ["attenuating, prohibition-inheriting, reversible, mapped"] };
}
