# Gas City Era — Function Factory Architecture

**Status:** Authoritative design. Supersedes all synthesis-era lifecycle/fidelity design.
**Authored:** 2026-05-26 by Architect agent (clean-slate, directed by Wes)
**Ground truth:** RELEASE payload schema confirmed from factory-coding-v1.toml source.
**Authority:** ADR-010, GOVD-GAS-CITY-PHASE1-INTEGRATION (D3, D5, D6, D8, D9, D-NEW-1, D-Q1C)

**The one fact that determines everything:**

> Gas City sends one bit: `outcome: "approved" | "revise"`.
> Factory's "Fidelity Verification" is therefore not a computation — it is a fail-closed
> transcription of an external authoritative verdict into a lineage-bearing artifact.

---

## 1. Function Lifecycle State Machine

### States (six — minimum observable set)

| State | Meaning | Entered by |
|---|---|---|
| `proposed` | FunctionProposal exists; no spec yet | FP-* creation |
| `specified` | IS+ES+EP compiled; Coherence VR passed | Coherence VR `overall=pass` |
| `dispatched` | FORM-* slung to Gas City; `dispatch_log.outcome=dispatched` | dispatch success (CALL 3 `slung`) |
| `accepted` | Gas City returned `outcome=approved` | Fidelity VR `overall=pass` from webhook |
| `rejected` | Gas City returned `outcome=revise` (terminal for this attempt) | Fidelity VR `overall=fail` from webhook |
| `retired` | Superseded by successor Function, or operator-killed | operator / amendment promotion |

**Dropped from synthesis era:** `designed`, `in_progress`, `produced`, `monitored`, `regressed`.
Rationale: these modeled Factory-internal synthesis stages and persistence monitoring that Gas City owns.
The Factory does not model states it cannot observe.

### Allowed transitions

```
proposed   → specified | retired
specified  → dispatched | retired
dispatched → accepted | rejected | retired
accepted   → retired
rejected   → retired
retired    → (terminal)
```

### Gates and evidence anchors

| Transition | Gate (hard precondition) | Evidence anchor |
|---|---|---|
| `proposed → specified` | Coherence VR `overall=pass` for the ES | `VR-*` kind=`coherence` |
| `specified → dispatched` | `dispatch_log` row `outcome=dispatched`, non-null `gc_bead_id` + `gc_workflow_id` | `dispatch_log._key` |
| `dispatched → accepted` | Fidelity VR `overall=pass`, HMAC-valid, `bead_id` resolves to `dispatched` dispatch_log | `VR-*` kind=`fidelity`, `bead_id` |
| `dispatched → rejected` | Fidelity VR `overall=fail`, same lineage checks | `VR-*` kind=`fidelity`, `bead_id` |
| `rejected → retired` | Successor Function (`FN-V2`) reached `specified` | successor `FN-*` id |
| `* → retired` (operator) | `OPERATOR_CONTROL_TOKEN` present | operator action log |

**Execution-evidence anchor is `bead_id` / `form_id` / `dispatch_log._key`. No `TEP-*` anchors.**

### Module shape (new file: `src/gascity/function-lifecycle.ts`)

```typescript
export type FunctionState =
  | 'proposed' | 'specified' | 'dispatched'
  | 'accepted' | 'rejected' | 'retired'

export const ALLOWED: Record<FunctionState, FunctionState[]> = {
  proposed:   ['specified', 'retired'],
  specified:  ['dispatched', 'retired'],
  dispatched: ['accepted', 'rejected', 'retired'],
  accepted:   ['retired'],
  rejected:   ['retired'],
  retired:    [],
}
```

---

## 2. Fidelity Verification Record

**Synthesis-era `FidelityVerificationReport` (branches/invariants/scenarios) is retired.** It cannot be
populated from a one-bit payload. Replacement:

