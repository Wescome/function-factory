# Crystallizer Lessons for PAI

**Source:** Ontology Introspection corpus analysis (2026-05-02)
**Applies to:** PAI system-wide — any pipeline where LLM output must preserve conceptual intent across stages

---

## The Core Problem

LLMs maintain procedural world models (state tracking, binary classification) reliably but FAIL to maintain conceptual world models (frameworks, intent, analytical lenses) across generation boundaries. When a new prompt triggers a different computational circuit, the model abandons the prior framework without noticing.

**In the Factory:** Signal "export LifecycleState" → 5 compilation stages → atoms produce "AtomDefinition." The intent was lost because each stage re-interpreted freely.

**In PAI:** Any multi-step pipeline where Step N's output feeds Step N+1's prompt is subject to the same decay. Research chains, content generation, analysis workflows — all vulnerable.

---

## The 7 Lessons

### Lesson 1: Crystallize Intent at Entry

**Pattern:** Convert conceptual intent into binary yes/no checkpoints (anchors) at the FIRST step. Before any LLM processing.

**How:** One isolated LLM call takes the original request and produces 3-6 binary questions: "Does this output reference X?" "Does this output address Y?" These persist across all subsequent stages.

**Why it works:** Binary classification is a state-tracking task (high reliability in the LLM world model hierarchy). Conceptual framework maintenance is a reasoning task (low reliability). Crystallization converts the hard task into the easy task.

**PAI application:** Any `/research` or multi-agent workflow should crystallize the user's question into binary checkpoints before dispatching to sub-agents. When results come back, probe against the checkpoints.

### Lesson 2: Probe Isolation Is Non-Negotiable

**Pattern:** The probe that checks output against anchors MUST be a SEPARATE LLM call with DIFFERENT context from the generation call.

**Why:** If the probe runs in the same context as generation, it will be "cued by the same circuit" and find the output reasonable even when it has drifted. The probe must see ONLY the output text and the probe questions — not the original request, not the generation prompt, not the accumulated state.

**What isolation means concretely:**
- Separate API invocation (not the same message thread)
- Different system prompt ("you are an evaluator" not "you are a coder")
- No access to the generation's input data
- Ideally a different model (cheap/fast model for probes)

**PAI application:** When verifying agent output quality, never verify in the same conversation context. Spawn a separate evaluation agent with only the output and the success criteria.

### Lesson 3: The Gate Is a State Machine, Not a Judgment Engine

**Pattern:** The reconciliation gate receives booleans and applies if-then rules. No LLM, no reasoning, no "judgment."

**Decision matrix:**
```
No violations           → PASS
Log-only violations     → PASS (record)
Warn violations         → WARN (pass with advisory)
Block + attempts < max  → REMEDIATE (re-run with feedback)
Block + attempts >= max → ESCALATE (human review)
```

**Why:** The gate must be 100% reliable. It's the last component in the chain. Any "judgment" about violation severity belongs in the crystallizer (anchor formulation) or the probe (binary classification). The gate is deterministic.

**PAI application:** Post-agent verification gates should be pure boolean logic. Don't ask an LLM "is this good enough?" — crystallize "good enough" into checkpoints, probe against them, and gate deterministically.

### Lesson 4: Conservation of Gap — Every Formalization Loses Information

**Pattern (from SEO Axiom A7):** No specification can fully capture the knowing-state that produced it. Every pipeline stage is a formalization that projects a decision field into a committed output. Information is irreversibly lost.

**Implication:** Semantic fidelity CANNOT be 100%. The goal is to make the loss measurable and bounded, not to eliminate it. The drift ledger quantifies the loss; the crystallizer bounds it by enforcing the most critical aspects.

