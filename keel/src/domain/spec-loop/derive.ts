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
 * every root+parent prohibition, and maps the one clause it serves. So each is
 * structurally auto-admissible (the gate confirms, per its own policy). Provenance
 * edges (derivedFrom) are attached at admission, when real node IDs exist.
 */
export function templateDerive(parent: SpecificationContent, root: SpecificationContent): SpecificationContent[] {
  if (parent.decomposable !== true) return []; // only decompose specs that DECLARE criterion independence
  if (parent.acceptance.length <= 1) return []; // nothing to decompose
  const forbids = [...new Set([...(root.forbids ?? []), ...(parent.forbids ?? [])])];
  return parent.acceptance.map((c) => ({
    ...parent,
    intent: `${parent.intent} — sub-goal: return a result object with the field(s) described by: ${c.statement}`,
    acceptance: [c],
    forbids,
    servesClause: c.id,
  }));
}

export const templateDeriver: Deriver = { derive: templateDerive };
