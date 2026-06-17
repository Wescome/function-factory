SPEC-ARCHITECT-AGENT-DO-001 v2.0 DRAFT

**ArchitectAgentDO**

*Stack update · Recursive gate · /review endpoint · Gap classification*

**0. Scope**

This spec supersedes the June 13 2026 draft and the original May 2025 ARCHITECT-AGENT-DO-SPEC.md. Changes from prior versions:

  ------------------------------ -------------------------------------------------------------------------------------------------------------------------------------------------------------
  **Change**                     **Detail**

  ArangoDB retired               All AQL queries replaced by BFS traversal on ArtifactGraphDO DO SQLite. No external graph database. AA-INV-003 codified.

  Recursive gate added           ArchitectAgentDO is now a mandatory success-path gate on every run, not only a failure-recovery actor. POST /review endpoint added.

  Gap classification added       New domain D5: gap classification (architecture-gate vs. implementation). Used by POST /review to route fix swarms vs. amendment loop.

  DISPATCH_QUEUE binding added   For broadcasting restructured AtomDirectives to CommissioningAgentDO after /review verdict.

  Flue/Gas City retired          All references to Flue, Gas City, SynthesisCoordinator, harness-bridge removed. Current stack: ThinkExecutor + buildConductingAgent() + \@cloudflare/shell.
  ------------------------------ -------------------------------------------------------------------------------------------------------------------------------------------------------------

**1. Identity and Topology**

Singleton DO --- key: architect-agent-global. One instance per factory, not per repo. Multi-repo responsibility. ArchitectAgentDO extends DurableObject (not Think) --- it constructs a Think session on demand for LLM operations (CRP resolution, anomaly synthesis, gap classification). It is not a persistent agent loop.

Callers: CommissioningAgentDO only. ArchitectAgentDO never calls CoordinatorDO or ThinkExecutor directly (AA-INV-002).

  -------------------------- ---------------------------------------------------------------------------------- ------------------------------
  **Decision domain**        **Trigger**                                                                        **Endpoint**

  D1 --- Patch governance    Cross-repo patch propagation triggered by Layer 4 learning cycle                   POST /patch

  D2 --- CRP resolution      CommissioningAgentDO sends CRP after amendmentCycleCount = 3 exhausted             POST /crp

  D3 --- Gear governance     GearRegistry calibration, ToolPolicy adjustment                                    POST /gear-calibrate

  D4 --- Pipeline config     Cross-repo anomaly pattern detection → PipelineConfig changes                      POST /pipeline-config

  D5 --- Review gate (NEW)   CommissioningAgentDO sends review request after all MoleculeOutcomeVerdicts pass   POST /review
  -------------------------- ---------------------------------------------------------------------------------- ------------------------------

**2. Environment Bindings**

> type Env = {
>
> DB: D1Database // D1 audit log + GearRegistry
>
> ARTIFACT_GRAPH_DO: DurableObjectNamespace // ArtifactGraphDO
>
> COMMISSIONING_AGENT_DO: DurableObjectNamespace // for /review response routing
>
> WEOPS_GATEWAY_URL: string
>
> KV: KVNamespace // hot cache invalidation
>
> DISPATCH_QUEUE: Queue // broadcast AtomDirectives
>
> ANOMALY_SCAN_INTERVAL_MS: string // default \"900000\" (15 min)
>
> PATCH_PROPAGATION_TIMEOUT_MS: string // default \"1800000\" (30 min)
>
> CRP_RESOLUTION_TIMEOUT_MS: string // default \"600000\" (10 min)
>
> REVIEW_TIMEOUT_MS: string // default \"300000\" (5 min)
>
> }
>
> // wrangler.jsonc
>
> {
>
> \"durable_objects\": { \"bindings\": \[
>
> { \"class_name\": \"ArchitectAgentDO\", \"name\": \"ARCHITECT_AGENT\" }
>
> \]},
>
> \"migrations\": \[{ \"tag\": \"v3\", \"new_sqlite_classes\": \[\"ArchitectAgentDO\"\] }\]
>
> }

**3. DO SQLite Schema**

> \-- Decision log: append-only
>
> CREATE TABLE IF NOT EXISTS decisions (
>
> seq INTEGER PRIMARY KEY AUTOINCREMENT,
>
> domain TEXT NOT NULL, \-- D1\|D2\|D3\|D4\|D5
>
> kind TEXT NOT NULL,
>
> payload TEXT NOT NULL, \-- JSON
>
> produced_at INTEGER NOT NULL
>
> );
>
> \-- Active review sessions (one row per in-flight /review call)
>
> CREATE TABLE IF NOT EXISTS review_sessions (
>
> run_id TEXT PRIMARY KEY,
>
> review_cycle INTEGER NOT NULL DEFAULT 1,
>
> open_gaps TEXT NOT NULL DEFAULT \"\[\]\", \-- JSON Gap\[\]
>
> prior_refs TEXT NOT NULL DEFAULT \"\[\]\", \-- JSON AR-\* refs
>
> created_at INTEGER NOT NULL,
>
> updated_at INTEGER NOT NULL
>
> );

