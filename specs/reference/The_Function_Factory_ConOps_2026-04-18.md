# The Function Factory — Concept of Operations

## Koales.ai Seed ConOps v1

**Author:** Wislet J. Celestin
**Affiliation:** Koales.ai / WeOps Research
**Document type:** Concept of Operations (doctrinal)
**Status:** Seed ConOps for the Function Factory as operated within Koales.ai
**Date:** 18 April 2026
**Companion documents:**
- *The Function Factory* whitepaper v4 (2026-04-18)
- *The I/We Boundary: Positioning WeOps Against the Externalization Program* (2026-04-17)
- WeOps/WGSP Executive Whitepaper (WP-2026-EP-01)

---

## Table of Contents

1. Purpose and Scope
2. Operational Context
3. Operator Roles
4. System Modes
5. Authority and Permission Model
6. Information Flow
7. Operational Scenarios
8. Exception Handling
9. Interfaces to Adjacent Systems
10. Measures of Operational Effectiveness
11. Transition Plan: Bootstrap → Steady-State
12. Governance and Change Control

---

## 1. Purpose and Scope

### 1.1 Purpose of this document

This Concept of Operations specifies how the Function Factory is operated as a production system within Koales.ai. The whitepaper (*The Function Factory*, v4) defines the architecture — what the Factory is, why it exists, what its stages and gates are, and where it sits in the I/We taxonomy. This document defines the operational reality — who interacts with the Factory, what workflows they execute, how information flows between them, and what rules govern those flows under nominal, degraded, and emergency conditions.

A reader who has absorbed the whitepaper and this ConOps should be able to operate the Factory without having to reconstruct operational intent from first principles. A reader who comes to the ConOps without the whitepaper will still learn how the Factory behaves, but will lack the architectural justification for why it behaves that way. Both documents are required for full orientation.

### 1.2 Scope

This ConOps is strictly the operational specification for the Function Factory. It treats the Factory as a discrete system with well-defined interfaces to adjacent systems (WeOps, Cognifiq.ai, vertical brands, external harnesses). The operations of those adjacent systems are out of scope except where the Factory's operations touch them at a boundary.

The seed organizational context is Koales.ai. This is the organization whose Pressures, Capabilities, and Functions the Factory will operate on during Bootstrap and early Steady-State. References to "the organization" in this document refer to Koales.ai unless explicitly generalized.

### 1.3 Out of scope

The following are explicitly out of scope for this ConOps:

- Operations of WeOps as a governance system. A separate WeOps ConOps will specify those.
- Operations of Cognifiq.ai as an epistemic runtime. A separate Cognifiq.ai ConOps will specify those.
- Vertical-specific operational conventions (CareGraf.ai, CareGraph.io, MiddleCare, ComeFlow, Canvas.ceo) — these will have their own operational documents that compose *against* this ConOps as a base.
- Hardware, networking, and deployment infrastructure below the Factory's runtime abstractions.
- Financial, contractual, and commercial operations of Koales.ai.

### 1.4 Relationship to the whitepaper

Where the whitepaper makes an architectural claim, this ConOps translates that claim into operational rules. The whitepaper's six non-negotiables (lineage preservation, narrow-pass discipline, explicit invariants with detectors, assurance dependency typing, trajectory-driven closure with a birth gate, three Coverage Gates fail-closed) are operationalized throughout this document as authority boundaries, mode rules, and scenario constraints. A change to this ConOps that violates any of the six is a change to the whitepaper, not a change to the ConOps alone.

## 2. Operational Context

### 2.1 The Factory in one paragraph

The Function Factory is a closed-loop compiler that converts Pressures (forcing functions on Koales.ai) into trustworthy executable Functions, and maintains the trust of those Functions over time through runtime evidence. It consists of seven stages (Signals → Pressures → Capabilities → Function Proposals → PRD/Compiler → Agent Execution → Simulation and Runtime) and three Coverage Gates (Compile, Simulation, Assurance). It produces WorkGraphs; it does not produce Work Orders. WorkGraphs are implementation artifacts. Work Orders are the organizational acts of commissioning that WeOps governs. The Factory is I-layer infrastructure. It is not a harness, not a code generator, and not WeOps.

### 2.2 Where the Factory fits within Koales.ai

Koales.ai is the thesis layer of the organization — the brand and intellectual structure within which all other products sit. WeOps/WGSP is the platform and protocol layer that governs commissioned work. The Factory occupies a layer between these two: it is the *production* infrastructure that materializes executable Functions which WeOps subsequently governs under Work Orders and which vertical brands subsequently deploy.

A concrete example of the layer stack in operation:

- **Thesis (Koales.ai):** biomimicry, Decision Spine, the Enterprise Cognition Loop.
- **Platform (WeOps/WGSP):** DEL, WOSSM, CCI, POE, PII, We-Gradient — the runtime governance primitives.
- **Production (the Factory):** the closed-loop compiler that produces the Functions those primitives govern.
- **Epistemic layer (Cognifiq.ai):** the design→execution→feedback→learning arc observing all of the above and producing organizational self-knowledge.
- **Vertical surface (CareGraf.ai, etc.):** the customer-facing brands under which commissioned work actually executes.

The Factory is not visible to the vertical customer. The customer experiences the Functions the Factory produced; they do not experience the Factory. This is by design. The Factory is infrastructure, not product.

### 2.3 Bootstrap context

At the time of this document's publication, the Factory is in Bootstrap mode. The first Pressures being processed are meta-Pressures — the six non-negotiables from the whitepaper, translated into formal Pressure objects. The first Capabilities are the Factory's own required abilities (Compile PRDs, Execute WorkGraphs, Compute Trust, Detect Regression, Propagate Incidents, Propose Functions from Drift, Enforce Coverage Gates). The first Functions are the components of the Factory itself. Every artifact produced during Bootstrap carries a `META-` prefix to distinguish it from first-vertical artifacts.

Bootstrap is not a separate tool; it is the Factory operating on itself. This is the point. A Factory that can Factory-build itself has, by definition, passed every gate against the specifications for every gate. The Bootstrap lineage is the first proof that the Factory works, and that lineage is auditable from any point in the system's future.

### 2.4 Steady-State context

Steady-State is the operational mode the Factory enters once Bootstrap is complete and the first vertical Function is produced. In Steady-State the Factory receives external signals (market, customer, competitor, regulatory) alongside internal signals (runtime telemetry, audit events, trajectory drift from deployed Functions). It produces Functions for one or more verticals simultaneously. Multiple commissioning organizations may be issuing Work Orders against Factory-produced Functions; WeOps governs those commissions; the Factory itself remains substrate.

Steady-State is not a destination. It is a posture. The Factory continues to operate on itself in Steady-State as well — its own Pressures, Capabilities, and Functions continue to be maintained, regressed, and reborn from trajectory evidence. Bootstrap artifacts and Steady-State artifacts coexist in the same specs/ tree and the same artifact-ID namespace (distinguished by the `META-` prefix convention).

## 3. Operator Roles

The Factory is operated by seven distinct roles. Each role has bounded authority, specific information access, and canonical workflows. A single human or system may fulfill multiple roles, but the role boundaries are preserved in logging and authority enforcement regardless of who occupies them.

### 3.1 Architect

The **Architect** is the human role with ultimate authority over Factory design, architectural decisions, and lesson promotion. The Architect does not routinely operate the Factory day-to-day; the Architect reviews, approves, overrides, and intervenes. The Architect is the only role with authority to modify the whitepaper's non-negotiables, the canonical schemas in `packages/schemas/src/core.ts`, the permissions file, and the seeded lessons in `LESSONS.md`.

In the seed configuration, the Architect is Wislet J. Celestin. As the Factory matures, additional humans may be granted Architect authority, but the role remains small — Architect authority is the scarcest privilege in the system and its scarcity is what gives it weight.

Architect workflows include: reviewing high-impact PRDs before compilation; approving trajectory-driven Function births above the birth-gate score threshold; promoting episodic lessons to semantic memory; resolving UncertaintyEntries that the Factory itself cannot; declaring emergencies and emergency overrides; authoring DECISIONS.md entries; approving changes to the non-negotiables.

### 3.2 Coding Agent

