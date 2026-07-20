SPEC-FF-WORKGRAPH-DOD-001

**WorkGraph Decomposition to Definition of Done**

Wislet J. Celestin / Koales.ai --- June 2026 --- v1.0 DRAFT

**0. Scope**

This spec closes two linked gaps identified in June 2026 architecture review sessions:

Gap 1 --- No molecule-level goal check. CoordinatorDO.getNextReady() returning null (structural completion) is not the same as the molecule achieving its Specification-derived acceptance criterion. These are different conditions. Only structural completion was implemented.

Gap 2 --- No spec-wide completion across a set of molecules. A WorkGraph may decompose into N molecules. There is no entity tracking \"all N are done and their goals verified\" before synthesis_passed fires. The current pipeline assumes one molecule per run.

This spec resolves both gaps with four new artifacts: MoleculeAcceptanceCriterion, MoleculeOutcomeAtom, CompiledRun, and evaluateRunAcceptanceCriterion(). It also records four architectural decisions (D1--D4) with full rationale.

*Research basis: VeriMAP (EACL 2026), OpenPlanter IMPLEMENT-THEN-VERIFY, Augment CIV pattern, Intent wave-based orchestration, Beyond Task Completion (AGENT \'26).*

**1. Current State and Gaps**

The existing compilation chain: CommissioningAgentDO (Pattern Appraisal → Deliberation → Disposition Event) → Mediation Agent DO compileWorkGraph() → one GearMolecule → CoordinatorDO seeds one bead graph → ThinkExecutor atoms execute → getNextReady() returns null → POST /complete → CommissioningAgentDO → synthesis_passed → wrangler deploy.

Two failure modes this chain cannot detect:

Structural pass, goal fail: All beads reach done. The test suite passes. But the aggregate code output does not satisfy the Specification claim that motivated this WorkGraph. No independent checker evaluates this. synthesis_passed fires. Broken code deploys.

Single-molecule assumption: SM1 Pipeline Run Status has synthesis_passed fire when getNextReady() returns null on a single CoordinatorDO. A WorkGraph that logically decomposes into N molecules --- for example, a planner molecule, three parallel coder molecules, and a verifier molecule --- has no architectural expression. The CommissioningAgentDO would have to sequence N commission calls manually with no formal DAG between them.

**2. Architectural Decisions**

  ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------
  **D1** N molecules vs always-1: compile-time partition vs sequential commission calls

  **DECISION:** Compile-time partition. Mediation Agent DO produces CompiledRun with N GearMolecules and a moleculeDAG.

  The WorkGraph is already a compile-time artifact --- a Specification, not a runtime discovery. The Mediation Agent DO already reads the full WorkGraph in compileWorkGraph(). It has all information needed to partition into molecule groupings at compile time.

  Sequential commission calls from CommissioningAgentDO is architecturally worse: inter-molecule dependency becomes implicit state in the CA; parallel molecule dispatch for independent molecules is impossible; decomposition logic is in the wrong layer (CA is a governance agent, not a compiler).

  Partition criteria (in priority order): (a) explicit molecule boundary annotations declared on WorkGraph nodes by the Specification author; (b) logical cohesion by nodeType grouping; (c) connected-subgraph analysis of the WorkGraph DAG. Option (a) is canonical --- the Specification author declares molecule granularity; the compiler respects it.

  Research anchor: VeriMAP --- decomposition and verification design are the same act. Each subtask must be self-contained and executable by another agent. Static decomposition for predictable, governed workflows; dynamic decomposition for open-ended problems. Factory WorkGraphs are predictable and governed.
  ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------

  -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------
  **D2** MoleculeOutcomeAtom: terminal bead in CoordinatorDO vs separate dispatch

  **DECISION:** Terminal bead in CoordinatorDO. Seeded by Mediation Agent DO at compile time. Full barrier parent set.

  Option A (chosen): CoordinatorDO seeds the MoleculeOutcomeAtom as the final bead in the molecule\'s bead graph. parentIds = all other bead IDs in the molecule. Role: verifier:outcome. Read-only tool policy. Dispatched via CF Queue. ConsentBead, ExecutionTrace, and Divergence paths all apply.

  Option B (rejected): CommissioningAgentDO dispatches a separate verification atom after receiving POST /complete from CoordinatorDO. This creates a second execution dispatch path outside CF Queue, violating the substrate invariant. All execution must flow through CF Queue → ThinkExecutor → CoordinatorDO.

  The MoleculeAcceptanceCriterion (compiled by Mediation Agent DO) is carried in AtomDirective.instructions. The judge model must be a different model than the Coder atoms --- uncorrelated verification is required. MODEL_BY_ROLE\[verifier:outcome\] maps to a cheap non-Anthropic model.

  Research anchor: OpenPlanter IMPLEMENT-THEN-VERIFY --- the agent that does the work must not be its sole verifier. VeriMAP --- verification is embedded into the workflow rather than appended at the end.
  -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------

  ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------
  **D3** RunAcceptanceCriterion judgment: CommissioningAgentDO vs its own atom

  **DECISION:** CommissioningAgentDO. LLM call within the Think session after all molecule verdicts arrive.

  The cross-molecule reasoning required for RunAcceptanceCriterion is exactly what the CommissioningAgentDO per-run memory thread was built for. By the time all MoleculeOutcomeVerdicts arrive, the CA\'s memory thread contains the full governance arc: Divergences received, Hypotheses formed, Amendments proposed.

  A separate atom cannot have that context without reading from ArtifactGraphDO --- expensive and incomplete (amendment reasoning lives in the memory thread, not in ArtifactGraphDO).

  Cost implication: one LLM call per run at cheap model tier inside the Think session. Marginal. Cloudflare inference on-network --- no additional latency penalty. DO duration billing only charges for CPU time, not I/O wait.

  evaluateRunAcceptanceCriterion() is a Think session call reading the RunAcceptanceCriterion compiled at Disposition Event time plus the set of molecule verdicts. Produces RunVerdict: pass \| fail.
  ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------

  ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------
  **D4** synthesis_passed gating: structural-AND-goal vs goal-only

  **DECISION:** Goal-only gating. synthesis_passed requires all MoleculeOutcomeVerdicts pass AND RunVerdict pass.

  Structural completion (getNextReady() returns null) is a necessary precondition for MoleculeOutcomeAtom execution but is not itself sufficient for synthesis_passed. The current SM1 trigger must be updated.

  Three cases: (1) Structural pass, goal fail → MoleculeOutcomeAtom verdict: fail → Divergence → amendment loop. synthesis_passed must not fire. Deploying goal-failing code is the exact failure this architecture prevents. (2) Structural fail → amendment loop already handles this; no change. (3) Amendment within run produces successor molecule that passes → most recent molecule verdict is authoritative. synthesis_passed may fire.

  SM1 Pipeline Run Status transition table entry for executing → synthesis_passed changes from \"getNextReady() returns null --- all beads terminal, all done\" to \"RunVerdict: pass from CommissioningAgentDO.evaluateRunAcceptanceCriterion()\".

  Research anchor: VeriMAP compositional correctness --- the overall workflow is correct iff all subtasks pass their VFs. Verify-Gated Completion (arXiv 2605.17998) --- 98.58% rule agreement, 0.0% false-success rate for fail-closed verification admission control.
  ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------

**3. New Artifacts**

**3.1 MoleculeAcceptanceCriterion**

Compiled by Mediation Agent DO from the Specification clause governing the molecule. Attached to GearMolecule. Carried in the MoleculeOutcomeAtom\'s AtomDirective.instructions.

> interface MoleculeAcceptanceCriterion {
>
> moleculeId: string;
>
> deterministicChecks: VerificationFunction\[\]; // file-exists, test-pass-rate, schema-valid
>
> semanticJudgment: string; // NL criterion for LLM judge
>
> specificationRef: string; // ArtifactGraphDO Specification node ID
>
> }

deterministicChecks run first inside the MoleculeOutcomeAtom. If any fail, verdict: fail is written immediately without invoking the LLM semantic judge. Deterministic failures are cheaper and faster to detect.

**3.2 MoleculeOutcomeAtom**

A terminal ExecutionBead in every GearMolecule\'s bead graph. Seeded by Mediation Agent DO at compile time. Not a post-hoc addition --- it is part of the compiled molecule structure.

  --------------------------- ---------------------------------------------------------------------
  **Property**                **Value**

  role                        verifier:outcome

  parentIds                   all other bead IDs in molecule (full barrier)

  toolPolicy.permittedTools   \[\] --- read-only, no workspace writes

  model                       MODEL_BY_ROLE\[verifier:outcome\] --- cheap, non-Anthropic

  instructions                MoleculeAcceptanceCriterion + ExecutionTrace refs for this molecule

  successCondition            { type: \"verdict-written\", field: \"molecule_outcome_verdict\" }
  --------------------------- ---------------------------------------------------------------------

On releaseBead(), CoordinatorDO writes MoleculeOutcomeVerdict to the meta table. POST /complete to Mediation Agent DO carries the verdict. CommissioningAgentDO receives the verdict in its POST /complete handler.

**3.3 CompiledRun**

Replaces the single GearMolecule output of compileWorkGraph(). The Mediation Agent DO now produces a CompiledRun.

> interface CompiledRun {
>
> runId: string;
>
> orgId: string;
>
> specVersion: string;
>
> molecules: GearMolecule\[\];
>
> moleculeDAG: MoleculeEdge\[\]; // inter-molecule dependencies
>
> runAcceptanceCriterion: RunAcceptanceCriterion; // spec-wide criterion
>
> }
>
> interface MoleculeEdge {
>
> parentMoleculeId: string; // molecule whose MoleculeOutcomeVerdict must pass
>
> childMoleculeId: string; // before this molecule is commissioned
>
> }
>
> interface RunAcceptanceCriterion {
>
> runId: string;
>
> specificationRef: string;
>
> semanticJudgment: string; // NL: does aggregate output satisfy the Specification?
>
> }

CommissioningAgentDO stores the CompiledRun\'s moleculeDAG and runAcceptanceCriterion in its DO SQLite session_context table at commission time. Molecule dispatch respects the DAG --- a child molecule\'s POST /commission fires only after its parent\'s MoleculeOutcomeVerdict: pass is received.

**3.4 evaluateRunAcceptanceCriterion()**

A method on CommissioningAgentDO. Called after all molecule verdicts in the run\'s moleculeDAG are pass. Runs a single LLM call within the Think session.

> async evaluateRunAcceptanceCriterion(
>
> criterion: RunAcceptanceCriterion,
>
> moleculeVerdicts: MoleculeOutcomeVerdict\[\]
>
> ): Promise\<RunVerdict\>

The call reads the RunAcceptanceCriterion.semanticJudgment, the list of molecule verdicts, and the per-run memory thread context (Divergences, Amendments). It asks: given what happened in this run, does the aggregate output satisfy the Specification? Returns RunVerdict: { verdict: \"pass\" \| \"fail\", reasoning: string }.

RunVerdict: pass triggers synthesis_passed → deploying in SM1. RunVerdict: fail triggers a Divergence in the CommissioningAgentDO and re-enters the amendment loop. The amendment in this case targets the Specification itself --- not an individual atom --- because the failure is spec-wide.

**4. SM1 Pipeline Run Status --- Updated Transitions**

Two entries change. All other transitions are unchanged.

  ----------- ------------------ ---------------------------------------------------------------------------------------------------------------------
  **From**    **To**             **Trigger --- UPDATED**

  executing   synthesis_passed   RunVerdict: pass from CommissioningAgentDO.evaluateRunAcceptanceCriterion(). Replaces: getNextReady() returns null.

  executing   synthesis_failed   Any MoleculeOutcomeVerdict: fail OR RunVerdict: fail. LoopClosureService records Divergence. Amendment loop begins.
  ----------- ------------------ ---------------------------------------------------------------------------------------------------------------------

New intermediate states (internal to CommissioningAgentDO, not surfaced in SM1):

  -------------------------- ----------------------------------------------------------------
  **Internal state**         **Condition**

  molecule_outcome_pending   MoleculeOutcomeAtom dispatched; verdict not yet received

  molecule_outcome_pass      MoleculeOutcomeVerdict: pass received for this molecule

  run_verdict_pending        All molecules pass; evaluateRunAcceptanceCriterion() in flight
  -------------------------- ----------------------------------------------------------------

**5. Storage Changes**

**5.1 CoordinatorDO SQLite**

One new column on execution_beads. One new row type in meta.

> \-- New column:
>
> ALTER TABLE execution_beads ADD COLUMN is_outcome_atom INTEGER DEFAULT 0;
>
> \-- New meta row (written by releaseBead on outcome atom):
>
> \-- key: \"molecule_outcome_verdict\"
>
> \-- value: JSON { verdict: \"pass\"\|\"fail\", reasoning: string, ts: number }

**5.2 CommissioningAgentDO SQLite (session_context table)**

Two new columns to track molecule DAG state.

> ALTER TABLE session_context ADD COLUMN molecule_dag TEXT; \-- JSON MoleculeEdge\[\]
>
> ALTER TABLE session_context ADD COLUMN molecule_verdicts TEXT; \-- JSON { \[moleculeId\]: MoleculeOutcomeVerdict }
>
> ALTER TABLE session_context ADD COLUMN run_acceptance_criterion TEXT; \-- JSON RunAcceptanceCriterion

**5.3 ArtifactGraphDO**

Two new node types. Append-only --- no schema changes to existing node types.

  ------------------------ ------------------------------------------------------- -------------------------------------------------------------------------------
  **Node type**            **Written by**                                          **Content**

  MoleculeOutcomeVerdict   LoopClosureService BP3 (via releaseBead)                moleculeId, verdict, reasoning, specificationRef, executionTraceRefs\[\]

  RunVerdict               CommissioningAgentDO.evaluateRunAcceptanceCriterion()   runId, verdict, reasoning, runAcceptanceCriterionRef, moleculeVerdictRefs\[\]
  ------------------------ ------------------------------------------------------- -------------------------------------------------------------------------------

**6. Mediation Agent DO --- Nine-Step Compile Sequence Delta**

Current nine-step sequence (SPEC-MEDIATION-AGENT-DO-001 v3.0) gains two steps and one change:

  -------------------------------------------------- ------------------------------------------------------------------------------------------------------------------------------------------------------------------
  **Step**                                           **Change**

  Step 3 (new): Partition WorkGraph into molecules   NEW. Read molecule boundary annotations from WorkGraph nodes. If none, derive from nodeType grouping. Produce molecules\[\] and moleculeDAG\[\].

  Step 5 (was: derive AtomDirectives)                CHANGED. Now derives AtomDirectives per molecule plus one MoleculeOutcomeAtom per molecule with full barrier parentIds and compiled MoleculeAcceptanceCriterion.

  Step 9 (new): Compile RunAcceptanceCriterion       NEW. Derive spec-wide semantic judgment from the governing Specification node. Attach to CompiledRun.

  Output type                                        CHANGED. Was: GearMolecule. Now: CompiledRun (contains molecules\[\], moleculeDAG\[\], runAcceptanceCriterion).
  -------------------------------------------------- ------------------------------------------------------------------------------------------------------------------------------------------------------------------

**7. LoopClosureService --- Bridge Point Changes**

BP3 gains one new write. BP4 gains one new trigger path.

  -------------------------------------------- ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------
  **Bridge Point**                             **Change**

  BP3 (executing → outcome_written)            If releaseBead() is on is_outcome_atom = 1: write MoleculeOutcomeVerdict to ArtifactGraphDO. POST /molecule-complete to CommissioningAgentDO carrying verdict. Then write standard ExecutionTrace node.

  BP4 (outcome_written → amendment_proposed)   New trigger: MoleculeOutcomeVerdict: fail is a blocking Divergence. buildHypothesis() attributes fault to specification (the molecule\'s Specification clause failed its acceptance criterion). Follows standard amendment path.
  -------------------------------------------- ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------

**8. Open Items**

The following must be resolved before implementation:

  -------- ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ -------------------------------------------------------------------------------------
  **ID**   **Item**                                                                                                                                                                                                                 **Blocking?**

  OI-1     Molecule boundary annotation format on WorkGraph nodes. What field name? What values? Needs schema addition to \@factory/schemas WorkGraphNode type.                                                                     Yes --- Mediation Agent DO compile step 3 cannot be implemented without it.

  OI-2     MODEL_BY_ROLE\[verifier:outcome\] --- which model? Non-Anthropic, cheap, sufficient for PASS/FAIL judgment. Must satisfy uncorrelated-verifier constraint.                                                               Yes --- MoleculeOutcomeAtom AtomDirective cannot be compiled without model binding.

  OI-3     bead_edges schema edge_type: \"sequence\" \| \"barrier\". Currently all edges are barriers. Needed for efficient fan-out patterns but not blocking for this spec.                                                        No.

  OI-4     POST /molecule-complete endpoint on CommissioningAgentDO. New endpoint; not yet in SPEC-COMMISSIONING-AGENT-DO-001.                                                                                                      Yes --- LoopClosureService BP3 cannot route molecule verdicts without it.

  OI-5     RunVerdict: fail amendment scope. Does it target the individual Specification clause, the full Specification, or produces a successor Specification? Amendment loop currently targets atom-level Specification faults.   Yes --- amendment loop BP4/BP5 path needs extension for run-level failures.
  -------- ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ -------------------------------------------------------------------------------------

*SPEC-FF-WORKGRAPH-DOD-001 v1.0 DRAFT --- Wislet J. Celestin / Koales.ai --- June 2026*
