/**
 * skill/store.ts — BRIEF-KEEL-SKILL-001: the three prompt-surface skill kinds
 * already named in `IMPROVABLE_SURFACES` (`connector-doc`, `amend-prompt`,
 * `procedure`), and the port their store lives behind. Pure, substrate-free
 * (D6) — this is the shape only; the D1-backed implementation is substrate.
 *
 * INV-SKILL-EARNED: the only legitimate writer is the promotion path through
 * `evaluateImprovement`/`evaluateHarnessFix`/`evaluateProcedure` (already
 * built, BRIEF-KEEL-IMPROVE-001). Append-only (OD-SKILL-2): retiring a skill
 * appends a `status:"retired"` row at a new version, never mutates the row
 * that promoted it — the promotion evidence that earned it stays attached
 * to the version it earned, not silently rewritten.
 */
export type SkillKind = "connector-doc" | "amend-prompt" | "procedure";

export interface SkillRecord {
  readonly id: string;
  readonly kind: SkillKind;
  /** connector-doc: the connector name. procedure/amend-prompt: the intent
   *  (task pattern) key — the same key `TraceSummary.key`/`ProcedureCandidate.key`
   *  already use in the improve loop. */
  readonly key: string;
  /** connector-doc: the doc description. procedure: the crystallized code.
   *  amend-prompt: the nudge text appended on a failed attempt. */
  readonly content: string;
  readonly version: number;
  readonly status: "active" | "retired";
  /** The CI-separated delta (or deterministic replay result) that promoted
   *  this version — provenance travels with the row, never detached. */
  readonly evidence: unknown;
}

export interface SkillStorePort {
  /** All ACTIVE rows whose key matches one of `connectors` (connector-doc) or
   *  equals `intent` (procedure/amend-prompt). Substrate decides how; this is
   *  the one point selection ever touches the store. */
  activeFor(connectors: readonly string[], intent: string): Promise<readonly SkillRecord[]>;
  /** INV-SKILL-EARNED: called only by the promotion path, after a gate
   *  (`evaluateImprovement`/`evaluateHarnessFix`/`evaluateProcedure`) returns
   *  `promote:true`. No other caller appends. */
  append(record: SkillRecord): Promise<void>;
}
