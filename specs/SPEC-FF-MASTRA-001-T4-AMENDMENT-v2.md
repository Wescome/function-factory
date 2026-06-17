SPEC-FF-MASTRA-001 --- T4 AMENDMENT

**T4 Evals --- Revised Scope**

*CI-only · Three scorers · ArchitectAgentDO gap classifier coverage · ArangoDB retired*

**0. Context**

This document amends Section 4.4 (T4 --- Evals) of SPEC-FF-MASTRA-001 (June 13 2026). Since that spec was written, three runtime evaluation mechanisms have been built out that fully absorb the runtime jobs T4 was originally scoped to perform. T4 scope is therefore revised to CI-only.

Two stale references in the June 13 T4 spec are also corrected: ArangoDB (retired from execution path) and divergenceDetectionScorer runtime role (absorbed by LoopClosureService BP3).

**1. Runtime Jobs --- Absorbed**

The following T4 runtime roles are dropped. The runtime evaluation machinery now covers them with full governance node production in ArtifactGraphDO.

  -------------------------------------------------------------------------------------------------------------- ------------------------------------------------------------------------------------------------------------------------------- -----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------
  **T4 June 13 runtime role**                                                                                    **Absorbed by**                                                                                                                 **Why T4 is wrong here**

  specAlignmentScorer at runtime --- LLM graded check per claim                                                  MoleculeOutcomeAtom --- LLM judge evaluating MoleculeAcceptanceCriterion.semanticJudgment per molecule at runtime               Running a scorer in parallel without writing to ArtifactGraphDO is ungoverned. MoleculeOutcomeAtom produces a MoleculeOutcomeVerdict governance node. \@mastra/evals produces nothing in the audit trail.

  divergenceDetectionScorer --- compare ExecutionTrace vs Specification, produce Divergence if below threshold   failBead() → LoopClosureService BP3 → Divergence node written to ArtifactGraphDO. Deterministic, not LLM-scored.                Divergence detection is now deterministic and governed. An LLM scorer producing an observation artifact outside ArtifactGraphDO is a second ungoverned divergence path.

  divergenceDetectionScorer feeding the amendment loop                                                           Divergence node → CommissioningAgentDO POST /divergence → buildHypothesis(). Fully wired.                                       The loop is already connected. A scorer output would bypass the node-based audit trail entirely.

  specAlignmentScorer feeding spec-wide acceptance                                                               evaluateRunAcceptanceCriterion() in CommissioningAgentDO + ArchitectAgentDO gap classification (DC-1 through DC-5 + LLM pass)   Two layered mechanisms now cover spec-wide acceptance with governance nodes at each step.
  -------------------------------------------------------------------------------------------------------------- ------------------------------------------------------------------------------------------------------------------------------- -----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------

**2. Revised T4 Scope --- CI-Only**

T4 = offline regression testing of the Factory\'s prompt/spec corpus. Prospective only. Runs on every commit. Does not execute at runtime. Does not write to ArtifactGraphDO. Three scorers.

**2.1 Dataset Storage --- DatasetsManager (replaces raw D1 table)**

Source verification of \@mastra/core v1.42.0 reveals a first-class Dataset management API: DatasetsManager + Dataset with typed schemas, bulk item CRUD, versioning, and experiment management. The prior spec defaulted to a raw D1 eval_datasets table --- that is superseded. Storage backend remains D1Store (pluggable); the API surface is mastra.datasets.

