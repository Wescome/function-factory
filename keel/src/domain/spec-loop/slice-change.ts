/**
 * spec-loop/slice-change.ts — PLAYBOOK-KEEL-SCR-PORT-4 (Track 1): the ONE
 * graph translation, at the slice→Change boundary.
 *
 * KEEL's C2 layer already carries a dependency graph over sub-specs
 * (`SpecificationContent.dependsOnClauses`, checked whole-batch by
 * `dag.ts`'s `checkDependencyGraph`). SCR's review log already carries a
 * dependency graph over Changes (`ChangeOpened.parents`, ordered by
 * `Model.openOrder`). PORT-4's whole point is that these are not two
 * graphs — they are ONE graph expressed on two substrates. This module is
 * the entire translation: clause ids in, clause ids out, so a caller can
 * hand `openChange(..., parents)` the SCR change ids it already resolved
 * for those clauses.
 *
 * Deliberately NOT here: any topological order. `Model.openOrder`
 * (model.ts) is the single source of truth for the order a series
 * composes in — a second ordering computed here would be exactly the
 * "second graph" this playbook exists to prevent. What a caller DOES need
 * is an insertion SEQUENCE (a Change's parents must exist before it names
 * them), and that is a substrate obligation of the writer, not an
 * ordering authority; see `slice-change-bridge.ts` for how it is derived
 * and why it provably agrees with `Model.openOrder`.
 *
 * Pure: zero substrate imports (`scripts/lint-deps.mjs` enforces this for
 * everything under `src/domain/**`).
 */
import type { SpecificationContent } from "../lineage/nodes";

/** One slice's landing in the review log: which parent clause it serves,
 *  which SCR Change carries it, and the Changes that Change was opened
 *  on top of (already resolved from `parentClauses` below). The `parents`
 *  here are SCR change ids, never clause ids — the translation has
 *  already happened by the time this record exists. */
export interface SliceChangeMapping {
  readonly servesClause: string;
  readonly changeId: string;
  readonly parents: readonly string[];
}

/**
 * C2's `dependsOnClauses` → SCR's `openChange(..., parents)`, as clause
 * ids. One entry per candidate that actually serves a clause, in the
 * candidates' own order (no reordering happens here — see this module's
 * own doc).
 *
 * Edges naming a clause NOT present in this batch are dropped. That is
 * defensive only, and is never load-bearing: `checkDependencyGraph`
 * already fails the WHOLE batch on a dangling edge (`danglingEdges`,
 * fail-closed) before any candidate is admitted, so a dangling edge
 * cannot reach here through the live path. Dropping rather than
 * preserving keeps the produced mapping referentially closed — every
 * parent clause it names is one the caller can actually resolve to a
 * Change id.
 *
 * A self-edge is deliberately NOT filtered: that is a cycle, and
 * `checkDependencyGraph` is the one authority that judges cycles. Hiding
 * it here would make this module a second, silent cycle check.
 */
export function seriesParentsFor(
  candidates: readonly SpecificationContent[],
): readonly { servesClause: string; parentClauses: readonly string[] }[] {
  const present = new Set(
    candidates.map((c) => c.servesClause).filter((id): id is string => !!id),
  );
  const out: { servesClause: string; parentClauses: readonly string[] }[] = [];
  for (const c of candidates) {
    if (!c.servesClause) continue;
    const parentClauses = [...new Set(c.dependsOnClauses ?? [])].filter((id) => present.has(id));
    out.push({ servesClause: c.servesClause, parentClauses });
  }
  return out;
}
