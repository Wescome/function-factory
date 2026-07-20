/**
 * Phase 6a derivation — produces candidate derived specs (PROPOSALS). Untrusted
 * by design: a deriver may propose amplifying or drifting specs; the freeze gate
 * catches them. This module is the template (deterministic) deriver — one of the
 * two sanctioned kinds (A-1); a model deriver is an adapter over the same port.
 */
import type { SpecificationContent } from "../lineage/nodes";

export interface Deriver {
  derive(parent: SpecificationContent, root: SpecificationContent): readonly SpecificationContent[];
}

/**
 * Template derivation: split a multi-criterion parent into per-criterion sub-specs.
 * Each sub-spec is attenuating (same-or-fewer connectors, reflexively ⊆), inherits
 * every root+parent prohibition AND every spanning clause (PLAYBOOK-KEEL-SPANNING,
 * INV-DECOMP-3 — a positive obligation carried into every child, the dual of
 * `forbids`), and maps the one clause it serves. So each is structurally
 * auto-admissible (the gate confirms, per its own policy). Provenance edges
 * (derivedFrom) are attached at admission, when real node IDs exist.
 */
export function templateDerive(parent: SpecificationContent, root: SpecificationContent): SpecificationContent[] {
  if (parent.decomposable !== true) return []; // only decompose specs that DECLARE criterion independence
  const spanning = [...new Set([...(root.spanning ?? []), ...(parent.spanning ?? [])])];
  // PLAYBOOK-KEEL-SPANNING: decomposability is judged by how many
  // INDEPENDENTLY SERVABLE (non-spanning) clauses remain, not raw
  // `acceptance.length`. A spanning clause is carried into every child (see
  // below), which inflates every child's OWN acceptance without adding any
  // new splittable content — under the old `acceptance.length <= 1` guard, a
  // 3-clause root (2 servable + 1 spanning) never converges: each depth-1
  // child still has length 2 (its own clause + the carried spanning one), so
  // it looks "still decomposable" and splits AGAIN into the same shape,
  // recursing until maxDepth/budget. Verified live: an unguarded length
  // check produced 11 admitted runs for one 3-clause spanning root instead
  // of the intended 3. `servable` excludes spanning ids, so a child left
  // with only its own served clause (servable.length === 1, or 0 for the
  // spanning clause's own dedicated child) correctly reports nothing left to
  // split, terminating recursion exactly where it used to.
  const servable = parent.acceptance.filter((c) => !spanning.includes(c.id));
  if (servable.length <= 1) return []; // nothing left to independently split
  const forbids = [...new Set([...(root.forbids ?? []), ...(parent.forbids ?? [])])];
  // The actual clause OBJECTS a spanning id names — carried into every child's
  // acceptance alongside the one clause it serves, so a spanning clause is
  // present in every child by construction (the trusted path). The gate's
  // `inheritsSpanning` exists for the untrusted (model) deriver that will not
  // do this.
  const spanningClauses = parent.acceptance.filter((c) => spanning.includes(c.id));
  return parent.acceptance.map((c) => ({
    ...parent,
    intent: `${parent.intent} — sub-goal: return a result object with the field(s) described by: ${c.statement}`,
    acceptance: [c, ...spanningClauses.filter((s) => s.id !== c.id)],
    forbids,
    spanning,
    servesClause: c.id,
  }));
}

export const templateDeriver: Deriver = { derive: templateDerive };
