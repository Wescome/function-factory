# Current Workspace

## Status
**HANDOVER** — written 2026-05-21 by GUV at session end.

## What was completed this session

### IP-1 Formula Compiler — DONE (Phase 1 gate PASS)

All five Phase 1 gate conditions cleared:

| Gate | Evidence |
|------|----------|
| V1 determinism | 43/43 tests pass |
| `gc formula show factory-coding-v1` exits 0 | Confirmed live |
| Bead tree with 5 lineage labels | Bead tr-3hc, all 5 labels confirmed via API |
| dispatch_log with gc_bead_id + gc_workflow_id | ArangoDB record verified |
| Idempotency: second dispatch → 0 GC calls | SMOKE_RUN_ID replay proven |

**Commits on `factory/fp-motdwvr2-w7un`** (4 commits ahead of main):
- `023ee71` — handover from prior session
- `590969c` — Phase 1 gate artifacts (ontology, elucidation, BC, FP)
- `1837628` — smoke-pass: 5 API gaps fixed, end-to-end verified
- `880a6a9` — smoke idempotency replay proven
- `affe237` — META: memory update

### 5 Gas City API gaps fixed during smoke (not in IS before smoke)

1. **`GAS_CITY_BASE_URL` missing** — compiler hardcoded `gas-city.local`; added env var
2. **`X-GC-Request: 1` CSRF header** required on POST /beads and POST /sling
3. **GET /formulas/{name} requires query params** `?target=&scope_kind=rig&scope_ref=`
4. **`scope_kind` must be `"city"`** for Phase 1 (coder agent is city-scoped, not rig-scoped)
5. **Sling response omits `workflow_id`** — use `root_bead_id` as gc_workflow_id fallback

All documented in IS-GC-EP-FORMULA-DISPATCH.md and formula-compiler.ts.

### Gas City local setup confirmed

- Gas City running at `localhost:8372` — supervisor PID 90948
- City: `phase0-city` at `/Users/wes/phase0-city`
- Controller token: `/Users/wes/phase0-city/.gc/controller.token`
- Rig: `test-repo` at `/Users/wes/phase0-city/rigs/test-repo`
- Smoke script: `workers/ff-pipeline/smoke/smoke-formula-dispatch.ts`

## Open / next session

### BLOCKED: Production deployment architecture

Session ended with user calling "belay that" on deployment — production
Gas City deployment architecture not yet defined. Specifically unknown:

- What public URL does the CF Worker (edge) use to reach Gas City?
  - Gas City is currently only at `localhost:8372` (not reachable from CF)
  - D7 decision: "Per-dev Docker + shared CI VPS" — VPS URL not configured yet
- `GAS_CITY_BEARER_TOKEN`, `GAS_CITY_BASE_URL`, `GAS_CITY_CITY_NAME`, etc. not set as CF secrets

**Do NOT attempt to set Gas City secrets or run `wrangler deploy` until Wes
decides the deployment architecture.** This is an architecture gate — escalate
to Wes first.

### Next task after architecture decision: IP-2 / IP-3

IP-1 (dispatch) is done. Next integration points per GOVD:
- **IP-2** (not yet designed): RELEASE callback receiver — Factory receives
  `POST /webhooks/gascity/release` from Gas City RELEASE step
- **IP-3** (not yet designed): Fidelity Verification — Factory runs
  verification against Gas City execution evidence on receipt of IP-2 callback

Neither has an IS yet.

### formula-compiler is not wired into FactoryPipeline

The compiler module exists (`workers/ff-pipeline/src/compilers/formula-compiler.ts`)
but is not called from `pipeline.ts` or any handler. `PipelineEnv` does not
include Gas City env vars. Wiring is the next implementation step after the
deployment architecture decision.

## Key file locations

| Artifact | Path |
|----------|------|
| Formula compiler | `workers/ff-pipeline/src/compilers/formula-compiler.ts` |
| Compiler tests | `workers/ff-pipeline/src/compilers/formula-compiler.test.ts` |
| Smoke test | `workers/ff-pipeline/smoke/smoke-formula-dispatch.ts` |
| Gas City template | `harnesses/gascity-templates/factory-coding-v1.toml` |
| IS | `specs/intent-specifications/IS-GC-EP-FORMULA-DISPATCH.md` |
| FP | `specs/functions/FP-GC-EP-FORMULA-DISPATCH.yaml` |
| BC | `specs/capabilities/BC-GC-FORMULA-DISPATCH.yaml` |
| Elucidation | `specs/elucidations/EL-D-Q1C-FORMULA-VERSION.yaml` |

## Notes
This file is auto-updated on session end. Manual edits will be overwritten.
Archive to `.agent/memory/episodic/snapshots/` if you need to preserve a specific state.
