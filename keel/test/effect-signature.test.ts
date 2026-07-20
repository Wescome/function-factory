/** BRIEF-KEEL-EFFECT-SIGNATURE-001: the lattice, error classification, arg
 *  projection, and the structural anchor check on a recorded ConnectorCall. */
import { describe, it, expect } from "vitest";
import {
  effectAttenuates, classifyTerminal, projectArgs, verifyEffect,
  effectSignatureFor, requiresApprovalFor,
  type EffectSignature, type ErrorClass,
} from "../src/domain/index";
import type { ConnectorCall } from "../src/domain/lineage/nodes";
import { EffectSignatureConnectorRegistry } from "../src/adapters/effect/connector-registry.adapter";

describe("effectAttenuates — pure ⊑ read ⊑ write-idempotent ⊑ write-effectful", () => {
  it("equal classes attenuate (reflexive)", () => {
    expect(effectAttenuates("read", "read")).toBe(true);
  });
  it("a narrower child attenuates a wider parent", () => {
    expect(effectAttenuates("read", "write-effectful")).toBe(true);
    expect(effectAttenuates("pure", "write-idempotent")).toBe(true);
  });
  it("a wider child does NOT attenuate a narrower parent", () => {
    expect(effectAttenuates("write-effectful", "read")).toBe(false);
    expect(effectAttenuates("write-idempotent", "pure")).toBe(false);
  });
});

describe("classifyTerminal (OD-EFFECT-6)", () => {
  it("amend-worthy classes are NOT terminal", () => {
    const amendable: ErrorClass[] = ["InvalidResponse", "Conflict", "RateLimited"];
    for (const e of amendable) expect(classifyTerminal(e)).toBe(false);
  });
  it("identity/authorization/capability classes ARE terminal", () => {
    const terminal: ErrorClass[] = ["PermissionDenied", "OperationUnsupported", "AuthenticationFailed"];
    for (const e of terminal) expect(classifyTerminal(e)).toBe(true);
  });
});

describe("projectArgs — the input-side dual of projectResponse", () => {
  const argSchema = { key: { type: "pattern" as const, pattern: "^[a-z0-9-]+$" }, value: { type: "enum" as const, values: ["active", "inactive"] } };
  it("well-formed args project cleanly, nothing dropped", () => {
    const p = projectArgs(argSchema, { key: "entity-1", value: "active" });
    expect(p.dropped).toEqual([]);
    expect(p.projected).toEqual({ key: "entity-1", value: "active" });
  });
  it("an undeclared field is dropped (the injection surface)", () => {
    const p = projectArgs(argSchema, { key: "entity-1", value: "active", admin: true });
    expect(p.dropped).toContain("admin");
  });
  it("a value outside the declared shape is dropped", () => {
    const p = projectArgs(argSchema, { key: "entity-1", value: "deleted-everything" });
    expect(p.dropped).toContain("value");
  });
});

describe("verifyEffect (INV-EFFECT-ANCHORED) — checks the recorded call, not the model's claim", () => {
  const readSig: EffectSignature = {
    connector: "ledger", method: "list", effectClass: "read",
    reads: [{ origin: "keel:ledger" }], writes: [], idempotency: "idempotent-by-key",
    errors: [], argSchema: { key: { type: "pattern", pattern: "^[a-z0-9-]+$" } },
    response: { fields: {} },
  };
  const writeSig: EffectSignature = {
    connector: "ledger", method: "put", effectClass: "write-effectful",
    reads: [], writes: [{ origin: "keel:ledger" }], idempotency: "non-idempotent",
    errors: ["Conflict"], argSchema: { key: { type: "pattern", pattern: "^[a-z0-9-]+$" }, value: { type: "enum", values: ["active", "inactive"] } },
    response: { fields: { ok: { type: "boolean" } } },
  };
  it("a well-formed recorded call verifies clean", () => {
    const call: ConnectorCall = { seq: 0, connector: "ledger", method: "put", args: { key: "entity-1", value: "active" }, response: { ok: true } };
    expect(verifyEffect(writeSig, call)).toEqual({ ok: true, reasons: [] });
  });
  it("args diverging from argSchema fail structurally", () => {
    const call: ConnectorCall = { seq: 0, connector: "ledger", method: "put", args: { key: "entity-1", value: "active", extra: true }, response: { ok: true } };
    const v = verifyEffect(writeSig, call);
    expect(v.ok).toBe(false);
    expect(v.reasons.join(" ")).toContain("extra");
  });
  it("a signature declaring writes for a read/pure effectClass fails structurally (the anchor)", () => {
    const misdeclared: EffectSignature = { ...readSig, writes: [{ origin: "keel:ledger" }] };
    const call: ConnectorCall = { seq: 0, connector: "ledger", method: "list", args: { key: "entity-1" }, response: [] };
    const v = verifyEffect(misdeclared, call);
    expect(v.ok).toBe(false);
    expect(v.reasons.join(" ")).toContain("effectClass");
  });
});

describe("effect/registry.ts backfill — the source requiresApproval derives from", () => {
  it("store.select is read; store.ensure is write-idempotent; store.append is write-effectful", () => {
    expect(effectSignatureFor("store", "select")?.effectClass).toBe("read");
    expect(effectSignatureFor("store", "ensure")?.effectClass).toBe("write-idempotent");
    expect(effectSignatureFor("store", "append")?.effectClass).toBe("write-effectful");
  });
  it("requiresApprovalFor: only write-effectful methods gate — ensure does NOT (BRIEF v1.2 §A2.4)", () => {
    expect(requiresApprovalFor("store", "append")).toBe(true);
    expect(requiresApprovalFor("store", "ensure")).toBe(false);
    expect(requiresApprovalFor("store", "select")).toBe(false);
    expect(requiresApprovalFor("fx", "rate")).toBe(false);
    expect(requiresApprovalFor("geo", "lookup")).toBe(false);
    expect(requiresApprovalFor("weather", "current")).toBe(false);
  });
  it("an undeclared method defaults to false (unannotated methods execute immediately)", () => {
    expect(requiresApprovalFor("billing", "getTier")).toBe(false);
  });
});

describe("EffectSignatureConnectorRegistry (OD-EFFECT-2, the first real ConnectorRegistryPort)", () => {
  it("resolves a connector's signatures and derives requiresApproval connector-wide", () => {
    const registry = new EffectSignatureConnectorRegistry();
    const store = registry.resolve(["store"])[0]!;
    expect(store.requiresApproval).toBe(true); // append is write-effectful
    expect(store.signatures?.map((s) => s.method).sort()).toEqual(["append", "ensure", "select"]);
  });
  it("a read-only connector resolves requiresApproval:false", () => {
    const registry = new EffectSignatureConnectorRegistry();
    const fx = registry.resolve(["fx"])[0]!;
    expect(fx.requiresApproval).toBe(false);
  });
  it("a connector with no backfilled signatures still resolves (additive, non-breaking)", () => {
    const registry = new EffectSignatureConnectorRegistry();
    const billing = registry.resolve(["billing"])[0]!;
    expect(billing.requiresApproval).toBe(false);
    expect(billing.signatures).toBeUndefined();
  });
});