**PAI application:** When chaining agents (researcher → synthesizer → writer), expect information loss at each handoff. Design the chain to preserve what matters most (the user's actual question) even if details are lost. Crystallize the question first.

### Lesson 5: Divergence Asymmetry — Don't Auto-Blame the Model

**Pattern (from SEO Axiom A4):** When output diverges from intent, the divergence doesn't indicate which side is at fault. The prompt might be incomplete (prior = 1 for specification incompleteness). The model might have erred. The context might be wrong.

**The Factory learned this the hard way:** 
- Run 2: "Python files" → blamed the model (hallucination)
- Root cause: the BINDING PASS prompt had `language: "..."` as free text, the model chose Python correctly per its instruction
- The spec was incomplete, not the model broken

**PAI application:** When an agent produces unexpected output, check the prompt/context FIRST. The model follows instructions — if the instructions are ambiguous, the model's interpretation is valid even if wrong.

### Lesson 6: Amortize Crystallization, Probe Cheaply

**Cost model:**
- Crystallizer: 1 LLM call per pipeline entry (amortized — runs once)
- Probes: 1 cheap/fast model call per stage boundary (batched — all anchors in one call)
- Gate: 0 LLM calls (pure boolean logic)

**Steady-state cost:** 1 crystallization + N probes (where N = number of stages to verify). Use a cheap model (Haiku-tier, llama-70b) for probes — they answer binary questions, not generate content.

**PAI application:** The probe budget is the cost of quality. For PAI multi-agent workflows, one probe call per agent handoff is the price of semantic fidelity. Use the cheapest model that can answer binary questions.

### Lesson 7: The Drift Ledger Is the Learning Signal

**Pattern:** Append-only log of all probe results across all pipeline runs. Enables:
- **Erosion detection:** Pass X gradually drifts over time
- **Anchor quality:** Which anchors have high false-positive rates (recrystallize them)
- **Pass targeting:** Focus probing budget on highest-risk stages
- **System learning:** The Factory improves its own compilation by analyzing what drifts

**PAI application:** Every multi-step pipeline should accumulate probe results. Over time, the system learns which steps are reliable and which need tighter enforcement. This is the self-improvement signal.

---

## The Atom Category Insight

The Factory's decompose pass produced "implementable work units" instead of "verifiable claims." This is WHERE semantic fidelity first broke.

**The fix:** Atoms should carry BOTH:
- What to implement (procedural — the work unit)
- What this verifies (truth-apt — the claim it satisfies)

The `verifies` field creates explicit lineage from each atom back to the signal's intent. Without it, atoms are free-floating work items with no traceability to original intent.

**PAI application:** When decomposing a task for sub-agents, each subtask should carry an explicit statement of what aspect of the original request it fulfills. "Research X" is a work unit. "Research X to answer the user's question about Y" is a verifiable claim.

---

## The Reference Implementation

The IntrospectiveHarness TypeScript implementation provides production-ready code for all components:

| Component | File | Lines | What It Does |
|-----------|------|-------|-------------|
| Types (Zod) | `types.ts` | 329 | Every domain object: Framework, Anchor, ProbeResult, GateDecision, DriftEntry |
| Crystallizer | `crystallizer.ts` | 159 | Framework → Anchors (concept → procedure). Includes recrystallize with feedback. |
| ProbeEngine | `probe-engine.ts` | 187 | Isolated evaluation. Batched probes. Fallback parsing. Fail-safe on timeout. |
| ReconciliationGate | `gate.ts` | 141 | Pure deterministic state machine. Block/warn/log severity. |
| DriftLedger | `drift-ledger.ts` | 161 | Append-only. Erosion detection. Per-anchor statistics. |
| Agent orchestrator | `agent.ts` | ~300 | The main loop: crystallize → generate → probe → gate → drift. |
| Architecture | `ARCHITECTURE.md` | 261 | The complete architectural rationale. Cost model. Integration points. |

**Key architectural decisions from the reference:**
1. Probe isolation is non-negotiable (the ONE constraint that cannot be relaxed)
2. Crystallization is amortized (one call per framework, not per turn)
3. The gate is a state machine (no judgment, 100% reliable)
4. Fail-safe defaults (timeout → treat block anchors as violated)
5. Models are pluggable (generation model ≠ probe model ≠ crystallizer model)

---

## Mapping to PAI Skills

| PAI Skill | Crystallizer Application |
|-----------|------------------------|
| `/research` | Crystallize research question into 3-5 binary checkpoints. Probe each researcher agent's output against them. |
| `/council` | Crystallize the debate topic. Probe each council member's position against the anchors. Gate: are all perspectives represented? |
| `/redteam` | The red team IS a crystallizer — it produces binary attack vectors. Map to anchor format. |
| `Evals` | Eval graders ARE probes. Map eval criteria to anchor format for consistency. |
| `CreateSkill` | Crystallize the skill's JTBD into anchors. Probe the generated skill against them. |
| `BookWriter` | Crystallize the book's thesis into anchors. Probe each chapter against them. Drift ledger tracks chapter quality over the manuscript. |

---

## Summary

The Crystallizer pattern is domain-agnostic. It works wherever an LLM's output must preserve conceptual intent across generation boundaries. The Factory's compilation pipeline is one instance. PAI's multi-agent workflows are another. The pattern is the same:

1. **Crystallize** intent into binary checkpoints at entry
2. **Probe** output against checkpoints at each boundary (isolated)
3. **Gate** deterministically (no LLM judgment)
4. **Record** in drift ledger (the learning signal)
5. **Recrystallize** when anchors degrade (the improvement loop)

The cost is 1 + N cheap LLM calls per pipeline run. The benefit is semantic fidelity that doesn't depend on prompt compliance.
