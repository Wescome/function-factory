# The Function Factory

## An Upstream-to-Downstream Compiler for Trustworthy Executable Functions

**Author:** Wislet J. Celestin
**Affiliation:** Koales.ai / WeOps Research
**Status:** Conceptual whitepaper; v4 inbox draft (supersedes v1–v3; v4 adds the Spec Coverage section with three explicit gates)
**Date:** 18 April 2026
**Related work:** Archon (Stanford, 2024); StrongDM Dark Factory (2025); Zhou et al., *Externalization in LLM Agents* (arXiv:2604.08224, 2026); WeOps/WGSP Executive Whitepaper (WP-2026-EP-01)

---

## 1. Why another name

There is a growing class of systems that all promise to turn specifications into software without human code review. Archon searches over reasoning architectures to optimize multi-model inference-time composition. StrongDM's dark factory pushes specs through autonomous agents until scenario validation passes. Claude Code, Cursor, OpenHands, and SWE-agent operationalize variations of the same idea inside development harnesses. Spec Kit, BMAD, and Open Spec attempt to make the upstream specification itself a first-class artifact.

Each of these systems is coherent within its scope. None of them is a complete picture. They all treat the spec as a given input and the generated artifact as a terminal output. Everything between is optimization. Everything upstream of the spec is left to humans. Everything downstream of deployment is left to observability tools that do not connect back to the spec.

The Function Factory is the name for what happens when you refuse to stop at either boundary — when you insist that specifications are themselves derived from external pressure and internal drift, that generated artifacts must prove they still honor their original intent after deployment, and that the detection of runtime drift must automatically propose new specifications that feed back into the same compiler. It is a closed-loop compiler for reality rather than a forward-only code generator.

This whitepaper describes that system as a complete architecture. It names Function as the canonical executable unit, defines the seven-stage pipeline that produces and maintains Functions, and locates the Factory precisely relative to adjacent concepts — including WeOps, which operates at a categorically different layer and must not be confused with what the Factory does.

## 2. The canonical unit: Function

The thread that produced this framework walked through several candidate names for the core executable unit — Capability, Decision-Capability, Executable Capability, Governed Capability, Decision Surface, Instrument — and rejected each one. Capability is too static; it hides execution and carries no decision logic. Instrument captures action, measurement, and feedback but reads as a metaphor rather than a technical primitive. Decision is too narrow; many Functions do no branching and still deserve the same treatment. Workflow is too procedural. Feature is too product-y. Service is too implementation-bound.

The name that survives is **Function**. It is deliberately the most boring word in the list. Its virtue is that every concept the Factory needs maps into it without distortion:

- A Function *executes* — it takes inputs and produces outputs. That is what the dark factory builds.
- A Function is *composable* — functions chain into workgraphs, compose higher-order, participate in graphs of dependencies. That is what the compiler assembles.
- A Function is *testable* — validations and invariants become signature constraints, preconditions, postconditions, and property-based checks. That is what verification proves.
- A Function is *governable* — constraints, policies, and authority become parameters, domain restrictions, and typed contracts. That is what the control plane enforces.
- A Function is *monitorable* — health, trust, freshness, and regression are all observable properties of a deployed Function. That is what the runtime closes the loop on.

A Function in this framework is not the same as a function in a programming language, though it maps onto one cleanly. It is a bounded, composable, governable, verifiable, and monitorable unit of behavior that carries:

- **Intent** — what it is for, in compressed human-readable form
- **Contract** — its signature, preconditions, postconditions, and behavioral promises
- **Invariants** — persistent truths it must preserve across all invocations
- **Validations** — the tests, scenarios, and property checks that prove the contract and invariants hold
- **Implementation** — the WorkGraph of nodes and edges that realizes it
- **Runtime indicators** — health, trust, freshness, incident links
- **Status** — its current position in the lifecycle (designed, planned, in progress, implemented, verified, monitored, regressed, retired)

Every artifact the Factory produces is a Function. Every artifact the Factory maintains is a Function. When Functions degrade, the Factory produces new Functions. The unit of accounting is stable across the entire pipeline.

### 2.1 WorkGraph is not Work Order

One distinction needs to be made before the stages are described, because the surface vocabulary invites collapse. A **WorkGraph** is the compiled implementation of a Function — a typed directed graph of nodes and edges produced by the Stage 5 compiler and executed by the Stage 6 agent topology. A WorkGraph is a Factory artifact. It is an I-layer object. It specifies *how a Function is built*.

