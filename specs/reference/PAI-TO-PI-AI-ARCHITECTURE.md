# PAI-to-pi-ai Architecture: Porting the Cognitive Swarm to the Autonomous Factory

**Author:** Architect Agent for Wislet J. Celestin / Koales.ai
**Date:** 2026-04-26
**Status:** Proposed. Requires Architect approval before DECISIONS.md entry.
**Lineage:** PHASE5-PI-SDK-SPEC-v3.md, PIPELINE-SEMANTIC-GROUNDING.md,
FULL-PI-DEPLOYMENT-ARCHITECTURE.md, SDLC-ARCHITECTURE.md,
SASE paper (Hassan et al., arXiv:2509.06216v1 SS5.1-5.4),
DECISIONS.md (2026-04-24: Stage 6 topology is hybrid with pluggable
binding modes; semantic-alignment via Critic role; crystallization-from-
execution), ADR-003 (pi SDK default executor, amended by v3 spec),
project_phase5_pai_swarm.md (Phase 5 scope expansion).

---

## 0. The Problem

The PAI swarm (Claude Code sessions with loaded context) produces good work
because each agent has: institutional memory (DECISIONS.md, LESSONS.md),
codebase access, authority documents, MentorScript rules, and session-to-
session continuity via memory files. The Factory pipeline produces
hallucinated garbage because each stage gets a 1-paragraph prompt and the
previous stage's thin JSON (PIPELINE-SEMANTIC-GROUNDING SS1).

The fix is not "add more context to prompts." The fix is: the autonomous
Factory must replicate the PAI swarm's cognitive architecture -- identity,
memory, skills, feedback -- inside pi-ai sessions running in CF Containers,
orchestrated by the Coordinator DO.

This document specifies how.

---

## 1. Agent Identity Model

### 1.1 One Session Per Role, Not Shared Sessions With Role Switching

Each Factory role (Architect, Coder, Critic, Tester, Verifier) is a
distinct `createAgentSession()` with role-specific system context. Shared
sessions with role switching are rejected for three reasons:

1. **Context pollution.** The Coder's tool call history pollutes the Critic's
   judgment. SASE SS5.2 specifies that agents should have specialized roles
   to limit context pollution and improve auditability.

2. **Tool gating.** The Coder has write/bash tools; the Critic has read-only
   tools. `customTools` in `createAgentSession()` enforces this per-session.
   Role switching within a single session cannot gate tools per-role without
   a custom wrapper that undermines pi SDK's tool management.

3. **Auditability.** Each session produces a distinct event stream via
   `session.subscribe()`. The SASE MRP (SS4.2.4) requires full audit trails
   per role. Interleaved sessions make it impossible to attribute tool calls
   to roles.

### 1.2 Role Identity via System Context

Each role gets a system prompt assembled from three layers:
- **Layer 1:** Constitutional identity (role name, SASE role contract) -- from `ROLE_CONTRACTS`
- **Layer 2:** Institutional memory (DECISIONS.md digest, LESSONS.md, MentorRules) -- loaded once per synthesis
- **Layer 3:** Task-specific context (BriefingScript, WorkGraph, specContent) -- varies per invocation

### 1.3 Role-to-PAI Agent Mapping

| Factory Role | PAI Agent | Execution Location | pi-ai API |
|---|---|---|---|
| Architect | Architect Agent | Container DO | `createAgentSession()` with read tools, codebase access |
| Planner | GUV Orchestrator | Coordinator DO | `getModel()` + `complete()` (structured JSON, no filesystem) |
| Coder | Engineer Agent | Container DO | `createAgentSession()` with write/bash/read tools |
| Critic | Critic Agent | Container DO or Coordinator DO | `createAgentSession()` (read-only) or `complete()` |
| Tester | QATester Agent | Container DO | `createAgentSession()` with bash/read tools |
| Verifier | GUV (decision) | Coordinator DO | `getModel()` + `complete()` (structured JSON verdict) |