```typescript
// packages/schemas/src/gascity-fidelity.ts
export const GasCityFidelityVerificationReport = z.object({
  id:           ArtifactId,                    // VR-*
  verification: z.literal('fidelity'),
  variant:      z.literal('gascity'),          // discriminates from synthesis-era shape
  function_id:  ArtifactId,
  timestamp:    z.string().datetime(),

  // Transcribed external verdict — NOT recomputed by Factory
  overall:    z.enum(['pass', 'fail']),        // approved→pass, revise→fail
  gc_outcome: z.enum(['approved', 'revise']),

  // Execution-evidence anchors (from webhook payload)
  bead_id:         z.string().min(1),
  form_id:         ArtifactId,                // FORM-*
  ep_id:           ArtifactId,                // EP-*
  es_id:           ArtifactId,                // ES-*
  is_id:           ArtifactId,                // IS-*
  factory_attempt: z.number().int().positive(),

  // Structural checks the Factory actually performs (the ONLY judgments it makes)
  intake_checks: z.object({
    hmac_valid:         z.literal(true),      // record only exists if HMAC passed
    payload_wellformed: z.literal(true),
    lineage_resolved:   z.literal(true),      // bead_id matched a dispatched dispatch_log row
    dispatch_match: z.object({
      dispatch_log_key: z.string(),
      matched_on:       z.literal('bead_id'),
    }),
  }),

  // Gas City is the verdict authority. Factory does not second-guess `approved`.
  verdict_authority: z.literal('gas-city-verify-stage'),
  received_at:       z.string().datetime(),

  // 'none' for approved; amendment instruction for revise
  remediation: z.string().min(1),

  source_refs: z.array(ArtifactId).min(4),   // [fn_id, is_id, es_id, ep_id, form_id]
})
```

**Key decisions reflected:**
- `overall = "pass" | "fail"` — direct mapping, no interpretation
- Sub-checks are intake preconditions (HMAC, shape, lineage), not verdict modifiers
- `variant: "gascity"` discriminates from any future synthesis-era migration
- A VR is only created if ALL intake_checks pass (fail-closed)
- `revise` → `overall: "fail"` is terminal; Factory never re-dispatches the identical EP

---

## 3. Webhook Receiver: `POST /webhooks/gascity`

New module: `workers/ff-pipeline/src/gascity/webhook-receiver.ts`

### Handler flow (sequential, deterministic, no LLM)

```
POST /webhooks/gascity
 [1] Read raw body bytes (BEFORE json parse — HMAC signs raw bytes)
 [2] HMAC GATE (fail-closed, day one)
       compute HMAC-SHA256(GAS_CITY_HMAC_SECRET_V1, rawBytes)
       compare X-GC-Signature "sha256=<hex>" constant-time
       check X-GC-Key-ID == "v1"
       FAIL → write webhook_rejections, 401
 [3] PARSE + SHAPE GATE (zod)
       require {fn_id,is_id,es_id,ep_id,form_id,factory_attempt,bead_id,outcome}
       outcome ∈ {approved,revise}
       FAIL → write webhook_rejections, 400
 [4] IDEMPOTENCY GATE
       if completion_events has bead_id AND fidelity VR exists:
         return 200 {duplicate:true, vr_id}
 [5] LINEAGE GATE (fail-closed)
       find dispatch_log WHERE gc_bead_id == bead_id AND outcome=='dispatched'
       MISSING → webhook_rejections {reason:'orphan_bead'}, 409
       cross-check form_id, es_id, ep_id match dispatch_log
       MISMATCH → webhook_rejections {reason:'lineage_mismatch'}, 409
 [6] WRITE completion_events (append-only, _key=bead_id)
 [7] BUILD + WRITE GasCityFidelityVerificationReport → fidelity_verdicts
 [8] TRANSITION function lifecycle (in-handler, deterministic)
       approved → transitionFunction(fn, 'accepted', {evidenceKey: vr._key})
       revise   → transitionFunction(fn, 'rejected', {evidenceKey: vr._key})
       write lifecycle_transitions edge
 [9] If revise: write SIG-* row (amendment signal, undispatched)
 [10] return 202 {accepted:true, vr_id, lifecycle_state, outcome}
```

