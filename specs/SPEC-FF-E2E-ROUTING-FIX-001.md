# SPEC-FF-E2E-ROUTING-FIX-001 — ff-gateway → Commissioning Agent 404 routing fix

| Field | Value |
|-------|-------|
| Status | Proposed (spec only — no source modified) |
| Author | Architect agent |
| Date | 2026-06-16 |
| Revision | 2 (supersedes the trailing-slash-only diagnosis) |
| Branch | `feat/ksp-implementation` |
| Severity | HIGH (blocks E2E factory test; live signal ingress broken) |
| Repo | `/Users/wes/Developer/function-factory` |

## JTBD

When the E2E factory test submits a `CommissioningSignal` through `ff-gateway`, I want the
gateway to reach the Commissioning Agent's `/signal` handler reliably, so I can prove the We→I
signal ingress path works end-to-end against live infrastructure.

## Revision note

Revision 1 attributed the 404 solely to a trailing slash in `COMMISSIONING_AGENT_URL` and
prescribed a secret correction plus trailing-slash-safe string normalization. **That fix was
applied and the secret is confirmed correct, yet the gateway still receives "downstream
returned 404" from the CA.** Trailing slash was a real (now-closed) defect but was not the
whole root cause. Revision 2 identifies the remaining cause as the Worker-to-Worker HTTP fetch
mechanism itself and switches `ff-gateway` from a public-URL `fetch` to a Durable Object
service binding — the same mechanism `factory-gateway` already uses successfully to reach the
identical DO.

---

## 1. Root Cause

Two compounding defects on the same path. The first is closed; the second is the live blocker.

### 1a. Trailing slash in `COMMISSIONING_AGENT_URL` (CLOSED)

`routeSignal()` builds the target by string concatenation
(`workers/ff-gateway/src/signals-handler.ts:305`):

```ts
targetUrl = `${ca}/agents/commissioning/${orgId}/signal`
```

A trailing slash on `ca` yields `//agents/commissioning/...`, which the CA Worker's anchored
route regex (`workers/ff-commissioning-agent/src/index.ts:14`,
`/^\/agents\/commissioning\/([^/]+)(.*)$/`) does not match, so the Worker falls through to
`return new Response('Not found', { status: 404 })` (line 27). The secret has since been
corrected to the no-trailing-slash canonical form and `routeSignal()` already strips trailing
slashes (`(env.COMMISSIONING_AGENT_URL ?? '').replace(/\/+$/, '')`, line 282). **This defect is
closed and is no longer the cause of the observed 404.**

### 1b. Worker-to-Worker HTTP fetch over `.workers.dev` is unreliable (LIVE BLOCKER)

With the secret correct, `ff-gateway` still gets a 404 from the CA. The remaining cause is the
transport: `routeSignal()` reaches the CA by issuing a public-internet `fetch()` to a
`*.workers.dev` URL (`signals-handler.ts:365`). Worker-to-Worker requests routed back out
through the public `.workers.dev` edge are not reliably serviced by the Cloudflare runtime —
self-referential and some Worker-to-Worker edge fetches are blocked or misrouted at the runtime
level (Cloudflare error **1042**, "Worker tried to fetch from another Worker on the same zone").
A request that is blocked or rerouted at the edge can surface to the calling Worker as a
non-2xx (including 404) that did not originate from the destination Worker's own handler. This
is consistent with the symptom: the path is now correct, the DO is healthy (proven below), the
secret is correct, yet the gateway still observes a 404.

The architecturally correct fix is to stop crossing the public edge entirely. `ff-gateway` and
`ff-commissioning-agent` are deployed on the same account; the CA's Durable Object can be bound
**directly** into `ff-gateway` as a DO service binding, and addressed in-process via the DO
namespace — no DNS, no public HTTP, no 1042 surface. This is exactly what `factory-gateway`
already does to reach the same DO (`workers/factory-gateway/src/session-router.ts:171-179`,
`caNamespace.get(caNamespace.idFromName('commissioning-agent:{orgId}'))` then
`stub.fetch('https://do/signal', …)`), and that path works in production.

