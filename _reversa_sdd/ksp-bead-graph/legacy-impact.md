# Legacy Impact — @factory/bead-graph (ksp-bead-graph)

> Phase: Steps 10–20 complete. Gate: typecheck + vitest all green.
> Generated: 2026-06-10

---

## Impact Table

| File affected | Component (from architecture.md) | Impact type | Severity |
|---|---|---|---|
| `packages/bead-graph/package.json` | `@factory/packages` library packages | componente-novo | low |
| `packages/bead-graph/tsconfig.json` | `@factory/packages` library packages | componente-novo | low |
| `packages/bead-graph/vitest.config.ts` | `@factory/packages` library packages | componente-novo | low |
| `packages/bead-graph/src/bead-id.ts` | `@factory/packages` — bead-graph core | componente-novo | low |
| `packages/bead-graph/src/schemas.ts` | `@factory/packages` — bead-graph core | componente-novo | medium — defines 8 bead types; downstream packages will import these types |
| `packages/bead-graph/src/migrate.ts` | `@factory/packages` — bead-graph core | componente-novo | low |
| `packages/bead-graph/migrations/v00_base.ts` | `FactoryStore` DO / `@factory/packages` | componente-novo | medium — new SQLite schema (beads + bead_edges tables) alongside existing D1 schema |
| `packages/bead-graph/src/bead-queries.ts` | `@factory/packages` — bead-graph core | componente-novo | medium — all storage operations; consumers will depend on these signatures |
| `packages/bead-graph/src/do.ts` | `FactoryStore` DO / `SynthesisCoordinator` DO | componente-novo | medium — abstract base; concrete DOs in downstream phases extend this |
| `packages/bead-graph/src/sdk.ts` | `@factory/packages` — ksp-sdk | componente-novo | high — KnowingStateSDKImpl is the primary entry point for all agent session management |
| `packages/bead-graph/bindings.ts` | `BeadGraphWorker` CF Worker | componente-novo | low |
| `packages/bead-graph/src/worker.ts` | `BeadGraphWorker` CF Worker | componente-novo | low — new worker; no existing worker modified |
| `packages/bead-graph/wrangler.jsonc` | Cloudflare deployment config | componente-novo | low |
| `packages/bead-graph/tests/bead.test.ts` | QA / CI | componente-novo | low |

---

## Preserved Rules

Cross-referenced against `/Users/wes/Developer/function-factory/_reversa_sdd/domain.md`:

| Rule ID | Rule | How preserved |
|---------|------|---------------|
| BR-01 | Signal Idempotency | Not affected — bead-graph is a separate storage layer from D1 signal storage |
| BR-02 | Birth Gate (Confidence Threshold) | Not affected — bead-graph does not participate in pipeline birth gate |
| BR-03 | Architect Approval Gate | Not affected — this is a pipeline concern; bead-graph stores ConsentBead/EscalationBead for human-in-the-loop at the agent-session level, which is complementary |
| BR-04 | Semantic Review Advisory | Not affected |
| BR-05 | Coherence Verification Fail-Closed | Analogously preserved in bead-graph as INV-BG-008 (fail-closed): retrieveKnowingState failure degrades autonomy to SUGGEST |
| BR-06 | Intent Violation Escalation | Preserved analogy: EscalationBead captures escalation from agent execution to human review |
| BR-07 | Feedback Loop Depth Cap | Not directly affected; OutcomeBead → AmendmentBead loop is capped by append-only writes (no cycles) |
| BR-08 | Test Atoms Stripped | Not affected |
| BR-09 | Invariants Must Be Source-Derived | Preserved: all 8 bead schemas are derived verbatim from SPEC-KSP-BEAD-GRAPH-001 |
| BR-10 | specContent Grounded Mode | Not affected |
| BR-11 | Graph Path Deprecated | Not affected |

**New domain rules introduced by bead-graph:**

| Rule ID | Rule |
|---------|------|
| INV-BG-001 | Write-once: no UPDATE/DELETE on beads table |
| INV-BG-002 | Content-addressed identity: bead_id = SHA-256(type + canonical_json(content) + sorted(parent_ids)) |
| INV-BG-003 | Retrieval before execution: writeExecutionBead asserts ksRetrievedAt is set |
| INV-BG-004 | Amendment is a new Bead (not an update to target) |
| INV-BG-005 | ConsentBead revocation is a new Bead |
| INV-BG-006 | KV invalidated on every write |
| INV-BG-007 | AuditBead in every transaction |
| INV-BG-008 | Fail-closed: autonomyFloor degrades to SUGGEST on retrieveKnowingState failure |