### Idempotency
Anchor = `bead_id`. `completion_events` has unique index on `bead_id`.
Deterministic keys: `completion_events._key = bead_id`; `fidelity_verdicts._key = "VR-" + sha256(bead_id+"|"+factory_attempt)[:16]`.
Duplicate delivery → catches unique-violation → returns 200 {duplicate:true}.

### HMAC: fail-closed from day one
No verify-and-log phase. Unknown `X-GC-Key-ID` → reject (only `v1` in Phase 1).
`GAS_CITY_HMAC_SECRET_V1` is a new Factory-side Worker secret (the Factory never *sends* it,
but must *hold* it to verify inbound webhooks — requires `wrangler secret put`).

### Synchronous vs async
Fully synchronous. Every step from HMAC verify to lifecycle transition happens in the handler.
`ctx.waitUntil` reserved as no-op slot for future telemetry (consistent with dispatch-formula precedent).
Nothing is deferred because: deterministic ArangoDB reads/writes, no LLM, no long I/O.

### Orphan bead_id
Fail-closed, 409, evidence-logged, no VR, no transition.
Gas City retries once on non-2xx — giving a slow dispatch_log write time to land.
If still orphan: row sits in `webhook_rejections` for the operational sweeper.

---

## 4. Amendment Loop

### Trigger
`outcome=revise` → webhook handler writes `SIG-*` row only. Does NOT auto-dispatch.

### Why not auto-dispatch
Amendment is itself a Gas City-executed Factory Function (GOVD D6 option C). Compilation must
not live in the deterministic hot path. The Signal is the durable handoff; promotion to a
successor Function dispatch is a separate governed act (operator-triggered in Phase 1;
autonomous Architect-agent-triggered in Phase 4+).

### Output
A **new Function** (`FN-*-V2`). Chain: `SIG-* → PRS-* → FP-* → IS-V2 → ES-V2 → EP-V2 → FORM-V2 → dispatch`.

### Lineage V1 → V2
1. `FN-V2.source_refs = [FN-V1, PRS-FAIL-FN-V1]`
2. Dispatch CALL 2 already adds `amendment-of:{prior_es_id}` label when `factory_attempt >= 2` (AC-20)

### `factory_attempt` semantics
- Factory never re-dispatches the identical EP (idempotency barrier returns existing `dispatched` row)
- Successor IS → new `factory_attempt`, new FORM-* key, new lifecycle
- `MaxAmendmentDepth` = 3 (configurable). Exceeding it writes `INC-*` and halts.

---

## 5. ArangoDB Collection Schema

### New Gas City era collections

| Collection | Purpose | Key strategy | Critical indexes |
|---|---|---|---|
| `completion_events` | Append-only raw Gas City verdicts | `_key = bead_id` | unique `bead_id`; hash `(fn_id, factory_attempt)` |
| `fidelity_verdicts` | `GasCityFidelityVerificationReport` | `_key = "VR-"+sha256(bead_id\|attempt)[:16]` | hash `bead_id`; hash `(function_id, overall)` |
| `lifecycle_transitions` | Function state-transition edges (append-only) | edge collection, auto `_key` | hash `_from`; skiplist `timestamp` |
| `webhook_rejections` | Fail-closed evidence log for rejected intakes | auto `_key` | skiplist `received_at`; hash `reason` |

**`function_states` (denormalization):** Fold `state` field directly onto `specs_functions`
for Phase 1 simplicity. `lifecycle_transitions` is the authoritative append-only log.

