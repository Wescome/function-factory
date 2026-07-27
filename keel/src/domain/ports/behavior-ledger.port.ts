/**
 * behavior-ledger.port.ts — BehaviorLedgerPort (driven), PLAYBOOK-KEEL-
 * DISPOSITION-001 (B.1): the behavior ledger `behaviorRef -> { disposition,
 * authority, rationale }`. This is where an owner's classification (or a
 * model's mere proposal, OD-DISP-2) is looked up. A spec's OWN carried
 * `SpecificationContent.behaviorDispositions` (mirrors `spanning`) is
 * checked FIRST by the adapter; this port is the fallback source for a
 * behaviorRef the current spec doesn't carry a local entry for.
 */
import type { BehaviorLedgerEntry } from "../disposition/ledger";

export interface BehaviorLedgerPort {
  resolve(behaviorRef: string): Promise<BehaviorLedgerEntry | null>;
}