The **Coding Agent** is the software role that produces Factory artifacts under skill discipline. Coding Agents execute the day-to-day work of the Factory: authoring Pressures from normalized Signals, drafting PRDs from Function Proposals, running compiler passes, generating test scenarios, writing implementations from WorkGraphs. In the seed configuration, the Coding Agent role is fulfilled by Claude Code, Cursor, or another harness-bound agent; multiple agents may operate concurrently on different Functions.

A Coding Agent operates strictly within the `.agent/` layer's governance: it reads AGENTS.md on every session start, checks LESSONS.md before decisions it may have been corrected on before, follows the permissions.md restrictions without bypass, and logs every significant action to episodic memory with full lineage. A Coding Agent cannot modify skills, cannot modify permissions, cannot promote Function lifecycle states, and cannot merge pull requests without explicit Architect approval.

### 3.3 Critic Agent

The **Critic Agent** is a software role that reviews Coding Agent output against contracts, invariants, and past lessons. The Critic does not produce primary artifacts; it produces critiques that gate whether Coding Agent output advances to the next pipeline stage. The Critic reviews atom extractions for semantic drift, invariant specifications for detector completeness, WorkGraphs for lineage integrity, and Coverage Reports for internal consistency.

The Critic Agent and Coding Agent are separated by design. A single agent that writes its own critiques tends to rationalize rather than review. Even when both roles are fulfilled by the same underlying model, the separation of invocation context enforces discipline that a monolithic agent loses. In harness terms, the Critic node in the agent topology (see whitepaper §3 Stage 6) is the institutional instance of this separation.

### 3.4 Gate Evaluator

The **Gate Evaluator** is not a human or an agent. It is the automated runner that executes the three Coverage Gates against their specified inputs and emits Coverage Reports. The Gate Evaluator has no discretion. It applies the coverage formulas in `packages/coverage-gates` to the Zod-validated inputs and produces a verdict: pass or fail, with the specific artifacts that failed coverage enumerated by ID.

The Gate Evaluator's determinism is architecturally load-bearing. If the Gate Evaluator had discretion, gate decisions would drift, and the trust computation would lose its evidentiary basis. The Gate Evaluator is the closest thing the Factory has to a judge: it reads the law (the Zod schemas and coverage formulas) and applies it to the facts (the artifacts under review). It does not negotiate.

### 3.5 Operator

The **Operator** is the human role responsible for monitoring Functions in the `monitored` lifecycle state, responding to Gate 3 alerts, and coordinating incident response when assurance regressions occur. The Operator is not the Architect; the Operator is the daily shift. An Operator reviews the rolling Assurance Coverage Reports, investigates detector freshness anomalies, confirms or rejects assurance-regression transitions, and escalates to the Incident Responder when a regression points to active behavioral failure.

In the seed configuration for Koales.ai, the Operator role may initially be held by the Architect during Bootstrap and early Steady-State. The separation is meaningful in principle even when the person is the same; Operator actions are logged under the Operator role, not the Architect role, so the audit trail distinguishes routine monitoring from architectural intervention.

### 3.6 Auditor

The **Auditor** is a role that reads Coverage Reports and lineage chains for compliance, risk management, and organizational learning purposes. The Auditor has broad read access to every artifact in `specs/` and every entry in episodic and semantic memory, but has no write authority and no authority to modify the Factory's production flow. The Auditor produces reports for other Koales.ai layers (WeOps, Cognifiq.ai, vertical brand compliance teams) and for external regulatory or customer review where required.

The Auditor role is important operationally because it is the role that most often detects systematic drift before the Architect does. An Auditor reviewing 90 days of Coverage Reports may see patterns that no single Coding Agent session captured. Auditor findings are surfaced to the Architect via the DECISIONS.md proposal mechanism; they do not directly modify the Factory but they shape the modifications the Architect authorizes.

### 3.7 Incident Responder

The **Incident Responder** is the role that handles declared incidents — production failures, security events, invariant violations severe enough to require immediate human attention. The Incident Responder has elevated authority during an active incident: they can force Function lifecycle transitions (to `regressed` or `retired`), isolate Functions from the execution path, and trigger Emergency mode. All Incident Responder actions during an incident are logged with the incident ID as primary lineage reference, not with a Function ID, so the audit trail distinguishes incident-driven actions from routine operations.

The Incident Responder role typically collapses to the Architect or Operator during Bootstrap and early Steady-State. Larger Koales.ai deployments will separate the role, especially for 24/7 coverage of verticals with regulatory uptime requirements.

### 3.8 Role interaction matrix

| Interaction | Initiator | Recipient | Medium |
|---|---|---|---|
| Architectural decision | Architect | all roles | DECISIONS.md, LESSONS.md |
| Artifact production | Coding Agent | Gate Evaluator | specs/ + compiler invocation |
| Artifact review | Coding Agent | Critic Agent | in-harness critique pass |
| Gate verdict | Gate Evaluator | Coding Agent, Operator | Coverage Report emission |
| Runtime alert | Gate Evaluator (continuous) | Operator | Gate 3 transition event |
| Escalation | Operator | Incident Responder | incident declaration |
| Architect override | Architect | Gate Evaluator | explicit override entry in DECISIONS.md |
| Compliance read | Auditor | Architect, Operator | audit report |
| Uncertainty surfacing | Coding Agent | Architect | UncertaintyEntry + episodic log |

## 4. System Modes

The Factory operates in one of four discrete modes at any time. The current mode is authoritative; mode transitions are explicit events logged to episodic memory with full context.

### 4.1 Bootstrap mode

**Definition.** The mode in which the Factory is operating on itself — producing the Factory's own Functions as its first artifacts. Artifact IDs carry the `META-` prefix convention (`PRS-META-*`, `BC-META-*`, `FN-META-*`, etc.).

**Scope.** All stages are active at reduced signal volume. Signals are primarily internal (architect corrections, build events, test results, whitepaper references) rather than external. The first Pressures are the six non-negotiables from the whitepaper. The first Capabilities are the Factory's own required abilities. Gate 3 is active but monitors only the Factory's own detectors against its own evidence streams.

**Rules specific to Bootstrap.**
- Signal sources may include `internal` and `meta` types explicitly; these are deprecated in Steady-State but normal in Bootstrap.
- Every artifact is tagged `META-` in its ID. Artifacts without this prefix are rejected at Gate 1 during Bootstrap.
- Architect approval is required for every Coverage Gate failure, not just high-impact ones. Bootstrap coverage is brittle by nature and false failures are more likely than in Steady-State; the Architect's review catches those before they become load-bearing lessons.
- Trajectory-driven Function birth is **disabled** during Bootstrap. The birth gate cannot be evaluated meaningfully when the population of existing Functions is small and the drift signal is mostly from the Factory's own scaffolding. Trajectory detection runs and logs, but proposals are not auto-generated.
- The Architect may serve in multiple roles concurrently during Bootstrap (Operator, Incident Responder, sometimes Coding Agent for meta-artifacts). Role logging still records the role-of-action, not the person.

**Transition out.** Bootstrap ends when the first non-META Function reaches `monitored` lifecycle state and has survived one full dream cycle (24h) without regression. At that point the Factory transitions to Steady-State via an explicit mode-transition commit to DECISIONS.md signed by the Architect.

### 4.2 Steady-State mode

**Definition.** The mode in which the Factory produces and maintains Functions for one or more verticals. External signals flow from market/customer/competitor/regulatory sources. Multiple Coding Agents may operate in parallel. Multiple commissioning organizations may be issuing Work Orders against Factory-produced Functions through WeOps.

**Scope.** All seven stages active; all three Coverage Gates active; trajectory-driven Function birth active with birth-gate scoring; dream cycle runs nightly; Gate 3 monitors both META and non-META Functions continuously.

**Rules specific to Steady-State.**
- Gate failures are logged and remediated per skill; only repeated failures or high-impact failures require Architect approval.
- Trajectory-driven proposals are generated and ranked; proposals above the birth-gate threshold enter Stage 5 as first-class PRDs alongside human-authored PRDs.
- Role separation is enforced: no single session may fulfill both Coding Agent and Critic Agent roles for the same Function.
- The Architect is out-of-band by default. Architect intervention is reserved for DECISIONS.md-worthy moments, override moments, and scheduled review.
- Bootstrap META-artifacts remain active and maintained alongside vertical artifacts. The Factory continues to operate on itself in Steady-State.

