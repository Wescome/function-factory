/** Inbound v1: scope-gated menu admission + no-passthrough principal + per-invocation
 *  audit identity (OD-IN-5). This is the spike logic, promoted to tested code. */
import { describe, it, expect } from "vitest";
import { resolveInvocation, visibleSpecs, invocationAuditKey, DEFAULT_REGISTRY } from "../src/domain/index";

const R = DEFAULT_REGISTRY;

describe("inbound scope-gated admission (the menu)", () => {
  it("known spec + granting scope -> ADMIT with the vetted spec", () => {
    const a = resolveInvocation(R, ["keel:read"], "callerA", "fx_snapshot", "n1");
    expect(a.admit).toBe(true);
    if (a.admit) { expect(a.spec.connectors).toEqual(["fx"]); expect(a.spec.oracleRef).toBe("fxrate@v1"); }
  });
  it("known spec + MISSING scope -> 403 insufficient_scope (before any execution)", () => {
    const a = resolveInvocation(R, ["keel:read"], "callerA", "ledger_ensureRecord", "n1");
    expect(a.admit).toBe(false);
    if (!a.admit) { expect(a.status).toBe(403); expect(a.reason).toContain("keel:ledger-write"); }
  });
  it("unknown spec -> 404 (caller cannot invent a spec — menu only)", () => {
    const a = resolveInvocation(R, ["keel:read"], "callerA", "os.exec", "n1");
    expect(a.admit).toBe(false);
    if (!a.admit) expect(a.status).toBe(404);
  });
  it("effectful spec with the write scope -> ADMIT (D8 still gates at execution)", () => {
    const a = resolveInvocation(R, ["keel:read", "keel:ledger-write"], "callerB", "ledger_ensureRecord", "n1");
    expect(a.admit).toBe(true);
    if (a.admit) expect(a.spec.approvalGated).toEqual(["ledger"]);
  });
});

describe("no-passthrough (structural) + audit identity (OD-IN-5)", () => {
  it("admitted principal carries identity, NEVER a token", () => {
    const a = resolveInvocation(R, ["keel:read"], "callerA", "fx_snapshot", "n1");
    if (a.admit) expect(Object.keys(a.principal)).toEqual(["caller"]); // nothing to forward outbound
  });
  it("two identical invocations get DISTINCT audit keys (no content-hash collapse)", () => {
    const a1 = resolveInvocation(R, ["keel:read"], "callerA", "fx_snapshot", "nonce-1");
    const a2 = resolveInvocation(R, ["keel:read"], "callerA", "fx_snapshot", "nonce-2");
    if (a1.admit && a2.admit) expect(a1.auditKey).not.toBe(a2.auditKey);
    expect(invocationAuditKey("callerA", "fx_snapshot", "nonce-1")).toBe("inv:callerA:fx_snapshot:nonce-1");
  });
});

describe("visibleSpecs (tools/list filtering per scope)", () => {
  it("read-only caller sees the two read specs, not the write spec", () => {
    expect(visibleSpecs(R, ["keel:read"]).sort()).toEqual(["fx_snapshot", "weather_forCity"]);
  });
  it("write caller sees all three", () => {
    expect(visibleSpecs(R, ["keel:read", "keel:ledger-write"])).toContain("ledger_ensureRecord");
  });
});
