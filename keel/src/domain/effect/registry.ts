/**
 * effect/registry.ts — the operator-declared per-method effect backfill
 * (BRIEF-KEEL-EFFECT-SIGNATURE-001's "First live milestone"). Mirrors
 * `inbound/registry.ts`'s placement exactly: plain, substrate-free data (no
 * I/O), vetted by a human, not derived at runtime.
 *
 * This is the SINGLE authority `requiresApproval` (D8, live) and
 * `GatePolicy.effectful` (6a spec-loop, once fully backfilled) both derive
 * from — INV-EFFECT-APPROVAL-DERIVED. Backfilled here: `store` (renamed from
 * `ledger`, BRIEF-KEEL-EFFECT-SIGNATURE-001 v1.2 §A2.4 — three methods, three
 * real effect classes) and the three read connectors (`fx`, `geo`,
 * `weather`). `gate`, `echo`, and the foreign-MCP connector are still not
 * backfilled — the flat `GatePolicy.effectful` list is not swapped over
 * until they are. `billing` was struck (v1.2): its only method is a pure
 * read, so it was never a real effectful entry.
 */
import type { EffectSignature } from "./signature";

export const EFFECT_SIGNATURES: readonly EffectSignature[] = [
  // --- store (was ledger): the three real effect classes --------------------
  {
    connector: "store", method: "select", effectClass: "read",
    reads: [{ origin: "keel:internal/store", description: "read-before-write lookup by key" }],
    writes: [],
    response: { fields: {} }, // response is an array of records; left open (not wired into verifyEffect yet)
    idempotency: "idempotent-by-log",
    errors: [],
    argSchema: { key: { type: "pattern", pattern: "^.+$" } },
  },
  {
    connector: "store", method: "ensure", effectClass: "write-idempotent",
    reads: [{ origin: "keel:internal/store", description: "internal read-before-write check" }],
    writes: [{ origin: "keel:internal/store", description: "inserts one record for key, only if absent" }],
    response: { fields: { ok: { type: "boolean" }, count: { type: "number" } } },
    // INV-EFFECT-IDEMPOTENCY-ANCHORED: the key lives in argSchema.key — the
    // connector's own check-then-write makes repeating this call with the
    // same key a no-op, which is WHY it doesn't need requiresApproval.
    idempotency: "idempotent-by-key",
    // BRIEF-KEEL-CONNECTOR-DESCRIPTOR-001 v1.1: earned, not stamped — the
    // single-statement INSERT...WHERE NOT EXISTS upsert (do-ledger.adapter.ts)
    // is concurrency-tested (test/ledger-usecase.test.ts's 20-way Promise.all
    // race, and the live 12-concurrent-admission check from the store
    // playbook) — INV-EFFECT-IDEMPOTENT-WRITE-ATOMIC actually holds here.
    idempotenceProvenance: "by-construction",
    errors: ["Conflict"],
    argSchema: { key: { type: "pattern", pattern: "^.+$" }, value: { type: "pattern", pattern: "^.*$" } },
  },
  {
    connector: "store", method: "append", effectClass: "write-effectful",
    reads: [],
    writes: [{ origin: "keel:internal/store", description: "always appends one record for key, no existence check" }],
    response: { fields: { ok: { type: "boolean" } } },
    idempotency: "non-idempotent",
    errors: ["Conflict"],
    argSchema: { key: { type: "pattern", pattern: "^.+$" }, value: { type: "pattern", pattern: "^.*$" } },
  },
  // --- fx / geo / weather: read-only, real network origins ------------------
  {
    connector: "fx", method: "rate", effectClass: "read",
    reads: [{ origin: "https://api.frankfurter.dev", description: "latest reference FX rate" }],
    writes: [],
    response: { fields: {} },
    idempotency: "idempotent-by-key",
    errors: ["RateLimited", "InvalidResponse"],
    argSchema: { from: { type: "pattern", pattern: "^[A-Z]{3}$" }, to: { type: "pattern", pattern: "^[A-Z]{3}$" } },
  },
  {
    connector: "geo", method: "lookup", effectClass: "read",
    reads: [{ origin: "https://geocoding-api.open-meteo.com", description: "geocode a city name" }],
    writes: [],
    response: { fields: {} },
    idempotency: "idempotent-by-key",
    errors: ["RateLimited", "InvalidResponse"],
    argSchema: { city: { type: "pattern", pattern: "^.+$" } },
  },
  {
    connector: "weather", method: "current", effectClass: "read",
    reads: [{ origin: "https://api.open-meteo.com", description: "current weather at coordinates" }],
    writes: [],
    response: { fields: {} },
    idempotency: "idempotent-by-key",
    errors: ["RateLimited", "InvalidResponse"],
    argSchema: { latitude: { type: "number" }, longitude: { type: "number" } },
  },
  // --- foreign.upsertRecord: a MERGED foreign PUT --------------------------
  // BRIEF-KEEL-CONNECTOR-DESCRIPTOR-001 v1.1 live milestone fixture: stands in
  // for what `openapiToSignatures` would emit for a real foreign PUT and an
  // operator merging it here — by-claim, unattested by default, so this is
  // the entry that proves INV-DESC-FOREIGN-IDEMPOTENCE-UNOWNED live (a
  // foreign "idempotent" claim PAUSEs until an operator explicitly attests
  // it via ATTESTED_IDEMPOTENT below).
  {
    connector: "foreign", method: "upsertRecord", effectClass: "write-idempotent",
    reads: [],
    writes: [{ origin: "https://mock.example/fixture-mcp-mock", description: "upserts one record by id (foreign-claimed idempotent)" }],
    response: { fields: { ok: { type: "boolean" } } },
    idempotency: "idempotent-by-key",
    idempotenceProvenance: "by-claim",
    errors: ["InvalidResponse"],
    argSchema: { id: { type: "pattern", pattern: "^.+$" } },
  },
  // --- state / git: PLAYBOOK-KEEL-WRITE-ROLLBACK-001 (A2) --------------------
  // The A1 workspace connectors' write fold. All write-effectful (D8 always
  // gates them, same mechanism store.append/foreign.upsertRecord already use
  // -- no new approval path). `revertible: true` for every one that touches
  // only the virtual Workspace (WorkspaceStateConnector/WorkspaceGitConnector
  // declare a real `revert`, INV-RB-ATOMIC) -- `git.push` is the one
  // exception (INV-RB-VIRTUAL-ONLY): a real, external, one-way effect;
  // rollback never un-pushes.
  {
    connector: "state", method: "writeFile", effectClass: "write-effectful",
    reads: [{ origin: "keel:workspace/sqlite", description: "pre-image read before overwrite (INV-RB-PREIMAGE)" }],
    writes: [{ origin: "keel:workspace/sqlite", description: "writes file content at path" }],
    response: { fields: { ok: { type: "boolean" }, path: { type: "pattern", pattern: "^.+$" } } },
    idempotency: "non-idempotent",
    errors: [],
    argSchema: { path: { type: "pattern", pattern: "^.+$" }, content: { type: "pattern", pattern: "^.*$" } },
    revertible: true,
  },
  {
    connector: "state", method: "rm", effectClass: "write-effectful",
    reads: [{ origin: "keel:workspace/sqlite", description: "pre-image read before delete (INV-RB-PREIMAGE)" }],
    writes: [{ origin: "keel:workspace/sqlite", description: "deletes the file at path" }],
    response: { fields: { ok: { type: "boolean" } } },
    idempotency: "non-idempotent",
    errors: [],
    argSchema: { path: { type: "pattern", pattern: "^.+$" } },
    revertible: true,
  },
  {
    connector: "state", method: "mv", effectClass: "write-effectful",
    reads: [{ origin: "keel:workspace/sqlite", description: "pre-image of src and dest before move (INV-RB-PREIMAGE)" }],
    writes: [{ origin: "keel:workspace/sqlite", description: "moves src to dest" }],
    response: { fields: { ok: { type: "boolean" } } },
    idempotency: "non-idempotent",
    errors: [],
    argSchema: { src: { type: "pattern", pattern: "^.+$" }, dest: { type: "pattern", pattern: "^.+$" } },
    revertible: true,
  },
  {
    connector: "state", method: "cp", effectClass: "write-effectful",
    reads: [{ origin: "keel:workspace/sqlite", description: "pre-image of dest before overwrite (INV-RB-PREIMAGE)" }],
    writes: [{ origin: "keel:workspace/sqlite", description: "copies src to dest" }],
    response: { fields: { ok: { type: "boolean" } } },
    idempotency: "non-idempotent",
    errors: [],
    argSchema: { src: { type: "pattern", pattern: "^.+$" }, dest: { type: "pattern", pattern: "^.+$" } },
    revertible: true,
  },
  {
    connector: "git", method: "add", effectClass: "write-effectful",
    reads: [],
    writes: [{ origin: "keel:workspace/git-index", description: "stages a path in the virtual repo's index" }],
    response: { fields: { added: { type: "pattern", pattern: "^.+$" } } },
    idempotency: "non-idempotent",
    errors: [],
    argSchema: { filepath: { type: "pattern", pattern: "^.+$" } },
    revertible: true,
  },
  {
    connector: "git", method: "commit", effectClass: "write-effectful",
    reads: [],
    writes: [{ origin: "keel:workspace/git-refs", description: "creates a commit, advances the local ref" }],
    response: { fields: { oid: { type: "pattern", pattern: "^.+$" } } },
    idempotency: "non-idempotent",
    errors: [],
    argSchema: { message: { type: "pattern", pattern: "^.+$" } },
    revertible: true,
  },
  {
    connector: "git", method: "push", effectClass: "write-effectful",
    reads: [],
    writes: [{ origin: "keel:configured-remote", description: "pushes local refs to the real, configured remote -- the one real-repo effect (B.3)" }],
    response: { fields: { ok: { type: "boolean" } } },
    idempotency: "non-idempotent",
    errors: ["PermissionDenied", "AuthenticationFailed"],
    argSchema: { remote: { type: "pattern", pattern: "^.*$" } },
    // revertible intentionally absent/false (INV-RB-VIRTUAL-ONLY): a landed
    // push is a real, external, one-way effect. Rollback reverts the virtual
    // Workspace up to this call and never un-pushes.
  },
];

