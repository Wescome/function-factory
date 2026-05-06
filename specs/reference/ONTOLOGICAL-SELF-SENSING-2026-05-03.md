# Ontological Self-Sensing: Function Factory vs. Software 3.0

**Date:** 2026-05-03
**Frame:** Apply BC-ORG-ONTO-SENSE recursively to the Factory itself
**Trigger:** Karpathy's Software 3.0 thesis + the spec-driven development wave (Kiro / Spec Kit / Tessl / Opsera Forge / agentic engineering)
**Purpose:** Determine whether the Factory's ontology is dominant, gaining, parity, losing, or invalidated against the emerging market ontology

---

## 0. Why This Analysis Exists

The ontological-sensing capability the Factory designed (BC-ORG-ONTO-SENSE) has six mechanisms. Five of them point outward — at competitors, at customers, at causal claims about "the market." The sixth, **alternative ontology maintenance**, has a stronger move available: turn the lens on the Factory itself.

The Factory has a public articulated ontology:
- **Conceptual world models fail; procedural world models persist.** Therefore convert intent into procedure.
- **Pressure → Capability → Function → PRD → WorkGraph → Code** is a load-bearing pipeline, not a metaphor.
- **Three fail-closed Coverage Gates** (Compile, Simulation, Assurance) are non-negotiable.
- **Lineage preservation and explicitness tags** prevent drift across compilation stages.
- **The Factory's first application is building itself.**

Karpathy's June 2025 Software 3.0 thesis, the agentic-engineering successor in February 2026, the spec-driven wave (Kiro, Spec Kit, Tessl, Opsera Forge), and the emerging context-engineering discipline are not adjacent concerns — they overlap the Factory's domain at every plane. If the Factory's ontology is correct and dominant, the converging evidence should validate it. If a different ontology is gaining predictive power, the Factory needs to know now, not in two quarters.

The question is **not** "is the Factory good?" The question is: does the Factory carve the joint reality at the right places, given what the field looked like as of May 2026?

---

## 1. The Factory's Stated Ontology, Made Explicit

Before measuring fit, list assumptions in their reviewable form. From the corpus:

### 1.1 Categorical assumptions

| ID | Category | Definition (Factory frame) | Confidence (asserted) |
|----|----------|---------------------------|----------------------|
| CAT-FF-1 | Software is | A specification-execution system, where executors (humans or transformers) reliably maintain procedural world models and unreliably maintain conceptual ones | Green |
| CAT-FF-2 | The unit of programming | A typed artifact with lineage (PRS, BC, FP, PRD, WG, INV, CR) — not a function, not a paragraph | Green |
| CAT-FF-3 | The compiler's job | Convert conceptual world models (PRDs) into procedural ones (WorkGraphs) so transformers can sustain them | Green |
| CAT-FF-4 | "Done" means | Coverage gates pass — Compile (every atom bound), Simulation (verified→monitored), Assurance (continuous detector freshness) | Green |
| CAT-FF-5 | The first product | Is the Factory itself; the bootstrap is the proof | Green |

### 1.2 Causal assumptions

| ID | Mechanism | Statement | Confidence (asserted) |
|----|-----------|-----------|----------------------|
| MECH-FF-1 | Procedural conversion | Specs that compile to procedural form survive turn boundaries; conceptual specs decay | Green |
| MECH-FF-2 | Coverage gates | Fail-closed gates prevent drift better than human review or ad-hoc tests | Green |
| MECH-FF-3 | Lineage edges | Per-stage lineage writes (not batched post-Gate) are necessary; learned from Phase 3 production | Green |
| MECH-FF-4 | Local procedural models | Each compiler pass is a state transition; fine-tuned local models execute passes more reliably than general frontier models | Yellow (this is the four-argument case from "Procedures All the Way Down" §4–5) |
| MECH-FF-5 | I-layer / We-layer | Agent-in-environment (Factory) and organization-in-purpose (WeOps) are distinct gradients, not the same thing wearing two hats | Green |

### 1.3 Strategic claims

| ID | Claim | Confidence (asserted) |
|----|-------|----------------------|
| STRAT-FF-1 | Ontology is strategy: redefining categorical structures beats optimizing within them | Green |
| STRAT-FF-2 | The comprehension gap applies to LLMs and to organizations; the same compiler pattern resolves both | Green |
| STRAT-FF-3 | Fail-closed governance produces a moat; organizations without coverage gates accumulate drift faster than they can repair it | Green |

