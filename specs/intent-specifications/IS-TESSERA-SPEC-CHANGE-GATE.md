---
id: IS-TESSERA-SPEC-CHANGE-GATE
version: 1
title: "Tessera Spec Change Gate — Blast-radius check on the spec graph before editing any BC/IS/ES/PRS artifact"
sourceCapabilityId: BC-TESSERA-SPEC-CHANGE-GATE
sourceFunctionId: FP-TESSERA-SPEC-CHANGE-GATE
source_refs:
  - TESSERA-GATE-CONOPS
  - IS-TESSERA-PRE-EDIT-GATE
  - IS-TESSERA-SPEC-ADAPTER
  - IS-TESSERA-IMPACT
explicitness: explicit
rationale: >
  Spec artifacts — BC-* capabilities, IS-* intent specs, ES-* evidence specs,
  PRS-* requirement specs — are the Factory's source of truth. They reference
  one another through `source_refs` edges. A BC-* change can silently invalidate
  every IS that derives from it, exactly as a code change can silently break
  every test that depends on a function. The pre-edit gate (Gate 1) protects
  code symbols; it does nothing for spec artifacts, because spec artifacts are
  not code symbols — they live in the spec graph built by IS-TESSERA-SPEC-ADAPTER.

  Per TESSERA-GATE-CONOPS §3 (Gate 4) and §4, spec and governance changes flow
  through Gate 4 or Gate 5 instead of Gate 1. This IS specifies Gate 4: before
  an agent edits any spec artifact, it runs `tessera_impact` on the spec graph
  to find every IS/ES/FP artifact that references the target via REFERENCES
  edges (the `source_refs` relation indexed by IS-TESSERA-SPEC-ADAPTER). The
  count of referencing artifacts drives the decision: many referrers means a
  high-blast-radius spec change that a human must scope before a single
  character is written.

  This gate exists only when the spec-adapter index is current. The spec graph
  is the data; this gate is the enforcement layer over it.
---

# Tessera Spec Change Gate

## JTBD

When an agent is about to edit a specification artifact (BC-*, IS-*, ES-*,
PRS-*), it wants to know which other spec artifacts reference it, so it can
assess the blast radius of the spec change before writing a single character.

## Problem

The Factory's specs form a dependency graph. Every IS declares its `source_refs`;
every ES traces to the IS it verifies; FP functions point back to the IS that
specifies them. When an agent edits `BC-GC-FORMULA-DISPATCH` to add a
constraint, three IS files (IS-GC-DISPATCH-WIRE, IS-GC-EP-FORMULA-DISPATCH,
IS-GC-FIDELITY-VALIDATION) silently derive from that BC. Changing the BC without
reviewing those three is the spec-layer equivalent of changing a function that
12 tests depend on without knowing the tests exist.

The pre-edit gate cannot catch this. It reasons over code symbols in the code
graph. Spec artifacts are nodes in a different graph — the spec graph built by
IS-TESSERA-SPEC-ADAPTER from `source_refs` edges. Today nothing forces an agent
to traverse that graph before editing a spec. The requirement, like every
pre-Tessera-gate requirement, lives only in prose and is skipped under pressure.
The result is spec drift: a capability changes, its dependent intent specs are
never revisited, and the divergence is discovered only when an implementation
built to the stale IS fails review.

`tessera_impact` over the spec graph already knows the REFERENCES edges. What is
missing is a gate that runs that traversal before the edit and STOPs when the
blast radius is high enough to demand human scoping.

## Goal

1. Implement a **spec-change gate function** (`checkSpecChangeGate`) in the
   Tessera Worker that agents MUST call before editing any spec artifact. The
   gate:
   - Resolves the target spec node in the spec graph (IS-TESSERA-SPEC-ADAPTER)
   - Runs upstream `tessera_impact` to find every artifact that REFERENCES the
     target
   - Returns a structured `SpecChangeGateResult` (PROCEED / WARN / STOP) driven
     by the count of referencing artifacts
2. Expose `POST /repos/:slug/spec-change-check` accepting
   `{ target: "BC-GC-FORMULA-DISPATCH" }`, and `tessera_spec_change_check` as an
   MCP tool.
3. Produce a **gate audit log** entry in ArangoDB for every call:
   `tessera_spec_change_gates` collection. Immutable.
4. Require the spec-adapter index to be current; surface stale-index as WARN.

## Scope

**In scope:**
- `workers/tessera-worker/src/spec-change-gate.ts` — `checkSpecChangeGate()` +
  HTTP route `POST /repos/:slug/spec-change-check`
- `workers/tessera-worker/src/mcp.ts` — register `tessera_spec_change_check`
- `workers/tessera-worker/src/schema.ts` — `tessera_spec_change_gates`
  collection (append-only, no DELETE route)

**Out of scope:**
- Any change to IS-TESSERA-SPEC-ADAPTER's graph-building logic (it owns the
  spec graph; this gate consumes it)
