# SPEC-FF-E2E-FULL-PIPELINE-001 — Drive a Signal Through the Full Factory Pipeline

**Status:** Draft · **Author:** Architect · **Date:** 2026-06-16
**Branch:** `feat/ksp-implementation`
**Supersedes/relates:** SPEC-FF-ILAYER-EXEC-001 (R4 v1 default profile), SPEC-FF-CA-MEDIATION-ADAPTER-001 (commission contract)

---

## JTBD

> When I run the factory e2e test, I want a single signed signal to flow gateway → Commissioning Agent → Mediation → CoordinatorDO and produce validated code, so I can prove the pipeline is actually wired end-to-end and not silently archiving every input.

---

## 1. Problem (first-principles)

The e2e driver (`scripts/ops/e2e-commissioning.mjs`) fires a `CommissioningSignal` and the test passes on **HTTP 2xx alone** (line 50). But the body it gets back is `{"status":"archived"}`. Two distinct defects compound:

**Defect A — the gateway erases vertical context.**
`workers/ff-gateway/src/signals-handler.ts:319` hardcodes `vertical: 'generic'` when translating `InboundSignal → CommissioningSignalSchema`. The `generic` vertical has **no signal pattern library** (`skill-registry.ts` only maps real verticals: `gtm-engineering`, `healthcare-operations`, `comeflow-commerce`, `fintech-compliance` to `bundled:*-signal-pattern-library`). With no patterns loaded, Pattern Appraisal (`packages/commissioning-agent/src/phases/pattern-appraisal.ts`) cannot match, returns `matches: false`, and the CA short-circuits to `archived` at `packages/commissioning-agent/src/index.ts:311-313`.

**Defect B — the e2e test conflates transport success with pipeline success.**
The gateway proxies the CA body verbatim with the CA's status code (`signals-handler.ts:398, 481-482`). `archived` is returned as **HTTP 200**, so the driver's `status < 300` check passes. The test is green while the pipeline never ran. "It returned 200" is not done (DONE MEANS DEPLOYED).

**Root cause:** the `InboundSignal` schema (`packages/schemas/src/weops-signals.ts:5-14`) carries no vertical, so the gateway has nothing to forward and falls back to a vertical that is structurally guaranteed to archive.

We choose **Option A** (carry `vertical` through the real path). Option B (POST a fully-formed `CommissioningSignalSchema` straight at the CA DO) is rejected as the validation path: it bypasses gateway JWT validation, schema translation (R6), and idempotency caching — it would prove the CA works, not that the *system* works. Option B remains acceptable only as an isolated CA-unit smoke, never as the e2e gate.

---

## 2. Change 1 — Schema: add optional `vertical` to `CommissioningSignal`

**File:** `packages/schemas/src/weops-signals.ts`

Add an optional `vertical` field to the `CommissioningSignal` member of the `InboundSignal` discriminated union. It is **optional** so existing We-layer producers that omit it keep working (backward compatible; the gateway falls back to `generic`).

```ts
export const CommissioningSignal = z.object({
  signalType: z.literal("CommissioningSignal"),
  repoId: z.string().min(1),
  workGraphId: z.string().min(1),               // WG-*
  workGraphVersion: z.string().min(1),
  dispositionEventId: z.string().min(1),        // must match token claim
  elucidationArtifactId: z.string().min(1),
  issuedAt: z.string().min(1),
  // NEW — optional We-layer vertical hint. When present, the gateway forwards it
  // into domainProfile.vertical; when absent, gateway falls back to 'generic'.
  // Enum MUST stay in sync with VerticalSchema in
  // packages/commissioning-agent/src/schemas.ts.
  vertical: z
    .enum([
      "gtm-engineering",
      "healthcare-operations",
      "comeflow-commerce",
      "fintech-compliance",
      "generic",
    ])
    .optional(),
})
```