These are the assumptions on the table. Now compare to the field.

---

## 2. The Software 3.0 / Spec-Driven Wave: What Actually Happened

### 2.1 Karpathy's June 2025 thesis

The talk at YC's AI Startup School laid out three layers: 1.0 (hand-written code), 2.0 (trained weights), 3.0 (LLMs programmed in natural language). Software 3.0 is the current era, where large language models (LLMs) can be directed through natural language prompts, making prompting itself a form of programming. The frame Karpathy chose was *the program is the prompt; the LLM is the interpreter; the context window is the program.* Software 2.0: humans curate datasets and train neural networks; the weights are the program. Software 3.0: humans write prompts; the LLM is the interpreter, and the context window is the program.

The architectural claim underneath: LLMs are an OS-grade substrate. LLMs (e.g. GPT, Claude, Gemini) as general-purpose reasoning engines. Users interact using natural language prompts rather than coding logic. The unit of programming becomes the prompt, not the function.

### 2.2 The vibe-coding-to-agentic-engineering pivot (Feb 2026)

Karpathy retired "vibe coding" twelve months later. "Many people have tried to come up with a better name for this to differentiate it from vibe coding, personally, my current favorite is agentic engineering." The reason: vibe coding doesn't survive contact with production. When data integrity is the absolute priority, you cannot simply "vibe" your way to a resilient database. You need deterministic checks, transactional guarantees, and verifiable logic. The creative, probabilistic nature of the LLM OS must be balanced by the deterministic, reliable architecture of traditional systems.

The recognition that pure prompt-driven workflows produce "AI slop" — code that looks reasonable on the surface but lacks proper error handling, introduces security vulnerabilities, breaks existing functionality, or creates unmaintainable architecture — pushed the field toward structured specification.

### 2.3 The spec-driven landscape, as of May 2026

| Tool | Backer | Approach | Spec rigor |
|------|--------|----------|-----------|
| GitHub Spec Kit | GitHub / OpenAI / Google / Cursor / Factory | Open source CLI, four phases (/specify, /plan, /tasks, implement), "constitutional foundation" | Spec-first → spec-anchored |
| Kiro | AWS | Agentic IDE, three docs (requirements/design/tasks) using EARS notation | Spec-anchored |
| Tessl | Guy Podjarny (Snyk founder), $125M @ $500M | Spec-as-source — humans edit specs, code is regenerated, marked DO NOT EDIT | Spec-as-source |
| Opsera Forge | Opsera | Intent + context-aware "Software Factory" with guardrails | Spec-anchored + governance |
| Claude Code skills + CLAUDE.md / AGENTS.md | Anthropic / Linux Foundation | Persistent project context, slash-commanded skills, hierarchical memory | Spec-first |

The field has converged. SDD is still in its early chapters. The ThoughtWorks Technology Radar (Volume 33) placed it in the "Assess" ring, acknowledging its fascination while noting that workflows remain elaborate and opinionated. As of early 2026, we're seeing rapid convergence: tools are learning from each other Spec-driven development has moved from heresy to default. A year ago, vibe coding went viral. Non-developers and junior developers discovered they could build beyond their abilities with AI. It lowered the floor. It made prototyping much quicker, but it also introduced a surplus of slop. What the industry then needed was something that raised the ceiling — something that improved code quality and worked the way the most expert developers work. Spec-driven development did that. It laid the foundation for trustworthy autonomous coding agents.

### 2.4 The empirical case for spec rigor

The argument the Factory has been making about procedural conversion is now appearing in academic form. The "Vibe Coding Needs Vibe Reasoning" paper at the 2025 ACM workshop on Language Models and Programming Languages frames the failure mechanically: these pitfalls result from LLMs' inability to reconcile accumulating human-imposed constraints during vibe coding, with developers inadvertently failing to resolve contradictions because LLMs prioritize user commands over code consistency. Given LLMs' receptiveness to verification-based feedback, we argue that formal methods can mitigate these pitfalls, making vibe coding more reliable.

The "Specification as Quality Gate" paper (Zietsman, March 2026) makes the structural argument the Factory makes: that executable specifications perform a domain transition in the Cynefin sense, converting enabling constraints into governing constraints and moving the problem from the complex domain to the complicated domain, a transition that AI makes economically viable at scale.