- Any change to the `tessera_impact` engine itself
- Auto-editing or auto-notifying the owners of referencing specs (the gate
  surfaces the list; notification is the human's action)
- Code-symbol gating (that is Gate 1)

## Acceptance Criteria

### Gate logic (AC-SC*)

**AC-SC1.** `POST /repos/:slug/spec-change-check` accepts
`{ target: "BC-GC-FORMULA-DISPATCH" }`. The gate resolves the target node in the
spec graph and runs upstream impact (REFERENCES edges) on it.

**AC-SC2.** The gate returns every IS/ES/FP artifact that references the target
via REFERENCES edges, grouped by depth (d=1 direct referrers, d=2 transitive):
```json
{
  "decision": "STOP",
  "target": "BC-GC-FORMULA-DISPATCH",
  "referencingByDepth": {
    "1": ["IS-GC-DISPATCH-WIRE", "IS-GC-EP-FORMULA-DISPATCH"],
    "2": ["ES-GC-FIDELITY-VALIDATION"]
  },
  "referencingCount": 3,
  "message": "3 spec artifacts reference BC-GC-FORMULA-DISPATCH. All must be reviewed before the BC is changed."
}
```

**AC-SC3.** The referencing-artifact count maps to a decision:

| Referencing IS count | Risk | Decision |
|----------------------|------|----------|
| >= 10 | CRITICAL | STOP |
| >= 3 | HIGH | STOP |
| 1–2 | MEDIUM | WARN |
| 0 | LOW | PROCEED |

**AC-SC4.** The response includes the full list of referencing spec IDs (not
just the count) so the agent can surface them to the human and notify the owners
of each referencing artifact before the spec change proceeds.

**AC-SC5.** Every `spec-change-check` writes a document to
`tessera_spec_change_gates` (append-only): target, referencing IDs, count,
decision, agentId, timestamp. There is NO DELETE route. Immutable.

**AC-SC6.** The gate requires the spec-adapter index to be current. If
IS-TESSERA-SPEC-ADAPTER is not deployed and indexing, or its index is stale, the
gate returns `WARN` with the explicit message "Spec-adapter index is stale or
absent — re-index before this check is authoritative." It MUST NEVER return
`PROCEED` against a stale or absent spec index.

### MCP tool (AC-MCP*)

**AC-MCP1.** `tessera_spec_change_check` is registered as an MCP tool. Input
schema matches AC-SC1. Output schema matches AC-SC2.

### Reference case (AC-REF*)

**AC-REF1.**
`tessera_spec_change_check({ target: "BC-GC-FORMULA-DISPATCH", repo: "function-factory" })`
returns `decision: "STOP"` with `referencingByDepth["1"]` including
`IS-GC-DISPATCH-WIRE` and `IS-GC-EP-FORMULA-DISPATCH` — the artifacts that carry
`BC-GC-FORMULA-DISPATCH` in their `source_refs`. The audit log records the STOP
and the full referencing list.

## Environment dependencies

| Env var | wrangler.jsonc | Purpose |
|---------|----------------|---------|
| `ARANGO_URL` | secret | ArangoDB connection |
| `ARANGO_USERNAME` | secret | ArangoDB user |
| `ARANGO_PASSWORD` | secret | ArangoDB password |
| `ARANGO_DATABASE` | var | Database name |
| `TESSERA_QUERY_TOKEN` | secret | Bearer auth |

Inherits the spec graph from IS-TESSERA-SPEC-ADAPTER and the impact engine from
IS-TESSERA-IMPACT. No new env vars. **Hard dependency:**
IS-TESSERA-SPEC-ADAPTER must be deployed and indexing for this gate to function.

## Non-negotiables

- This gate only works when the spec-adapter index is current. A stale or absent
  spec index returns WARN, never PROCEED.
- The decision is driven by the count of referencing artifacts: >=3 STOP, 1–2
  WARN, 0 PROCEED. The gate does not auto-proceed on a HIGH/CRITICAL referencing
  count.
- `tessera_impact` over the spec graph is the engine; the gate is the
  enforcement layer over it, not a replacement.
- The audit log is immutable. There is no API to delete or modify gate entries.
- Per TESSERA-GATE-CONOPS §5, the risk→decision mapping, audit-trail
  immutability, and AGENTS.md enforcement contracts are shared across all five
  gates and apply here unchanged.

## Success Metrics

Spec drift from unscoped capability edits cannot occur silently:

1. An agent editing a BC-* with three dependent IS files receives STOP and the
   list of all three before writing a character.
2. The human scopes the BC change with full visibility of every referencing
   artifact, and the owners of those artifacts are notified.
3. The audit log records which spec changes carried the largest blast radius
   across the spec graph.
4. A BC-* change can no longer silently invalidate its dependent IS files —
   the references are surfaced before the edit, not discovered at review time.
