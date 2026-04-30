# SE Gap Analysis: TIAGO/PAI (Current) vs GovernorAgent (Proposed)

> Systems Engineering Assessment per Sage & Rouse (1999)
> Supplemented by Patterson (System Boundary), Buede (Functional Decomposition),
> and TRM (Risk Assessment) frameworks.
>
> Analyst: Architect Agent (Systems Engineer role)
> Date: 2026-04-29
> Status: Initial Assessment

---

## Executive Summary

The GovernorAgent replaces approximately **20-25%** of TIAGO's functional
surface area. It replaces the right 20-25% -- the operational monitoring
and signal-triage loop that currently requires a human session to execute.
But TIAGO is five systems fused into one runtime. The GovernorAgent only
addresses one of those five systems (operational governance). The remaining
four (reasoning, orchestration, memory, communication, development) have
no proposed replacement and will continue to require human-session-bound
execution.

This is not a deficiency in the GovernorAgent design. The design is
appropriately scoped. The gap analysis reveals that the transition is
not TIAGO-to-GovernorAgent but TIAGO-to-(GovernorAgent + 4 unaddressed
systems). The GovernorAgent is Phase 1 of a decomposition, not a
replacement.

---

## 1. System Boundary Analysis (Patterson Ch. 1)

### 1.1 TIAGO/PAI System Boundary

**Runtime boundary:**
- Process: Claude Code CLI running in macOS Terminal on Wes's MacBook
- Execution context: Single-threaded conversation loop with tool-calling
- Compute: Wes's laptop CPU/RAM + Claude API (Anthropic cloud)
- Network: Outbound HTTP to Cloudflare Workers, GitHub, ArangoDB (via gateway)
- Filesystem: Full read/write access to `~/Developer/function-factory/`
- Shell: Full access to `zsh` with `bun`, `vitest`, `wrangler`, `gh`, `git`, `curl`

**Memory boundary:**
- Persistent: `MEMORY.md` index + per-topic `.md` files in `~/.claude/projects/`
- Persistent: `CLAUDE.md` (GUV operating rules, constitutional)
- Persistent: `.agent/memory/` (WORKSPACE.md, LESSONS.md, DECISIONS.md, PREFERENCES.md)
- Persistent: `.agent/skills/` (PAI Algorithm, domain skills)
- Ephemeral: Session transcript (conversation context window, ~200K tokens)
- Ephemeral: Tool call results (git status, curl responses, file contents)

**Authority boundary:**
- TIAGO CAN: read/write source code, run tests, deploy via wrangler, create PRs,
  trigger pipelines, approve pipeline gates, spawn sub-agents (Architect, Engineer,
  SE, QA), adjust hot config, query ArangoDB, save lessons to memory
