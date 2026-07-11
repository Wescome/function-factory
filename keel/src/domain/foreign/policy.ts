/**
 * Phase 6b foreign-tool policy — the safety core of the MCP boundary. Pure,
 * substrate-free (D6). Two enforcement points, both proven necessary by the spike:
 *
 *  1. ALLOWLIST (INV-FOREIGN-CEILING): the DO host has OPEN egress (the sandbox
 *     does not), so the server allowlist is KEEL-enforced HERE, in code — the
 *     runtime will not stop a call to a non-allowlisted server. Identity-bound:
 *     exact origin match (scheme+host+port), never substring/name. Fail-closed.
 *
 *  2. RESPONSE PROJECTION (INV-FOREIGN-RESPONSE-PROJECTED): the model never
 *     receives a foreign tool's raw prose. A response is validated against a
 *     KEEL-authored schema; only typed/bounded values survive. There is NO
 *     free-text field type — to surface a string you must bound it (enum/pattern).
 *     So injected instructions in free text or unexpected fields cannot pass, BY
 *     CONSTRUCTION. Undeclared/invalid fields are reported as `dropped` — the
 *     divergence signal (INV-FOREIGN-DIVERGENCE: rug-pull shows up here).
 */

// --- 1. Allowlist ------------------------------------------------------------
export interface ForeignAllowlist {
  readonly servers: readonly string[]; // allowed server URLs; matched by exact origin
}
export function isAllowedServer(url: string, allow: ForeignAllowlist): boolean {
  let origin: string;
  try { origin = new URL(url).origin; } catch { return false; } // malformed -> deny
  return allow.servers.some((s) => {
    try { return new URL(s).origin === origin; } catch { return false; }
  });
}

// --- 2. Response projection --------------------------------------------------
export type FieldSpec =
  | { readonly type: "number" }
  | { readonly type: "boolean" }
  | { readonly type: "enum"; readonly values: readonly string[] }
  | { readonly type: "pattern"; readonly pattern: string } // bounded string
  | { readonly type: "shape"; readonly fields: SchemaFields };
export type SchemaFields = Record<string, FieldSpec>;
export interface ResponseSchema { readonly fields: SchemaFields; }
export interface Projection { readonly projected: Record<string, unknown>; readonly dropped: readonly string[]; }

const DROP = Symbol("drop");

function validateField(v: unknown, spec: FieldSpec, dropped: string[], path: string): unknown | typeof DROP {
  switch (spec.type) {
    case "number": return typeof v === "number" ? v : (dropped.push(path), DROP);
    case "boolean": return typeof v === "boolean" ? v : (dropped.push(path), DROP);
    case "enum": return typeof v === "string" && spec.values.includes(v) ? v : (dropped.push(path), DROP);
    case "pattern": return typeof v === "string" && new RegExp(spec.pattern).test(v) ? v : (dropped.push(path), DROP);
    case "shape": {
      if (!v || typeof v !== "object") { dropped.push(path); return DROP; }
      return projectFields(v, spec.fields, dropped, path);
    }
  }
}

function projectFields(obj: unknown, fields: SchemaFields, dropped: string[], prefix: string): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  const src = (obj && typeof obj === "object") ? (obj as Record<string, unknown>) : {};
  for (const [k, spec] of Object.entries(fields)) {
    const path = prefix ? `${prefix}.${k}` : k;
    const val = validateField(src[k], spec, dropped, path);
    if (val !== DROP) out[k] = val;
  }
  // undeclared fields present in the response are dropped (injection / rug-pull surface)
  for (const k of Object.keys(src)) {
    if (!(k in fields)) dropped.push(prefix ? `${prefix}.${k}` : k);
  }
  return out;
}

export function projectResponse(response: unknown, schema: ResponseSchema): Projection {
  const dropped: string[] = [];
  const projected = projectFields(response, schema.fields, dropped, "");
  return { projected, dropped };
}

/** Divergence (INV-FOREIGN-DIVERGENCE): a response diverges from its declared
 *  contract if any field was dropped (undeclared/invalid) or a declared field
 *  is missing from the projection. Checked EVERY call, not at connect time. */
export function hasDivergence(schema: ResponseSchema, proj: Projection): boolean {
  if (proj.dropped.length > 0) return true;
  return Object.keys(schema.fields).some((k) => !(k in proj.projected));
}