**Constraint (CAP-of-enums):** this enum is duplicated from `VerticalSchema`. Two acceptable resolutions, in order of preference:
1. **Preferred:** export `VerticalSchema`/`Vertical` from `@factory/schemas` and have `commissioning-agent/src/schemas.ts` import it — single source of truth. If the dependency direction allows it (schemas is the lower package), do this.
2. **Fallback:** keep the literal enum here and add a TODO + a unit test asserting the two enums are identical, so drift fails CI rather than at runtime.

Run `tessera_impact({target: "CommissioningSignal", direction: "upstream"})` before editing — `InboundSignal` is consumed by the gateway validator (`signals-handler.ts:464`) and any We-layer producer. Adding an **optional** field is additive and low-risk, but confirm no exhaustive-key assertion exists downstream.

---

## 3. Change 2 — Gateway translation: use `signal.vertical`, fall back to `'generic'`

**File:** `workers/ff-gateway/src/signals-handler.ts` (CommissioningSignal case, ~lines 313-328)

Replace the hardcoded `vertical: 'generic' as const` with a guarded read of the new field. Keep everything else (R2 orgId derivation, R3 sessionId, R5 human-approval) unchanged.

```ts
translatedBody = {
  sessionId:              signal.dispositionEventId,  // R3
  orgId,                                              // R2
  workGraphId:            signal.workGraphId,
  workGraphVersion:       signal.workGraphVersion,
  domainProfile: {                                    // R4: v1 default
    vertical:    signal.vertical ?? 'generic',        // CHANGED — was 'generic' as const
    orgContext:  signal.repoId,
    constraints: [],
    version:     '1.0',
  },
  dispositionEventId:     signal.dispositionEventId,
  elucidationArtifactId:  signal.elucidationArtifactId,
  issuedAt:               signal.issuedAt,
  requireHumanApproval:   true,                      // R5
}
```

Because `signal.vertical` is constrained by the schema enum (Change 1) and `DomainProfileSchema.vertical` accepts the same set, the CA's `CommissioningSignalSchema.safeParse` (`commissioning-agent/src/index.ts:270`) will accept it. Removing the `as const` is required so the type widens to the enum union.

Run `tessera_impact({target: "routeSignal", direction: "upstream"})` before editing.

---

## 4. Change 3 — e2e test signal body (match P1, do NOT archive)

**File:** `scripts/ops/e2e-commissioning.mjs`

P1 — *Pipeline Conversion Drop* (`bundled-skills-manifest.ts:46-49`) matches when the signal **"describes a measurable drop in funnel conversion at a specific stage."** Pattern Appraisal is LLM-driven over `signal.domainProfile.vertical` + `signal.domainProfile.orgContext` (`pattern-appraisal.ts:20-30`). Two things must be true:

1. `vertical: 'gtm-engineering'` so the `bundled:gtm-signal-pattern-library` is the active skill.
2. The org context text must read as a **measurable, stage-specific funnel conversion drop** so the LLM returns `{ matches: true, patternId: "P1" }` and NOT P3 (market noise → not addressable).

The current driver sends none of the descriptive fields. Add `vertical` to the POST body and carry a P1-shaped description. Since `orgContext` is currently derived in the gateway from `repoId`, surface the description through `repoId` *or* extend the translation to carry a description (see §4.1). Minimal change: send `vertical` and make the description ride along.

```js
const res = await post(`${GATEWAY}/signals`, { Authorization: `Bearer ${jwt}` }, {
  signalType: 'CommissioningSignal',
  repoId: ORG_ID,
  workGraphId: WG_ID,
  workGraphVersion: 'v1',
  dispositionEventId: DISPOSITION_ID,
  elucidationArtifactId: DISPOSITION_ID,
  issuedAt: new Date().toISOString(),
  vertical: 'gtm-engineering',                 // NEW — routes to gtm pattern library
})
```

**P1-matching description text** (the appraisal LLM must see this). Recommended phrasing for `orgContext`:

