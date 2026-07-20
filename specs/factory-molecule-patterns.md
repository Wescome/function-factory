# Factory Molecule Patterns + @mastra/memory
**Wislet J. Celestin / Koales.ai — June 2026**

---

## Primitives

Every pattern below composes from the same substrate:

- **Bead** — one `ExecutionBead` row in CoordinatorDO SQLite, one `AtomDirective` on CF Queue, one `ThinkExecutor` fiber + `buildConductingAgent()` instance
- **Edge** — `bead_edges` row; `claimBead()` checks all parent edges are `done` before releasing a bead to `ready`
- **Memory thread** — `@mastra/memory` instance on CommissioningAgentDO, `threadId = runId`; accumulates governance events (Divergences, Hypotheses, Amendments) only — never atom outputs

---

## Pattern 1 — Linear Chain

The baseline. Each bead depends on the previous.

```
Specification
     │
  [Planner]──done──►[Coder]──done──►[Verifier]
  atom-1            atom-2            atom-3
```

**Bead edges:**
```
atom-2.parentIds = [atom-1]
atom-3.parentIds = [atom-2]
```

**CoordinatorDO behavior:** `claimBead()` for `atom-2` blocks until `atom-1.status = done`. Serial execution, no parallelism.

**Memory:** CommissioningAgentDO thread receives one Divergence event if any bead `failBead()`. For a clean run, the memory thread may be empty — no governance events to accumulate.

---

## Pattern 2 — Parallel Fan-Out

Independent atoms with no mutual dependencies execute concurrently. Three CF Queue messages fire simultaneously; three ThinkExecutor fibers run in parallel.

```
Specification
     │
  [Planner]──done──►[Coder-A]
                  ├─►[Coder-B]
                  └─►[Coder-C]
```

**Bead edges:**
```
coder-a.parentIds = [planner]
coder-b.parentIds = [planner]
coder-c.parentIds = [planner]
```

**CoordinatorDO behavior:** all three `Coder` beads become `ready` simultaneously after `planner` releases. `claimBead()` is a CAS — each ThinkExecutor races to claim its own bead.

**Memory:** if `Coder-B` diverges while `Coder-A` and `Coder-C` succeed, CommissioningAgentDO receives one Divergence. Thread records the Divergence + resulting Hypothesis. Amendment loop may re-commission `Coder-B` only — `Coder-A` and `Coder-C` beads remain `done` (idempotent re-seed).

---

## Pattern 3 — Fan-Out + Barrier (Adversarial Critic)

One Coder bead fans out to N parallel Critic beads. A synthesis bead barriers on all N before proceeding. Implements adversarial verification with majority vote.

```
[Coder]──done──►[Critic-correctness ]
              ├─►[Critic-security    ]──barrier──►[Synthesis]──►[Verifier]
              └─►[Critic-spec-conformance]
```

**Bead edges:**
```
critic-correctness.parentIds    = [coder]
critic-security.parentIds       = [coder]
critic-spec-conformance.parentIds = [coder]
synthesis.parentIds = [critic-correctness, critic-security, critic-spec-conformance]
```

**CoordinatorDO behavior:** `synthesis` bead stays `ready=false` until all three Critic beads are `done`. `getNextReady()` will not surface it until the barrier clears.

**Critic AtomDirective:** each Critic receives the same `specFiles` and `instructions` derived from the Specification, but with distinct `role` fields (`critic:correctness`, `critic:security`, `critic:spec-conformance`). Tool policy is read-only — no workspace writes.

**Synthesis AtomDirective:** receives majority-vote instructions. Its `instructions` field (compiled by Mediation Agent DO) encodes: "three Critic ExecutionTrace nodes exist for this Coder output; assess agreement and produce a unified Verdict."

**Memory:** if two of three Critics raise a Divergence, CommissioningAgentDO thread receives two Divergence events. `buildHypothesis()` reasons across both in the same per-run thread — this is the primary value of per-run scoping. The thread has the full Divergence context when proposing the Amendment.

**Open item:** `GearFormula` does not yet express barrier vs. sequence edge semantics. `bead_edges` schema needs `edge_type: 'sequence' | 'barrier'` — currently all edges are treated as barriers.

---

## Pattern 4 — Loop-Until-Dry (Verifier Fleet)

