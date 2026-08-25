/**
 * proposer/case-mining.ts — PLAYBOOK-KEEL-COUNTEREXAMPLE-GEN-001: a
 * structural, best-effort case generator upstream of challenge.ts.
 * `challengeCandidate` is unchanged — this only produces MORE cases for it
 * to judge (Track C).
 *
 * Scope-derived mining (B.1, priority tier, no model risk): for each OTHER
 * relation already on the spec, parse its R1 `applicability`/`invalidators`
 * conditions for the six simple comparison forms (`input <op> literal` or
 * `literal <op> input`) and emit the boundary literal plus its numeric
 * neighbors (literal-1, literal, literal+1) — the classic off-by-one
 * counterexamples a boundary condition like `input !== 43` invites. A
 * condition the miner can't parse (a compound expression, a non-numeric
 * literal, anything richer) is skipped cleanly — additive and fail-safe,
 * never a crash, never a case invented from a guess (D.5).
 *
 * The model-proposed tier (B.2) is NOT a function here — it's just the
 * caller's existing `cases` input to `proposeLift` (orchestrator.ts),
 * unioned alongside these. The model proposes INPUTS only; it never sees
 * or decides an outcome (OD-GG-7, same discipline D2/challenge.ts already
 * hold to) — the real probe (compileMetamorphic) judges every case,
 * scope-derived or model-proposed alike, and an unjudged/unsettled
 * failure still defaults to "unsettled" in challenge.ts, exactly as it
 * already did before this playbook (OD-RCG-3/OD-RCG-4).
 */
import type { AcceptanceCriterion } from "../lineage/nodes";

const COMPARISON_OPS = ["===", "!==", "<=", ">=", "<", ">"] as const;
const OP_PATTERN = COMPARISON_OPS.map((op) => op.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|");
const INPUT_OP_LITERAL = new RegExp(`^input\\s*(${OP_PATTERN})\\s*(-?\\d+(?:\\.\\d+)?)$`);
const LITERAL_OP_INPUT = new RegExp(`^(-?\\d+(?:\\.\\d+)?)\\s*(${OP_PATTERN})\\s*input$`);

/**
 * Best-effort: matches ONLY the six simple comparison forms against a
 * numeric literal, either operand order (`input !== 43` or `43 !== input`).
 * Returns the boundary literal if it parses, `undefined` otherwise — never
 * throws (B.1/D.5, a compound or non-numeric condition is simply skipped).
 */
export function parseComparisonBoundary(expr: string): number | undefined {
  const trimmed = expr.trim();
  const inputFirst = INPUT_OP_LITERAL.exec(trimmed);
  if (inputFirst) return Number(inputFirst[2]);
  const literalFirst = LITERAL_OP_INPUT.exec(trimmed);
  if (literalFirst) return Number(literalFirst[1]);
  return undefined;
}

/** B.1: mine every OTHER criterion's applicability/invalidators for
 *  boundary literals, emit each literal and its numeric neighbors. The
 *  criterion being lifted contributes nothing to its own case generation
 *  (there is nothing else to mine it against yet — it's still a bare
 *  `example`). A spec with no other scoped relations yields an empty set
 *  (Track C: falls back to base + model tiers only). */
export function mineScopeDerivedCases(criterionId: string, allCriteria: readonly AcceptanceCriterion[]): readonly number[] {
  const conditions = allCriteria
    .filter((c) => c.id !== criterionId)
    .flatMap((c) => [...(c.applicability ?? []), ...(c.invalidators ?? [])]);
  const cases = new Set<number>();
  for (const cond of conditions) {
    const boundary = parseComparisonBoundary(cond);
    if (boundary === undefined) continue; // unparseable -- skipped, no case, no crash (D.5)
    cases.add(boundary - 1);
    cases.add(boundary);
    cases.add(boundary + 1);
  }
  return [...cases];
}
