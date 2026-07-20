# Regression Watch — @factory/loop-closure (ksp-loop-closure)

> Generated 2026-06-10 · Phase ksp-loop-closure · Steps 22–26
> Each entry represents a new contract or invariant introduced by this phase.

---

## Watch List

| ID | Source file + section | Expected rule after change | Check type | Violation signal |
|----|----------------------|---------------------------|-----------|-----------------|
| W001 | `src/service.ts` § recordExecution — INV-LC-003 | Artifact graph upsertNode called BEFORE beadGraphDO.writeBead for Execution bead | Test: loop.test.ts Bridge Point 2 call-order assertion | Call log shows `writeBead` before `upsertNode`; test "Bridge Point 2" fails |
| W002 | `src/service.ts` § adoptAmendment step 3b — INV-LC-005 | ElucidationArtifact node upserted unconditionally on every adoption | Test: loop.test.ts Bridge Point 5 eaNodes assertion | `eaNodes.length === 0` in Bridge Point 5 test; or node type absent from artifact graph |
| W003 | `src/service.ts` § adoptAmendment step 5 — INV-LC-006 / BR-KSP-08 | KV keys `ks:{orgId}:*`, `head:{orgId}:*`, `maintenance:{orgId}` deleted before function returns | Test: loop.test.ts Bridge Point 5 KV invalidation assertions | KV store still contains seeded keys after `adoptAmendment` returns |
| W004 | `src/bridge-fields.ts` — BRIDGE_* constants | All four `artifact_graph_*_id` field names remain unchanged | TSC + static import check | Renaming any constant breaks bead-graph schema readers and all downstream consumers |
| W005 | `src/service.ts` § proposeAmendment — BP4 | AmendmentBead written with `artifact_graph_amendment_id` bridge field pointing to Amendment node ID | Test: loop.test.ts Bridge Point 4 | `amendBead.content.artifact_graph_amendment_id !== amendmentId` |
| W006 | `src/service.ts` § recordOutcome — BP3 | OutcomeBead written with `artifact_graph_divergence_id` set when divergence detected; null otherwise | Test: loop.test.ts Bridge Point 3 | `content.artifact_graph_divergence_id` absent or mismatched when divergence present |
| W007 | `src/service.ts` § recordExecution — BP2 | ExecutionBead `artifact_graph_execution_id` matches the Execution node ID written to artifact graph | Test: loop.test.ts Bridge Point 2 bridge field assertion | `beadContent.artifact_graph_execution_id !== result.executionNodeId` |
| W008 | `src/service.ts` § adoptAmendment — BP5 | New TrustBead/PolicyBead has `artifact_graph_specification_id` bridge field pointing to new Specification node | Test: loop.test.ts Bridge Point 5 | `beadContent.artifact_graph_specification_id !== newSpecId` |
| W009 | `package.json` § dependencies | Zero `@factory/*` imports except `@factory/artifact-graph` and `@factory/bead-graph` (BR-KSP-15 analog) | TSC import graph audit | Any new `@factory/` dependency other than artifact-graph or bead-graph imports domain coupling |
| W010 | `src/service.ts` § openSession — fail-closed behavior (BR-KSP-04) | When `retrieveKnowingState()` throws, `autonomyFloor` defaults to `'SUGGEST'` | Unit test (not yet written; recommend adding) | On KV read failure: `session.autonomyFloor !== 'SUGGEST'`; execution proceeds at elevated autonomy |
| W011 | `src/service.ts` § adoptAmendment — BR-KSP-05 append-only | No `DELETE` or `UPDATE` statement issued to artifact graph or bead graph during adoption | Code audit / grep for `DELETE` or `UPDATE` in service.ts | Any `DELETE` or `UPDATE` call on artifact or bead store |
| W012 | `src/service.ts` § recordOutcome — Divergence → evidences edge | `evidences` edge written from trace node to divergence node when divergence detected | Test: loop.test.ts Bridge Point 3 | `evidencesEdges.length === 0` after a run with non-empty divergences |

---

## KSP Invariants to Watch (Summary Reference)

| Invariant | Watch IDs |
|-----------|-----------|
| Append-only (BR-KSP-05) | W011 |
| Bridge field propagation (BR-KSP-10, INV-LC-002) | W004, W005, W006, W007, W008 |
| @factory/ naming scope — no domain coupling (BR-KSP-15) | W009 |
| Write sequence BP2 — artifact graph first (INV-LC-003, BR-KSP-13) | W001 |
| ElucidationArtifact unconditional (INV-LC-005, BR-KSP-09) | W002 |
| KV invalidation before return (INV-LC-006, BR-KSP-08) | W003 |
| Fail-closed session open (BR-KSP-04) | W010 |