### 4.3 Degraded mode

**Definition.** The mode in which one or more Factory components are unavailable but the Factory as a whole continues to operate under restricted rules. Degraded mode is not an emergency; it is a planned operating posture for partial outage.

**Triggers for entry.** Any of:
- A Coverage Gate is offline (hardware, network, dependency). The Factory cannot compute verdicts.
- A harness integration is offline (Claude Code rate-limited, Cursor unavailable). Coding Agent work is throttled.
- The Dropbox sync for specs/ is offline. Artifacts can be authored locally but not propagated.
- The assurance dependency graph computation is impaired (schema drift in evidence sources, detector registration delays).
- Any component failure logged with pain_score ≥ 8 and unresolved after 30 minutes.

**Rules specific to Degraded mode.**
- The offline component's gate is treated as **fail** for any artifact that would require its verdict. No silent passes. A Coverage Gate that cannot compute its verdict does not produce a pass verdict by default; it produces a degraded-mode halt.
- Function lifecycle transitions that depend on the offline component are blocked. A Function cannot be promoted to `monitored` if Gate 2 is offline; it stays at `verified` until the gate is restored.
- Trajectory-driven Function birth is paused (not disabled) — the detection runs and logs, but no proposals enter Stage 5 automatically.
- The Operator is required to acknowledge Degraded mode entry in episodic memory with the specific component and expected restoration window.
- Architect approval is required to exit Degraded mode back to Steady-State; the exit event is logged to DECISIONS.md.

### 4.4 Emergency mode

**Definition.** The mode in which normal Factory flow is suspended because a declared emergency requires direct Architect or Incident Responder action. Emergency mode is rare and explicitly time-boxed.

**Triggers for entry.**
- A sev1 incident linked to one or more Functions' invariants.
- A security event requiring immediate Function isolation.
- An Architect-declared emergency for any reason, logged with rationale.
- A Gate 3 failure pattern indicating systematic detector compromise (silent observers on live Functions).

**Rules specific to Emergency mode.**
- Coverage Gates are not bypassed — they still run and still fail closed — but manual Architect-authorized overrides are permitted for specific, named artifacts with inline rationale in DECISIONS.md.
- Function lifecycle transitions to `retired` or `regressed` can be forced by the Incident Responder without the normal promotion path.
- Coding Agent work is paused for the affected Function family until the emergency is cleared.
- All Emergency mode actions are logged with the declaration ID as primary lineage, creating a parallel audit trail for the emergency that is independent of the normal Function-ID lineage.
- Emergency mode is time-boxed to 4 hours by default. Extension requires explicit Architect action and a DECISIONS.md entry; the time limit exists to prevent Emergency mode from becoming a silent permanent state.

**Transition out.** Emergency mode ends when the declaring role closes the emergency with a documented root cause, remediation plan, and transition target (back to Steady-State, or into Degraded mode if the root cause has introduced a planned-outage component).

### 4.5 Mode transition matrix

| From ↓ / To → | Bootstrap | Steady-State | Degraded | Emergency |
|---|---|---|---|---|
| **Bootstrap** | — | first non-META Function `monitored` for 24h | any Bootstrap trigger meets Degraded criteria | any Bootstrap trigger meets Emergency criteria |
| **Steady-State** | not permitted | — | component unavailable per §4.3 | sev1 incident or Architect declaration |
| **Degraded** | not permitted | component restored + Architect approval | — | Degraded incident escalates to Emergency |
| **Emergency** | not permitted | emergency cleared, no residual outage | emergency cleared, residual planned outage | — |

Transitions are explicit and logged. The Factory never transitions modes implicitly. An unlogged transition is treated as a governance defect.

## 5. Authority and Permission Model

### 5.1 Authority classes

Authority in the Factory is organized into four classes, each progressively scarcer.