### DO health is already proven

`factory-gateway` reaches `CommissioningAgentDO` via DO binding and gets a healthy 200/202/409
from the `/signal` handler today. The DO's internal route table
(`packages/commissioning-agent/src/index.ts:247-263`) matches `url.pathname === '/signal'` and
returns **400 `invalid-signal`** on a bad body (lines 271-276) — never 404. The defect is in
how `ff-gateway` *transports* to the DO, not in the DO.

### Diagnostic answers

1. **Is `CommissioningAgentDO` exported from `ff-commissioning-agent`? Exact class export
   name?**
   Yes. `workers/ff-commissioning-agent/src/index.ts:8`:
   `export { CommissioningAgentDO } from '@factory/commissioning-agent'`. The class name is
   **`CommissioningAgentDO`** — identical to the `class_name` already used in
   `factory-gateway/wrangler.jsonc` (line 13). So `ff-gateway` can bind it with the same
   `class_name` + `script_name`.

2. **Does `ff-commissioning-agent` handle requests as a DO — can `ff-gateway` bind it as a DO
   service binding?**
   Yes. `CommissioningAgentDO` is a Durable Object with its own `override async fetch()` router
   (`packages/commissioning-agent/src/index.ts:247`). `factory-gateway` already binds it as an
   external DO (`script_name: "ff-commissioning-agent"`) and reaches it with
   `idFromName('commissioning-agent:{orgId}')` + `stub.fetch('https://do/signal', …)`. A DO
   service binding is the correct, proven mechanism. The DO addressing key is
   `commissioning-agent:{orgId}` — `ff-gateway` must use the **same** key so it reaches the same
   instance.

3. **Minimal change to switch `ff-gateway` from URL fetch to DO binding?**
   Three edits — see Sections 2, 3, 4. wrangler binding + env type + call-site. No change to
   `ff-commissioning-agent` or to `packages/commissioning-agent`.

### Critical correctness note on the call site

With a public-URL fetch, the path is `/agents/commissioning/{orgId}/signal` because the request
hits the **CA Worker's default `fetch` export**, which strips the `/agents/commissioning/{orgId}`
prefix and forwards the remaining subpath (`/signal`) to the DO
(`ff-commissioning-agent/src/index.ts:14-25`).

With a **DO service binding**, `ff-gateway` calls `idFromName()` itself and `stub.fetch()` goes
**directly to the DO**, bypassing that Worker `fetch` export entirely. Therefore the path sent to
the stub must be the DO's **internal** path — `/signal` (and `/resume`, `/override` for the other
cases) — **not** the `/agents/commissioning/{orgId}/...` prefix. The `orgId` is no longer in the
path; it is in the `idFromName` key. This matches `factory-gateway`, which posts to
`https://do/signal`, not `https://do/agents/commissioning/...`.

> Scope note: the DO's `fetch` router (`packages/commissioning-agent/src/index.ts:247-263`) only
> handles `/signal`, `/divergence`, `/workspace/write` explicitly; `/resume` and `/override`
> fall through to `super.fetch()` and are not yet implemented (pre-existing **OPEN TODO-2**,
> independent of transport). `CommissioningSignal` (the E2E test path) is fully handled. The
> binding switch does not change this; it only changes transport.

---

## 2. Fix A — Add `COMMISSIONING_AGENT` DO service binding to `ff-gateway/wrangler.jsonc`

`ff-gateway/wrangler.jsonc` currently has **no** binding to the CA — it relies on the
`COMMISSIONING_AGENT_URL` secret. Add an external Durable Object binding identical in shape to
the one already proven in `factory-gateway/wrangler.jsonc:11-15`.