- TIAGO CANNOT: make architecture decisions unilaterally (requires Wes's gate),
  access Cloudflare Worker logs (wrangler tail broken), inspect Queue/DO internals,
  see pipeline execution in real-time
- TIAGO MUST: get Wes's approval for architecture gates, follow GUV operating rules,
  use PAI Algorithm for all responses, spawn Architect review before declaring done

**Temporal boundary:**
- Session-bound: starts when Wes opens terminal, ends when session closes
- Context window: ~200K tokens, degrades with conversation length
- Cross-session: MEMORY.md files bridge sessions but are lossy (summaries, not transcripts)
- Human-gated: operates only when Wes is available at keyboard
- Duty cycle: ~4-12 hours/day, 0 hours overnight, 0 hours when Wes is away

**Knowledge boundary:**
- At session start: MEMORY.md + recent session files (point-in-time snapshots)
- During session: full codebase access, git history, ArangoDB queries, web research
- Decay: between sessions, TIAGO forgets conversation context, tool call results,
  intermediate reasoning. Only what was saved to MEMORY.md survives.
- Staleness: memory files carry a staleness warning (9-day example in current data)

### 1.2 GovernorAgent System Boundary

**Runtime boundary:**
- Process: Cloudflare Worker (V8 isolate), triggered by Cron or Queue
- Execution context: Single function invocation, stateless per cycle
- Compute: Cloudflare edge CPU (50ms CPU time limit per request, but `ctx.waitUntil`
  extends to 30s for background work, 120s wall-clock timeout configured)
- Network: Internal to Cloudflare (Service Bindings, Queue, ArangoDB via HTTP)
- Filesystem: None (Workers have no filesystem)
- Shell: None (Workers cannot exec processes)

**Memory boundary:**
- Persistent: ArangoDB collections (orl_telemetry, specs_signals, memory_curated,
  orientation_assessments, completion_ledgers, hot_config, execution_artifacts)
- Ephemeral: Single LLM context window per cycle (~16K tokens input, ~8K output)
- No session transcript: each cycle is independent, no conversation memory
- No cross-cycle state: all state lives in ArangoDB, no in-process accumulation

**Authority boundary:**
- GovernorAgent CAN: read ArangoDB (8 parallel queries), trigger pipelines
  (via Workflow.create), approve pipeline gates (via Workflow.sendEvent),
  file GitHub issues (via REST API), archive/deduplicate signals (ArangoDB
  mutations), adjust hot_config within safe ranges, write governance
  telemetry and assessments to ArangoDB
- GovernorAgent CANNOT: read source code, write source code, modify agent
  prompts, change routing config, deploy Workers, make architecture decisions,
  suppress escalations, exceed budget thresholds, run tests, access secrets
  in prompt context
- GovernorAgent MUST: validate all actions through deterministic criteria gates
  before execution (LLM proposes, code validates), escalate per hard-coded
  criteria, stay within 5 pipelines/cycle and 3 approvals/cycle budget

**Temporal boundary:**
- Cron-triggered: every 15 minutes, 96 cycles/day, 24/7/365
- Cycle duration: max 120 seconds per cycle
- No session concept: each cycle is a fresh invocation with no memory of prior cycles
  except what is in ArangoDB
- Lookback window: 7-day telemetry, 2-day pipelines, 30 pending signals, 20 feedback
  signals, 20 curated lessons, 10 assessments, 10 ledgers
- Always-on: no human availability dependency

**Knowledge boundary:**
- At cycle start: only what the 8 AQL queries return from ArangoDB
- During cycle: single LLM invocation with formatted context (no tool use, no
  iterative reasoning, no follow-up questions)
- No codebase knowledge: cannot read source files, cannot understand code structure,
  cannot correlate telemetry to specific code paths
- No conversation context: cannot discuss findings with Wes, cannot receive corrections,
  cannot iteratively refine understanding

### 1.3 Boundary Comparison Summary

| Dimension | TIAGO | GovernorAgent |
|-----------|-------|---------------|
| Runtime | MacBook terminal process | CF Worker isolate |
| Duration | Hours (session-bound) | Seconds (cycle-bound) |
| Availability | When Wes is present | 24/7 |
| Filesystem | Full read/write | None |
| Shell access | Full (bun, git, wrangler, gh) | None |
| Memory persistence | MEMORY.md files | ArangoDB |
| Context window | ~200K tokens | ~16K tokens |
| LLM interaction | Multi-turn conversation | Single invocation |
| Human in loop | Continuous (Wes at keyboard) | None (escalation via GitHub issues) |
| Sub-agent spawning | Yes (Architect, Engineer, SE, QA) | No |
| Observability of Factory | HTTP-only (gateway queries) | Internal (same CF environment) |
| Source code access | Full | None |
| Deployment capability | Yes (wrangler deploy) | No |

---

## 2. Functional Decomposition (Buede Ch. 25)

### 2.1 TIAGO's Actual Functions

Decomposed from CLAUDE.md (GUV operating rules), PAI SKILL.md (Algorithm),
ARCHITECTURE-TIAGO-FACTORY-INTERACTION.md (interaction patterns), and
MEMORY.md (accumulated session patterns).

#### F1: Session Initialization
- Read MEMORY.md index
- Read latest session handoff files
- Debrief Wes on last session results
- Surface time-sensitive items (deadlines, aging decisions)
- Cold start recovery (read memory/ and vault/ if context missing)

#### F2: Situation Observation
- Check git status (uncommitted changes, branch state)
- Query ArangoDB via gateway (pipeline results, signal backlog, telemetry)
- Check GitHub (open PRs, issues, CI status)
- Read Factory health endpoint
- Correlate observations into situation awareness

#### F3: Orientation & Analysis
- Analyze situation against known patterns (LESSONS.md, DECISIONS.md)
- Identify gaps between expected and actual state
- Cross-reference codebase against specs
- Produce typed assessments (gap analyses, conflict registers, SE evaluations)
- Apply PAI Algorithm (7 phases: Observe, Think, Plan, Build, Execute, Verify, Learn)
- Run thinking tools (Council, RedTeam, FirstPrinciples, Science, BeCreative)

#### F4: Decision Presentation
- Present options to Wes with tradeoffs
- Frame decisions in architect's language (not implementation detail)
- Wait for Wes's "go" on architecture gates
- Receive and incorporate corrections ("not that, do this")

#### F5: Agent Orchestration
- Spawn Architect agent (design review, architecture analysis)
- Spawn Engineer agent (code implementation, test writing)
- Spawn SE agent (systems engineering analysis)
- Spawn QA agent (testing, verification)
- Spawn Researcher agents (web research, content analysis)
- Coordinate parallel agent swarms (SWARM IS DEFAULT)
- Synthesize agent outputs into coherent results

#### F6: Development Execution
- Write/edit TypeScript source code (direct file system access)
- Run tests (vitest, bun test)
- Deploy via wrangler (push to Cloudflare)
- Create GitHub PRs via gh CLI
- Set secrets via wrangler secret put
- Trigger Factory pipelines via curl POST
- Approve pipeline gates via curl POST

#### F7: Verification & Quality
- Check test results
- Verify deployment health
- Confirm Factory pipeline outcomes
- Run Architect review before declaring done
- Validate against ISC (Ideal State Criteria) from PAI Algorithm
- Apply "DONE MEANS DEPLOYED" rule

#### F8: Memory & Learning
- Save lessons/feedback to MEMORY.md files
- Update WORKSPACE.md with current state
- Log actions to AGENT_LEARNINGS.jsonl
- Update DECISIONS.md for architectural choices
- Create session handoff files for next session
- Save substantive analysis to files (COMPOUNDS OVER EPHEMERAL)

#### F9: Communication
- Natural language conversation with Wes
- Voice notifications (voice server integration)
- PAI Algorithm formatted responses (7 phases with ISC)
- "BE THE BRAIN" -- anticipate what Wes needs to know
- "BE EXPLICIT ABOUT WHAT YOU NEED" -- lead with blockers

### 2.2 Function-to-GovernorAgent Mapping

| TIAGO Function | GovernorAgent Status | Notes |
|----------------|---------------------|-------|
| F1: Session Init | CANNOT DO | No session concept. No MEMORY.md. No debrief. |
| F2: Situation Observation | DOES DIFFERENTLY | Reads ArangoDB directly (better Factory visibility). Cannot see git, source code, local state. |
| F3: Orientation & Analysis | DOES DIFFERENTLY (limited) | Single LLM call with 16K context. No multi-turn reasoning. No thinking tools. No PAI Algorithm phases. No codebase cross-reference. |
| F4: Decision Presentation | CANNOT DO | No human interaction. Escalates via GitHub issues (write-only, no dialogue). |
| F5: Agent Orchestration | CANNOT DO | No sub-agent spawning. Single-agent, single-invocation design. |
| F6: Development Execution | CANNOT DO | No filesystem, no shell, no wrangler, no gh. Can trigger pipelines and approve gates (2 of 7 sub-functions). |
| F7: Verification & Quality | DOES DIFFERENTLY (limited) | Reads pipeline outcomes from ArangoDB. Cannot run tests. Cannot do Architect review. Cannot verify deployment health directly. |
| F8: Memory & Learning | DOES DIFFERENTLY (limited) | Writes governance assessments and telemetry to ArangoDB. Cannot update MEMORY.md files. Cannot create session handoffs. |
| F9: Communication | CANNOT DO | No conversation with Wes. GitHub issues are one-directional escalation. |

### 2.3 Coverage Summary

- **Functions GovernorAgent CAN do (with limitations):** F2, F3, F7, F8 (partial)
- **Functions GovernorAgent CANNOT do at all:** F1, F4, F5, F6 (mostly), F9
- **Sub-functions GovernorAgent adds (TIAGO cannot):**
  - Internal Cloudflare observability (Queue state, Worker metrics)
  - 24/7 automated signal triage
  - Automated pipeline triggering for safe feedback loops
  - Automated gate approval for qualifying signals
  - Continuous operational health assessment

---

## 3. Information Flow Analysis

### 3.1 TIAGO's Information Sources

| Source | Type | Richness | Latency | Authority |
|--------|------|----------|---------|-----------|
| Wes's messages | Natural language | Very high (intent, corrections, priorities, domain knowledge) | Real-time | Primary (architect) |
| Local filesystem | Source code, configs, tests | Complete (all files) | Instant | Primary (ground truth) |
| Git history | Commits, branches, diffs | Complete history | Instant | Primary |
| Claude Code tools | Bash, Read, Edit, Write, Agent | Full development toolkit | Seconds | Tool-mediated |
| HTTP APIs | Gateway, GitHub REST | Structured responses | Seconds | Remote |
| MEMORY.md files | Accumulated lessons, decisions, preferences | Curated summaries | Instant (local files) | Supporting (lossy) |
| Skill files | PAI Algorithm, domain skills, protocols | Procedural knowledge | Instant (local files) | Binding (constitutional) |
| Session transcript | Conversation history | Rich (multi-hour context) | In-memory | Ephemeral |

### 3.2 GovernorAgent's Information Sources

| Source | Type | Richness | Latency | Authority |
|--------|------|----------|---------|-----------|
| ArangoDB queries | Telemetry, signals, pipelines, memory, config | Structured, bounded (8 queries, specific LIMIT/FILTER) | Seconds | Primary (Factory state) |
| Queue messages | Event triggers (feedback-complete) | Minimal (trigger type + timestamp) | Instant (internal) | Primary |
| Cron schedule | Time triggers | None (time only) | 15-minute intervals | Trigger |
| LLM (kimi-k2.6) | Assessment reasoning | Single-shot, 16K input | Seconds | Derived (assessment) |

### 3.3 Information TIAGO Has That GovernorAgent Will NOT Have

| Information | Impact of Loss | Severity |
|-------------|----------------|----------|
| **Wes's intent in natural language** | Cannot understand WHY something should be done, only WHAT telemetry shows. Cannot receive strategic direction. Cannot incorporate business context, priorities, or "actually, I meant X not Y." | CRITICAL |
| **Source code** | Cannot correlate telemetry failures to specific code paths. Cannot understand what a pipeline failure means at the code level. Cannot diagnose root causes that require reading implementation. | CRITICAL |
| **Git history and diffs** | Cannot see what changed between deployments. Cannot correlate regressions to specific commits. | HIGH |
| **Test results** | Cannot run tests to validate hypotheses. Cannot confirm whether a fix actually works before triggering retry. | HIGH |
| **Shell tooling** | Cannot deploy, cannot run arbitrary diagnostics, cannot use gh CLI for rich GitHub interactions. | HIGH |
| **Sub-agent perspectives** | Cannot get Architect review of its own decisions. Cannot get SE analysis of systemic issues. Cannot get specialized domain reasoning. | HIGH |
| **Multi-turn reasoning** | Limited to single LLM invocation. Cannot iteratively refine understanding. Cannot say "wait, that doesn't make sense, let me re-examine." | MEDIUM |
| **Session context** | Each cycle starts fresh. Cannot carry forward observations from 15 minutes ago unless they were written to ArangoDB. Pattern recognition across cycles is limited to what AQL queries return. | MEDIUM |
| **Correction feedback loop** | When the GovernorAgent makes a wrong assessment, there is no mechanism for Wes to say "no, that's wrong because X." The GovernorAgent will repeat the same mistake next cycle. | CRITICAL |
| **PAI Algorithm** | No 7-phase reasoning structure. No ISC criteria. No hill-climbing. No thinking tools. The GovernorAgent's reasoning is unstructured single-shot. | MEDIUM |

### 3.4 Information GovernorAgent Has That TIAGO Does NOT Have

| Information | Benefit | Significance |
|-------------|---------|--------------|
| **Internal Cloudflare observability** | Can potentially see Worker metrics, Queue depth, DO state that TIAGO cannot access via HTTP | HIGH |
| **Continuous 24/7 coverage** | Sees signals as they arrive, not hours later when Wes opens a session | HIGH |
| **Same-environment execution** | No network hop to query ArangoDB; direct Cloudflare internal access | MEDIUM |
| **Structured governance telemetry** | Produces its own telemetry (governance cycles, decisions, assessments) that compounds over time | MEDIUM |

### 3.5 Net Information Position

TIAGO has access to approximately 10 rich information channels.
GovernorAgent has access to 4 channels, all structured/database-mediated.

The GovernorAgent trades information richness for temporal coverage.
TIAGO sees deeply but intermittently. GovernorAgent sees narrowly but
continuously. Neither alone provides complete governance.

---

## 4. Capability Gap Matrix

| # | TIAGO Capability | GovernorAgent Equivalent | Gap | Impact | Mitigation |
|---|-----------------|------------------------|-----|--------|------------|
| 1 | Read source code (full repo) | Cannot read source | TOTAL | Cannot diagnose code-level root causes. Cannot verify implementations match specs. | GovernorAgent escalates code-level issues. TIAGO handles in next session. |
| 2 | Write/edit source code | Cannot write code | TOTAL (by design) | Cannot fix anything. Cannot implement anything. | GovernorAgent's scope excludes code. Correct design boundary. |
| 3 | Run tests (vitest, bun test) | Cannot run tests | TOTAL | Cannot validate fixes. Cannot regression-test before re-triggering. | Tests run inside pipeline (CoderAgent/TesterAgent). GovernorAgent observes results via ArangoDB. |
| 4 | Deploy via wrangler | Cannot deploy | TOTAL (by design) | Cannot push code changes to Cloudflare. | Deployment requires human session. Correct governance constraint. |
| 5 | Spawn sub-agents (Architect, Engineer, SE, QA) | Single-agent, single-invocation | TOTAL | No multi-perspective reasoning. No specialized domain analysis. No independent review of its own decisions. | Phase 3 of evolution path adds multi-agent delegation. Currently absent. |
| 6 | Read Wes's intent in natural language | None | TOTAL | Cannot understand strategic direction. Makes decisions based only on telemetry, not intent. | GovernorAgent operates within narrow deterministic criteria. Strategic intent stays with TIAGO. |
| 7 | Respond to corrections ("not that, do this") | None | TOTAL | Cannot learn from real-time feedback. Will repeat mistakes until criteria are manually adjusted. | Human overrides via hot_config or criteria code changes. Slow feedback loop. |
| 8 | Create GitHub PRs via gh CLI | Escalation via GitHub REST (issues only, not PRs) | PARTIAL | Cannot create PRs for fixes. Can create issues for human attention. PR creation is handled by Factory's feedback pipeline separately. | Factory already creates PRs autonomously. GovernorAgent creates issues for escalation. Different tools for different purposes. |
| 9 | Maintain session context (hours) | 16K tokens, single invocation | MAJOR | Cannot build understanding over time within a session. Cannot cross-reference earlier observations in same work session. | Each cycle is 120 seconds. Understanding is ArangoDB-mediated across cycles, not conversation-mediated. |
| 10 | Save lessons/feedback to MEMORY.md | Writes assessments to ArangoDB orientation_assessments | DIFFERENT | Knowledge compounds in ArangoDB, not in MEMORY.md. TIAGO and GovernorAgent maintain separate knowledge stores. | Bridge needed: TIAGO reads GovernorAgent's assessments from ArangoDB. GovernorAgent reads memory_curated. Two-way but lossy. |
| 11 | Apply PAI Algorithm (7 phases, ISC, thinking tools) | Single-shot LLM with system prompt | TOTAL | No structured reasoning methodology. No verifiable criteria. No hill-climbing toward ideal state. | GovernorAgent's system prompt provides governance-specific structure. Not PAI but not unstructured. Fit for purpose (operational triage, not deep reasoning). |
| 12 | Multi-turn iterative refinement | Single LLM call | TOTAL | Cannot say "wait, let me reconsider." Cannot explore alternative interpretations. | Cycle brevity (120s) limits but focuses. Complex reasoning escalates to TIAGO. |
| 13 | Arbitrary HTTP diagnostics | ArangoDB queries only | MAJOR | Cannot curl arbitrary endpoints. Cannot test connectivity. Cannot probe edge cases. | GovernorAgent's observability is ArangoDB-mediated. Add new queries for new observability needs. |
| 14 | 24/7 availability | 24/7 by default | TIAGO LACKS | TIAGO is offline 12-20 hours/day. Signals age. Feedback loops stall. | GovernorAgent solves this completely. Primary value proposition. |
| 15 | Internal CF observability | Same environment as Factory | TIAGO LACKS | TIAGO cannot see Worker logs, Queue state, DO internals. | GovernorAgent's AQL queries provide structured visibility. Not full log access but better than TIAGO's HTTP-only view. |

---

## 5. Risk Assessment (TRM Six Questions)

### Risk 1: Loss of Natural Language Understanding of Wes's Intent

**What can go wrong?** The GovernorAgent operates without understanding
Wes's priorities, strategic direction, or contextual reasoning. It makes
operational decisions based purely on telemetry patterns and codified
criteria, missing the "why" behind Wes's architectural choices.

**Likelihood:** Certain (by design -- the GovernorAgent has no human
interaction channel).

**Impact:** MEDIUM. Mitigated because the GovernorAgent's action space is
constrained to operational triage (trigger safe retries, archive stale
signals, escalate unknowns). It is not making strategic decisions. When
something requires intent-understanding, it escalates.

**Mitigation:** Deterministic criteria gates prevent the GovernorAgent from
making intent-dependent decisions. Hot_config allows Wes to adjust
GovernorAgent behavior between sessions. Escalation via GitHub issues
brings Wes into the loop for anything non-routine.

**Residual risk:** LOW. The GovernorAgent may over-escalate (false
positives) because it cannot distinguish "Wes would obviously approve
this" from "Wes needs to see this." This is the correct failure mode --
fail-safe rather than fail-dangerous.

---

### Risk 2: Loss of Codebase Access

**What can go wrong?** The GovernorAgent detects telemetry anomalies but
cannot correlate them to specific code paths. When ORL success rates drop,
it cannot read the code to understand whether the problem is a prompt
issue, a schema issue, a model issue, or a code bug.

**Likelihood:** HIGH (inevitable for code-level failures).

**Impact:** MEDIUM. The GovernorAgent's response to code-level issues is
always "escalate." It does not attempt code-level diagnosis. The impact
is diagnostic delay, not incorrect action.

**Mitigation:** The GovernorAgent's `diagnose_failure` action writes
diagnostic assessments to ArangoDB with available evidence. When TIAGO
starts the next session, it can read these assessments and begin
code-level investigation with context already gathered.

**Residual risk:** MEDIUM. The diagnostic delay (up to hours) means
code-level issues compound. A broken pipeline keeps creating failing
runs until Wes investigates. The feedback loop depth limit (max 3) and
cooldown (30 min) prevent runaway, but the underlying issue persists.

---

### Risk 3: Loss of Sub-Agent Orchestration

**What can go wrong?** TIAGO coordinates multiple specialized agents
(Architect, Engineer, SE, QA) in parallel swarms. The GovernorAgent
operates as a single agent with a single LLM invocation. It cannot get
a second opinion, cannot validate its own reasoning, and cannot delegate
diagnostic sub-tasks.

**Likelihood:** Certain (by design -- Phase 1 is single-agent).

**Impact:** LOW for operational triage (the GovernorAgent's primary job).
HIGH for diagnostic tasks (where multiple perspectives would help).

**Mitigation:** Phase 3 of the evolution path adds multi-agent delegation
(DriftDiagnosisAgent, ContractHealthAgent as sub-agents of Governor).
Currently, the GovernorAgent's decisions are validated by deterministic
criteria gates, not by sub-agent review.

**Residual risk:** MEDIUM. Single-agent reasoning is more prone to
systematic bias. The deterministic gates catch criteria-violating
decisions but do not catch reasoning errors within criteria bounds.

---

### Risk 4: Loss of Correction Feedback Loop

**What can go wrong?** When TIAGO makes a mistake, Wes says "no, do X
instead" and TIAGO adjusts immediately. The GovernorAgent has no such
mechanism. If it misjudges a signal's severity, over-escalates, or
under-escalates, the error repeats every 15 minutes until someone
changes the code or criteria.

**Likelihood:** HIGH (GovernorAgent will make wrong assessments; all
LLM-based systems do).

**Impact:** MEDIUM for false positives (noisy GitHub issues that Wes
ignores). HIGH for false negatives (missed escalations where GovernorAgent
incorrectly classifies something as safe).

**Mitigation:** The evolution_contract tracks human_override_frequency.
If Wes frequently overrides GovernorAgent decisions, this becomes an
evolution signal. Phase 4 (Self-Tuning) allows threshold adjustment based
on override patterns. Currently, corrections require code changes to
criteria functions.

**Residual risk:** HIGH. The correction loop is orders of magnitude
slower than TIAGO's real-time correction. TIAGO adjusts in seconds.
GovernorAgent adjusts via code deploy (hours to days). This is the most
significant operational risk.

---

### Risk 5: Loss of Session Context

**What can go wrong?** TIAGO builds understanding over a multi-hour
session. It sees a failing test, reads the code, tries a fix, sees the
fix fail differently, and eventually converges on the root cause. The
GovernorAgent sees telemetry snapshots every 15 minutes with no memory
of what it concluded 15 minutes ago (except what it wrote to ArangoDB).

**Likelihood:** Certain.

**Impact:** LOW for routine operations (each governance cycle is
independent by design). MEDIUM for trend analysis (the GovernorAgent
relies on AQL aggregation, not conversational memory, for trends).

**Mitigation:** The GovernorAgent's 7-day lookback queries provide
aggregate trend data. Individual cycle assessments are persisted to
orientation_assessments, creating a queryable history. The GovernorAgent
does not need conversational memory for its operational scope.

**Residual risk:** LOW. This is a design choice, not a gap. The
GovernorAgent is not trying to be a conversational partner. Its
stateless-per-cycle design is appropriate for its scope.

---

### Risk 6: 24/7 Availability vs Quality Trade-off

**What can go wrong?** The GovernorAgent runs 96 times per day but with
much less cognitive depth per cycle than TIAGO brings to a single session.
Quantity of governance cycles may not compensate for quality of governance
reasoning. The Factory gets continuous but shallow oversight instead of
intermittent but deep oversight.

**Likelihood:** Certain (this is the fundamental trade-off of the design).

**Impact:** MEDIUM. The GovernorAgent's quality floor is set by
deterministic criteria gates, not by LLM reasoning quality. Bad
LLM reasoning leads to "no_action" (safe) or "escalate_to_human" (safe),
not to incorrect autonomous action.

**Mitigation:** The deterministic action gate (Section 10.4 of the design)
is the critical safety mechanism. The LLM proposes, the code validates.
This means LLM quality affects diagnostic accuracy and assessment
quality but not action safety.

**Residual risk:** LOW for safety. MEDIUM for effectiveness (the
GovernorAgent may miss opportunities that TIAGO would have caught through
deeper reasoning). Over time, as memory_curated accumulates patterns,
the GovernorAgent's context improves.

---

## 6. Architecture Recommendations

### 6.1 What MUST Stay with TIAGO (Irreplaceable Capabilities)

1. **Architecture decision-making** -- requires Wes's gate, natural
   language dialogue, multi-perspective analysis (Council, Architect agent).
   No automated replacement exists.

2. **Code-level root cause diagnosis** -- requires reading source code,
   understanding implementation, correlating telemetry to code paths.
   GovernorAgent cannot do this.

3. **Development execution** -- writing code, running tests, deploying.
   The GovernorAgent is correctly excluded from this.

4. **Strategic prioritization** -- deciding WHAT to build next, in what
   order, with what trade-offs. Requires Wes's business context and
   architectural vision.

5. **Correction and learning** -- real-time feedback ("not that, do this")
   that adjusts TIAGO's behavior within a session. No GovernorAgent
   equivalent exists.

6. **Multi-agent orchestration for complex tasks** -- spawning Architect +
   Engineer + QA swarms for implementation work. GovernorAgent is
   single-agent.

7. **PAI Algorithm execution** -- the 7-phase structured reasoning
   methodology with ISC criteria, thinking tools, and capability
   selection. This is TIAGO's cognitive operating system and has no
   GovernorAgent equivalent.

### 6.2 What CAN Move to GovernorAgent (Operational Tasks)

1. **Signal triage** -- reviewing pending signals, prioritizing by
   severity/age, deduplicating, archiving stale signals. This is
   GovernorAgent's primary function and it does this well.

2. **Safe pipeline triggering** -- re-triggering feedback-generated
   signals that meet auto-trigger criteria. This is the 24/7 value
   proposition.

3. **Safe gate approval** -- auto-approving qualifying signals at
   architect-approval gates. Eliminates the bottleneck of Wes being
   unavailable.

4. **Operational health monitoring** -- continuous assessment of ORL
   success rates, pipeline failure rates, stale signal counts. Better
   than TIAGO's periodic manual checks.

5. **Escalation** -- detecting conditions that require human attention
   and filing GitHub issues with evidence. Replaces TIAGO's manual
   observation of problems.

6. **Governance telemetry** -- producing its own observability data
   (cycle results, assessments, metrics snapshots) that TIAGO can
   review in the next session.

### 6.3 What Needs a NEW System (Neither TIAGO nor GovernorAgent)

1. **Diagnostic Bridge** -- a mechanism for the GovernorAgent to
   request deeper analysis from a more capable agent when it detects
   anomalies it cannot diagnose. This is Phase 3 of the evolution path
   (Multi-Agent Governor) but is not designed yet. The current design
   has no intermediate step between "single-shot LLM assessment" and
   "escalate to human via GitHub issue."

2. **Bi-directional Memory Synchronization** -- TIAGO writes to MEMORY.md
   files, GovernorAgent writes to ArangoDB. Neither reads the other's
   primary store. A sync mechanism is needed so:
   - GovernorAgent's assessments are available as TIAGO's session context
   - TIAGO's lessons and corrections update GovernorAgent's criteria

3. **Correction Loop** -- when Wes overrides a GovernorAgent decision
   (e.g., approves something GovernorAgent escalated, or rejects
   something GovernorAgent triggered), that override must feed back into
   GovernorAgent's criteria. Currently, this requires a code change.
   Phase 4 (Self-Tuning) addresses this but is not yet designed.

4. **Dashboard / Reporting** -- TIAGO's "debrief Wes on last session"
   function has no GovernorAgent equivalent. Wes currently learns what
   happened overnight by reading TIAGO's debrief. With GovernorAgent
   running 24/7, there should be a summary mechanism (daily digest,
   dashboard, or structured report) that Wes can review without starting
   a TIAGO session.

### 6.4 Right Division of Labor in Steady State

```
Wes (Architect)
  |
  |-- Architectural decisions, strategic priorities, business context
  |
  v
TIAGO (Governor-in-Chief, session-bound)
  |
  |-- Deep reasoning (PAI Algorithm, multi-agent, multi-turn)
  |-- Code-level diagnosis and implementation orchestration
  |-- MEMORY.md maintenance and session continuity
  |-- Reads GovernorAgent's overnight assessments at session start
  |-- Adjusts GovernorAgent criteria based on accumulated corrections
  |-- Handles all GovernorAgent escalations that require code/architecture
  |
  v
GovernorAgent (Operations Officer, 24/7)
  |
  |-- Continuous signal triage and operational health monitoring
  |-- Auto-trigger safe feedback pipeline retries
  |-- Auto-approve qualifying gate signals
  |-- Escalate anomalies via GitHub issues
  |-- Produce governance telemetry for TIAGO's next session
  |-- Archive stale signals, deduplicate, manage backlog hygiene
  |
  v
Factory Pipeline (Autonomous Execution)
  |
  |-- Multi-stage pipeline execution (LLM calls, synthesis, testing)
  |-- Feedback signal generation
  |-- PR creation
  |-- Memory curation
```

This is a **three-tier governance model**:
- **Wes** for architectural authority
- **TIAGO** for cognitive reasoning and development orchestration
- **GovernorAgent** for 24/7 operational automation

The GovernorAgent does NOT replace TIAGO. It sits below TIAGO in the
authority hierarchy, handling the operational tasks that do not require
TIAGO's cognitive depth but do require continuous execution.

---

## 7. The Hard Question

### What TIAGO Actually Is

TIAGO is not one system. TIAGO is five systems fused into a single
runtime by the constraint of running inside Claude Code:

| System | Function | % of TIAGO's Value |
|--------|----------|-------------------|
| **Reasoning System** | PAI Algorithm, 7 phases, ISC criteria, thinking tools (Council, RedTeam, FirstPrinciples), multi-turn iterative refinement | ~30% |
| **Orchestration System** | Spawn Architect, Engineer, SE, QA agents in parallel swarms. Coordinate, synthesize, gate. | ~25% |
| **Memory System** | MEMORY.md read/write, session continuity, lesson extraction, correction accumulation, cold start recovery | ~15% |
| **Communication System** | Natural language dialogue with Wes, voice notifications, intent clarification, correction reception, decision presentation | ~15% |
| **Development System** | Source code read/write, test execution, wrangler deploy, gh CLI, git operations, shell tooling | ~15% |

### What the GovernorAgent Replaces

The GovernorAgent replaces **a subset of the Orchestration System's
operational monitoring function**. Specifically:

- Signal triage (from Orchestration)
- Pipeline triggering (from Orchestration)
- Gate approval (from Orchestration)
- Health monitoring (from Orchestration)
- Escalation (from Orchestration + Communication, but write-only)

This is approximately **20-25%** of what TIAGO does, and only the
operational automation slice.

### What Happens to the Other 4 Systems

| System | Post-GovernorAgent State | Status |
|--------|-------------------------|--------|
| **Reasoning System** | Stays with TIAGO. No proposed replacement. PAI Algorithm, thinking tools, multi-turn reasoning remain session-bound. | UNCHANGED |
| **Orchestration System** | Split. Operational monitoring moves to GovernorAgent. Strategic orchestration (agent spawning, development coordination) stays with TIAGO. | PARTIALLY ADDRESSED |
| **Memory System** | Stays with TIAGO. GovernorAgent has its own ArangoDB-based memory but does not replace MEMORY.md. A synchronization gap exists. | UNCHANGED (gap created) |
| **Communication System** | Stays with TIAGO. GovernorAgent has write-only escalation (GitHub issues) but no dialogue capability. Wes must start a TIAGO session to discuss GovernorAgent findings. | UNCHANGED |
| **Development System** | Stays with TIAGO entirely. GovernorAgent cannot read code, write code, run tests, or deploy. | UNCHANGED |

### The Architectural Truth

The GovernorAgent is not a TIAGO replacement. It is a **TIAGO
augmentation** that extends TIAGO's availability from ~8 hours/day to
24 hours/day for a narrow operational scope.

In steady state, the system is TIAGO + GovernorAgent, not GovernorAgent
instead of TIAGO. TIAGO remains the primary governance system. The
GovernorAgent keeps the lights on between TIAGO sessions.

This is the correct framing:

- **Without GovernorAgent:** Factory runs when Wes works. Signals age
  overnight. Feedback loops stall for 12-16 hours. TIAGO spends first
  30 minutes of each session triaging overnight backlog.

- **With GovernorAgent:** Factory runs continuously. Safe retries happen
  automatically. Stale signals get archived. Wes wakes up to a clean
  backlog and a governance assessment. TIAGO can focus on deep work
  instead of operational triage.

The GovernorAgent's value is not in replacing TIAGO's intelligence.
It is in **eliminating the overnight gap** that makes the Factory
intermittent.

---

## 8. Formal Assessment: Transition Readiness

### 8.1 Readiness Verdict

**The GovernorAgent design is ready for implementation with the
following understanding:**

1. It replaces 20-25% of TIAGO's functional surface.
2. It replaces the correct 20-25% -- the part that suffers most from
   being session-bound.
3. It does NOT replace TIAGO. TIAGO continues as the primary governance
   system.
4. The deterministic action gate is the critical safety mechanism and
   is well-designed.
5. The escalation criteria are conservative (fail-safe).

### 8.2 Pre-Implementation Requirements

1. **Memory Bridge Design:** Before GovernorAgent goes live, define how
   TIAGO reads GovernorAgent assessments at session start. Currently,
   TIAGO's session init reads MEMORY.md. It should also read recent
   `orientation_assessments` from ArangoDB via gateway.

2. **Correction Pipeline Design:** Define how Wes's overrides of
   GovernorAgent decisions feed back into criteria. Phase 4 addresses
   this but is not designed. At minimum, a manual process should be
   documented (Wes adjusts hot_config or criteria code).

3. **Escalation Channel Validation:** Verify that GitHub issue creation
   via the GovernorAgent's `GITHUB_TOKEN` is correctly scoped. The
   Factory already has its own GITHUB_TOKEN for PR creation. GovernorAgent
   may need a separate token or verified permissions for issue creation.

4. **Observability Baseline:** Before GovernorAgent goes live, establish
   baseline metrics for the governance health indicators it will monitor
   (ORL success rates, pipeline failure rates, signal backlog depth).
   Without baselines, the GovernorAgent cannot detect degradation.

### 8.3 Post-Implementation Validation

1. **Dry-run period:** Run GovernorAgent with `dryRun: true` for 1-2
   weeks. It produces assessments and decisions but does not execute
   them. TIAGO reviews the decisions to validate criteria correctness.

2. **Escalation calibration:** Track false_escalation_rate and
   missed_escalation_rate. If false escalation exceeds 10%, widen
   auto-action criteria. If missed escalation occurs, narrow them.

3. **Overnight value test:** After 1 week of live operation, compare
   Wes's first-session-of-day experience. Is the backlog smaller?
   Are assessments useful? Is TIAGO spending less time on triage?

---

## 9. Recommendations Summary

| Priority | Recommendation | Rationale |
|----------|---------------|-----------|
| P0 | Implement GovernorAgent as designed | Solves the 24/7 availability gap for operational triage |
| P0 | Design the Memory Bridge (TIAGO reads GovernorAgent assessments) | Without this, the two governance systems are disconnected |
| P1 | Establish observability baselines before go-live | GovernorAgent needs reference points to detect degradation |
| P1 | Plan dry-run period (1-2 weeks, dryRun=true) | Validate criteria before autonomous execution |
| P2 | Design correction pipeline (Wes override -> criteria adjustment) | Currently requires code deploy; needs faster feedback loop |
| P2 | Design daily digest (GovernorAgent summary for Wes) | Replace TIAGO's debrief function for overnight activity |
| P3 | Design Phase 3 multi-agent diagnostic delegation | Single-agent reasoning is a known limitation for complex diagnosis |
| P3 | Design Phase 4 self-tuning threshold adjustment | Addresses the correction feedback loop gap systematically |

---

## 10. Decision Algebra Alignment

Mapping this assessment to the Ontology's Decision Algebra:

```
D = <I, C, P, E, A, X, O, J, T>

I (Intent)         = Determine whether GovernorAgent adequately replaces
                     TIAGO's governance functions
C (Context)        = Full TIAGO/PAI system docs, GovernorAgent design,
                     Orientation Ontology, ARCHITECTURE-TIAGO-FACTORY-INTERACTION
P (Policy)         = SE methodology (Sage & Rouse), AGENTS.md role boundaries,
                     GUV operating rules, PAI constitutional principles
E (Evidence)       = Functional decomposition (9 TIAGO functions mapped),
                     Capability Gap Matrix (15 capabilities compared),
                     Information Flow Analysis (10 TIAGO sources vs 4 GovernorAgent)
A (Authority)      = Architect Agent (SE role), pending Wes's review
X (Action)         = SE Gap Analysis document with recommendations
O (Outcome)        = GovernorAgent replaces 20-25% of TIAGO, correct scope,
                     proceed with implementation + 4 identified gaps to address
J (Justification)  = GovernorAgent solves the right problem (24/7 availability)
                     without overreaching into capabilities it cannot safely handle
T (Time)           = 2026-04-29, bootstrap phase, pre-implementation assessment
```

---

## Appendix A: TIAGO's Five Systems Decomposition

```
TIAGO (Claude Code on Wes's MacBook)
|
+-- REASONING SYSTEM
|   |-- PAI Algorithm (7 phases)
|   |-- ISC Criteria (hill-climbing)
|   |-- Thinking Tools (Council, RedTeam, FirstPrinciples, Science, BeCreative)
|   |-- Multi-turn iterative refinement
|   |-- ~200K token context window
|   +-- Cross-domain pattern matching
|
+-- ORCHESTRATION SYSTEM
|   |-- Agent spawning (Architect, Engineer, SE, QA, Researcher)
|   |-- Parallel swarm coordination (SWARM IS DEFAULT)
|   |-- Pipeline triggering (curl POST /pipeline)
|   |-- Gate approval (curl POST /approve/:id)
|   |-- Result monitoring (curl GET /pipeline/:id)
|   +-- Backlog management (signal triage, dedup, archive)
|       ^
|       |-- THIS is what GovernorAgent replaces (partially)
|
+-- MEMORY SYSTEM
|   |-- MEMORY.md index + per-topic files
|   |-- WORKSPACE.md (current task state)
|   |-- LESSONS.md (accumulated patterns)
|   |-- DECISIONS.md (architectural choices)
|   |-- PREFERENCES.md (stable conventions)
|   |-- Session handoff files
|   |-- AGENT_LEARNINGS.jsonl (action log)
|   +-- COMPOUNDS OVER EPHEMERAL (save substantive analysis)
|
+-- COMMUNICATION SYSTEM
|   |-- Natural language dialogue with Wes
|   |-- Voice notifications
|   |-- PAI-formatted responses
|   |-- BE THE BRAIN (anticipate needs)
|   |-- BE EXPLICIT ABOUT WHAT YOU NEED (lead with blockers)
|   |-- Decision presentation (options, tradeoffs, recommendations)
|   +-- Correction reception ("not that, do this")
|
+-- DEVELOPMENT SYSTEM
    |-- Source code read/write (full filesystem)
    |-- Test execution (vitest, bun test)
    |-- Deployment (wrangler deploy)
    |-- GitHub operations (gh CLI)
    |-- Git operations (commit, branch, diff)
    |-- Secret management (wrangler secret put)
    +-- Shell tooling (arbitrary bun/node/curl commands)
```

---

## Appendix B: Information Flow Diagram (Steady State)

```
Wes (Architect)
  |
  | Natural language intent, corrections, architecture gates
  |
  v
TIAGO (Governor-in-Chief)
  |
  |-- Reads GovernorAgent assessments from ArangoDB (session start)
  |-- Adjusts GovernorAgent criteria (code changes, hot_config)
  |-- Handles GovernorAgent escalations (GitHub issues)
  |-- Deep diagnosis + implementation orchestration
  |-- Writes MEMORY.md (session state, lessons, decisions)
  |
  v                                        v
Development                            GovernorAgent (24/7 Operations)
  |                                        |
  |-- Source code changes                  |-- Reads ArangoDB (8 queries/cycle)
  |-- Test execution                       |-- Signal triage + dedup + archive
  |-- wrangler deploy                      |-- Auto-trigger safe pipelines
  |-- gh pr create                         |-- Auto-approve qualifying gates
  |-- git commit                           |-- Escalate via GitHub issues
  |                                        |-- Write governance telemetry
  v                                        |
Factory Pipeline                           |
  |                                        |
  |-- Autonomous execution                 |
  |-- ArangoDB writes                <-----|-- Reads pipeline results
  |-- Feedback signals               ----->|-- Reads pending signals
  |-- PR generation                        |
  |-- Memory curation                ----->|-- Reads curated memory
  v
ArangoDB (Shared State)
```

---

*This assessment was produced by the Architect Agent in the Systems Engineer
role. All findings are based on analysis of the authoritative source
documents listed in the header. No claims are made about runtime behavior
without citation to the relevant design document.*
