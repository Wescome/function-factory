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
 *  - weather.forCity / ledger.ensureRecord: pinned to the RESERVED, scripted
 *    intents ("geo-correct" / "ledger-create") that already deterministically
 *    produce oracle-verified code — appropriate for a "vetted, fixed" menu
 *    entry, especially for ledger.ensureRecord, an approval-gated WRITE where
 *    live-model variance is the wrong tradeoff.
 *
 * WIRE CONSTRAINT: an MCP tool name must match ^[a-zA-Z0-9_-]{1,64}$ (no dots,
 * no spaces) — a real Claude connector rejected the dotted names outright at
 * registration. Exposed names use underscores (`fx_snapshot`, not
 * `fx.snapshot`); nothing else about the registry changes. */
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
  { name: "ledger_ensureRecord", requiredScope: "keel:ledger-write",
    spec: mk("ledger-create", [{ id: "A1", statement: "exactly one ledger record, value active, read before write", kind: "example" }], ["ledger"], "ledger@v1", ["ledger"]) },
];
