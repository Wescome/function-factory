/**
 * effect/import/openapi.ts — BRIEF-KEEL-CONNECTOR-DESCRIPTOR-001: derive
 * EffectSignature[] from an OpenAPI 3.x document instead of hand-declaring
 * each method. Pure, substrate-free (D6) — this file touches no I/O; the
 * caller is responsible for fetching/parsing the document into this shape.
 *
 * THE TWO RULES THAT MAKE THIS SAFE:
 *  - INV-DESC-IMPORT-DESCRIPTIVE: this module only EMITS `EffectSignature[]`.
 *    It has no path to `inbound/registry.ts`, `visibleSpecs`, or admission —
 *    importing a spec grants nothing and makes nothing callable. Wiring an
 *    imported signature into a live connector is a SEPARATE, human, operator
 *    act (same as hand-declaring one in `effect/registry.ts` always was).
 *  - INV-DESC-DERIVED-ANCHORED: a derived signature is just data. It is
 *    checked against the RECORDED ConnectorCall by the same `verifyEffect`
 *    every hand-declared signature goes through — a spec that mislabels a
 *    writing `GET` as `read` fails at the anchor (verifyEffect), not here.
 *  - INV-DESC-CONSERVATIVE-DEFAULT: anything this importer can't confidently
 *    classify defaults to `write-effectful` (PAUSE), never `read`.
 */
import type { EffectSignature, IdempotenceProvenance } from "../signature";
import type { EffectClass } from "../lattice";
import type { IdempotencyClass } from "../idempotency";
import type { FieldSpec, SchemaFields, ResponseSchema } from "../../foreign/policy";
import { statusToErrorClass } from "./status-map";

// --- Minimal OpenAPI 3.x document shape (only what this importer reads) ----
export interface OpenApiSchema {
  readonly type?: "string" | "number" | "integer" | "boolean" | "object" | "array";
  readonly enum?: readonly string[];
  readonly pattern?: string;
  readonly properties?: Record<string, OpenApiSchema>;
  readonly items?: OpenApiSchema;
}
export interface OpenApiMediaType { readonly schema?: OpenApiSchema; }
export interface OpenApiParameter {
  readonly name: string;
  readonly in: "query" | "path" | "header" | "cookie";
  readonly schema?: OpenApiSchema;
}
export interface OpenApiRequestBody {
  readonly content?: Record<string, OpenApiMediaType>;
}
export interface OpenApiResponse {
  readonly content?: Record<string, OpenApiMediaType>;
}
export interface OpenApiOperation {
  readonly operationId?: string;
  /** Vendor extension: an author may explicitly declare a PATCH idempotent
   *  (e.g. a full-replace PATCH). Absent -> conservative (write-effectful). */
  readonly "x-idempotent"?: boolean;
  readonly parameters?: readonly OpenApiParameter[];
  readonly requestBody?: OpenApiRequestBody;
  readonly responses?: Record<string, OpenApiResponse>;
}
export type OpenApiPathItem = Partial<Record<string, OpenApiOperation>>;
export interface OpenApiServer { readonly url: string; }
export interface OpenApiDocument {
  readonly servers?: readonly OpenApiServer[];
  readonly paths: Record<string, OpenApiPathItem>;
}

// --- verb -> effectClass / idempotency (Descriptor II.1) --------------------
function classifyVerb(verb: string, op: OpenApiOperation): { effectClass: EffectClass; idempotency: IdempotencyClass } {
  switch (verb.toLowerCase()) {
    case "get":
    case "head":
      return { effectClass: "read", idempotency: "idempotent-by-log" };
    case "put":
    case "delete":
      return { effectClass: "write-idempotent", idempotency: "idempotent-by-key" };
    case "post":
      return { effectClass: "write-effectful", idempotency: "non-idempotent" };
    case "patch":
      // Conservative unless the operation itself declares idempotence.
      return op["x-idempotent"]
        ? { effectClass: "write-idempotent", idempotency: "idempotent-by-key" }
        : { effectClass: "write-effectful", idempotency: "non-idempotent" };
    default:
      // INV-DESC-CONSERVATIVE-DEFAULT: unknown/custom verb -> the least
      // permissive class. Never `read` by default.
      return { effectClass: "write-effectful", idempotency: "non-idempotent" };
  }
}