### Retained upstream collections (unchanged)
`specs_signals`, `specs_pressures`, `specs_capabilities`, `specs_functions` (+state field),
`intent_specifications`, `executable_specifications`, `execution_packets`, `formulas`,
`dispatch_log`, `verification_reports` (coherence only now), `uncertainty_entries`, `lineage_edges`.

---

## 6. ArtifactId Prefix Registry

**Required schema change in `packages/schemas/src/lineage.ts`:**
- **ADD `FORM`** — currently missing; dispatch code writes FORM-* keys that never validate
- **REMOVE `TEP`** — legacy prefix; canonical is `EP`

| Prefix | Artifact type | Status |
|---|---|---|
| `SIG` | Signal | keep |
| `PRS` | Pressure | keep |
| `BC` | Capability | keep |
| `FP` | FunctionProposal | keep |
| `FN` | Function | keep |
| `IS` | Intent Specification | keep |
| `ES` | Executable Specification | keep |
| `EP` | Execution Packet (canonical) | keep |
| **`FORM`** | **Formula Artifact** | **ADD — currently missing** |
| `VR` | Verification Report (coherence + fidelity) | keep |
| `INC` | Incident | keep — load-bearing for MaxAmendmentDepth |
| `EL` | Elucidation Artifact | keep |
| `GOVD` | Governance Decision | keep |
| `TEP` | Execution Packet (legacy) | **REMOVE** |

---

## 7. Delete / Quarantine List

### TypeScript — DELETE

| File | Reason |
|---|---|
| `src/fidelity-verification.ts` | Synthesis-era branch/scenario/invariant re-verification. No producer in Gas City era. |
| `src/fidelity-verification.test.ts` | Tests the above |
| `src/lifecycle.ts` | 8-state synthesis machine with TEP anchors. Replaced by `src/gascity/function-lifecycle.ts`. |
| `src/lifecycle.test.ts` | Rewrite against new module |
| `src/harness-bridge.ts` | NLAH harness (ADR-010 abandoned NLAH) |
| `src/harness-dispatcher.ts` | NLAH queue dispatch |
| `src/harness-dlq-consumer.ts` | NLAH DLQ consumer |
| `src/harness-env.ts` | NLAH env types |
| `src/coding-adapter-harness.ts` | NLAH coding harness |

### TypeScript — QUARANTINE (move to `src/_attic/`)

| File | Reason |
|---|---|
| `src/runtime-verification.ts` | Synthesis runtime smoke; no Gas City consumer |
| `src/persistence-verification.ts` | Phase 5+ only; quarantine until continuous detector exists |
| `src/synthesis-pr-draft.ts` | In-Factory five-role synthesis; Gas City produces the PR now |
| `src/synthesis-artifact-egress.ts` | Same |
| `src/synthesis-callback.ts` | Same |

### Schema — DELETE / REPLACE

| Schema | Disposition |
|---|---|
| `FidelityVerificationReport` (coverage.ts) | Replace with `GasCityFidelityVerificationReport` |
| `FidelityVerificationVerdict` (coverage.ts) | Delete — scenario_verification_score uncomputable from one bit |

### ArtifactId prefixes — AUDIT + REMOVE

`TEP` (remove), `MR`, `MRP`, `CRP`, `VCR`, `RPRS`, `SBI`, `PSR`, `CRL`, `DDI` (audit — synthesis-era merge/consultation prefixes; remove those with zero live producers).

---

## Pending Decisions (Wes)

1. **Delete list approval** — can we delete the NLAH harness modules and synthesis fidelity code?
2. **`FORM` prefix + `TEP` removal** — approve schema change?
3. **`function_states` denormalization** — field on `specs_functions` (recommended) vs separate collection?
4. **HMAC secret provisioning** — `wrangler secret put GAS_CITY_HMAC_SECRET_V1` on Factory side (Wes must run this — we cannot read/set secrets from settings.json)?
5. **Amendment trigger posture** — signal-only for Phase 1 (recommended), or operator can trigger immediately?