Both arguments arrive at substantially the Factory's position: that without externally-anchored, procedurally-verifiable specs, AI-driven generation collapses into correlated failures.

---

## 3. Predictive-Accuracy Evaluation

For each Factory assumption, the question is: does the 2026 evidence predict it would be valid, or does evidence systematically diverge?

### 3.1 CAT-FF-1: Software as specification-execution system

**Verdict: 🟢 Strongly validated.**

This is now a mainstream frame, not a heretical one. Capgemini's 2026 TechnoVision frames the shift as a fundamental shift in how we think about programming. Instead of writing explicit instructions in formal languages, we're moving toward a paradigm where intent expressed in natural language becomes the primary interface for software creation. The "AI eating software" lifecycle reframing puts intent at the front and code as output. The Factory was early on this; the wave is catching up.

**Direction**: this assumption is strengthening with time, not weakening. Move it from Green (asserted) to Green (validated by external convergence).

### 3.2 CAT-FF-2: The unit of programming is a typed artifact with lineage

**Verdict: 🟡 Partially validated, but with a competing definition gaining ground.**

The Factory says: PRS, BC, FP, PRD, WG, INV, CR — typed artifacts with explicitness tags and source_refs. The market has moved to: spec.md, plan.md, tasks/, constitution.md (Spec Kit); requirements.md, design.md, tasks.md (Kiro); spec-as-source files marked DO NOT EDIT (Tessl).

Both agree: artifacts are the unit. Both agree: lineage matters. Where they diverge: **the Factory's typing is richer and more rigorous, but the market's typing is shallower and more interoperable.**

This is a real ontological tension. The market settled on a small set of universal artifact names that any agent can pick up via convention. AGENTS.md is an open, Markdown-based standard for providing instructions to AI coding agents. Placed at the root of a project repository, it tells agents about the project's build setup, test commands, code conventions, architectural constraints, and security The Factory has 7 stages with prefixed IDs and a custom compiler. The cost of that depth is that no off-the-shelf agent natively understands PRS-* or WG-* without being told.

**Direction**: the assumption is correct on direction (typed artifacts win), at risk on form (the market's lower-rigor convention is what's getting compounded by every IDE, every model, every CI tool). The Factory needs to decide: emit AGENTS.md alongside its native artifacts, or accept that its artifacts are second-class citizens in the broader ecosystem.

This is the first real ontological signal worth escalating. **Move CAT-FF-2 to Yellow.**

### 3.3 CAT-FF-3: The compiler converts conceptual to procedural

**Verdict: 🟢 Validated, with the analogy now widespread.**

Karpathy himself uses the compiler frame: Karpathy's compiler analogy treats raw documents as source code: unoptimized, human-readable, not ready to execute. The LLM compilation step transforms that source material into structured knowledge artifacts — denser, cleaner, and faster

The Factory's stronger version — that compilation is from conceptual to procedural specifically, not just from raw to compressed — is more pointed and arguably more correct, because it names the **kind** of transformation rather than just the act. The "FormalJudge" architecture (Feb 2026) does exactly this: a neuro-symbolic framework that employs a bidirectional Formal-of-Thought architecture: LLMs serve as specification compilers that top-down decompose high-level human intent into atomic, verifiable constraints, then bottom-up prove compliance using Dafny specifications and Z3 Satisfiability modulo theories solving

That is precisely the Factory's pass-1 → pass-7 architecture, with formal proof attached.

**Direction**: convergent and strengthening. Hold Green.

### 3.4 CAT-FF-4: "Done" means coverage gates pass

**Verdict: 🟡 Validated in principle, but the market is converging on a different gate vocabulary.**

The Factory's three gates (Compile, Simulation, Assurance) are not the words the market uses. The market vocabulary is converging on: spec-correctness testing (Kiro), constitutional foundation (Spec Kit), guardrails (Opsera Forge), verifier agents (Augment Intent). Verifier agent closes the misalignment loop: Validates implementations against original intent before developer review

The mechanical claim is the same: deterministic, repeatable checks against a spec, before code is accepted. The naming is different.

**This is a positioning issue, not an ontological one.** The Factory's three-gate frame is more rigorous and more specific than "guardrails," but "guardrails" is what enterprise buyers will search for. The market is buying the same thing the Factory built; it just calls it something else.

