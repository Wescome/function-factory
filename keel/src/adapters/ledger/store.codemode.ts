/**
 * The `store` connector (renamed from `ledger`, BRIEF-KEEL-EFFECT-SIGNATURE-001
 * v1.2 §A2.4). Three methods, three real effect classes:
 *  - `select` — read; existing records for a key.
 *  - `ensure` — write-idempotent: an atomic upsert. The connector itself does
 *    the read-before-write check (INV-EFFECT-IDEMPOTENCY-ANCHORED: the key
 *    lives in `args`, not left to the model to sequence correctly), so
 *    calling it twice with the same key is a no-op the second time — this is
 *    WHY it can auto-verify instead of D8-gating (no PAUSE): the write is
 *    safe to perform without human approval precisely because repeating it
 *    changes nothing.
 *  - `append` — write-effectful, non-idempotent: always adds a new record,
 *    duplicates included if misused. Still APPROVAL-GATED — this is Walk 2,
 *    preserved under the new name, INV-EFFECT-NO-INVERSE: PAUSE is the
 *    admission, never a runtime undo.
 */
import { CodemodeConnector } from "@cloudflare/codemode";
import type { CallRecorder } from "../codemode/call-recorder";
import { MapLedgerStore, type LedgerStore } from "./store";
import { requiresApprovalFor } from "../../domain/index";

export class StoreConnector extends CodemodeConnector<unknown> {
  constructor(ctx: unknown, env: unknown, private readonly rec?: CallRecorder, private readonly store: LedgerStore = new MapLedgerStore()) {
    super(ctx as never, env as never);
  }
  override name() { return "store"; }
  override tools() {
    const rec = this.rec, store = this.store;
    return {
      select: {
        description: "store.select({key}) => existing records for key (read; use before writing with append).",
        requiresApproval: requiresApprovalFor("store", "select"),
        execute: async (a: unknown) => {
          const key = ((a ?? {}) as { key?: string }).key as string;
          const recs = await store.list(key); rec?.record("store", "select", { key }, recs); return recs;
        },
      },
      ensure: {
        description: "store.ensure({key, value}) => idempotent upsert: ensures exactly one record exists for key, no-op if already present. Not approval-gated — repeating it is always safe.",
        requiresApproval: requiresApprovalFor("store", "ensure"),
        execute: async (a: unknown) => {
          const { key, value } = (a ?? {}) as { key?: string; value?: unknown };
          // Atomic (store.ensure, not a read-then-conditional-write): the
          // check-and-insert is ONE storage operation (see store.ts/
          // do-ledger.adapter.ts), so two concurrent calls for the same key
          // cannot both observe "absent" and both insert.
          const { inserted } = await store.ensure(key as string, value);
          const after = await store.list(key as string);
          const response = { ok: true, count: after.length, value: after[0]?.value, inserted };
          rec?.record("store", "ensure", { key, value }, response);
          return response;
        },
      },
      append: {
        description: "store.append({key, value}) => always adds a new record, no existence check. APPROVAL-GATED (consequential, non-idempotent) — read with select before calling to avoid duplicates.",
        requiresApproval: requiresApprovalFor("store", "append"),
        execute: async (a: unknown) => {
          const { key, value } = (a ?? {}) as { key?: string; value?: unknown };
          await store.put(key as string, value); rec?.record("store", "append", { key, value }, { ok: true }); return { ok: true };
        },
      },
    };
  }
}