**4. HTTP Endpoints**

**4.1 POST /review (D5 --- Review Gate)**

Called by CommissioningAgentDO after all MoleculeOutcomeVerdicts pass. Called again after each fix swarm completes. Carries cumulative context across all review cycles for this run.

> // Request --- ArchitectReviewRequest
>
> {
>
> runId: string
>
> repoId: string
>
> specificationRef: string // SPEC-\* in ArtifactGraphDO
>
> workGraphRef: string // WG-\* in ArtifactGraphDO
>
> reviewCycle: number // 1 on first, increments
>
> priorReviewRefs: string\[\] // AR-\* from all prior cycles
>
> openGapsFromPrior: Gap\[\] // gaps not yet signed off
>
> moleculeVerdictRefs: string\[\] // ALL MV-\* --- original + fix swarms
>
> executionTraceRefs: string\[\] // ALL ET-\* --- original + fix swarms
>
> }
>
> // Response --- ArchitectReviewResponse
>
> {
>
> verdict: \"sign-off\" \| \"gaps-found\" \| \"escalate\"
>
> gaps?: Gap\[\] // new gaps found this cycle
>
> closedGapIds?: string\[\] // prior gaps confirmed closed
>
> parallelBatches?: AtomDirective\[\]\[\] // pre-classified parallel fix groups
>
> escalationReason?: string
>
> reasoning: string
>
> }
>
> // Gap type
>
> {
>
> gapId: string
>
> gapType: \"architecture-gate\" \| \"implementation\"
>
> description: string
>
> claimRefs: string\[\]
>
> atomRefs: string\[\]
>
> canParallelize: boolean
>
> introducedInCycle: number
>
> }

Handler logic:

1\. Upsert review_sessions row for runId. Set review_cycle, open_gaps, prior_refs.

2\. Run deterministic checks (§5.1) against executionTraceRefs. Produces structural gap candidates.

3\. Run LLM gap classification (§5.2) --- Think session on demand. Classifies structural candidates + semantic gaps.

4\. Diff against openGapsFromPrior. Compute closedGapIds. Identify new gaps.

5\. If no open gaps remain and no new gaps: verdict = sign-off.

6\. If gaps found: classify into parallelBatches (architecture-gate only). Implementation gaps returned as gaps\[\] without parallelBatches entry --- CommissioningAgentDO routes to amendment loop.

7\. Write ArchitectReview node to ArtifactGraphDO (AA-INV-001).

8\. Return response.

**4.2 POST /crp (D2 --- CRP Resolution)**

Called by CommissioningAgentDO after amendmentCycleCount = 3 exhausted on an atom. Distinct from /review --- this is failure recovery, not success-path gate.

> {
>
> crpId: string
>
> sourceRepoId: string
>
> runId: string
>
> atomId: string
>
> claimRef: string
>
> divergenceRefs: string\[\] // three DIV-\* nodes
>
> hypothesisRefs: string\[\] // three HYP-\* nodes
>
> amendmentRefs: string\[\] // three AMD-\* nodes (all failed)
>
> failurePattern: string // CA summary of what three attempts revealed
>
> }

  ----------------- ------------------------------------------------------------------------------------------------------------------------------------------------
  **CRP Verdict**   **Action**

  restructured      ArchitectAgentDO produces revised AtomDirective or decomposes atom into two. CommissioningAgentDO re-seeds. Run: architect_review → executing.

  spec-amendment    Specification claim is ambiguous. Recommended Specification amendment produced. Escalates to We-layer. Run suspends.

  unresolved        Cannot resolve within CRP_RESOLUTION_TIMEOUT_MS. EscalationEvent → WeOps Gateway → Linear. Run suspends.
  ----------------- ------------------------------------------------------------------------------------------------------------------------------------------------

**4.3 POST /patch, POST /gear-calibrate, POST /pipeline-config**

D1, D3, D4 endpoints unchanged from June 13 spec. No modifications required by this update.

**5. Gap Classification Logic (D5)**

Two-pass: deterministic first, LLM second. Deterministic checks that pass do not invoke LLM. This is the authoritiative spec for gap classification --- referenced by OI-8 in SPEC-FF-WORKGRAPH-DOD-001.

