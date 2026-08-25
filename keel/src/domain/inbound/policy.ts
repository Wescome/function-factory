/**
 * Inbound policies (BRIEF-KEEL-INBOUND-001, OD-IN-1/3/4/6). Pure, substrate-free.
 * The storage (per-caller restriction store, quota counters over the OD-IN-5 audit
 * index, the operator authoring surface, the D1 audit write) is substrate; these are
 * the decision/transition rules it enforces.
 */

// --- OD-IN-1: envelope granularity — scope grants the ceiling; per-caller may ONLY
//     attenuate within it (same attenuation principle, one level out). --------------
export function effectiveEnvelope(
  scopeNames: readonly string[], callerRestriction?: readonly string[],
): { readonly names: string[]; readonly error?: string } {
  const scope = new Set(scopeNames);
  if (!callerRestriction) return { names: [...scope] };                 // default = full scope envelope
  const outside = callerRestriction.filter((n) => !scope.has(n));
  if (outside.length) return { names: [], error: `restriction expands beyond scope: [${outside.join(", ")}]` };
  return { names: callerRestriction.filter((n) => scope.has(n)) };      // intersection (only shrinks)
}

// --- OD-IN-3: quota — per-caller usage vs limit, checked BEFORE execution, fail-closed.
//     `used` is counted from the OD-IN-5 audit index over the operator's window. -----
export interface QuotaDecision { readonly allowed: boolean; readonly remaining: number; readonly status?: 429; readonly reason?: string; }
export function evaluateQuota(used: number, limit: number): QuotaDecision {
  if (!Number.isFinite(limit) || limit < 0) return { allowed: false, remaining: 0, status: 429, reason: "no quota configured (fail-closed)" };
  if (used >= limit) return { allowed: false, remaining: 0, status: 429, reason: `quota exceeded (${used}/${limit})` };
  return { allowed: true, remaining: limit - used };
}

// --- OD-IN-4: operator authoring surface — the domain-worthy part is validation; a
//     per-caller restriction must attenuate the scope envelope (can't grant more). ---
export function validateRestriction(
  scopeNames: readonly string[], restriction: readonly string[],
): { readonly valid: boolean; readonly reason?: string } {
  const scope = new Set(scopeNames);
  const outside = restriction.filter((n) => !scope.has(n));
  return outside.length ? { valid: false, reason: `restriction grants specs outside scope: [${outside.join(", ")}]` } : { valid: true };
}

// --- OD-IN-6: audit outcome-authoritativeness — a paused record must transition to a
//     final outcome after /approve resolves it; terminal is append-only (no re-resolve).
export type AuditStatus = "admitted" | "paused" | "accepted" | "rejected";
export interface InvocationAudit { readonly auditKey: string; readonly caller: string; readonly spec: string; readonly status: AuditStatus; }
const TERMINAL: ReadonlySet<AuditStatus> = new Set<AuditStatus>(["accepted", "rejected"]);
export function resolveInvocationAudit(audit: InvocationAudit, outcome: "accepted" | "rejected"): InvocationAudit {
  if (TERMINAL.has(audit.status)) return audit;         // already final — never re-resolve
  return { ...audit, status: outcome };                 // paused/admitted -> final
}
