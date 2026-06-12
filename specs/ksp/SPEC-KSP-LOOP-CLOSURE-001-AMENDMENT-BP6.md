# SPEC-KSP-LOOP-CLOSURE-001 — Amendment: Bridge Point 6

**Amends**: SPEC-KSP-LOOP-CLOSURE-001 §2 (The Five Bridge Points)
**Version**: 1.0
**Status**: Draft
**Author**: Wislet J. Celestin / Koales.ai
**Depends on**: SPEC-KSP-SOURCE-GRAPH-001 (SourceGraphDO must be deployed)

---

## Summary

Adds a sixth bridge point to the Loop Closure Service: when an amendment is adopted (Bridge Point 5), the new `Specification` and `ElucidationArtifact` nodes are immediately ingested into the Source Graph (`SPEC-KSP-SOURCE-GRAPH-001`) without waiting for the next full analysis run.

This closes an additional loop:

```
Artifact Graph ──→ Bead Graph ──→ Execution
      ↑                               ↓
      └──── Amendment adoption ←───── Divergence
                     ↓
              Source Graph  ← Bridge Point 6 (this amendment)
                     ↓
       Future agent context (query, context, impact)
       Future Reversa runs (archaeologist, detective)
```

---

## Bridge Point 6 — Specification Adoption → Source Graph

When `LoopClosureService.adoptAmendment()` completes Bridge Point 5 (new Specification written to artifact graph, new TrustBead/PolicyBead written to bead graph, KV invalidated), the optional `ingestSpecification` injectable is called with the new spec and elucidation node IDs.

### Config Addition

```typescript
// packages/loop-closure/src/types.ts — add to LoopClosureConfig
export interface LoopClosureConfig {
  artifactGraphDO: ArtifactGraphDOBase<unknown>;
  beadGraphDO: BeadGraphDOBase<unknown>;
  kvStore: KVNamespace;
  detectDivergences: DivergenceDetector;
  buildHypothesis: HypothesisBuilder;
  verifyAmendment: AmendmentVerifier;

  // Bridge Point 6 — optional; omit if Source Graph is not deployed
  ingestSpecification?: SpecificationIngester;
}

export type SpecificationIngester = (
  specId: string,
  elucidationId: string,
  artifactGraph: ArtifactGraphDOBase<unknown>
) => Promise<void>;
```

### Service Addition

```typescript
// packages/loop-closure/src/service.ts — end of adoptAmendment(), after KV invalidation

// Step 7: Source Graph ingestion (Bridge Point 6) — optional
if (this.config.ingestSpecification) {
  // Non-fatal: Source Graph staleness is acceptable; loop closure must not fail
  // because the intelligence layer is unavailable.
  try {
    await this.config.ingestSpecification(newSpecId, eaId, this.config.artifactGraphDO);
  } catch (err) {
    console.warn('[LoopClosure] BP6 ingest failed — Source Graph will update on next analysis run', err);
  }
}
```

### Factory Wiring

```typescript
// workers/ff-pipeline/src/coordinator/run-coordinator.ts (or wherever LoopClosureService is constructed)
import { SourceGraphDO } from '../source-graph-do-stub'

const loopClosure = new LoopClosureService({
  artifactGraphDO,
  beadGraphDO,
  kvStore: env.KV_KS,
  detectDivergences: factoryDivergenceDetector,
  buildHypothesis: factoryHypothesisBuilder,
  verifyAmendment: factoryAmendmentVerifier,

  // Bridge Point 6
  ingestSpecification: async (specId, eaId, ag) => {
    const spec = await ag.getNode(specId);
    const ea   = await ag.getNode(eaId);
    const doId = env.SOURCE_GRAPH.idFromName('function-factory');
    const stub = env.SOURCE_GRAPH.get(doId);
    await stub.fetch('/ingest', {
      method: 'POST',
      body: JSON.stringify({ nodes: [spec, ea], repo: 'function-factory' }),
    });
  },
});
```

---

## Updated Invariants

**INV-LC-007 — Bridge Point 6 is non-fatal.** Source Graph unavailability must not block amendment adoption. BP6 is wrapped in try/catch; failures are logged and the adoption result is returned regardless. The Source Graph will catch up on the next full analysis run.

**INV-LC-008 — BP6 executes after KV invalidation.** Bridge Point 6 fires after Step 5 (KV invalidation) of Bridge Point 5. The session cache is already invalidated before the Source Graph is updated — no race between stale session reads and the new Specification being queryable.

---

## Updated Implementation Ordering

Add to SPEC-KSP-LOOP-CLOSURE-001 §8 after existing step 7:

8a. Add `SpecificationIngester` type to `src/types.ts`.
8b. Add `ingestSpecification?` field to `LoopClosureConfig`.
8c. Add non-fatal BP6 call at end of `adoptAmendment()`, after KV invalidation.
8d. Wire `ingestSpecification` in Factory coordinator using `SOURCE_GRAPH` DO binding.
8e. Add `SOURCE_GRAPH` DO binding to `wrangler.jsonc` and `PipelineEnv`.
8f. Test: `adoptAmendment()` with `ingestSpecification` wired → `POST /ingest` called on SourceGraphDO with correct node payloads.
8g. Test: `adoptAmendment()` with `ingestSpecification` throwing → adoption still returns success; error is logged.
