/** Operator-pre-registered menu (v1). Each entry is vetted: fixed connectors, fixed
 *  oracle, fixed ceiling. Callers invoke by name; they cannot alter these.
 *
 * A live-verify pass against the real deployed AI Gateway model (not the domain
 * unit tests, which never execute the loop) surfaced a real bug in an earlier
 * draft of this registry: a single generic acceptance criterion ("verified by
 * the registered oracle") gives a real model no field-name guidance, so it
 * fetched the right connectors but named fields `usdToEur`/`USD_EUR` — never
 * the `usd_eur`/`usd_gbp`/`usd_jpy` fxrate@v1 hard-checks. Two fixes, matched
 * to what each spec needs:
 *  - fx.snapshot: real (non-reserved) intent, but acceptance now states the
 *    EXACT field names fxrate@v1 verifies (proven live: the spike's identical
 *    3-criterion spec ACCEPTed in 2 attempts).
 *  - weather.forCity / store.ensure / store.append: pinned to RESERVED,
 *    scripted intents that already deterministically produce oracle-verified
 *    code — appropriate for a "vetted, fixed" menu entry, especially the two
 *    store writes, where live-model variance is the wrong tradeoff.
 *
 * WIRE CONSTRAINT: an MCP tool name must match ^[a-zA-Z0-9_-]{1,64}$ (no dots,
 * no spaces) — a real Claude connector rejected the dotted names outright at
 * registration. Exposed names use underscores (`fx_snapshot`, not
 * `fx.snapshot`); nothing else about the registry changes.
 *
 * BRIEF-KEEL-EFFECT-SIGNATURE-001 v1.2 §A2.4: `ledger` renamed to `store`,
 * `ledger_ensureRecord` renamed to `store_ensure` — and its effect class
 * changed from write-effectful to write-idempotent, so it no longer
 * approval-gates (the connector's own check-then-write makes it safe to
 * auto-verify). The effectful path is NOT dropped: `store_append` is a new
 * menu entry reaching `store.append` (write-effectful, still PAUSEs) so the
 * D8 demonstrator stays live under the new name. The scope
 * `keel:ledger-write` is renamed to `keel:store-write`, covering both store
 * writes (ensure and append are still both writes, just different classes). */
import type { RegisteredSpec } from "./envelope";
import type { AcceptanceCriterion, SpecificationContent } from "../lineage/nodes";

const mk = (
  intent: string, acceptance: readonly AcceptanceCriterion[], connectors: string[], oracleRef: string, approvalGated: string[] = [],
): SpecificationContent => ({
  intent, capabilityCeiling: "connectors-only", acceptance,
  connectors, approvalGated, attemptBudget: 4, oracleRef,
});

export const DEFAULT_REGISTRY: readonly RegisteredSpec[] = [
  { name: "fx_snapshot", requiredScope: "keel:read",
    spec: mk(
      "Return current USD->EUR, USD->GBP, USD->JPY reference rates as usd_eur, usd_gbp, usd_jpy.",
      [
        { id: "A1", statement: "usd_eur is the current USD->EUR rate", kind: "example" },
        { id: "A2", statement: "usd_gbp is the current USD->GBP rate", kind: "example" },
        { id: "A3", statement: "usd_jpy is the current USD->JPY rate", kind: "example" },
      ],
      ["fx"], "fxrate@v1",
    ) },
  { name: "weather_forCity", requiredScope: "keel:read",
    spec: mk("geo-correct", [{ id: "A1", statement: "latitude/longitude/temperature_c for the geocoded city", kind: "example" }], ["geo", "weather"], "geo@v1") },
  // write-idempotent: NOT approval-gated — store.ensure's own check-then-write
  // makes repeating it safe, so this spec's approvalGated is empty.
  { name: "store_ensure", requiredScope: "keel:store-write",
    spec: mk("store-ensure", [{ id: "A1", statement: "exactly one store record, value active, idempotent upsert", kind: "example" }], ["store"], "store-ensure@v1") },
  // write-effectful: Walk 2, preserved under the new name — still PAUSEs.
  { name: "store_append", requiredScope: "keel:store-write",
    spec: mk("store-append-create", [{ id: "A1", statement: "exactly one store record, value active, read before write", kind: "example" }], ["store"], "store-append@v1", ["store"]) },
];
