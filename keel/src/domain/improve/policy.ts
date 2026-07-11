/**
 * Improvement-loop policies (BRIEF-KEEL-IMPROVE-001, OD-IMP-1/3/4). Pure,
 * substrate-free. These encode anti-thrash (idempotent mining) and anti-drift
 * (append-only regression coverage) — the two operational risks the research
 * (Hermes distribution drift) flagged.
 */
import type { ProcedureCandidate } from "./loop";

// --- OD-IMP-1: mining trigger — gate only NEW candidates (idempotent) ---------
/**
 * Mining is cheap (a query); replay-gating is costly (executes). So gate ONLY
 * candidates not already disposed — never re-gate what is active or awaiting a
 * human. (A rejected key MAY re-qualify later, so the caller decides whether to
 * include rejected keys in `skipKeys`.) Trigger = a candidate newly clears
 * support>=minRepeats AND is not in skipKeys; a periodic sweep is the backstop.
 */
export function pendingCandidates(
  mined: readonly ProcedureCandidate[], skipKeys: ReadonlySet<string>,
): ProcedureCandidate[] {
  return mined.filter((c) => !skipKeys.has(c.key));
}

// --- OD-IMP-3: regression suite — append-only, one anchor per (key, oracle) ----
export interface AnchorTrace { readonly key: string; readonly oracleRef: string; readonly runRef: string; }
const anchorKey = (a: AnchorTrace) => `${a.key}\u0000${a.oracleRef}`;
/**
 * The held-out suite every promotion must not regress. Anti-drift rule: APPEND-ONLY,
 * exactly one anchor per distinct (key, oracleRef) that has ACCEPTed — never pruned.
 * Coverage grows monotonically (no case can be silently lost, unlike a
 * recent-successes window), bounded by distinct patterns, not run count.
 */
export function curateRegressionSuite(
  existing: readonly AnchorTrace[], candidates: readonly AnchorTrace[],
): AnchorTrace[] {
  const have = new Set(existing.map(anchorKey));
  const out = [...existing];
  for (const a of candidates) {
    const k = anchorKey(a);
    if (!have.has(k)) { have.add(k); out.push(a); } // first ACCEPT of a new pattern anchors it
  }
  return out; // existing never removed (INV: monotone coverage)
}

// --- OD-IMP-4: procedure vs harness-fix precedence ----------------------------
/**
 * When both could address the same pattern: the HARNESS FIX takes precedence
 * because it generalises (fixes the whole class, helps unseen tasks), whereas a
 * crystallized procedure caches one task. Ordering: validate/apply harness fixes
 * FIRST, then mine procedures against the POST-FIX baseline. A procedure is then
 * promotable only if it STILL adds value under the fixed harness — strictly fewer
 * attempts, or determinism the statistical fix can't guarantee (e.g. an
 * effectful/critical path). If the fix already made the task one-shot, the
 * procedure is redundant and should not promote.
 */
export function procedureStillAddsValue(p: {
  attemptsUnderFixedHarness: number; // baseline attempts AFTER harness fixes applied
  attemptsUnderProcedure: number;    // = 1 for a crystallized one-shot
  criticalDeterminism: boolean;      // needs guaranteed reproduction (e.g. effectful)
}): boolean {
  if (p.criticalDeterminism) return true;
  return p.attemptsUnderProcedure < p.attemptsUnderFixedHarness; // strict improvement only
}
