/** BRIEF-KEEL-CONNECTOR-DESCRIPTOR-001: derive EffectSignature[] from an
 *  OpenAPI document. Descriptive only, anchored, conservative by default. */
import { describe, it, expect } from "vitest";
import {
  openapiToSignatures, statusToErrorClass, verifyEffect, projectFields,
  visibleSpecs, DEFAULT_REGISTRY,
  type OpenApiDocument,
} from "../src/domain/index";
import { EffectSignatureConnectorRegistry } from "../src/adapters/effect/connector-registry.adapter";
import type { ConnectorCall } from "../src/domain/lineage/nodes";

// A small, real-shaped spec: a GET list, a PUT upsert, a POST create, plus a
// custom/unrecognized verb (some gateways route on "QUERY" or similar).
const PETS_SPEC: OpenApiDocument = {
  servers: [{ url: "https://api.pets.example" }],
  paths: {
    "/pets": {
      get: {
        operationId: "listPets",
        responses: {
          "200": { content: { "application/json": { schema: { type: "array", items: { type: "object", properties: { id: { type: "string" }, name: { type: "string" } } } } } } },
          "429": {},
        },
      },
      post: {
        operationId: "createPet",
        requestBody: { content: { "application/json": { schema: { type: "object", properties: { name: { type: "string" } } } } } },
        responses: {
          "201": { content: { "application/json": { schema: { type: "object", properties: { id: { type: "string" }, name: { type: "string" } } } } } },
          "409": {},
          "401": {},
        },
      },
    },
    "/pets/{id}": {
      put: {
        operationId: "upsertPet",
        parameters: [{ name: "id", in: "path", schema: { type: "string" } }],
        requestBody: { content: { "application/json": { schema: { type: "object", properties: { name: { type: "string" } } } } } },
        responses: {
          "200": { content: { "application/json": { schema: { type: "object", properties: { id: { type: "string" }, name: { type: "string" } } } } } },
          "404": {},
        },
      },
      query: { // custom/unrecognized verb — must default conservatively
        operationId: "queryPet",
        responses: { "200": {} },
      },
    },
  },
};

describe("openapiToSignatures — verb -> effectClass/idempotency (Descriptor II.1)", () => {
  const sigs = openapiToSignatures(PETS_SPEC, "pets");
  const byMethod = (m: string) => sigs.find((s) => s.method === m)!;

  it("GET -> read / idempotent-by-log", () => {
    const s = byMethod("listPets");
    expect(s.effectClass).toBe("read");
    expect(s.idempotency).toBe("idempotent-by-log");
  });
  it("PUT -> write-idempotent / idempotent-by-key", () => {
    const s = byMethod("upsertPet");
    expect(s.effectClass).toBe("write-idempotent");
    expect(s.idempotency).toBe("idempotent-by-key");
  });
  it("POST -> write-effectful / non-idempotent", () => {
    const s = byMethod("createPet");
    expect(s.effectClass).toBe("write-effectful");
    expect(s.idempotency).toBe("non-idempotent");
  });
  it("custom/unrecognized verb -> write-effectful (INV-DESC-CONSERVATIVE-DEFAULT), never read", () => {
    const s = byMethod("queryPet");
    expect(s.effectClass).toBe("write-effectful");
  });
  it("argSchema/response/errors populate from the spec", () => {
    const put = byMethod("upsertPet");
    expect(put.argSchema.id).toBeDefined();
    expect(put.argSchema.name).toBeDefined();
    expect(put.response.fields.id).toBeDefined();
    expect(put.errors).toContain("InvalidResponse"); // 404
    const post = byMethod("createPet");
    expect(post.errors).toContain("Conflict"); // 409
    expect(post.errors).toContain("AuthenticationFailed"); // 401
    const get = byMethod("listPets");
    expect(get.errors).toContain("RateLimited"); // 429
    // bare top-level array response: left open (documented limitation), not invented
    expect(get.response.fields).toEqual({});
  });
  it("origin binds to the declared server URL (OD-EFFECT-3), not just the connector label", () => {
    const s = byMethod("listPets");
    expect(s.reads[0]?.origin).toBe("https://api.pets.example");
  });
  it("PATCH without x-idempotent is conservative (write-effectful)", () => {
    const doc: OpenApiDocument = { paths: { "/x": { patch: { operationId: "patchX", responses: {} } } } };
    expect(openapiToSignatures(doc, "x").find((s) => s.method === "patchX")!.effectClass).toBe("write-effectful");
  });
  it("PATCH with x-idempotent:true is write-idempotent", () => {
    const doc: OpenApiDocument = { paths: { "/x": { patch: { operationId: "patchX", "x-idempotent": true, responses: {} } } } };
    expect(openapiToSignatures(doc, "x").find((s) => s.method === "patchX")!.effectClass).toBe("write-idempotent");
  });
});

