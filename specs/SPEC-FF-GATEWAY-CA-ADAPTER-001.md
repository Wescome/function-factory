# SPEC-FF-GATEWAY-CA-ADAPTER-001 — Gateway→CA Translation Layer

**Status:** Draft · **Layer:** Gateway → I-layer · **Date:** 2026-06-16
**Owner:** Architect (spec) → Workflow agents (implementation)
**Architectural decision (closed, do not re-open):** `orgId` is the identity key throughout the I-layer. `repoId` is metadata carried on signals but keys nothing.

---

## Purpose

The WeOps Gateway (`ff-gateway`) receives an `InboundSignal` (the `CommissioningSignal`
variant from `@factory/schemas/weops-signals`) and must route it to the Commissioning Agent
(CA). Two contracts are mismatched today:

1. **Wrong target URL.** `routeSignal` posts to `${COMMISSIONING_AGENT_URL}/commission`. The
   CA Worker only routes paths shaped `/agents/commissioning/{orgId}/**`
   (`workers/ff-commissioning-agent/src/index.ts`), and the CA DO only handles `/signal`,
   `/divergence`, `/workspace/write`. `/commission` is a 404.
2. **Wrong body shape.** The gateway forwards the raw `InboundSignal`
   (`{ signalType, repoId, workGraphId, workGraphVersion, dispositionEventId,
   elucidationArtifactId, issuedAt }`). The CA DO validates against
   `CommissioningSignalSchema`, which requires `sessionId`, `orgId`, `domainProfile`,
   `requireHumanApproval`, and does **not** include `signalType`/`repoId`/`workGraphVersion`
   at top level. Every forwarded signal fails the CA's `safeParse` with a 400.

This spec defines the **translation layer** the gateway applies to turn an `InboundSignal`
into the CA's `CommissioningSignal` body, the **correct route**, and the same correction for
the `ResumeSignal` and `OverrideSignal` paths.

## JTBD

When the gateway receives a verified WeOps disposition signal, I want to translate it into
the orgId-keyed `CommissioningSignal` the CA actually accepts and POST it to the correct
per-org route, so I can stop losing every commissioning signal to a 404 or a schema-mismatch
400.

---

## Context

### Source: `InboundSignal.CommissioningSignal` (`packages/schemas/src/weops-signals.ts`)
```
{ signalType: 'CommissioningSignal', repoId, workGraphId, workGraphVersion,
  dispositionEventId, elucidationArtifactId, issuedAt }
```

### Target: `CommissioningSignalSchema` (`packages/commissioning-agent/src/schemas.ts`)
```
{ sessionId, orgId, workGraphId?, workGraphVersion?, domainProfile,
  dispositionEventId, elucidationArtifactId, issuedAt, requireHumanApproval=true }
```
- `domainProfile` is required and is itself `{ vertical, orgContext, constraints[],
  additionalSkillRefs?, version='1.0' }`.
- `orgId`, `dispositionEventId`, `elucidationArtifactId`, `issuedAt` are required non-empty
  strings.

### CA Worker routing (`workers/ff-commissioning-agent/src/index.ts`)
Only `^/agents/commissioning/([^/]+)(.*)$` is routed; `{orgId}` is captured from path
position 1 and the DO is `idFromName('commissioning-agent:{orgId}')`. The remaining subpath
is forwarded to the DO, which dispatches `/signal`.

### Current gateway routing (`workers/ff-gateway/src/signals-handler.ts`, `routeSignal`)
- `CommissioningSignal` → `${ca}/commission` (wrong path).
- `ResumeSignal` → `${ca}/resume` (wrong path; CA DO has no `/resume`).
- `OverrideSignal` with `targetRepoId` → `${ca}/override` (wrong path; CA DO has no
  `/override`).
- Body is `JSON.stringify(signal)` (raw InboundSignal — wrong shape).

---

## Spec (numbered rules)

### R1 — Correct target URL for CommissioningSignal
The gateway MUST POST to:
```
${COMMISSIONING_AGENT_URL}/agents/commissioning/${orgId}/signal
```
- `COMMISSIONING_AGENT_URL` is the base URL from `GatewayEnv`
  (e.g. `https://ff-commissioning-agent.koales.workers.dev`).
- `${orgId}` is derived per R2.
- The `/commission` path is removed entirely from the CommissioningSignal branch.

### R2 — `orgId` source (stripping rule from `repoId`)
`orgId` is derived from `signal.repoId` by the following deterministic rule:
- If `repoId` **starts with** the literal prefix `repo:`, strip the prefix and use the
  remainder as `orgId`.
- Otherwise, use `repoId` verbatim as `orgId`.

This makes the dev smoke-test path work: the linear-bridge fallback sets
`repoId = repo:{issueId}`, which strips to `orgId = {issueId}`.

- The derived `orgId` MUST be non-empty after stripping; if stripping yields an empty string
  (e.g. `repoId === 'repo:'`), the gateway returns **400** with a structured error and does
  not route.
- `orgId` MUST be URL-path-safe before interpolation into the route (it becomes a path
  segment); reject (400) any `orgId` containing `/` or whitespace rather than emitting a
  malformed URL.
- **TODO (production):** `orgId` must come from an **org-profile lookup keyed by `repoId`**,
  not a string-strip. The strip rule is a v1/dev convenience only. The lookup belongs behind
  a single `resolveOrgId(repoId, env)` seam so the strip can be swapped for a KV/D1 lookup
  without touching `routeSignal`.

