SPEC-FF-WORKGRAPH-DOD-001 v1.1 DRAFT

**WorkGraph Decomposition → Definition of Done**

*Full execution trace · Failure cases · ArchitectAgentDO integration*

Wislet J. Celestin / Koales.ai --- June 2026

**0. Scope and Standing Decisions**

This spec defines WorkGraph decomposition into molecules, molecule-level and run-level definition of done, the full execution trace for clean and failure cases, and the ArchitectAgentDO integration for unresolvable atom failures. It supersedes the earlier v1.0 DRAFT and incorporates decisions made during the June 2026 architecture and trace sessions.

**Four architectural decisions govern this spec:**

  ---------------------------------------- ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------
  **Decision**                             **Verdict**

  D1 --- Compile-time partition            Mediation Agent DO produces AtomDirective\[\] only. Molecule grouping is CommissioningAgentDO responsibility, not compiler responsibility. Compiler has no knowledge of molecules.

  D2 --- MoleculeOutcomeAtom placement     Terminal bead in CoordinatorDO bead graph. Seeded by CommissioningAgentDO at molecule grouping time. Full barrier parent set. Dispatched via CF Queue --- same substrate as all atoms.

  D3 --- RunAcceptanceCriterion judgment   CommissioningAgentDO evaluateRunAcceptanceCriterion() --- LLM call within Think session after all molecule verdicts pass. Has full per-run memory thread context. Not a separate atom.

  D4 --- synthesis_passed gating           Goal-only. Requires all MoleculeOutcomeVerdicts pass AND RunVerdict pass. Structural completion (getNextReady() null) is a precondition for D2 but not sufficient for synthesis_passed.

  D5 --- Specification node scope          Requirements only. No runtime fields, no molecule fields, no runId, no runAcceptanceCriterion. Specification is a We-layer artifact. Molecules are I-layer packaging. These are categorically separate.

  D6 --- Retry budget                      maxAtomRetries = 3 per atom (PipelineConfig.verticalSlicePolicy). After 3 failed amendment cycles, CommissioningAgentDO sends CRP to ArchitectAgentDO. ArchitectAgentDO resolves or escalates to We-layer.
  ---------------------------------------- ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------

**1. Layer Boundaries**

The molecule concept sits at the boundary between the compiler and the runtime. Getting this boundary wrong propagates category errors throughout the stack.

  -------------------------------------------- --------------------------------------------------------------------------------------------------------------------------- --------------------------------------------------------------------------
  **Layer**                                    **Knows about**                                                                                                             **Does NOT know about**

  Specification (We-layer)                     Claims, acceptance intent                                                                                                   Molecules, atoms, runs, CoordinatorDO

  Mediation Agent DO (compiler)                Atoms, AtomDirective, atom DAG edges, claimRefs per atom                                                                    Molecules, MoleculeOutcomeAtom, CoordinatorDO internals

  CommissioningAgentDO (runtime governor)      Molecules, molecule DAG, MoleculeAcceptanceCriterion, CoordinatorDO seeding, RunAcceptanceCriterion, ArchitectAgentDO CRP   ThinkExecutor internals, CF Sandbox

  CoordinatorDO (bead graph)                   Beads, bead status, bead edges, successCondition                                                                            Molecules (sees only beads --- MoleculeOutcomeAtom is just another bead)

  ArchitectAgentDO (singleton, factory-wide)   Cross-repo patterns, CRP resolution, patch propagation DAG, PipelineConfig                                                  Individual atom implementation details
  -------------------------------------------- --------------------------------------------------------------------------------------------------------------------------- --------------------------------------------------------------------------

**2. Artifact Schemas**

**2.1 Specification Node (ArtifactGraphDO)**

Written at Disposition Event time by CommissioningAgentDO. Requirements only.

> type SpecificationNode = {
>
> nodeType: \"Specification\"
>
> id: string // SPEC-\*
>
> repoId: string
>
> createdAt: string // ISO 8601
>
> immutable: true
>
> title: string
>
> version: string
>
> claims: Array\<{
>
> id: string // C-1, C-2, \...
>
> text: string // normative claim text
>
> }\>
>
> }