describe("statusToErrorClass (Descriptor II.3)", () => {
  it("maps the documented statuses", () => {
    expect(statusToErrorClass(400)).toBe("InvalidResponse");
    expect(statusToErrorClass(401)).toBe("AuthenticationFailed");
    expect(statusToErrorClass(403)).toBe("PermissionDenied");
    expect(statusToErrorClass(404)).toBe("InvalidResponse");
    expect(statusToErrorClass(409)).toBe("Conflict");
    expect(statusToErrorClass(429)).toBe("RateLimited");
    expect(statusToErrorClass(501)).toBe("OperationUnsupported");
    expect(statusToErrorClass(503)).toBe("RateLimited");
  });
  it("an unrecognized status maps to nothing — never guesses", () => {
    expect(statusToErrorClass(418)).toBeUndefined();
  });
});

describe("Milestone 2 — feed to the registry: requiresApproval derives, INV-DESC-IMPORT-DESCRIPTIVE holds", () => {
  it("GET/PUT -> requiresApproval false; POST -> true", () => {
    const sigs = openapiToSignatures(PETS_SPEC, "pets");
    // simulate feeding emitted signatures into the same registry shape
    // EFFECT_SIGNATURES/EffectSignatureConnectorRegistry already consumes
    const registry = new EffectSignatureConnectorRegistry();
    const original = registry.resolve(["pets"])[0]; // not backfilled -> undefined signatures
    expect(original?.requiresApproval).toBe(false); // undeclared connector: no PAUSE by default

    const get = sigs.find((s) => s.method === "listPets")!;
    const put = sigs.find((s) => s.method === "upsertPet")!;
    const post = sigs.find((s) => s.method === "createPet")!;
    expect(get.effectClass === "write-effectful").toBe(false);
    expect(put.effectClass === "write-effectful").toBe(false);
    expect(post.effectClass === "write-effectful").toBe(true);
  });
  it("importing adds ZERO callable connectors — visibleSpecs is untouched", () => {
    const before = visibleSpecs(DEFAULT_REGISTRY, ["keel:read", "keel:store-write"]);
    openapiToSignatures(PETS_SPEC, "pets"); // import — pure, no side effect anywhere
    const after = visibleSpecs(DEFAULT_REGISTRY, ["keel:read", "keel:store-write"]);
    expect(after).toEqual(before);
    expect(after).not.toContain("pets");
    expect(after).not.toContain("listPets");
  });
});

describe("Milestone 3 — anchor test (INV-DESC-DERIVED-ANCHORED)", () => {
  it("a GET-classed signature whose recorded call actually wrote fails verifyEffect, not import", () => {
    const sigs = openapiToSignatures(PETS_SPEC, "pets");
    const getSig = sigs.find((s) => s.method === "listPets")!;
    // getSig.writes is [] (read-classed) by construction; a signature that
    // WRONGLY declared writes for a read is exactly what verifyEffect anchors.
    const misdeclared = { ...getSig, writes: [{ origin: "https://api.pets.example" }] };
    const call: ConnectorCall = { seq: 0, connector: "pets", method: "listPets", args: {}, response: [] };
    const v = verifyEffect(misdeclared, call);
    expect(v.ok).toBe(false);
    expect(v.reasons.join(" ")).toContain("effectClass");
  });
});

describe("FieldSpec array (needed for OpenAPI's array-typed request/response fields)", () => {
  it("projects a well-formed array of shapes", () => {
    const schema = { tags: { type: "array" as const, items: { type: "pattern" as const, pattern: "^[a-z]+$" } } };
    const dropped: string[] = [];
    const out = projectFields({ tags: ["a", "b"] }, schema, dropped, "");
    expect(out.tags).toEqual(["a", "b"]);
    expect(dropped).toEqual([]);
  });
  it("drops the WHOLE array field if any element is invalid (fail closed, no partial truncation)", () => {
    const schema = { tags: { type: "array" as const, items: { type: "pattern" as const, pattern: "^[a-z]+$" } } };
    const dropped: string[] = [];
    const out = projectFields({ tags: ["a", "NOT-LOWER"] }, schema, dropped, "");
    expect(out.tags).toBeUndefined();
    expect(dropped).toContain("tags");
  });
  it("a non-array value for an array field is dropped", () => {
    const schema = { tags: { type: "array" as const, items: { type: "number" as const } } };
    const dropped: string[] = [];
    const out = projectFields({ tags: "not-an-array" }, schema, dropped, "");
    expect(out.tags).toBeUndefined();
    expect(dropped).toContain("tags");
  });
});