**New role: Architect Agent.** This replaces Stages 2-4 (the telephone game
of Signal -> Pressure -> Capability -> FunctionProposal). The Architect
session receives the Signal + specContent + institutional memory and
produces a grounded BriefingScript directly. Lineage artifacts (Pressure,
Capability, FunctionProposal) are still emitted for graph completeness but
are extracted from the BriefingScript, not generated independently.

### 1.4 The Architect Agent Session Replaces Stages 2-4

The current pipeline runs three sequential LLM calls (synthesize-pressure,
map-capability, propose-function) each with a 1-paragraph prompt. Each call
loses fidelity. By Stage 4, the PRD is hallucinated from a Capability title
derived from a Pressure title derived from a Signal description.

The Architect Agent session replaces this with one agent that has:
- Full specContent (the referenced architectural document, inline)
- DECISIONS.md digest (what has already been decided)
- LESSONS.md (what mistakes not to repeat)
- Codebase access (via read tools in a Container, or via pre-loaded file
  snapshots for the Coordinator DO path)
- Active MentorScript rules

The Architect session produces a **BriefingScript** (SASE SS5.1) with six
sections: Goal and Why, What and Success Criteria, Architectural Context
(loaded DECISIONS, relevant codebase files, constraints), Strategic Advice
(approach, patterns, anti-patterns from LESSONS.md), Known Gotchas
(platform-specific warnings), and Validation Loop (test strategy). Plus
derived lineage artifacts (Pressure, Capability, PRD) extracted from the
BriefingScript content. Schema defined in Zod in `@factory/schemas`.

The pipeline changes from:

```
Signal -> LLM(Pressure) -> LLM(Capability) -> LLM(FunctionProposal) -> Critic -> Compiler
```

To:

```
Signal -> Architect Agent Session(full context) -> BriefingScript -> Critic -> Compiler
```

Lineage artifacts (Pressure, Capability, FunctionProposal) are extracted
from the BriefingScript's `derived*` fields and persisted to ArangoDB with
`derivationMode: "architect-extracted"`. The lineage graph is preserved.
The telephone game is eliminated.

---

## 2. Memory Porting

### 2.1 Where Memory Lives

