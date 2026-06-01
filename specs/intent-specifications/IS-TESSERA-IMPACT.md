---
id: IS-TESSERA-IMPACT
version: 1
title: "Tessera Impact Analysis — AQL traversal blast radius with risk scoring"
sourceCapabilityId: BC-TESSERA-IMPACT
sourceFunctionId: FP-TESSERA-IMPACT
source_refs:
  - TESSERA-CF-SPEC
  - IS-TESSERA-ARANGO-SCHEMA
  - IS-TESSERA-INDEXER
explicitness: explicit
rationale: >
  TESSERA-CF-SPEC §5 is the correctness core of cloud Tessera: impact analysis.
  The local engine (`local-backend.ts:_runImpactBFS`, GT-IMPACT) is a
  breadth-first traversal with Class/Interface seeding (GT-CTX480 / fix #480),
  per-relation confidence floors (GT-CONF / M1), and exact risk thresholds
  (GT-RISK). The cloud reproduction expresses the same behavior as a **native AQL
  graph traversal** (`INBOUND`/`OUTBOUND` over the edge collection) plus a
  post-traversal scoring pass — bit-equivalent to local Tessera (§5).

  This is UC-1, the critical path: agents must run impact before any symbol edit.
  The two directions must produce different result sets (the C1 regression that
  v0.1 got backwards), and a Class target must seed from its Constructor and File
  (C2) or it returns zero — the bug GT-CTX480 fixes.
---

# Tessera Impact Analysis (WP-T3 impact core)

## JTBD

When an agent or developer is about to change a symbol, they want to know what
breaks if they change it — every direct caller, every transitively affected
symbol, and a risk level — so that they can edit safely instead of guessing at
the blast radius.

## Problem

Impact analysis is Tessera's most-used and most-load-bearing operation (UC-1):
agents must run it before every symbol edit. The local engine is a hand-rolled
BFS over a SQLite edge table (GT-IMPACT). In the cloud, the graph lives in
ArangoDB, where the BFS is a native AQL traversal.

Two correctness traps the spec calls out explicitly:
- **Direction (C1).** "Who breaks if I change this" is `INBOUND` (callers point
  AT the target), not `OUTBOUND`. v0.1 had this backwards. The two directions
  must not return the same set.
- **Class/Interface seeding (C2 / GT-CTX480).** Class and Interface nodes have
  NO direct CALLS/IMPORTS edges — callers reference the Constructor (via
  HAS_METHOD) and the owning File (via DEFINES). A naive traversal from a Class
  node returns zero impact. The seeding fix discovers callers via the
  Constructor and importers via the File, without returning the seed nodes
  themselves.

Plus the confidence model (M1 / GT-CONF: stored confidence preferred when > 0,
else per-type floor) and exact risk thresholds (GT-RISK).

## Goal

Implement `POST /repos/:slug/impact` in
`workers/tessera-worker/src/impact.ts`:

```
{ target: string, direction?: 'upstream' | 'downstream', maxDepth?: number }
```

1. Resolve `target` to a start node (by name; disambiguate if multiple).
2. **Upstream (default):** `INBOUND` AQL traversal — who breaks if I change this.
   **Downstream:** `OUTBOUND` — what this depends on.
3. **Class/Interface seeding:** when the target is a Class or Interface, seed the
   traversal from its Constructor (HAS_METHOD) and owning File (DEFINES) nodes —
   without returning the seed nodes themselves.
4. Filter relations to the impact set; apply confidence floors per relation type;
   drop edges below 0.3.
5. Score risk (CRITICAL/HIGH/MEDIUM/LOW) from the depth-1 count and process
   count (GT-RISK).

This reproduces `_runImpactBFS` (GT-IMPACT) in AQL, bit-equivalent to local
Tessera for the same commit.

## Scope

**In scope:**
- `workers/tessera-worker/src/impact.ts` — the `POST /repos/:slug/impact` handler
  and the AQL traversal + scoring logic.
- Upstream `INBOUND` / downstream `OUTBOUND` traversal (§5.1).
- Class/Interface Constructor + File seeding (§5.2, GT-CTX480).
- Relation filter, per-type confidence floors, 0.3 cutoff (§5.4, GT-CONF).
- Risk scoring per GT-RISK (§5.5).
- Symbol resolution + ambiguous-candidate handling (§5.3).

**Out of scope:**
- The MCP wrapper that exposes `tessera_impact` over JSON-RPC (IS-TESSERA-MCP —
  this IS provides the HTTP route it calls).
- Schema / collections (IS-TESSERA-ARANGO-SCHEMA).
- Building the graph (IS-TESSERA-INDEXER).
- Cross-repo `@group` fan-out (V2, §5).
- Process detection — V2-deferred (§4.3); `processCount = 0` in V1, risk degrades
  to depth/module signals (§5.5).
- Community / `module` field — V2; `moduleCount = 0` in V1 (§5.5).

## Acceptance Criteria

### Direction (AC-DIR*) — C1

**AC-DIR1.** `direction: 'upstream'` (the default when omitted) issues an
`INBOUND` traversal from the start node over `tessera_edges_{slug}` — "who breaks
if I change this." `direction: 'downstream'` issues `OUTBOUND` — "what this
depends on."

**AC-DIR2.** For a target with both callers and callees, the upstream and
downstream result sets are **not equal** (the C1 regression test, AC-IMPACT-1).

**AC-DIR3.** The traversal is `1..maxDepth`. `maxDepth` clamps to 1–32, default
3 (GT-TOOLS impact schema). Depth-1 results are labeled WILL BREAK, depth-2
LIKELY AFFECTED, depth-3 MAY NEED TESTING (§5.5).

### Class/Interface seeding (AC-SEED*) — C2 / GT-CTX480

**AC-SEED1.** When `target.kind IN ["Class", "Interface"]`, the traversal is
seeded from:
- **Constructor nodes** reached via `HAS_METHOD` (1 hop OUTBOUND, filtered to
  `kind == "Constructor"`) — so CALLS edges to `new X(...)` are found.
- **File nodes** reached via `DEFINES` (1 hop INBOUND, filtered to
  `kind == "File"`) — so IMPORTS edges on the owning file are found.

**AC-SEED2.** The seed nodes themselves are **NOT returned** in the impacted set:
the target Class/Interface, its Constructors, and its owning File are excluded
from `impacted` (they are the definition containers / seeds, not dependents —
GT-IMPACT:2577–2579). The traversal returns the callers and importers reached
*from* the seeds.

**AC-SEED3.** Impact on a Class target returns **non-empty** results (not zero) —
this is the GT-CTX480 fix. For a fixture `class UserService`, the returned
callers include every `new UserService(...)` site (via the Constructor seed) and
every module that imports its file (via the File seed) (AC-IMPACT-2).

### Relation filter + confidence (AC-CONF*) — M1 / GT-CONF

**AC-CONF1.** The traversal filters edges to the impact relation set:
`CALLS, IMPORTS, EXTENDS, IMPLEMENTS, HAS_METHOD, ACCESSES, METHOD_OVERRIDES,
METHOD_IMPLEMENTS`. (The default usage-based set is `CALLS, IMPORTS, EXTENDS,
IMPLEMENTS`; member/field relations are included for the full impact surface per
this IS.)

**AC-CONF2.** Effective confidence per edge: use the **stored** `e.confidence`
when it is `> 0`; otherwise apply the per-relation floor:
| Relation | Floor | | Relation | Floor |
|----------|-------|-|----------|-------|
| CALLS | 0.90 | | HAS_METHOD | 0.85 |
| IMPORTS | 0.90 | | ACCESSES | 0.70 |
| EXTENDS | 0.85 | | METHOD_OVERRIDES | 0.80 |
| IMPLEMENTS | 0.85 | | METHOD_IMPLEMENTS | 0.80 |

(Floors per this IS's relation set; the stored value is preferred when present
and positive — GT-CONF rule.)

**AC-CONF3.** Edges whose **effective** confidence is below **0.3** are filtered
out of the result (the cutoff). An edge at or above 0.3 is retained.

### Risk scoring (AC-RISK*) — GT-RISK

**AC-RISK1.** Let `directCount` = depth-1 impacted count, `processCount` =
affected processes. Risk is:
- **CRITICAL** if `directCount > 10` OR `processCount > 5`
- **HIGH** if `directCount > 5` OR any process is affected (`processCount >= 1`)
- **MEDIUM** if `directCount` is 2–5
- **LOW** if `directCount` is 0–1

(This IS's thresholds per the task contract. V1 caveat: process detection is
V2-deferred, so `processCount = 0`; risk is computed from `directCount` alone and
never under-reports relative to that signal, §5.5.)

**AC-RISK2.** The response includes the resolved target, `direction`, the risk
level, `impactedCount` (total distinct impacted symbols), the depth-grouped
impacted set, and the depth-1 caller list.

### Resolution (AC-RES*)

**AC-RES1.** `target` is resolved to a node by `name`. If multiple nodes share
the name, the response returns ranked candidates (kind priority:
Class/Interface/Function > Method > Constructor, §5.3) with
`status: 'ambiguous'` rather than silently picking one. A `target_uid` (direct
`_key`) skips resolution.

**AC-RES2.** A `target` that resolves to no node → 404
`{ error: "symbol not found", target }`.

### Reference results (AC-REF*)

**AC-REF1.** `POST /repos/function-factory/impact` with
`{ target: "notifyWorkflowComplete", direction: "upstream" }` returns
`risk: "LOW"`, `impactedCount: 4`, and a depth-1 caller list that includes
`alarm`, `handleStageComplete`, and `handleForceComplete` (matching local
Tessera for the same commit, AC-IMPACT-1).

**AC-REF2.** Impact on a Class target returns a **non-empty** impacted set (not
zero) — the C2 seeding works end to end (AC-SEED3, AC-IMPACT-2).

## Environment dependencies

| Env var | wrangler.jsonc | Purpose |
|---------|----------------|---------|
| `ARANGO_URL` | secret | ArangoDB connection URL |
| `ARANGO_USERNAME` | secret | ArangoDB user |
| `ARANGO_PASSWORD` | secret | ArangoDB password |
| `ARANGO_DATABASE` | var (`"function_factory"`) | ArangoDB database name |
| `TESSERA_QUERY_TOKEN` | secret | Bearer auth on the route (enforced by the MCP/route layer; IS-TESSERA-MCP) |

The route reads `tessera_nodes_{slug}` and `tessera_edges_{slug}` (built by
IS-TESSERA-INDEXER). It performs no writes — the graph is read-only to agents
(G1).

## Non-negotiables

- Upstream = `INBOUND`, downstream = `OUTBOUND`; the two result sets differ
  (AC-DIR1, AC-DIR2, C1).
- Class/Interface targets seed from Constructor (HAS_METHOD) and File (DEFINES);
  seed nodes are never returned; a Class target never returns zero impact
  (AC-SEED1–3, C2 / GT-CTX480).
- Stored confidence preferred when > 0, else per-type floor; edges below 0.3 are
  dropped (AC-CONF2, AC-CONF3, M1 / GT-CONF).
- Risk thresholds match the AC-RISK1 mapping exactly (GT-RISK).
- The impact route is **read-only** — it never mutates ArangoDB (G1).
- Ambiguous targets return ranked candidates, never a silent pick (AC-RES1,
  §5.3).

## Success Metrics

`POST /repos/:slug/impact` reproduces the local `_runImpactBFS` engine as a
native AQL traversal: upstream `INBOUND` and downstream `OUTBOUND` produce
different result sets; a Class or Interface target seeds correctly from its
Constructor and owning File and returns a non-empty impacted set without
returning the seed nodes themselves; confidence floors apply per relation type
with stored values preferred and sub-0.3 edges dropped; and risk scores match the
GT-RISK thresholds.

The reference case proves parity with local Tessera: impact on
`notifyWorkflowComplete` in function-factory returns risk LOW, an impacted count
of 4, and depth-1 callers including `alarm`, `handleStageComplete`, and
`handleForceComplete`. Impact on a Class target returns non-empty results,
confirming the GT-CTX480 seeding fix carries forward to the cloud.

The route is read-only, resolves ambiguous symbol names to ranked candidates
rather than guessing, and serves UC-1 — the critical path agents hit before every
symbol edit.
