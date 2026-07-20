SPEC-FF-CODEMODE-001 v1.0 DRAFT

**\@cloudflare/codemode Factory Integration**

*Durable execution runtime · Approval gates · Snippet catalog · Factory governance integration*

Wislet J. Celestin / Koales.ai --- June 2026

**0. Scope**

\@cloudflare/codemode v0.4.0 is a durable execution runtime for LLM-generated code. It is not merely a \"write a program instead of calling tools\" pattern --- it is a DO-backed execution substrate with per-tool approval gates, durable replay, rollback compensation, and an addressable snippet catalog. This spec defines how \@cloudflare/codemode integrates with the Factory\'s atom execution substrate, governance layer, and skill registry.

Source: \@cloudflare/codemode v0.4.0, verified June 2026 from npm pack + .d.ts inspection.

  ------------------------------------------------------------------ -----------------------------------------------------------------------------------
  **What this spec covers**                                          **What it does not cover**

  \@cloudflare/codemode component anatomy                            Harness permission system product spec (SPEC-INTENTWORK-HARNESS-001 --- deferred)

  Sequential tool call vs. codemode execution comparison             Business domain atom UX (intentWork.ai, ComeFlow.io product specs)

  Factory governance integration --- ConsentBead option decision     DreamDO PassTemplate → Snippet catalog wiring (DreamDO spec update)

  Shell and sandbox connector wiring as CodemodeConnectors           Worker bundler or npm resolution (Tier 2 execution ladder)

  Snippet catalog as T1 skill registry implementation                

  Rollback / revert compensation closing partial-write Divergences   

  Four open items (OI-CODEMODE-01 through OI-CODEMODE-04)            
  ------------------------------------------------------------------ -----------------------------------------------------------------------------------

**1. Component Anatomy**

\@cloudflare/codemode v0.4.0 has five distinct components. All verified from source.

**1.1 CodemodeRuntime --- Durable Object**

CodemodeRuntime extends DurableObject. Every execution is logged in DO SQLite. One runtime per agent instance, addressed by name. Full API:

> class CodemodeRuntime extends DurableObject\<unknown\> {
>
> begin(code, options?) → Promise\<string\> // executionId
>
> decide(executionId, seq, connector, method, args,
>
> requiresApproval, ephemeral?) → Promise\<ToolDecision\>
>
> recordResult(executionId, seq, result) → Promise\<void\>
>
> complete(executionId, result, logs?) → Promise\<void\>
>
> fail(executionId, error, logs?) → Promise\<void\>
>
> reject(seq, executionId) → Promise\<boolean\>
>
> rollback(executionId) // via actionsToRevert() + markReverted()
>
> approve(executionId) → Promise\<ProxyToolOutput\>
>
> listPending(executionId?) → Promise\<PendingAction\[\]\>
>
> listExecutions(limit?) → Promise\<ExecutionState\[\]\>
>
> saveSnippet(name, { executionId, description, inputSchema, connectors })
>
> → Promise\<Snippet\>
>
> getSnippet(name) → Promise\<Snippet \| null\>
>
> listSnippets() → Promise\<Snippet\[\]\>
>
> expirePaused(maxAgeMs?) → Promise\<string\[\]\>
>
> }

ExecutionStatus and Factory bead status correspondence:

  ------------------------------------- -------------------------------------------- -----------------------------------------------------------------------
  **CodemodeRuntime ExecutionStatus**   **Factory ExecutionBead status**             **Notes**

  \"running\"                           claimed                                      Fiber active, execution in progress

  \"paused\"                            (new) --- awaiting-approval                  requiresApproval tool hit --- execution halted, pending action queued

  \"completed\"                         done                                         Execution completed, result recorded

  \"error\"                             failed                                       Execution threw or hit replay divergence

  \"rejected\"                          failed (divergenceType: approval-rejected)   Human denied a pending action --- maps to failBead()

  \"rolled_back\"                       (new) --- compensation-complete              Applied side effects reverted via revert() chain
  ------------------------------------- -------------------------------------------- -----------------------------------------------------------------------

**1.2 ToolDecision --- The Approval Gate Primitive**

Every tool call inside a running codemode execution goes through decide(), which returns one of three decisions. This is the core gate mechanism:

> type ToolDecision =
>
> \| { kind: \"replay\"; result: unknown }
>
> // Return stored result without executing --- deterministic replay on resume
>
> \| { kind: \"execute\"; seq: number }
>
> // Execute the tool, then recordResult()
>
> \| { kind: \"pause\"; seq: number }
>
> // Stop execution --- requiresApproval: true tool hit
>
> // Awaiting approve() or reject() --- no side effect has occurred

Decision logic verified from CodemodeRuntime.decide() source:

  ----------------------------------------------------------- --------------------------------------------------- ---------------------------------------------------------------------------------
  **Call type**                                               **Decision returned**                               **Invariant**

  Tool already applied (log entry exists, result recorded)    \"replay\" with stored result                       Deterministic --- same result on every resume pass

  Tool is ephemeral (replay: \"reexecute\")                   \"execute\" --- re-runs live, result never stored   Only valid for idempotent reads. INCOMPATIBLE with requiresApproval.

  Tool with requiresApproval: true (new call)                 \"pause\" --- execution stops immediately           No side effect occurs. Human must approve() to resume or reject() to terminate.

  Standard tool (new call, no requiresApproval)               \"execute\" --- runs, then recordResult()           Result stored in durable log for replay on any future resume.

  Execution no longer \"running\" (already paused/terminal)   \"pause\" on every call                             Hard stop --- swallowing the pause sentinel cannot drive further side effects.
  ----------------------------------------------------------- --------------------------------------------------- ---------------------------------------------------------------------------------

**1.3 ConnectorTool --- Per-Tool Governance Schema**

Verified from base-B2amchZA.d.ts. Every tool in a connector is typed with:

> type ConnectorTool = {
>
> description?: string
>
> inputSchema?: JSONSchema7
>
> outputSchema?: JSONSchema7
>
> requiresApproval?: boolean
>
> // true → decide() returns \"pause\" before execution
>
> // false/omit → execute immediately
>
> replay?: \"log\" \| \"reexecute\"
>
> // \"log\" (default): result stored in durable log for replay
>
> // \"reexecute\": result NOT stored --- re-executes live on every resume
>
> // Use for idempotent reads (file contents, directory listings)
>
> // Keeps large read results out of the durable log
>
> // INCOMPATIBLE with requiresApproval
>
> execute: (args, ctx?: ToolExecuteContext) =\> Promise\<unknown\>
>
> revert?: (args, result, ctx?) =\> Promise\<void\>
>
> // Compensation function --- called by rollback() in reverse order
>
> // Absence means the tool has no revert (reads, idempotent ops)
>
> }

revert() is the rollback mechanism. When CodemodeRuntime.rollback(executionId) is called, it walks actionsToRevert() in reverse and calls each tool\'s revert() function. A tool without revert() is a no-op --- only entries that were actually reverted are marked. This is compensation semantics operating at the intra-atom tool call level.

**1.4 DynamicWorkerExecutor --- The Sandbox**

Verified from executor-BIs2dr7X.d.ts. The executor runs LLM-generated code in an isolated Dynamic Worker:

> class DynamicWorkerExecutor implements Executor {
>
> constructor({
>
> loader: WorkerLoader
>
> timeout?: number // default 30000ms (30s)
>
> globalOutbound?: Fetcher \| null // null = NO network (default)
>
> modules?: Record\<string, string\> // additional sandbox modules
>
> bindings?: Record\<string, unknown\> // env bindings (connector stubs)
>
> })
>
> execute(code, providers, options?): Promise\<ExecuteResult\>
>
> }

globalOutbound: null is the default. The sandbox has NO network access unless a Fetcher binding is explicitly granted. This is I4 (fail-closed) enforced at the infrastructure level --- not by application-layer checks. The capability model: \"what exactly do we want this thing to be able to do?\" rather than \"how do we stop this thing from doing too much?\"

Tool functions are exposed in the sandbox under namespaced providers:

> // Inside the Dynamic Worker sandbox:
>
> const files = await shell.find({ pattern: \"\*\*/\*.ts\" });
>
> const content = await shell.read({ path: files\[0\] });
>
> await shell.write({ path: \"src/auth.ts\", content: newContent });
>
> const result = await sandbox.exec({ cmd: \"bun test auth.test.ts\" });
>
> return { files, result };

One program. Zero model round-trips after the initial execute() call. All tool results returned together in ExecuteResult.

**1.5 CodemodeConnector --- The Capability Model**

Verified from base-B2amchZA.d.ts. A connector is a WorkerEntrypoint subclass that declares tools, instructions, and governance annotations:

> abstract class CodemodeConnector\<Env\> extends WorkerEntrypoint\<Env\> {
>
> abstract name(): string // sandbox namespace (e.g. \"shell\", \"sandbox\")
>
> protected instructions(): string \| undefined
>
> protected abstract tools(): ConnectorTools \| Promise\<ConnectorTools\>
>
> protected tool(name, t: ConnectorTool): ConnectorTool // decoration hook
>
> onPassEnd(executionId, status: PassEndStatus): Promise\<void\>
>
> // Called at end of every pass --- release per-pass resources
>
> disposeExecution(executionId, status: ExecutionEndStatus): Promise\<void\>
>
> // Called when execution reaches terminal state --- release per-execution resources
>
> }

Two specialized base connectors are provided:

  -------------------- ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- ----------------------------------------------------------------------------------------------------------------------------------------------------------
  **Connector base**   **What it provides**                                                                                                                                                                        **Factory use case**

  McpConnector         Each MCP tool becomes one ConnectorTool. Override createConnection() to connect to any MCP server. Override tool(name, t) to add requiresApproval or revert to specific tools.              MCP connectivity (T5, deferred in Mastra adoption) --- McpConnector is the correct integration point for MCP-backed tool capabilities in codemode atoms.

  OpenApiConnector     Derives one typed tool per OpenAPI operation. Override spec() to return the OpenAPI document and request() to perform authenticated HTTP calls. Exposes raw request tool as escape hatch.   Business domain connectors --- CRM, ERP, payment, calendar APIs with typed tool derivation from their OpenAPI specs.
  -------------------- ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- ----------------------------------------------------------------------------------------------------------------------------------------------------------

**1.6 Snippet --- The Reusable Execution Pattern**

Verified from index.d.ts. A Snippet is a saved, addressable sandbox script:

> interface Snippet {
>
> name: string // unique --- addressable by codemode.run(name, input)
>
> description: string // for codemode.search() discovery
>
> code: string // the script --- async function source, as written
>
> savedAt: number // epoch ms
>
> inputSchema?: unknown // JSON Schema for codemode.run(name, input) typing
>
> connectors?: string\[\] // connector names the script requires
>
> // verified on load --- clear error if missing
>
> }

Snippets persist in CodemodeRuntime DO SQLite. They accumulate over time as executions are promoted. The developer (or DreamDO) calls runtime.saveSnippet(name, { executionId }) after a script proves useful. On the next atom run, the model can call codemode.run(\"auth-route-template\") to re-execute a proven pattern rather than writing the program from scratch.

**2. Sequential Tool Calls vs. Codemode Execution**

The Factory\'s current Conducting Agent uses sequential tool calls through the Mastra LLM loop. Each tool call is a round-trip through the model. A coder:auth atom implementing a route handler with JWT and tests:

  ---------- -------------------------------------------------------------------- ---------------------------------------------------------------------------------
  **Step**   **Current sequential pattern (N model round-trips)**                 **Codemode pattern (1 model round-trip)**

  1          Model calls shell.read(src/routes/) --- reads directory              Model writes ONE program:

  2          Model reads result, calls shell.write(src/routes/auth.ts, content)   const existing = await shell.read({path:\"src/routes/\"})

  3          Model calls shell.write(src/utils/jwt.ts, content)                   await shell.write({path:\"src/routes/auth.ts\", content: buildRoute(existing)})

  4          Model calls shell.run(bun test auth.test.ts)                         await shell.write({path:\"src/utils/jwt.ts\", content: buildJwt()})

  5          Model reads test output, decides whether to retry                    const result = await sandbox.exec({cmd:\"bun test auth.test.ts\"})

  6          If fail: model calls shell.write again with fix                      if (!result.pass) { /\* retry logic inline \*/ }

  7          Model calls shell.run again --- second round-trip for retry          return result

  Result     6-7 model round-trips. Context window grows with each result.        1 model round-trip. Program handles retry logic internally.
  ---------- -------------------------------------------------------------------- ---------------------------------------------------------------------------------

Token impact: the Project Think blog post cites a 99.9% reduction for the Cloudflare API MCP server (1,000 tokens vs. 1.17 million tokens for naive tool-per-endpoint). For the Factory\'s coder:\* atoms, the reduction scales with codebase size. A planner atom reading 20 files: currently 20 read round-trips; with codemode: 1 program that reads all 20 and returns structured findings.

Quality impact: the model writes the program once with full intent. It is not constrained by the sequential tool-call shape. Retry logic, conditional writes, and file dependency resolution are expressed as program logic rather than multi-turn model reasoning. Models are better at writing code to use a system than at playing the tool-calling game.

**3. Factory Governance Integration**

**3.1 ConsentBead Integration --- Decision Required**

The Factory enforces ConsentBeadAuditProcessor: one ConsentBead written to CoordinatorDO SQLite before each tool call in the Conducting Agent\'s Mastra LLM loop (I4 invariant). With codemode, the Conducting Agent makes ONE tool call --- execute() --- and the program runs N tool operations inside the Dynamic Worker sandbox. The ConsentBead is written before execute(), not before each internal tool operation.

This creates a governance scope question. Three options:

  ------------------------------------------------------ -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- -------------------------------------------------------------------------------------------------- ------------------------------------------------------------------------------------------- ------------------------------------------------------------------------------------------------------------------------------------------------------------------
  **Option**                                             **Mechanism**                                                                                                                                                                                                                    **Governance completeness**                                                                        **Implementation complexity**                                                               **Recommendation**

  A --- Coarse-grained (one ConsentBead per execute())   ConsentBead is written before the execute() call. The LLM-written program is the auditable record of intent --- \"this atom was authorized to run program P.\"                                                                   Program-level. Per-operation audit is inside CodemodeRuntime ToolLogEntry, not in CoordinatorDO.   Low. No change to current ConsentBeadAuditProcessor. execute() is just another tool call.   Acceptable for coder:\* atoms where the program itself IS the specification of intent. The program is small, auditable, and stored in CodemodeRuntime.

  B --- ToolLogEntry supplement                          After execution, write CodemodeRuntime ToolLogEntry\[\] to ArtifactGraphDO as supplementary governance nodes. Requires new LoopClosureService BP-CODEMODE bridge point.                                                          Complete --- per-operation audit trail in ArtifactGraphDO alongside ExecutionTrace.                High. New bridge point, new ArtifactGraphDO node type, new LoopClosureService path.         Best for full audit trail. Deferred --- implement after codemode adoption on coder:\* is stable.

  C --- requiresApproval gates as ConsentBeads           ConsentBeads written only for tools with requiresApproval: true inside the codemode execution. Reads (replay: \"reexecute\") produce no ConsentBead. Writes/side-effecting operations produce ConsentBeads at the pause point.   Right granularity --- high-stakes operations are gated and audited; reads are not.                 Medium. Requires wiring from CodemodeRuntime pause event to ConsentBead write path.         RECOMMENDED for business domain atoms. Correct integration with Harness permission system. Maps cleanly onto ConsentBead semantics (consent before side effect).
  ------------------------------------------------------ -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- -------------------------------------------------------------------------------------------------- ------------------------------------------------------------------------------------------- ------------------------------------------------------------------------------------------------------------------------------------------------------------------

Decision: OI-CODEMODE-01. For coder:\* atoms: Option A (start), Option B (full audit, phase 2). For business domain atoms: Option C (required).

**3.2 Snippet Catalog as T1 Skill Registry**

The T1 open item from SPEC-FF-ILAYER-EXEC-001 v1.1: \"build-time bundled imports for stable cross-repo procedures.\" The codemode Snippet catalog is the runtime implementation of this concept.

  ----------------------------------------------- ----------------------------------------------------------------------------------------------------------------------------------
  **T1 concept**                                  **Snippet catalog implementation**

  Build-time declared stable procedures           Runtime-discovered: saveSnippet() after execution proves itself. No build-time declaration needed.

  Cross-repo addressable by role                  snippet.name is globally addressable via codemode.run(name). connector requirements verified on load --- clear error if missing.

  Skill delivery via AtomDirective.instructions   Model calls codemode.run(name, input) in its program. No instruction injection needed.

  Governance: toolPolicy.permittedTools           Governance: connector.requiresApproval per tool + ConnectorBinding capability model (globalOutbound: null).

  Build-time bundled --- static                   Runtime-accumulated --- dynamic. Catalog grows as Factory runs accumulate proven patterns.
  ----------------------------------------------- ----------------------------------------------------------------------------------------------------------------------------------

Promotion path: LoopClosureService BP-CODEMODE (OI-CODEMODE-03). After a codemode execution completes on a coder:\* atom with no Divergences (zero-repair run), LoopClosureService calls CodemodeRuntime.saveSnippet() to promote the execution to the catalog. DreamDO.crystallize() runs on zero-repair run sets and promotes PassTemplates --- the Snippet catalog is the executable complement to the PassTemplate: the PassTemplate describes what worked; the Snippet is the code that did it.

**3.3 Rollback and the Amendment Loop**

ConnectorTool.revert() implements compensation for individual tool calls within a codemode execution. This operates at a different granularity than the Factory\'s amendment loop:

  ------------------------- -------------------------------------------------------------------- --------------------------------------------------------------------------------------------- --------------------------------------------------------------------
  **Level**                 **Mechanism**                                                        **Scope**                                                                                     **Trigger**

  Intra-atom tool call      ConnectorTool.revert() + CodemodeRuntime.rollback()                  Undo shell.write / api.call within a single execution. Synchronous. Runs before failBead().   Execution error mid-program OR explicit reject() of pending action

  Atom (ExecutionBead)      failBead() → Divergence → Amendment → re-commission                  Undo the atom\'s contribution to the molecule. Async. Produces ArtifactGraphDO nodes.         releaseBead() failure OR MoleculeOutcomeVerdict: fail

  Molecule (GearMolecule)   MoleculeOutcomeVerdict: fail → CommissioningAgentDO amendment loop   Undo the molecule\'s aggregate output. Multi-atom scope.                                      MoleculeOutcomeAtom verdict: fail
  ------------------------- -------------------------------------------------------------------- --------------------------------------------------------------------------------------------- --------------------------------------------------------------------

These are complementary, not redundant. A codemode execution that hits an error mid-program (wrote two files, third write failed) calls rollback() to revert the two written files before surfacing failBead(). The Factory sees a clean failure state. This eliminates \"partial write\" Divergences --- the most common class of amendment loop noise in coder:\* atoms. The amendment loop sees a clean atom failure, not a partially-applied state that requires reasoning about what was already written.

**3.4 Paused Execution and the Harness Permission System**

A codemode execution with requiresApproval: true on high-stakes tools pauses and awaits human approval. The approval surface is:

> CodemodeRuntime.listPending(executionId?) → PendingAction\[\]
>
> // Each PendingAction: { executionId, seq, connector, method, args }
>
> CodemodeRuntime.approve({ executionId }) → ProxyToolOutput
>
> CodemodeRuntime.reject({ seq, executionId }) → boolean

Connection to Harness permission system (§6.1 of SPEC-FF-MASTRA-001 T4 Amendment, deferred):

  ------------------------------- ---------------------------------------------------------------------------------- -----------------------------------------------------------------------------------------------------
  **Layer**                       **What it does**                                                                   **How it connects**

  CodemodeRuntime.listPending()   Returns all paused executions with pending actions across all running atoms        Harness reads this to surface approval UI to the human operator in the product layer

  CodemodeRuntime.approve()       Resumes the paused execution --- side effect executes, result recorded             Harness calls this after user grants permission (grantSessionTool / grantSessionCategory)

  CodemodeRuntime.reject()        Terminates the paused execution with \"rejected\" status                           Harness calls this after user denies --- maps to failBead() on the Factory atom

  ConsentBead (Option C)          Written at the pause point --- before the side effect occurs                       ConsentBead records the intent; codemode runtime enforces the gate; Harness surfaces it to the user

  Factory LoopClosureService      BP3 fires on \"rejected\" status → Divergence(divergenceType: approval-rejected)   Standard amendment loop --- CA proposes Amendment scoped to the rejected tool call
  ------------------------------- ---------------------------------------------------------------------------------- -----------------------------------------------------------------------------------------------------

The full business domain atom pattern: Conducting Agent writes a program → program runs → hits payment.execute (requiresApproval: true) → execution pauses → Harness surfaces pending action to human operator → operator approves → ConsentBead written → payment executes → result logged in CodemodeRuntime DO SQLite and ArtifactGraphDO → execution completes → releaseBead().

**4. Shell and Sandbox Connector Wiring**

OI-CODEMODE-04. \@cloudflare/shell tools and CF Sandbox tools must be wrapped as CodemodeConnector subclasses to be accessible inside the Dynamic Worker sandbox. This section specifies the wiring.

**4.1 ShellConnector**

Wraps \@cloudflare/shell workspace tools. Exposed under \"shell\" namespace in the sandbox.

> class ShellConnector extends CodemodeConnector\<Env\> {
>
> name() { return \"shell\"; }
>
> instructions() {
>
> return \"Workspace filesystem. Read, write, find, exec. Use shell.\* in your program.\";
>
> }
>
> protected tools(): ConnectorTools {
>
> return {
>
> read: {
>
> description: \"Read file content\",
>
> inputSchema: { type:\"object\", properties: { path:{type:\"string\"} } },
>
> replay: \"reexecute\", // idempotent read --- never stored in durable log
>
> execute: async ({ path }) =\> this.workspace.read(path),
>
> },
>
> find: {
>
> description: \"Find files matching pattern\",
>
> replay: \"reexecute\", // idempotent read
>
> execute: async ({ pattern }) =\> this.workspace.find(pattern),
>
> },
>
> write: {
>
> description: \"Write file content\",
>
> replay: \"log\", // side effect --- must be logged for replay
>
> execute: async ({ path, content }) =\> this.workspace.write(path, content),
>
> revert: async ({ path }) =\> this.workspace.delete(path),
>
> // revert: deletes the written file on rollback
>
> },
>
> exec: {
>
> description: \"Execute shell command in sandbox\",
>
> replay: \"log\", // result logged (test output, build output)
>
> execute: async ({ cmd }) =\> this.sandbox.exec(cmd),
>
> // no revert --- exec is not compensatable
>
> },
>
> };
>
> }
>
> }

replay: \"reexecute\" on reads keeps large file contents out of the durable log. On any resume after a pause, the read re-executes live rather than replaying a stored megabyte of file content. The INCOMPATIBLE constraint is respected: no read tool has both replay: \"reexecute\" and requiresApproval: true.

**4.2 SandboxConnector**

Wraps CF Sandbox tools for Tier 4 operations: git, compilers, test runners. Exposed under \"sandbox\" namespace.

> class SandboxConnector extends CodemodeConnector\<Env\> {
>
> name() { return \"sandbox\"; }
>
> protected tools(): ConnectorTools {
>
> return {
>
> exec: {
>
> description: \"Run command in full OS sandbox (git, bun, cargo, \...)\",
>
> replay: \"log\",
>
> execute: async ({ cmd, cwd }) =\> this.cfSandbox.exec(cmd, { cwd }),
>
> },
>
> clone: {
>
> description: \"git clone a repository\",
>
> requiresApproval: true, // cloning is a significant side effect
>
> replay: \"log\",
>
> execute: async ({ url, dest }) =\> this.cfSandbox.exec(\`git clone \${url} \${dest}\`),
>
> revert: async ({ dest }) =\> this.cfSandbox.exec(\`rm -rf \${dest}\`),
>
> },
>
> deploy: {
>
> description: \"wrangler deploy\",
>
> requiresApproval: true, // deployment is terminal --- requires explicit consent
>
> replay: \"log\",
>
> execute: async ({ cmd }) =\> this.cfSandbox.exec(cmd),
>
> // no revert --- deployment is not compensatable at this layer
>
> },
>
> };
>
> }
>
> }

deploy with requiresApproval: true is a critical design choice. Under ConsentBead Option C, this is where the ConsentBead is written --- before deployment executes. The Factory\'s synthesis_passed → deploying SM1 transition already gates on RunVerdict: pass and ArchitectAgentDO sign-off. The codemode requiresApproval: true on deploy is the atom-level gate, consistent with I4.

**5. Atom Execution Wiring --- OI-CODEMODE-02**

The Conducting Agent currently calls shell.\* tools directly in the Mastra LLM loop. With codemode, it calls a single execute() tool that takes the LLM-written program. This is the complete wiring change.

**5.1 ThinkExecutor with codemode**

> import { createCodemodeRuntime } from \"@cloudflare/codemode\";
>
> import { DynamicWorkerExecutor } from \"@cloudflare/codemode\";
>
> export class ThinkExecutor extends Think\<Env\> {
>
> private codemodeRuntime!: CodemodeRuntimeHandle;
>
> async onStart() {
>
> const shellConnector = new ShellConnector(this.ctx, this.env);
>
> const sandboxConnector = new SandboxConnector(this.ctx, this.env);
>
> const executor = new DynamicWorkerExecutor({
>
> loader: this.env.DYNAMIC_WORKER_LOADER,
>
> timeout: 60_000, // 60s for long-running tests
>
> globalOutbound: null, // no network in sandbox (I4)
>
> });
>
> this.codemodeRuntime = createCodemodeRuntime({
>
> ctx: this.ctx,
>
> connectors: \[shellConnector, sandboxConnector\],
>
> executor,
>
> name: \"atom-runtime\",
>
> maxExecutions: 20, // retain last 20 executions per atom
>
> });
>
> }
>
> getTools() {
>
> return {
>
> // Single execute tool replaces all shell.\* tool calls
>
> execute: this.codemodeRuntime.tool({
>
> description: \"Write a program to accomplish the task.\",
>
> connectorHints: {
>
> shell: \"workspace filesystem --- read, write, find, exec\",
>
> sandbox: \"OS sandbox --- git, bun, cargo, wrangler deploy\",
>
> },
>
> }),
>
> };
>
> }
>
> // contextOverflow wiring (OI-ILAYER-01)
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

**5.2 ConsentBead wiring (Option A --- start)**

For coder:\* atoms, Option A is the starting ConsentBead wiring: one ConsentBead before the execute() tool call. The LLM-written program is the consent artifact.

> // In ConsentBeadAuditProcessor (Mastra outputProcessor)
>
> // Existing hook --- no change needed for Option A
>
> // execute() is just another tool call in the Mastra LLM loop
>
> // ConsentBeadAuditProcessor fires before execute() as before
>
> // The program code is stored in the ConsentBead payload:
>
> {
>
> atomId: directiveAtomId,
>
> toolName: \"execute\",
>
> payload: { code: llmWrittenProgram }, // program is the consent artifact
>
> ts: Date.now(),
>
> }

**5.3 LoopClosureService BP-CODEMODE (OI-CODEMODE-03)**

After a codemode execution completes on a coder:\* atom with zero Divergences, LoopClosureService fires BP-CODEMODE to promote the execution to the Snippet catalog:

> // LoopClosureService BP-CODEMODE
>
> // Trigger: releaseBead() on atom with is_outcome_atom = 0
>
> // AND no Divergence nodes written for this atomId in this run
>
> if (zeroDivergences && execution.status === \"completed\") {
>
> await thinkExecutor.codemodeRuntime.saveSnippet(
>
> \`\${directive.role}:\${runId}\`,
>
> {
>
> executionId: execution.id,
>
> description: \`\${directive.role} atom --- zero-repair run \${runId}\`,
>
> connectors: \[\"shell\", \"sandbox\"\],
>
> }
>
> );
>
> }

**6. Adoption Decision**

  ----------------------------------------------------- ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- ----------------------------------------------------------------- -------------------------------------------------------------------------------------------------------------
  **Scope**                                             **Decision**                                                                                                                                                                                                                                         **Priority**                                                      **Depends on**

  coder:\* atoms --- engineering domain                 ADOPT. Replace sequential shell.\* tool calls in the Mastra LLM loop with the codemode execute() pattern. DynamicWorkerExecutor + ShellConnector + SandboxConnector. ConsentBead Option A to start, Option B (ToolLogEntry supplement) as phase 2.   High --- highest token/quality ROI of any single Factory change   OI-CODEMODE-01 (ConsentBead decision) · OI-CODEMODE-02 (wiring) · OI-CODEMODE-04 (connector implementation)

  Snippet catalog as T1 skill registry                  ADOPT. BP-CODEMODE in LoopClosureService promotes zero-repair executions to named Snippets. DreamDO PassTemplate promotion is the governance complement.                                                                                             Medium --- after codemode coder:\* adoption                       OI-CODEMODE-03 (BP-CODEMODE bridge point) · DreamDO spec update

  Business domain atoms (calendar, payment, contract)   ADOPT --- deferred. requiresApproval: true on high-stakes tools + Harness permission system integration (§3.4). ConsentBead Option C.                                                                                                                Low --- blocked on Harness spec                                   SPEC-INTENTWORK-HARNESS-001 or equivalent product spec

  Rollback / revert compensation                        ADOPT --- phase 2. ConnectorTool.revert() on shell.write (delete written file) eliminates partial-write Divergences. Implement after coder:\* codemode adoption is stable.                                                                           Low --- after coder:\* adoption                                   coder:\* codemode adoption complete

  McpConnector for MCP connectivity (T5)                ADOPT when T5 (MCP connectivity) is specced. McpConnector is the correct integration point for MCP-backed tools inside codemode atoms --- not a separate tool-calling pattern.                                                                       Low --- blocked on T5 spec                                        T5 MCP connectivity spec (not yet written)
  ----------------------------------------------------- ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- ----------------------------------------------------------------- -------------------------------------------------------------------------------------------------------------

**7. Open Items**

  ---------------- ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- ------------------------------------------------
  **OI**           **Item**                                                                                                                                                                                                                                                                                                                                                   **Blocking?**

  OI-CODEMODE-01   ConsentBead governance decision: Option A (coarse-grained --- one ConsentBead per execute()), Option B (ToolLogEntry supplement after execution), or Option C (requiresApproval gates only). Decision required before codemode adoption on coder:\* atoms. Recommendation: Option A for coder:\* (start), Option C for business domain atoms (required).   Yes --- blocks all codemode coder:\* adoption.

  OI-CODEMODE-02   Wire codemode execute() tool in ThinkExecutor.getTools(). Replace direct shell.\* tool calls in buildConductingAgent() LLM loop with createCodemodeRuntime() + single execute() tool. Wiring code in §5.1. Requires DYNAMIC_WORKER_LOADER binding in wrangler.jsonc.                                                                                       Yes --- blocks codemode coder:\* adoption.

  OI-CODEMODE-03   LoopClosureService BP-CODEMODE bridge point. After zero-repair coder:\* execution, call CodemodeRuntime.saveSnippet() to promote to catalog. Closes T1 open item from SPEC-FF-ILAYER-EXEC-001. Wiring code in §5.3.                                                                                                                                        No --- blocks T1 Snippet catalog only.

  OI-CODEMODE-04   Implement ShellConnector and SandboxConnector as CodemodeConnector subclasses. Determine replay: \"reexecute\" (reads) vs. replay: \"log\" (writes) per tool. Determine requiresApproval per tool --- especially sandbox.deploy. Skeleton code in §4.                                                                                                      Yes --- blocks codemode coder:\* adoption.

  OI-CODEMODE-05   DYNAMIC_WORKER_LOADER wrangler.jsonc binding. DynamicWorkerExecutor requires a WorkerLoader binding to spin up Dynamic Workers. Add to ThinkExecutor wrangler.jsonc bindings alongside existing CF_THINK, COORDINATOR_DO, DREAM_DO.                                                                                                                        Yes --- blocks codemode coder:\* adoption.

  OI-CODEMODE-06   Option B (ToolLogEntry supplement) bridge point spec. If Option B is adopted for full audit trail: new ArtifactGraphDO node type CodemodeToolLog, new LoopClosureService path writing ToolLogEntry\[\] after execution completes. Deferred --- implement after Option A is stable.                                                                         No --- deferred to phase 2.
  ---------------- ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- ------------------------------------------------

**8. Wrangler Config Delta**

> // wrangler.jsonc --- ThinkExecutor additions
>
> {
>
> \"durable_objects\": { \"bindings\": \[
>
> { \"name\": \"CODEMODE_RUNTIME\", \"class_name\": \"CodemodeRuntime\" } // ADD
>
> \]},
>
> \"migrations\": \[
>
> { \"tag\": \"v4\", \"new_sqlite_classes\": \[\"CodemodeRuntime\"\] } // ADD
>
> \],
>
> \"services\": \[
>
> { \"binding\": \"DYNAMIC_WORKER_LOADER\", \"service\": \"dynamic-workers\" } // ADD
>
> \]
>
> }

*SPEC-FF-CODEMODE-001 v1.0 DRAFT --- Wislet J. Celestin / Koales.ai --- June 2026*