A **Work Order** is something different. It is an organizational act of commissioning — an instance of work being issued under purpose, governed by WeOps primitives (Constraint Chain Index, Purpose Over Execution, Purpose Integrity Index, the We-Gradient). A Work Order is a We-layer object. It specifies *why a piece of work is being commissioned and under what purpose constraints it must remain coherent*.

A Work Order may, when executed, run against a Function whose implementation is a WorkGraph. But the Work Order is not a WorkGraph, and the WorkGraph is not a Work Order. The Factory produces WorkGraphs. WeOps governs Work Orders. Conflating them erases the I/We boundary that makes the two systems legible as distinct.

## 3. The seven stages, in order

The Function Factory is a compiler. Like any compiler it has passes, and like any compiler the passes have strict ordering with narrow responsibilities. The seven stages are:

**Stage 1 — Signals.** External signals (market, customer, competitor, regulatory) and internal signals (runtime telemetry, audit events, incidents, trajectory drift) are normalized into a single evidence envelope. A signal is not yet a problem. It is raw material. Normalization means applying a canonical schema with source, timestamp, confidence, severity, frequency, and entity tags. At this stage the system makes no interpretation. It only ensures signals are comparable.

**Stage 2 — Pressures.** Signals cluster into Pressures. A Pressure is the Factory's runtime object for what is formally a **Forcing Function**: an external driver on the organization that compels a response. The term is used in the control-theory sense — the `F(t)` term in a driven dynamical system that the system must work against — not the colloquial "deadline that forces action" sense, though the colloquial reading is a correct informal projection of the same idea. A Pressure has a category (growth, retention, reliability, compliance, risk, efficiency, competitive gap, trust), a strength, an urgency, a frequency, and a confidence. It is always derived from one or more signals with lineage preserved. Pressures are not features, requirements, or projects. They are the organization's felt experience compressed into a structured forcing term that the downstream stages must respond to.

**Stage 3 — Business Capabilities.** A capability is the organization's durable ability to respond to a Pressure. It is named as an ability, not an implementation. In the dynamical-system framing of Stage 2, a capability is a **transfer function** — the structure by which forcing is converted into response. At this stage the Factory enforces three guardrails. First, do not jump from signal to feature; the pressure-to-capability intermediate is required. Second, every capability must yield three kinds of Functions downstream: execution, control, and evidence. Third, merge top-down and bottom-up proposals rather than duplicating them; a capability the business asks for and a capability runtime drift implies may be the same capability.

**Stage 4 — Capability Delta and Function Proposals.** For each capability, the Factory computes what is missing, degraded, or underutilized. The delta generates Function proposals, each typed as execution, control, evidence, or integration. Execution Functions do the work. Control Functions constrain it. Evidence Functions prove it happened and measure its quality. Integration Functions connect to external substrates. Proposals are not yet PRDs. They are candidate Functions with expected inputs, expected outputs, governing constraints, candidate invariants, and success signals.

**Stage 5 — PRD Drafts and the Compiler.** Each Function proposal gets drafted into a PRD, and each PRD is compiled through eight narrow passes: normalize, extract atoms, derive contracts, derive invariants, derive dependencies, derive validations, consistency check, assemble WorkGraph. Each pass preserves source references, separates explicit claims from inferred ones, emits exactly one semantic claim per object, uses canonical verbs, fails closed on ambiguity, and writes an uncertainty ledger. The output is a WorkGraph — a typed directed graph of nodes and edges that the multi-agent execution layer can realize.

**Stage 6 — Dark Factory Execution.** The WorkGraph is handed to a fixed node topology of cooperating agents: Planner produces execution plans from target nodes and constraints; Coder produces bounded patch proposals against repository contracts; Critic finds defects, scope violations, missing validations, and invariant risks; Tester selects and interprets validations; Verifier chooses among pass, patch, resample, interrupt, or fail. Each node is a state-transform contract with strict read access, write access, do-not rules, output contract, and a JSON-only footer. Nodes behave like small pure functions over shared state. They do not share memory, hidden assumptions, or cross-cutting ambient context. This is the only stage that touches code.