export function effectSignatureFor(connector: string, method: string): EffectSignature | undefined {
  return EFFECT_SIGNATURES.find((s) => s.connector === connector && s.method === method);
}

/** BRIEF-KEEL-CONNECTOR-DESCRIPTOR-001 v1.1 (FU-DESC-1): operator
 *  attestations — an EXPLICIT, human sign-off that a specific (connector,
 *  method) claimed write-idempotent is safe to auto-execute despite KEEL
 *  being unable to verify it structurally (a by-claim signature — e.g. an
 *  imported foreign PUT). Sourced from operator config ONLY: never derived
 *  from a spec, never set by the importer, never inferred. Defaults to
 *  false for anything not explicitly listed here. */
export interface Attestation { readonly connector: string; readonly method: string; }
export const ATTESTED_IDEMPOTENT: readonly Attestation[] = [];

/** `attestations` defaults to the real operator config (`ATTESTED_IDEMPOTENT`)
 *  but is injectable — keeps this a pure, directly-testable function (rows
 *  in, decision out) rather than one that only reads module-global state. */
export function attestedIdempotent(connector: string, method: string, attestations: readonly Attestation[] = ATTESTED_IDEMPOTENT): boolean {
  return attestations.some((a) => a.connector === connector && a.method === method);
}

/** The whole table, in one pure function, over a SIGNATURE rather than a
 *  registry lookup — this is what makes the provenance/attestation branches
 *  directly testable against a synthetic (e.g. freshly-imported, not-yet-
 *  merged) signature without mutating `EFFECT_SIGNATURES` or `
 *  ATTESTED_IDEMPOTENT` to do it. `requiresApprovalFor` (below) is the
 *  registry-bound wrapper D8 actually calls.
 *   - pure / read              -> false (never gates)
 *   - write-effectful          -> true (always gates)
 *   - write-idempotent:
 *       - by-construction      -> false (KEEL built and proved the atomicity)
 *       - by-claim (or absent — fail-safe default) -> true, UNLESS an
 *         operator has explicitly attested this exact (connector, method) */