**Read authority** is universal across roles except for fields explicitly marked sensitive (e.g., raw signal sources that contain customer PII). Every role can read `specs/`, `.agent/memory/`, and Coverage Reports. The exceptions are: the Auditor role cannot read in-flight Coding Agent session state (that's transient and unstable); the Coding Agent cannot read other Coding Agents' in-flight sessions (this enforces independence).

**Routine write authority** covers the everyday production of Factory artifacts: Coding Agents writing Pressures, Capabilities, Function Proposals, PRDs; Gate Evaluator writing Coverage Reports; all roles writing episodic memory entries. Routine writes do not require approval and are the default operational flow.

**Reviewed write authority** covers writes to shared institutional memory and architecturally load-bearing files. These include LESSONS.md, DECISIONS.md, any file under `.agent/skills/`, the permissions file, and the canonical schema module. Writes to these files require Architect approval and are tracked via the DECISIONS.md proposal mechanism.

**Controlled write authority** covers the non-negotiables: the whitepaper itself (versioned externally), the six non-negotiables enumerated in README.md, the Coverage Gate formulas in `packages/coverage-gates/src/`, and the lineage primitives in `packages/schemas/src/lineage.ts`. Writes to these require Architect authorization logged as a DECISIONS.md entry with architectural rationale, and cannot be delegated to a non-Architect role regardless of operational necessity.

### 5.2 Role × authority matrix

| Role | Read `specs/` | Write `specs/` (routine) | Write `LESSONS.md` | Write skills | Write permissions | Modify schemas | Force lifecycle | Declare emergency |
|---|---|---|---|---|---|---|---|---|
| Architect | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| Coding Agent | ✓ | ✓ | propose only | propose only | ✗ | ✗ | ✗ | ✗ |
| Critic Agent | ✓ | critiques only | propose only | ✗ | ✗ | ✗ | ✗ | ✗ |
| Gate Evaluator | ✓ | Coverage Reports only | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ |
| Operator | ✓ | lifecycle events | propose only | ✗ | ✗ | ✗ | ✗ (non-emergency) | ✓ (with rationale) |
| Auditor | ✓ | ✗ | propose only | ✗ | ✗ | ✗ | ✗ | ✗ |
| Incident Responder | ✓ | incident records | propose only | ✗ | ✗ | ✗ | ✓ (during emergency only) | ✓ |

"Propose only" means the role may author a draft or proposal but the write requires Architect approval to commit. Proposal mechanisms route through DECISIONS.md and episodic memory so that declined proposals are recoverable.

### 5.3 Approval protocol

When an action requires Architect approval, the requesting role:

1. Composes the proposed change with complete lineage references and explicit rationale.
2. Writes the proposal to episodic memory with `pain_score: 5, importance: 8` by default and the action tagged as `PROPOSAL:`.
3. Opens a draft pull request or DECISIONS.md draft entry referencing the proposal ID.
4. Notifies the Architect through the configured notification channel (during Bootstrap, this is the chat surface; during Steady-State, the Koales-internal mechanism that will supersede).
5. Halts the dependent action and does not proceed until Architect response is logged.

Architect response is one of: approve (with any amendments inline), defer (with expected review window), decline (with rationale). All three outcomes are logged to episodic memory and, if architecturally significant, to DECISIONS.md.

An unapproved proposal does not time out into auto-approval. Silence is not consent in this system.

### 5.4 Override discipline

The Architect has the authority to override Gate verdicts and permission rules under specific named conditions. Overrides are tracked explicitly because they are the load-bearing exception to the fail-closed discipline.

An override must include: the specific artifact and verdict being overridden, the rationale, the remediation plan (what upstream fix will restore normal flow), the expected duration, and an explicit DECISIONS.md entry with Architect identifier. Overrides without all five fields are treated as malformed and do not take effect.

The Factory tracks override frequency as a Measure of Operational Effectiveness (see §10). A rising override rate is a diagnostic signal — it indicates either that the Factory's gates are miscalibrated for reality or that the Architect is fighting the Factory instead of fixing it. Either way, the override rate itself becomes an input to the trajectory-driven proposal system once Steady-State is established.

## 6. Information Flow

### 6.1 The primary flow — upstream to downstream

The Factory's primary information flow runs from environmental signals through compiled artifacts to deployed Functions and back to new signals via runtime evidence. A single pass through the flow for a new Function takes roughly the following shape:

A **Signal** enters the Factory's Stage 1 from an external source (market report, customer feedback, competitor announcement, regulatory change) or an internal source (runtime telemetry, audit event, Architect correction, trajectory drift on an existing Function). The Signal is normalized into the canonical ExternalSignal schema with source, timestamp, confidence, severity, frequency, and entity tags populated.

Normalized Signals cluster into **Pressures** during Stage 2. This clustering is the first semantic act of the Factory: multiple Signals with common category, affected domain, and consistent forcing direction combine into a Pressure that carries strength, urgency, frequency, and confidence. Lineage is preserved — every Pressure's `derivedFromSignalIds` cites every Signal that contributed.

Pressures map to **Business Capabilities** during Stage 3. Each Capability is the organization's durable ability to respond to one or more Pressures — the transfer function, in control-theory terms. The Factory enforces that each Capability yields three kinds of Functions downstream: execution, control, and evidence. A Capability without this triple is incomplete and will fail Stage 4.

Stage 4 computes the **Capability Delta** — what is missing, degraded, or underutilized in each Capability's current Function portfolio — and generates **Function Proposals**. Each Proposal is typed (execution, control, evidence, or integration), scored, and queued for Stage 5.

Stage 5 is the **compiler**. Each Function Proposal produces a PRD; each PRD runs through the eight narrow passes; Gate 1 evaluates the compiled output for coverage; on pass, a **WorkGraph** is emitted. The WorkGraph is the Factory's primary compiled artifact, the typed DAG that Stage 6 executes.

Stage 6 is **execution**. The WorkGraph is handed to a harness (Claude Code, Cursor, or a custom conductor) with a fixed node topology: Planner, Coder, Critic, Tester, Verifier. The execution produces code, tests, configuration, and documentation — the actual implementation artifacts of the Function.

Stage 7 is **simulation and runtime**. The implementation enters a Digital Twin Universe where scenarios exercise it against invariants; Gate 2 evaluates simulation coverage; on pass, the Function promotes from `verified` to `monitored`. Once `monitored`, the Function runs in production (or staging) with runtime telemetry feeding invariant detectors; Gate 3 runs continuously; trust is computed from correctness, compliance, observability, stability, and user response.

Runtime evidence in Stage 7 closes the loop. **Trajectory** objects capture observed drift; **ProblemFrames** translate drift into problem statements; **FunctionProposals** are generated (with birth-gate scoring) for the drift; high-scoring proposals re-enter Stage 5 as new PRDs. The Factory is therefore not a pipeline but a cycle.

### 6.2 Memory flow — the trace underneath

Alongside the primary pipeline, the Factory maintains a four-layer memory trace. Every operational action writes to episodic memory with timestamp, role, artifact lineage, pain/importance scores, and reflection. Working memory tracks active task state. Semantic memory holds distilled lessons and architectural decisions. Personal memory holds the Architect's stable conventions.

Memory flow runs in two directions. Forward: operational actions write episodes; periodic dream cycles promote recurring high-salience patterns into semantic lessons. Backward: every operational role reads relevant memory layers before acting. The Coding Agent reads LESSONS.md before decisions it may have been corrected on before. The Critic Agent reads DECISIONS.md to avoid re-litigating settled choices. The Operator reads recent episodic entries for the Function under alert before acting.

This bidirectional memory flow is what makes the Factory reflexive rather than merely operational. Without the backward flow, the Factory would relearn the same mistakes repeatedly. Without the forward flow, the backward flow would have nothing to read.

### 6.3 Coverage Report flow

Coverage Reports are a distinct information channel that runs alongside the primary pipeline. Every Gate emits a Coverage Report on every evaluation — pass or fail. Reports are written to `specs/coverage-reports/` with the naming convention `CR-<artifact-id>-GATE<n>-<timestamp>.yaml`.

Coverage Report flow is the primary channel for three downstream consumers: the Coding Agent (consuming Gate 1 failures to remediate PRDs), the Operator (consuming Gate 2 and Gate 3 for lifecycle and monitoring decisions), and the Auditor (consuming all three for compliance review). During Bootstrap, the Architect is also a primary consumer of every Report, because every Bootstrap-phase Coverage Report is an input to the next iteration of the Factory's own specification.

### 6.4 Incident flow

When an incident is declared — either manually by an Operator or Incident Responder, or automatically by Gate 3 threshold breach — the incident flow activates. An **Incident** object is created with severity classification (sev1–sev4), the invariants it impacts, the Functions linked through those invariants, confidence, and status. The Incident enters the assurance dependency graph and propagates through the five dependency types (execution, evidence, policy, shared invariant, shared adapter), producing typed impact levels (watch, degraded, regressed) at every affected Function.

Incident flow is distinguished from normal flow by its lineage priority: actions taken during an active incident log the Incident ID as primary lineage, not the Function ID. This creates a parallel audit trail that is query-able independently of the Function lineage, which matters for post-incident review and for regulatory incident disclosure where required.

### 6.5 Timing and cadence

| Event | Cadence | Trigger |
|---|---|---|
| Signal ingestion | continuous | external source emit or internal telemetry |
| Pressure clustering | continuous or batch | configurable per signal category |
| Capability review | weekly (Steady-State) / per-change (Bootstrap) | Signal arrival above category threshold |
| Compiler invocation | per-PRD | Coding Agent command |
| Gate 1 evaluation | per-PRD compilation | Pass 7 completion |
| Gate 2 evaluation | per-Function, pre-promotion | `verified` → `monitored` request |
| Gate 3 evaluation | per-detector, continuous | detector freshness window |
| Dream cycle | daily at 03:00 UTC | cron, or manual invocation |
| Episodic memory write | per-action | every significant operational action |
| Semantic promotion | during dream cycle | recurrence ≥ 2 and salience ≥ 7.0 |
| Trajectory detection | hourly | rolling metric window |
| Function birth proposal | daily (Steady-State) / disabled (Bootstrap) | trajectory above birth-gate threshold |
| Architect review | weekly scheduled + ad-hoc | proposal queue or override request |

## 7. Operational Scenarios

The following scenarios specify how the Factory operates under nominal and named non-nominal conditions. Each scenario is written as a step-by-step flow that roles can follow without reconstructing intent.

### 7.1 Scenario A — Nominal Function production

**Precondition.** A Pressure exists in `specs/pressures/`, derived from Signals, with adequate strength/urgency to justify Capability work.

**Flow.**

1. A Coding Agent reads the Pressure and identifies the Capability it addresses (existing or new). If new, the Capability is authored with lineage to the Pressure and committed to `specs/capabilities/`.
2. The Coding Agent computes the Capability Delta against existing Functions addressing the same Capability. The Delta enumerates missing execution, control, evidence, and integration Functions.
3. For each gap, the Coding Agent authors a Function Proposal in `specs/functions/`, with candidate invariants and success signals.
4. The Coding Agent drafts a PRD for the Function Proposal with the `PRD-*` ID. The PRD follows the template (problem, goal, constraints, acceptance criteria, success metrics, out-of-scope).
5. The Coding Agent invokes the compiler: `pnpm compile specs/prds/PRD-XXX.md`. The compiler runs Passes 0–6, then Gate 1.
6. **If Gate 1 passes**, the compiler emits the WorkGraph to `specs/workgraphs/` and a Coverage Report with `overall: pass` to `specs/coverage-reports/`. The Coding Agent proceeds to Stage 6.
7. **If Gate 1 fails**, the Coverage Report with `overall: fail` is written and the compiler halts. The Coding Agent reads the Report, identifies the remediation scope (which atoms, invariants, or dependencies are missing), and revises the PRD upstream. The compile is re-run.
8. With a passing Gate 1, the Coding Agent hands the WorkGraph to the harness. The Planner, Coder, Critic, Tester, Verifier topology executes against the WorkGraph. The Function enters `implemented` lifecycle state.
9. Required validations run. On full pass, the Function enters `verified` lifecycle state.
10. The Function is deployed into the Digital Twin Universe. Scenarios execute. Gate 2 evaluates simulation coverage.
11. **If Gate 2 passes**, the Operator confirms the `verified` → `monitored` transition, and Gate 3 activates continuous monitoring.
12. **If Gate 2 fails**, the Function remains at `verified`. The Coding Agent adds scenarios, negative tests, or fixes failing required validations per the Coverage Report's remediation text.
13. Gate 3 runs continuously. Trust is computed from the five dimensions. The Function operates in production.

**Success criteria.** A Function reaches `monitored` state with trust composite ≥ 0.85, survives 24 hours without Gate 3 failure, and has no incidents linked to its invariants.

### 7.2 Scenario B — Gate 1 failure and PRD remediation

**Precondition.** A Coding Agent has invoked the compiler on a PRD and Gate 1 has returned `overall: fail`.

**Flow.**

1. The Coding Agent reads the Coverage Report at `specs/coverage-reports/CR-PRD-XXX-GATE1-<timestamp>.yaml`.
2. The Coding Agent classifies the failure: atom coverage (orphan atoms), invariant coverage (missing validations or detectors), validation coverage (dead tests), or dependency closure (dangling endpoints).
3. **Atom orphan.** The Coding Agent identifies why the atom has no downstream. Either the atom should produce a contract, invariant, or validation and was missed — in which case the Coding Agent adds the missing artifact — or the atom is genuinely out of scope and should be moved to the PRD's `outOfScope` list with rationale.
4. **Missing validation for invariant.** The Coding Agent authors the validation, backmapping to the invariant via `coversInvariantIds`. The `invariant-authoring` skill governs the work.
5. **Missing detector for invariant.** This is the most common Gate 1 failure. The Coding Agent authors a DetectorSpec with evidence sources, direct rules, regression policy, and incident tags. A detector that cannot name its evidence source is rejected again at Gate 1; the remediation is upstream — the evidence source must first be made available (new telemetry, new audit stream, etc.).
6. **Dead validation.** The Coding Agent either backmaps the validation to an artifact it covers, or removes it as redundant.
7. **Dangling dependency.** The Coding Agent resolves the endpoint — either by adding the missing artifact or by removing the dependency if it was spurious.
8. The Coding Agent re-runs the compiler. If Gate 1 passes, the flow returns to Scenario A step 7. If Gate 1 fails again with a new defect class, the cycle repeats; if the same defect class recurs, the `on_failure` hook flags the relevant skill for self-rewrite and the Architect is notified.
9. All remediation actions are logged to episodic memory with pain_score ≥ 6, importance ≥ 7, and lineage back to the PRD and the Coverage Report.

**Anti-patterns to reject.** Lowering validation priority from required to recommended to pass the gate. Auto-generating placeholder validations. Removing invariants to avoid the detector requirement. Claiming the gate is over-strict without a DECISIONS.md entry requesting a calibration change.

### 7.3 Scenario C — Function regression from runtime evidence

**Precondition.** A Function is in `monitored` state. Gate 3 detects a direct-rule violation in a critical invariant, or trust composite drops below threshold.

**Flow.**

1. The Gate Evaluator emits a Gate 3 Coverage Report with `overall: fail` and the specific invariant, detector, and evidence referenced.
2. The Function lifecycle automatically transitions from `monitored` to `regressed` if the failure is a direct violation, or to `assurance_regressed` if the failure is loss of visibility (stale detector, quiet evidence source, audit pipeline divergence).
3. The Operator is notified. The Operator investigates: reads the Coverage Report, reads recent episodic entries tagged with the Function ID, inspects the linked Incident if one exists, reviews the evidence source state.
4. If the regression is a direct violation, the Operator confirms the severity classification and escalates to the Incident Responder if sev2 or higher.
5. The incident enters the assurance dependency graph. Propagation runs through the five dependency types. Functions that depend on the regressed Function via execution, evidence, policy, shared invariant, or shared adapter have their status recomputed with typed impact levels (watch, degraded, regressed).
6. The Incident Responder (or Operator, for sev3/sev4) decides the remediation path: patch the Function in place, roll back to the prior `monitored` version, or retire the Function if the regression is unrecoverable.
7. Remediation takes one of three shapes:
   - **Patch in place.** A new PRD is drafted or an existing one is amended. The flow returns to Scenario A from step 4.
   - **Roll back.** The prior passing WorkGraph and implementation are restored. The Function re-enters `verified` state; Gate 2 must pass again for promotion to `monitored`.
   - **Retire.** The Function transitions to `retired`. Dependent Functions are reviewed; if they cannot operate without this Function, they too regress, and the propagation runs again.
8. Throughout, runtime evidence continues to flow. The Trajectory that produced the regression is recorded in full, becoming input to the trajectory-driven proposal system for whether a new Function should be born to address the underlying forcing condition.

### 7.4 Scenario D — Trajectory-driven Function birth

**Precondition.** The Factory is in Steady-State mode. A Trajectory has been detected on one or more existing Functions with drift severity above the birth-gate threshold.

**Flow.**

1. The Factory's upstream trajectory detection runs (hourly cadence in Steady-State). A Trajectory object is created with observed metrics, drift type, dimensions, and time window.
2. The trajectory-to-problem pass translates the Trajectory into a ProblemFrame: system area, likely failure modes, impacted Functions, unmet needs.
3. The ProblemFrame generates one or more FunctionProposal candidates with proposal type (reinforcement, supporting function, boundary refactor) and expected effect.
4. The FunctionBirthScore is computed for each candidate. The score weights drift severity, recurrence, cross-Function coupling, recovery cost, and expected leverage, against implementation cost and overlap with existing Functions.
5. Candidates above the birth-gate threshold enter the Architect's review queue. Candidates below threshold are logged and retained for pattern detection but do not produce PRDs.
6. The Architect reviews the queue on the weekly scheduled review or ad-hoc for high-severity trajectories. Approval converts the FunctionProposal into a PRD draft.
7. From there, the flow merges with Scenario A from step 4. The trajectory-driven PRD is treated identically to a human-authored PRD by the compiler and all downstream stages.

**Critical constraint.** The birth-gate threshold is not relaxed to admit more proposals. If proposal volume is too low, the upstream trajectory detection or the scoring formula is the thing to revise, not the gate. Loosening the gate is a scoreboard-gaming move that produces Function proposal inflation and ultimately destroys the trust value of the proposal channel.

### 7.5 Scenario E — Assurance regression (silent monitoring loss)

**Precondition.** A Function is in `monitored` state. Gate 3 detects that one or more detectors have gone silent past their freshness threshold, or an evidence source has stopped emitting.

**Flow.**

1. Gate 3 emits a Coverage Report with `overall: fail` and details on the specific detector(s) or evidence source(s) affected.
2. The Function transitions to `assurance_regressed`. This is distinct from `regressed` — the Function may still be behaving correctly, but the behavior cannot be verified from evidence. Trust without evidence is assumption, not trust.
3. The Operator investigates: is the detector genuinely broken, or has the evidence source drifted (schema change, pipeline reroute, topic rename)?
4. Remediation is technical, not architectural in most cases. The detector is restored, the evidence source is reconnected, the audit pipeline is repaired.
5. Once evidence flow is restored, the Function does not auto-return to `monitored`. It returns to `verified`, and Gate 2 must be re-run against the scenario corpus before promotion. The rationale is that the Function's behavior during the evidence-loss window is unverified; treating it as still-monitored would back-date trust to a period that had none.
6. If the evidence loss was prolonged or the evidence source has changed shape materially, the invariant's detector spec itself may require amendment. That is a PRD amendment and flows through the normal compiler path.

### 7.6 Scenario F — Architect override

**Precondition.** The Architect judges that a specific Gate verdict, permission denial, or rule application is wrong for a specific named situation and needs to be overridden.

**Flow.**

1. The Architect composes the override specification: the specific artifact or action, the verdict or rule being overridden, the rationale, the remediation plan, the expected duration, and the Architect identifier.
2. The Architect writes a DECISIONS.md entry with the override spec and the reasoning. The entry is tagged `OVERRIDE:` for easy query.
3. The override takes effect for the specific named artifact or action only. It does not generalize. An override on Function FN-123's Gate 2 failure does not relax Gate 2 for other Functions.
4. The override is recorded in episodic memory with high importance (≥ 9) and moderate pain score (≥ 6 — overrides are not free).
5. The remediation plan is tracked. When the plan completes, the override is closed with a second DECISIONS.md entry referencing the first.
6. If the override's expected duration is exceeded without closure, the memory-manager skill flags it for Architect attention as a stale override. Stale overrides are a diagnostic signal — they indicate either that the remediation is harder than expected (needs architect attention) or that the override has silently become permanent (which is a governance defect).

**Constraint.** Override frequency per month per Architect is tracked as an MOE. A rising rate is a signal that the Factory's gates are miscalibrated or that the Architect is fighting the Factory. The response is to investigate the pattern, not to relax the gates.

### 7.7 Scenario G — Dream cycle (nightly)

**Precondition.** The scheduled time (03:00 UTC by default) has arrived, or the dream cycle is manually invoked.

**Flow.**

1. The dream cycle script reads `.agent/memory/episodic/AGENT_LEARNINGS.jsonl` and computes salience for every entry.
2. Recurring patterns (two or more entries with matching skill + action prefix) are identified. For each cluster, the highest-salience exemplar is retained with `recurrence_count` updated.
3. Exemplars with salience ≥ 7.0 are candidates for promotion to semantic memory. The candidates are appended to `LESSONS.md` under an "Auto-promoted" section with the date. Duplicates against existing lessons are filtered.
4. Entries older than 90 days with salience below 2.0 are archived to `snapshots/archive_<date>.jsonl`. The entries are not deleted — the raw trace is preserved — but they leave the active episodic stream.
5. `WORKSPACE.md` is checked for staleness (last modified > 2 days ago). Stale workspaces are archived to `snapshots/workspace_<date>.md`.
6. The dream cycle commits the memory diff with a `META: dream cycle` commit message and emits counts to the log.
7. On Architect review the following morning, the auto-promoted lessons are inspected. Lessons that should not have promoted are manually reverted with a DECISIONS.md note; the salience thresholds are reviewed if the revert rate is high.

### 7.8 Scenario H — Bootstrap → Steady-State transition

**Precondition.** The first non-META Function has reached `monitored` state and survived one full dream cycle without regression. The Architect has reviewed the Bootstrap artifacts and judges the Factory ready for vertical work.

**Flow.**

1. The Architect drafts a Steady-State transition decision in DECISIONS.md, including the candidate first-vertical Function family and the rationale for transition readiness.
2. The transition is committed. The mode changes from Bootstrap to Steady-State. The change is logged to episodic memory with high importance.
3. The following operational rules activate:
   - Trajectory-driven Function birth is enabled.
   - Signal types `internal` and `meta` are deprecated for new Pressures; they remain valid for Bootstrap Pressures but new Pressures should use `market`, `customer`, `competitor`, or `regulatory`.
   - Role separation becomes strict — no single session fulfills both Coding Agent and Critic Agent for the same Function.
   - Coverage Gate failures no longer require Architect approval by default; only repeated or high-impact failures surface.
4. Bootstrap META-artifacts remain active. The Factory continues to operate on itself in Steady-State — dreaming, reviewing, regressing, birthing new META-Functions when the Factory itself changes — alongside its vertical work.
5. The first vertical PRD is authored by the Coding Agent for the agreed Function family and enters Stage 5 as the first non-META PRD. From here the flow is Scenario A with non-META artifact IDs.

## 8. Exception Handling

Operational exceptions — conditions the Factory must handle but that fall outside the nominal scenarios — are enumerated here. The Factory's philosophy on exceptions is: fail closed, log richly, escalate explicitly, remediate upstream. Silent failure is architecturally forbidden.

### 8.1 Compiler exceptions

**Pass-internal error.** A compiler pass produces a runtime error not anticipated by the schema. The compiler halts, writes the exception with full pass state to `.factory/intermediates/error-<timestamp>.json`, and returns exit code 1. The Coding Agent reads the state, reproduces the error locally, and files a `compiler` skill issue. No WorkGraph is emitted.

**UncertaintyEntry emission.** A pass cannot confidently produce an artifact. An UncertaintyEntry is written with `pass`, `source`, `reason`, and `suggested_resolution`. The compiler halts with exit code 20. The Architect or the Coding Agent resolves the uncertainty — either by amending the PRD, amending the pass's extraction heuristic (with a DECISIONS.md entry), or by marking the source as out-of-scope.

**Infinite loop or timeout.** A pass exceeds its configured time budget (default 120 seconds per pass). The compiler halts with exit code 30. The pass is flagged for performance review; this is a skill-level issue, not a PRD-level one.

### 8.2 Gate exceptions

**Gate 1 fails repeatedly on the same defect class.** The `on_failure` hook flags the relevant skill (usually `invariant-authoring` or `prd-compiler`) for self-rewrite. The Architect reviews whether the skill's template or the PRD author's convention is the root cause.

**Gate 2 fails with zero scenarios covering a branch.** The Coding Agent adds scenarios. If the branch is unreachable by design, the WorkGraph has a dead node, which is a Stage 5 defect — the PRD returns to compilation.

**Gate 3 fails on detector registration.** A new invariant's detector was specified but the detector was never instantiated at runtime. The Operator escalates to the Coding Agent to connect the detector; the Function is held at `verified` until Gate 3 can run.

### 8.3 Memory exceptions

**Episodic memory corruption.** A malformed JSONL line is encountered by the dream cycle or skill loader. The specific line is quarantined to `snapshots/corrupt_<date>.jsonl` with diagnostic context. The rest of episodic memory continues to operate. The Architect investigates whether the corruption source indicates a bug in the memory_writer helper.

**LESSONS.md drift.** An Auto-promoted lesson is later determined to be incorrect. The Architect reverts the lesson with a DECISIONS.md note explaining why. The promotion algorithm's threshold may be raised if revert rate exceeds a configured bound.

**Semantic / personal collapse.** A Coding Agent attempts to promote a personal preference into semantic memory as a general lesson. The `memory-manager` skill rejects the write. The attempt is logged; repeated attempts indicate a skill defect and surface for Architect review.

### 8.4 Role and authority exceptions

**Role boundary violation.** A Coding Agent attempts an action requiring Architect approval without going through the proposal mechanism. The pre_tool_call hook blocks the action; the attempt is logged with pain_score 9. Repeated violations flag the agent's session for review.

**Approval never arrives.** A proposal sits in the queue longer than the configured review SLA. The memory-manager surfaces it. If the Architect is unavailable (vacation, incident focus elsewhere), the Operator may defer the dependent action or reopen the proposal with revised scope.

**Override abuse.** The override rate exceeds the MOE threshold. The memory-manager surfaces the pattern; the Architect reviews whether the Factory's gates need calibration, whether the PRD quality needs to improve, or whether the override authority needs to be subdivided.

### 8.5 Adjacent-system exceptions

**WeOps unavailable.** The Factory does not depend on WeOps to produce Functions, but a Function may be commissioned under a Work Order that requires WeOps governance. If WeOps is unavailable, the Function can still be produced, but the commissioning cannot complete. This is a WeOps operational concern, not a Factory concern; the Factory continues to operate.

**Harness unavailable.** Claude Code is rate-limited or Cursor is down. Stage 6 cannot execute. The Factory enters Degraded mode for Stage 6 until the harness is restored. Functions in earlier stages continue to flow; Functions in `implemented` lifecycle waiting for validation stay there.

**Dropbox sync offline.** Artifacts can be authored in the local working tree but not propagated to the inbox. The Coding Agent logs the condition and batches commits for the restoration window. Architect review of inbox artifacts is paused until sync is restored.

### 8.6 Emergency exceptions

**Sev1 incident during Steady-State.** The Factory transitions to Emergency mode. The Incident Responder takes authority. The Factory's normal production pipeline is paused for the affected Function family; other families continue. The emergency is time-boxed to 4 hours by default; extensions require DECISIONS.md.

**Security compromise of a detector.** A detector is reporting false healthy judgments (compromised observer). This is the most severe Gate 3 failure because it looks like success. The Architect or Incident Responder manually invalidates the detector, transitions the affected Function to `assurance_regressed`, and forces Gate 3 to refuse the compromised signal. The compromise is treated as a sev1 until the detector can be reauthenticated.

**Loss of Architect availability.** In Bootstrap, this blocks most operations because Architect approval is required for many flows. The protocol is that a pre-named Operator with delegated authority (named in DECISIONS.md with explicit scope and duration) may act in the Architect's stead for routine approvals only — not for non-negotiable changes, and not for emergency declarations unless the delegation explicitly grants that authority. Delegation is rare and is itself a high-importance DECISIONS.md entry.

## 9. Interfaces to Adjacent Systems

### 9.1 WeOps

The Factory produces Functions. WeOps governs Work Orders. A Work Order may, when executed, run against a Function whose implementation is a WorkGraph. This is the only operational coupling between the two systems, and it is deliberately narrow.

**Outbound interface.** The Factory exposes a catalog of `monitored` Functions with their trust composites and lineage references. WeOps consumes this catalog when authoring Work Orders — a commissioning purpose that requires executable substrate looks up available Functions and cites them. The catalog is read-only to WeOps; WeOps does not modify Functions or their lifecycle.

**Inbound interface.** WeOps emits runtime governance events (CCI scores, POE enforcement events, PII composite updates) that may, for a Function that is routinely commissioned under Work Orders, produce signals the Factory ingests at Stage 1. These signals are typed `internal` and tagged with the originating Work Order ID for lineage.

**Non-interface.** WeOps does not modify Factory artifacts. The Factory does not modify WeOps artifacts. An operational tension between the two is resolved by the Architect or by a joint Architect-equivalent in WeOps; the tension is not resolved by direct write-through.

### 9.2 Cognifiq.ai

Cognifiq.ai is the Enterprise Cognition Loop — the epistemic runtime that produces organizational self-knowledge from the design→execution→feedback→learning arc. The Factory sits within Cognifiq.ai's observation boundary: Cognifiq.ai observes the Factory's operations and synthesizes them into organizational self-knowledge that flows to the vertical brands and to WeOps.

**Outbound interface.** The Factory emits its Coverage Reports, lifecycle transitions, and dream cycle outputs to Cognifiq.ai's ingest. Cognifiq.ai consumes these as evidence of the Factory's production quality and organizational learning.

**Inbound interface.** Cognifiq.ai may produce insights about the Factory's own operation — for example, detecting that certain Capability categories systematically produce Gate 1 failures in particular subpopulations of Coding Agents. These insights are signals to the Factory at Stage 1, typed `internal`, and may produce Pressures that result in Factory self-improvement.

**Non-interface.** Cognifiq.ai does not govern the Factory and does not modify Factory artifacts. Its role is epistemic, not operational.

### 9.3 Vertical brands

Vertical brands (CareGraf.ai, CareGraph.io, MiddleCare, ComeFlow, Canvas.ceo) are the customer-facing surfaces that deploy Factory-produced Functions. From the Factory's operational view, vertical brands are downstream consumers.

**Outbound interface.** The Factory publishes Functions in `monitored` lifecycle state to a catalog that vertical brands can consume. The catalog includes trust composite, invariant health, Coverage Report links, and deployment metadata.

**Inbound interface.** Vertical brands emit runtime signals from their deployments — user response, customer feedback, incident reports, regulatory events specific to the vertical. These signals enter the Factory at Stage 1 with the originating brand as `source` and flow through the normal Pressure/Capability pipeline.

**Non-interface.** Vertical brands do not directly modify Functions. A vertical brand that needs a new capability authors it as a Pressure-producing signal; the Factory's Stage 1–4 takes over from there. This preserves the I-layer discipline — verticals consume Factory output but do not intrude into Factory governance.

### 9.4 External harnesses

Claude Code, Cursor, OpenHands, SWE-agent, and similar coding agent harnesses are the execution substrates for Stage 6. The Factory is harness-agnostic; any harness that can read the WorkGraph schema and run the node topology (Planner, Coder, Critic, Tester, Verifier) is a valid Stage 6 host.

**Outbound interface.** The Factory emits a WorkGraph plus a node prompt pack (per skill file) plus context (PRD, relevant memory, tool schemas). The harness consumes these and executes.

**Inbound interface.** The harness emits execution traces — tool calls, generated code, test results, Critic findings. These flow back to the Factory as Stage 6 output and become input to Gate 2.

**Non-interface.** The harness does not modify Factory artifacts. The harness does not make Gate decisions. A harness that attempts to self-report Gate 2 pass without the Factory's Gate Evaluator running is an invalid harness.

## 10. Measures of Operational Effectiveness

MOEs are the signals by which the Factory's operation is judged. They are not KPIs in the product-management sense; they are diagnostic indicators that the Factory is producing trustworthy output and maintaining that trust over time.

### 10.1 Production MOEs

**Time from Signal to Pressure.** The elapsed time between a Signal entering Stage 1 and its inclusion in a Pressure cluster. Long times indicate underdeveloped clustering logic; very short times with small clusters indicate Pressure-inflation.

**PRD compilation success rate.** The fraction of compiler invocations that reach Gate 1 pass on the first run. A low rate indicates either that PRDs are being authored without sufficient rigor or that the compiler passes are mis-tuned for the PRD format in use.

**Gate 1 pass rate by defect class.** The rate at which each of the four coverage checks (atom, invariant, validation, dependency) fails. A concentrated failure class is a diagnostic signal — if invariant coverage is the dominant failure mode, the `invariant-authoring` skill needs reinforcement; if dependency closure is dominant, the Stage 4 proposal process is probably missing integration Functions.

**Time from PRD to `monitored`.** The elapsed time between PRD authorship and the Function reaching `monitored` state. Long times indicate Stage 6 or 7 bottlenecks; very short times suggest insufficient validation rigor.

### 10.2 Trust MOEs

**Trust composite by Function.** Continuous 0.0–1.0 score per Function. The distribution across all `monitored` Functions is the primary indicator of portfolio trust.

**Regression rate.** Number of Functions transitioning from `monitored` to `regressed` per week. A rising rate is a signal that either the underlying environment is changing faster than the Factory's detection keeps up, or that Gate 2's simulation coverage is insufficient.

**Assurance regression rate.** Number of Functions transitioning to `assurance_regressed` per week. This is distinct from behavioral regression and indicates evidence-layer decay. A rising rate is a signal that detector maintenance is falling behind; the remediation is operational (more detector attention) not architectural.

**Detector freshness distribution.** The distribution of "time since last report" across all active detectors. A long tail indicates systematic detector neglect.

### 10.3 Governance MOEs

**Architect override rate per month.** The most important governance MOE. A low rate indicates the Factory is operating within its own rules. A rising rate indicates that either the rules are miscalibrated or the Architect is fighting the Factory. Either way, a rising rate triggers investigation.

**Approval latency.** The distribution of time between proposal submission and Architect response. A growing tail indicates either Architect overload or proposal queuing inefficiency.

**DECISIONS.md write rate.** The rate at which architectural decisions are being logged. Steady rate is healthy; spikes indicate architectural churn, flat zero indicates stagnation or (worse) undocumented decisions being made.

**Role boundary violation rate.** The rate at which Coding Agents attempt actions requiring approval without going through the proposal mechanism. A rising rate indicates skill regression — the agent has forgotten its constraints.

### 10.4 Closure MOEs

**Trajectory detection hit rate.** The fraction of Trajectories that eventually produce a FunctionProposal that passes the birth gate. A very low rate (below 5%) indicates trajectory detection is over-sensitive; a very high rate (above 40%) indicates it is under-sensitive or the birth gate is too loose.

**Time from Trajectory to new Function `monitored`.** The full cycle time for trajectory-driven closure. Long times indicate bottlenecks in Architect review, PRD authoring, or harness execution.

**FunctionBirthScore distribution.** The histogram of birth scores across proposals. Bimodality indicates a well-calibrated system (clear birth vs. no-birth decisions); unimodal near the threshold indicates the threshold is in the middle of natural variance and needs recalibration.

**Meta-Function churn.** The rate at which the Factory's own META-Functions are being regressed or reborn. Some churn is healthy (the Factory is learning about itself). Accelerating churn is a diagnostic signal that the Factory's foundations are unstable.

### 10.5 MOE review cadence

MOEs are computed continuously but reviewed at the following cadences:

- **Per-release:** production MOEs checked against targets before any Steady-State release.
- **Weekly:** governance MOEs reviewed by the Architect in the scheduled review slot.
- **Monthly:** trust and closure MOEs reviewed with the full role set; patterns surfaced as candidate DECISIONS.md entries.
- **Quarterly:** full MOE review with calibration of thresholds, targets, and any structural changes to the MOE set itself. Changes to the MOE set are architectural and require DECISIONS.md.

## 11. Transition Plan: Bootstrap → Steady-State

### 11.1 Bootstrap completion criteria

Bootstrap is complete when all of the following hold:

1. At least one non-META Function has reached `monitored` lifecycle state and has survived one full dream cycle (24h) without regression.
2. The full set of six META-Pressures (from the whitepaper's non-negotiables) have been translated into formal Pressure artifacts, compiled through to WorkGraphs, implemented, and reached `monitored` state.
3. All three Coverage Gates have been exercised: Gate 1 has passed at least three compilations, Gate 2 has promoted at least one Function, Gate 3 has been continuously active for at least 7 days without silent failure.
4. At least one dream cycle has run and promoted at least one episodic pattern to semantic memory, and the promotion was reviewed and accepted (not reverted) by the Architect.
5. The Architect has reviewed Bootstrap Coverage Reports and is satisfied that the gates are detecting actual specification defects, not producing noise.
6. A candidate first-vertical Function family has been identified and the Architect has authored a DECISIONS.md entry naming it as the Steady-State first work.

### 11.2 Transition ceremony

The transition from Bootstrap to Steady-State is explicit and ceremonial — not because ceremony is valuable in itself, but because the event needs to be unambiguous in the audit trail.

The Architect writes a DECISIONS.md entry titled `Transition: Bootstrap → Steady-State` with:
- The completion-criteria evidence (with links to Coverage Reports, Function IDs, dream cycle commits).
- The first vertical Function family name and rationale.
- The set of operational rules that change at the transition (enumerated per §4.2).
- The expected timeline for the first vertical PRD.
- The Architect's identifier and the UTC timestamp.

This entry is committed with `META: transition bootstrap to steady-state`. The mode-tracking state (wherever it lives — an env var, a config file, or a memory marker) is flipped. Episodic memory records the mode transition.

### 11.3 Steady-State ramp

Steady-State does not begin at full intensity. The first week of Steady-State operates with:
- One vertical Function family in flight.
- Bootstrap rules still partially active (Architect reviews all Gate 1 failures, trajectory-driven Function birth disabled).
- Daily Architect touch-base on operational MOEs.

Over the following weeks:
- Additional vertical Function families are admitted.
- Trajectory-driven Function birth is enabled (Architect confirmation required).
- Daily touch-base shifts to weekly scheduled review.
- Bootstrap-phase exceptions (every-gate-failure approval) relax to the Steady-State defaults.

The ramp is paced by MOE observation, not by calendar. If the production MOEs are deteriorating, the ramp pauses. If the governance MOEs show rising override rate, the ramp pauses. The objective is not to reach full Steady-State as fast as possible; the objective is to reach it with trust signals intact.

### 11.4 Regression from Steady-State

If, during Steady-State, conditions arise that invalidate the transition assumptions — a systematic Gate failure pattern, a cascade of regressions, a loss of Architect confidence in the Factory's self-consistency — the Factory can regress to Bootstrap mode. This is a significant operational event: it suspends vertical production, reactivates Bootstrap rules, and restricts new work to META-Functions.

Regression to Bootstrap is declared by the Architect in a DECISIONS.md entry with full rationale and an exit plan back to Steady-State. The expectation is that this happens at most once or twice in the Factory's lifetime; more often indicates that Steady-State is being entered prematurely and the Bootstrap completion criteria should be tightened.

## 12. Governance and Change Control

### 12.1 Change classes

Changes to the Factory are classified by what they affect:

**Class A — Non-negotiable changes.** Changes to the whitepaper's six non-negotiables, the Coverage Gate formulas, the lineage primitives, or this ConOps's authority model. These require Architect authorship and produce a new whitepaper or ConOps version. Class A changes are rare and architecturally significant.

**Class B — Architectural changes.** Changes to schemas, skills, permissions, or mode rules that don't rise to Class A. These require Architect approval via DECISIONS.md but don't require new document versions unless they affect external behavior.

**Class C — Operational changes.** Changes to specs/, memory/ (outside seeded lessons), Coverage Reports, episodic entries. These are routine and do not require approval beyond the role's normal authority.

**Class D — Emergency changes.** Changes made during Emergency mode that bypass normal approval flow. These require post-hoc documentation in DECISIONS.md once the emergency is cleared; changes that cannot be documented are treated as governance defects.

### 12.2 Proposal mechanism

Non-Architect roles propose Class A or Class B changes through the DECISIONS.md proposal mechanism:

1. A draft DECISIONS.md entry is written with the proposed change, rationale, alternatives considered, and expected effects.
2. A draft pull request is opened referencing the draft entry.
3. The Architect reviews. Response is approve (possibly with inline amendments), defer (with expected review window), or decline (with rationale).
4. On approve, the entry is merged and the implementation PR can proceed. On defer, the proposal sits in the queue. On decline, the proposal is closed with the rationale preserved in episodic memory.

### 12.3 Version control and audit

Every artifact in `specs/`, every file in `.agent/memory/semantic/`, every Coverage Report, and every implementation file in `packages/*/src/` is under git version control. Every commit carries an artifact-ID-prefixed message. The git log is therefore a full lineage trace of the Factory's operational history.

Audit is performed by reading git log against the Auditor's read scope. An auditor reconstructing a Function's history walks the lineage chain: Signal → Pressure → Capability → FunctionProposal → PRD → WorkGraph → implementation commits → Coverage Reports → runtime events. Every edge of the chain is a git commit with explicit rationale.

### 12.4 ConOps review and revision

This ConOps is reviewed:

- **On transition events.** When the Factory transitions modes (Bootstrap → Steady-State, or into/out of Degraded or Emergency), the relevant sections of this document are reviewed against operational reality.
- **On MOE shifts.** When MOEs drift outside their expected ranges, the sections of this document that govern those MOEs are reviewed.
- **Quarterly.** The full document is read by the Architect against current operational state.
- **On architectural change.** Any Class A or Class B change triggers review of the affected sections.

Revisions produce a new ConOps version. Old versions remain in git history and are referenced by their commit SHA where they need to be cited as the operational context of a past event. This is important for audit: an event under ConOps v1 cannot be judged against ConOps v2.

### 12.5 The living-document discipline

A ConOps is a living document. Its value is not that it describes how the Factory operates today, but that it describes how the Factory is *intended* to operate — and thereby makes deviations visible. When operational reality diverges from this document, one of two things is true: the document needs revision, or the operation needs correction. The divergence itself is a signal.

The Architect's weekly review includes a brief check against this document: are the workflows described here what's actually happening? Are the roles described here occupied and bounded as specified? Are the MOEs being computed and reviewed at the stated cadence? When the answer is no, the divergence is logged and one of the two corrections is authored.

A ConOps that drifts silently from operational reality becomes a fiction. The discipline of keeping it current is itself a Factory non-negotiable.

---

## Closing

The Function Factory is infrastructure. Its operation is not visible to customers, is deeply visible to the Architect, and is mediated through a small set of bounded roles with clear authority and explicit information flows. The Factory's power comes from the discipline of its operation, not from sophistication that evades that discipline.

This ConOps is the doctrinal specification of that discipline for Koales.ai. It will be revised as the Factory matures and as operational reality teaches lessons this first version could not anticipate. Every revision preserves the core: the Factory operates on lineage, under gates that fail closed, through roles with bounded authority, with memory that makes the operation reflexive, and under a closed loop that turns environmental pressure into trustworthy executable Functions and back again.

The Architect's role is to keep the doctrine honest. The Coding Agent's role is to execute within it. The Gate Evaluator's role is to enforce it without discretion. The Operator's role is to watch what the system cannot watch itself. The Auditor's role is to see the patterns no session can see. The Critic Agent's role is to ensure no output advances without scrutiny. The Incident Responder's role is to act when normal flow has broken and must be restored.

Together, those roles operating under this ConOps constitute the Factory in operation. The whitepaper describes the machine. This document describes how to run it.

---

## Revision history

- **v1 (2026-04-18):** Initial seed ConOps. Scope: Koales.ai, full lifecycle including Steady-State. Seven roles, four modes. Authored by Wislet J. Celestin.