**Stage 7 — Simulation, Validation, and Convergence.** Generated artifacts are run through Digital Twin Universes — simulated environments where scenarios execute against invariants and validations. Scenario success rates, constraint violations, and edge-case failures compose a loss function. Artifacts that pass validation are deployed; artifacts that fail trigger a repair loop bounded by maximum iteration count. Once deployed, runtime telemetry feeds invariant health detectors, trust composes from correctness/compliance/observability/stability/user response, and regression is detected when previously trusted evidence becomes insufficient. Regressions propagate through an assurance dependency graph — not through vague service adjacency, but through broken guarantees another Function depended on.

These seven stages form a pipeline only on paper. In practice they form a loop, because Stage 7's runtime signals feed back into Stage 1, which is the thing that makes this a compiler for reality rather than a one-way artifact generator.

## 4. Closing the loop: trajectory-driven Function birth

Most systems in this space stop at Stage 7 as a terminus — the artifact is deployed, observed, and possibly retired when it fails. The Factory treats Stage 7 as a recursion. Drift detected in running Functions is not merely evidence of failure; it is *unmet Function demand*.

The closure works through four objects. A **Trajectory** captures the observed change in a set of related metrics over a time window, with drift type, dimensions (frequency, severity, coupling, latency, recovery cost), and links to supporting evidence. A **ProblemFrame** translates a Trajectory into an explicit problem statement naming the system area, likely failure modes, currently impacted Functions, and unmet needs. A **FunctionProposal** generated from a ProblemFrame proposes one of three kinds of response: reinforcement of an existing Function, creation of a new supporting Function, or boundary refactor splitting or reshaping existing Functions. A **FunctionBirthScore** ranks proposals by drift severity, recurrence, cross-Function coupling, recovery cost, expected leverage, minus implementation cost and overlap with existing Functions.

High-scoring proposals are auto-drafted into PRDs, which enter Stage 5 as first-class inputs alongside human-authored PRDs. Crises stop being just incident-response triggers and become design-synthesis triggers.

One constraint is mandatory: the system must not auto-birth Functions from every noisy fluctuation. A birth gate — confidence threshold, recurrence requirement, human review for high-impact proposals — is required to prevent proposal inflation. The gate is not an afterthought; it is the thing that keeps the loop from becoming pathological.

## 5. Trust, invariants, and the assurance dependency graph

The Factory's runtime stage depends on three ideas that together form its most original contribution, because most agent-stack literature handles these poorly or not at all. The deeper framing is that Stage 7 is a closed-loop controller: Pressures are the forcing function, deployed Functions are the plant, validation outcomes and runtime telemetry are the error signal, and trajectory-driven Function birth is the controller's update action. The three ideas below are the instruments that make that loop computable.

**Invariant health is a computed signal, not a compliance checkbox.** Each invariant has a detector spec with direct rules (events that constitute a direct violation), warning rules (events that raise suspicion), evidence sources (the telemetry and audit streams the detector reads), incident tags, and a regression policy mapping judgments to status transitions. Invariant health is a continuously updated score from 0.0 to 1.0, computed from direct violations, warning signals, open incidents, and monitoring staleness. Functions roll up invariant health with weighted impact (high, medium, low), subject to one hard rule: if any critical invariant is broken, the Function cannot remain trusted, regardless of average score.

