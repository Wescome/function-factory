/** OD-IN-1/3/4/6: envelope granularity, quota, restriction validation, audit resolution. */
import { describe, it, expect } from "vitest";
import { effectiveEnvelope, evaluateQuota, validateRestriction, resolveInvocationAudit, type InvocationAudit } from "../src/domain/index";

describe("OD-IN-1 envelope granularity (scope ceiling; per-caller only attenuates)", () => {
  it("no restriction -> full scope envelope", () => {
    expect(effectiveEnvelope(["fx_snapshot", "weather_forCity"]).names.sort()).toEqual(["fx_snapshot", "weather_forCity"]);
  });
  it("restriction shrinks within scope", () => {
    expect(effectiveEnvelope(["fx_snapshot", "weather_forCity"], ["fx_snapshot"]).names).toEqual(["fx_snapshot"]);
  });
  it("restriction cannot EXPAND beyond scope -> error, empty", () => {
    const r = effectiveEnvelope(["fx_snapshot"], ["fx_snapshot", "store_ensure"]);
    expect(r.names).toEqual([]);
    expect(r.error).toContain("expands beyond scope");
  });
});

describe("OD-IN-3 quota (fail-closed, before execution)", () => {
  it("under limit -> allowed with remaining", () => {
    expect(evaluateQuota(3, 10)).toEqual({ allowed: true, remaining: 7 });
  });
  it("at/over limit -> 429", () => {
    expect(evaluateQuota(10, 10).status).toBe(429);
    expect(evaluateQuota(11, 10).allowed).toBe(false);
  });
  it("unconfigured/negative limit -> fail-closed 429", () => {
    expect(evaluateQuota(0, -1).status).toBe(429);
    expect(evaluateQuota(0, Infinity).allowed).toBe(false);
  });
});

describe("OD-IN-4 restriction validation (must attenuate scope)", () => {
  it("subset -> valid", () => {
    expect(validateRestriction(["a", "b"], ["a"]).valid).toBe(true);
  });
  it("grants outside scope -> invalid", () => {
    const r = validateRestriction(["a"], ["a", "b"]);
    expect(r.valid).toBe(false); expect(r.reason).toContain("outside scope");
  });
});

describe("OD-IN-6 audit outcome-authoritativeness", () => {
  const base: InvocationAudit = { auditKey: "inv:A:store:n1", caller: "A", spec: "store_append", status: "paused" };
  it("paused -> accepted after /approve resolves", () => {
    expect(resolveInvocationAudit(base, "accepted").status).toBe("accepted");
  });
  it("terminal record is never re-resolved (append-only truth)", () => {
    const done = { ...base, status: "accepted" as const };
    expect(resolveInvocationAudit(done, "rejected").status).toBe("accepted");
  });
});
