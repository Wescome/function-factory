/**
 * disposition/ledger.ts — PLAYBOOK-KEEL-DISPOSITION-001 (D1): the behavior
 * disposition core, pure and substrate-free. NAME COLLISION NOTE: KEEL
 * already has a `disposition` node kind (`DispositionContent`,
 * lineage/nodes.ts) — that is APPROVAL-ROUTING (human/auto), an unrelated
 * concept. This file's `BehaviorDisposition` is deliberately never called
 * just "disposition" in any exported symbol, to keep the two from blurring.
 *
 * OD-DISP-2: an owner assigns a provisional disposition; a model may
 * PROPOSE but never ASSIGN unattended. `resolveDisposition` enforces this
 * fail-closed: an entry only `model-proposed` (no owner sign-off yet) reads
 * as `unknown`, identically to no entry at all.
 *
 * INV-DISP-UNKNOWN-BLOCKS (B.2): `unknown` is never treated as `preserve`
 * and never dropped — `overlayDisposition` forces `escalate` regardless of
 * what the oracle/judge grading concluded.
 *
 * INV-DISP-DRIVES-AUTHORITY (B.3): `intentionally-change` routes to the
 * requirement clause's ROOT authority up the attenuation chain, not the
 * current spec — grounding the new relation is necessary but not
 * sufficient. `authorityMatches` is the one-line check: a spec with no
 * `derivedFrom` IS a root (trivially authorized over its own behaviors); a
 * derived spec must match the ledger entry's recorded authority.
 *
 * OD-DISP-4 (CLOSED by PLAYBOOK-KEEL-FAMILY-001, R4): a mismatch between a
 * relation's family and its disposition was a surfaced WARNING here
 * (`familyMismatch`, `RelationFamily`, `DISPOSITION_FAMILY` -- all RETIRED
 * by R4). It is now a `freezeGate` hard reject
 * (`familyAdmissibleForDisposition`, spec-loop/gate.ts) against R4's own
 * typed `PropertyFamily` (lineage/nodes.ts) — a stronger, earlier
 * chokepoint, not a second copy of the same rule (R4's playbook: "replace
 * the warning path, do not leave both").
 */
import type { CriterionOutcome } from "../grounding/grader";

export type BehaviorDisposition = "preserve" | "improve" | "intentionally-change" | "deprecate" | "unknown";

export interface BehaviorLedgerEntry {
  readonly behaviorRef: string;
  readonly behaviorDisposition: BehaviorDisposition;
  /** The root spec id/hash authorized to decide this behavior's
   *  intentionally-change (B.3). Irrelevant for the other dispositions. */
  readonly authority: string;
  readonly rationale: string;
  /** OD-DISP-2: only "owner" is a real classification. */
  readonly assignedBy: "owner" | "model-proposed";
}

/** Fail-closed: no entry, or an entry only ever model-proposed, is unknown
 *  — identically. There is no third "pending" state visible to the gate. */
export function resolveDisposition(entry: BehaviorLedgerEntry | null | undefined): BehaviorDisposition {
  if (!entry) return "unknown";
  if (entry.assignedBy !== "owner") return "unknown";
  return entry.behaviorDisposition;
}

/** B.3: a spec with no `derivedFrom` root IS the root (trivially owns its
 *  own behaviors' changes) — mirrors how a human-root spec is its own
 *  authority anchor elsewhere in this codebase (INV-SPEC-HUMAN-ROOT). A
 *  derived spec's root must match the entry's recorded authority exactly. */
export function authorityMatches(derivedFromRoot: string | undefined, authority: string): boolean {
  return derivedFromRoot === undefined || derivedFromRoot === authority;
}

/**
 * The overlay applied AFTER the grounding gate's own oracle/judge grading
 * (grounding/grader.ts, unchanged) — never folded into `decideCriterion`
 * itself, so the prior spike's proven core stays untouched. `unknown`
 * forces escalate regardless of how confidently the base grading concluded
 * (INV-DISP-UNKNOWN-BLOCKS); `intentionally-change` additionally requires
 * `authorityOk` (INV-DISP-DRIVES-AUTHORITY) — grounded is necessary but not
 * sufficient. Every other disposition (and a matched intentionally-change)
 * leaves the base grading outcome untouched.
 */
export function overlayDisposition(base: CriterionOutcome, disposition: BehaviorDisposition, authorityOk: boolean): CriterionOutcome {
  if (disposition === "unknown") return "escalate";
  if (disposition === "intentionally-change" && !authorityOk) return "escalate";
  return base;
}
