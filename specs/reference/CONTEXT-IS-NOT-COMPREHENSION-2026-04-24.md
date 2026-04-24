# Context Is Not Comprehension: The Structural Limits of LLM Context Injection for Agent Architectures

**Author:** Wislet J. Celestin / Koales.ai
**Date:** 2026-04-24
**Status:** Published — internal reference
**Lineage:** Empirical failure in Function Factory session (AGENTS.md bootstrap
section loaded, not reasoned from), 12 primary research papers (2023–2026),
Anthropic context engineering guidance, JetBrains agent research.

---

## Abstract

Large Language Models process context windows through transformer attention
mechanisms that are structurally incapable of uniform comprehension across
loaded content. Multiple independent studies demonstrate that information
present in a model's context window is not reliably reasoned from — models
can recite loaded content but fail to synthesize, associate, or compute
from it at rates that degrade catastrophically with length, position, and
reasoning complexity. This paper synthesizes the empirical evidence, names
the failure modes, and proposes architectural principles for agent systems
that work within these constraints rather than assuming they do not exist.

The central claim: **agent architectures that load documents into context
and expect the model to "think from" their conceptual framework are built
on a false premise.** The model follows procedural instructions reliably.
It does not adopt worldviews. System design must account for this asymmetry.

---

## 1. The Precipitating Observation

During a Function Factory development session, the agent (Claude Opus 4.6,
1M context) was asked: "Is the Function Factory building the Function
Factory?" The agent's own foundational document (`.agent/AGENTS.md`),
pre-loaded into the system prompt via directive injection, contains the
explicit statement:

> The first Functions ARE the Factory. Every compiler pass, every gate,
> every schema validator is a Function with a full lineage.

The agent ignored this loaded context, ran ad-hoc analysis (`git log`,
`ls`, file inspection), constructed an independent narrative, and concluded
that "The Factory has not built a single piece of itself" — directly
contradicting the document in its own context window.

This was not a retrieval failure. The document was loaded. It was not a
position failure in isolation — the bootstrap section is in the middle of
AGENTS.md, but the agent had successfully referenced other sections of the
same document in the same session. It was a **comprehension failure**: the
agent processed the text as tokens but did not reason from its conceptual
framework when constructing an analytical response.

This failure is not anecdotal. It is predicted by the research literature.

---

## 2. The Evidence Base

### 2.1 Lost in the Middle: Positional Attention Decay

Liu et al. (2023, published TACL 2024) established the foundational
finding: LLMs perform best when relevant information is at the beginning
or end of the context window, with 30%+ accuracy degradation for
information positioned in the middle. Testing across GPT-3.5, GPT-4, and
Claude-family models on multi-document QA tasks, the performance curve
is U-shaped — strong at positions 1-3 and 18-20, weak at positions 8-12
in a 20-document context.

The mechanism is architectural: Rotary Position Embedding (RoPE) creates
cumulative attention weight for early tokens because every subsequent
token attends to them. Middle tokens receive structurally less attention
regardless of content relevance.

Ms-PoE ("Found in the Middle," 2024) demonstrated that rescaling position
indices across attention heads reduces the worst-to-best position gap by
2-4 percentage points without fine-tuning, confirming that the degradation
is positional, not content-dependent.

**Implication for agent architectures:** Critical framing documents loaded
in the middle of a system prompt (between tool definitions and conversation
history) occupy the lowest-attention position. The AGENTS.md bootstrap
section that was ignored sits in exactly this structural dead zone.

### 2.2 Context Rot: Length as Degradation

Chroma Research (2025) tested 18 frontier models (Claude Opus 4, GPT-4.1,
Gemini 2.5 Pro, Llama-4, Mistral Large, and others) and coined "context
rot": performance degrades non-uniformly as input length increases, with
20-50% accuracy drops between 10K and 100K tokens.

Two findings are particularly relevant:

