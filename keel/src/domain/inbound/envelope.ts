/**
 * Inbound MCP v1 — the menu (operator-pre-registered specs) + envelope enforcement.
 * Pure, substrate-free (D6). A caller invokes a spec BY NAME (never authors one);
 * KEEL admits iff the caller's scope grants that spec. The admitted principal carries
 * identity but NO token (INV-INBOUND-NO-PASSTHROUGH, by construction). Every
 * admission gets a per-invocation audit key (OD-IN-5) so identical invocations do not
 * collapse under content addressing.
 *
 * v1 gate = scope → allowed name. (Free-intent v2 would additionally gate on
 * `attenuates` from the 6a spec-loop — already proven — but v1 never lets a caller
 * supply a spec, so there is no connector to smuggle.)
 */
import type { SpecificationContent } from "../lineage/nodes";

export interface RegisteredSpec {
  readonly name: string;            // the MCP tool name the caller invokes
  readonly requiredScope: string;   // the OAuth scope that grants it
  readonly spec: SpecificationContent; // operator-vetted; fixed connectors + oracle + ceiling
}
export type SpecRegistry = readonly RegisteredSpec[];

/** identity only — deliberately no `token` field, so nothing can forward it outbound. */
export interface Principal { readonly caller: string; }

export type Admission =
  | { readonly admit: true; readonly spec: SpecificationContent; readonly principal: Principal; readonly auditKey: string }
  | { readonly admit: false; readonly status: 403 | 404; readonly reason: string };

/** OD-IN-5: per-invocation audit identity. caller + spec + nonce — never content-only,
 *  so repeated identical invocations remain distinct in the audit index. */
export function invocationAuditKey(caller: string, specName: string, nonce: string): string {
  return `inv:${caller}:${specName}:${nonce}`;
}

export function resolveInvocation(
  registry: SpecRegistry, callerScopes: readonly string[], caller: string, name: string, nonce: string,
): Admission {
  const reg = registry.find((r) => r.name === name);
  if (!reg) return { admit: false, status: 404, reason: `unknown spec: ${name}` };
  if (!callerScopes.includes(reg.requiredScope)) {
    return { admit: false, status: 403, reason: `insufficient_scope: caller lacks ${reg.requiredScope}` };
  }
  return { admit: true, spec: reg.spec, principal: { caller }, auditKey: invocationAuditKey(caller, name, nonce) };
}

/** The scopes a caller holds → the names they may invoke (for tools/list filtering). */
export function visibleSpecs(registry: SpecRegistry, callerScopes: readonly string[]): string[] {
  return registry.filter((r) => callerScopes.includes(r.requiredScope)).map((r) => r.name);
}