**Direction**: hold Green on the substance, downgrade to Yellow on the language. The Factory needs a translation layer between its vocabulary and the market's, or it will compete on terms enterprise buyers don't have a slot for.

### 3.5 CAT-FF-5: First product is the Factory itself

**Verdict: 🟢 Validated by AWS's own example.**

The Kiro IDE team used Kiro to build Kiro IDE — an agentic coding environment with native spec-driven development — cutting feature builds from two weeks to two days. An AWS engineering team completed an 18-month rearchitecture project, originally scoped for 30 developers, with six people in 76 days using Kiro.

The bootstrap-is-the-proof argument has now been made by AWS and accepted by the market. The Factory is in good company on this one.

### 3.6 MECH-FF-1: Procedural conversion is necessary

**Verdict: 🟢 Strongly validated by external research.**

The "Specification as Quality Gate" paper makes this exact argument: The dominant industry response to AI-generated code quality problems is to deploy AI reviewers. This paper argues that this response is structurally circular when executable specifications are absent: without an external reference, both the generating agent and the reviewing agent reason from the same artefact, share the same training distribution, and exhibit correlated failures. The review checks code against itself, not against intent.

The "Vibe Coding Needs Vibe Reasoning" paper makes it formally. The agentic-verification work makes it empirically. SEVerA's three-stage Search-Verify-Learn framework with FGGM (Formally Guarded Generative Models) wraps every model call in a verified rejection sampler — In Verification, we prove correctness with respect to the hard constraints for all parameter values, reducing the problem to unconstrained learning. Same architecture pattern: external formal anchor, machine-checkable, gates the output.

The Factory's MECH-FF-1 is now consensus. Hold Green.

### 3.7 MECH-FF-2: Coverage gates as moat

**Verdict: 🟢 Validated; commoditizing fast.**

Six months ago this was a differentiator. Today every spec-driven tool ships with gates: Spec Kit's constitutional foundation, Kiro's spec-correctness testing in the GA release, Tessl's verified test alignment, Opsera Forge's enterprise guardrails. Forge ensures context is persistent from day 0, throughout the life of the software, so agents don't hallucinate and deliver enterprise-grade code. Spec-based development means AI-generated code must satisfy explicit architectural and behavioral constraints before, during, and after it ever merges. Quality, security, and stability shift upstream instead of being chased downstream. Guardrails are the enforcement layer.

**Direction**: the *idea* is validated. The *moat* is dissolving. Hold Green on the mechanism. **Yellow on the strategic claim that gates produce durable advantage** — they will increasingly be table stakes.

### 3.8 MECH-FF-3: Per-stage lineage writes

**Verdict: 🟢 Internal validation only; not yet a market topic.**

Lineage is mentioned across the spec-driven landscape but not in the precise per-stage sense the Factory uses. The market talks about traceability (Kiro), audit trails (Opsera Forge), version-controlled specs (Spec Kit). The Factory's per-stage write discipline (lineage edges after each pass, not batched post-Gate) is a finer-grained operational claim than anyone in the spec-driven space has articulated publicly.

**Direction**: this is the Factory's strongest unique claim. It is not yet contested because no one else has gone this deep. Hold Green; this is Factory differentiation territory.

### 3.9 MECH-FF-4: Local procedural models

**Verdict: 🔴 At significant risk.**

This is the assumption to be most careful about. The "Procedures All the Way Down" §4–5 argument makes four points for fine-tuned local models:
- **(a) Procedural reliability**: each pass is a state transition that a small specialized model can execute more reliably than a general one.
- **(b) Zero marginal cost**: once trained, inference is essentially free at scale.
- **(c) Provider sovereignty**: the Factory owns the substrate, not OpenAI/Anthropic.
- **(d) Domain specialization**: a model that has only seen pass-1 data is better at pass-1 than a model that has seen everything.

Against those, the 2026 evidence:

- **(a)** is supported. Per-pass models trained on schema-typed transition data should outperform general models on those passes. SEVerA's results are consistent with this.
- **(b)** is *partially* supported but the gap is closing. Frontier inference costs are dropping faster than fine-tuning costs are amortizing. Architectures that amortize inference across transactions, rather than invoking a model per request, become economically compelling at scale. Compiled AI is one such architecture: generation cost is fixed at compile time, and execution cost is zero regardless of transaction volume. As LLM costs come to dominate enterprise operating budgets, compile-once-run-many approaches are not merely convenient—they are likely to become the default deployment pattern for well-specified, high-volume workflows. This actually strengthens the Factory's argument *for compilation*, but the question is whether the local model is the right place to draw the boundary, vs. compiled prompts/skills running on cheap frontier inference.
- **(c)** is the strongest argument and remains intact. Provider sovereignty is a genuine moat.
- **(d)** is empirically true and underweighted by the market.