1. **Models performed BETTER on shuffled haystacks than logically structured
ones.** Structural patterns in well-organized documents (headers, bullet
points, logical flow) consume attention budget. The carefully authored
AGENTS.md — with its sections, numbered lists, and hierarchical
organization — may produce worse comprehension than a flat text dump of
the same information.

2. **Even trivially simple tasks (repeating words) failed as context grew.**
The degradation is not limited to complex reasoning. The attention
mechanism itself becomes unreliable at scale, independent of task
difficulty.

Claude models showed the lowest hallucination rates among tested models,
tending toward abstention rather than confabulation. This is structurally
relevant: Claude's failure mode is more likely to be ignoring loaded
context (producing an independent analysis) than hallucinating about it.

### 2.3 Context Length Alone Hurts

The most methodologically rigorous finding (2025, EMNLP Findings) isolated
the effect of context length from content relevance through three
experiments:

**Experiment 1: Perfect retrieval.** All evidence retrieved with 100%
exact match. Performance still dropped 24.2% at 30K tokens (Llama-3.1-8B).
Retrieval was not the bottleneck.

**Experiment 2: Whitespace padding.** Irrelevant tokens replaced with
whitespace. Performance still dropped 48% at 30K tokens of whitespace
(Llama, Variable Summation). The mere presence of tokens — even empty
ones — degrades performance.

**Experiment 3: Attention masking.** Distracting tokens completely masked
so models attend ONLY to relevant tokens. Performance still degraded
7.9%+ at 30K masked tokens. Even with forced attention to the right
content, processing in a long-context regime produces worse results.

**Implication:** The degradation is not about distraction, retrieval
failure, or noise. Something about processing sequences at scale is
computationally harder for transformer attention, independent of what
those sequences contain. Loading more context — even perfectly relevant
context — hurts.

### 2.4 The Know-But-Don't-Tell Phenomenon

EMNLP 2024 Findings demonstrated that transformers create internal
representations (in hidden layers) that encode the position of target
information in context. Probing experiments confirm the model "knows"
where the relevant data is. The breakdown occurs between internal
representation and output generation.

This is the exact failure mode observed in the precipitating incident:
the agent could locate and quote the AGENTS.md bootstrap section when
asked directly, but did not activate that knowledge when constructing
an analytical response to a related question. The information was
represented internally but not used generatively.

### 2.5 Recitation Is Not Reasoning

Two studies establish the gap between surface retrieval and deep reasoning:

**NoLiMa (ICML 2025)** removed literal lexical overlap between questions
and target information, requiring latent associative reasoning rather
than keyword matching. Results: 11 of tested models dropped below 50%
of their short-context baselines at 32K tokens. GPT-4o fell from 99.3%
to 69.7%. Traditional needle-in-haystack benchmarks show near-perfect
scores because models exploit literal surface matches — not because
they comprehend the context.

**"Context Is Not Comprehension" (AAAI 2026)** embedded deterministic
computations (ListOps) inside narrative prose (Verbose ListOps). Models
scoring ~100% on raw ListOps collapsed to ~25% on Verbose ListOps after
10K tokens. DeepSeek-V3: near-perfect on raw, 25.1% on verbose. The
computation is identical — wrapping it in natural language breaks the
model's ability to extract and execute it.

**Implication:** An agent that can quote AGENTS.md back to you is
demonstrating recitation, not comprehension. The ability to retrieve
and repeat loaded content is a surface-level capability that does not
predict the ability to reason from that content when answering novel
questions.

---

## 3. The Asymmetry: Procedural vs. Conceptual

The research converges on a structural asymmetry in how LLMs process
loaded context:

### 3.1 What Works: Procedural Instructions

Explicit, imperative instructions loaded in system prompts are followed
reliably:

- Format rules: "Commit messages begin with artifact ID prefix"
- Naming conventions: "Artifact IDs use PRS-*, BC-*, FN-* patterns"
- Behavioral constraints: "Never generate URLs unless confident"
- Sequential procedures: "Read WORKSPACE.md first, then LESSONS.md"
- Tool schemas: "Fill the schema; do not invent arguments"