**5.1 Deterministic Checks**

  ----------------------------------------------------------------------------------------- ------------------------------------------------------------------------------------------ -----------------------
  **Check**                                                                                 **Method**                                                                                 **Gap type if fails**

  All claimRefs in WorkGraph covered by at least one ET-\* with outcome: done               Set intersection: WorkGraph.atoms\[\].claimRefs vs. ET.claimRefs where ET.outcome = done   architecture-gate

  No ET-\* with outcome: done has executedUnder an Amendment that was later REJECTED        ArtifactGraphDO edge traversal: ET → executedUnder → AMD → Verdict                         architecture-gate

  All MoleculeOutcomeVerdicts in run are pass (not just the latest per molecule)            CoordinatorDO meta table read: all molecule_outcome_verdict rows                           architecture-gate

  No Divergence node in ArtifactGraphDO for this run lacks a corresponding closed Verdict   DIV nodes with no outbound AMD edge or AMD with no ADOPTED Verdict                         implementation

  successCondition on all non-outcome beads evaluated to true                               CoordinatorDO execution_beads: successConditionMet = 1 for all is_outcome_atom = 0 rows    implementation
  ----------------------------------------------------------------------------------------- ------------------------------------------------------------------------------------------ -----------------------

**5.2 LLM Gap Classification --- Think Session**

Invoked only after deterministic checks complete. Uses a Think session constructed on demand. Prompt carries: Specification claims, WorkGraph atom roles, all ExecutionTrace summaries (not full content --- summary field only), list of deterministic gaps already found, openGapsFromPrior.

LLM task: identify semantic gaps not detectable by structural checks. Examples:

--- Claim C-3 (audit log) has an ET with outcome: done, but the audit entries are written to the wrong table (structural check passes, semantic check fails).

--- Two atoms both implement overlapping logic --- no structural gap, but architectural coherence failure.

--- A fix atom closed a gap but introduced a new inconsistency in a different claim.

LLM output is a JSON list of Gap objects. ArchitectAgentDO post-processes: deduplicates against deterministic gaps, assigns introducedInCycle, classifies canParallelize based on atomRefs overlap (two gaps sharing atomRefs cannot parallelize).

**5.3 parallelBatches Construction**

Only architecture-gate gaps get parallelBatches entries. Implementation gaps route to amendment loop.

Parallelization rule: two fix atoms can run in parallel if their atomRefs sets do not overlap AND their claimRefs sets do not overlap. ArchitectAgentDO computes a dependency graph over the gap set and produces a topologically sorted list of parallel batches --- each batch is a set of independent fix atoms, batch\[N+1\] depends on batch\[N\].

**6. ArtifactGraphDO Node --- ArchitectReview**

> type ArchitectReviewNode = {
>
> nodeType: \"ArchitectReview\"
>
> id: string // AR-\*
>
> runId: string
>
> repoId: string
>
> createdAt: string
>
> immutable: true
>
> reviewCycle: number
>
> verdict: \"sign-off\" \| \"gaps-found\" \| \"escalate\"
>
> openGapsFromPrior: Gap\[\]
>
> newGapsFound: Gap\[\]
>
> closedGapIds: string\[\]
>
> parallelBatches: AtomDirective\[\]\[\]
>
> reasoning: string
>
> priorReviewRefs: string\[\]
>
> moleculeVerdictRefs: string\[\]
>
> executionTraceRefs: string\[\]
>
> }

**7. Invariants**

  ------------------ -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------
  **ID**             **Invariant**

  AA-INV-001         Every Disposition Event (patch, CRP resolution, Gear calibration, pipeline config, review sign-off) produces an EluciationArtifact in ArtifactGraphDO before any downstream action fires.

  AA-INV-002         ArchitectAgentDO never calls CoordinatorDO or ThinkExecutor directly. All per-run execution concerns flow through CommissioningAgentDO.

  AA-INV-003         BFS traversal on ArtifactGraphDO replaces all AQL cross-collection queries. No external graph database on the Factory execution path.

  AA-INV-004         Gear calibration writes go to D1 GearRegistry, not ArtifactGraphDO. ArtifactGraphDO holds the GEAR-CONFIG-\* audit node only.

  AA-INV-005         LLM operations use Think session constructed on demand. ArchitectAgentDO is not a persistent agent loop.

  AA-INV-006 (NEW)   POST /review is called on every run after all MoleculeOutcomeVerdicts pass, not only on failure. Sign-off is required before evaluateRunAcceptanceCriterion() fires.

  AA-INV-007 (NEW)   Deterministic gap checks (§5.1) run before LLM gap classification (§5.2). LLM is not invoked if all deterministic checks pass and openGapsFromPrior is empty.
  ------------------ -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------