**The risk**: the market is moving toward an architecture where the *spec* is the local sovereign artifact, and the *model* is interchangeable. AGENTS.md is explicitly portable across Claude Code, Codex, Cursor, Windsurf, Gemini CLI. The portability is the point. If the Factory wires itself permanently to local fine-tuned models, it accepts a sovereignty argument while losing the portability argument.

The synthesis: keep MECH-FF-4 for passes that genuinely benefit from specialization (pass-2 contract extraction, pass-7 coverage validation — these are tight, schema-bounded, repetitive), but don't make it a categorical claim. **Move MECH-FF-4 from Yellow to Yellow-leaning-Red until pass-by-pass evaluation against current frontier costs is done.**

This is consistent with the existing memory note: *Before recommending against local models: quote the four architectural arguments from "Procedures All the Way Down" §4–5, evaluate each against new data, flag contradictions explicitly.* Done. Two of four arguments hold strongly; two have softened.

### 3.10 MECH-FF-5: I-layer / We-layer distinction

**Verdict: 🟢 Strongly validated and increasingly important.**

Microsoft's April 2026 framing of intent-driven enterprise work is precisely the I/We distinction the Factory has been making. As organizations race to adopt AI, a new challenge is becoming clear: translating human intent into systems that can act autonomously—without sacrificing control, security, or trust. Intent-first development addresses that gap by reshaping how agentic applications are designed, governed, and delivered at scale.

The market is now distinguishing between agent-level capability (the I-layer in Factory vocabulary) and organizational orchestration (the We-layer). The Factory has had this language since the start. Hold Green; this is positioning fuel.

### 3.11 STRAT-FF-1: Ontology is strategy

**Verdict: 🟢 Validated by the spec-driven taxonomy itself.**

The fact that the field is fighting over what "spec" means — spec-first vs. spec-anchored vs. spec-as-source — is an ontological war in real time. Whoever defines the categorical structure of the spec-driven world wins the moat. Tessl is making the spec-as-source bet. AWS is making the spec-anchored bet. Spec Kit is making the spec-first-with-constitutional-foundation bet. The Factory's bet is: spec-anchored with seven typed stages and three coverage gates. This is the same kind of category-redefinition play the strategy paper described.

Hold Green.

### 3.12 STRAT-FF-2: Comprehension gap is universal

**Verdict: 🟡 The gap is real, but the market is solving it without invoking the gap.**

The market's solution to the comprehension gap is *more context, better-organized*. CLAUDE.md hierarchies, AGENTS.md, MEMORY.md, CONTEXT.md, SKILL.md — CLAUDE.md — Absolute top. Claude-specific behavior overrides everything for Claude sessions. If CLAUDE.md says "never use semicolons," that rule wins over any other file. The hierarchy of context files is doing the work the Factory's procedural-conversion machinery is meant to do, more cheaply, with less rigor, and good enough for most use cases.

The comprehension gap is empirically real (the Chroma "context rot" study is one of many). But the market has decided the answer is *engineer the context better*, not *convert concepts to procedures*. Both work; the Factory's approach is more durable but more expensive.

**Direction**: the assumption is correct on the underlying mechanism but at risk on the implication. If 80% of the comprehension gap is solved by better context engineering, the residual the Factory addresses is a smaller market than the framing implied. Move STRAT-FF-2 to Yellow.

### 3.13 STRAT-FF-3: Fail-closed governance produces a moat

**Verdict: 🟡 The frame is right; the moat is being commoditized.**

Every enterprise spec-driven tool is now selling governance: Forge is the first Enterprise Software Factory built for true AI-SDLC, an operating model where intent, context, and spec-based development drive every action, with enterprise-grade guardrails built in at every step. Anthropic's 2026 Agentic Coding Trends Report frames governance as the differentiator. Mayfield's CXO survey reports AI governance outranks cybersecurity as an emerging board-level priority. Boards are waking up to agentic systems and demanding visibility, control, and accountability.