### R3 — `sessionId` source
The gateway mints the streaming session identity. Use the disposition event id directly:
- `sessionId = signal.dispositionEventId`.

`dispositionEventId` is already unique per disposition (A9: it equals the ELC node id minted
by the linear-bridge, one per issue/disposition), so it is a valid stable session key and
avoids introducing clock/`Date.now()` nondeterminism. (Alternative
`SES-${dispositionEventId}-${Date.now()}` is permitted only if a future requirement needs
multiple sessions per disposition; v1 uses `dispositionEventId` directly.)

### R4 — `domainProfile` (v1 default)
The gateway supplies a default `domainProfile`:
```
{ vertical: 'generic', orgContext: signal.repoId, constraints: [] }
```
- `vertical: 'generic'` is a valid `VerticalSchema` member.
- `orgContext` carries `repoId` as a free-form hint for the CA soul block.
- `constraints: []` (no domain constraints in v1).
- `version` defaults to `'1.0'` via the schema; the gateway need not set it.
- **TODO (production):** load `domainProfile` from an org profile store keyed by `orgId`
  (same store as R2's `resolveOrgId`). Behind a `resolveDomainProfile(orgId, env)` seam.

### R5 — `requireHumanApproval`
- Default `true`.
- The `InboundSignal.CommissioningSignal` has no such field today, so the gateway always
  sets `true` in v1.
- Forward-compat: if a `requireHumanApproval` boolean is later added to the inbound signal,
  the gateway passes it through (`signal.requireHumanApproval ?? true`). No schema change is
  made in this spec.

### R6 — Full translated body the gateway POSTs to the CA
The gateway sends exactly (CommissioningSignal path):
```
{
  sessionId:            signal.dispositionEventId,          // R3
  orgId:                resolveOrgId(signal.repoId),        // R2
  workGraphId:          signal.workGraphId,                 // pass-through (WG-*)
  workGraphVersion:     signal.workGraphVersion,            // pass-through
  domainProfile: {                                          // R4
    vertical:    'generic',
    orgContext:  signal.repoId,
    constraints: [],
  },
  dispositionEventId:   signal.dispositionEventId,          // pass-through
  elucidationArtifactId: signal.elucidationArtifactId,      // pass-through (correct spelling)
  issuedAt:             signal.issuedAt,                    // pass-through
  requireHumanApproval: true,                               // R5
}
```
- `signalType` and `repoId` are **dropped** from the outbound body (the CA schema rejects
  unknown-but-the-CA-doesn't-strip them; `repoId` survives only inside `orgContext`).
- The request stays `POST`, `Content-Type: application/json`.

### R7 — ResumeSignal and OverrideSignal route corrections
The `/resume` and `/override` paths in `routeSignal` are likewise wrong. Correct them to the
per-org route family. The CA DO does not currently expose `/resume` or `/override` handlers,
so this spec records the **routes** and flags the missing DO handlers as open items.

- **ResumeSignal** (`workers/ff-gateway/src/signals-handler.ts` line ~276–279): route to
  ```
  ${COMMISSIONING_AGENT_URL}/agents/commissioning/${orgId}/resume
  ```
  with `orgId` derived from `signal.repoId` per R2. The translated body carries
  `newWorkGraphId?`, `newWorkGraphVersion?`, `dispositionEventId`, `elucidationArtifactId`,
  `issuedAt`, plus `sessionId` (R3) and `orgId`. **OPEN:** the CA DO must add a `/resume`
  handler; until it exists this route 404s. Tracked as TODO-2.
- **OverrideSignal** with `targetRepoId` (line ~288–291): route to
  ```
  ${COMMISSIONING_AGENT_URL}/agents/commissioning/${orgId}/override
  ```
  with `orgId` derived from `signal.targetRepoId` per R2 (the override targets a specific
  repo's org). The Factory-wide override (`targetRepoId` absent) continues to route to the
  Architect DO and is **out of scope** for this spec. **OPEN:** the CA DO must add an
  `/override` handler; tracked as TODO-2.

### R8 — Error handling parity
- A failed `orgId` derivation (R2) returns **400** (`{ error: 'cannot derive orgId from
  repoId' }`) before any fetch — it is a request defect, not a downstream outage.
- Downstream fetch failures and non-2xx responses keep the existing **503** mapping in
  `routeSignal`.
- The translation must not swallow the CA's own 400 (schema rejection): if the CA returns
  400, surface it as a 503 per the existing `!resp.ok` path, **and** log the CA's body so a
  residual shape mismatch is diagnosable.

---

## Open items / TODOs

- **TODO-1 (R2/R4):** Replace the `repo:` strip and the `generic` default with
  `resolveOrgId(repoId, env)` and `resolveDomainProfile(orgId, env)` backed by an org-profile
  store (KV or D1). Production must not infer identity from string shape.
- **TODO-2 (R7):** CA DO must implement `/resume` and `/override` handlers (and their Zod
  schemas) before those gateway routes carry traffic. Run `tessera_impact` on the CA DO
  `fetch` router before adding handlers.
- **OPEN-1 (R5):** Decide whether `requireHumanApproval` becomes a first-class inbound signal
  field; if so, amend `weops-signals.ts` `CommissioningSignal` in a separate spec.
- **OPEN-2 (R6):** Confirm whether the CA's `CommissioningSignalSchema` should use Zod
  `.strict()` — if it does, dropping `signalType`/`repoId` from the body becomes mandatory
  rather than defensive. Recommend the gateway drop them regardless.
