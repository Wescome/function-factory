/**
 * Effectful ledger connector. `list` is read-only; `put` is APPROVAL-GATED (D8) —
 * calling it aborts the action for human approval. The write is a real, observable
 * mutation; the task must read-before-write to keep exactly one record, and the
 * oracle verifies the post-state via a recorded read-back (never trusts the model,
 * never re-runs the write — INV-VERIFY-NO-REEXEC; codemode's durable log makes the
 * approved put idempotent under replay).
 */
import { CodemodeConnector } from "@cloudflare/codemode";
import type { CallRecorder } from "../codemode/call-recorder";
import { MapLedgerStore, type LedgerStore } from "./store";

export class LedgerConnector extends CodemodeConnector<unknown> {
  constructor(ctx: unknown, env: unknown, private readonly rec?: CallRecorder, private readonly store: LedgerStore = new MapLedgerStore()) {
    super(ctx as never, env as never);
  }
  override name() { return "ledger"; }
  override tools() {
    const rec = this.rec, store = this.store;
    return {
      list: {
        description: "ledger.list({key}) => existing records for key (read; use before writing).",
        execute: async (a: unknown) => {
          const key = ((a ?? {}) as { key?: string }).key as string;
          const recs = await store.list(key); rec?.record("ledger", "list", { key }, recs); return recs;
        },
      },
      put: {
        description: "ledger.put({key, value}) => append a record. APPROVAL-GATED (consequential).",
        requiresApproval: true,
        execute: async (a: unknown) => {
          const { key, value } = (a ?? {}) as { key?: string; value?: unknown };
          await store.put(key as string, value); rec?.record("ledger", "put", { key, value }, { ok: true }); return { ok: true };
        },
      },
    };
  }
}