**File:** `workers/ff-gateway/wrangler.jsonc`
**Change:** add a top-level `durable_objects` block (the file has none today). Insert after the
existing `kv_namespaces` block (after line 16):

```jsonc
  // Durable Object binding — external script (CommissioningAgentDO lives in
  // ff-commissioning-agent). In-process DO routing avoids the Worker-to-Worker
  // public-edge fetch (CF error 1042) that 404'd the previous URL-based path.
  "durable_objects": {
    "bindings": [
      {
        "binding": "COMMISSIONING_AGENT",
        "class_name": "CommissioningAgentDO",
        "script_name": "ff-commissioning-agent"
      }
    ]
  },
```

Notes:
- `class_name` (`CommissioningAgentDO`) and `script_name` (`ff-commissioning-agent`) must match
  `factory-gateway/wrangler.jsonc` exactly — they reference the same deployed DO class.
- `ff-commissioning-agent` owns the migration that defines `CommissioningAgentDO`; `ff-gateway`
  only references it (`script_name` form = external, no migration in `ff-gateway`).
- The `COMMISSIONING_AGENT_URL` secret and the `ARCHITECT_AGENT_DO_URL` secret may remain for
  now (the Architect-bound signal cases still use URL fetch). Once the CA cutover is verified,
  `COMMISSIONING_AGENT_URL` becomes dead config and can be removed in a follow-up. Removing it is
  **not** required for this fix and is out of scope here.

---

## 3. Fix B — Update `ff-gateway/src/env.ts` type

Replace the `COMMISSIONING_AGENT_URL: string` member with a typed DO namespace. Follow the
existing structural-typing convention in this file (bindings are declared structurally, not
imported across Workers — see the file header and `GatesBinding`/`QueryBinding`).

**File:** `workers/ff-gateway/src/env.ts`

Remove (lines 59-60):

```ts
  /** Base URL for Commissioning Agent Worker (e.g. https://ff-commissioning-agent.example.workers.dev) */
  COMMISSIONING_AGENT_URL: string
```

Add to `GatewayEnv` in its place:

```ts
  /**
   * Durable Object namespace for CommissioningAgentDO (script: ff-commissioning-agent).
   * Address by `idFromName('commissioning-agent:{orgId}')`, then `stub.fetch()` the DO's
   * internal path (`/signal`). In-process binding — no public .workers.dev round-trip.
   */
  COMMISSIONING_AGENT: DurableObjectNamespace
```

Notes:
- `DurableObjectNamespace` / `DurableObjectStub` come from `@cloudflare/workers-types`, already
  available in this Worker (the file already uses `KVNamespace`, `SecretsStoreSecret`). No new
  import is required if `workers-types` is in the global lib; if the file needs an explicit
  import, mirror however `factory-gateway` types its DO bindings.
- `ARCHITECT_AGENT_DO_URL: string` (line 62) stays unchanged — that path is not part of this fix.

---

## 4. Fix C — Update `ff-gateway/src/signals-handler.ts` call site

`routeSignal()` must (a) resolve the DO stub via `idFromName` instead of building a URL, and
(b) `stub.fetch()` the DO's **internal** path. The `orgId` moves from the path into the
`idFromName` key.

**File:** `workers/ff-gateway/src/signals-handler.ts`
**Function:** `routeSignal()` (lines 278-383)

### 4.1 — Stop reading the URL for the CA branch

Line 282 reads `const ca = (env.COMMISSIONING_AGENT_URL ?? '').replace(/\/+$/, '')`. The CA
branches no longer need a base URL. Leave `arch` (line 283) as-is — Architect routing still uses
URL fetch. Replace the CA-presence guard (`if (!ca) return missingBinding('COMMISSIONING_AGENT_URL')`)
with a binding-presence guard:

```ts
if (!env.COMMISSIONING_AGENT) return missingBinding('COMMISSIONING_AGENT')
```

### 4.2 — Route the CA cases through the DO stub, not a URL