> "Lead-to-opportunity conversion fell from 24% to 11% over the last quarter at the qualification stage of the outbound sales funnel; SDR-to-AE handoff is leaking qualified leads."

This is measurable (24%→11%), stage-specific (qualification / SDR-to-AE handoff), and funnel-scoped — squarely P1, not P3.

### 4.1 Carrying the description — pick ONE

The gateway currently sets `orgContext: signal.repoId`. The e2e description must reach `domainProfile.orgContext`. Choose the smaller change:

- **Option 4.1a (preferred, additive):** add an optional `orgContext?: string` (or `signalDescription?: string`) to `CommissioningSignal` in `weops-signals.ts`, and in the gateway set `orgContext: signal.orgContext ?? signal.repoId`. This is the same pattern as `vertical` and keeps `repoId` as an identifier rather than overloading it with prose.
- **Option 4.1b (zero-schema, hacky):** put the description into `repoId`. **Rejected** — `repoId` feeds `resolveOrgId` (`signals-handler.ts:302`), which rejects values containing `/` or whitespace (`:272`). A prose description would 400 at the gateway. Do not use.

**Decision:** implement 4.1a alongside Change 1 — add both `vertical?` and `orgContext?` as optional fields; gateway forwards both with fallbacks. This keeps `repoId` clean and lets Pattern Appraisal see real funnel prose.

---

## 5. Definition of Done — observable evidence

"Archived" must be impossible for a P1 signal, and the run must reach code generation. Done is a **layered evidence chain**, each layer a stronger claim:

| Layer | Observable | Where to read it |
|------|-----------|------------------|
| L1 — not archived | Gateway response body is **not** `{"status":"archived"}`. For the synchronous CA path it is the proxied Mediation response: `{"status":"seeded","runId":"RUN-…","atomCount":N>0,"workGraphVersion":"…"}` | e2e driver stdout (`res.body`); CA proxies Mediation at `commissioning-agent/src/index.ts:411-416` |
| L2 — phases ran | CA emitted `CANDIDATE_SET_BUILT` (deliberation) and `COMPILATION_STARTED`/`COMPILATION_COMPLETE` (workgraph authoring + commission) | CA subscription events via `emitCA`; `index.ts:328, 377, 399` |
| L3 — Mediation seeded atoms | Mediation lifecycle = `SEEDED`, `atomCount > 0`, `VERIFICATION_PRODUCED {kind:'COHERENCE', passed:true}`, one `ARTIFACT_WRITTEN` per AtomDirective | `mediation-agent-do.ts:205-231`; `CommissionResponseSuccess` |
| L4 — code generated & validated | CoordinatorDO molecule seeded → `ATOM_EXECUTION_QUEUE` drained → AtomExecutor produces code that passes `validateCodeLanguage` | `ff-pipeline/src/coordinator/atom-executor*.ts`; run status via `GET /run-status/:runId`, artifacts via `GET /run-artifacts/:runId` |

**Gate definition (what the e2e test MUST assert — not just HTTP 2xx):**

1. **Primary gate (must pass):** parse `res.body`; assert `JSON.parse(body).status === 'seeded'` AND `atomCount > 0`. Explicitly **fail** the test if `status === 'archived'` or `status === 'rejected'`. This closes Defect B — the test currently treats `archived` (HTTP 200) as pass.
2. **Pipeline gate (must pass for "full pipeline"):** capture the `runId` from the seeded response; poll `GET ${PIPELINE_URL}/run-status/${runId}` until the run reaches a terminal state; assert the terminal state is success and at least one atom produced validated code (non-empty `run-artifacts`). PR-opening is **optional** evidence (`/debug/generate-pr` exists but requires GitHub App creds) — do not make an opened PR the e2e gate; make **validated generated code** the gate. A PR is L5, nice-to-have, not required for "done."

> Note: the CA `/signal` path is synchronous through Mediation seed (L1-L3) but atom execution (L4) is async via queue. The e2e test therefore has two stages: a synchronous assertion on the seeded response, then a polled assertion on run status. Budget a poll timeout (e.g. 120s) for L4.

