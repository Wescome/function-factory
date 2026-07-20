/**
 * connector-registry.adapter.ts — the first real implementation of
 * ConnectorRegistryPort (OD-EFFECT-2). Resolves a connector name to a
 * `ConnectorRef` whose `signatures` come straight from the effect-signature
 * backfill (`src/domain/effect/registry.ts`) and whose `requiresApproval` is
 * DERIVED (connector-level: true iff any backfilled method is
 * `write-effectful`) — never independently set (INV-EFFECT-APPROVAL-DERIVED).
 *
 * Not yet consulted by the Orchestrator (the live D8 gate reads per-method
 * `requiresApproval` directly off each `CodemodeConnector`'s own `tools()`,
 * via `requiresApprovalFor` — see the wiring report). This adapter makes the
 * port real and ready for that wiring, rather than leaving it a defined-but-
 * unimplemented interface.
 */
import type { ConnectorRegistryPort, ConnectorRef } from "../../domain/index";
import { EFFECT_SIGNATURES } from "../../domain/index";

export class EffectSignatureConnectorRegistry implements ConnectorRegistryPort {
  resolve(names: readonly string[]): readonly ConnectorRef[] {
    return names.map((name) => {
      const signatures = EFFECT_SIGNATURES.filter((s) => s.connector === name);
      return {
        name,
        requiresApproval: signatures.some((s) => s.effectClass === "write-effectful"),
        signatures: signatures.length ? signatures : undefined,
        // OD-DESC-1: everything this registry resolves is one signature per
        // (connector, method) — per-method by construction, whether the
        // signature was hand-declared or emitted by the OpenAPI importer.
        effectDeclaration: signatures.length ? "per-method" : undefined,
      };
    });
  }
}