// --- OpenAPI schema -> FieldSpec (reuses the foreign-tool policy vocabulary) -
function toFieldSpec(schema: OpenApiSchema | undefined): FieldSpec {
  if (!schema) return { type: "pattern", pattern: "^.*$" }; // undeclared shape: permissive, not invented-restrictive
  if (schema.enum && schema.enum.length) return { type: "enum", values: schema.enum };
  switch (schema.type) {
    case "number":
    case "integer":
      return { type: "number" };
    case "boolean":
      return { type: "boolean" };
    case "array":
      return { type: "array", items: toFieldSpec(schema.items) };
    case "object":
      return { type: "shape", fields: toSchemaFields(schema.properties) };
    case "string":
    default:
      // No free-text type (foreign/policy.ts's rule) — bound it. Use the
      // spec's own pattern if it declared one; otherwise permissive, since
      // inventing a restrictive pattern the spec never declared would
      // misrepresent what the API actually accepts.
      return { type: "pattern", pattern: schema.pattern ?? "^.*$" };
  }
}
function toSchemaFields(properties: Record<string, OpenApiSchema> | undefined): SchemaFields {
  const fields: SchemaFields = {};
  for (const [k, v] of Object.entries(properties ?? {})) fields[k] = toFieldSpec(v);
  return fields;
}

// --- requestBody + parameters -> argSchema ---------------------------------
function operationArgSchema(op: OpenApiOperation): SchemaFields {
  const fields: SchemaFields = {};
  for (const p of op.parameters ?? []) fields[p.name] = toFieldSpec(p.schema);
  const bodySchema = op.requestBody?.content?.["application/json"]?.schema;
  if (bodySchema?.properties) Object.assign(fields, toSchemaFields(bodySchema.properties));
  return fields;
}

// --- responses[2xx] -> response; responses[4xx/5xx] -> errors --------------
function operationResponseSchema(op: OpenApiOperation): ResponseSchema {
  const entry = Object.entries(op.responses ?? {}).find(([status]) => /^2\d\d$/.test(status));
  const schema = entry?.[1]?.content?.["application/json"]?.schema;
  // A bare top-level array response doesn't fit ResponseSchema's
  // object-of-named-fields shape (same limitation the hand-authored fx/geo/
  // weather entries in effect/registry.ts already accept) — left open rather
  // than inventing an implicit wrapper. An object-typed 2xx projects normally.
  if (!schema || schema.type === "array") return { fields: {} };
  return { fields: toSchemaFields(schema.properties) };
}
function operationErrors(op: OpenApiOperation): ErrorClassList {
  const classes = new Set<string>();
  for (const status of Object.keys(op.responses ?? {})) {
    const n = Number(status);
    if (!Number.isFinite(n) || n < 400) continue;
    const cls = statusToErrorClass(n);
    if (cls) classes.add(cls);
  }
  return [...classes] as ErrorClassList;
}
type ErrorClassList = EffectSignature["errors"];

/** One EffectSignature per (path, method) operation. `connectorName` is the
 *  single connector identity the whole document is imported under (an
 *  imported REST API is ONE connector; each operation is one of its methods) —
 *  `method` is the operation's `operationId` if declared, else a stable
 *  synthesized `"VERB /path"` id. */
export function openapiToSignatures(doc: OpenApiDocument, connectorName: string): EffectSignature[] {
  // OD-EFFECT-3: identity-bound, mirroring isAllowedServer's exact-origin
  // match — the declared server URL if the doc has one, not just the
  // connector's label.
  const origin = doc.servers?.[0]?.url ?? connectorName;
  const out: EffectSignature[] = [];
  for (const [path, item] of Object.entries(doc.paths ?? {})) {
    for (const [verb, op] of Object.entries(item)) {
      if (!op) continue;
      const { effectClass, idempotency } = classifyVerb(verb, op);
      // BRIEF-KEEL-CONNECTOR-DESCRIPTOR-001 v1.1 (FU-DESC-1): imported is
      // ALWAYS by-claim — there is no path for the importer to emit
      // by-construction (INV-DESC-FOREIGN-IDEMPOTENCE-UNOWNED). A merged
      // foreign PUT/DELETE (or x-idempotent PATCH) still PAUSEs unless an
      // operator explicitly attests it.
      const idempotenceProvenance: IdempotenceProvenance | undefined =
        effectClass === "write-idempotent" ? "by-claim" : undefined;
      out.push({
        connector: connectorName,
        method: op.operationId ?? `${verb.toUpperCase()} ${path}`,
        effectClass,
        idempotency,
        idempotenceProvenance,
        reads: effectClass === "read" || effectClass === "pure" ? [{ origin, description: `${verb.toUpperCase()} ${path}` }] : [],
        writes: effectClass === "write-idempotent" || effectClass === "write-effectful" ? [{ origin, description: `${verb.toUpperCase()} ${path}` }] : [],
        argSchema: operationArgSchema(op),
        response: operationResponseSchema(op),
        errors: operationErrors(op),
      });
    }
  }
  return out;
}