**8. Package Structure**

> packages/architect-agent/
>
> ├── src/
>
> │ ├── architect-agent-do.ts --- DO class, alarm, HTTP router
>
> │ ├── domains/
>
> │ │ ├── d1-patch-governance.ts --- BFS traversal, patch propagation
>
> │ │ ├── d2-crp-resolution.ts --- failure class detection, resolution paths
>
> │ │ ├── d3-gear-governance.ts --- GearRegistry calibration
>
> │ │ ├── d4-pipeline-config.ts --- model routing, PipelineConfig update
>
> │ │ └── d5-review-gate.ts --- deterministic checks, LLM classification,
>
> │ │ parallelBatches construction (NEW)
>
> │ ├── gap-classifier.ts --- Gap type, deterministic + LLM pass (NEW)
>
> │ ├── artifact-graph-client.ts --- BFS traversal over ArtifactGraphDO
>
> │ ├── elucidation-writer.ts --- EluciationArtifact production (A9)
>
> │ └── types.ts --- FactoryState, PipelineConfig, Gap, etc.

*SPEC-ARCHITECT-AGENT-DO-001 v2.0 DRAFT --- Wislet J. Celestin / Koales.ai --- June 2026*

SPEC-FF-GAP-CLASSIFY-001 v1.0 DRAFT

**Gap Classification Logic**

*ArchitectAgentDO D5 · Deterministic checks · LLM classification · Parallel batch construction*

**0. Scope**

This spec closes OI-8 from SPEC-FF-WORKGRAPH-DOD-001 v1.2: \"Gap classification logic in ArchitectAgentDO --- how does the Architect distinguish architecture-gate from implementation gaps?\" It defines the two-pass classification algorithm, the routing decision downstream of classification, and the parallelBatches construction algorithm.

This spec is authoritative for gap-classifier.ts in packages/architect-agent/src/.

**1. Gap Types and Routing**

  ------------------- --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- -------------------------------------------------------------------------------------------------------------
  **gapType**         **Definition**                                                                                                                                                                                                        **Routing**

  architecture-gate   A gap that cannot be closed by amending an existing AtomDirective. Requires new atoms, decomposition changes, or structural rework. The gap exists at the level of what atoms are doing, not how they are doing it.   ArchitectAgentDO produces new AtomDirectives in parallelBatches. CommissioningAgentDO seeds new fix beads.

  implementation      A gap in how an existing atom implemented its assigned work. The AtomDirective scope is correct; the execution was wrong. Closeable by amending the AtomDirective and re-running the atom.                            Standard amendment loop: CommissioningAgentDO calls buildHypothesis() → proposeAmendment() → re-commission.
  ------------------- --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- -------------------------------------------------------------------------------------------------------------

**2. Pass 1 --- Deterministic Checks**

Run first. Cheap. No LLM. Five checks, in execution order:

**DC-1: Claim Coverage**

Every claimRef declared in WorkGraph.atoms must appear in at least one ExecutionTrace node with outcome: done.

