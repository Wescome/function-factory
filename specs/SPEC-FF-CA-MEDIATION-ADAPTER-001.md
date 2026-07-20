# SPEC-FF-CA-MEDIATION-ADAPTER-001 — CA→Mediation CommissionRequest Adapter

**Status:** Draft · **Layer:** I-layer · **Date:** 2026-06-16
**Owner:** Architect (spec) → Workflow agents (implementation)
**Architectural decision (closed, do not re-open):** `orgId` is the identity key throughout the I-layer. `repoId` is metadata carried on signals but keys nothing. Mediation must be rekeyed from `mediation-agent:{repoId}` to `mediation-agent:{orgId}`.

---

## Purpose

The Commissioning Agent (CA) finishes Phase 3 (WorkGraph authoring) and must hand the
WorkGraph to the Mediation Agent to begin the nine-step compile sequence. Today the CA
POSTs an **ad-hoc, untyped body** (`{ workGraph, orgId, dispositionEventId }`) to the
Mediation DO, but the Mediation DO's `handleCommission` expects a typed
**`CommissionRequest`** (`runId`, `workGraphId`, `workGraphVersion`, `d1ArtifactRefs[]`,
`eluciationArtifactId`, …). The two contracts do not match, and the Mediation DO writes
`undefined` into its `meta` table for every field it reads off the request. There is also
no validation gate: malformed requests reach SQLite writes before any rejection.

This spec defines the **adapter** the CA must apply when constructing the Mediation
`CommissionRequest`, the **derivation rules** for every field (especially `runId`, which
must be deterministic and never received from outside), the **identity rekey** to `orgId`,
and the **validation gate** the Mediation DO must enforce before any write.

## JTBD

When the Commissioning Agent has authored a WorkGraph and needs to commission it, I want to
hand the Mediation Agent a fully-formed, validated `CommissionRequest` keyed by `orgId`, so I
can guarantee the compile sequence is idempotent, traceable to its disposition event, and
rejected cleanly at the boundary if any required field is missing.

---

## Context

### Current CA emission (the defect)
`packages/commissioning-agent/src/index.ts` (Phase 3 → Mediation POST, ~lines 298–317):

- Targets `idFromName('mediation-agent:${this.orgId}')` — **already correct on `orgId`**;
  the residual `{repoId}` references to fix live in the Mediation package docs/comments and
  any other caller, not this line. Implementation must confirm there is exactly one
  `idFromName('mediation-agent:…')` call and that it is keyed on `orgId`.
- Sends body `{ workGraph, orgId, dispositionEventId }` — **does not match** the
  `CommissionRequest` interface.
- Path is `https://mediation-agent/commission` (DO-internal URL; only the pathname matters).

### Target contract
`packages/mediation-agent/src/types.ts` — `CommissionRequest`:

| Field | Type | Notes |
|-------|------|-------|
| `runId` | `string` | "SHA-256 deterministic run identifier" |
| `orgId` | `string` | identity key |
| `workGraphId` | `string` | |
| `workGraphVersion` | `string` | |
| `d1ArtifactRefs` | `string[]` | "D1 row keys for WorkGraph artifact graph atoms" |
| `eluciationArtifactId` | `string` | **misspelled on purpose — load-bearing** (matches `META_KEYS.eluciationArtifactId` and DDL) |
| `stalenessThresholdHours?` | `number` | default 24h, omit to accept default |

### WorkGraph source (`packages/commissioning-agent/src/schemas.ts`)
The `WorkGraph` interface has: `id` (WG-*), `orgId`, `dispositionEventId`, `producedBy`,
`producedAt`, `pressure`, `capability`, `functionProposal`, `prd`. **There is no `version`
field and no `elucidationArtifactId` field on WorkGraph** — those must be sourced elsewhere
(see rules 3 and 4).

### Mediation persistence (`packages/mediation-agent/src/db/schema.ts`)
The `meta` table is `(key TEXT PRIMARY KEY, value TEXT NOT NULL)`. `value` is `NOT NULL`,
so writing `undefined`/`null` for any field (the current behavior) is a latent constraint
violation. The validation gate (rule 7) closes this.

---

## Spec (numbered rules)

### R1 — CommissionRequest shape the CA MUST send
The CA constructs and POSTs exactly this object (no extra keys) to the Mediation DO
`/commission` endpoint:

```
{
  runId,                  // R2 — derived, never received
  orgId,                  // = CA DO orgId (this.orgId)
  workGraphId,            // R3 — from workGraph.id
  workGraphVersion,       // R3 — from workGraph.producedAt (ISO)
  d1ArtifactRefs,         // R5 — [] for v1
  eluciationArtifactId    // R4 — from signal.elucidationArtifactId (note misspelled target)
  // stalenessThresholdHours intentionally omitted — Mediation default (24h) applies
}
```