Memory has two homes: **git** (the repository's `.agent/memory/` directory)
and **ArangoDB** (the `memory_*` collections). The division:

| Memory Layer | Git Location | ArangoDB Collection | Authority |
|---|---|---|---|
| Semantic: Decisions | `.agent/memory/semantic/DECISIONS.md` | `memory_semantic` (decisions) | Git is authoritative |
| Semantic: Lessons | `.agent/memory/semantic/LESSONS.md` | `memory_semantic` (lessons) | Git is authoritative |
| Personal: Preferences | `.agent/memory/personal/PREFERENCES.md` | `memory_personal` | Git is authoritative |
| Episodic: Agent learnings | `.agent/memory/episodic/AGENT_LEARNINGS.jsonl` | `memory_episodic` | ArangoDB is authoritative |
| Working: Workspace | `.agent/memory/working/WORKSPACE.md` | `memory_working` | Ephemeral (per-synthesis) |
| MentorScript rules | N/A (structured, not narrative) | `mentorscript_rules` | ArangoDB is authoritative |
| Skills | `.agent/skills/*/SKILL.md` | `agent_skills` (cached) | Git is authoritative |

**Rule:** Git-authoritative files are the source of truth. ArangoDB stores
queryable copies that are synced on deploy. ArangoDB-authoritative data
(episodic memory, MentorScript rules) is written by agents during execution
and never round-tripped to git (until the Dream DO promotes them).

### 2.2 Memory Loading at Session Start

Every pi-ai session receives institutional memory as part of its system
context (Layer 2 in SS1.2). The loading protocol:

```
1. Coordinator DO starts a synthesis run
2. Coordinator fetches memory digest from ArangoDB:
   a. DECISIONS.md digest: last 20 entries, sorted by date descending
   b. LESSONS.md: full content (small, <2KB)
   c. Active MentorScript rules: AQL query (status == 'active')
   d. Recent episodic events: last 10 entries for this Function's lineage
3. Memory digest is serialized as a single string block
4. Block is included in the system prompt for every role session
```

**Digest, not dump.** DECISIONS.md is 25K+ tokens. The Coordinator produces
a digest: last 20 entries + entries whose `source_refs` overlap with the
current WorkGraph's lineage chain, plus full LESSONS.md, active MentorScript
rules, and recent episodic events for related Functions. This is a
deterministic operation, not LLM-derived. Target: under 4K tokens.

### 2.3 Memory Writes During Execution

Agents write memory via a `factory_memory_write` custom tool that POSTs
back to the Coordinator DO via callback URL. Parameters: `layer`
(`episodic` or `working` only), `content`, `source_refs` (lineage).

**Constraint:** Agents write to `episodic` and `working` layers only.
Semantic memory (DECISIONS.md, LESSONS.md) and personal preferences are
written only by the Dream DO consolidation cycle or by the Architect
(human). This matches PAI's model.

### 2.4 Dream DO Consolidation With pi-ai

The Dream DO (FULL-PI-DEPLOYMENT-ARCHITECTURE SS2) runs on a schedule
(DO Alarm, daily or post-synthesis). Its job: promote episodic memories to
semantic memories, crystallize successful execution paths into new
MentorScript rules, and prune stale working memory.

The Dream DO uses a pi-ai `complete()` call (structured reasoning, no
filesystem needed) to:

1. **Review episodic entries** accumulated since last consolidation
2. **Identify promotable patterns:** "This lesson appeared in 3+ episodes"
3. **Propose new LESSONS.md entries** or MentorScript rules
4. **Write proposed entries** to ArangoDB with `status: 'proposed'`
5. **Notify the Architect** (via the ACE inbox, CRP artifact) for approval

The Dream DO does NOT auto-promote. Every semantic memory write requires
Architect approval (per the "memory writes as explicit, auditable tool
calls" decision, DECISIONS 2026-04-24). The Dream DO proposes; the
Architect approves; the approved entry is written to git-authoritative
files and synced to ArangoDB.

**Crystallization trigger:** After a synthesis run produces `verdict: pass`,
the Dream DO checks whether the execution path contains novel patterns not
already captured by existing MentorScript rules. If so, it proposes a new
rule with `source: 'crystallized'` and `source_refs` pointing to the
synthesis run's execution artifacts.

---

## 3. Skills Porting

### 3.1 Skills as Loaded System Context Fragments

PAI skills are `.agent/skills/*/SKILL.md` files with YAML frontmatter,
trigger phrases, and self-rewrite hooks. In the autonomous Factory, skills
serve the same purpose but are loaded differently:

| PAI Mechanism | pi-ai Mechanism |
|---|---|
| Skill file read from disk | Skill content loaded from ArangoDB `agent_skills` collection |
| Trigger phrase match | Role contract determines which skills load |
| YAML frontmatter parsed by harness | Structured fields in ArangoDB document |
| Self-rewrite hook fires on trigger | Crystallization proposes amendments via Dream DO |

**Skill loading is role-scoped.** Each role contract declares which skills
it needs:

```typescript
const ROLE_SKILL_MAP: Record<RoleName, string[]> = {
  architect: ['factory-meta', 'lineage-preservation', 'prd-compiler'],
  planner: ['factory-meta'],
  coder: ['lineage-preservation'],
  critic: ['coverage-gate-1', 'lineage-preservation', 'prd-compiler'],
  tester: [],
  verifier: ['factory-meta'],
}
```

The Coordinator loads the relevant skill contents from ArangoDB and includes
them in the role's system prompt. This is equivalent to PAI reading skill
files from disk, but queryable and cacheable.

### 3.2 Skill Self-Rewrite in Autonomous Mode

In PAI, a skill can fire a self-rewrite hook when downstream failure traces
back to a skill gap. In the autonomous Factory:

1. **Detection:** The Critic or Verifier identifies that a failure traces to
   a skill gap (e.g., the `coverage-gate-1` skill did not warn about a new
   category of PRD that fails Gate 1)
2. **Proposal:** The Dream DO proposes a skill amendment as a structured
   diff with `source: 'crystallized'` and a link to the failure's execution
   artifact
3. **Approval:** The Architect reviews the proposed amendment via CRP
4. **Application:** On approval, the ArangoDB `agent_skills` document is
   updated and the git-authoritative SKILL.md file is patched in the next PR

Skill self-rewrite is conservative by design. The Dream DO proposes; the
Architect approves. No autonomous skill mutation.

---

## 4. BriefingScript Generation (Architect Agent Session)

### 4.1 What the Architect Session Loads

1. **Signal content:** title, description, evidence, resolved specContent
2. **Institutional memory digest:** DECISIONS + LESSONS + MentorRules + recent episodes
3. **Codebase context** (if Container): git clone, read-only pi SDK tools
4. **Referenced specifications:** resolved from ArangoDB or inline

The output is the BriefingScript described in SS1.4, plus derived lineage
artifacts.

### 4.2 Execution Location

The Architect session runs in a **Container DO** when specContent is present
(needs codebase access to verify architectural claims). Falls back to
**Coordinator DO** (`complete()` call) when no specContent exists (generation
mode per PIPELINE-SEMANTIC-GROUNDING SS3.3). The Coordinator dispatches
via `runArchitectSession()` which checks specContent presence and routes
accordingly.

---

## 5. LoopScript Orchestration

### 5.1 The Coordinator DO IS the LoopScript Runtime

SASE SS5.2 defines the LoopScript as a declarative workflow definition. In
the Factory, the LoopScript is not a separate artifact -- it IS the
`buildSynthesisGraph()` function in `coordinator/graph.ts`. The StateGraph
(graph-runner.ts) is the LoopScript runtime.

The mapping:

| SASE LoopScript Concept | Factory Implementation |
|---|---|
| Task decomposition | `graph.addNode('planner', ...)` |
| Workflow strategy | `graph.addConditionalEdge('verifier', router)` |
| Budget constraints | `graph.addNode('budget-check', ...)` |
| Evidence-based acceptance | Verifier role's verdict: pass/patch/resample/interrupt/fail |
| N-version programming | Future: multiple Coder sessions in parallel |
| Human intervention point | CRP emitted, `waitForEvent('coach-resolution')` |

### 5.2 Graph Topology With Architect Session

The synthesis graph evolves from:

```
budget-check -> planner -> coder -> critic -> tester -> verifier -> [routing]
```

To:

```
budget-check -> architect -> semantic-critic -> compile -> gate-1
  -> planner -> coder -> code-critic -> tester -> verifier -> [routing]
```

The Architect node replaces the pipeline's Stages 2-4. The Critic runs
twice: semantic review (post-Architect, pre-compile) and code review
(post-Coder). Gate 1 runs deterministically inside the graph.

Conditional edges: `semantic-critic` exits to END on `miscast`. `gate-1`
exits to END on failure. `verifier` routes to `budget-check` on
`patch`/`resample`, to END on `pass`/`fail`/`interrupt`.

### 5.3 Human Coach Intervention (CRP Flow)

Any role can emit a CRP (Consultation Request Pack) when ambiguity exceeds
its confidence threshold. The CRP contains: question, context, urgency
(`blocking` or `advisory`), and suggestedResolution.

**Blocking CRP flow:** Role emits CRP -> Coordinator persists to
`crp_inbox` collection -> enqueues CRP event to Queue -> Pipeline Workflow
calls `waitForEvent('coach-resolution', { timeout: '7 days' })` -> Human
resolves via ACE (`POST /crp/:id/resolve`) producing a VCR (Version
Controlled Resolution) -> Workflow resumes with resolution in state.

**Advisory CRP flow:** Persisted to inbox, graph continues with
suggestedResolution, Architect reviews asynchronously.

This matches SASE SS5.4 (Agentic Guidance Engineering).

---

## 6. MentorScript Integration

### 6.1 Loading MentorScript Rules

The Coordinator DO already fetches MentorScript rules:

```typescript
// coordinator.ts lines 97-107 (existing)
fetchMentorRules: async () => {
  const db = this.getDb()
  return await db.query<{ ruleId: string; rule: string }>(
    `FOR r IN mentorscript_rules
       FILTER r.status == 'active'
       RETURN { ruleId: r._key, rule: r.rule }`,
  )
}
```

This query runs once per synthesis. The rules are included in:
1. The memory digest (Layer 2 context for all roles)
2. The Critic's system prompt (for compliance checking)
3. The Coder's system prompt (for proactive adherence)

### 6.2 How pi-ai Sessions Apply MentorScript Rules

Rules enter sessions as system context (not tools), formatted as a scoped
list. The Coder sees the rules; the Critic verifies compliance via the
existing `mentorRuleCompliance` array in `CritiqueReport` (`contracts.ts`
line 88). Non-compliance is a critique issue. If a rule conflicts with
task requirements, the role emits a CRP.

### 6.3 The Feedback Loop: Human Correction to MentorScript Rule

Human reviews synthesis result -> identifies correction -> creates
MentorRule via ACE (`POST /api/mentor-rules` with rule, scope, appliesTo,
source, source_refs) -> persisted to ArangoDB with `status: 'active'` ->
ALL future sessions load the rule -> Critic checks compliance.

For **inferred mentorship** (SASE SS5.3): when the Dream DO detects a
pattern in human corrections (same feedback 3+ times), it proposes a new
rule with `source: 'inferred'`. Architect approves or rejects.

---

## 7. Governance Model

### 7.1 Who Can Do What

| Actor | Decides | Cannot |
|---|---|---|
| **Human Architect** (via ACE) | Architecture gates, CRP resolutions, MentorScript approval, PR merge, priority | Write code (per GUV rules), auto-clear gates |
| **Coordinator DO** (GUV equivalent) | Task dispatch, role sequencing, budget enforcement, CRP routing, memory digest construction | Architecture decisions, MentorScript approval, PR merge |
| **Architect Agent** (pi-ai session) | BriefingScript content, derived lineage artifacts, architectural context selection | Architecture gates (proposes, does not clear) |
| **Coder Agent** (pi-ai session in Container) | Implementation code, test code, file modifications within fileScope | Architecture decisions, MentorScript writes, scope changes |
| **Critic Agent** (pi-ai session) | Semantic review verdict, code review verdict, MentorRule compliance | Code modification, architecture decisions |
| **Tester Agent** (pi-ai session in Container) | Test execution, coverage reporting | Code modification (read-only tools) |
| **Verifier Agent** (pi-ai in Coordinator DO) | Verdict: pass/patch/resample/interrupt/fail | Implementation, architecture |

### 7.2 Gate Ownership

| Gate | Owner | Mechanism |
|---|---|---|
| Gate 0: Signal acceptance | Human Architect | `waitForEvent('architect-approval')` in pipeline |
| Gate 0.5: Semantic alignment | Critic Agent (or Architect for bootstrap) | Semantic review verdict in graph |
| Gate 1: Compile coverage | Deterministic (no LLM) | `evaluateGate1()` in graph |
| Gate 2: Simulation coverage | Verifier Agent | Pass/fail verdict in graph |
| Gate 3: Assurance | Assurance DO (continuous) | DO Alarm schedule + detectors |
| Gate 4: Merge readiness | Human Architect | PR review + MRP audit |

---

## 8. Container Topology

### 8.1 Decision: Hybrid -- Architect Alone, Coder+Tester Shared

Three topology options were evaluated:

**(a) One Container per synthesis, all roles.**
Pro: shared filesystem, simple. Con: the Architect session runs before the
Coder needs a workspace. The Architect reads the codebase but does not
modify it. Running the Architect in the same Container as the Coder wastes
Container uptime while the semantic review and compilation run (no
filesystem access needed for those steps).

**(b) One Container per role.**
Pro: maximum isolation. Con: the Coder and Tester MUST share a workspace
(Tester runs tests against Coder's code, per PHASE5-PI-SDK-SPEC-v3 SS7).
Separate Containers for Coder and Tester would require copying the workspace
between Containers, which is fragile and slow.

**(c) Hybrid: Architect in its own Container, Coder+Tester share one.**
The Architect Container starts early, clones the repo, runs the Architect
session (read-only), and shuts down after producing the BriefingScript. The
Coder Container starts after Gate 1, clones the repo, runs Coder and Tester
sessions sequentially (shared workspace), and shuts down after the verdict.

**Decision: (c).** The Architect and Coder have different lifecycle
requirements. The Architect needs the codebase for context but does not
modify it. The Coder and Tester modify and test the same workspace. Sharing
a Container between Coder and Tester is architecturally correct (proven by
v3 spec SS7). Separating the Architect Container keeps Container uptime
aligned with actual compute need.

### 8.2 Container Lifecycle

```
Synthesis start:
  |
  +-- Architect Container starts (if specContent present)
  |     Clone repo (read-only), run Architect session
  |     Produce BriefingScript
  |     Container idles / shuts down
  |
  +-- Semantic Critic runs (Coordinator DO, no Container)
  +-- Compiler runs (Coordinator DO, no Container)
  +-- Gate 1 runs (Coordinator DO, no Container)
  |
  +-- Coder Container starts (after Gate 1 pass)
  |     Clone repo, create branch, install deps
  |     Run Coder session (write tools)
  |     Run Tester session (same workspace, bash tools)
  |     Container stays alive for repair loop
  |     Shut down after terminal verdict
```

### 8.3 Container Names

Deterministic names derived from the Coordinator DO's ID:

```typescript
private architectContainerName(): string {
  return `arch-${this.ctx.id.toString()}`
}
private coderContainerName(): string {
  return `code-${this.ctx.id.toString()}`
}
```

Each Container is a `FactoryAgent extends Container` instance (per v3 spec
SS2). The Coordinator calls `getContainer(env.FACTORY_AGENT, name).fetch()`
to communicate.

---

## 9. Context Loading Protocol

### 9.1 Context Assembly Pipeline

The Coordinator DO runs `assembleContext(role, state, deps)` before each
session, producing a `SessionContext` with: systemPrompt (Layers 1+2:
role contract + memory digest + skills + MentorRules), taskPrompt (Layer 3:
role-specific message from `buildRoleMessage()`), tools (role-specific
gating via `buildRoleTools()`), and optional `cwd` (Container workspace
path). Memory digest and skills are cached per synthesis run.

### 9.2 Context Size Budget

| Component | Estimated Tokens | Cacheable? |
|---|---|---|
| Role identity (system prompt) | 200-500 | Yes (static per role) |
| Memory digest (DECISIONS + LESSONS) | 2,000-4,000 | Yes (per synthesis run) |
| Skills (role-scoped) | 1,000-3,000 | Yes (per synthesis run) |
| MentorScript rules | 500-1,500 | Yes (per synthesis run) |
| specContent (Architect only) | 1,000-5,000 | No (varies per Signal) |
| WorkGraph + BriefingScript | 2,000-5,000 | No (varies per task) |
| **Total per session** | **7,000-19,000** | |

This fits comfortably within 128K+ context windows of models routed via
ofox.ai. The memory digest (Layers 2-3) is assembled once per synthesis
run and reused across all role sessions.

### 9.3 Codebase Context for Container Roles

Container roles (Architect, Coder, Tester) have filesystem access via pi
SDK tools. Workspace prepared by agent-server's `POST /workspace` endpoint
(clone, branch, install). Equivalent to PAI's Claude Code session access.

---

## 10. The Bootstrap Proof

### 10.1 What It Proves

The first successful Phase 5 synthesis run proves that the Factory can build
itself autonomously. Specifically:

1. A Signal about the Factory itself enters the pipeline
2. The Architect Agent (pi-ai session in Container) reads the Factory's
   codebase, DECISIONS.md, LESSONS.md, and the referenced spec
3. The Architect produces a grounded BriefingScript (not hallucinated)
4. The Critic validates semantic alignment against the spec
5. The compiler produces a WorkGraph from the BriefingScript's derived PRD
6. Gate 1 passes (structural coverage)
7. The Coder Agent (pi-ai session in Container) implements against the real
   codebase, using real tools (read/write/bash)
8. The Tester Agent runs real tests in the same Container
9. The Verifier issues a verdict
10. The result is a git diff the human Architect can review and merge

### 10.2 The First Bootstrap Signal

Same signal as PHASE5-PI-SDK-SPEC-v3 SS12.3: "Add GET /version to
ff-pipeline that returns `{ name, version, phase }`." Deliberately minimal.
The proof is not in the complexity of the change -- it is in the autonomy:
the Factory modifying itself through grounded reasoning rather than
hallucinated prompts.

### 10.3 Success Criteria for Bootstrap Proof

1. BriefingScript's `derivedPRD.acceptanceCriteria` are traceable to
   specContent passages (not hallucinated)
2. Semantic Critic verdict: `aligned` (not `miscast` or `uncertain`)
3. Gate 1: PASS
4. Coder produces a real git diff (not JSON code artifacts)
5. Tester runs real tests (vitest output, not simulated)
6. Verifier verdict: `pass`
7. The resulting PR, when reviewed by the human Architect, is merge-ready

---

## 11. Implementation Plan

### Phase A: Context Assembly (1 session, no new infrastructure)

- Build `assembleContext()` function in Coordinator DO
- Build `buildMemoryDigest()` -- fetch from ArangoDB, format as string
- Build `loadSkills()` -- fetch from ArangoDB `agent_skills` collection
- Seed `agent_skills` collection from git `.agent/skills/` files
- Tests: unit tests for digest assembly, skill loading

### Phase B: Architect Session (1 session, requires Container)

- Implement `architectSession()` graph node
- Implement BriefingScript schema (Zod in `@factory/schemas`)
- Modify `buildSynthesisGraph()` to include architect -> semantic-critic ->
  compile -> gate-1 flow before the existing planner -> coder -> ... flow
- Implement lineage artifact extraction from BriefingScript
- Tests: e2e test with dry-run Architect producing BriefingScript from
  a Signal with specContent

### Phase C: Container Integration (1 session, requires Phase 5 v3 Container)

- Implement Architect Container flow (read-only workspace, pi SDK session)
- Wire Coordinator DO to call Architect Container via
  `getContainer(env.FACTORY_AGENT, archName).fetch()`
- Implement memory-write callback from Container to Coordinator DO
- Tests: integration test with local Docker container

### Phase D: CRP/VCR Flow (1 session)

- Add `crp_inbox` ArangoDB collection
- Implement CRP detection in Coordinator DO (when role output contains
  `type: 'crp'`)
- Implement CRP -> Queue -> waitForEvent flow for blocking CRPs
- Add gateway API endpoints: `GET /api/crp`, `POST /api/crp/:id/resolve`
- Tests: e2e test with Critic emitting a blocking CRP

### Phase E: Dream DO With pi-ai (1 session)

- Implement Dream DO consolidation cycle
- Use pi-ai `complete()` for episodic review and pattern detection
- Implement crystallization proposal flow
- Wire DO Alarm for daily schedule
- Tests: unit test for consolidation logic

### Phase F: Bootstrap Proof (1 session)

- Submit the version-endpoint Signal through the full pipeline
- Verify all 7 success criteria from SS10.3
- If the proof passes: the Factory is autonomously building itself

---

## 12. Risk Register

| Risk | Severity | Mitigation |
|---|---|---|
| Memory digest exceeds context budget | Medium | Digest is capped at 4K tokens. Oldest entries pruned first. Lineage-relevant entries always included. |
| Architect session hallucinates despite loaded context | Medium | Semantic Critic with ground truth (specContent) catches hallucination. This is the defense-in-depth from PIPELINE-SEMANTIC-GROUNDING. |
| Container cold start delays synthesis | Medium | Architect Container starts while pipeline is still in Signal ingestion. Coder Container starts during compilation. Overlap reduces wall-clock time. |
| MentorScript rule conflicts | Low | `conflictsWith` field on MentorRule schema (SDLC-ARCHITECTURE SS2.1). Critic checks for conflicts. |
| Dream DO promotes incorrect patterns | Medium | Dream proposes, Architect approves. No auto-promotion. Proposed rules visible in ACE inbox. |
| CRP flow blocks synthesis indefinitely | Low | `waitForEvent` has a 7-day timeout. Expired CRPs produce an `interrupt` verdict. |
| pi-ai API surface changes | Medium | Pin `@mariozechner/pi-coding-agent@0.70.2`. Verify API surface before version bumps. |
| Skill content too large for system prompt | Low | Skills are role-scoped (3-5 skills per role, ~1K tokens each). Total skill budget: 5K tokens. |

---

## 13. What This Document Does NOT Specify

- **Stage 8 (PR creation via GitHub).** That is Phase 7 per PHASE5-PI-SDK-
  SPEC-v3 SS14. This document stops at "the result is a git diff."
- **N-version programming.** SASE SS5.2 describes multiple Coder sessions in
  parallel producing candidate implementations. The Factory supports this
  architecturally (the StateGraph can fork) but it is not specified here.
  Single-Coder is the v1 path.
- **ACE UI.** The Agent Command Environment (SASE SS4.3.1) is specified as
  API endpoints in the gateway Worker. A proper UI is out of scope.
- **Self-sensing Signals.** The Factory cannot yet sense its own operational
  state to generate Signals autonomously. Self-sensing is a Stage 7 concern.
- **Model selection strategy.** Which models to route each role to (via
  ofox.ai) is a runtime configuration concern, not an architectural one.
  The Coordinator DO's model-bridge handles this.

---

## 14. Relationship to Existing Decisions

| Decision | Relationship |
|---|---|
| Stage 6 topology is hybrid with pluggable binding modes (2026-04-24) | This spec implements the in-Factory binding mode with pi-ai sessions |
| Semantic-alignment review via Critic role (2026-04-24) | Unchanged -- Critic runs post-Architect, pre-compile |
| Crystallization from execution (2026-04-24) | Dream DO implements crystallization via pi-ai `complete()` |
| Memory writes as explicit tool calls (2026-04-24) | Container roles write memory via callback to Coordinator DO |
| ADR-003 amended: Container is default executor (PHASE5 v3) | Architect and Coder sessions run in Containers by default |
| Pipeline semantic grounding (proposed) | Architect session IS the grounding fix -- specContent enters at the source |
| SASE BriefingScript (Hassan et al. SS5.1) | BriefingScript is the Architect session's output format |
| SASE LoopScript (Hassan et al. SS5.2) | The StateGraph IS the LoopScript runtime |
| SASE MentorScript (Hassan et al. SS5.3) | mentorscript_rules collection + Dream DO crystallization |
| SASE CRP/VCR (Hassan et al. SS5.4) | CRP inbox + waitForEvent + VCR resolution flow |

---

## 15. The Fundamental Constraint

The Factory's autonomous swarm is not "agents with bigger prompts." It is
agents with institutional memory. The difference:

- **Bigger prompts** = more text in the context window. Scales linearly with
  token count. Suffers from "context is not comprehension" (CONTEXT-IS-NOT-
  COMPREHENSION-2026-04-24). The model may read 50K tokens and still miss
  the one DECISIONS entry that matters.

- **Institutional memory** = the right context, loaded at the right time,
  for the right role. The Coordinator DO assembles a digest that includes
  only the decisions and lessons relevant to this synthesis run. The role
  contracts determine which skills load. The MentorScript rules are scoped
  by role and package. The memory is structured, not dumped.

This is the PAI model. PAI works not because Claude Code has a big context
window, but because the `.agent/` directory structures what the agent knows,
when it loads it, and how it applies it. The pi-ai port preserves this
structure. The Container is the execution environment. ArangoDB is the
durable store. The Coordinator DO is the conductor. The institutional memory
is the intelligence.

The Factory IS the SASE vision implemented on Cloudflare.