Governance is now the universal claim. Every vendor will have it within 12 months. The Factory's specific *form* of governance (three fail-closed gates with detector specifications) is more rigorous than most, but the buyer can't always tell. **Move STRAT-FF-3 to Yellow on the moat claim.**

---

## 4. Pattern Synthesis: What's Actually Happening

The Factory's ontology is **substantially correct** at the level of mechanisms. Procedural conversion is necessary. Specs are the unit. Compilation is the right metaphor. Coverage gates are required. Lineage matters. The market validates these.

The Factory's ontology is **partially diverging** from the market's at the level of categories and language. The market's typed artifacts are shallower (AGENTS.md, spec.md) but more portable. The market's gate vocabulary is "guardrails" not "Coverage Gate 1/2/3." The market's compilation target is the spec, not the WorkGraph.

The Factory's ontology is **at risk** on two specific claims:
1. **MECH-FF-4** (local procedural models) needs a per-pass economic re-evaluation against current frontier inference costs. Two of four arguments have softened.
2. **STRAT-FF-3** (gates as moat) needs to acknowledge that gates are commoditizing within 12 months and the moat must shift to either lineage depth (MECH-FF-3) or vertical specialization (the Factory's ontology-engineering layer for non-software domains).

The Factory's ontology is **uniquely ahead** in one specific place: the per-stage lineage discipline (MECH-FF-3) and the explicit ontological layer (the cross-domain application to organizational design, market signal detection, etc., shown across the artifacts produced in this project). Nobody in the spec-driven space has gone there yet. This is genuine differentiation.

### 4.1 Pattern: convergent evolution, with the Factory ahead on rigor and behind on language

Map the Factory's stages against the dominant market frames:

| Factory stage | Market equivalent | Notes |
|---------------|------------------|-------|
| Stage 2 (Pressure) | "Discovery", "Problem framing" — typically not formalized | Factory unique: typed Pressure artifact with metrics |
| Stage 3 (Capability) | "Capability map", but usually informal | Factory unique: BC artifacts with acceptance criteria |
| Stage 4 (Function Proposal) | "Feature breakdown" / "EARS requirements" (Kiro) | Convergent |
| Stage 5 input (PRD) | "spec.md" (Spec Kit), "requirements.md+design.md" (Kiro), "spec" (Tessl) | Convergent; market settled on simpler naming |
| Stage 5 output (WorkGraph) | "tasks.md" / task graph in Spec Kit/Kiro | Convergent in form, the Factory is more formal |
| Gate 1 (Compile) | "Constitutional foundation check" (Spec Kit), "spec-correctness test" (Kiro GA) | Convergent |
| Gate 2 (Simulation) | "Verifier agent" (Augment Intent), CWM-style execution simulation | Convergent; the Factory's Gate 2a CWM work is consistent with frontier research |
| Gate 3 (Assurance) | "Continuous observability for AI agents" (multiple vendors) | Convergent |
| Stage 6 (Runtime) | "Agent harness" (Anthropic), "agentic environment" (Cursor/Warp/Claude Code) | Convergent |
| Stage 7 (Trust + invariant health) | Beginning to emerge ("AI Defense Plane", "Agent Protector") | Factory ahead |

**Reading**: the Factory has been ahead by 12-18 months on most stages, but the market has caught up on the conceptual frame and is now ahead on tooling polish, distribution, and naming. The window where the Factory was *uniquely articulating* this architecture is closing.

### 4.2 Pattern: language fragmentation will not last

Spec Kit, Kiro, Tessl, Opsera Forge, and CLAUDE.md/AGENTS.md will not all win. The history of similar moments (HTTP, SQL, Kubernetes, OCI containers) suggests one of two outcomes within 24-36 months:

- **Convergence on a winner** (likely AGENTS.md as the file standard, with vendor-specific extensions like CLAUDE.md). Linux Foundation stewardship is a strong signal.
- **Convergence on an interface** (a protocol that lets specs in different formats be consumed by different agents). MCP is the existing precedent.

Either way, the Factory's typed-artifact vocabulary will need to *emit* the convergent format, not replace it. PRS, BC, FP can remain internal; the artifacts shipped to agents need to be readable as AGENTS.md/spec.md/tasks.md.

### 4.3 Pattern: the moat is shifting from gates to ontology

If gates commoditize, where does durable advantage come from? Three candidates:

1. **Lineage depth**. Per-stage lineage with explicitness tags is genuinely hard to retrofit. Once the Factory has 6 months of production lineage data, that data itself is a moat — the relevance model and detector tuning improve compoundingly.
2. **Vertical specialization**. The Factory has demonstrated cross-domain application (org design, market signal detection). Most spec-driven tools are software-only. The path from "Function Factory" to "Specification Factory for any specification-execution domain" is a real moat if executed.
3. **Self-application**. The Factory builds itself. This is genuinely uncommon. Kiro built Kiro, but Kiro is just an IDE; the Factory builds factories. Recursive self-application is the strongest moat once it works.

The first product was always supposed to be the Factory itself. The strategic claim now is: **the Factory's moat is not the gates, it's the recursion.**

---

## 5. Decisions Forced By This Analysis

### Decision 1: AGENTS.md emission

**Position**: Add an emission target so that every Stage-5 artifact (PRD) and Stage-5-output (WorkGraph) also emits an AGENTS.md-shaped view. The internal rigor stays. The external interface conforms to the dominant market standard.

**Why now**: AGENTS.md is now Linux Foundation-stewarded. AGENTS.md emerged from collaborative efforts across the AI software development ecosystem, including OpenAI Codex, Amp, Jules from Google, Cursor, and Factory. We're committed to helping maintain and evolve this as an open format that benefits the entire developer community, regardless of which coding agent you use. AGENTS.md is now stewarded by the Agentic AI Foundation under the Linux Foundation. Waiting six months is acceptable; waiting 18 months is not.

**Action**: add Stage-5.5 emitter (AGENTS.md generation from PRD+WG) as a Factory-built-by-Factory subsystem. Architect agent decision when ready.

### Decision 2: Per-pass model routing re-evaluation

**Position**: Run a quantitative evaluation of each compiler pass against current frontier model costs. Use the existing `@factory/task-routing` package. Don't replace the four-argument case from "Procedures All the Way Down" — refine it pass-by-pass.

**Specific question to answer**: at current pricing (May 2026), which passes have the strongest cost-quality argument for fine-tuned local models, and which are dominated by frontier models?

**Why**: MECH-FF-4 is the assumption most at risk. Per-pass evaluation prevents the *overgeneralization* failure mode (eliminating local models everywhere) and the *underupdate* failure mode (keeping local models everywhere out of inertia).

### Decision 3: Vocabulary translation layer

**Position**: Build a public-facing glossary that maps Factory vocabulary to market vocabulary:

| Factory term | Public-facing term | Notes |
|--------------|-------------------|-------|
| Coverage Gate 1/2/3 | "Compile gate / Simulation gate / Assurance gate" — but introduce as "spec-conformance, simulated execution, runtime invariants" | Keeps internal language; introduces market-readable explanations |
| WorkGraph | "Task graph" or "executable spec" depending on audience | Factory uses WG-* internally |
| Pressure → Capability → Function | "Discovery → Capability → Specification" | Pressure is a strong word that doesn't translate cleanly; teach it second |
| Lineage edges | "Spec traceability" | Market has the latter term; introduce the former as the rigorous version |

**Why**: the moat is the substance, not the words. Letting the words become a moat is self-sabotage.

### Decision 4: Ontology layer as the second product

**Position**: The Factory's first product is itself. The second product is ontology-engineering applied to non-software domains, demonstrated in the project's organizational-design-pipeline and market-signal-pipeline artifacts.

This is the move from "Factory for software" to "Factory for any specification-execution problem." Nobody in the spec-driven space is positioned for this. The aforementioned issues of SE 2.0 call for a deep rethinking of the ways in which we have leveraged AI to engineer software systems. In this paper we introduce our vision of Software Engineering 3.0 (Figure 1). SE 3.0 is AI-native and marks a paradigm shift towards an intentfirst approach, where development is no longer driven by code but by intents expressed through iterative, conversation-oriented interactions between human developers and AI teammates. SE 3.0 is software-only. The Factory's ontology layer is domain-agnostic.

**Why**: this is where the "ontology is strategy" thesis cashes out. If the next 24 months commoditize spec-driven software development, the next moat is *which domains can you bring into spec-driven form?* Health systems, regulatory operations, GTM operations, organizational design — these are all specification-execution problems and none of them have a Factory equivalent today.

### Decision 5: Phase 5 deployment is on the critical path

**Position**: Resolve Phase 5 deployment and validation before pursuing Decisions 1-4. The pi SDK in Cloudflare Containers, the SynthesisCoordinator DO orchestrating via HTTP — that is the substrate that makes the rest of this credible.

**Why**: the analysis above is only useful if the Factory can execute on it. The Phase 5 spec is correct. The deployment is what makes the strategy real.

---

## 6. The Self-Application Test

This entire analysis is BC-ORG-ONTO-SENSE applied to the Factory.

The mechanisms used:
- **FP-ONTO-1 (Baseline ontological audit)**: Section 1 made the Factory's assumptions explicit and rateable.
- **FP-ONTO-2 (Category coherence monitoring)**: Section 2 surveyed the new market entrants (Kiro, Spec Kit, Tessl, Opsera Forge) and asked whether they fit the Factory's category system.
- **FP-ONTO-3 (Causal mechanism validation)**: Section 3 tested each Factory mechanism against 2026 evidence.
- **FP-ONTO-5 (Strategic clarity assessment)**: Section 4 evaluated whether the Factory can articulate its strategy without caveats given the new evidence. Answer: yes, but with two caveats (MECH-FF-4 and STRAT-FF-3).
- **FP-ONTO-6 (Alternative ontology maintenance)**: Section 4.3 named three alternative ontologies (gates-as-moat, lineage-as-moat, recursion-as-moat) and assessed which is strongest going forward.

The Factory's own framework, when applied to itself, produces actionable architectural decisions. That is the strongest possible validation of CAT-FF-5: the first product is the Factory.

It also produces the most uncomfortable diagnostic: the Factory's ontology is correct on substance, ahead on rigor, and behind on language and distribution. The work over the next two quarters is closing the language and distribution gap without compromising the rigor.

---

## 7. Summary

| Assumption | 2026 Verdict | Direction | Action |
|------------|-------------|-----------|--------|
| CAT-FF-1: spec-execution frame | 🟢 Validated externally | Strengthening | Hold |
| CAT-FF-2: typed artifacts | 🟡 Partially validated, AGENTS.md gaining | Diverging | Decision 1: emit AGENTS.md |
| CAT-FF-3: compiler converts conceptual→procedural | 🟢 Validated | Strengthening | Hold |
| CAT-FF-4: coverage gates = "done" | 🟡 Substance valid, language drifting | Hold direction, fix language | Decision 3: vocab layer |
| CAT-FF-5: first product is the Factory | 🟢 Validated | Strengthening | Hold |
| MECH-FF-1: procedural conversion necessary | 🟢 Strongly validated | Strengthening | Hold |
| MECH-FF-2: gates as mechanism | 🟢 Validated | Strengthening | Hold |
| MECH-FF-3: per-stage lineage writes | 🟢 Internal validation, market hasn't caught up | Factory ahead | Hold; protect the lead |
| MECH-FF-4: local procedural models | 🔴 At risk on 2 of 4 arguments | Per-pass evaluation needed | Decision 2: per-pass routing eval |
| MECH-FF-5: I/We layer distinction | 🟢 Validated by Microsoft framing | Strengthening | Hold |
| STRAT-FF-1: ontology is strategy | 🟢 Validated by spec-driven taxonomy fight | Strengthening | Hold |
| STRAT-FF-2: comprehension gap universal | 🟡 Mechanism real, residual market smaller | Hold direction, narrow claim | Acknowledge in framing |
| STRAT-FF-3: gates as moat | 🟡 Commoditizing within 12 months | Find new moat | Decision 4: ontology layer as second product |

**Overall ontological health**: 🟡 STABLE-WITH-WATCH

Eight green, four yellow, one red. The yellows and red are concentrated in *strategy* and *positioning*, not in *substance*. The Factory's mechanical claims are stronger than ever. The strategic claims need refinement. The decisions forced by this analysis are surgical, not foundational.

**No reset is required.** The Factory's ontology is fundamentally correct. The work is to close the language gap (Decision 3), publish to the dominant interface (Decision 1), refine the routing claim (Decision 2), and extend to the second product (Decision 4) — all on top of finishing Phase 5 (Decision 5).

The market has moved into the Factory's neighborhood. The Factory's job is to keep being further into the neighborhood than anyone else, while staying portable enough that the neighborhood can find it.