Field sources:
- `orgId` ← `this.orgId` (the CA DO's resolved org identity).
- The legacy keys `workGraph` (full object) and `dispositionEventId` (top-level) are
  **removed** from the request body. `dispositionEventId` survives only inside the `runId`
  derivation (R2). The full `workGraph` object is no longer transmitted in v1 (see R5 TODO).

### R2 — `runId` MUST be derived, never received from outside
`runId` is a deterministic function of stable inputs so that a retried commission for the
same disposition produces the **same** `runId` and the Mediation DO's idempotency check
(`checkIdempotency`) collapses the retry to a cached success.

- **Inputs:** the concatenation `orgId + workGraph.id + signal.dispositionEventId`.
- **Algorithm:** SHA-256 of the UTF-8 bytes of that concatenation, lowercase hex-encoded.
- **Format:** prefix the hex digest with `RUN-`. Result example: `RUN-9f86d0818...`.
- The CA MUST NOT accept a `runId` from the inbound signal, from the gateway, or from any
  other party. Any `runId` field present on inbound data is ignored for this derivation.
- Recommended: a single helper (e.g. `deriveRunId(orgId, workGraphId, dispositionEventId)`)
  is the only place that mints `runId`, so the algorithm has exactly one definition.

### R3 — `workGraphId` and `workGraphVersion` sources
- `workGraphId` ← `workGraph.id` (the WG-* identifier already on the authored WorkGraph).
- `workGraphVersion` ← `workGraph.producedAt`. The `WorkGraph` interface has **no version
  field**, so the ISO-8601 `producedAt` timestamp is used as the version string. This is
  monotonic per WorkGraph production and satisfies Mediation's `workGraphVersion` (echoed in
  the success response and persisted in `meta`).
- Both values must be non-empty strings before the request is sent; if `workGraph.id` or
  `workGraph.producedAt` is empty, the CA fails the commission locally (do not send an
  invalid request and rely on the downstream 400).

### R4 — `eluciationArtifactId` source and the load-bearing misspelling
- Source value: `signal.elucidationArtifactId` (correct spelling, from
  `CommissioningSignalSchema`).
- Target field: `eluciationArtifactId` (**Mediation's misspelling, intentional**). The
  adapter MUST map the correctly-spelled source onto the misspelled target key. Do **not**
  "fix" the Mediation spelling — `META_KEYS.eluciationArtifactId` and any downstream readers
  depend on it. The misspelling is contained entirely at this adapter boundary.

### R5 — `d1ArtifactRefs[]` for v1
- v1 value: empty array `[]`. The WorkGraph is not yet persisted to D1, so there are no row
  keys to reference.
- **TODO (v2):** once the WorkGraph is persisted to D1 (`workgraph_atoms` or equivalent),
  `d1ArtifactRefs` must carry the D1 row keys for the WorkGraph artifact-graph atoms so the
  Mediation compile sequence can fetch atoms by reference rather than receiving the inlined
  WorkGraph. Tracked as the successor to dropping the full `workGraph` object from the body.

### R6 — Mediation identity is keyed on `orgId`
- The CA stub MUST resolve the Mediation DO via `idFromName('mediation-agent:${orgId}')`,
  never `…:${repoId}`.
- All Mediation package documentation, header comments, and any other caller that still says
  `mediation-agent:{repoId}` (e.g. the file header of `mediation-agent-do.ts` "One DO
  instance per repo") MUST be updated to read `mediation-agent:{orgId}` / "one DO instance
  per org" so the identity model is unambiguous. `EscalationPayload.producedBy`
  documentation that reads `'mediation-agent:{repoId}'` is likewise corrected to
  `'mediation-agent:{orgId}'`.

### R7 — Validation gate in Mediation `handleCommission`
Before **any** SQLite write (no `setLifecycle`, no `setMetaValue`, no compile invocation),
`handleCommission` MUST:

1. Parse the JSON body (existing behavior; 400 on invalid JSON stays).
2. Validate the parsed body against a Zod `CommissionRequestSchema` whose shape mirrors the
   `CommissionRequest` interface exactly:
   - `runId`: non-empty string, MUST start with `RUN-`.
   - `orgId`: non-empty string.
   - `workGraphId`: non-empty string.
   - `workGraphVersion`: non-empty string.
   - `d1ArtifactRefs`: array of strings (may be empty).
   - `eluciationArtifactId`: non-empty string (misspelled key — schema key matches).
   - `stalenessThresholdHours`: optional positive number.
3. On validation failure, return **HTTP 400** with a structured error body
   `{ status: 'invalid_request', issues: [...] }` (Zod issue list), and perform **no
   writes**. This is distinct from the existing `422` compile-failure path: `400` =
   malformed request at the boundary; `422` = a well-formed request that failed the compile
   sequence.
4. Only after validation passes may the existing `COMPILING` transition and `setMetaValue`
   sequence run. This guarantees the `meta.value NOT NULL` constraint can never be hit by a
   missing field, because every required field is proven present first.

### R8 — Idempotency interplay (informative)
Because `runId` is deterministic (R2), a second commission for the same
`(orgId, workGraphId, dispositionEventId)` produces the same `runId`; Mediation's
`checkIdempotency` then returns the cached `seeded` response. The validation gate (R7) runs
**before** the idempotency check only insofar as the body must be well-formed; the existing
order (parse JSON → idempotency → compile) is preserved with Zod validation inserted
immediately after JSON parse and before the idempotency lookup, so a malformed retry is
rejected rather than silently matched.

---

## Open items / TODOs

- **TODO-1 (R5):** Persist WorkGraph to D1 and populate `d1ArtifactRefs[]`; stop inlining /
  dropping the full WorkGraph. Successor spec required.
- **TODO-2 (R6):** Sweep the repo for remaining `mediation-agent:{repoId}` strings in
  comments/docs and `EscalationPayload.producedBy` and update to `{orgId}`. Run
  `tessera_impact` on `idFromName` call sites before editing.
- **TODO-3 (R2):** Confirm SHA-256 is available in the CA DO runtime via Web Crypto
  (`crypto.subtle.digest('SHA-256', …)`); the derivation helper is async and the Phase 3
  hand-off must `await` it.
- **OPEN-1:** Decide whether `stalenessThresholdHours` should ever be set by the CA (e.g.
  per-vertical domain profile). v1 omits it and accepts Mediation's 24h default.