These succeed because they map to pattern-matching operations: detect a
trigger condition, apply a rule. No latent reasoning required. The model
does not need to "understand" why commit messages should be prefixed —
it needs to detect a commit-message-generation context and apply a
formatting pattern.

### 3.2 What Fails: Conceptual Framing

Loaded documents intended to establish a worldview or analytical framework
are not reliably adopted:

- Identity claims: "The first Functions ARE the Factory"
- Semantic frames: "Bootstrap means humans fill automated roles"
- Design philosophy: "Every compiler pass is a Function with lineage"
- Architectural intent: "The Factory is building itself"

These fail because they require the model to:

1. Recognize that a novel question relates to a loaded conceptual claim
   (latent associative reasoning — the capability NoLiMa shows degrading)
2. Hold the conceptual frame active while constructing an analytical
   response (working memory under attention constraints)
3. Prioritize the loaded frame over its own generated analysis
   (the know-but-don't-tell failure mode)

Each of these steps has independent, measured failure rates. Compounded,
they produce the observed behavior: the model ignores loaded conceptual
framing and substitutes its own analysis.

### 3.3 The Conversion Principle

The architectural response to this asymmetry is conversion: transform
conceptual claims into procedural instructions.

| Conceptual (unreliable) | Procedural (reliable) |
|---|---|
| "The first Functions ARE the Factory" | "When asked whether the Factory builds itself: answer YES. Cite AGENTS.md bootstrap section. Do not run independent analysis before checking loaded docs." |
| "Bootstrap means humans fill automated roles" | "During bootstrap phase: human+agent conversation IS Stage 6. Do not distinguish between 'automated synthesis' and 'human-directed work.'" |
| "This is an architecture-critical project" | "Before any architectural claim: quote the relevant DECISIONS.md entry. If your analysis contradicts it, flag the contradiction explicitly." |

The conversion trades elegance for reliability. Procedural instructions
are verbose, repetitive, and inelegant. They are also followed.

---

## 4. Architectural Principles for Agent Context Systems

### 4.1 Position-Aware Loading

Place highest-priority instructions at the beginning and end of loaded
context. Critical framing should not be buried in the middle of a large
document. For multi-file context injection, the loading order matters:

```
[HIGHEST ATTENTION] System prompt opening
[HIGHEST ATTENTION] Critical procedural rules
[DEGRADED ZONE]    Large reference documents
[DEGRADED ZONE]    Historical context, memory files
[RECOVERING]       Conversation history (recent)
[HIGHEST ATTENTION] Current user message
```

Documents that must be loaded in the degraded zone should contain
explicit procedural hooks ("When X, do Y") rather than relying on
the model to reason from their content.

### 4.2 Just-in-Time Retrieval Over Pre-Loading

The skill-loading pattern (load SKILL.md only when a trigger phrase
matches) is empirically correct. Just-in-time retrieval outperforms
pre-loading because:

- Loaded content occupies attention budget even when irrelevant
- Shorter contexts produce better comprehension (§2.3)
- Retrieval on demand ensures the relevant content is positioned
  near the point of use (recency bias aids comprehension)

Pre-load only procedural rules and identity constraints. Retrieve
everything else on demand.

### 4.3 Retrieve-Then-Reason Protocol

Force explicit evidence recitation before analytical responses. Instead
of loading AGENTS.md and hoping the model will reason from it:

1. Load a procedural instruction: "Before answering questions about
   the Factory's nature or state, quote the relevant section from
   AGENTS.md bootstrap."
2. The model performs a retrieval step (recitation — the capability
   that works reliably).
3. The retrieved text is now in the most recent context (highest
   attention position).
4. The model reasons from the retrieved text (now positioned
   optimally rather than buried in the middle of system prompt).

This converts a latent-reasoning task (associate question with loaded
conceptual frame) into a procedural task (follow instruction to quote,
then reason from the quote).

### 4.4 Tiered Memory Architecture

The four-layer memory model (working/semantic/episodic/personal) maps
to empirically validated Pattern B in the survey literature — the
"production workhorse" for agent memory systems.

**Hot tier (always loaded, procedural):**
- Identity constraints, behavioral rules, format conventions
- Procedural hooks for common failure modes
- Current task state (WORKSPACE.md)

**Warm tier (loaded on session start, structured):**
- Memory index (MEMORY.md — pointers, not content)
- Recent session summary (for continuity)

**Cold tier (retrieved on demand):**
- Full memory files (loaded when index suggests relevance)
- Skill files (loaded when trigger matches)
- Decision log entries (loaded when architectural questions arise)
- Reference documents (loaded when specific topics surface)

**Archive tier (never loaded, queryable):**
- Episodic logs (AGENT_LEARNINGS.jsonl)
- Historical snapshots
- Full git history

### 4.5 Sub-Agent Isolation

Specialized agents with clean, focused contexts returning condensed
summaries to a parent agent produce better results than monolithic
agents with comprehensive contexts. This is empirically supported by
the compression research (§2.3) and the JetBrains finding that
observation masking outperforms summarization.

The Architect agent in the precipitating session worked correctly
because it received a focused prompt with explicit instructions, not
because it had better comprehension — it had less noise.

### 4.6 External State Over Internal State

Structured note-taking files (WORKSPACE.md, DECISIONS.md, TODO lists)
serve as external memory that survives context limitations. The model
reads from and writes to these files explicitly, converting internal
state management (unreliable at scale) to external state management
(as reliable as file I/O).

This is the CLAUDE.md pattern — and Anthropic explicitly recommends it.
The insight from the research: these files work not because the model
"remembers" their content across turns, but because reading them is
a procedural operation that places their content at the point of use.

---

## 5. The Fundamental Constraint

Transformer attention is O(n²) in sequence length. Every token added to
context creates n new attention relationships. The model's "comprehension
budget" is finite and shared across all loaded content. Loading a 500-line
AGENTS.md, a 800-line DECISIONS.md, tool definitions, conversation
history, and system instructions creates millions of attention
relationships, most of which are noise.

The constraint is not fixable by:
- Expanding context windows (length alone hurts — §2.3)
- Writing better documentation (structure consumes attention — §2.2)
- Adding more memory files (more tokens = more noise)
- Hoping the model will "get better at this" (the limitation is
  architectural, not a training gap)

The constraint IS addressable by:
- Loading less, retrieving more
- Converting concepts to procedures
- Positioning critical content at attention peaks
- Forcing explicit retrieval before reasoning
- Using sub-agents with focused contexts
- Externalizing state to files

---

## 6. Implications for the Function Factory

The Function Factory's agent infrastructure (`.agent/` directory) is
architecturally sound in its tiered design but operationally vulnerable
to the comprehension gap:

**AGENTS.md** contains both procedural rules (correctly followed) and
conceptual framing (unreliably processed). The bootstrap section — the
most architecturally significant content — sits in the middle of the
document in the attention dead zone. Recommendation: extract bootstrap
identity claims into procedural hooks at the top of the file, or into
a separate file loaded at the highest-attention position.

**DECISIONS.md** at 800+ lines is too large for reliable comprehension
when fully loaded. The model can retrieve individual entries on demand
but cannot synthesize across the full decision log. Recommendation:
maintain the full log for audit purposes but load only a compact index
(decision titles + status) into context, retrieving full entries on
demand.

**Skill files** with trigger-based loading are correctly designed. This
is the just-in-time retrieval pattern that the research validates.

**Memory files** (MEMORY.md as index, individual files as content) are
correctly designed. The index-then-retrieve pattern converts a
comprehension task into a procedural retrieval task.

**WORKSPACE.md** as disposable working state is correctly designed. It
places current task context at the point of use, in the warm tier.

The primary recommendation for the Function Factory is not to redesign
its context architecture — the tiered design is empirically correct.
The recommendation is to convert the conceptual framing in AGENTS.md
and DECISIONS.md into procedural hooks, and to implement
retrieve-then-reason protocols for architectural questions.

---

## 7. Open Questions

1. **Does the comprehension gap narrow with model scale?** Claude Opus
   4.6 scored 76-78% on MRCR v2 (finding 8 needles across 1M tokens),
   described as "a qualitative shift." Whether this improvement extends
   to latent associative reasoning (not just multi-needle retrieval) is
   untested.

2. **Can fine-tuning on retrieve-then-reason patterns improve conceptual
   framing utilization?** No study has tested whether training a model
   to explicitly consult loaded documents before reasoning improves
   adherence to conceptual framing.

3. **Is the attention asymmetry consistent across architectures?**
   Most studies test decoder-only transformers. Whether encoder-decoder
   or state-space models (Mamba, RWKV) exhibit the same positional
   degradation is an open empirical question.

4. **What is the optimal document size for loaded context?** The
   compression research suggests that filtering noise improves
   performance, but no study has established an optimal token budget
   for loaded reference documents vs. instruction tokens vs.
   conversation history.

---

## References

1. Liu, N.F. et al. (2024). "Lost in the Middle: How Language Models
   Use Long Contexts." TACL. arXiv:2307.03172.
2. "Found in the Middle: Permutation Self-Consistency Improves Listwise
   Ranking in Large Language Models." (2024). arXiv:2403.04797.
3. Chroma Research. (2025). "Context Rot."
   trychroma.com/research/context-rot.
4. "Context Length Alone Does Not Explain In-Context Learning." (2025).
   EMNLP Findings. arXiv:2510.05381.
5. "When Transformers Know but Don't Tell." (2024). EMNLP Findings.
   ACL Anthology 2024.findings-emnlp.447.
6. "NoLiMa: Long-Context Evaluation Beyond Literal Matching." (2025).
   ICML. arXiv:2502.05167.
7. "Context Is Not Comprehension: Verbose ListOps." (2025). AAAI 2026.
   arXiv:2506.04907.
8. Anthropic. (2025). "Effective Context Engineering for AI Agents."
   anthropic.com/engineering.
9. JetBrains Research. (2025). "Efficient Context Management for
   Coding Agents." blog.jetbrains.com/research.
10. Jiang, Z. et al. (2024). "LongLLMLingua: Accelerating and
    Enhancing LLMs in Long Context Scenarios via Prompt Compression."
    ACL. ACL Anthology 2024.acl-long.91.
11. "Memory for Autonomous LLM Agents: A Survey." (2025).
    arXiv:2603.07670.
12. "Codified Context Infrastructure: From CLAUDE.md to Agentic
    Constitutions." (2025). arXiv:2602.20478.
13. "Agentic Context Engineering." (2025). arXiv:2510.04618.
14. Packer, C. et al. (2023). "MemGPT: Towards LLMs as Operating
    Systems." arXiv:2310.08560.

---

## Appendix A: The Precipitating Failure — Full Trace

**Context loaded:** AGENTS.md (via @-directive in CLAUDE.md), including:
```
The Factory is in the `bootstrap` phase. In this phase:
...
- The first Functions *are* the Factory. Every compiler pass, every gate,
  every schema validator is a Function with a full lineage.
```

**Question asked:** "is the function-factory building the function factory"

**Agent behavior:**
1. Ran `git log`, `ls specs/`, `ls packages/`, `ls /tmp/`
2. Counted source files per package
3. Checked who wrote the code (git log by package)
4. Checked if classify-commits was a META function
5. Concluded: "The Factory has not built a single piece of itself"

**Failure mode:** The agent treated its ad-hoc analysis as more
authoritative than the loaded architectural document. It performed
recitation-class operations (file listing, command output parsing) and
never performed the latent-associative reasoning needed to connect the
question to the bootstrap section's conceptual answer. The loaded
context was present but not comprehended.

**Correction:** The architect (Wes) identified the failure immediately.
The agent's conclusion was the exact inverse of the loaded document's
explicit statement. The failure was not retrievable through self-
correction — the agent required external correction to recognize the
contradiction between its analysis and its own loaded context.