---

## 6. Deployment sequence

Order matters: schema first (shared dependency), then gateway, then redeploy CA only if it imports the changed schema package at build time.

1. **Edit & build schemas** — apply Change 1 (+ §4.1a `orgContext?`) in `packages/schemas/src/weops-signals.ts`. `npm run build` (or workspace build) so `@factory/schemas` dist is current. Run `tsc` across consumers to confirm no type breaks.
2. **Edit gateway** — apply Change 2 (and §4.1a fallback `orgContext: signal.orgContext ?? signal.repoId`) in `workers/ff-gateway/src/signals-handler.ts`. `tsc` the gateway.
3. **Pre-edit impact (mandatory per project rules):** `tessera_impact` on `CommissioningSignal` and `routeSignal`; `tessera_detect_changes()` before commit. Warn on HIGH/CRITICAL (expected: LOW — additive optional field + one-line translation change).
4. **Deploy via script (never bare wrangler):** extend or follow the existing `scripts/deploy-phase*.sh` pattern. Deploy order: `ff-gateway` first (it depends on the new schema). The CA worker (`ff-mediation-agent` / commissioning DO host) only needs redeploy if it re-bundles `@factory/schemas`; since the CA uses its own `CommissioningSignalSchema` (already accepts all verticals), **no CA code change is required** — the CA was always able to handle `gtm-engineering`; only the gateway was starving it. Redeploy the CA host only if the schema package is bundled into it.
5. **Update e2e driver** — apply Change 3 + §5 gate assertions to `scripts/ops/e2e-commissioning.mjs`. Add `FF_PIPELINE_URL` env for the L4 poll.
6. **Run it for real** — `WEOPS_SIGNING_KEY=… FF_GATEWAY_URL=… node scripts/ops/e2e-commissioning.mjs`. Confirm `status: seeded`, `atomCount > 0`, then poll `run-status` to a successful terminal state with validated code. Capture the stdout as evidence.
7. **Architect review gate** — before declaring done, the Architect re-reads the live response bodies and run artifacts to confirm L1-L4 actually fired (not just compiled).

---

## 7. Risks & mitigations

| Risk | Mitigation |
|------|-----------|
| Enum drift between `weops-signals.ts` and `VerticalSchema` | Prefer single-source export (§2.1); else CI test asserting equality |
| LLM appraisal non-determinism — P1 not matched despite good prose | Make `orgContext` text explicitly measurable + stage-specific (§4); if flaky, the pattern-appraisal prompt is the lever, not the schema |
| `generic` signals (no vertical) still archive | Expected & acceptable — `generic` has no pattern library by design. Document that We-layer SHOULD send a vertical; archiving an unaddressable generic signal is correct behavior, not a bug |
| L4 async timeout in CI | Bounded poll with explicit timeout; on timeout, dump `run-monitor` snapshot for triage rather than silent fail |
| Treating an opened PR as the gate | PR requires GitHub App creds and is downstream of validation; gate on validated generated code (L4), keep PR as L5 optional |

---

## 8. Summary of file changes

| File | Change |
|------|--------|
| `packages/schemas/src/weops-signals.ts` | Add optional `vertical` + optional `orgContext` to `CommissioningSignal` (enum synced with `VerticalSchema`) |
| `workers/ff-gateway/src/signals-handler.ts` | `vertical: signal.vertical ?? 'generic'`; `orgContext: signal.orgContext ?? signal.repoId` |
| `scripts/ops/e2e-commissioning.mjs` | Send `vertical:'gtm-engineering'` + P1-shaped `orgContext`; assert `status==='seeded' && atomCount>0`; poll `/run-status/:runId` for validated code; fail on `archived`/`rejected` |
| *(no change)* `packages/commissioning-agent/src/schemas.ts` | CA already accepts all verticals — gateway was the only blocker |