export function approvalForSignature(sig: EffectSignature, attestations: readonly Attestation[] = ATTESTED_IDEMPOTENT): boolean {
  switch (sig.effectClass) {
    case "pure":
    case "read":
      return false;
    case "write-effectful":
      return true;
    case "write-idempotent": {
      // Fail-safe default: an ABSENT provenance on a write-idempotent
      // signature is treated as "by-claim", never "by-construction". A
      // missing field PAUSEs rather than silently auto-executing.
      const provenance = sig.idempotenceProvenance ?? "by-claim";
      if (provenance === "by-construction") return false;
      return !attestedIdempotent(sig.connector, sig.method, attestations);
    }
    default: {
      const _never: never = sig.effectClass;
      return _never;
    }
  }
}

/** D8's derivation point (INV-EFFECT-APPROVAL-DERIVED), now provenance-aware
 *  (INV-DESC-FOREIGN-IDEMPOTENCE-UNOWNED): `effectClass` alone is not enough
 *  for `write-idempotent` — a MERGED FOREIGN write-idempotent signature is a
 *  CLAIM, not a KEEL-verified fact, so it must not silently skip D8 just
 *  because it says "idempotent" of itself. Undeclared methods (not yet
 *  backfilled) default to `false` — unannotated methods already execute
 *  immediately in codemode's own model; this preserves today's behavior for
 *  anything not yet backfilled. */
export function requiresApprovalFor(connector: string, method: string, attestations: readonly Attestation[] = ATTESTED_IDEMPOTENT): boolean {
  const sig = effectSignatureFor(connector, method);
  if (!sig) return false;
  return approvalForSignature(sig, attestations);
}

/** PLAYBOOK-KEEL-WRITE-ROLLBACK-001: whether a write-effectful (connector,
 *  method) declares a `revert` (INV-RB-VIRTUAL-ONLY) -- the adapter-side
 *  revert-completeness check reads this SAME registry entry rather than
 *  keeping a second, parallel list that could drift from it. Undeclared or
 *  non-write-effectful methods are never expected to revert. */
export function isRevertible(connector: string, method: string): boolean {
  const sig = effectSignatureFor(connector, method);
  return !!sig && sig.effectClass === "write-effectful" && sig.revertible === true;
}
