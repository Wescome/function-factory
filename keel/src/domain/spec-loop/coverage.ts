/**
 * spec-loop/coverage.ts — PLAYBOOK-KEEL-COVERAGE: catch the clause a deriver
 * drops, before anything is admitted. Pure, substrate-free (D6).
 *
 * The gate (gate.ts) checks one candidate at a time; nothing checked the
 * candidate SET against the parent's acceptance. A deriver that returns
 * children for A1 and A2 and silently omits A3 passes every per-child check,
 * admits two runs, and reports success — A3 is nobody's. The deriver is
 * untrusted by design (derive.ts); this is why the check must be a set
 * operation, never a judgment: `undischarged = clauseIds(parent) \ (union of
 * resolving servesClause claims)`.
 */
import type { SpecificationContent } from "../lineage/nodes";

export function clauseIds(spec: SpecificationContent): Set<string> {
  return new Set(spec.acceptance.map((c) => c.id));
}

export interface CoverageReport {
  /** Parent clause ids no candidate's servesClause resolves to. Non-empty
   *  means the split is silently incomplete (INV-SPEC-COVERAGE). */
  readonly undischarged: readonly string[];
  /** The claims that don't discharge anything — absent, or present but not
   *  in clauseIds(parent). "" stands for an absent claim (no valid clause id
   *  is ever the empty string), so this stays a plain string array. */
  readonly unanchored: readonly string[];
}

export function checkCoverage(
  candidates: readonly SpecificationContent[],
  parent: SpecificationContent,
): CoverageReport {
  // Empty is not a gap: no decomposition happened (templateDerive returns []
  // for a non-decomposable or single-clause parent) — never escalate a spec
  // for declining to decompose.
  if (candidates.length === 0) return { undischarged: [], unanchored: [] };

  const parentClauses = clauseIds(parent);
  const claimed = new Set<string>();
  const unanchored: string[] = [];

  for (const c of candidates) {
    const claim = c.servesClause;
    if (typeof claim === "string" && claim.length > 0 && parentClauses.has(claim)) {
      claimed.add(claim);
    } else {
      unanchored.push(claim ?? "");
    }
  }

  const undischarged = [...parentClauses].filter((id) => !claimed.has(id)).sort();
  return { undischarged, unanchored: unanchored.sort() };
}