A Verifier atom runs, produces findings, re-queues itself if findings remain, stops after K dry rounds. The `seen` set is the Execution-Trace corpus in ArtifactGraphDO — not agent memory.

```
[Coder]──done──►[Verifier]──findings remain──►[Verifier]──dry──►[Verifier]──dry──►[done]
                  round-1                       round-2            round-3
                                                                  (K=2 dry → stop)
```

**Bead behavior:** each Verifier round is a new `ExecutionBead` with a new `atomId`. The `seen` set is derived from ArtifactGraphDO ExecutionTrace nodes for this `runId` — the Verifier's `AtomDirective.instructions` (compiled by Mediation Agent DO) includes the instruction to query existing traces and skip previously surfaced findings.

**Not a loop in CoordinatorDO:** CoordinatorDO has no loop primitive. Each Verifier round is seeded as a new bead. LoopClosureService detects the dry condition (K dry rounds with no new Divergences) and signals CommissioningAgentDO to stop re-commissioning.

**Memory:** CommissioningAgentDO per-run thread accumulates one Divergence event per Verifier round that produces findings. After K dry rounds, the thread shows the full arc: what was found, when it was resolved, what Hypotheses were formed. This is the amendment reasoning corpus for this run.

**Atom outputs:** Verifier ExecutionTrace nodes go to ArtifactGraphDO. CommissioningAgentDO does NOT read them. It only receives Divergence events from LoopClosureService (`POST /divergence`).

---

## Pattern 5 — Molecule with Amendment Loop

A molecule fails mid-execution. CommissioningAgentDO forms a Hypothesis, proposes an Amendment, and re-commissions from the failed bead forward.

```
[Planner]──done──►[Coder]──FAILED
                             │
                    LoopClosureService BP3
                             │
                    POST /divergence → CommissioningAgentDO
                             │
                    buildHypothesis()   ← per-run memory thread consulted
                    proposeAmendment()  ← Amendment node written to ArtifactGraphDO
                    Verification-Process (Mastra eval T4)
                             │
                    ┌────────┴─────────┐
                 ADOPTED            REJECTED
                    │                  │
            successor Specification   [*] terminal
            new run commissioned
            Planner bead: done (skip)
            Coder bead:   re-seeded as ready
```

**Memory role:** `buildHypothesis()` reads the CommissioningAgentDO per-run memory thread to retrieve the Divergence event(s). The thread provides the governance context — what was observed, what was expected per Specification — without needing to read the Coder's raw ExecutionTrace output.

**Re-commission:** successor Specification triggers a new `runId`. CommissioningAgentDO opens a new per-run memory thread for the successor run. Prior run thread is retained in D1Store (archived, not deleted) for amendment lineage.

---

## @mastra/memory Placement Summary

| Actor | Has memory? | threadId | Accumulates |
|---|---|---|---|
| CommissioningAgentDO | Yes | `runId` | Divergences, Hypotheses, Amendments |
| ConductingAgent (ThinkExecutor) | If adopted | `runId` | Context compression only — not governance events |
| Molecules | No | — | Not an agent |
| Fleet atoms (fan-out Critic, loop-until-dry Verifier) | No | — | Short-lived; outputs → ArtifactGraphDO |
| MediationAgentDO | No | — | Compile-only; no LLM loop |
| CoordinatorDO | No | — | Bead graph only; no LLM loop |

**Invariant:** CommissioningAgentDO memory thread accumulates governance events only. Atom outputs flow exclusively to ArtifactGraphDO (ExecutionTrace nodes) and CoordinatorDO (bead status). No agent reads another agent's outputs directly.

**D1Store binding:** memory store D1 binding must be distinct from the Factory-wide D1 audit log. Audit log is append-only and cross-org; memory store is per-org mutable.

---

## Open Items

1. `bead_edges` schema `edge_type: 'sequence' | 'barrier'` — not yet decided; currently all edges treated as barriers
2. `GearFormula` barrier annotation — not yet expressible in the formula definition
3. Loop-until-dry stop condition signal path — LoopClosureService → CommissioningAgentDO coordination not yet specced
4. Per-run memory thread archival policy — retained for amendment lineage? pruned on run terminal?
5. Separate D1 binding name for memory store — not yet assigned in wrangler config