Restructure the CA branches so they acquire a DO stub and post the DO's internal path. The
translated body (R6) is unchanged. Concretely, for `CommissioningSignal`:

```ts
case 'CommissioningSignal': {
  if (!env.COMMISSIONING_AGENT) return missingBinding('COMMISSIONING_AGENT')
  const orgIdResult = resolveOrgId(signal.repoId)
  if (!orgIdResult.ok) return json({ error: orgIdResult.error }, 400)
  const { orgId } = orgIdResult

  // R6 — translate InboundSignal → CA CommissioningSignalSchema body (unchanged).
  const translatedBody = {
    sessionId:             signal.dispositionEventId,
    orgId,
    workGraphId:           signal.workGraphId,
    workGraphVersion:      signal.workGraphVersion,
    domainProfile: { vertical: 'generic' as const, orgContext: signal.repoId, constraints: [], version: '1.0' },
    dispositionEventId:    signal.dispositionEventId,
    elucidationArtifactId: signal.elucidationArtifactId,
    issuedAt:              signal.issuedAt,
    requireHumanApproval:  true,
  }

  // DO binding — same addressing key as factory-gateway + CA Worker entry.
  const id   = env.COMMISSIONING_AGENT.idFromName(`commissioning-agent:${orgId}`)
  const stub = env.COMMISSIONING_AGENT.get(id)
  return await forwardToDO(stub, '/signal', translatedBody)
}
```

For `ResumeSignal` and the per-org `OverrideSignal` branches, replace the
`${ca}/agents/commissioning/${orgId}/resume|override` URL construction with the same
`idFromName('commissioning-agent:{orgId}')` + `stub.fetch()` of the DO internal path
(`/resume`, `/override`). (These remain blocked by OPEN TODO-2 in the DO regardless — out of
scope to implement here, but the call site must be transport-consistent.)

### 4.3 — Add a small DO-forward helper that preserves the existing error contract

Factor the fetch + status handling (today at lines 363-382) into a helper so all CA branches
share it and the existing "downstream returned N → 503" contract is preserved:

```ts
async function forwardToDO(
  stub: DurableObjectStub,
  doPath: string,
  body: unknown,
): Promise<Response> {
  let resp: Response
  try {
    // Host in the URL is ignored for DO stub fetches; only the path matters.
    resp = await stub.fetch(`https://do${doPath}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error(`CA DO fetch failed (${doPath}):`, msg)
    return json({ error: `503 Service Unavailable: commissioning agent unreachable — ${msg}` }, 503)
  }
  if (!resp.ok) {
    const text = await resp.text()
    console.error(`CA DO ${doPath} returned ${resp.status}: ${text}`)
    // Surface the downstream body (cheap diagnosis; see prior §4c recommendation).
    return json({ error: `503 Service Unavailable: downstream returned ${resp.status}: ${text.slice(0, 200)}` }, 503)
  }
  return resp
}
```

The Architect branches (`PatchAuthSignal`, `PipelineConfigAuthSignal`, the no-`targetRepoId`
`OverrideSignal`) keep using the existing `${arch}/…` URL fetch path unchanged — they are out of
scope for this fix.

### 4.4 — Addressing key must match exactly

`commissioning-agent:${orgId}` must be byte-identical to the key used by `factory-gateway`
(`session-router.ts:171`) and by the CA Worker entry
(`ff-commissioning-agent/src/index.ts:21`). A mismatched key would silently address a *different*
DO instance. Reuse the literal exactly.

---

## 5. Redeploy Sequence

DO service bindings require a **code redeploy** of `ff-gateway` (unlike a bare secret update).
`ff-commissioning-agent` does not change. Order matters: the referenced DO script must exist
before the referencing Worker deploys.

| Step | Action | Worker | Why |
|------|--------|--------|-----|
| 1 | Confirm `ff-commissioning-agent` is deployed and exports `CommissioningAgentDO`. | `ff-commissioning-agent` (no change) | A `script_name` DO binding fails to deploy if the referenced script/class is absent. It is already deployed (factory-gateway binds it), so this is a verify step. |
| 2 | Apply Fix A (wrangler.jsonc), Fix B (env.ts), Fix C (signals-handler.ts) to `ff-gateway`. | `ff-gateway` | The three edits above. Spec-only here — no source touched by this document. |
| 3 | `tsc` / typecheck `ff-gateway`. | `ff-gateway` | `DurableObjectNamespace` / `DurableObjectStub` must resolve; the removed `COMMISSIONING_AGENT_URL` reference must be gone. |
| 4 | Deploy `ff-gateway` via the project deploy-script pattern (`scripts/deploy-ff-gateway.sh` driving `wrangler deploy` non-interactively — do not run wrangler by hand). | `ff-gateway` | Activates the DO binding + new call site. |
| 5 | Verify (see §6). | both | Real signal must flow. |
| 6 | (Follow-up, optional, separate change) Remove the now-dead `COMMISSIONING_AGENT_URL` secret and its references once the binding is proven. | `ff-gateway` | Out of scope for this fix. |

`COMMISSIONING_AGENT_URL` secret edits are no longer part of the fix path — the binding replaces
the URL. Leave the secret in place until step 6 to keep rollback trivial (revert the three edits,
redeploy, and the URL path is intact).

---

## 6. Verification

```bash
# DO health via factory-gateway's proven DO path is unchanged — sanity only.