**Trust is composed from five dimensions**, each a score from 0.0 to 1.0: correctness (does it do what the contract says), compliance (does it honor policy), observability (can its behavior be verified from evidence), stability (does it behave consistently under stress), and user response (do users rely on it and succeed). Trust is weighted 30/25/20/15/10. Trust feeds invariant health, and invariant health feeds Function status. The lifecycle state *regressed* is triggered when a previously verified or monitored Function loses trust — not when anything changes, but when trusted evidence is invalidated. Four regression classes are distinguished: validation regression, runtime invariant regression, assurance regression (losing visibility is itself a regression), and incident regression (a production incident linked to the Function's invariants).

**Incidents propagate through an assurance dependency graph**, not through service adjacency. Five dependency types are modeled: execution (one Function calls another), evidence (one Function's evidence is consumed by another), policy (one Function's policy decisions govern another), shared invariant (both Functions depend on the same invariant), and shared adapter (both Functions route through the same integration substrate). An incident propagates only through broken guarantees another Function actually depends on. Propagation is typed — watch, degraded, regressed — and modified by criticality, fallback availability, isolation boundary, evidence confidence, and temporal freshness. A shared-invariant incident triggers recomputation for all governed Functions; a shared-adapter incident triggers recomputation for all dependent Functions; but neither triggers a cascade through unrelated services just because they share a cluster or a team.

This assurance graph is what makes incident response legible. Most observability stacks tell you that service X is degraded and leave you to infer what that means for the business. The Factory tells you that Function F is regressed because Invariant I is violated because Detector D emitted a direct-rule match in Evidence Source E, and it tells you the blast radius by walking the assurance graph rather than the service mesh.

## 6. Spec Coverage and the Three Gates

Trust computation and assurance propagation only work if the specifications being measured are actually complete. A Function whose invariants are aspirational, whose validations cover nothing, or whose detectors have silently gone stale is not trustworthy — it only looks trustworthy because the scoreboard does not know what is missing. Coverage is the discipline that keeps the scoreboard honest.

The Factory treats coverage as a staged concern with three explicit gates, each fail-closed, each producing a lineage-preserving Coverage Report that names the specific atoms, invariants, validations, or detectors that fell short.

### 6.1 What coverage means

Coverage in the Factory is not a single metric. It is four distinct relationships that must each hold:

- **Atom coverage.** Every requirement atom extracted from the PRD in Pass 2 of the compiler must yield at least one downstream artifact — a contract, an invariant, or a validation. Atoms that produce no downstream artifact are dead specification: the organization stated something and the system did nothing about it.
- **Invariant coverage.** Every invariant must have at least one validation that tests it *and* at least one detector specification that watches it at runtime. An invariant without a validation is untested. An invariant without a detector is a wish. Both are required; neither alone is sufficient.
- **Validation coverage.** Every validation must map back to at least one atom, contract, or invariant it covers. Validations that cover nothing are dead tests — they run, they pass, they prove nothing about the specification. The backmap is mandatory.
- **Dependency closure.** Every dependency declared in Pass 5 must resolve to two endpoints that both exist in the WorkGraph. Dangling dependencies mean the graph is incomplete and the execution contract is not honored.

These four relationships form the spec-coverage substrate. The three gates below each compute a subset of them at the appropriate stage of the pipeline.

### 6.2 Gate 1 — Compile Coverage Gate (end of Stage 5)

The Stage 5 compiler's existing eighth pass is named `consistency_check`. In a first build of the Factory this pass is informal. The Compile Coverage Gate hardens it into an explicit, fail-closed computation that runs between Pass 7 (`consistency_check`) and Pass 8 (`assemble_workgraph`).

It computes:

- **Atom coverage** — every PRD atom has ≥1 downstream contract, invariant, or validation.
- **Invariant coverage (spec side)** — every invariant has ≥1 validation covering it *and* ≥1 detector spec naming its evidence source. The detector spec need not be runtime-live yet; at compile time only its presence and well-formedness are checked.
- **Validation coverage** — every validation backmaps to ≥1 atom, contract, or invariant.
- **Dependency closure** — every declared dependency resolves to two WorkGraph-resident endpoints.

If any of the four fails, the WorkGraph is not emitted. The compiler returns a Coverage Report listing each failure by artifact ID and source reference. The PRD does not compile. A failed compile is a specification defect, not an engineering task — remediation happens upstream, in the PRD or in the Function proposal that produced it.

This is the first and strictest gate because it is the cheapest: compile-time failures are caught before any code is generated, before any agent is invoked, before any harness is loaded. The cost of failing this gate is the cost of re-running the compiler. The cost of *not* having this gate is a generated implementation that passes Stage 6 and only discovers its specification gap in Stage 7, where the diagnostic trail is orders of magnitude noisier.

### 6.3 Gate 2 — Simulation Coverage Gate (within Stage 7, before `verified` → `monitored`)

Compile coverage proves the specification is internally complete. It does not prove the implementation actually exercises that specification in practice. That is what the Simulation Coverage Gate is for. It runs during Stage 7, after the generated artifact has been deployed into the Digital Twin Universe but before the Function lifecycle can transition from `verified` to `monitored`.

It computes:

- **Scenario coverage** — every branch in the WorkGraph has been exercised by at least one scenario. Unreached branches are either dead code or untested code; either way the Function is not ready for production trust.
- **Invariant exercise** — every invariant has at least one scenario that could plausibly violate it. A negative test must exist, even if it never fires. An invariant with only positive tests has not been proven; it has been assumed.
- **Required-validation pass rate** — 100% of required validations pass in the Digital Twin. Below 100% is not partial credit; it is a fail.

If any of the three fails, the Function cannot be promoted to `monitored`. It remains in the `verified` state — it has passed compile coverage and its required validations in isolation, but the system does not yet trust it in a production sense. The Function is deployable (the harness can run it) but it is not governed (the trust computation refuses to certify it).

This gate is where the Factory separates itself from spec-to-code systems that treat "all tests passing" as a shipping condition. The Factory requires that tests passing *on a complete scenario corpus* is the shipping condition, and it enforces that by refusing to grant the `monitored` lifecycle state without it.

### 6.4 Gate 3 — Assurance Coverage Gate (continuous, Stage 7)

The first two gates are one-shot: they run at specific points in the pipeline, and once passed, their verdict is recorded. The Assurance Coverage Gate is different. It runs continuously, as a property of every Function that has reached `monitored` status, and its job is to ensure that the runtime evidence base under the Function has not silently decayed.

It computes, per Function, per invariant:

- **Detector freshness** — every invariant's detector has reported within its freshness threshold. A detector that has gone 24 hours without emitting either a healthy or a violation judgment is not passing silently; it is missing. Silence is not evidence of correctness.
- **Evidence source liveness** — every named evidence source (telemetry stream, audit topic, incident channel) is still emitting at expected cadence. An evidence source that has gone quiet because of a pipeline change, a schema drift, or a deployment error invalidates every detector that consumes it.
- **Audit pipeline integrity** — every action that should produce an audit event is producing one. Under-auditing is a regression. The system compares expected audit volume against observed audit volume and flags divergence.

If any of the three fails, the Function transitions from `monitored` to `assurance regressed` — the fourth regression class named in §5. This is not a runtime bug regression; the Function may still be behaving correctly. It is a loss of visibility regression. A Function whose behavior cannot be verified from evidence is untrustworthy by definition, regardless of whether its actual behavior is sound.

The Assurance Coverage Gate is what closes the loop on observability. Traditional observability stacks treat "the monitor is down" as an operations problem to be fixed later. The Factory treats it as a first-class regression of the Function that the monitor was watching, because trust without evidence is not trust — it is assumption.

### 6.5 Staging summary

| Gate | Stage | Trigger | Failure consequence |
|---|---|---|---|
| Compile Coverage | End of Stage 5 | Between `consistency_check` and `assemble_workgraph` | WorkGraph is not emitted; PRD must be remediated |
| Simulation Coverage | Within Stage 7 | Before `verified` → `monitored` transition | Function stays `verified`, cannot be promoted |
| Assurance Coverage | Continuous in Stage 7 | Every detector reporting interval | Function transitions to `assurance regressed` |

Each gate's output is a **Coverage Report** — a lineage-preserving artifact that names the specific atoms, invariants, validations, or detectors that failed coverage, with source references back to the PRD or WorkGraph element that produced them. Coverage Reports are themselves Factory artifacts. They are auditable, versioned, and archived alongside the Functions they concern.

### 6.6 What coverage is not

Coverage as defined in this section is strictly an I-layer discipline. It measures whether the Factory's own artifacts — atoms, invariants, validations, detectors — are internally complete and mutually consistent. It does not measure whether the aggregate portfolio of Functions adequately covers the commissioned work the organization is actually issuing Work Orders against. That is a We-layer question and it belongs to WeOps, not to the Factory.

The distinction matters. A Function may pass all three coverage gates — compile, simulation, assurance — and still be the wrong Function for the commissioning purpose it is being executed against. Spec coverage proves internal completeness of the specification-to-execution chain. Purpose coverage, which WeOps measures through the Purpose Integrity Index and the Constraint Chain Index, proves that commissioned work remains coherent with organizational intent. Conflating them is the same I/We collapse warned against throughout this document. The Factory should produce Functions that pass all three gates; WeOps should govern whether the right Functions are being commissioned in the first place.

## 7. SWOT, made executable

The upstream stages of the Factory — Signals, Pressures, Capabilities — are what SWOT analysis has always tried to capture and has never been able to execute on. SWOT sits in decks. It informs strategy conversations. It is almost never an input to anything that produces software. The Factory's claim is that this is not a limitation of SWOT as a concept; it is a limitation of SWOT as a format. SWOT made executable is the Factory's Stage 1 through Stage 4.

The mapping is direct:

- **Threats** → external Signals of type `market`, `competitor`, or `regulatory` → Pressures with categories `risk`, `compliance`, or `competitive_gap`. These are Forcing Functions that demand new or strengthened Function proposals.
- **Opportunities** → external Signals of type `market` or `customer` → Pressures with categories `growth` or `trust`. These are also Forcing Functions, with positive valence — response is rewarded rather than required.
- **Strengths** → Business Capabilities whose existing Function portfolio is verified or monitored, with high trust composites. In the dynamical framing, Strengths are capabilities with **strong resonance** to common forcing patterns: the response is already tuned, high-gain, low-cost.
- **Weaknesses** → Business Capabilities whose Capability Delta is non-empty, or whose existing Functions are regressed, or whose invariant health is low. In the dynamical framing, Weaknesses are **damping deficits**: forcing arrives but the response machinery is incomplete, disproportionate disturbance results.

The operational consequence is substantial. A SWOT exercise performed against the Factory's vocabulary is no longer a strategy offsite artifact. It becomes a specification for which Pressures to prioritize (Threats with high strength and urgency; Opportunities with high leverage), which Capabilities to extend (Weaknesses with high Capability Delta scores), and which Functions to protect (Strengths whose trust composites are at risk from upstream change). The four SWOT quadrants become structured inputs to Stages 2, 3, and 4 — with preserved lineage from the strategy artifact all the way down to the compiled WorkGraph.

This is the difference between SWOT as a discussion tool and SWOT as an input schema. The Factory makes it the latter. Strategy teams and engineering teams end up working against the same vocabulary without either having to translate.

## 8. What the Factory is not

Three boundaries matter.

**The Factory is not a harness.** Zhou et al.'s externalization program describes harness engineering as the discipline of unifying memory, skills, and protocols around a single agent at runtime. The Factory uses a harness — Claude Code, Cursor, OpenHands, or a custom conductor — during Stage 6 to execute the WorkGraph. But the Factory itself operates above the harness, coordinating multiple agent invocations across the seven stages. A Function produced by the Factory might be executed by an agent running in a harness; the Function itself is not a harness artifact. The harness governs *how a single agent behaves during an execution*. The Factory governs *how Functions are born, verified, deployed, and maintained over time*.

**The Factory is not WeOps.** This is the most important distinction to keep clean, because the surface rhetoric is adjacent and will tempt conflation. The Factory produces executable Functions and keeps them trustworthy against their own invariants. That is an **I-layer** activity in the taxonomy of the I/We Boundary note — it concerns individual executable units and their scaffolding. WeOps governs *commissioned work against organizational purpose* across many Functions, many agents, many humans, and many harnesses. The We-Gradient, CCI (Constraint Chain Index), POE (Purpose Over Execution), and PII (Purpose Integrity Index) are runtime organizational governance instruments measuring whether aggregate execution honored commissioning purpose. A Function with perfect invariant health and full trust can still be executed against a commissioning purpose that has silently drifted; the Factory does not detect that, and is not supposed to. WeOps detects that. They need each other, and they are not the same layer.

The clean one-line distinction: the Factory produces **WorkGraphs** (the typed DAGs that implement Functions); WeOps governs **Work Orders** (the organizational acts that commission work under purpose). A Work Order may run against a Function whose implementation is a WorkGraph. The two are related, not identical, and the distinction is what keeps both frameworks legible.

**The Factory is not a code generator.** If Stage 6 were the terminus, the Factory would reduce to dark-factory-style agent swarm output. The upstream stages (signals → pressures → capabilities → deltas → proposals → PRDs) and the downstream stages (simulation → validation → trust → regression → trajectory → new proposals) are the differentiating structure. Removing them turns the Factory into something StrongDM already sells. Keeping them is what makes it a compiler for reality.

## 9. Positioning against adjacent systems

**Archon** searches over reasoning architectures and inference-time techniques to optimize multi-model composition. The Factory uses Archon-style search during Stage 5 (selecting the right topology and model binding for PRD compilation passes) and Stage 6 (selecting the right agent workflow for the WorkGraph). Archon is a component technology, not a competitor. Where Archon stops at architecture search, the Factory continues into simulation, validation, trust computation, and trajectory-driven closure.

**StrongDM Dark Factory** treats autonomous software production as specs → agents → scenario validation → production artifact, with Digital Twin Universes for realistic simulation. The Factory adopts Dark Factory as Stage 6 plus most of Stage 7. It adds the full upstream (signals through PRD drafts) and the trajectory-driven feedback that auto-generates new Function proposals from runtime drift. Dark Factory produces software. The Factory produces and maintains a living portfolio of trustworthy Functions.

**Claude Code, Cursor, OpenHands, SWE-agent, and similar coding agents** provide the harness within which Stage 6 executes. The Factory is harness-agnostic. The WorkGraph and node prompt pack are designed to be read by any compliant harness. When a harness is good (Claude Code and Cursor both qualify), the Factory delegates Stage 6 to it and focuses its own engineering on the stages no harness currently handles.

**Spec Kit, BMAD, and Open Spec** are attempts to formalize the upstream specification layer. The Factory's Stage 5 compiler is more structured than any of these because it explicitly separates the eight passes with strict responsibilities and preserves lineage from signal to PRD. The Factory treats spec-as-artifact as a necessary intermediate, not a terminal product. A Spec Kit specification can be ingested into Stage 5 as a valid PRD draft; the Factory would then compile it through the remaining passes.

**Zhou et al.'s externalization program** describes the I-layer architecture for agent systems: memory, skills, protocols, harness. The Factory is compatible with and benefits from this frame for Stage 6. It does not, however, live entirely inside the frame. The Factory's upstream (signals → proposals) and downstream closure (trajectory → new proposals) are activities the externalization program does not address, because they concern the production and maintenance of Functions rather than the runtime operation of individual agents.

## 10. Where the Factory sits in the Koales landscape

The Factory is not a WeOps product. It should not be branded WeOps. Folding it into WeOps would blur the I/We boundary that makes WeOps legible.

Three placements are plausible.

**A Cognifiq.ai capability.** The Enterprise Cognition Loop — the design→execution→feedback→learning arc where Quality is an emergent property of governed execution — is exactly what the Factory operationalizes at the I-layer. The Factory produces the Functions whose governed execution Cognifiq.ai measures epistemically. This placement reads cleanly: Cognifiq is the epistemic layer, the Factory is the production layer. Healthcare verticals (CareGraf.ai, CareGraph.io, MiddleCare) would consume Factory-produced Functions and Cognifiq-produced organizational self-knowledge in the same deployment.

**A standalone Koales Labs product.** The Factory can stand alone as a developer-facing product competing in the Claude Code / Cursor / Cognition adjacent space, with positioning against Spec Kit, BMAD, and StrongDM. The audience would be engineering leaders in regulated industries who need the audit trail and trust computation that simpler spec-to-code systems cannot provide. This placement is cleaner than trying to wedge it into an existing vertical.

**An open-source release.** The pipeline, schemas, compiler passes, and node prompt pack are all artifacts that could be released as an open specification under Koales stewardship, analogous to how Archon and MCP have shaped their respective spaces. Open-sourcing the Factory as an architectural pattern while keeping Cognifiq.ai's epistemic runtime proprietary would establish Koales as a definitional voice in the space without giving away the runtime governance that WeOps provides.

These placements are not mutually exclusive. The cleanest sequence is likely: open-source the pattern and schemas first to establish authorship and vocabulary; build the reference implementation as a Cognifiq.ai capability; evaluate standalone productization after the pattern has adoption.

## 11. What is non-negotiable in a first build

A first implementation of the Factory can defer almost anything — scale, multi-tenancy, sophisticated UI, optimized retrieval, cost controls, every shortcut that separates a demo from a product. But six opinionated design choices cannot be compromised without collapsing the architecture into something already-existing and less interesting. These are the things a first build is about.

1. **Lineage preservation.** Every artifact must reference its source, and the uncertainty ledger must record what was inferred rather than explicit. Without this, the system becomes opaque generation and the trust computation loses its evidentiary basis. Lineage is what turns the Factory's output from plausible to defensible.

2. **Narrow-pass discipline in the compiler.** Each of the eight Stage 5 passes does exactly one thing. Collapsing passes to save cycles destroys the debuggability that justifies the whole architecture. The moment a pass silently conflates atom extraction with contract derivation, the system becomes a black box indistinguishable from direct LLM generation.

3. **Explicit invariants with detector specs.** Every invariant must have a direct-rule detector with a named evidence source and a regression policy. Invariants without detectors are not invariants; they are wishes. This is the single most common failure mode in specification-driven systems, and it is the thing that makes Stage 7 a closed loop rather than aspirational text.

4. **Assurance dependency typing.** Incident propagation must use the five-type dependency graph (execution, evidence, policy, shared invariant, shared adapter). Defaulting to service-adjacency propagation lets the Factory slide into standard observability tooling where it loses its distinctive claim.

5. **Trajectory-driven closure with a birth gate.** The upstream feedback loop is what differentiates the Factory from Dark Factory and every other spec-to-code system. The birth gate is what keeps that loop from generating proposal noise. Both are required, and neither can be deferred to v2 without the v1 being a categorically different product than what this whitepaper describes.

6. **The three Coverage Gates, fail-closed.** The Compile, Simulation, and Assurance Coverage Gates (§6) must all be implemented and all fail-closed in a first build. A Factory without Gate 1 generates WorkGraphs from incomplete specs. A Factory without Gate 2 promotes Functions to `monitored` before their scenarios cover their invariants. A Factory without Gate 3 silently loses visibility and calls it trust. All three are required; the absence of any of the three makes the trust computation a claim rather than a proof.

What the Factory is first *applied to* is a separate question from what the Factory *is*. Vertical selection for a first implementation depends on where the organization already has rich enough signal telemetry and enough regulatory or compliance pressure to make the trust computation worth the overhead. That decision is downstream of this whitepaper and should be made against the Koales landscape as a whole, not inferred from the illustrative examples that appear in the source material.

## 12. Closing

The Function Factory is a compiler for reality, and the deeper frame it implements is closed-loop control over organizational behavior. Pressures are the forcing functions. Capabilities are the transfer functions. Functions are the response. Validation outcomes and runtime telemetry are the error signal. Trajectory-driven Function birth is the controller's update action. The pipeline only reads as a one-way compiler on paper; in operation it is a controller that continuously tunes organizational response to environmental forcing.

That framing is not decorative. It is what makes SWOT executable (§7), what makes the trust computation meaningful (§5), what justifies the birth gate (§4), what makes coverage a first-class architectural element rather than a consistency afterthought (§6), and what separates the Factory from every spec-to-code system that treats the spec as a terminus rather than a signal in a loop.

Its inputs are pressures the organization feels and drift it observes in its own running systems. Its outputs are Functions — bounded, composable, governable, verifiable, monitorable units that do the work the pressures demand and prove they are still doing it afterward. Its loop is closed: deployed Functions generate trajectory evidence that the system treats as unmet Function demand, which the upstream stages turn back into new Functions.

It is not a harness. It is not WeOps. It is not a code generator. It is the thing that sits between pressure and purpose — producing and maintaining the executable substrate that the We-layer governs and the organization acts through. Named precisely, placed correctly, and built with the six non-negotiable design choices above, it becomes a Koales contribution distinct enough to name and durable enough to ship.

---

## References and lineage

This whitepaper synthesizes material from an exploratory thread archived as *CodeFactory.pdf* and *full_thread_artifacts.zip* (both ingested 2026-04-18). The thread's canonical pipeline, seven-stage structure, trust model, assurance dependency graph, trajectory-driven closure, and Function-as-canonical-unit conclusion are all preserved here in condensed prose form. The Pressure-as-Forcing-Function frame, the WorkGraph vs. Work Order distinction, the explicit SWOT integration, the control-theory framing, and the three-gate Spec Coverage discipline are architect additions contributed during review. The positioning against WeOps, the I/We taxonomy, and the Cognifiq.ai placement are derived from the WeOps/WGSP Executive Whitepaper (WP-2026-EP-01) and *The I/We Boundary: Positioning WeOps Against the Externalization Program* (2026-04-17).

Representative adjacent works referenced: Archon (Stanford, 2024); StrongDM Dark Factory (2025); Anthropic Claude Code Agent Skills (2025–2026); GitHub Spec Kit (2025); BMAD Method (2025); Open Spec (2026); Zhou et al., *Externalization in LLM Agents* (arXiv:2604.08224, 2026).