> // Dataset bootstrap --- one-time or CI init
>
> const dataset = await mastra.datasets.create({
>
> name: \"factory-eval-dataset\",
>
> description: \"CI regression dataset for Factory prompt/spec corpus\",
>
> inputSchema: z.object({
>
> atomDirectivePrompt: z.string(),
>
> specRef: z.string(),
>
> claimId: z.string().optional(),
>
> divergencePayload: z.unknown().optional(),
>
> }),
>
> groundTruthSchema: z.object({
>
> expectedGapType: z.enum(\[\"architecture-gate\",\"implementation\"\]).optional(),
>
> expectedTargetAtom: z.string().optional(),
>
> expectedClaimRef: z.string().optional(),
>
> }),
>
> scorerIds: \[\"spec-alignment\", \"gap-classification\", \"amendment-coherence\"\],
>
> });

Compiler emits test cases at compile time via Dataset.addItems() --- one item per Specification claim per AtomDirective. Called from Mediation Agent DO compile step:

> await dataset.addItems({
>
> items: specification.claims.map(claim =\> ({
>
> input: {
>
> atomDirectivePrompt: compiledAtomDirective.instructions,
>
> specRef: specification.id,
>
> claimId: claim.id,
>
> },
>
> metadata: { runId, moleculeId, atomId },
>
> })),
>
> });

Gap classification test cases added by ArchitectAgentDO after each sign-off --- ground truth is the verdicted Gap\[\] from the review:

> await dataset.addItems({
>
> items: review.newGapsFound.map(gap =\> ({
>
> input: { atomDirectivePrompt: gapClassifierPrompt, specRef: review.specificationRef },
>
> groundTruth: { expectedGapType: gap.gapType, expectedTargetAtom: gap.atomRefs\[0\] },
>
> metadata: { reviewCycle: review.reviewCycle, runId },
>
> })),
>
> });

**2.2 Scorer 1 --- specAlignmentScorer (retained, CI only)**

Unchanged from June 13 spec except: CI only, and dataset is now DatasetsManager-backed. groundTruth.claimTexts carries the Specification claim text --- injected by Dataset item schema at addItems() time.

> const specAlignmentScorer = createScorer({
>
> name: \"spec-alignment\",
>
> description: \"Measures whether AtomDirective prompt produces output
>
> satisfying Specification claim --- regression gate\",
>
> score: async ({ input, output, context }) =\> {
>
> const claims = context.groundTruth?.claimTexts ?? \[\];
>
> const scores = await Promise.all(
>
> claims.map(c =\> gradeAgainstClaim(output, c))
>
> );
>
> return { score: scores.reduce((a, b) =\> a + b, 0) / scores.length };
>
> }
>
> });

Trigger: score drop \> 0.05 vs. baseline on any claim blocks merge to AtomDirective prompt files.

**2.3 Scorer 2 --- gapClassificationScorer (NEW)**

Covers the ArchitectAgentDO D5 gap classification prompt --- the LLM pass in gap-classifier.ts §5.2 of SPEC-FF-GAP-CLASSIFY-001. This is the highest-stakes prompt in the Factory: a regression that silently misclassifies architecture-gate gaps as implementation gaps routes fix atoms through the amendment loop instead of ArchitectAgentDO-directed fix swarms. The failure is silent --- no error, wrong path.

> const gapClassificationScorer = createScorer({
>
> name: \"gap-classification\",
>
> description: \"Verifies ArchitectAgentDO D5 gap classifier correctly distinguishes
>
> architecture-gate from implementation gaps on known test cases\",
>
> score: async ({ input, output, context }) =\> {
>
> // context.expectedGapType: \"architecture-gate\" \| \"implementation\"
>
> // output: Gap\[\] from LLM classifier
>
> const parsed = JSON.parse(output);
>
> const correct = parsed.newGaps.filter(
>
> g =\> g.gapType === context.expectedGapType
>
> ).length;
>
> return { score: correct / context.expectedGapCount };
>
> }
>
> });

Dataset: DatasetsManager factory-eval-dataset (scoped by scorerId = \"gap-classification\"). Test cases derive from known gap patterns in Factory run history --- each case carries a gapClassifierPrompt snapshot and expected Gap\[\] with gapType ground truth. Written by ArchitectAgentDO after each sign-off cycle via Dataset.addItems(). Maintained by ArchitectAgentDO domain owners.

Trigger: score drop \> 0.05 on any gapType classification blocks merge to gap-classifier.ts or the ArchitectAgentDO D5 review gate prompt.

**2.4 Scorer 3 --- amendmentCoherenceScorer (retained, CI only)**

Verifies the buildHypothesis() and proposeAmendment() prompts in CommissioningAgentDO produce coherent, correctly-scoped Amendments from a given Divergence. Regression gate for the amendment loop prompts.

> const amendmentCoherenceScorer = createScorer({
>
> name: \"amendment-coherence\",
>
> description: \"Measures whether buildHypothesis() + proposeAmendment() produce
>
> an Amendment correctly scoped to the Divergence claim and atom\",
>
> score: async ({ input, output, context }) =\> {
>
> // context.divergence: the input Divergence node
>
> // context.expectedTargetAtomId, context.expectedClaimRef
>
> const amd = JSON.parse(output);
>
> const atomMatch = amd.targetAtomId === context.expectedTargetAtomId ? 1 : 0;
>
> const claimMatch = amd.claimRef === context.expectedClaimRef ? 1 : 0;
>
> const scopeScore = await gradeScopeNarrowness(amd.change, context.divergence);
>
> return { score: (atomMatch + claimMatch + scopeScore) / 3 };
>
> }
>
> });

Trigger: score drop \> 0.05 blocks merge to CommissioningAgentDO amendment loop prompts.

**3. runExperiment Wiring**

> import { runExperiment } from \"@mastra/evals\";
>
> // CI entry point --- runs on every commit to
>
> // packages/commissioning-agent/src/prompts/
>
> // packages/architect-agent/src/domains/d5-review-gate.ts
>
> // packages/architect-agent/src/gap-classifier.ts
>
> const results = await runExperiment({
>
> agent: conductingAgent,
>
> datasetId: \"factory-eval-dataset\", // DatasetsManager-managed
>
> targetType: \"agent\",
>
> targetId: \"conducting-agent\",
>
> // scorers resolved from dataset.scorerIds:
>
> scorers: \[
>
> specAlignmentScorer,
>
> gapClassificationScorer,
>
> amendmentCoherenceScorer,
>
> \],
>
> scorers: \[
>
> specAlignmentScorer,
>
> gapClassificationScorer,
>
> amendmentCoherenceScorer,
>
> \],
>
> concurrency: 4,
>
> });

OTel: Mastra emits scorer spans via OTel. Wire to Cloudflare Workers & Pages → Logs. No additional observability infrastructure needed.

**4. Stale Reference Corrections from June 13 T4 Spec**

  --------------------------------------------------------------------------------- ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------
  **Stale reference**                                                               **Correction**

  Dataset format: \"stored as ArangoDB collections (one document per test case)\"   ArangoDB retired from execution path. Dataset storage: DatasetsManager (mastra.datasets) backed by D1Store. API: Dataset.addItems() for compiler-emitted test cases. Schema driven by inputSchema + groundTruthSchema Zod definitions. Raw eval_datasets D1 table also superseded.

  Priority: \"T4 has the lowest immediate urgency --- implement after T1 and T2\"   Unchanged in priority order. gapClassificationScorer adds urgency: must be in place before ArchitectAgentDO D5 gap-classifier.ts is modified in production. Blocking for that specific file.

  divergenceDetectionScorer listed as a primary custom scorer                       Dropped. Divergence detection is now deterministic via failBead() + LoopClosureService BP3. The scorer had no governance node output and is now superseded.
  --------------------------------------------------------------------------------- ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------

**5. Revised T4 Scope Summary**

  ------------------------------------- ------------------- ----------------------------------------------------------------------------------------------------------------------------------- ---------------------------
  **Scorer**                            **CI or Runtime**   **Protects**                                                                                                                        **Merge block threshold**

  specAlignmentScorer                   CI only             AtomDirective prompt / Specification claim alignment                                                                                \> 0.05 score drop

  gapClassificationScorer (NEW)         CI only             ArchitectAgentDO D5 gap-classifier.ts --- architecture-gate vs. implementation classification                                       \> 0.05 score drop

  amendmentCoherenceScorer              CI only             CommissioningAgentDO buildHypothesis() + proposeAmendment() prompt scope correctness                                                \> 0.05 score drop

  divergenceDetectionScorer (DROPPED)   ---                 Absorbed by LoopClosureService BP3 + failBead() deterministic path                                                                  ---

  Dataset storage (UPDATED)             DatasetsManager     mastra.datasets backed by D1Store. Compiler writes via Dataset.addItems(). ArchitectAgentDO writes gap test cases after sign-off.   ---
  ------------------------------------- ------------------- ----------------------------------------------------------------------------------------------------------------------------------- ---------------------------

**6. Harness --- Deferred, Product Layer Only**

Source verification of \@mastra/core v1.42.0 confirms the Harness class is a TUI/UI orchestration layer --- not relevant to the Factory execution substrate. No adoption for the Factory. Two capabilities are relevant to the business domain product layer (intentWork.ai, ComeFlow.io) when those specs are written.

**6.1 Runtime Permission System**

The Harness carries a runtime tool permission model distinct from the Factory compile-time toolPolicy:

> setPermissionForCategory({ category, policy })
>
> setPermissionForTool({ toolName, policy })
>
> grantSessionCategory({ category })
>
> grantSessionTool({ toolName })
>
> resolveToolApproval()
>
> // chain: per-tool deny → yolo → per-tool policy → session grant → category policy → ask

The Factory governs tool access at compile-time (AtomDirective.toolPolicy.permittedTools) and execution-time (ConsentBeadAuditProcessor + ToolCallFilter). Both are headless. For business domain products with a human operator, a third layer is needed: runtime user consent before high-stakes actions (calendar.book, payment.execute, contract.sign). The Harness permission system is the right mechanism. ConsentBead records what happened; Harness permission model gates what the user allows to happen.

Deferred to intentWork.ai / ComeFlow.io product specs. Not adopted in Factory substrate.

**6.2 Multi-Mode Agent Pattern**

The Harness modes\[\] config switches between specialized agents within a single session --- maps directly onto the Factory molecule structure (M-1 plan, M-2 implement, M-3 verify) but for a human-facing product where the operator steers phase transitions mid-session:

> modes: \[
>
> { id: \"plan\", default: true, agent: planAgent },
>
> { id: \"execute\", agent: executeAgent },
>
> { id: \"review\", agent: reviewAgent },
>
> \]

The Harness also exposes \@mastra/memory OM controls to the human operator: getObserverModelId(), getReflectorModelId(), switchObserverModel(), switchReflectorModel(). Clean integration point for business domain session management where the operator can tune memory compression at runtime.

Deferred to intentWork.ai / ComeFlow.io product specs. Not adopted in Factory substrate.

  ------------------------------------------------------------ -------------------------------------------------------------------------------- --------------------------------------------------------------------------------------------------------------
  **Harness capability**                                       **Factory substrate**                                                            **Business domain product layer**

  Runtime permission system                                    NOT adopted. Headless --- compile-time toolPolicy + ConsentBeadAuditProcessor.   ADOPT when intentWork.ai / ComeFlow.io specs written. Runtime user consent for high-stakes business actions.

  Multi-mode agent (modes\[\], switchMode())                   NOT adopted. Molecule decomposition is headless dispatch.                        ADOPT when product specs written. Human-steerable phase switching for business workflows.

  OM controls (switchObserverModel, getObservationThreshold)   NOT adopted. \@mastra/memory wired directly into CommissioningAgentDO.           ADOPT alongside multi-mode --- Harness exposes OM controls to human operator in product layer.

  TUI session management                                       NOT adopted. Not applicable.                                                     Evaluate when product UX specs written. May be superseded by product-specific UI layer.
  ------------------------------------------------------------ -------------------------------------------------------------------------------- --------------------------------------------------------------------------------------------------------------

**7. \@cloudflare/think Integration --- Memory Layer Clarification**

Source verification of \@cloudflare/think v0.9.0 (April 2026) reveals three distinct non-overlapping memory/compaction layers on the Factory stack. This is recorded here because the Mastra T3 adoption decision (@mastra/memory) is documented in this spec suite and the Think source verification could otherwise cause confusion about whether T3 is still needed.

**7.1 Three Layers --- Non-Overlapping**

  ----------------------------------------------------- ---------------------------------------------------------------------------------------------------------------------------------------- -------------------------------------------------------------------- -----------------------------------------------------------------------------------------------------------------
  **Layer**                                             **What it compresses**                                                                                                                   **Lives on**                                                         **Trigger**

  Think session compaction (OI-ILAYER-01)               Atom conversation message history --- tool call chain, reasoning steps, intermediate tool results                                        ThinkExecutor DO SQLite (Session API --- session.compact())          context_length_exceeded (reactive) or maxInputTokens threshold (proactive). Not yet wired --- see OI-ILAYER-01.

  Think context blocks (configureSession)               Agent self-knowledge --- org domain profile, constraints. Model updates proactively via set_context tool. Persists across hibernation.   CommissioningAgentDO DO SQLite (Session context blocks)              Model initiative. Not token-triggered. Enhancement deferred --- see OI-CA-01.

  \@mastra/memory Observer/Reflector (T3 --- adopted)   CommissioningAgentDO per-run governance events --- Divergences, Hypotheses, Amendments. NOT atom outputs.                                D1Store (separate binding from Factory audit log, per-org mutable)   30k tokens (Observer model) / 40k tokens (Reflector model). Non-Anthropic model required.
  ----------------------------------------------------- ---------------------------------------------------------------------------------------------------------------------------------------- -------------------------------------------------------------------- -----------------------------------------------------------------------------------------------------------------

T3 (@mastra/memory) adoption stands. Think session compaction (OI-ILAYER-01) operates on ThinkExecutor --- a different DO entirely. Think context blocks (OI-CA-01) are a CA-level enhancement for persistent org knowledge. None of these overlap.

**7.2 Think contextOverflow --- OI-ILAYER-01**

Verified \@cloudflare/think v0.9.0 ships ContextOverflowConfig with reactive compact-and-retry and proactive token guard. ThinkExecutor currently has no overflow handling --- a long atom session that hits context_length_exceeded crashes the fiber. Wiring:

> export class ThinkExecutor extends Think\<Env\> {
>
> override classifyChatError = defaultContextOverflowClassifier;
>
> override contextOverflow: ContextOverflowConfig = {
>
> reactive: true,
>
> proactive: { maxInputTokens: 150_000, maxCompactions: 2 },
>
> };
>
> }

Full spec: SPEC-FF-ILAYER-EXEC-001 v2.1 AMENDMENT. Non-blocking until long-running verifier or large-codebase planner atoms are introduced.

**7.3 Think context blocks --- OI-CA-01**

CommissioningAgentDO configureSession() can add a writable org-learnings context block the CA updates as it discovers stable cross-run org facts (stack conventions, team patterns, architectural notes). Distinct from \@mastra/memory which handles per-run governance event compression. Deferred until amendment loop has 10+ real runs for evaluation. Full spec: SPEC-FF-CA-SKILLS-001 v1.1 AMENDMENT.

**8. \@cloudflare/codemode --- Adoption Analysis**

Source: \@cloudflare/codemode v0.4.0 verified June 2026. This is a significant finding. \@cloudflare/codemode is not just an LLM code-writing pattern --- it is a durable execution runtime with approval gates, rollback, replay, and a snippet catalog. Each of these maps directly onto Factory primitives. This section is detailed because the implications span the atom execution substrate, the ConsentBead governance layer, and the open T1 skill registry.

**8.1 What \@cloudflare/codemode Actually Is**

Three components from source verification:

**CodemodeRuntime --- a Durable Object**

CodemodeRuntime extends DurableObject. Every execution is logged in DO SQLite. The API is:

> begin(code, options?) → executionId // start a new execution
>
> decide(executionId, seq, connector, method, args, requiresApproval)
>
> → ToolDecision // replay \| execute \| pause
>
> recordResult(executionId, seq, result) // log tool call result
>
> complete(executionId, result) // mark terminal
>
> fail(executionId, error) // mark error
>
> reject(seq, executionId) → boolean // reject pending action
>
> rollback(executionId) // revert applied actions
>
> saveSnippet(name, { executionId, description, inputSchema, connectors })
>
> → Snippet // promote to reusable script

ExecutionStatus mirrors the Factory bead lifecycle almost exactly:

  ------------------------------------- ----------------------------------------------------------------------------------
  **CodemodeRuntime ExecutionStatus**   **Factory ExecutionBead status**

  \"running\"                           claimed

  \"paused\"                            (new) --- awaiting approval gate; no Factory equivalent yet

  \"completed\"                         done

  \"error\"                             failed

  \"rejected\"                          (new) --- approval denied; maps to failed with divergenceType: approval-rejected

  \"rolled_back\"                       (new) --- applied side effects reverted; no Factory equivalent yet
  ------------------------------------- ----------------------------------------------------------------------------------

**ToolDecision --- the approval gate primitive**

Every tool call inside a running codemode execution goes through decide(), which returns one of three decisions:

> type ToolDecision =
>
> \| { kind: \"replay\"; result: unknown } // return stored result, no execution
>
> \| { kind: \"execute\"; seq: number } // execute, then recordResult
>
> \| { kind: \"pause\"; seq: number } // stop run, await approval

requiresApproval: boolean is declared per tool on the ConnectorTool type. When a tool with requiresApproval: true is called, decide() returns { kind: \"pause\" } --- the execution halts, the pending action is queued, and the runtime waits for approve() or reject(). This is not advisory --- the sandbox stops. No side effect occurs.

**ConnectorTool --- per-tool governance schema**

Verified from base-B2amchZA.d.ts:

> type ConnectorTool = {
>
> description?: string
>
> inputSchema?: JSONSchema7
>
> outputSchema?: JSONSchema7
>
> requiresApproval?: boolean // pause before executing
>
> replay?: \"log\" \| \"reexecute\"
>
> // \"reexecute\": idempotent reads --- result not stored in durable log
>
> // (avoids bloating replay log with large file contents)
>
> // \"log\": default --- result stored for replay on resume
>
> // INCOMPATIBLE with requiresApproval (approved side effect must be logged)
>
> execute: (args, ctx?: ToolExecuteContext) =\> Promise\<unknown\>
>
> revert?: (args, result, ctx?) =\> Promise\<void\> // compensation / rollback
>
> }

The revert function is the rollback mechanism. When rollback() is called on an execution, the runtime walks actionsToRevert() in reverse and calls each tool\'s revert() function. This is compensation semantics --- the same pattern the Factory\'s amendment loop implements at the atom level (AtomDirective re-commission undoes the prior bead\'s work). Codemode implements it at the intra-atom tool call level.

**DynamicWorkerExecutor --- the sandbox**

Verified from executor-BIs2dr7X.d.ts:

> class DynamicWorkerExecutor implements Executor {
>
> constructor({
>
> loader: WorkerLoader, // Dynamic Worker factory
>
> timeout?: number, // default 30000ms
>
> globalOutbound?: Fetcher \| null, // null = no network (default)
>
> modules?: Record\<string, string\>, // additional modules
>
> bindings?: Record\<string, unknown\>, // env bindings for sandbox
>
> })
>
> execute(code, providers, options?): Promise\<ExecuteResult\>
>
> }

globalOutbound: null is the default --- the sandbox has NO network access. Outbound access is granted explicitly via a Fetcher binding. This is the capability model described in the Project Think blog post: \"instead of starting with a general-purpose machine and trying to constrain it, Dynamic Workers begin with almost no ambient authority.\" This is I4 (fail-closed) at the infrastructure level, not the application level.

**8.2 Factory Atom Execution --- Sequential Tool Calls vs. Codemode**

The current Factory Conducting Agent uses sequential tool calls: shell.write, shell.run, shell.read --- each is a round-trip through the model. For a coder:auth atom implementing a route handler:

  ------------------------------------------------------ -----------------------------------------------------
  **Current sequential pattern**                         **Codemode pattern**

  Model calls shell.write(src/routes/auth.ts, content)   Model writes ONE program that does all of this

  Model calls shell.write(src/utils/jwt.ts, content)     --- The program runs in a Dynamic Worker

  Model calls shell.run(bun test auth.test.ts)           --- Single execution, all results returned together

  Model calls shell.read(test output) to verify          --- N tool round-trips → 1 program execution

  4+ model round-trips, 4+ context window expansions     1 model round-trip, 1 context window expansion

  Test failure → model must re-read, reason, retry       Program handles its own retry logic internally
  ------------------------------------------------------ -----------------------------------------------------

The Project Think blog cites a 99.9% token reduction for the Cloudflare API MCP server: 1,000 tokens (two tools: search() and execute()) vs. 1.17 million tokens (naive tool-per-endpoint). For the Factory\'s coder:\* atoms operating on large codebases, the reduction is proportional to the number of files touched per atom. A planner atom reading 20 files to understand scope: currently 20 read round-trips, with codemode: 1 program that reads all 20 and returns structured findings.

**8.3 Integration Points with Factory Governance**

Four integration points --- each requires a decision:

**Integration 1 --- codemode execution vs. ConsentBead**

The Factory enforces ConsentBeadAuditProcessor: one ConsentBead written to CoordinatorDO SQLite before each tool call in the Conducting Agent\'s LLM loop. With codemode, the Conducting Agent makes ONE tool call --- the execute() call --- and the program runs N tool operations inside the Dynamic Worker sandbox. The ConsentBead is written before the execute() call, not before each internal tool operation.

This creates a governance gap: the ConsentBead records \"atom A called execute() with program P\" but does not record the individual shell.write / shell.run calls inside P. Those are inside the sandbox, invisible to the Mastra outputProcessors chain.

Three options:

  ------------------------------------------------------------- ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------
  **Option**                                                    **Mechanism**                                                                                                                                                                            **Tradeoff**

  A --- Coarse-grained ConsentBead (current if adopted as-is)   One ConsentBead per execute() call. Program content is the consent artifact --- the LLM-written program is the auditable record of intent.                                               Loses per-operation granularity. The ConsentBead says \"ran this program\" not \"wrote this file, ran this test.\" Acceptable for coding atoms where the program is the specification of intent.

  B --- codemode ToolLogEntry as ConsentBead supplement         After execution, write the CodemodeRuntime\'s ToolLogEntry\[\] (the per-tool-call audit trail inside the execution) to CoordinatorDO as supplementary governance nodes.                  Full per-operation audit trail. Requires LoopClosureService BP-CODEMODE bridge point. More complex but governance-complete.

  C --- requiresApproval gates as ConsentBeads                  Only write ConsentBeads for tools with requiresApproval: true inside the codemode execution. Reads are ephemeral (replay: \"reexecute\"). Writes/executes with side effects are gated.   Right granularity for high-stakes operations. Maps naturally onto the Harness permission system (§6.1).
  ------------------------------------------------------------- ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------

Decision required before codemode adoption on coder:\* atoms. Option C is the architectural recommendation --- it aligns codemode\'s requiresApproval gate with the Factory\'s ConsentBead invariant at the right granularity.

**Integration 2 --- Snippet catalog as T1 skill registry**

The T1 open item (SPEC-FF-ILAYER-EXEC-001 v1.1, still open): \"build-time bundled imports for stable cross-repo procedures.\" The codemode Snippet is the runtime implementation of this concept:

> interface Snippet {
>
> name: string // addressable identifier
>
> description: string // for codemode.search()
>
> code: string // the script --- async function source
>
> savedAt: number
>
> inputSchema?: unknown // JSON Schema for codemode.run(name, input)
>
> connectors?: string\[\] // which connectors the script requires
>
> }

Snippets are saved by promoting a working execution: runtime.saveSnippet(name, { executionId }). The snippet persists in CodemodeRuntime DO SQLite and is searchable via codemode.search(). On the next atom run, the model can call codemode.run(\"auth-route-template\") to re-execute a proven pattern rather than writing the program from scratch.

This closes T1 in the most principled way possible: skills are not declared at build time and bundled --- they are discovered at runtime and promoted when they work. The Snippet catalog accumulates the Factory\'s proven execution patterns. The DreamDO crystallize() function (which writes PassTemplates from zero-repair runs) is the governance layer above this --- DreamDO promotes the best runs to templates; the Snippet catalog holds the executable implementations.

  ----------------------------------------------- -----------------------------------------------------------------------------------------------------------------
  **T1 skill registry concept**                   **Snippet catalog implementation**

  Build-time bundled stable procedures            runtime.saveSnippet() after execution proves itself --- runtime-discovered, not build-time declared

  Cross-repo addressable by role                  snippet.name addressable by codemode.run(name) --- connector requirements verified on load

  Skill delivery via AtomDirective.instructions   Snippet code runs in sandbox --- model calls codemode.run(name) in its program, no instruction injection needed

  Governance: toolPolicy.permittedTools           Governance: connector.requiresApproval per tool + ConnectorBinding capability model
  ----------------------------------------------- -----------------------------------------------------------------------------------------------------------------

**Integration 3 --- Rollback and the amendment loop**

The codemode ConnectorTool.revert() function implements compensation for individual tool calls within an execution. The Factory\'s amendment loop implements compensation at the atom level --- a failed atom is re-commissioned with an amended AtomDirective. These operate at different granularities:

  ---------------------- ------------------------------------------------------------------------- ----------------------------------------------------------------------------------------------------------------
  **Granularity**        **Mechanism**                                                             **Scope**

  Intra-atom tool call   ConnectorTool.revert() + CodemodeRuntime.rollback()                       Undo individual shell.write / api.call operations within a single execution. Synchronous within the execution.

  Atom level             failBead() → Divergence → Amendment → re-commission                       Undo the atom\'s contribution to the molecule. Asynchronous, governed, produces ArtifactGraphDO nodes.

  Molecule level         MoleculeOutcomeVerdict: fail → Amendment → re-commission affected atoms   Undo the molecule\'s aggregate output. Multi-atom scope.
  ---------------------- ------------------------------------------------------------------------- ----------------------------------------------------------------------------------------------------------------

These are complementary. A codemode execution that hits an error mid-program (wrote two files, third write failed) can roll back the two written files via revert() before surfacing failBead() to the Factory. The Factory sees a clean failure state, not a partially-applied state. This eliminates a class of \"partial write\" Divergences that currently pollute the amendment loop.

**Integration 4 --- paused execution and the Harness permission system**

A codemode execution with requiresApproval: true on high-stakes tools (payment.execute, calendar.book, contract.sign) pauses and waits for approve() or reject(). This is the business domain atom pattern. The approval surface connects to:

  -------------------------------- ----------------------------------------------------------------------------- -------------------------------------------------------------------------------------------
  **Layer**                        **What it does**                                                              **How it connects**

  CodemodeRuntime.listPending()    Returns all paused executions with pending actions                            Harness permission system (§6.1) reads this to surface approval UI to the human operator

  CodemodeRuntime.approve()        Resumes a paused execution after approval                                     Harness calls this after user grants permission (grantSessionTool / grantSessionCategory)

  CodemodeRuntime.reject()         Terminates a paused execution                                                 Harness calls this after user denies --- maps to failBead() on the atom

  Factory ConsentBead (Option C)   Written for requiresApproval: true tools before their approval is requested   ConsentBead records the intent; codemode runtime enforces the gate
  -------------------------------- ----------------------------------------------------------------------------- -------------------------------------------------------------------------------------------

This is the full business domain atom pattern: the Conducting Agent writes a program, the program runs, it hits a payment.execute call with requiresApproval: true, the execution pauses, the Harness surfaces the pending action to the human operator, the operator approves, the execution resumes, the ConsentBead is written, the payment executes, the result is logged in CodemodeRuntime DO SQLite and in ArtifactGraphDO.

**8.4 Adoption Decision**

  ----------------------------------------------------- ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- --------------------------------------------------------- ---------------------------------------------------------------------------------------------------------------------------------
  **Scope**                                             **Decision**                                                                                                                                                                                                                                                              **Priority**                                              **Blocking item**

  coder:\* atoms on engineering domain                  ADOPT. Replace sequential shell.write/shell.run tool calls with codemode execute() pattern. DynamicWorkerExecutor replaces direct \@cloudflare/shell calls inside the atom loop. Token reduction is structural --- applies to every coder:\* atom on every run.           High --- implement after OI-ILAYER-01 (contextOverflow)   Governance decision: Option A, B, or C for ConsentBead integration (§8.3 Integration 1). Must be decided before implementation.

  Snippet catalog as T1 skill registry                  ADOPT. CodemodeRuntime.saveSnippet() is the implementation of the T1 open item. DreamDO.crystallize() promotes zero-repair runs to PassTemplates; LoopClosureService should also call runtime.saveSnippet() on zero-repair coder:\* executions to populate the catalog.   Medium --- after codemode atom adoption                   LoopClosureService BP-CODEMODE bridge point not yet specced. OI-CA-CODEMODE-01.

  Business domain atoms (calendar, payment, contract)   ADOPT --- deferred. requiresApproval pattern + Harness permission system integration is the correct business domain atom pattern. Not implementable until Harness permission system is specced (SPEC-INTENTWORK-HARNESS-001 or equivalent).                               Low --- blocked on product specs                          Harness permission system spec (§6.1 of this document) must exist first.

  Rollback / revert compensation                        ADOPT --- deferred. ConnectorTool.revert() eliminates partial-write Divergences. Requires codemode adoption on coder:\* atoms first, then retrofit revert() on shell connectors.                                                                                          Low --- after codemode adoption on coder:\*               Depends on codemode coder:\* adoption.
  ----------------------------------------------------- ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- --------------------------------------------------------- ---------------------------------------------------------------------------------------------------------------------------------

**8.5 New Open Items**

  ---------------- ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- -----------------------------------------------------
  **OI**           **Item**                                                                                                                                                                                                                                                                                                                                                                                                                                 **Blocking?**

  OI-CODEMODE-01   Governance decision: ConsentBead integration option for codemode atom execution. Choose Option A (coarse-grained, one ConsentBead per execute()), Option B (ToolLogEntry supplement), or Option C (requiresApproval gates only). Must be decided before codemode adoption on coder:\* atoms.                                                                                                                                             Yes --- blocks codemode adoption on coder:\* atoms.

  OI-CODEMODE-02   Spec the codemode execute() tool wiring in ThinkExecutor / buildConductingAgent(). The Conducting Agent currently calls shell.\* tools directly in the Mastra LLM loop. With codemode, it calls a single execute() tool that takes the LLM-written program. The tool must be registered in getTools() with correct ToolProvider namespaces (shell.\*, sandbox.\*, etc.) as codemode connectors.                                          Yes --- blocks codemode adoption on coder:\* atoms.

  OI-CODEMODE-03   LoopClosureService BP-CODEMODE bridge point. After a codemode execution completes on a coder:\* atom, LoopClosureService should call CodemodeRuntime.saveSnippet() if the atom produced a zero-repair ExecutionTrace (no Divergences, no amendments). This populates the Snippet catalog with proven execution patterns and closes the T1 open item.                                                                                     No --- blocks Snippet catalog as T1 only.

  OI-CODEMODE-04   Shell and sandbox connector wiring as CodemodeConnectors. \@cloudflare/shell tools (read, write, find, exec) and CF Sandbox tools must be wrapped as CodemodeConnector subclasses so they are accessible inside the Dynamic Worker sandbox via the connector capability model. Determine which shell tools are replay: \"reexecute\" (reads) vs. replay: \"log\" (writes) and which require requiresApproval (destructive operations).   Yes --- blocks codemode adoption on coder:\* atoms.
  ---------------- ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- -----------------------------------------------------

*SPEC-FF-MASTRA-001 T4 Amendment v2 --- Wislet J. Celestin / Koales.ai --- June 2026*