# Primary: the WeOps ingress that the E2E test exercises.
# Expect 2xx from the CA /signal handler — NOT 503 "downstream returned 404".
# POST https://ff-gateway.koales.workers.dev/signals
#   with a valid CommissioningSignal body + valid WeOps JWT (we-layer:commission scope, A9 ELC ids)
#   → expect 2xx
```

**Done = the E2E factory test posts to `ff-gateway` `/signals` and the `CommissioningSignal`
reaches `CommissioningAgentDO.handleSignal` over the in-process DO binding, returning a 2xx
against live infrastructure** — not a compile, not a 400 on an empty body, not a 503. The real
signal flows through, the DO emits `SESSION_SUBMITTED`, and the gateway returns the DO's success
response.

If a 503 still appears after this change, the helper now surfaces the downstream body
(`downstream returned N: <body>`), turning any residual issue into a one-look diagnosis instead
of an opaque wrap.

---

## 7. Files referenced

- `workers/ff-gateway/wrangler.jsonc` — no CA binding today; Fix A adds `durable_objects` block
- `workers/ff-gateway/src/env.ts` — `COMMISSIONING_AGENT_URL: string` line 60 → `COMMISSIONING_AGENT: DurableObjectNamespace` (Fix B)
- `workers/ff-gateway/src/signals-handler.ts` — `routeSignal()` lines 278-383; CA URL build 305/335/355; 404→503 wrap 376-380 (Fix C)
- `workers/factory-gateway/wrangler.jsonc` — proven external DO binding `COMMISSIONING_AGENT` / `CommissioningAgentDO` / `ff-commissioning-agent` (lines 11-15) — the template for Fix A
- `workers/factory-gateway/src/session-router.ts` — proven DO call site `idFromName('commissioning-agent:{orgId}')` + `stub.fetch('https://do/signal', …)` (lines 171-179) — the template for Fix C
- `workers/ff-commissioning-agent/src/index.ts` — exports `CommissioningAgentDO` (line 8); Worker `fetch` default that the DO binding bypasses (lines 11-28)
- `packages/commissioning-agent/src/index.ts` — DO `fetch` router, `url.pathname === '/signal'` (line 251); 400 on bad body (lines 271-276); `/resume` + `/override` fall through to `super.fetch()` (OPEN TODO-2)
- `packages/commissioning-agent/src/schemas.ts` — `CommissioningSignalSchema` (translated-body target)
