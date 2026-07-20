/** BRIEF-KEEL-CONNECTOR-DESCRIPTOR-001 v1.1 (FU-DESC-1): requiresApprovalFor
 *  reads the idempotence-PROVENANCE axis, not just effectClass — a merged
 *  foreign write-idempotent signature is a CLAIM KEEL cannot verify, so it
 *  must not silently skip D8 just because it says "idempotent" of itself. */
import { describe, it, expect } from "vitest";
import {
  requiresApprovalFor, approvalForSignature, attestedIdempotent, openapiToSignatures,
  EFFECT_SIGNATURES, effectSignatureFor,
  type EffectSignature, type OpenApiDocument,
} from "../src/domain/index";

describe("store.ensure — by-construction, unchanged regression", () => {
  it("still derives requiresApproval:false (the atomic path still auto-executes)", () => {
    expect(effectSignatureFor("store", "ensure")?.idempotenceProvenance).toBe("by-construction");
    expect(requiresApprovalFor("store", "ensure")).toBe(false);
  });
});

describe("a merged foreign write-idempotent (by-claim) — the invariant, enforced", () => {
  const foreignPut: EffectSignature = {
    connector: "petstore", method: "PUT /pets/{id}", effectClass: "write-idempotent",
    reads: [], writes: [{ origin: "https://api.pets.example" }],
    response: { fields: {} }, idempotency: "idempotent-by-key",
    idempotenceProvenance: "by-claim", errors: [], argSchema: {},
  };

  it("PAUSEs (requiresApproval:true) because unattested", () => {
    expect(approvalForSignature(foreignPut)).toBe(true);
  });

  it("auto-executes ONLY once an operator explicitly attests it", () => {
    const attested = [{ connector: "petstore", method: "PUT /pets/{id}" }];
    expect(approvalForSignature(foreignPut, attested)).toBe(false);
  });

  it("attestedIdempotent is false by default, true only for a listed (connector, method)", () => {
    expect(attestedIdempotent("petstore", "PUT /pets/{id}")).toBe(false);
    expect(attestedIdempotent("petstore", "PUT /pets/{id}", [{ connector: "petstore", method: "PUT /pets/{id}" }])).toBe(true);
  });

  it("an attestation for a DIFFERENT method does not leak over", () => {
    const attested = [{ connector: "petstore", method: "DELETE /pets/{id}" }];
    expect(approvalForSignature(foreignPut, attested)).toBe(true);
  });
});

describe("fail-safe default: provenance absent on write-idempotent -> treated by-claim -> PAUSE", () => {
  it("a signature with NO idempotenceProvenance field at all still PAUSEs", () => {
    const noProvenance: EffectSignature = {
      connector: "mystery", method: "upsert", effectClass: "write-idempotent",
      reads: [], writes: [{ origin: "keel:internal/mystery" }],
      response: { fields: {} }, idempotency: "idempotent-by-key",
      // idempotenceProvenance deliberately omitted
      errors: [], argSchema: {},
    };
    expect(approvalForSignature(noProvenance)).toBe(true);
  });
});

describe("openapiToSignatures — imported write-idempotent is ALWAYS by-claim", () => {
  const doc: OpenApiDocument = {
    servers: [{ url: "https://api.pets.example" }],
    paths: { "/pets/{id}": { put: { operationId: "upsertPet", responses: {} } } },
  };
  it("stamps by-claim on the emitted PUT signature — no path to by-construction", () => {
    const sigs = openapiToSignatures(doc, "pets");
    const put = sigs.find((s) => s.method === "upsertPet")!;
    expect(put.effectClass).toBe("write-idempotent");
    expect(put.idempotenceProvenance).toBe("by-claim");
  });
  it("that signature therefore PAUSEs when unattested", () => {
    const sigs = openapiToSignatures(doc, "pets");
    const put = sigs.find((s) => s.method === "upsertPet")!;
    expect(approvalForSignature(put)).toBe(true);
  });
  it("and auto-executes once attested", () => {
    const sigs = openapiToSignatures(doc, "pets");
    const put = sigs.find((s) => s.method === "upsertPet")!;
    expect(approvalForSignature(put, [{ connector: "pets", method: "upsertPet" }])).toBe(false);
  });
});

// Belt-and-suspenders (playbook's own instruction): a hand-authored
// write-idempotent entry must declare idempotenceProvenance EXPLICITLY, so
// the fail-safe default never silently hides a real omission — a future
// entry that forgets the field fails HERE, loudly, not by quietly PAUSing
// in production without anyone noticing why.
describe("lint: every hand-authored write-idempotent entry declares provenance explicitly", () => {
  it("no EFFECT_SIGNATURES entry relies on the fail-safe default", () => {
    const undeclared = EFFECT_SIGNATURES.filter((s) => s.effectClass === "write-idempotent" && s.idempotenceProvenance === undefined);
    expect(undeclared).toEqual([]);
  });
});