ArtifactGraphDO edges written at Disposition Event time:

> { from: \"SPEC-S-001\", to: \"ELC-\*\", rel: \"producedBy\" } // provenance

ArtifactGraphDO edge written at compile time (after Mediation Agent DO):

> { from: \"WG-\*\", to: \"SPEC-S-001\", rel: \"compiledFrom\" } // compilation lineage

**2.2 WorkGraph Node (ArtifactGraphDO)**

Written by Mediation Agent DO at compile time. Atom DAG only --- no molecule structure.

> type WorkGraphNode = {
>
> nodeType: \"WorkGraph\"
>
> id: string // WG-\*
>
> repoId: string
>
> createdAt: string
>
> immutable: true
>
> atoms: Array\<{
>
> id: string // A1, A2, \...
>
> role: string // planner \| coder:auth \| verifier \| \...
>
> claimRefs: string\[\] // which Specification claims this atom addresses
>
> }\>
>
> edges: Array\<{
>
> from: string // atom id
>
> to: string // atom id
>
> }\>
>
> }

**2.3 MoleculeAcceptanceCriterion (CommissioningAgentDO SQLite)**

Derived by CommissioningAgentDO from Specification claim texts at molecule grouping time. Not in ArtifactGraphDO --- transient runtime governance state.

> type MoleculeAcceptanceCriterion = {
>
> moleculeId: string
>
> claimRefs: string\[\]
>
> deterministicChecks: Array\<{
>
> type: \"test-pass\" \| \"subtask-count\" \| \"all-claims-referenced\" \| \"file-exists\"
>
> pattern?: string
>
> operator?: \"gte\" \| \"eq\"
>
> value?: number
>
> claimIds?: string\[\]
>
> }\>
>
> semanticJudgment: string // NL criterion for LLM judge
>
> }

**2.4 MoleculeOutcomeVerdict (ArtifactGraphDO)**

> type MoleculeOutcomeVerdictNode = {
>
> nodeType: \"MoleculeOutcomeVerdict\"
>
> id: string // MV-\*
>
> moleculeId: string
>
> runId: string
>
> repoId: string
>
> createdAt: string
>
> immutable: true
>
> verdict: \"pass\" \| \"fail\"
>
> reasoning: string
>
> executionTraceRefs: string\[\] // ET-\* nodes for this molecule\'s atoms
>
> }

**2.5 RunVerdict (ArtifactGraphDO)**

> type RunVerdictNode = {
>
> nodeType: \"RunVerdict\"
>
> id: string // RV-\*
>
> runId: string
>
> repoId: string
>
> createdAt: string
>
> immutable: true
>
> verdict: \"pass\" \| \"fail\"
>
> reasoning: string
>
> moleculeVerdictRefs: string\[\] // MV-\* nodes
>
> }

**2.6 Divergence Node (ArtifactGraphDO)**

> type DivergenceNode = {
>
> nodeType: \"Divergence\"
>
> id: string // DIV-\*
>
> repoId: string
>
> runId: string
>
> moleculeId: string
>
> atomId: string
>
> claimRefs: string\[\]
>
> createdAt: string
>
> immutable: true
>
> divergenceType: \"atom-failure\" \| \"molecule-outcome-failure\"
>
> observed: string
>
> expected: string
>
> failReason: string
>
> executionRef: string // ET-\* that produced this divergence
>
> }

**2.7 CRP (CommissioningAgentDO → ArchitectAgentDO)**

> type CRPItem = {
>
> crpId: string // CRP-\*
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
> failurePattern: string // CA reasoning about what three attempts revealed
>
> amendmentCycleCount: 3
>
> }

**3. Execution Trace --- Clean Run**

*Domain: Add a rate-limited authentication endpoint to an existing API.*

Specification S-001 claims: C-1 (POST /auth/login → JWT / 401), C-2 (rate-limit middleware → 429), C-3 (audit log on all auth events).

**3.1 Disposition Event**

CommissioningAgentDO completes Pattern Appraisal → Deliberation. Disposition Event fires.

> // ArtifactGraphDO write
>
> {
>
> node: {
>
> nodeType: \"Specification\", id: \"SPEC-S-001\",
>
> repoId: \"repo-auth-service\", createdAt: \"2026-06-15T14:00:00Z\",
>
> immutable: true, title: \"Add rate-limited authentication endpoint\",
>
> version: \"1.0\",
>
> claims: \[
>
> { id: \"C-1\", text: \"POST /auth/login accepts {email,password}. Returns JWT on success, 401 on failure.\" },
>
> { id: \"C-2\", text: \"Rate limiting middleware rejects \>5 req/min/IP with 429.\" },
>
> { id: \"C-3\", text: \"All auth events are written to the audit log.\" }
>
> \]
>
> },
>
> edges: \[{ from: \"SPEC-S-001\", to: \"ELC-BRIDGE-ESC-001\", rel: \"producedBy\" }\]
>
> }

CommissioningAgentDO opens per-run memory thread: threadId = run-001.

**3.2 Mediation Agent DO Compile**

POST /commission with runId = run-001, specificationRef = SPEC-S-001. Compiler derives atoms from claims. Output: AtomDirective\[\]. No molecule knowledge.

> // WorkGraph node written to ArtifactGraphDO
>
> {
>
> node: {
>
> nodeType: \"WorkGraph\", id: \"WG-run-001\",
>
> atoms: \[
>
> { id: \"A1\", role: \"planner\", claimRefs: \[\"C-1\",\"C-2\",\"C-3\"\] },
>
> { id: \"A2\", role: \"coder:auth\", claimRefs: \[\"C-1\",\"C-3\"\] },
>
> { id: \"A3\", role: \"coder:ratelimit\", claimRefs: \[\"C-2\"\] },
>
> { id: \"A4\", role: \"coder:integrate\", claimRefs: \[\"C-1\",\"C-2\",\"C-3\"\] },
>
> { id: \"A5\", role: \"verifier\", claimRefs: \[\"C-1\",\"C-2\",\"C-3\"\] }
>
> \],
>
> edges: \[
>
> { from: \"A1\", to: \"A2\" }, { from: \"A1\", to: \"A3\" },
>
> { from: \"A2\", to: \"A4\" }, { from: \"A3\", to: \"A4\" },
>
> { from: \"A4\", to: \"A5\" }
>
> \]
>
> },
>
> edges: \[{ from: \"WG-run-001\", to: \"SPEC-S-001\", rel: \"compiledFrom\" }\]
>
> }

**3.3 CommissioningAgentDO Molecule Grouping**

Reads WG-run-001. Groups atoms by nodeType cohesion. Derives MoleculeAcceptanceCriterion for each molecule from Specification claim texts. Inserts synthetic MoleculeOutcomeAtoms into CoordinatorDO bead graph.

  ----------------- ------------ ----------------------------------- -------------------------------------------------------------------
  **Molecule**      **Atoms**    **MoleculeOutcomeAtom parentIds**   **Acceptance criterion (summary)**

  M-1 (plan)        A1           MO-1: \[A1\]                        Planner produced coherent subtasks covering C-1, C-2, C-3

  M-2 (implement)   A2, A3, A4   MO-2: \[A2, A3, A4\]                Auth + rate-limit compile, unit tests pass, audit logging present

  M-3 (verify)      A5           MO-3: \[A5\]                        Integration suite passes --- C-1, C-2, C-3 verified end-to-end
  ----------------- ------------ ----------------------------------- -------------------------------------------------------------------

moleculeDAG: M-2 depends on M-1. M-3 depends on M-2.

MoleculeOutcomeAtom properties: role = verifier:outcome, toolPolicy.permittedTools = \[\], model = MODEL_BY_ROLE\[\"verifier:outcome\"\] (cheap, non-Anthropic), is_outcome_atom = 1 in CoordinatorDO execution_beads.

**3.4 M-1 Execution**

getNextReady() → A1 ready. CF Queue fires. ThinkExecutor + buildConductingAgent(). A1 produces task breakdown covering C-1, C-2, C-3. releaseBead(A1). ET-A1 → ArtifactGraphDO.

getNextReady() → MO-1 ready. MO-1 fires. Deterministic checks pass (subtask-count ≥ 3, all-claims-referenced). Semantic judgment: PASS. releaseBead(MO-1).

> // MoleculeOutcomeVerdict written to CoordinatorDO meta + ArtifactGraphDO
>
> { nodeType: \"MoleculeOutcomeVerdict\", id: \"MV-MO-1\", moleculeId: \"M-1\",
>
> verdict: \"pass\", reasoning: \"\...\" }

POST /molecule-complete to CommissioningAgentDO. molecule_verdicts: { M-1: pass }. moleculeDAG satisfied → M-2 commissioned.

**3.5 M-2 Execution --- Fan-Out**

getNextReady() → A2 and A3 both ready simultaneously (both depend only on A1). Two CF Queue messages. Two ThinkExecutor fibers in parallel.

A2 (coder:auth): writes auth route + JWT util, unit tests pass. releaseBead(A2). ET-A2 → ArtifactGraphDO.

A3 (coder:ratelimit): writes middleware, unit tests pass. releaseBead(A3). ET-A3 → ArtifactGraphDO.

Barrier clears. getNextReady() → A4. A4 (coder:integrate): wires A2+A3, combined tests pass. releaseBead(A4). ET-A4 → ArtifactGraphDO.

getNextReady() → MO-2. Deterministic checks pass. Semantic judgment: PASS. MV-MO-2: pass. M-3 commissioned.

**3.6 M-3 Execution**

A5 (verifier): runs integration suite. 4/4 tests pass (C-1, C-2, C-3 verified). releaseBead(A5). ET-A5 → ArtifactGraphDO.

MO-3: deterministic check (integration.test.ts 4/4) passes. Semantic judgment: PASS. MV-MO-3: pass.

**3.7 RunVerdict**

All molecule_verdicts pass. CommissioningAgentDO calls evaluateRunAcceptanceCriterion(). Reads: RunAcceptanceCriterion (derived from C-1, C-2, C-3 at molecule grouping time), moleculeVerdicts \[M-1: pass, M-2: pass, M-3: pass\], memory thread run-001 (no Divergences).

> RunVerdict: pass
>
> reasoning: \"All three claims verified. Integration suite confirms C-1, C-2, C-3.
>
> No amendments required. Artifact is deployable.\"

RV-run-001 → ArtifactGraphDO. synthesis_passed → deploying → monitored. Memory thread run-001 archived in D1Store.

**3.8 Clean Run --- ArtifactGraphDO Trail**

> SPEC-S-001 ← Specification (We-layer, immutable)
>
> WG-run-001 ← WorkGraph edge: compiledFrom SPEC-S-001
>
> ET-A1 ← ExecutionTrace Planner (done)
>
> MV-MO-1 ← MoleculeOutcomeVerdict M-1 pass
>
> ET-A2 ← ExecutionTrace Coder:auth (done)
>
> ET-A3 ← ExecutionTrace Coder:ratelimit (done)
>
> ET-A4 ← ExecutionTrace Coder:integrate (done)
>
> MV-MO-2 ← MoleculeOutcomeVerdict M-2 pass
>
> ET-A5 ← ExecutionTrace Verifier (done)
>
> MV-MO-3 ← MoleculeOutcomeVerdict M-3 pass
>
> RV-run-001 ← RunVerdict pass

**4. Failure Case A --- Single Atom Failure with Amendment**

A3 (coder:ratelimit) fails. Middleware implemented but not wired to route. Unit test fails: expected 429, actual 200.

**4.1 failBead(A3) → Divergence**

> // LoopClosureService BP3 fires
>
> {
>
> nodeType: \"Divergence\", id: \"DIV-A3-run-001\",
>
> divergenceType: \"atom-failure\",
>
> atomId: \"A3\", moleculeId: \"M-2\", claimRefs: \[\"C-2\"\],
>
> observed: \"Middleware not applied to /auth/login. 429 never returned.\",
>
> expected: \"C-2: rate-limit middleware rejects \>5 req/min/IP with 429.\",
>
> failReason: \"middleware-not-wired\"
>
> }

POST /divergence to CommissioningAgentDO. Memory thread run-001 receives Divergence event.

A4 stays blocked (barrier: A2 done, A3 failed --- not satisfied). MO-2 stays blocked.

**4.2 buildHypothesis() → proposeAmendment() → ADOPTED**

CommissioningAgentDO Think session reads Divergence + Specification claim C-2 + memory thread. Produces Hypothesis (scope gap between A3 and A4). Produces Amendment (explicit wiring instruction added to A3 AtomDirective). Mastra eval T4 returns ADOPTED.

All three nodes written to ArtifactGraphDO. Memory thread updated.

**4.3 Re-commission A3**

A3 status: failed → ready. Amended AtomDirective. A3-v2 implements middleware AND wires to route. Unit tests 4/4. releaseBead(A3-v2). ET-A3-v2 → ArtifactGraphDO { executedUnder: \"AMD-001\" }.

Barrier clears. A4 runs. MO-2 fires again. verdict: pass. Run continues to M-3, RunVerdict: pass.

**4.4 Amendment Failure Trail**

> ET-A3 ← ExecutionTrace Coder:ratelimit (failed)
>
> DIV-A3-run-001 ← Divergence divergedFrom ET-A3
>
> HYP-001-run-001 ← Hypothesis hypothesisFor DIV-A3
>
> AMD-001-run-001 ← Amendment amendmentFor HYP-001
>
> VRD-AMD-001 ← Verdict ADOPTED
>
> ET-A3-v2 ← ExecutionTrace Coder:ratelimit (done, executedUnder AMD-001)

**5. Failure Case B --- MoleculeOutcomeVerdict Fail**

A2, A3, A4 all structurally complete. MO-2 fires. Combined unit test suite 7/8: JWT token missing exp field. Claim C-1 not fully satisfied.

**5.1 MO-2 → verdict: fail**

> {
>
> nodeType: \"Divergence\", id: \"DIV-MO2-run-001\",
>
> divergenceType: \"molecule-outcome-failure\", // ← distinct type
>
> atomId: \"MO-2\", moleculeId: \"M-2\", claimRefs: \[\"C-1\"\],
>
> observed: \"JWT returned but exp field undefined. 7/8 unit tests passing.\",
>
> expected: \"C-1: valid JWT on success. JWT without expiry is not valid.\",
>
> failReason: \"incomplete-jwt-implementation\"
>
> }

M-3 NOT commissioned --- moleculeDAG blocks it until MO-2 passes. synthesis_passed does NOT fire.

CommissioningAgentDO memory thread has full prior context (A3 amendment cycle visible). buildHypothesis() correctly attributes fault to A2, not A3.

**5.2 Amendment → Re-commission Scope**

Amendment targets A2 only: add exp field to JWT payload. Verdict: ADOPTED.

Re-commission scope: A2 and A4 (A4 integrated A2 output --- must re-verify). A3 stays done.

> A2 → ready (amended)
>
> A4 → ready (reset --- depends on A2 output)
>
> MO-2 → blocked (reset --- full barrier, waits for A2+A3+A4)
>
> A3 → done (unchanged)

A2-v2 and A4-v2 run. MO-2 fires again: 8/8 passing. verdict: pass. Run continues.

**6. Failure Case C --- Concurrent Divergences**

A2 and A3 both fail simultaneously in the M-2 fan-out. Two independent failures, two different claims.

**6.1 Two Divergences hit CommissioningAgentDO near-simultaneously**

> DIV-A2: atomId: \"A2\", claimRefs: \[\"C-1\",\"C-3\"\],
>
> failReason: \"auth-bypass\" // password check always returns true
>
> DIV-A3: atomId: \"A3\", claimRefs: \[\"C-2\"\],
>
> failReason: \"config-not-initialized\" // middleware config object undefined

CommissioningAgentDO is single-threaded (DO). Processes sequentially. Produces two independent Hypotheses --- one per Divergence. Memory thread has both Divergences in context when the second Hypothesis is built, enabling the CA to explicitly reason about independence (different atoms, different claims, no causal relationship).

**6.2 Two independent Amendments, parallel re-commission**

> AMD-A2: target A2, fix bcrypt comparison → ADOPTED
>
> AMD-A3: target A3, fix config initialization → ADOPTED

Both re-seeded simultaneously. Two CF Queue messages. Two ThinkExecutor fibers in parallel. Barrier still applies --- A4 waits for both.

A2-v2 and A3-v2 run in parallel. Both pass. Barrier clears. A4 runs. MO-2 passes. Run continues.

**6.3 Memory thread as causal detection**

The per-run memory thread is the mechanism that enables the CA to distinguish independent concurrent failures from causally related ones. If A3\'s failure were caused by A2\'s output (e.g., A2 exports a malformed config object consumed by A3), the CA sees both Divergences together and can surface the dependency in a single Hypothesis, producing one Amendment targeting A2\'s export rather than two separate fixes.

**7. Retry Budget and ArchitectAgentDO Integration**

**7.1 Retry budget**

PipelineConfig.verticalSlicePolicy.maxAtomRetries = 3. CoordinatorDO tracks amendmentCycleCount per atom in execution_beads. LoopClosureService increments on each failBead().

  ------------------------- ------------------------------------------------------------------------------------------------------
  **amendmentCycleCount**   **Action**

  1                         Standard amendment loop: Divergence → Hypothesis → Amendment → Verdict → re-commission

  2                         Standard amendment loop. Memory thread has two prior cycles visible --- CA can reason about pattern.

  3                         Standard amendment loop. If ADOPTED and re-commission succeeds, run continues normally.

  3 + fail                  EXHAUSTED. CommissioningAgentDO sends CRP to ArchitectAgentDO. Run enters architect_review state.
  ------------------------- ------------------------------------------------------------------------------------------------------

**7.2 ArchitectAgentDO**

Singleton DO --- architect-agent-global. One instance per factory, not per repo. Multi-repo responsibility. Four decision domains: D1 patch governance, D2 CRP resolution, D3 vertical slice policy, D4 pipeline configuration.

CRP resolution (D2) is the relevant domain here. ArchitectAgentDO receives the CRP, reads cross-repo patterns (has it seen this atom role fail similarly in other repos? is the Specification claim ambiguous across the fleet?), and produces one of:

  ---------------------- -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------
  **ArchitectVerdict**   **Action**

  restructured           ArchitectAgentDO produces a revised AtomDirective or decomposes the atom into two atoms with clearer scope boundaries. CommissioningAgentDO re-seeds with the new directive. Run continues from architect_review → executing.

  spec-amendment         ArchitectAgentDO determines the Specification claim is ambiguous or under-specified. Produces a recommended Specification amendment. Escalates to We-layer for human Disposition Event. Run suspends.

  unresolved             ArchitectAgentDO cannot resolve within CRP_RESOLUTION_TIMEOUT_MS (600s). EscalationEvent { escalationType: \"CRPFail\" } → WeOps Gateway → Linear. Human architect responds via Disposition Event. Run suspends.
  ---------------------- -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------

**7.3 ArchitectEscalation node (ArtifactGraphDO)**

> type ArchitectEscalationNode = {
>
> nodeType: \"ArchitectEscalation\"
>
> id: string // ESC-ARCH-\*
>
> repoId: string
>
> runId: string
>
> atomId: string
>
> claimRef: string
>
> crpRef: string // CRP-\*
>
> divergenceRefs: string\[\] // three DIV-\* nodes
>
> amendmentRefs: string\[\] // three AMD-\* nodes
>
> architectVerdict: \"restructured\" \| \"spec-amendment\" \| \"unresolved\"
>
> reasoning: string
>
> createdAt: string
>
> immutable: true
>
> }

**7.4 SM1 additions**

  ------------------ ------------------ ----------------------------------------------------------------------------------
  **From**           **To**             **Trigger**

  executing          architect_review   CommissioningAgentDO sends CRP after amendmentCycleCount = 3 exhausted

  architect_review   executing          ArchitectAgentDO verdict: restructured --- re-seeds atom

  architect_review   suspended          ArchitectAgentDO verdict: spec-amendment or unresolved --- escalates to We-layer

  suspended          executing          Human Disposition Event via Linear bridge --- run.resume()

  suspended          rejected           Human architect closes the run --- writes terminal ArtifactGraph node
  ------------------ ------------------ ----------------------------------------------------------------------------------

**8. Storage Changes**

**8.1 CoordinatorDO SQLite**

> ALTER TABLE execution_beads ADD COLUMN is_outcome_atom INTEGER DEFAULT 0;
>
> ALTER TABLE execution_beads ADD COLUMN amendment_cycle_count INTEGER DEFAULT 0;
>
> \-- meta row written by releaseBead on is_outcome_atom = 1:
>
> \-- key: \"molecule_outcome_verdict:{moleculeId}\"
>
> \-- value: JSON { verdict, reasoning, ts }

**8.2 CommissioningAgentDO SQLite**

> ALTER TABLE session_context ADD COLUMN molecule_dag TEXT; \-- JSON MoleculeEdge\[\]
>
> ALTER TABLE session_context ADD COLUMN molecule_verdicts TEXT; \-- JSON {\[moleculeId\]: verdict}
>
> ALTER TABLE session_context ADD COLUMN run_acceptance_criterion TEXT; \-- NL string

**8.3 ArtifactGraphDO --- new node types**

  ------------------------ --------------------------------------------------------------- -----------------------------------
  **Node type**            **Written by**                                                  **Trigger**

  MoleculeOutcomeVerdict   LoopClosureService BP3 (via releaseBead on is_outcome_atom=1)   MoleculeOutcomeAtom completes

  RunVerdict               CommissioningAgentDO.evaluateRunAcceptanceCriterion()           All molecule verdicts pass

  ArchitectEscalation      ArchitectAgentDO after CRP resolution                           CRP received and verdict produced
  ------------------------ --------------------------------------------------------------- -----------------------------------

**9. Open Items**

  -------- ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ -------------------------------------------------------------------------------------
  **ID**   **Item**                                                                                                                                                                                                     **Blocking?**

  OI-1     MODEL_BY_ROLE\[\"verifier:outcome\"\] --- which model? Non-Anthropic, cheap, sufficient for PASS/FAIL judgment against NL criterion. Uncorrelated-verifier constraint applies.                               Yes --- MoleculeOutcomeAtom AtomDirective cannot be compiled without model binding.

  OI-2     POST /molecule-complete endpoint on CommissioningAgentDO --- new endpoint not yet in SPEC-COMMISSIONING-AGENT-DO-001.                                                                                        Yes --- LoopClosureService BP3 cannot route molecule verdicts without it.

  OI-3     RunVerdict: fail amendment scope --- does it target the individual Specification clause, the full Specification, or produce a successor Specification? Amendment loop currently targets atom-level faults.   Yes --- amendment loop BP4/BP5 needs extension for run-level failures.

  OI-4     bead_edges schema edge_type: \"sequence\" \| \"barrier\" --- not yet decided. Currently all edges treated as barriers. Needed for efficient fan-out patterns.                                                No --- does not block this spec.

  OI-5     ArchitectAgentDO spec needs updating: ArangoDB references in environment bindings must be retired. D1/ArtifactGraphDO topology applies.                                                                      No --- separate spec update.

  OI-6     Memory thread archival policy --- retained for amendment lineage? pruned on run terminal? D1Store binding name for memory store not yet assigned in wrangler config.                                         No --- operational decision.
  -------- ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ -------------------------------------------------------------------------------------

*SPEC-FF-WORKGRAPH-DOD-001 v1.1 DRAFT --- Wislet J. Celestin / Koales.ai --- June 2026*