> const coveredClaims = new Set(
>
> executionTraces
>
> .filter(et =\> et.outcome === \"done\")
>
> .flatMap(et =\> et.claimRefs)
>
> );
>
> const allClaims = new Set(workGraph.atoms.flatMap(a =\> a.claimRefs));
>
> const uncovered = \[\...allClaims\].filter(c =\> !coveredClaims.has(c));
>
> // uncovered.length \> 0 → architecture-gate gap per uncovered claim

**DC-2: Amendment Integrity**

No ExecutionTrace with outcome: done may have been produced under an Amendment that was later REJECTED. A done ET under a rejected Amendment means the result is ungoverned.

> for (const et of donedETs) {
>
> if (et.executedUnder) {
>
> const amd = await artifactGraph.get(et.executedUnder);
>
> const vrd = await artifactGraph.getEdge(amd.id, \"Verdict\");
>
> if (vrd?.verdict === \"REJECTED\") → architecture-gate gap
>
> }
>
> }

**DC-3: Molecule Verdict Completeness**

All MoleculeOutcomeVerdicts for this run must be pass. A run where any molecule verdict is fail or missing cannot proceed --- this is a precondition for calling /review, but verified defensively.

> const allVerdicts = await coordinatorDO.getAllMoleculeVerdicts(runId);
>
> const failing = allVerdicts.filter(v =\> v.verdict !== \"pass\");
>
> // failing.length \> 0 → architecture-gate gap (should not reach /review in this state)

**DC-4: Open Divergences**

No Divergence node for this run may lack a corresponding closed Verdict (an Amendment with ADOPTED Verdict). An open Divergence means the amendment loop did not converge.

> const divergences = await artifactGraph.getByType(\"Divergence\", { runId });
>
> for (const div of divergences) {
>
> const amd = await artifactGraph.getEdge(div.id, \"Amendment\");
>
> if (!amd) → implementation gap (no amendment attempted)
>
> const vrd = await artifactGraph.getEdge(amd.id, \"Verdict\");
>
> if (!vrd \|\| vrd.verdict !== \"ADOPTED\") → implementation gap
>
> }

**DC-5: Success Condition Completeness**

All non-outcome beads (is_outcome_atom = 0) must have successConditionMet = 1 in CoordinatorDO.

> const incomplete = await coordinatorDO.getBeadsWhere({
>
> is_outcome_atom: 0,
>
> successConditionMet: 0,
>
> status: \"done\" // done but condition not met --- anomalous
>
> });
>
> // incomplete.length \> 0 → implementation gap per atom

**3. Pass 2 --- LLM Gap Classification**

Invoked only if: (a) any DC check failed, OR (b) openGapsFromPrior is non-empty. If all DC checks pass and no prior open gaps: LLM pass is skipped entirely (AA-INV-007).

**3.1 Think Session Construction**

> const think = env.CF_THINK.get(env.CF_THINK.idFromName(\"gap-classifier\"));
>
> const session = await think.createSession({
>
> model: MODEL_BY_ROLE\[\"architect:gap-classifier\"\], // non-Anthropic, capable
>
> systemPrompt: GAP_CLASSIFIER_SYSTEM_PROMPT,
>
> timeout: parseInt(env.REVIEW_TIMEOUT_MS),
>
> });

**3.2 Prompt Structure**

The prompt carries four sections. No raw ExecutionTrace content --- summaries only (max 200 chars per ET to control context size).

> 1\. SPECIFICATION CLAIMS
>
> { claimId, text } for each claim in SPEC-\*
>
> 2\. WORK DONE
>
> { atomId, role, claimRefs, outcome, summary } for each ET
>
> 3\. STRUCTURAL GAPS ALREADY FOUND
>
> deterministic gap list from Pass 1
>
> 4\. OPEN GAPS FROM PRIOR CYCLES
>
> openGapsFromPrior --- for confirmation and regression detection
>
> 5\. TASK
>
> \"Identify semantic gaps not detectable by structural checks.
>
> Classify each gap as architecture-gate or implementation.
>
> For each gap in OPEN GAPS FROM PRIOR CYCLES, state whether it is
>
> now closed or still open based on the work done.
>
> Return JSON only: { newGaps: Gap\[\], closedGapIds: string\[\] }\"

**3.3 Output Processing**

Parse JSON response. Validate schema. Deduplicate against Pass 1 gaps (same claimRefs + atomRefs = same gap). Assign introducedInCycle = current reviewCycle for new gaps. Merge with DC gaps into unified gap list.

**4. parallelBatches Construction**

Only for architecture-gate gaps. Implementation gaps are not batched --- they go directly to the amendment loop.

**4.1 Dependency graph**

Two gaps are dependent if: (a) their atomRefs sets overlap (both need rework on the same atom), OR (b) their claimRefs sets overlap AND one gap\'s fix is likely to affect the other claim\'s implementation. Condition (b) is determined by LLM in Pass 2 --- the prompt asks the model to flag inter-gap dependencies.

> // Build adjacency: gap → gaps that must complete before it
>
> const deps = new Map\<string, Set\<string\>\>();
>
> for (const gap of archGaps) {
>
> deps.set(gap.gapId, new Set());
>
> }
>
> for (const \[a, b\] of interGapDependencies) {
>
> deps.get(b.gapId).add(a.gapId);
>
> }

**4.2 Topological sort into batches**

> const batches: Gap\[\]\[\] = \[\];
>
> const remaining = new Set(archGaps.map(g =\> g.gapId));
>
> while (remaining.size \> 0) {
>
> const ready = \[\...remaining\].filter(gid =\>
>
> \[\...deps.get(gid)\].every(dep =\> !remaining.has(dep))
>
> );
>
> if (ready.length === 0) throw new Error(\"cycle in gap dependency graph\");
>
> batches.push(ready.map(gid =\> archGaps.find(g =\> g.gapId === gid)));
>
> ready.forEach(gid =\> remaining.delete(gid));
>
> }

Each batch becomes one entry in parallelBatches. ArchitectAgentDO produces AtomDirectives for each gap\'s fix within the batch. CommissioningAgentDO seeds batch\[N+1\] beads with parentIds = all batch\[N\] bead IDs.

**5. Fix Molecule Acceptance Criterion**

This closes OI-10 from SPEC-FF-WORKGRAPH-DOD-001 v1.2: \"Fix molecule MoleculeAcceptanceCriterion derivation.\"

For each fix molecule (one per parallelBatches entry), ArchitectAgentDO derives the MoleculeAcceptanceCriterion at the time it produces the AtomDirectives. The criterion is gap-specific, not claim-level:

> type FixMoleculeAcceptanceCriterion = {
>
> moleculeId: string // fix-molecule-{runId}-batch-{N}
>
> targetGapIds: string\[\] // which gaps this batch closes
>
> deterministicChecks: VF\[\] // same DC checks as §2, scoped to fix atoms
>
> semanticJudgment: string // NL: \"gaps GAP-1 and GAP-2 are confirmed
>
> // closed and no regressions introduced\"
>
> }

The MoleculeOutcomeAtom for the fix molecule carries this criterion in its AtomDirective.instructions. Its verdict feeds back into the next /review call via moleculeVerdictRefs.

*SPEC-FF-GAP-CLASSIFY-001 v1.0 DRAFT --- Wislet J. Celestin / Koales.ai --- June 2026*

SPEC-FF-OPEN-ITEMS-001 v1.0 DRAFT

**Open Items Resolution**

*OI-2 · OI-3 · OI-7 from SPEC-FF-WORKGRAPH-DOD-001 v1.2*

**0. Scope**

Resolves three blocking open items from SPEC-FF-WORKGRAPH-DOD-001 v1.2:

  -------- ---------------------------------------------------------- --------------------------------------------------------
  **OI**   **Item**                                                   **Status**

  OI-2     POST /molecule-complete endpoint on CommissioningAgentDO   Resolved in §1

  OI-3     RunVerdict: fail amendment scope                           Resolved in §2

  OI-7     POST /review implementation in ArchitectAgentDO            Resolved --- see SPEC-ARCHITECT-AGENT-DO-001 v2.0 §4.1
  -------- ---------------------------------------------------------- --------------------------------------------------------

**1. OI-2 --- POST /molecule-complete on CommissioningAgentDO**

New endpoint. Called by LoopClosureService BP3 after releaseBead() fires on a MoleculeOutcomeAtom (is_outcome_atom = 1). Carries the MoleculeOutcomeVerdict. CommissioningAgentDO uses it to track moleculeDAG progress and trigger the next molecule commission or the ArchitectAgentDO review gate.

**1.1 Request**

> POST /molecule-complete
>
> {
>
> runId: string
>
> moleculeId: string
>
> verdict: \"pass\" \| \"fail\"
>
> reasoning: string
>
> mvRef: string // MV-\* node ID in ArtifactGraphDO
>
> etRefs: string\[\] // all ET-\* for this molecule\'s atoms
>
> }

**1.2 Handler logic**

1\. Write molecule_verdicts entry to session_context SQLite: moleculeId → { verdict, mvRef, ts }.

2\. If verdict = fail: call buildHypothesis() with mvRef and Divergence context. Enter amendment loop. Return 200.

3\. If verdict = pass: check moleculeDAG. Are there child molecules whose parent dependency is now satisfied?

a\. If yes: POST /commission to MediationAgentDO for each ready child molecule. Return 200.

b\. If no more molecules to commission: all molecules in moleculeDAG are done. Proceed to architect gate.

4\. Architect gate: POST /review to ArchitectAgentDO with full cumulative context. Await response.

5\. On ArchitectReviewResponse:

a\. verdict = sign-off: call evaluateRunAcceptanceCriterion(). Write RunVerdict. Transition SM1.

b\. verdict = gaps-found: seed fix beads in CoordinatorDO per parallelBatches. Re-enter executing.

c\. verdict = escalate: write ArchitectEscalation node. POST to WeOps Gateway. Transition SM1 → suspended.

**1.3 Idempotency**

Handler is idempotent on moleculeId. If molecule_verdicts already contains an entry for moleculeId with the same verdict, return 200 immediately. Duplicate delivery from LoopClosureService is possible and safe.

**1.4 SPEC-COMMISSIONING-AGENT-DO-001 delta**

  --------------------------- ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------
  **Section**                 **Change**

  HTTP endpoints              Add POST /molecule-complete as defined above. Caller: LoopClosureService BP3 only.

  DO SQLite session_context   Add column: molecule_verdicts TEXT (JSON {\[moleculeId\]: {verdict, mvRef, ts}}). Add column: architect_review_refs TEXT (JSON AR-\*\[\]). Add column: open_gaps TEXT (JSON Gap\[\]).

  SM1 transitions             Add: molecule_verdicts_pass → architect_gate. architect_gate → executing (gaps-found). architect_gate → run_verdict (sign-off). architect_gate → suspended (escalate).
  --------------------------- ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------

**2. OI-3 --- RunVerdict: fail Amendment Scope**

When CommissioningAgentDO.evaluateRunAcceptanceCriterion() returns RunVerdict: fail, the amendment loop must fire. The question is what artifact is being amended: the individual Specification clause, the full Specification, or a successor Specification.

**2.1 Analysis**

A RunVerdict: fail means the aggregate output of all molecules does not satisfy the Specification --- not that any individual atom or molecule failed. Individual atom failures produce atom-level Divergences. Molecule failures produce molecule-level Divergences (divergenceType: molecule-outcome-failure). A RunVerdict: fail is a different class of failure: the whole is wrong even though the parts passed their individual checks.

This means the fault is in one of three places:

1\. The RunAcceptanceCriterion is too strict --- the Specification was over-interpreted.

2\. The Specification claims are correct but the molecules did not collectively satisfy them --- an integration gap that molecule-level verification missed.

3\. The Specification itself is wrong --- the claims do not correctly describe the required behavior.

Cases 1 and 2 are I-layer resolvable. Case 3 requires We-layer intervention.

**2.2 Decision: Divergence at run level, Amendment targets Specification**

RunVerdict: fail produces a run-level Divergence (divergenceType: run-verdict-failure). This is a third Divergence type alongside atom-failure and molecule-outcome-failure.

> type DivergenceNode (run-verdict-failure) = {
>
> divergenceType: \"run-verdict-failure\"
>
> runVerdictRef: string // RV-\* node
>
> claimRefs: string\[\] // all claims in the Specification
>
> observed: string // RunVerdict.reasoning
>
> expected: string // RunAcceptanceCriterion.semanticJudgment
>
> }

CommissioningAgentDO calls buildHypothesis() with the run-verdict Divergence. The Hypothesis must classify the fault as case 1, 2, or 3:

  ------------------------------------------- ---------------------------------------------------------------------------------------------------- -------------------------------------------------------------------------------------------------
  **Fault case**                              **Amendment target**                                                                                 **Path**

  Case 1: RunAcceptanceCriterion too strict   CommissioningAgentDO session_context.run_acceptance_criterion field --- revised NL criterion         Amend criterion. Re-run evaluateRunAcceptanceCriterion() with revised criterion. No new atoms.

  Case 2: Integration gap                     New AtomDirective --- a cross-molecule integration verification atom not in the original WorkGraph   Commission new integration atom. Verify. Re-run evaluateRunAcceptanceCriterion().

  Case 3: Specification wrong                 Successor Specification --- new SPEC-\* node with amended claims                                     Escalate to We-layer. Human Disposition Event produces new Specification. New run commissioned.
  ------------------------------------------- ---------------------------------------------------------------------------------------------------- -------------------------------------------------------------------------------------------------

**2.3 Amendment Loop Extension --- BP4/BP5 for run-verdict failures**

LoopClosureService bridge points BP4 and BP5 handle atom-level amendment. Run-verdict failures require two new bridge point extensions:

  --------------------------------------------------- -----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------
  **Bridge Point**                                    **Change**

  BP4-ext: run-verdict-failure → amendment-proposed   Trigger: RunVerdict: fail. Action: CommissioningAgentDO.buildHypothesis(runVerdictDivergence). Fault classification determines amendment target. Produces Amendment node with amendmentType: \"run-verdict-criterion\" \| \"run-verdict-integration\" \| \"run-verdict-specification\".

  BP5-ext: amendment-proposed → amendment-applied     On ADOPTED: route by amendmentType. criterion → update session_context, re-evaluate. integration → seed new integration atom. specification → escalate to We-layer with Amendment as context for human Disposition Event.
  --------------------------------------------------- -----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------

**2.4 Retry budget for run-verdict failures**

Separate from atom-level maxAtomRetries. New config field: PipelineConfig.verticalSlicePolicy.maxRunVerdictRetries = 2. After 2 run-verdict failures on cases 1 or 2, CommissioningAgentDO sends CRP to ArchitectAgentDO (same /crp endpoint, crpType: \"run-verdict\"). After 1 run-verdict failure on case 3, escalate immediately to We-layer.

**3. OI-11 --- DreamDO Crystallize Wiring Gap**

Identified June 2026. DreamDO.crystallize(runId) is currently specified as being called from CoordinatorDO directly (per the June 14 DreamDO integration points spec). This is a wiring error.

**3.1 The gap**

CoordinatorDO has no ARTIFACT_GRAPH_DO binding and no DREAM_DO binding. CoordinatorDO is a bead graph coordinator --- it tracks bead status and exposes getNextReady(). It has no visibility into ArtifactGraphDO, DreamDO, or the governance artifact layer. Calling dream_do.crystallize() from CoordinatorDO directly violates the layer boundary: CoordinatorDO → DreamDO is a cross-layer call from execution substrate to learning substrate.

**3.2 Correct wiring**

LoopClosureService is the correct caller. It already sits at the boundary between execution substrate and governance layer --- it reads CoordinatorDO bead events (BP1--BP5) and writes to ArtifactGraphDO. It is the natural place to fire DreamDO calls after run completion.

  ------------------------------------- ----------------------------------------------------- ---------------------------------------------------------------------------------------------------------------------------------------------------
  **Integration point**                 **Current (wrong)**                                   **Corrected**

  dream_do.crystallize(runId)           Called from CoordinatorDO on COMPLETE                 Called from LoopClosureService after RunVerdict written to ArtifactGraphDO. Trigger: BP-RUN-COMPLETE (new bridge point after RV-\* node written).

  dream_do.decrementActivePipelines()   Called from CoordinatorDO on COMPLETE                 Called from LoopClosureService BP-RUN-COMPLETE alongside crystallize.

  dream_do.incrementActivePipelines()   Called from CommissioningAgentDO Mastra Workflow T1   Unchanged --- CommissioningAgentDO has DREAM_DO binding. Correct.

  dream_do.writeQualitySignal()         Called from LoopClosureService BP1--BP5               Unchanged. Correct.

  dream_do.getTemplateForRun()          Called from Mediation Agent DO step 3                 Unchanged --- Mediation Agent DO has DREAM_DO binding. Correct.
  ------------------------------------- ----------------------------------------------------- ---------------------------------------------------------------------------------------------------------------------------------------------------

**3.3 New bridge point BP-RUN-COMPLETE**

LoopClosureService gains one new bridge point after RunVerdict is written:

> BP-RUN-COMPLETE:
>
> trigger: RunVerdict node written to ArtifactGraphDO (RV-\*)
>
> actions:
>
> 1\. dream_do.decrementActivePipelines()
>
> 2\. dream_do.crystallize(runId)
>
> --- only fires if RunVerdict.verdict = \"pass\" (zero-repair condition
>
> evaluated inside crystallize per INV-DREAM-04)

**3.4 Wrangler binding addition for LoopClosureService**

> // wrangler.jsonc --- LoopClosureService Worker bindings addition
>
> {
>
> \"durable_objects\": { \"bindings\": \[
>
> { \"name\": \"DREAM_DO\", \"class_name\": \"DreamDO\" } // ADD
>
> \]}
>
> }

This is a non-blocking open item --- DreamDO is not on the critical path for the WorkGraph decomposition → definition of done implementation. It becomes blocking only when DreamDO implementation begins.

**4. Summary --- Implementation Order**

  ----------- ------------------------------------------------------------------- --------------------------------------- ---------------------------------
  **Order**   **Item**                                                            **Spec reference**                      **Blocking?**

  1           POST /molecule-complete endpoint in CommissioningAgentDO            This doc §1                             Yes

  2           POST /review endpoint in ArchitectAgentDO                           SPEC-ARCHITECT-AGENT-DO-001 v2.0 §4.1   Yes

  3           gap-classifier.ts --- deterministic checks DC-1 through DC-5        SPEC-FF-GAP-CLASSIFY-001 v1.0 §2        Yes

  4           gap-classifier.ts --- LLM pass + parallelBatches construction       SPEC-FF-GAP-CLASSIFY-001 v1.0 §3--4     Yes

  5           ArchitectReview node type in ArtifactGraphDO                        SPEC-ARCHITECT-AGENT-DO-001 v2.0 §6     Yes

  6           RunVerdict: fail amendment loop --- BP4-ext/BP5-ext                 This doc §2                             Yes

  7           Fix molecule MoleculeAcceptanceCriterion derivation                 SPEC-FF-GAP-CLASSIFY-001 v1.0 §5        Yes

  8           DreamDO crystallize wiring --- LoopClosureService BP-RUN-COMPLETE   This doc §3                             No --- blocks DreamDO impl only
  ----------- ------------------------------------------------------------------- --------------------------------------- ---------------------------------

*SPEC-FF-OPEN-ITEMS-001 v1.0 DRAFT --- Wislet J. Celestin / Koales.ai --- June 2026*
